// Depolama arayüzü. İki uygulama: MemoryRepo (test/demo) ve ClickHouseRepo (bağımsız SİNYAL ClickHouse'u).
// Tüm yazımlar İDEMPOTENTTİR: deterministik kimlik + "son sürüm kazanır" (ClickHouse'ta ReplacingMergeTree).

import type {
  AnalysisRun, Article, ArticleTranslation, AuditLog, Claim, ClaimReview, ClaimSource, Event, EventMember,
  EventUpdate, ExtractedEntity, IngestionRun, NoveltyLabel, Source, User,
} from "../domain/types.ts";

export interface ArticleFilter {
  q?: string;
  lang?: string;
  country?: string;
  source_id?: string;
  entity?: string; // canonical_id
  from?: string; // ISO
  to?: string;
  novelty?: NoveltyLabel;
  /** Yalnız yayın tarihi OLMAYAN haberler (tarih filtresinin dışarıda bıraktıklarını saymak için) */
  undated?: boolean;
  limit: number;
  offset: number;
}

export interface EventFilter {
  q?: string;
  lang?: string;
  entity?: string;
  since?: string;
  limit: number;
  offset: number;
}

export interface ArticleStats {
  total: number;
  byLang: Record<string, number>;
  bySource: Record<string, number>;
  byNovelty: Record<string, number>;
  byDateQuality: Record<string, number>;
}

export interface SessionRow { token_hash: string; user_id: string; expires_at: string; revoked: boolean }

export interface Repo {
  readonly kind: "memory" | "clickhouse";
  ping(): Promise<{ ok: boolean; message: string }>;

  upsertSources(rows: Source[]): Promise<void>;
  listSources(): Promise<Source[]>;

  insertArticles(rows: Article[]): Promise<void>;
  getArticles(ids: string[]): Promise<Article[]>;
  existingArticleIds(ids: string[]): Promise<Set<string>>;
  /** Olay eşleştirme penceresi için: first_seen_at >= since */
  articlesSince(since: string): Promise<Article[]>;
  searchArticles(f: ArticleFilter): Promise<{ total: number; items: Article[] }>;
  /** Pano için toplulaştırma: first_seen_at >= since olan haberler. */
  articleStats(since: string): Promise<ArticleStats>;

  insertTranslations(rows: ArticleTranslation[]): Promise<void>;
  translationsFor(ids: string[]): Promise<ArticleTranslation[]>;

  insertEntities(rows: ExtractedEntity[]): Promise<void>;
  entitiesFor(ids: string[]): Promise<ExtractedEntity[]>;

  upsertEvents(rows: Event[]): Promise<void>;
  getEvent(id: string): Promise<Event | null>;
  listEvents(f: EventFilter): Promise<{ total: number; items: Event[] }>;
  insertMembers(rows: EventMember[]): Promise<void>;
  membersOf(eventIds: string[]): Promise<EventMember[]>;
  memberOfArticles(articleIds: string[]): Promise<EventMember[]>;
  insertUpdates(rows: EventUpdate[]): Promise<void>;
  updatesOf(eventId: string): Promise<EventUpdate[]>;
  updatesSince(since: string): Promise<EventUpdate[]>;

  insertClaims(claims: Claim[], sources: ClaimSource[]): Promise<void>;
  claimsOf(eventId: string): Promise<{ claims: Claim[]; sources: ClaimSource[]; reviews: ClaimReview[] }>;
  getClaim(claimId: string): Promise<Claim | null>;
  insertReview(r: ClaimReview): Promise<void>;

  insertAnalysisRun(r: AnalysisRun): Promise<void>;
  listAnalysisRuns(limit: number): Promise<AnalysisRun[]>;
  insertIngestionRun(r: IngestionRun): Promise<void>;
  listIngestionRuns(limit: number): Promise<IngestionRun[]>;

  upsertUser(u: User): Promise<void>;
  getUserByEmail(email: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;

  insertSession(s: SessionRow): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRow | null>;

  insertAudit(a: AuditLog): Promise<void>;
  listAudit(limit: number): Promise<AuditLog[]>;
}
