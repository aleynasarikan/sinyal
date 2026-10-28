// SİNYAL REST API. `createApp` saf bir fetch işleyicisi döndürür (testlerde ağ olmadan çağrılabilir).

import { can, createUser, login, logout, ROLES, SESSION_TTL_MS, sessionUser, type Permission } from "../auth/auth.ts";
import { RateLimiter } from "../auth/rate_limit.ts";
import { detectConflicts } from "../claims/conflicts.ts";
import type { Config } from "../config.ts";
import type { AuditLog, ClaimReview, NoveltyLabel, ReviewStatus, Role, User } from "../domain/types.ts";
import { RTL_LANGS } from "../domain/types.ts";
import { nowIso, stableId } from "../ids.ts";
import { analyzeEvent } from "../llm/analyze.ts";
import type { LlmProvider } from "../llm/types.ts";
import { log } from "../log.ts";
import { metrics, percentile } from "../metrics.ts";
import type { Gazetteer } from "../pipeline/entities.ts";
import { runIngestion } from "../pipeline/ingest.ts";
import type { DataProvider } from "../providers/types.ts";
import type { Repo } from "../store/repo.ts";
import {
  HttpError, SECURITY_HEADERS, SESSION_COOKIE, clientIp, intParam, json, readCookie, readJson, sessionCookie, strParam,
} from "./http.ts";

export interface AppDeps {
  cfg: Config;
  repo: Repo;
  gz: Gazetteer;
  provider: DataProvider;
  llm: LlmProvider;
  /** Statik varlıklar: yol → [içerik, content-type] */
  assets?: Map<string, [string, string]>;
}

interface Ctx { req: Request; url: URL; ip: string; user: User | null; token: string | null; params: string[] }
type Handler = (c: Ctx) => Promise<Response>;
interface Route { method: string; pattern: RegExp; perm: Permission | null; handler: Handler }

const NOVELTY: ReadonlySet<string> = new Set(["new_event", "significant_update", "duplicate", "unverified_claim", "uncertain_date_or_source"]);
const REVIEW: ReadonlySet<string> = new Set(["approved", "corrected", "rejected", "pending"]);

