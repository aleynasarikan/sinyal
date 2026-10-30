// ClickHouse deposu (SİNYAL'e ait bağımsız veritabanı). Tüm sorgular parametrelidir.
// Okuma deseni: ReplacingMergeTree tablolarında FINAL; toplu okuma/yazma (satır satır döngü yok).

import type {
  AnalysisRun, Article, ArticleTranslation, AuditLog, Claim, ClaimReview, ClaimSource, Event, EventMember,
  EventUpdate, ExtractedEntity, IngestionRun, Source, User,
} from "../domain/types.ts";
import { matchKey } from "../text/normalize.ts";
import type { ChClient, Params } from "./ch_client.ts";
import type { ArticleFilter, ArticleStats, EventFilter, Repo, SessionRow } from "./repo.ts";

const EFF_TIME = "if(date_quality = 'exact' AND published_at IS NOT NULL, published_at, first_seen_at)";
const TS = (p: string) => `parseDateTime64BestEffort({${p}:String}, 3, 'UTC')`;

type Row = Record<string, unknown>;
const j = (v: unknown) => JSON.stringify(v);
const pj = <T>(s: unknown, d: T): T => { try { return JSON.parse(String(s)) as T; } catch { return d; } };

export class ClickHouseRepo implements Repo {
  readonly kind = "clickhouse" as const;
  constructor(private readonly ch: ChClient) {}

  async ping() {
    try { await this.ch.query("SELECT 1 AS ok"); return { ok: true, message: "ClickHouse erişilebilir" }; }
    catch { return { ok: false, message: "ClickHouse'a bağlanılamadı" }; }
  }

  // ---- sources ----
  async upsertSources(rows: Source[]) { await this.ch.insert("sources", rows); }
  async listSources() { return this.ch.query<Source>("SELECT source_id, name, domain, country, default_lang, provider, created_at FROM sources FINAL ORDER BY name"); }

  // ---- articles ----
  async insertArticles(rows: Article[]) {
    await this.ch.insert("articles", rows.map((a) => ({ ...a, search_key: matchKey(a.title_original + " " + a.body_original) })));
  }
  private readonly articleCols =
    "article_id, source_id, provider, external_id, url, canonical_url, title_original, body_original, lang_declared, lang_detected, " +
    "lang_confidence, published_at, date_quality, fetched_at, first_seen_at, content_hash, ingestion_run_id";
  async getArticles(ids: string[]) {
    if (!ids.length) return [];
    return this.ch.query<Article>(`SELECT ${this.articleCols} FROM articles FINAL WHERE article_id IN {ids:Array(String)}`, { ids });
  }
  async existingArticleIds(ids: string[]) {
    if (!ids.length) return new Set<string>();
    const r = await this.ch.query<{ article_id: string }>("SELECT DISTINCT article_id FROM articles WHERE article_id IN {ids:Array(String)}", { ids });
    return new Set(r.map((x) => x.article_id));
  }
  async articlesSince(since: string) {
    return this.ch.query<Article>(`SELECT ${this.articleCols} FROM articles FINAL WHERE first_seen_at >= ${TS("since")}`, { since });
  }

