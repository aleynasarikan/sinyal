# SİNYAL Mimarisi (MVP)

## Bileşenler

```
DataProvider (mock | umi_api)        LlmProvider (mock | openai-uyumlu)
        │ salt okuma                         │
        ▼                                    ▼
pipeline/ingest ──► entities (gazetteer) ──► match (olay) ──► novelty      llm/analyze ──► claims/verify
        │                                                                       │
        └──────────────────────────► Repo (memory | clickhouse) ◄──────────────┘
                                              ▲
                                     api/server (REST, rol denetimi) ◄── web (TS, Bun.build)
```

| Dizin | Sorumluluk |
|---|---|
| `src/providers` | Veri adaptörleri. `MockDataProvider` (demo), `UmiApiProvider` (yer tutucu; sözleşme doğrulanmadan istek atmaz) |
| `src/text` | NFC/NFKC, Türkçe büyük-küçük harf, Arapça/Farsça muhafazakâr katlama, rakam katlama, dil tespiti, Latin harf yardımcı anahtarı |
| `src/pipeline` | Alım, varlık çıkarımı, olay eşleştirme, yenilik sınıflandırması |
| `src/llm` | Sağlayıcı arayüzü, istem, şema doğrulama, sınırlı yeniden deneme |
| `src/claims` | İddia–kaynak denetimi, kaynaklar arası sayısal farklılık |
| `src/store` | Repo arayüzü, bellek ve ClickHouse uygulamaları, migration |
| `src/auth` | Argon2id parolalar, HttpOnly oturum, roller, hız sınırı |
| `src/api` | REST uçları, güvenlik başlıkları, CSRF (Origin) denetimi |
| `src/web` | Arayüz (bağımsız TS; framework/CDN yok) |
| `src/eval` | B-cubed vb. değerlendirme |

## Veri modeli ve ClickHouse kararları

Spesifikasyondaki 13 kavramın tamamı ayrı tablodur (`migrations/001_init.sql`). Gerekçeli değişiklikler:

- **+ `claim_reviews`**: analist incelemesi `claims` satırını güncellemez; yalnız-ekleme tablosudur.
  ClickHouse'ta satır güncellemesi mutasyon gerektirir (UMİ'de kesintiye yol açmış). Geçmiş korunur, son kayıt geçerlidir.
- **+ `sessions`**: oturum jetonunun sha256'sı; iptal = `revoked=true` yeni sürüm satırı.
- **+ `schema_migrations`**: uygulanan migration sürümleri.
- **`users` ayrı**: denetim kayıtları kullanıcı kimliğiyle ilişkilenir.
- **Kaynak ↔ türetilmiş ayrımı**: `articles` yalnız kaynaktan gelen veriyi tutar (özgün başlık/metin/URL/dil/tarih).
  Türetilmiş her satır (`extracted_entities`, `event_members`, `event_updates`, `claims`, `article_translations`)
  `origin_json` taşır: `rule` (sürümüyle), `llm` (sağlayıcı, model, **mock bayrağı**) veya `analyst`.
- **İdempotency**: `article_id = sha256(sağlayıcı | kanonik URL)`; `event_id = sha256(olayı başlatan haber)`;
  `update_id = sha256(olay|haber)`. ReplacingMergeTree + `FINAL` okuma. Yeniden alımda içerik hash'i aynıysa atlanır;
  `first_seen_at` korunur (bölüm anahtarı da budur, dolayısıyla tekilleştirme aynı bölümde gerçekleşir).
- **Arama**: uygulama, dil duyarlı katlanmış `search_key` üretir; ClickHouse'ta `ngrambf_v1` atlama indeksi + `positionUTF8`.
  Özgün metin değişmez.
- **Otomatik silme yok**: TTL tanımlanmadı (veri saklama politikası kurumca doğrulanmadı).

## Çok dilli eşleştirme (baseline, embedding'siz)

