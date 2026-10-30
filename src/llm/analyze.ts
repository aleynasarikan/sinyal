// Olay analizi: istem → model → şema doğrulama → iddia-kaynak denetimi → kayıt.
// Yeniden deneme yalnız geçici hatalarda (zaman aşımı, ağ, 429/5xx, JSON/şema hatası) ve SINIRLI sayıda yapılır.

import type { AnalysisRun, Article, Claim, ClaimSource } from "../domain/types.ts";
import { verifyClaim, VERIFIER_VERSION } from "../claims/verify.ts";
import { stableId } from "../ids.ts";
import { log } from "../log.ts";
import { metrics } from "../metrics.ts";
import type { Gazetteer } from "../pipeline/entities.ts";
import type { Repo } from "../store/repo.ts";
import { SYSTEM_PROMPT, buildUserPrompt, parseJsonLoose, validateAnalysis, type AnalysisOutput, type PromptArticle } from "./prompt.ts";
import { LlmError, type LlmProvider } from "./types.ts";

export const MOCK_CLAIM_NOTE = "MOCK: iddia, kaynak cümlesinin kopyasıdır; denetimin geçmesi gerçek doğrulama değildir.";

export interface AnalyzeOptions { timeoutMs: number; maxRetries: number; sendFullText: boolean; maxCharsPerArticle: number; maxArticles?: number }

/** Modele gönderilecek metni sınırlar: varsayılan yalnız ilk paragraf; tam metin yalnız açıkça izin verilirse. */
export function clipForModel(a: Article, o: Pick<AnalyzeOptions, "sendFullText" | "maxCharsPerArticle">): string {
  const body = o.sendFullText ? a.body_original : (a.body_original.split(/\n\s*\n/)[0] ?? "");
  return body.length > o.maxCharsPerArticle ? body.slice(0, o.maxCharsPerArticle) : body;
}

export async function callWithRetry(
  provider: LlmProvider, system: string, user: string, o: Pick<AnalyzeOptions, "timeoutMs" | "maxRetries">,
): Promise<{ value: AnalysisOutput; attempts: number }> {
  const st = metrics.llm;
  let lastErr: LlmError | null = null;
  let attempt = 1;
  for (; attempt <= o.maxRetries + 1; attempt++) {
    if (attempt > 1 && st) st.retries++;
    const t0 = performance.now();
    if (st) st.inflight++;
    try {
      const text = await provider.complete([{ role: "system", content: system }, { role: "user", content: user }], { timeoutMs: o.timeoutMs, json: true });
      let parsed: unknown;
      try { parsed = parseJsonLoose(text); } catch { throw new LlmError("Model yanıtında geçerli JSON yok", "parse", true); }
      const v = validateAnalysis(parsed);
      if (!v.ok) throw new LlmError(`Model çıktısı şemaya uymuyor: ${v.error}`, "schema", true);
      if (st) { st.ok++; st.lastOkAt = new Date().toISOString(); st.latenciesMs.push(Math.round(performance.now() - t0)); if (st.latenciesMs.length > 200) st.latenciesMs.shift(); }
      return { value: v.value, attempts: attempt };
    } catch (e) {
      lastErr = e instanceof LlmError ? e : new LlmError("Beklenmeyen LLM hatası", "network", false);
      if (st) { st.errors[lastErr.kind] = (st.errors[lastErr.kind] ?? 0) + 1; st.lastError = lastErr.message; }
      log("warn", "LLM denemesi başarısız", { provider: provider.name, attempt, kind: lastErr.kind });
      lastErr.attempts = attempt;
      if (!lastErr.retryable) break;
      if (attempt <= o.maxRetries) await new Promise((r) => setTimeout(r, Math.min(2000, 100 * 2 ** attempt)));
    } finally {
      if (st) st.inflight--;
    }
  }
  throw lastErr ?? new LlmError("LLM çağrısı başarısız", "network", false);
}

