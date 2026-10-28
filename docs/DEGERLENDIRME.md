# Değerlendirme

## Durum

**Gerçek kalite metrikleri henüz ölçülmedi.** Analist etiketli altın set yok.
`bun run eval --synthetic` 21 haberlik sentetik demo setinde 1.0 skorlar verir; bu beklenen bir sonuçtur çünkü
veri ve beklentiler aynı geliştirici tarafından yazılmıştır. Bu sayı **sistemin gerçek performansı hakkında bilgi vermez**;
yalnız ölçüm hattının uçtan uca çalıştığını gösterir.

## Metrikler (`src/eval/metrics.ts`, testli)

| Metrik | Tanım |
|---|---|
| B-cubed P/R/F1 | Her haber için sistem kümesi ile altın küme kesişiminin oranları (Bagga & Baldwin) |
| Diller arası recall | Altında aynı olaydaki farklı dilli haber çiftlerinden sistemde de birlikte olanların oranı |
| Yanlış birleştirme oranı | Sistemin birlikte kümelediği çiftlerden altında farklı olaya ait olanların oranı |
| Yenilik P/R | 5 sınıfın her biri için precision/recall/F1 |
| İddia destek doğruluğu | Sistem "dayanaklı" kararının analist kararıyla örtüşmesi + yanlış "dayanaklı" sayısı (en riskli hata) |
| Ad sadakati | Altındaki kişi adlarının özgün yazımla birebir bulunma oranı + uydurma ad sayısı |
| Gecikme | Haber başına işleme süresi p50/p95 |

## Gereken insan girdileri (300–500 haber)

1. **Örneklem**: 7 dilin her birinden en az ~40 haber; aynı zaman penceresinde; özellikle (a) aynı yerde farklı olaylar,
   (b) aynı kişilerin geçtiği farklı olaylar, (c) yeniden yayınlar, (d) tarihi eksik/hatalı haberler.
2. **Olay etiketi** (`gold_event`): en az iki analist, bağımsız; anlaşmazlıklar üçüncü analistle çözülür;
   analistler arası uyum (ör. B-cubed F1 analist-analist) raporlanır.
3. **Yenilik etiketi** (`gold_novelty`) — beş sınıf için yazılı yönerge (özellikle "anlamlı gelişme" tanımı).
4. **Kişi adları** (`gold_names`): kaynakta geçtiği özgün yazımla.
5. **İddia hükümleri**: model analizinden örneklenen 100+ iddia için "kaynak bu iddiayı destekliyor mu" (evet/hayır).
6. **Varlık sözlüğü**: değerlendirme dönemindeki önemli kişi/kurum/yerlerin 7 dildeki yazımları (analist onaylı).
7. Altın set dosyaları `eval/gold/` altında tutulur ve Git'e eklenmez.

Eşik ve ağırlıklar (`src/pipeline/match.ts` → `THRESHOLDS`, `WEIGHTS`) altın setin ayrı bir geliştirme bölümüyle ayarlanmalı,
son ölçüm ayrılmış test bölümünde yapılmalıdır.