1. **Varlık/kavram çıkarımı** (`entities.ts`): çok dilli takma ad sözlüğü (gazetteer) → kanonik kimlik
   (`place:norvik` ← Norvik / Норвике / نورفيك / نورویک). Arapça ön ekler (و/ب/ل/ف/ك + ال) ve kaba önek morfolojisi
   (Norvik'te, depreminde, Erdbebengebiet) desteklenir. Özgün yüzey biçimi saklanır.
2. **Skor** (`match.ts`): kavram (0.30), yer (0.25), kişi/kurum (0.25), sayı (0.10), aynı dilde başlık benzerliği (0.10).
   Bilgi olmayan bileşenin ağırlığı dağıtılır.
3. **Sert kurallar** (yanlış birleştirmeyi önler): ortak kavramı olmayan iki olay türü (deprem ≠ yangın) birleşmez;
   96 saatten uzak olaylar birleşmez; **sayı dışında** en az iki bağımsız sinyal (konu, yer, kişi/kurum, başlık ≥0.3) gerekir —
   ortak sayı skoru destekler ama tek başına kanıt sayılmaz. Taraflardan birinde konu bilgisi yoksa olay türü denetlenemez:
   ortak kişi/kurum şartı aranır ve eşleşme `uncertain` işaretlenir (denetim 2026-10-28, bulgu 1).
4. **Belirsizlik**: skor 0.45–0.60 veya güvenilir tarih yoksa üyelik `uncertain` işaretlenir. Her üyelik gerekçe kaydeder.

**Sınırlar:** Sözlük dışı varlıklar diller arası köprü kuramaz. Gerçek veride sözlük, analist onaylı varlık listesi
ve/veya LLM çıkarımı + analist doğrulaması ile beslenmelidir. Embedding adaptörü, model ve uç nokta doğrulandıktan sonra
ek bir sinyal olarak eklenebilir; ağırlıklar altın setle ayarlanmalıdır. UMİ `cluster_id` erişime izin verilirse yalnız
**aday sinyal** olarak eklenebilir; olay kimliği asla olmaz.

## Yeni gelişme sınıflandırması

Yeni olgu olarak sayılan sayılar `extractFactNumbers` ile çıkarılır: saat (10:45, saat 10.45) ve tarih (28.10.2026,
28 Ekim, October 28 vb. 7 dilde ay adları) sayıları olgu sayılmaz; yüzdeler yazım biçiminden bağımsız `N%` olarak
normalize edilir (bulgu 3). Kaynak metni ise **aynen** saklanır (NFC/NFD, RLM/LRM, ZWNJ korunur); eşleştirme ve arama
yalnız `matchKey` anahtarıyla yapılır (bulgu 7).

Sırayla: (1) aynı dilde neredeyse aynı başlık+metin → **tekrar** (yeniden yayın); (2) olaya göre yeni sayı/varlık/yer
hesaplanır; (3) tarih yok/tahmini/geçersiz/gelecekte ya da kaynak kayıtsız → **tarih/kaynak belirsiz** (yeni olay veya gelişme
kararının tek dayanağı yapılmaz); (4) yeni bilgi yok → **tekrar**; (5) yeni bilgi + iddia/teyitsizlik ifadesi
(7 dilde sözlük) → **doğrulanmamış iddia**; (6) olaydaki ilk haberden eski tarihli → **tekrar** (geç gelen eski haber);
(7) aksi halde **anlamlı gelişme**. Eşleşme yoksa: belirsiz tarih/kaynak → belirsiz; iddia ifadesi → doğrulanmamış iddia; aksi → **yeni olay**.
Karar haber sayısına dayanmaz.

## Kanıt modeli

- Model çıktısı şemaya göre katı doğrulanır (`llm/prompt.ts`), sonra her iddia **ayrıca** denetlenir (`claims/verify.ts`):
  kaynak kimliği olayda mı, alıntı kaynak metinde birebir (katlamalı) geçiyor mu, iddiadaki sayılar alıntılarda var mı,
  iddiadaki kişi/kurum/yerler kaynak haberlerde çıkarılmış mı, sözlük dışı ad benzeri ifadeler kaynakta geçiyor mu.
- Durumlar: `supported` (UI: "Kaynakta dayanağı bulundu"), `partially_supported`, `contradicted`, `unverified`, `no_source`.
  Bu **sözcüksel** bir denetimdir; anlamsal doğruluğu kanıtlamaz, skor üretmez.
- Ad/unvan denetimi sözcük düzeyindedir: iddiadaki bilinen varlık sözcükleri çıkarıldıktan sonra kalan büyük harfli her
  parça (ör. "Kestriya **Bakanı Mehmet Uydurma**") kaynak metinde ayrıca aranır (bulgu 2). Diller arası unvanlar
  sözcüksel olarak doğrulanamadığı için bu kural temkinlidir; "doğrulanamadı" sonucu analist incelemesi gerektirir.
- Mock sağlayıcının iddiaları kaynak cümlesini kopyaladığı için denetimi her zaman geçer; bu iddialar "MOCK — denetim anlamlı
  değil" olarak gösterilir, `claims_supported` sayısına katılmaz.
- Kaynaklar arası sayısal farklılık (`claims/conflicts.ts`): can kaybı gibi slotlarda farklı değerler gizlenmez;
  ≤4 saat arayla farklı değer → "çelişki", daha uzun aralık → "zaman içinde değişim".
- Analist incelemesi (onay/düzeltme/red/not) yalnız-ekleme olarak saklanır ve denetim kaydına yazılır.

## Güven puanları hakkında

`lang_confidence` ve `match_score` **sezgiseldir, kalibre edilmemiştir**. Arayüzde doğrulanmış gerçek gibi sunulmaz;
düşük dil güveni "?" ile işaretlenir. İddialar için sayısal güvenilirlik puanı üretilmez.
