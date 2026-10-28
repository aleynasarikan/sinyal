// Alım + işleme hattı: sağlayıcıdan oku → normalize et → varlık çıkar → olaya bağla → yenilik sınıfla → yaz.
// İDEMPOTENT: article_id = hash(sağlayıcı|kanonik URL). Aynı içerik yeniden gelirse atlanır; first_seen_at korunur.

import type {
  Article, DateQuality, Event, EventMember, EventUpdate, ExtractedEntity, IngestionRun, NoveltyLabel, Source,
} from "../domain/types.ts";
import { canonicalUrl, nowIso, sha256, stableId } from "../ids.ts";
import { log } from "../log.ts";
import type { DataProvider, RawArticle } from "../providers/types.ts";
import type { Repo } from "../store/repo.ts";
import { detectLanguage } from "../text/lang.ts";
import { cleanForStorage, matchKey } from "../text/normalize.ts";
import { EXTRACTOR_VERSION, type Gazetteer } from "./entities.ts";
import { EventState, MATCHER_VERSION, classifyNovelty, featuresOf, findBestEvent, type ArticleFeatures } from "./match.ts";

export const WINDOW_HOURS = 168;

export function dateQuality(published: string | null, estimated: boolean, fetchedAt: string): { iso: string | null; q: DateQuality } {
  if (!published) return { iso: null, q: "missing" };
  const t = Date.parse(published);
  if (!Number.isFinite(t)) return { iso: null, q: "invalid" };
  if (t > Date.parse(fetchedAt) + 3_600_000) return { iso: new Date(t).toISOString(), q: "future" };
  return { iso: new Date(t).toISOString(), q: estimated ? "estimated" : "exact" };
}

export function toArticle(raw: RawArticle, provider: string, runId: string, now: string): Article {
  const title = cleanForStorage(raw.title);
  const body = cleanForStorage(raw.body);
  const canon = canonicalUrl(raw.url);
  const det = detectLanguage(title + "\n" + body);
  const d = dateQuality(raw.published_at, raw.date_estimated, now);
  return {
    article_id: stableId("art", provider, canon),
    source_id: raw.source_id,
    provider,
    external_id: raw.external_id,
    url: raw.url,
    canonical_url: canon,
    title_original: title,
    body_original: body,
    lang_declared: raw.lang_declared,
    lang_detected: det.lang,
    lang_confidence: det.confidence,
    published_at: d.iso,
    date_quality: d.q,
    fetched_at: now,
    first_seen_at: now,
    content_hash: sha256(matchKey(title) + "\n" + matchKey(body)),
    ingestion_run_id: runId,
  };
}

const effTime = (a: Article) => (a.date_quality === "exact" && a.published_at ? a.published_at : a.first_seen_at);

/** Rule tabanlı Türkçe olay etiketi: "Deprem — Norvik, Kestriya". Model çıktısı DEĞİLDİR. */
export function ruleTitle(st: EventState, gz: Gazetteer): string {
  const c = [...st.concepts].map((x) => gz.label(x));
  const p = [...st.places].map((x) => gz.label(x));
  const e = [...st.entities].map((x) => gz.label(x)).slice(0, 2);
  const head = c.length ? c.join(" / ") : e.join(", ") || "Adlandırılmamış olay";
  return p.length ? `${head} — ${p.join(", ")}` : head;
}

export interface IngestResult { run: IngestionRun; labels: Record<string, NoveltyLabel> }

