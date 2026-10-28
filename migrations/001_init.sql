-- SİNYAL şema v1 — ClickHouse 24.8.
-- Tasarım ilkeleri:
--  * Güncelleme/silme mutasyonu (ALTER ... UPDATE/DELETE) KULLANILMAZ. Durum değişikliği = yeni sürüm satırı.
--  * İdempotency: deterministik birincil anahtar + ReplacingMergeTree(sürüm). Okumalarda FINAL.
--  * ReplacingMergeTree tekilleştirmesi bölüm (partition) içinde çalışır; bu yüzden bölüm anahtarı
--    satırın ömrü boyunca DEĞİŞMEYEN bir alandan (ör. first_seen_at) seçilir.
--  * Kaynak verisi (articles) ile türetilmiş veri (entities, events, claims, analysis_runs) ayrı tablolardadır;
--    türetilmiş her satır origin_json ile kim/ne tarafından üretildiğini taşır.
--  * Otomatik silme (TTL) YOK: veri saklama politikası kurumca doğrulanmadı.

CREATE TABLE IF NOT EXISTS sources (
  source_id String,
  name String,
  domain String,
  country LowCardinality(String),
  default_lang LowCardinality(String),
  provider LowCardinality(String),
  created_at DateTime64(3, 'UTC'),
  updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY source_id;

CREATE TABLE IF NOT EXISTS articles (
  article_id String,
  source_id LowCardinality(String),
  provider LowCardinality(String),
  external_id String,
  url String,
  canonical_url String,
  title_original String,
  body_original String,
  lang_declared LowCardinality(String),
  lang_detected LowCardinality(String),
  lang_confidence Float64,
  published_at Nullable(DateTime64(3, 'UTC')),
  date_quality LowCardinality(String),
  fetched_at DateTime64(3, 'UTC'),
  first_seen_at DateTime64(3, 'UTC'),
  content_hash String,
  ingestion_run_id String,
  -- Uygulamanın ürettiği dil-duyarlı arama anahtarı (Unicode/Arapça-Farsça katlamalı). Özgün metin değişmez.
  search_key String,
  updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
  INDEX idx_search search_key TYPE ngrambf_v1(3, 65536, 2, 0) GRANULARITY 4,
  INDEX idx_source source_id TYPE set(1000) GRANULARITY 4
) ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(first_seen_at)
ORDER BY article_id;

CREATE TABLE IF NOT EXISTS article_translations (
  article_id String,
  target_lang LowCardinality(String),
  title String,
  summary String,
  origin_json String,
  created_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(created_at)
ORDER BY (article_id, target_lang);

CREATE TABLE IF NOT EXISTS extracted_entities (
  article_id String,
  entity_type LowCardinality(String),
  surface String,
  canonical_id String,
  canonical_label String,
  latin_key String,
  confidence Float64,
  origin_json String,
  updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
  INDEX idx_canonical canonical_id TYPE bloom_filter(0.01) GRANULARITY 4
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (article_id, entity_type, canonical_id, surface);

CREATE TABLE IF NOT EXISTS events (
  event_id String,
  title_tr String,
  summary_tr String,
  first_seen_at DateTime64(3, 'UTC'),
  last_updated_at DateTime64(3, 'UTC'),
  status LowCardinality(String),
  origin_json String,
  version UInt32,
  search_key String
) ENGINE = ReplacingMergeTree(version)
ORDER BY event_id;

CREATE TABLE IF NOT EXISTS event_members (
  event_id String,
  article_id String,
  match_score Float64,
  match_status LowCardinality(String),
  reason_json String,
  novelty LowCardinality(String),
  added_at DateTime64(3, 'UTC'),
  origin_json String,
  INDEX idx_article article_id TYPE bloom_filter(0.01) GRANULARITY 4
) ENGINE = ReplacingMergeTree(added_at)
ORDER BY (event_id, article_id);

CREATE TABLE IF NOT EXISTS event_updates (
  update_id String,
  event_id String,
  article_id String,
  label LowCardinality(String),
  summary_tr String,
  new_facts Array(String),
  created_at DateTime64(3, 'UTC'),
  origin_json String
) ENGINE = ReplacingMergeTree(created_at)
ORDER BY (event_id, update_id);

CREATE TABLE IF NOT EXISTS claims (
  claim_id String,
  event_id String,
  text_tr String,
  status LowCardinality(String),
  check_notes Array(String),
  origin_json String,
  analysis_run_id String,
  created_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(created_at)
ORDER BY (event_id, claim_id);

CREATE TABLE IF NOT EXISTS claim_sources (
  claim_id String,
  article_id String,
  quote String,
  support LowCardinality(String),
  notes Array(String),
  updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (claim_id, article_id);

-- Analist incelemeleri: yalnız ekleme (geçmiş korunur, son kayıt geçerli durumdur).
CREATE TABLE IF NOT EXISTS claim_reviews (
  review_id String,
  claim_id String,
  reviewer_id String,
  status LowCardinality(String),
  corrected_text String,
  note String,
  created_at DateTime64(3, 'UTC')
) ENGINE = MergeTree
ORDER BY (claim_id, created_at);

CREATE TABLE IF NOT EXISTS analysis_runs (
  run_id String,
  event_id String,
  kind LowCardinality(String),
  provider LowCardinality(String),
  model LowCardinality(String),
  mock Bool,
  status LowCardinality(String),
  error String,
  latency_ms UInt32,
  attempts UInt8,
  claims_total UInt16,
  claims_supported UInt16,
  title_tr String,
  summary_tr String,
  started_at DateTime64(3, 'UTC'),
  requested_by String
) ENGINE = MergeTree
PARTITION BY toYYYYMM(started_at)
ORDER BY (started_at, run_id);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  run_id String,
  provider LowCardinality(String),
  started_at DateTime64(3, 'UTC'),
  finished_at DateTime64(3, 'UTC'),
  status LowCardinality(String),
  fetched UInt32,
  inserted UInt32,
  skipped_duplicates UInt32,
  errors UInt32,
  message String
) ENGINE = MergeTree
ORDER BY (started_at, run_id);

CREATE TABLE IF NOT EXISTS users (
  user_id String,
  email String,
  name String,
  role LowCardinality(String),
  password_hash String,
  disabled Bool,
  created_at DateTime64(3, 'UTC'),
  version UInt32
) ENGINE = ReplacingMergeTree(version)
ORDER BY user_id;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash String,
  user_id String,
  expires_at DateTime64(3, 'UTC'),
  revoked Bool,
  updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY token_hash;

CREATE TABLE IF NOT EXISTS audit_logs (
  ts DateTime64(3, 'UTC'),
  user_id String,
  action LowCardinality(String),
  target String,
  ip String,
  detail String,
  ok Bool
) ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (ts, user_id);