  private articleWhere(f: ArticleFilter): { where: string; params: Params } {
    const w: string[] = ["1"];
    const p: Params = {};
    if (f.q) { w.push("positionUTF8(search_key, {q:String}) > 0"); p.q = matchKey(f.q); }
    if (f.lang) { w.push("(lang_detected = {lang:String} OR lang_declared = {lang:String})"); p.lang = f.lang; }
    if (f.source_id) { w.push("source_id = {source_id:String}"); p.source_id = f.source_id; }
    if (f.country) { w.push("source_id IN (SELECT source_id FROM sources FINAL WHERE country = {country:String})"); p.country = f.country; }
    if (f.from) { w.push(`published_at >= ${TS("from")}`); p.from = f.from; }
    if (f.to) { w.push(`published_at <= ${TS("to")}`); p.to = f.to; }
    if (f.undated) w.push("published_at IS NULL");
    if (f.entity) { w.push("article_id IN (SELECT article_id FROM extracted_entities WHERE canonical_id = {entity:String})"); p.entity = f.entity; }
    if (f.novelty) { w.push("article_id IN (SELECT article_id FROM event_members FINAL WHERE novelty = {novelty:String})"); p.novelty = f.novelty; }
    return { where: w.join(" AND "), params: p };
  }
  async searchArticles(f: ArticleFilter) {
    const { where, params } = this.articleWhere(f);
    const [cnt, items] = await Promise.all([
      this.ch.query<{ c: number }>(`SELECT count() AS c FROM articles FINAL WHERE ${where}`, params),
      this.ch.query<Article>(
        `SELECT ${this.articleCols} FROM articles FINAL WHERE ${where} ORDER BY ${EFF_TIME} DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        { ...params, limit: f.limit, offset: f.offset },
      ),
    ]);
    return { total: Number(cnt[0]?.c ?? 0), items };
  }
  async articleStats(since: string): Promise<ArticleStats> {
    const rows = await this.ch.query<{ lang: string; src: string; dq: string; nov: string; c: number }>(
      `SELECT a.lang_detected AS lang, a.source_id AS src, a.date_quality AS dq, if(m.novelty = '', 'unassigned', m.novelty) AS nov, count() AS c
       FROM (SELECT article_id, lang_detected, source_id, date_quality FROM articles FINAL WHERE ${EFF_TIME} >= ${TS("since")}) AS a
       LEFT JOIN (SELECT article_id, novelty FROM event_members FINAL) AS m USING (article_id)
       GROUP BY lang, src, dq, nov`,
      { since },
    );
    const st: ArticleStats = { total: 0, byLang: {}, bySource: {}, byNovelty: {}, byDateQuality: {} };
    for (const r of rows) {
      const c = Number(r.c);
      st.total += c;
      st.byLang[r.lang] = (st.byLang[r.lang] ?? 0) + c;
      st.bySource[r.src] = (st.bySource[r.src] ?? 0) + c;
      st.byNovelty[r.nov] = (st.byNovelty[r.nov] ?? 0) + c;
      st.byDateQuality[r.dq] = (st.byDateQuality[r.dq] ?? 0) + c;
    }
    return st;
  }

  // ---- translations / entities ----
  async insertTranslations(rows: ArticleTranslation[]) {
    await this.ch.insert("article_translations", rows.map(({ origin, ...r }) => ({ ...r, origin_json: j(origin) })));
  }
  async translationsFor(ids: string[]) {
    if (!ids.length) return [];
    const r = await this.ch.query<Row>("SELECT * FROM article_translations FINAL WHERE article_id IN {ids:Array(String)}", { ids });
    return r.map(({ origin_json, ...x }) => ({ ...x, origin: pj(origin_json, null) }) as unknown as ArticleTranslation);
  }
  async insertEntities(rows: ExtractedEntity[]) {
    await this.ch.insert("extracted_entities", rows.map(({ origin, ...r }) => ({ ...r, origin_json: j(origin) })));
  }
  async entitiesFor(ids: string[]) {
    if (!ids.length) return [];
    const r = await this.ch.query<Row>(
      "SELECT article_id, entity_type, surface, canonical_id, canonical_label, latin_key, confidence, origin_json FROM extracted_entities FINAL WHERE article_id IN {ids:Array(String)}",
      { ids },
    );
    return r.map(({ origin_json, ...x }) => ({ ...x, origin: pj(origin_json, null) }) as unknown as ExtractedEntity);
  }

  // ---- events ----
  async upsertEvents(rows: Event[]) {
    await this.ch.insert("events", rows.map(({ origin, ...e }) => ({ ...e, origin_json: j(origin), search_key: matchKey(e.title_tr + " " + e.summary_tr) })));
  }
  private mapEvent = ({ origin_json, search_key: _s, ...e }: Row) => ({ ...e, origin: pj(origin_json, null), version: Number(e.version) }) as unknown as Event;
  async getEvent(id: string) {
    const r = await this.ch.query<Row>("SELECT * FROM events FINAL WHERE event_id = {id:String}", { id });
    return r[0] ? this.mapEvent(r[0]) : null;
  }
  async listEvents(f: EventFilter) {
    const w: string[] = ["status = 'active'"];
    const p: Params = {};
    const memberArticles = (cond: string) => `event_id IN (SELECT event_id FROM event_members FINAL WHERE article_id IN (${cond}))`;
    if (f.since) { w.push(`last_updated_at >= ${TS("since")}`); p.since = f.since; }
    if (f.q) {
      w.push(`(positionUTF8(search_key, {q:String}) > 0 OR ${memberArticles("SELECT article_id FROM articles FINAL WHERE positionUTF8(search_key, {q:String}) > 0")})`);
      p.q = matchKey(f.q);
    }
    if (f.lang) { w.push(memberArticles("SELECT article_id FROM articles FINAL WHERE lang_detected = {lang:String} OR lang_declared = {lang:String}")); p.lang = f.lang; }
    if (f.entity) { w.push(memberArticles("SELECT article_id FROM extracted_entities WHERE canonical_id = {entity:String}")); p.entity = f.entity; }
    const where = w.join(" AND ");
    const [cnt, items] = await Promise.all([
      this.ch.query<{ c: number }>(`SELECT count() AS c FROM events FINAL WHERE ${where}`, p),
      this.ch.query<Row>(`SELECT * FROM events FINAL WHERE ${where} ORDER BY last_updated_at DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`, { ...p, limit: f.limit, offset: f.offset }),
    ]);
    return { total: Number(cnt[0]?.c ?? 0), items: items.map(this.mapEvent) };
  }
  async insertMembers(rows: EventMember[]) {
    await this.ch.insert("event_members", rows.map(({ origin, reason, ...m }) => ({ ...m, reason_json: j(reason), origin_json: j(origin) })));
  }
  private mapMember = ({ origin_json, reason_json, ...m }: Row) => ({ ...m, reason: pj(reason_json, {}), origin: pj(origin_json, null) }) as unknown as EventMember;
  async membersOf(eventIds: string[]) {
    if (!eventIds.length) return [];
    return (await this.ch.query<Row>("SELECT * FROM event_members FINAL WHERE event_id IN {ids:Array(String)}", { ids: eventIds })).map(this.mapMember);
  }
  async memberOfArticles(articleIds: string[]) {
    if (!articleIds.length) return [];
    return (await this.ch.query<Row>("SELECT * FROM event_members FINAL WHERE article_id IN {ids:Array(String)}", { ids: articleIds })).map(this.mapMember);
  }
  async insertUpdates(rows: EventUpdate[]) {
    await this.ch.insert("event_updates", rows.map(({ origin, ...u }) => ({ ...u, origin_json: j(origin) })));
  }
  private mapUpdate = ({ origin_json, ...u }: Row) => ({ ...u, origin: pj(origin_json, null) }) as unknown as EventUpdate;
  async updatesOf(eventId: string) {
    return (await this.ch.query<Row>("SELECT * FROM event_updates FINAL WHERE event_id = {id:String} ORDER BY created_at", { id: eventId })).map(this.mapUpdate);
  }
  async updatesSince(since: string) {
    return (await this.ch.query<Row>(`SELECT * FROM event_updates FINAL WHERE created_at >= ${TS("since")}`, { since })).map(this.mapUpdate);
  }

  // ---- claims ----
  async insertClaims(claims: Claim[], sources: ClaimSource[]) {
    await this.ch.insert("claims", claims.map(({ origin, ...c }) => ({ ...c, origin_json: j(origin) })));
    await this.ch.insert("claim_sources", sources);
  }
  private mapClaim = ({ origin_json, ...c }: Row) => ({ ...c, origin: pj(origin_json, null) }) as unknown as Claim;
  async claimsOf(eventId: string) {
    const claims = (await this.ch.query<Row>("SELECT * FROM claims FINAL WHERE event_id = {id:String} ORDER BY created_at", { id: eventId })).map(this.mapClaim);
    const ids = claims.map((c) => c.claim_id);
    if (!ids.length) return { claims, sources: [], reviews: [] };
    const [sources, reviews] = await Promise.all([
      this.ch.query<ClaimSource>("SELECT claim_id, article_id, quote, support, notes FROM claim_sources FINAL WHERE claim_id IN {ids:Array(String)}", { ids }),
      this.ch.query<ClaimReview>("SELECT * FROM claim_reviews WHERE claim_id IN {ids:Array(String)} ORDER BY created_at", { ids }),
    ]);
    return { claims, sources, reviews };
  }
  async getClaim(id: string) {
    const r = await this.ch.query<Row>("SELECT * FROM claims FINAL WHERE claim_id = {id:String}", { id });
    return r[0] ? this.mapClaim(r[0]) : null;
  }
  async insertReview(r: ClaimReview) { await this.ch.insert("claim_reviews", [r]); }

  // ---- runs ----
  async insertAnalysisRun(r: AnalysisRun) { await this.ch.insert("analysis_runs", [r]); }
  async listAnalysisRuns(limit: number) {
    return this.ch.query<AnalysisRun>("SELECT * FROM analysis_runs ORDER BY started_at DESC LIMIT {limit:UInt32}", { limit });
  }
  async insertIngestionRun(r: IngestionRun) { await this.ch.insert("ingestion_runs", [r]); }
  async listIngestionRuns(limit: number) {
    return this.ch.query<IngestionRun>("SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT {limit:UInt32}", { limit });
  }

  // ---- users / sessions / audit ----
  async upsertUser(u: User) { await this.ch.insert("users", [u]); }
  private mapUser = (u: Row) => ({ ...u, version: Number(u.version) }) as unknown as User;
  async getUserByEmail(email: string) {
    const r = await this.ch.query<Row>("SELECT * FROM users FINAL WHERE email = {email:String}", { email: email.toLowerCase() });
    return r[0] ? this.mapUser(r[0]) : null;
  }
  async getUser(id: string) {
    const r = await this.ch.query<Row>("SELECT * FROM users FINAL WHERE user_id = {id:String}", { id });
    return r[0] ? this.mapUser(r[0]) : null;
  }
  async listUsers() { return (await this.ch.query<Row>("SELECT * FROM users FINAL ORDER BY created_at")).map(this.mapUser); }

  async insertSession(s: SessionRow) { await this.ch.insert("sessions", [{ ...s, updated_at: new Date().toISOString() }]); }
  async getSession(h: string) {
    const r = await this.ch.query<SessionRow>("SELECT token_hash, user_id, expires_at, revoked FROM sessions FINAL WHERE token_hash = {h:String}", { h });
    return r[0] ?? null;
  }

  async insertAudit(a: AuditLog) { await this.ch.insert("audit_logs", [a]); }
  async listAudit(limit: number) { return this.ch.query<AuditLog>("SELECT * FROM audit_logs ORDER BY ts DESC LIMIT {limit:UInt32}", { limit }); }
}
