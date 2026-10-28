// SİNYAL alan modelleri. Kaynak (haber) verisi ile model/kural tarafından ÜRETİLEN veri ayrı tiplerdir.

export const LANGS = ["tr", "en", "ar", "ru", "fr", "de", "fa"] as const;
export type Lang = (typeof LANGS)[number];
export const RTL_LANGS: ReadonlySet<string> = new Set(["ar", "fa"]);

/** Bir kaydı kim/ne üretti — kaynak verisi ile türetilmiş veriyi ayırmak için her kayıtta taşınır. */
export type Origin =
  | { kind: "source"; provider: string } // dış kaynaktan alınan ham veri
  | { kind: "rule"; version: string } // deterministik kural
  | { kind: "llm"; provider: string; model: string; mock: boolean }
  | { kind: "analyst"; userId: string };

export interface Source {
  source_id: string;
  name: string;
  domain: string;
  country: string; // ISO-3166 alpha-2, bilinmiyorsa ""
  default_lang: string;
  provider: string;
  created_at: string;
}

export type DateQuality = "exact" | "estimated" | "missing" | "invalid" | "future";

export interface Article {
  article_id: string; // sha256(provider|canonical_url) — idempotent
  source_id: string;
  provider: string; // "mock" | "umi_api"
  external_id: string; // sağlayıcıdaki kimlik (UMİ id vb.) — SİNYAL kimliği DEĞİL
  url: string; // özgün URL
  canonical_url: string;
  title_original: string; // asla değiştirilmez
  body_original: string;
  lang_declared: string; // sağlayıcının bildirdiği dil
  lang_detected: string;
  lang_confidence: number;
  published_at: string | null; // ISO; yoksa null
  date_quality: DateQuality;
  fetched_at: string;
  first_seen_at: string; // SİNYAL'in haberi ilk gördüğü an
  content_hash: string;
  ingestion_run_id: string;
}

export interface ArticleTranslation {
  article_id: string;
  target_lang: "tr";
  title: string;
  summary: string;
  origin: Origin;
  created_at: string;
}

export type EntityType = "person" | "org" | "place" | "keyword";

export interface ExtractedEntity {
  article_id: string;
  entity_type: EntityType;
  surface: string; // metindeki özgün biçim — korunur
  canonical_id: string; // gazetteer kimliği; bilinmiyorsa "" (eşleşmede kullanılmaz)
  canonical_label: string; // Türkçe görünen ad
  latin_key: string; // yalnız yardımcı eşleştirme sinyali
  confidence: number;
  origin: Origin;
}

export type MatchStatus = "confident" | "uncertain" | "analyst_confirmed" | "analyst_rejected";

export interface Event {
  event_id: string;
  title_tr: string;
  summary_tr: string;
  first_seen_at: string;
  last_updated_at: string;
  status: "active" | "merged";
  origin: Origin;
  version: number;
}

export interface MatchReason {
  shared_entities: string[];
  shared_places: string[];
  shared_numbers: string[];
  title_similarity: number;
  hours_apart: number | null;
  score: number;
  notes: string[];
}

export interface EventMember {
  event_id: string;
  article_id: string;
  match_score: number;
  match_status: MatchStatus;
  reason: MatchReason;
  novelty: NoveltyLabel;
  added_at: string;
  origin: Origin;
}

export type NoveltyLabel =
  | "new_event"
  | "significant_update"
  | "duplicate"
  | "unverified_claim"
  | "uncertain_date_or_source";

export interface NoveltyDecision {
  label: NoveltyLabel;
  reasons: string[];
  new_facts: string[]; // olaya ilk kez eklenen varlık/sayılar
}

export interface EventUpdate {
  update_id: string; // sha256(event_id|article_id) — idempotent
  event_id: string;
  article_id: string;
  label: NoveltyLabel;
  summary_tr: string;
  new_facts: string[];
  created_at: string;
  origin: Origin;
}

export type SupportStatus = "supported" | "not_found" | "contradicted" | "unverifiable";
export type ClaimStatus = "supported" | "partially_supported" | "contradicted" | "unverified" | "no_source";
export type ReviewStatus = "pending" | "approved" | "corrected" | "rejected";

export interface Claim {
  claim_id: string;
  event_id: string;
  text_tr: string;
  status: ClaimStatus; // otomatik denetim sonucu
  check_notes: string[];
  origin: Origin;
  analysis_run_id: string;
  created_at: string;
}

export interface ClaimSource {
  claim_id: string;
  article_id: string;
  quote: string; // destekleyici metin parçası (özgün dilde)
  support: SupportStatus;
  notes: string[];
}

export interface ClaimReview {
  review_id: string;
  claim_id: string;
  reviewer_id: string;
  status: ReviewStatus;
  corrected_text: string;
  note: string;
  created_at: string;
}

export interface AnalysisRun {
  run_id: string;
  event_id: string;
  kind: "event_summary";
  provider: string;
  model: string;
  mock: boolean;
  status: "ok" | "error";
  error: string;
  latency_ms: number;
  attempts: number;
  claims_total: number;
  claims_supported: number;
  /** Model çıktısı (mock ise "[MOCK]" önekli). Kaynak verisi DEĞİLDİR. */
  title_tr: string;
  summary_tr: string;
  started_at: string;
  requested_by: string;
}

export interface IngestionRun {
  run_id: string;
  provider: string;
  started_at: string;
  finished_at: string;
  status: "ok" | "error" | "not_configured";
  fetched: number;
  inserted: number;
  skipped_duplicates: number;
  errors: number;
  message: string;
}

export type Role = "admin" | "analyst" | "viewer";

export interface User {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  disabled: boolean;
  created_at: string;
  version: number;
}

export interface AuditLog {
  ts: string;
  user_id: string;
  action: string;
  target: string;
  ip: string;
  detail: string; // JSON; hassas veri İÇERMEZ
  ok: boolean;
}