export async function runIngestion(
  provider: DataProvider, repo: Repo, gz: Gazetteer, opts: { now?: () => Date; limit?: number } = {},
): Promise<IngestResult> {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const run: IngestionRun = {
    run_id: stableId("ing", provider.name, now, Math.random().toString(36)),
    provider: provider.name, started_at: now, finished_at: now, status: "ok",
    fetched: 0, inserted: 0, skipped_duplicates: 0, errors: 0, message: "",
  };
  const labels: Record<string, NoveltyLabel> = {};

  const res = await provider.fetchBatch({ limit: opts.limit ?? 1000 });
  if (!res.ok) {
    run.status = res.state === "not_configured" || res.state === "contract_unverified" ? "not_configured" : "error";
    run.message = res.message;
    run.finished_at = nowIso();
    await repo.insertIngestionRun(run);
    return { run, labels };
  }

  const sources: Source[] = res.sources.map((s) => ({ ...s, provider: provider.name, created_at: now }));
  await repo.upsertSources(sources);
  const known = new Set((await repo.listSources()).map((s) => s.source_id));

  run.fetched = res.articles.length;
  const incoming: Article[] = [];
  for (const raw of res.articles) {
    try {
      incoming.push(toArticle(raw, provider.name, run.run_id, now));
    } catch (e) {
      run.errors++;
      log("warn", "haber dönüştürülemedi", { external_id: raw.external_id, err: (e as Error).message });
    }
  }
  // Aynı partide aynı article_id iki kez gelirse tekini al.
  const uniq = new Map(incoming.map((a) => [a.article_id, a]));
  const existing = new Map((await repo.getArticles([...uniq.keys()])).map((a) => [a.article_id, a]));
  const fresh: Article[] = [];
  for (const a of uniq.values()) {
    const old = existing.get(a.article_id);
    if (old && old.content_hash === a.content_hash) { run.skipped_duplicates++; continue; }
    if (old) { a.first_seen_at = old.first_seen_at; } // içerik değişti: yeniden yazılır, ilk görülme korunur
    fresh.push(a);
  }
  run.skipped_duplicates += incoming.length - uniq.size; // aynı partideki kopyalar

  // ---- Olay indeksini pencere içindeki mevcut üyelerden yeniden kur ----
  const since = new Date(Date.parse(now) - WINDOW_HOURS * 3_600_000).toISOString();
  const windowArticles = await repo.articlesSince(since);
  const wIds = windowArticles.map((a) => a.article_id);
  const [wEnts, wMembers] = await Promise.all([repo.entitiesFor(wIds), repo.memberOfArticles(wIds)]);
  const entsBy = groupBy(wEnts, (e) => e.article_id);
  const states = new Map<string, EventState>();
  const memberOf = new Map(wMembers.map((m) => [m.article_id, m.event_id]));
  for (const a of [...windowArticles].sort((x, y) => effTime(x).localeCompare(effTime(y)))) {
    const evId = memberOf.get(a.article_id);
    if (!evId) continue;
    const st = states.get(evId) ?? new EventState(evId);
    st.add(featuresOf(a, entsBy.get(a.article_id) ?? [], gz, known.has(a.source_id)));
    states.set(evId, st);
  }

  // ---- Yeni haberleri kronolojik sırada işle ----
  const changedArticles = new Set(fresh.filter((a) => existing.has(a.article_id)).map((a) => a.article_id));
  const newEnts: ExtractedEntity[] = [];
  const members: EventMember[] = [];
  const updates: EventUpdate[] = [];
  const touched = new Set<string>();
  fresh.sort((x, y) => effTime(x).localeCompare(effTime(y)));
  for (const a of fresh) {
    const lang = a.lang_detected !== "und" ? a.lang_detected : a.lang_declared;
    const ents = gz.extract(a.article_id, a.title_original + "\n" + a.body_original, lang);
    newEnts.push(...ents);
    if (changedArticles.has(a.article_id) && memberOf.has(a.article_id)) continue; // üyelik korunur
    const f: ArticleFeatures = featuresOf(a, ents, gz, known.has(a.source_id));
    const best = findBestEvent(f, states.values(), gz);
    const st = best?.ev ?? null;
    const novelty = classifyNovelty(f, st, gz);
    labels[a.article_id] = novelty.label;

    let target = st;
    if (!target) {
      target = new EventState(stableId("evt", a.article_id));
      states.set(target.event_id, target);
    }
    target.add(f);
    touched.add(target.event_id);
    const origin = { kind: "rule" as const, version: `${MATCHER_VERSION}+${EXTRACTOR_VERSION}` };
    members.push({
      event_id: target.event_id, article_id: a.article_id,
      match_score: best ? Number(best.res.score.toFixed(3)) : 1,
      match_status: best ? best.status : f.timeMs === null ? "uncertain" : "confident",
      reason: best ? best.res.reason : { shared_entities: [], shared_places: [], shared_numbers: [], title_similarity: 0, hours_apart: null, score: 1, notes: ["Olayı başlatan haber."] },
      novelty: novelty.label, added_at: now, origin,
    });
    if (novelty.label !== "duplicate") {
      updates.push({
        update_id: stableId("upd", target.event_id, a.article_id),
        event_id: target.event_id, article_id: a.article_id, label: novelty.label,
        summary_tr: novelty.reasons.join(" "), new_facts: novelty.new_facts,
        created_at: effTime(a), origin,
      });
    }
  }

  // ---- Etkilenen olayları güncelle (sürüm artırarak) ----
  const events: Event[] = [];
  for (const id of touched) {
    const st = states.get(id)!;
    const cur = await repo.getEvent(id);
    events.push({
      event_id: id,
      title_tr: ruleTitle(st, gz),
      summary_tr: cur?.summary_tr ?? "",
      first_seen_at: new Date(st.firstMs).toISOString(),
      last_updated_at: new Date(st.lastMs).toISOString(),
      status: "active",
      origin: { kind: "rule", version: MATCHER_VERSION },
      version: (cur?.version ?? 0) + 1,
    });
  }

  await repo.insertArticles(fresh);
  await repo.insertEntities(newEnts);
  await repo.insertMembers(members);
  await repo.insertUpdates(updates);
  await repo.upsertEvents(events);

  run.inserted = fresh.length;
  run.finished_at = nowIso();
  if (res.demo) run.message = "Demo veri";
  await repo.insertIngestionRun(run);
  log("info", "alım tamamlandı", { provider: provider.name, fetched: run.fetched, inserted: run.inserted, skipped: run.skipped_duplicates });
  return { run, labels };
}

function groupBy<T>(xs: T[], k: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const key = k(x); const arr = m.get(key); if (arr) arr.push(x); else m.set(key, [x]); }
  return m;
}
