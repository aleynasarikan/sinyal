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
| `src/spread` | Yayılım: olası aktarım zinciri, yol boyunca mutasyonlar, R ve ivme (salt okuma, model yok) |
| `src/store` | Repo arayüzü, bellek ve ClickHouse uygulamaları, migration |
| `src/auth` | Argon2id parolalar, HttpOnly oturum, roller, hız sınırı |
| `src/api` | REST uçları, güvenlik başlıkları, CSRF (Origin) denetimi |
| `src/web` | Arayüz (bağımsız TS; framework/CDN yok). Atlas: maplibre-gl, ayrı parça olarak aynı kökenden |
| `data/geo` | Atlas ülke sınırları + çizim noktaları (Natural Earth, kamu malı; `scripts/build_geo.ts` üretir) |
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

## Yayılım (`src/spread`, `yayilim-v1`)

Diğer katmanlar "ne oldu, söylenen kaynakta var mı?" sorusunu yanıtlar; Yayılım "bilgi kimden kime geçti, yolda nasıl
değişti, yayılma hızlanıyor mu?" sorusunu. Deterministiktir, model çağırmaz, yeni tablo yazmaz (olay üyeleri, haberler ve
varlıklardan istek anında hesaplanır).

1. **Yerleştirme**: yalnız `date_quality = exact` olan haberler zincire girer; diğerleri "zincire yerleştirilmedi" diye listelenir.
2. **Olası kaynak**: her haber için kendisinden önce yayımlanmış (≤96 sa) adaylar puanlanır —
   atıf (metin adayın yayıncı adını anıyor, +0.50), kopya (aynı dilde başlık ve gövde ≥0.8, +0.60),
   ortak olgu (kanonik varlık + olgu sayısı Jaccard ×0.30), aynı dilde gövde benzerliği (×0.20). Eşik 0.20.
   Yalnız ortak olguya dayanan kenar "zayıf bağ"dır; Jaccard < 0.5 ise kurulmaz ve eşitlikte olguyu **ilk** getiren
   aday seçilir (aksi halde ajans haberleri sahte derin zincir oluşturur). Kaynağı bulunamayan haber bağımsız giriştir (kök).
3. **Mutasyon** (kenar boyunca): teyitsizlik ifadesinin düşmesi (yüksek) / eklenmesi (düşük); tek sayının değişmesi
   (oran ≥2 veya ≤0.5 ise yüksek, aksi orta); kaynakta olmayan sayı eklenmesi (orta); sayının aktarılmaması (düşük).
   Zayıf bağda aktarım kanıtlanmadığı için teyitsizlik değişimi mutasyon sayılmaz, sayı farkları düşük önemle gösterilir.
4. **Ölçüler**: nesil derinliği; R = yayın başına ortalama aktarım (son 3 saatte yayımlananlar sağdan sansür nedeniyle
   dışlanır); erişim eğrisi (birikimli haber/dil/ülke); ivme = son 6 sa ile önceki 6 sa karşılaştırması
   ("hızlanıyor" için en az 3 haber).

**Sınırlar**: "İlk görülen" SİNYAL'in gördüğü en erken haberdir, gerçek köken izlenmeyen bir yayın olabilir. Atıf tespiti
yayıncı adının metinde geçmesine dayanır; takma ad/kısaltma ("AFP" ↔ "Agence France-Presse") için yayıncı takma ad
listesi gerekir. Bağlar ve R sezgiseldir, altın setle (analist işaretli gerçek aktarım zincirleri) ayarlanmalıdır.

API: `GET /api/events/:id/spread` (olay ayrıntısı), `GET /api/spread?window=24|72` (Yayılım Radarı: yüksek önemli
mutasyonu olan, sonra hızlanan olaylar önce).

## Yayılım Atlası (`src/spread/atlas.ts`, `src/web/atlas.ts`)

Yayılımı ülke düzeyine indirger: genel görünümde ülke dolgusu (penceredeki haber yoğunluğu), olayların ilk görüldüğü ülkeler
ve tüm olayların ülkeler arası bağlantıları; bir olay seçilince bağlantılar zaman kaydırıcısıyla oynatılır (mutasyonlu aktarım
kırmızı). Yan paneldeki adım listesi haritanın metin karşılığıdır. `GET /api/atlas?window=24|72` koordinat ve tam metin
taşımaz; ülke kodu → nokta eşlemesi istemcidedir. Yayıncı ülkesi bilinmeyen haber haritaya konmaz (`unmapped`).

