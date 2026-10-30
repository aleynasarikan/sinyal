// Bellek içi depo — testler ve ClickHouse'suz yerel demo için. Süreç kapanınca veri kaybolur.
// Anlamsal davranışı ClickHouseRepo ile aynıdır: aynı anahtarla yeniden yazım kaydı DEĞİŞTİRİR, çoğaltmaz.

import type {
  AnalysisRun, Article, ArticleTranslation, AuditLog, Claim, ClaimReview, ClaimSource, Event, EventMember,
  EventUpdate, ExtractedEntity, IngestionRun, Source, User,
} from "../domain/types.ts";
import { matchKey } from "../text/normalize.ts";
import type { ArticleFilter, ArticleStats, EventFilter, Repo, SessionRow } from "./repo.ts";

/** Güvenilir yayın zamanı varsa o, yoksa SİNYAL'in ilk görme zamanı. */
export const effectiveTime = (a: Article): string => (a.date_quality === "exact" && a.published_at ? a.published_at : a.first_seen_at);

const page = <T>(xs: T[], limit: number, offset: number) => ({ total: xs.length, items: xs.slice(offset, offset + limit) });

export class MemoryRepo implements Repo {
  readonly kind = "memory" as const;
  private sources = new Map<string, Source>();
  private articles = new Map<string, Article>();
  private translations = new Map<string, ArticleTranslation>();
  private entities = new Map<string, ExtractedEntity>();
  private events = new Map<string, Event>();
  private members = new Map<string, EventMember>();
  private updates = new Map<string, EventUpdate>();
  private claims = new Map<string, Claim>();
  private claimSources = new Map<string, ClaimSource>();
  private reviews: ClaimReview[] = [];
  private analysisRuns: AnalysisRun[] = [];
  private ingestionRuns: IngestionRun[] = [];
  private users = new Map<string, User>();
  private sessions = new Map<string, SessionRow>();
  private audit: AuditLog[] = [];

  async ping() { return { ok: true, message: "Bellek içi depo (kalıcı değil)" }; }

  async upsertSources(rows: Source[]) { for (const r of rows) this.sources.set(r.source_id, r); }
  async listSources() { return [...this.sources.values()]; }

  async insertArticles(rows: Article[]) { for (const r of rows) this.articles.set(r.article_id, r); }
  async getArticles(ids: string[]) { return ids.map((i) => this.articles.get(i)).filter((x): x is Article => !!x); }
  async existingArticleIds(ids: string[]) { return new Set(ids.filter((i) => this.articles.has(i))); }
  async articlesSince(since: string) { return [...this.articles.values()].filter((a) => a.first_seen_at >= since); }

  async searchArticles(f: ArticleFilter) {
    const q = f.q ? matchKey(f.q) : "";
    const entityIds = f.entity ? new Set([...this.entities.values()].filter((e) => e.canonical_id === f.entity).map((e) => e.article_id)) : null;
    const novelty = f.novelty ? new Set([...this.members.values()].filter((m) => m.novelty === f.novelty).map((m) => m.article_id)) : null;
    const xs = [...this.articles.values()].filter((a) => {
      if (f.lang && a.lang_detected !== f.lang && a.lang_declared !== f.lang) return false;
      if (f.source_id && a.source_id !== f.source_id) return false;
      if (f.country && this.sources.get(a.source_id)?.country !== f.country) return false;
      if (f.from && (!a.published_at || a.published_at < f.from)) return false;
      if (f.to && (!a.published_at || a.published_at > f.to)) return false;
      if (f.undated && a.published_at) return false;
      if (entityIds && !entityIds.has(a.article_id)) return false;
      if (novelty && !novelty.has(a.article_id)) return false;
      if (q && !matchKey(a.title_original + " " + a.body_original).includes(q)) return false;
      return true;
    });
    xs.sort((a, b) => (b.published_at ?? b.first_seen_at).localeCompare(a.published_at ?? a.first_seen_at));
    return page(xs, f.limit, f.offset);
  }

  async articleStats(since: string): Promise<ArticleStats> {
    const xs = [...this.articles.values()].filter((a) => effectiveTime(a) >= since);
    const novelty = new Map([...this.members.values()].map((m) => [m.article_id, m.novelty]));
    const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
    const st: ArticleStats = { total: xs.length, byLang: {}, bySource: {}, byNovelty: {}, byDateQuality: {} };
    for (const a of xs) {
      inc(st.byLang, a.lang_detected); inc(st.bySource, a.source_id); inc(st.byDateQuality, a.date_quality);
      inc(st.byNovelty, novelty.get(a.article_id) ?? "unassigned");
    }
    return st;
  }