export function createApp(d: AppDeps) {
  const { cfg, repo, gz } = d;
  const loginIpLimiter = new RateLimiter(cfg.rate.loginPerMin);
  const loginGlobalLimiter = new RateLimiter(cfg.rate.loginPerMin * 20);
  const apiLimiter = new RateLimiter(cfg.rate.apiPerMin);
  const analysisLimiter = new RateLimiter(cfg.rate.analysisPerMin);
  let ingestRunning = false;

  const audit = (c: Ctx, action: string, target: string, ok: boolean, detail: Record<string, unknown> = {}) => {
    const a: AuditLog = { ts: nowIso(), user_id: c.user?.user_id ?? "", action, target, ip: c.ip, detail: JSON.stringify(detail), ok };
    repo.insertAudit(a).catch((e) => log("error", "denetim kaydı yazılamadı", { err: (e as Error).message }));
  };

  const routes: Route[] = [];
  const on = (method: string, path: string, perm: Permission | null, handler: Handler) =>
    routes.push({ method, pattern: new RegExp("^" + path.replace(/:[a-z]+/g, "([A-Za-z0-9_.-]{1,80})") + "$"), perm, handler });

  // ---------- Kimlik ----------
  on("GET", "/api/health", null, async () => {
    const db = await repo.ping().catch(() => ({ ok: false, message: "erişilemiyor" }));
    return json({ ok: db.ok, store: repo.kind, db: db.ok ? "ok" : "error" }, db.ok ? 200 : 503);
  });

  on("POST", "/api/auth/login", null, async (c) => {
    if (loginIpLimiter.limited(c.ip) || loginGlobalLimiter.limited("*")) {
      audit(c, "login", "", false, { reason: "rate_limited" });
      return json({ ok: false, error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." }, 429, { "Retry-After": String(loginIpLimiter.retryAfterSec(c.ip)) });
    }
    const b = await readJson(c.req, cfg.maxBodyBytes);
    const email = String(b.email ?? "").slice(0, 200);
    const res = await login(repo, email, String(b.password ?? "").slice(0, 500));
    if (!res) {
      audit(c, "login", "", false, { reason: "bad_credentials" });
      return json({ ok: false, error: "E-posta veya parola hatalı" }, 401);
    }
    c.user = res.user;
    audit(c, "login", res.user.user_id, true);
    return json({ ok: true, user: publicUser(res.user) }, 200, { "Set-Cookie": sessionCookie(res.token, SESSION_TTL_MS / 1000, cfg.cookieSecure) });
  });

  on("POST", "/api/auth/logout", null, async (c) => {
    await logout(repo, c.token);
    if (c.user) audit(c, "logout", c.user.user_id, true);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0, cfg.cookieSecure) });
  });

  on("GET", "/api/auth/me", "read", async (c) => json({ ok: true, user: publicUser(c.user!) }));

  // ---------- Pano ----------
  on("GET", "/api/dashboard", "read", async (c) => {
    const hours = c.url.searchParams.get("window") === "72" ? 72 : 24;
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    const [stats, updates, events, prov, ingRuns, anRuns, sources] = await Promise.all([
      repo.articleStats(since), repo.updatesSince(since), repo.listEvents({ since, limit: 500, offset: 0 }),
      d.provider.status(), repo.listIngestionRuns(5), repo.listAnalysisRuns(50), repo.listSources(),
    ]);
    const newEvents = updates.filter((u) => u.label === "new_event").length;
    const updatedEvents = new Set(updates.filter((u) => u.label === "significant_update").map((u) => u.event_id)).size;
    const srcName = new Map(sources.map((s) => [s.source_id, s.name]));
    const lastIng = ingRuns[0] ?? null;
    return json({
      demo: prov.demo,
      llm_mock: d.llm.mock,
      window_hours: hours,
      counts: {
        new_events: newEvents,
        updated_events: updatedEvents,
        active_events: events.total,
        articles: stats.total,
        duplicates: stats.byNovelty.duplicate ?? 0,
        unverified_claims: stats.byNovelty.unverified_claim ?? 0,
        uncertain_date_or_source: stats.byNovelty.uncertain_date_or_source ?? 0,
      },
      by_lang: stats.byLang,
      by_source: Object.fromEntries(Object.entries(stats.bySource).map(([k, v]) => [srcName.get(k) ?? `${k} (kayıtsız kaynak)`, v])),
      by_date_quality: stats.byDateQuality,
      pipeline: {
        provider: prov,
        last_ingestion: lastIng,
        healthy: prov.state === "ok" && (!lastIng || lastIng.status === "ok"),
      },
      model: {
        provider: d.llm.name, model: d.llm.model, mock: d.llm.mock,
        recent_errors: anRuns.filter((r) => r.status === "error").length,
        recent_runs: anRuns.length,
        inflight: metrics.llm?.inflight ?? 0,
      },
    });
  });

  // ---------- Olaylar ----------
  on("GET", "/api/events", "read", async (c) => {
    const sp = c.url.searchParams;
    const hours = intParam(sp.get("window"), 0, 0, 24 * 30);
    const res = await repo.listEvents({
      q: strParam(sp.get("q")), lang: strParam(sp.get("lang"), 5), entity: strParam(sp.get("entity"), 80),
      since: hours ? new Date(Date.now() - hours * 3_600_000).toISOString() : undefined,
      limit: intParam(sp.get("limit"), 30, 1, 100), offset: intParam(sp.get("offset"), 0, 0, 100_000),
    });
    const members = await repo.membersOf(res.items.map((e) => e.event_id));
    const arts = await repo.getArticles(members.map((m) => m.article_id));
    const byId = new Map(arts.map((a) => [a.article_id, a]));
    const runs = await repo.listAnalysisRuns(500);
    return json({
      total: res.total,
      items: res.items.map((e) => {
        const ms = members.filter((m) => m.event_id === e.event_id);
        const langs = [...new Set(ms.map((m) => byId.get(m.article_id)?.lang_detected).filter(Boolean))];
        const count = (l: NoveltyLabel) => ms.filter((m) => m.novelty === l).length;
        const run = runs.find((r) => r.event_id === e.event_id && r.status === "ok");
        return {
          ...e, article_count: ms.length, langs,
          sources: new Set(ms.map((m) => byId.get(m.article_id)?.source_id)).size,
          uncertain_matches: ms.filter((m) => m.match_status === "uncertain").length,
          novelty: { significant_update: count("significant_update"), duplicate: count("duplicate"), unverified_claim: count("unverified_claim"), uncertain_date_or_source: count("uncertain_date_or_source") },
          analysis: run ? { title_tr: run.title_tr, mock: run.mock, model: run.model } : null,
        };
      }),
    });
  });

  on("GET", "/api/events/:id", "read", async (c) => {
    const id = c.params[0]!;
    const ev = await repo.getEvent(id);
    if (!ev) throw new HttpError(404, "Olay bulunamadı");
    const members = await repo.membersOf([id]);
    const ids = members.map((m) => m.article_id);
    const [arts, ents, updates, claimData, sources, runs, translations] = await Promise.all([
      repo.getArticles(ids), repo.entitiesFor(ids), repo.updatesOf(id), repo.claimsOf(id), repo.listSources(),
      repo.listAnalysisRuns(500), repo.translationsFor(ids),
    ]);
    const srcById = new Map(sources.map((s) => [s.source_id, s]));
    const entityAgg = new Map<string, { id: string; label: string; type: string; surfaces: Set<string>; articles: Set<string> }>();
    for (const e of ents) {
      if (!e.canonical_id) continue;
      const cur = entityAgg.get(e.canonical_id) ?? { id: e.canonical_id, label: e.canonical_label, type: e.entity_type, surfaces: new Set(), articles: new Set() };
      cur.surfaces.add(e.surface); cur.articles.add(e.article_id);
      entityAgg.set(e.canonical_id, cur);
    }
    const latestReview = new Map<string, ClaimReview>();
    for (const r of [...claimData.reviews].sort((a, b) => a.created_at.localeCompare(b.created_at))) latestReview.set(r.claim_id, r);
    const run = runs.find((r) => r.event_id === id) ?? null;
    return json({
      event: ev,
      articles: members.map((m) => {
        const a = arts.find((x) => x.article_id === m.article_id)!;
        const s = srcById.get(a.source_id);
        return {
          article_id: a.article_id, url: a.url, title_original: a.title_original, body_original: a.body_original,
          lang: a.lang_detected, lang_declared: a.lang_declared, lang_confidence: a.lang_confidence, rtl: RTL_LANGS.has(a.lang_detected),
          published_at: a.published_at, date_quality: a.date_quality, first_seen_at: a.first_seen_at,
          source: s ? { id: s.source_id, name: s.name, domain: s.domain, country: s.country } : { id: a.source_id, name: a.source_id, domain: "", country: "", unknown: true },
          translation_tr: translations.find((t) => t.article_id === a.article_id) ?? null,
          member: { score: m.match_score, status: m.match_status, reason: m.reason, novelty: m.novelty },
        };
      }).sort((x, y) => (x.published_at ?? x.first_seen_at).localeCompare(y.published_at ?? y.first_seen_at)),
      entities: [...entityAgg.values()].map((e) => ({ ...e, surfaces: [...e.surfaces], articles: [...e.articles] })),
      timeline: updates,
      conflicts: detectConflicts(arts, gz),
      analysis: run,
      claims: claimData.claims.filter((cl) => !run || cl.analysis_run_id === run.run_id).map((cl) => ({
        ...cl,
        sources: claimData.sources.filter((s) => s.claim_id === cl.claim_id),
        review: latestReview.get(cl.claim_id) ?? null,
      })),
    });
  });

  on("POST", "/api/events/:id/analyze", "analyze", async (c) => {
    const key = c.user!.user_id;
    if (analysisLimiter.limited(key)) return json({ ok: false, error: "Analiz hız sınırı aşıldı" }, 429, { "Retry-After": String(analysisLimiter.retryAfterSec(key)) });
    const id = c.params[0]!;
    if (!(await repo.getEvent(id))) throw new HttpError(404, "Olay bulunamadı");
    const res = await analyzeEvent(id, { repo, gz, llm: d.llm }, {
      timeoutMs: cfg.llm.timeoutMs, maxRetries: cfg.llm.maxRetries, sendFullText: cfg.llm.sendFullText, maxCharsPerArticle: cfg.llm.maxCharsPerArticle,
    }, key);
    audit(c, "analyze_event", id, res.run.status === "ok", { run_id: res.run.run_id, provider: res.run.provider, mock: res.run.mock });
    return json({ ok: res.run.status === "ok", run: res.run, error: res.run.status === "ok" ? undefined : "Model analizi başarısız oldu" }, res.run.status === "ok" ? 200 : 502);
  });

  // ---------- Haberler ----------
  on("GET", "/api/articles", "read", async (c) => {
    const sp = c.url.searchParams;
    const nov = strParam(sp.get("novelty"), 40);
    const res = await repo.searchArticles({
      q: strParam(sp.get("q")), lang: strParam(sp.get("lang"), 5), country: strParam(sp.get("country"), 2)?.toUpperCase(),
      source_id: strParam(sp.get("source"), 80), entity: strParam(sp.get("entity"), 80),
      from: isoParam(sp.get("from")), to: isoParam(sp.get("to")),
      novelty: nov && NOVELTY.has(nov) ? (nov as NoveltyLabel) : undefined,
      limit: intParam(sp.get("limit"), 30, 1, 100), offset: intParam(sp.get("offset"), 0, 0, 100_000),
    });
    const ids = res.items.map((a) => a.article_id);
    const [members, sources, translations] = await Promise.all([repo.memberOfArticles(ids), repo.listSources(), repo.translationsFor(ids)]);
    const evIds = [...new Set(members.map((m) => m.event_id))];
    const events = new Map((await Promise.all(evIds.map((e) => repo.getEvent(e)))).filter((x) => !!x).map((e) => [e!.event_id, e!]));
    const srcById = new Map(sources.map((s) => [s.source_id, s]));
    return json({
      total: res.total,
      items: res.items.map((a) => {
        const m = members.find((x) => x.article_id === a.article_id);
        const s = srcById.get(a.source_id);
        return {
          article_id: a.article_id, url: a.url, title_original: a.title_original, snippet: a.body_original.slice(0, 280),
          lang: a.lang_detected, lang_confidence: a.lang_confidence, rtl: RTL_LANGS.has(a.lang_detected),
          published_at: a.published_at, date_quality: a.date_quality,
          source: s ? { id: s.source_id, name: s.name, country: s.country } : { id: a.source_id, name: a.source_id, country: "", unknown: true },
          translation_tr: translations.find((t) => t.article_id === a.article_id) ?? null,
          event: m ? { event_id: m.event_id, title_tr: events.get(m.event_id)?.title_tr ?? "", novelty: m.novelty, match_status: m.match_status } : null,
        };
      }),
    });
  });

  on("GET", "/api/sources", "read", async () => json({ items: await repo.listSources() }));

  on("GET", "/api/entities", "read", async () => json({
    demo_gazetteer: true,
    items: [...gz.byId.values()].map((e) => ({ id: e.id, type: e.type, label: e.label_tr })),
  }));

  // ---------- İddia inceleme ----------
  on("POST", "/api/claims/:id/review", "review", async (c) => {
    const claimId = c.params[0]!;
    const claim = await repo.getClaim(claimId);
    if (!claim) throw new HttpError(404, "İddia bulunamadı");
    const b = await readJson(c.req, cfg.maxBodyBytes);
    const status = String(b.status ?? "");
    if (!REVIEW.has(status)) throw new HttpError(400, "Geçersiz inceleme durumu");
    const corrected = String(b.corrected_text ?? "").trim().slice(0, 1000);
    if (status === "corrected" && !corrected) throw new HttpError(400, "Düzeltme metni gerekli");
    const r: ClaimReview = {
      review_id: stableId("rev", claimId, c.user!.user_id, nowIso()), claim_id: claimId, reviewer_id: c.user!.user_id,
      status: status as ReviewStatus, corrected_text: corrected, note: String(b.note ?? "").trim().slice(0, 1000), created_at: nowIso(),
    };
    await repo.insertReview(r);
    audit(c, "claim_review", claimId, true, { status });
    return json({ ok: true, review: r });
  });

  // ---------- İşleme / sistem ----------
  on("POST", "/api/ingest/run", "ingest", async (c) => {
    if (ingestRunning) return json({ ok: false, error: "Alım zaten çalışıyor" }, 409);
    ingestRunning = true;
    try {
      const { run } = await runIngestion(d.provider, repo, gz);
      audit(c, "ingest_run", run.run_id, run.status === "ok", { status: run.status, inserted: run.inserted });
      return json({ ok: run.status === "ok", run }, run.status === "ok" ? 200 : run.status === "not_configured" ? 409 : 502);
    } finally {
      ingestRunning = false;
    }
  });

  on("GET", "/api/system", "read", async () => {
    const [db, prov, ing, an] = await Promise.all([
      repo.ping().catch(() => ({ ok: false, message: "erişilemiyor" })), d.provider.status(), repo.listIngestionRuns(10), repo.listAnalysisRuns(20),
    ]);
    const st = metrics.llm;
    return json({
      started_at: metrics.startedAt,
      store: { kind: repo.kind, ok: db.ok, message: db.message },
      data_provider: prov,
      llm: {
        provider: d.llm.name, model: d.llm.model, mock: d.llm.mock,
        ok: st?.ok ?? 0, errors: st?.errors ?? {}, retries: st?.retries ?? 0, inflight: st?.inflight ?? 0,
        latency_p50_ms: percentile(st?.latenciesMs ?? [], 50), latency_p95_ms: percentile(st?.latenciesMs ?? [], 95),
        last_ok_at: st?.lastOkAt ?? null, last_error: st?.lastError ?? null,
        send_full_text: cfg.llm.sendFullText, max_retries: cfg.llm.maxRetries, timeout_ms: cfg.llm.timeoutMs,
      },
      queue: { ingest_running: ingestRunning, llm_inflight: st?.inflight ?? 0 },
      http: metrics.http,
      ingestion_runs: ing,
      analysis_runs: an.map(({ summary_tr: _s, ...r }) => r),
      last_successful_ingestion: ing.find((r) => r.status === "ok")?.finished_at ?? null,
      checks: [
        { name: "Veritabanı", ok: db.ok, detail: db.message },
        { name: "Veri sağlayıcı", ok: prov.state === "ok", detail: prov.message },
        { name: "Model sağlayıcı", ok: true, detail: d.llm.mock ? "MOCK — gerçek model yapılandırılmadı" : `${d.llm.name} / ${d.llm.model}` },
      ],
    });
  });

  // ---------- Yönetim ----------
  on("GET", "/api/admin/audit", "admin", async (c) => json({ items: await repo.listAudit(intParam(c.url.searchParams.get("limit"), 100, 1, 500)) }));
  on("GET", "/api/admin/users", "admin", async () => json({ items: (await repo.listUsers()).map(publicUser) }));
  on("POST", "/api/admin/users", "admin", async (c) => {
    const b = await readJson(c.req, cfg.maxBodyBytes);
    const role = String(b.role ?? "") as Role;
    if (!ROLES.includes(role)) throw new HttpError(400, "Geçersiz rol");
    try {
      const u = await createUser(repo, { email: String(b.email ?? ""), name: String(b.name ?? ""), role, password: String(b.password ?? "") });
      audit(c, "user_create", u.user_id, true, { role });
      return json({ ok: true, user: publicUser(u) }, 201);
    } catch (e) {
      audit(c, "user_create", "", false, { reason: (e as Error).message });
      throw new HttpError(400, (e as Error).message);
    }
  });

  // ---------- İşleyici ----------
  return async function fetchHandler(req: Request, socketIp: string | null = null): Promise<Response> {
    metrics.http.requests++;
    const url = new URL(req.url);
    const ip = clientIp(req, cfg.trustProxy, socketIp);
    try {
      if (!url.pathname.startsWith("/api/")) return serveStatic(url.pathname, d.assets);

      if (apiLimiter.limited("ip:" + ip)) {
        metrics.http.rateLimited++;
        return json({ ok: false, error: "Hız sınırı aşıldı" }, 429, { "Retry-After": String(apiLimiter.retryAfterSec("ip:" + ip)) });
      }
      // CSRF: durum değiştiren isteklerde tarayıcı Origin'i izinli kökenlerden biri olmalı.
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin && !cfg.publicOrigins.includes(origin)) return json({ ok: false, error: "Köken reddedildi" }, 403);
      }
      const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) {
        const exists = routes.some((r) => r.pattern.test(url.pathname));
        return json({ ok: false, error: exists ? "Yöntem desteklenmiyor" : "Bulunamadı" }, exists ? 405 : 404);
      }
      const token = readCookie(req, SESSION_COOKIE);
      const user = await sessionUser(repo, token);
      const ctx: Ctx = { req, url, ip, user, token, params: url.pathname.match(route.pattern)!.slice(1) };
      if (route.perm) {
        if (!user) return json({ ok: false, error: "Giriş gerekli" }, 401);
        if (!can(user.role, route.perm)) {
          audit(ctx, "forbidden", url.pathname, false, { perm: route.perm });
          return json({ ok: false, error: "Bu işlem için yetkiniz yok" }, 403);
        }
      }
      return await route.handler(ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
      metrics.http.errors5xx++;
      log("error", "beklenmeyen API hatası", { path: url.pathname, err: (e as Error)?.message });
      return json({ ok: false, error: "Sunucu hatası" }, 500);
    }
  };
}

function isoParam(v: string | null): string | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function publicUser(u: User) {
  return { user_id: u.user_id, email: u.email, name: u.name, role: u.role, disabled: u.disabled };
}

function serveStatic(path: string, assets?: Map<string, [string, string]>): Response {
  const key = path === "/" || !assets?.has(path) ? "/index.html" : path;
  const a = assets?.get(key);
  if (!a) return new Response("Arayüz derlenmedi", { status: 404, headers: SECURITY_HEADERS });
  return new Response(a[0], { headers: { "Content-Type": a[1], "Cache-Control": key === "/index.html" ? "no-cache" : "public, max-age=300", ...SECURITY_HEADERS } });
}