**Dış istek yok.** maplibre-gl npm paketinden derlenir (CDN değil) ve yalnız Atlas açılınca ayrı parça olarak yüklenir; worker
`/maplibre-gl-worker.mjs` olarak aynı kökenden gelir (CSP `script-src 'self'` değişmedi; blob/eval gerekmez). Harita karosu,
stil ve font sunucusu kullanılmaz: zemin, depoya işlenmiş ülke sınırlarıdır (1:110m, ~165 KB); etiketler maplibre yazı
katmanı yerine HTML işaretçileridir (glyph sunucusu gerekmez). Kaybedilen: sokak/şehir/arazi ayrıntısı.

**Coğrafi veri notları:** 180° hattını geçen poligonlar (Rusya, Fiji) bölünür; Antarktika çıkarılmıştır. Sınırlar Natural
Earth'ün fiili sınırlarıdır; tartışmalı bölgelerin (ör. Kıbrıs — kaynakta "N. Cyprus" ayrı ve ISO kodsuz) gösterimi
**kurumsal karar** gerektirir ve henüz verilmemiştir. Kosova için kullanıcı-atamalı `XK` kodu kullanılır.

## Sade arayüz ve rapor (`src/web/plain.ts`, `#/atlas`, `#/rapor`)

**Menü:** herkes için Özet, Olaylar, Yayılım, Haber Ara. Rol bazlı "Yönetim" grubu: İddia Denetimi (analist, yönetici),
Sistem Durumu ve Kullanıcılar (yalnız yönetici). Gizleme yalnız arayüz düzeyindedir; yetki API'de ayrıca denetlenir.
Teknik bilgiler (eşleşme skoru, sınıf, tarih kalitesi, dil güveni, olay kimliği, özgün yazımlar) olay sayfasında yalnız
analist/yöneticiye görünen "Teknik ayrıntılar" bölümündedir. Özet sayfası teknik sayaçlar yerine dört anlaşılır sayı ve
"Dikkat gerektirenler" listesi gösterir; arama sayfaları tek kutu + "Daha fazla filtre" düzenindedir. Eski Radar bağlantısı
Yayılım sayfasına yönlenir. Teknik olmayan okur için: ülke kodları
yerine Türkçe ülke adları (`data/geo/country_names_tr.json`), durum için tek etiket ("Hızla yayılıyor", "Durdu"), değişiklikler
için düz cümle ("Rakam değişti: 40 → 400"). R, nesil, atıf/kopya gibi terimler ekranda gösterilmez; olay sayfasında
"Teknik ayrıntılar (analist için)" altında katlıdır. Yalnız ortak bilgilere dayanan bağlantı "Olası bağlantı" diye işaretlenir.
Küçük farklar (sayının aktarılmaması, ihtiyat ifadesi eklenmesi) okura gösterilmez. Türkçe ek uyumu hatalarından kaçınmak için
cümle yerine "etiket: değer" biçimi kullanılır.

**Rapor**: `#/rapor` (Durum Raporu: pencere geneli; Özet ve Yayılım sayfalarından) veya `#/rapor?olay=ID` (tek olay). Özet sayılar, ana bulgular, genel harita, olay başına
bilgi tablosu + harita + "Nasıl yayıldı?" tablosu ve "Bu rapor nasıl okunur?" bölümü. Harita görüntüleri ekran dışı bir
maplibre haritasında açık temayla çizilip PNG olarak alınır (noktalar/etiketler 2B tuvale çizilir). **PDF**: "PDF olarak indir"
tarayıcının yazdırma penceresini açar (Hedef: PDF olarak kaydet); A4 yazdırma stili, her olay yeni sayfada, dosya adı
`SINYAL-Yayilim-Raporu-YYYY-AA-GG`. Sunucuda PDF üretilmez: Arapça/Farsça şekillendirme ve Türkçe karakterler için yazı tipi
gömme ek bağımlılık ister; tarayıcı bunları zaten doğru çizer.

## Güven puanları hakkında

`lang_confidence` ve `match_score` **sezgiseldir, kalibre edilmemiştir**. Arayüzde doğrulanmış gerçek gibi sunulmaz;
düşük dil güveni "?" ile işaretlenir. İddialar için sayısal güvenilirlik puanı üretilmez.