  async insertTranslations(rows: ArticleTranslation[]) { for (const r of rows) this.translations.set(r.article_id + "|" + r.target_lang, r); }
  async translationsFor(ids: string[]) { const s = new Set(ids); return [...this.translations.values()].filter((t) => s.has(t.article_id)); }

  async insertEntities(rows: ExtractedEntity[]) { for (const r of rows) this.entities.set(`${r.article_id}|${r.entity_type}|${r.canonical_id}|${r.surface}`, r); }
  async entitiesFor(ids: string[]) { const s = new Set(ids); return [...this.entities.values()].filter((e) => s.has(e.article_id)); }

  async upsertEvents(rows: Event[]) {
    for (const r of rows) { const cur = this.events.get(r.event_id); if (!cur || cur.version <= r.version) this.events.set(r.event_id, r); }
  }
  async getEvent(id: string) { return this.events.get(id) ?? null; }
  async listEvents(f: EventFilter) {
    let xs = [...this.events.values()].filter((e) => e.status === "active");
    if (f.since) xs = xs.filter((e) => e.last_updated_at >= f.since!);
    if (f.q) { const q = matchKey(f.q); xs = xs.filter((e) => matchKey(e.title_tr + " " + e.summary_tr).includes(q) || this.eventArticleText(e.event_id).includes(q)); }
    if (f.lang) xs = xs.filter((e) => this.eventArticles(e.event_id).some((a) => a.lang_detected === f.lang || a.lang_declared === f.lang));
    if (f.entity) {
      const ids = new Set([...this.entities.values()].filter((x) => x.canonical_id === f.entity).map((x) => x.article_id));
      xs = xs.filter((e) => this.eventArticles(e.event_id).some((a) => ids.has(a.article_id)));
    }
    xs.sort((a, b) => b.last_updated_at.localeCompare(a.last_updated_at));
    return page(xs, f.limit, f.offset);
  }
  private eventArticles(eventId: string): Article[] {
    return [...this.members.values()].filter((m) => m.event_id === eventId).map((m) => this.articles.get(m.article_id)).filter((x): x is Article => !!x);
  }
  private eventArticleText(eventId: string): string {
    return matchKey(this.eventArticles(eventId).map((a) => a.title_original).join(" "));
  }

  async insertMembers(rows: EventMember[]) { for (const r of rows) this.members.set(r.event_id + "|" + r.article_id, r); }
  async membersOf(eventIds: string[]) { const s = new Set(eventIds); return [...this.members.values()].filter((m) => s.has(m.event_id)); }
  async memberOfArticles(articleIds: string[]) { const s = new Set(articleIds); return [...this.members.values()].filter((m) => s.has(m.article_id)); }
  async insertUpdates(rows: EventUpdate[]) { for (const r of rows) this.updates.set(r.update_id, r); }
  async updatesOf(eventId: string) { return [...this.updates.values()].filter((u) => u.event_id === eventId).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async updatesSince(since: string) { return [...this.updates.values()].filter((u) => u.created_at >= since); }

  async insertClaims(claims: Claim[], sources: ClaimSource[]) {
    for (const c of claims) this.claims.set(c.claim_id, c);
    for (const s of sources) this.claimSources.set(s.claim_id + "|" + s.article_id, s);
  }
  async claimsOf(eventId: string) {
    const claims = [...this.claims.values()].filter((c) => c.event_id === eventId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ids = new Set(claims.map((c) => c.claim_id));
    return {
      claims,
      sources: [...this.claimSources.values()].filter((s) => ids.has(s.claim_id)),
      reviews: this.reviews.filter((r) => ids.has(r.claim_id)),
    };
  }
  async getClaim(id: string) { return this.claims.get(id) ?? null; }
  async insertReview(r: ClaimReview) { this.reviews.push(r); }

  async insertAnalysisRun(r: AnalysisRun) { this.analysisRuns.push(r); }
  async listAnalysisRuns(limit: number) { return [...this.analysisRuns].reverse().slice(0, limit); }
  async insertIngestionRun(r: IngestionRun) { this.ingestionRuns.push(r); }
  async listIngestionRuns(limit: number) { return [...this.ingestionRuns].reverse().slice(0, limit); }

  async upsertUser(u: User) { const cur = this.users.get(u.user_id); if (!cur || cur.version <= u.version) this.users.set(u.user_id, u); }
  async getUserByEmail(email: string) { return [...this.users.values()].find((u) => u.email === email.toLowerCase()) ?? null; }
  async getUser(id: string) { return this.users.get(id) ?? null; }
  async listUsers() { return [...this.users.values()]; }

  async insertSession(s: SessionRow) { this.sessions.set(s.token_hash, s); }
  async getSession(h: string) { return this.sessions.get(h) ?? null; }

  async insertAudit(a: AuditLog) { this.audit.push(a); }
  async listAudit(limit: number) { return [...this.audit].reverse().slice(0, limit); }
}