export async function analyzeEvent(
  eventId: string, deps: { repo: Repo; gz: Gazetteer; llm: LlmProvider }, o: AnalyzeOptions, requestedBy: string,
): Promise<{ run: AnalysisRun; claims: Claim[]; sources: ClaimSource[] }> {
  const { repo, gz, llm } = deps;
  const ev = await repo.getEvent(eventId);
  if (!ev) throw new Error("olay bulunamadı");
  const members = await repo.membersOf([eventId]);
  const articles = await repo.getArticles(members.map((m) => m.article_id));
  const sourcesById = new Map((await repo.listSources()).map((s) => [s.source_id, s]));
  const ents = await repo.entitiesFor(articles.map((a) => a.article_id));

  // Tekrar haberleri modele göndermeye gerek yok: önce olay başlatan/gelişme haberleri, sonra diğerleri.
  const rank = (id: string) => { const n = members.find((m) => m.article_id === id)?.novelty; return n === "duplicate" ? 1 : 0; };
  const chosen = [...articles].sort((a, b) => rank(a.article_id) - rank(b.article_id)).slice(0, o.maxArticles ?? 8);
  const payload: PromptArticle[] = chosen.map((a) => ({
    id: a.article_id, lang: a.lang_detected, source: sourcesById.get(a.source_id)?.name ?? a.source_id,
    published_at: a.published_at, title: a.title_original, text: clipForModel(a, o),
  }));

  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const runId = stableId("run", eventId, startedAt, Math.random().toString(36));
  const base: AnalysisRun = {
    run_id: runId, event_id: eventId, kind: "event_summary", provider: llm.name, model: llm.model, mock: llm.mock,
    status: "ok", error: "", latency_ms: 0, attempts: 0, claims_total: 0, claims_supported: 0, title_tr: "", summary_tr: "",
    started_at: startedAt, requested_by: requestedBy,
  };

  let out: { value: AnalysisOutput; attempts: number };
  try {
    out = await callWithRetry(llm, SYSTEM_PROMPT, buildUserPrompt({ rule_title: ev.title_tr, articles: payload }), o);
  } catch (e) {
    const err = e as LlmError;
    const run = { ...base, status: "error" as const, error: err.message, latency_ms: Math.round(performance.now() - t0), attempts: err.attempts ?? 1 };
    await repo.insertAnalysisRun(run);
    return { run, claims: [], sources: [] };
  }

  const ctx = {
    articles: new Map(articles.map((a) => [a.article_id, a])),
    eventArticleIds: new Set(articles.map((a) => a.article_id)),
    entitiesByArticle: groupEnts(ents),
    gz,
  };
  const origin = { kind: "llm" as const, provider: llm.name, model: llm.model, mock: llm.mock };
  const claims: Claim[] = [];
  const csources: ClaimSource[] = [];
  out.value.claims.forEach((c, i) => {
    const v = verifyClaim(c, ctx);
    const claim_id = stableId("clm", runId, String(i));
    // Mock sağlayıcı kaynak cümlesini aynen kopyalar; sözcüksel denetim bu yüzden her zaman geçer. Bu bir doğrulama değildir.
    const mockNote = llm.mock ? [MOCK_CLAIM_NOTE] : [];
    claims.push({ claim_id, event_id: eventId, text_tr: c.text_tr, status: v.status, check_notes: [...mockNote, ...v.notes, `denetleyici: ${VERIFIER_VERSION}`], origin, analysis_run_id: runId, created_at: startedAt });
    for (const s of v.sources) csources.push({ claim_id, ...s });
  });

  const run: AnalysisRun = {
    ...base, latency_ms: Math.round(performance.now() - t0), attempts: out.attempts,
    claims_total: claims.length,
    // Mock çalıştırmada "dayanaklı" sayısı gerçek doğrulama gibi raporlanmaz.
    claims_supported: llm.mock ? 0 : claims.filter((c) => c.status === "supported").length,
    title_tr: out.value.title_tr, summary_tr: out.value.summary_tr,
  };
  await repo.insertClaims(claims, csources);
  await repo.insertAnalysisRun(run);
  return { run, claims, sources: csources };
}

function groupEnts<T extends { article_id: string }>(xs: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(x.article_id, [...(m.get(x.article_id) ?? []), x]);
  return m;
}
