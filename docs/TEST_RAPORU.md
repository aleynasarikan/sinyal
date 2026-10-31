# Test Raporu — 2026-10-28

## Güncelleme 2: ortam kurulumu, Compose ve arayüz doğrulaması (2026-10-31)

Ortam: Bun 1.4.4 (Homebrew), Docker 29.5.2 + Compose 5.6.1 (Colima).

| Kontrol | Sonuç |
|---|---|
| `bun run check` | **110 geçti, 0 başarısız**. Pano testi tarihe bağlıydı (demo veri 28.10'a sabit, uç nokta `Date.now()`); `createApp`'e `clock` eklendi, testte sabitlendi |
| `docker compose up -d --build` | ClickHouse 24.8 sağlıklı, migration uygulandı, 21 demo haber yazıldı, nginx 200 |
| nginx üzerinden API (ClickHouse deposu) | giriş, pano, 4 olay, olay detayı (10 haber / 1 çelişki / 3 iddia), Arapça arama, novelty filtresi, mock analiz, yeniden alım (0 yeni / 21 atlandı), CSRF 403, güvenlik başlıkları — bellek kipiyle aynı sonuçlar |
| Arayüz (Chrome, masaüstü) | Giriş, panel, olay haritası, haber arama (RTL dahil), kanıt laboratuvarı, olay detayı kontrol edildi |

Arayüzde düzeltilenler: kaynak dağılımı çubuklarının uzun etiketlerle ezilmesi; haber meta satırında
"RUYayın:" bitişik yazımı; kenar çubuğunda ad ve rolün ("Yönetici") iki kez görünmesi.

Hâlâ doğrulanmayan: dar ekran / mobil görünüm, gerçek LLM uç noktası, gerçek UMİ API'si, gerçek kalite metrikleri.

## Güncelleme: denetim düzeltmeleri (başlangıç commit'i `c97a1e8` üzerine)

| Komut | Sonuç |
|---|---|
| `bunx tsc --noEmit` | Hatasız |
| `bun test` | **110 geçti, 0 başarısız** (önceki 91 + 19 yeni regresyon testi; `tests/regressions.test.ts`) |
| UI paketi (`Bun.build`) | Derleniyor; yeni metinler pakette mevcut. Tarayıcıda görsel doğrulama **yapılmadı** |

Regresyon testleri düzeltmelerden önce yazıldı ve çalıştırıldı: 19 testin 13'ü başarısızdı; 6'sı mevcut davranışı
koruma (bozmama) testleridir ve baştan geçiyordu. Bir eski test (`normalize.test.ts`, yön karakterlerinin silinmesini
bekleyen) hatalı davranışı kodladığı için yeni davranışa göre güncellendi.

---

# İlk sürüm raporu

## Ortam
- macOS (arm64). Sistemde **Bun, Docker ve ClickHouse kurulu değil**.
- Bun 1.2.23 yalnız oturumun geçici çalışma alanına npm ile kuruldu (sistem/kabuk profili değiştirilmedi).
- ClickHouse 24.8 ikili dosyasının indirilmesi bu oturumda izin verilmediği için yapılmadı.

## Çalıştırılan komutlar ve sonuçlar

| Komut | Sonuç |
|---|---|
| `bunx tsc --noEmit` | Hatasız |
| `bun test` | **91 geçti, 0 başarısız** (8 dosya, 297 doğrulama) |
| `bun run eval --synthetic` | Hat çalışıyor; sentetik skorlar 1.0 (kalite ölçümü DEĞİL — bkz. DEGERLENDIRME.md) |
| `bun run start` (bellek deposu, mock) + HTTP uçtan uca | giriş 200; pano (demo=true); 4 olay; mock analiz 3 iddia/3 dayanaklı; çelişki tespiti 12/19/21; yeniden alım 0 yeni/21 atlandı; `app.js` derleniyor ve sözdizimi geçerli |
| `git status` (~/umi) | İnceleme öncesiyle aynı; UMİ'de değişiklik yok |

## Test kapsamı (istenen başlıklar)

| Başlık | Dosya |
|---|---|
| Dil normalizasyonu (Türkçe I/İ, Arapça/Farsça katlama, ayrık harflerin korunması, ZWNJ, doğu rakamları), 7 dil tespiti | `tests/normalize.test.ts` |
| Çok dilli aynı olay eşleştirme; farklı olayların birleştirilmemesi (aynı yer / aynı kişiler) | `tests/matching.test.ts` |
| Aynı haberin tekrarlı işlenmesi (parti tekrarı, URL varyantları, first_seen korunması) | `tests/matching.test.ts` |
| Eksik/hatalı/gelecek/tahmini yayın tarihi; yenilik sınıfları; çelişki | `tests/novelty.test.ts` |
| Modelin kaynakta olmayan kişi/sayı/ad eklemesi; kaynak kimliği olmayan iddia; uydurma kaynak kimliği | `tests/claims.test.ts` |
| LLM zaman aşımı, HTTP hatası, bozuk JSON, şema hatası, sınırlı yeniden deneme, mock işaretleme, tam metin kısıtı | `tests/llm.test.ts` |
| API kimlik doğrulama, rol kontrolleri, CSRF, boyut sınırı, hız sınırı, başlıklar | `tests/api.test.ts` |
| Veri adaptörlerinin yapılandırılmamış/doğrulanmamış durumu | `tests/api.test.ts` |
| ClickHouse parametreleme (enjeksiyon), kimlik bilgisinin URL'de olmaması, migration ayrıştırma | `tests/clickhouse.test.ts` |
| B-cubed ve diğer metrikler | `tests/eval.test.ts` |

## Doğrulanmayan / tamamlanmayan

1. **ClickHouse deposu gerçek ClickHouse'a karşı çalıştırılmadı.** SQL üretimi ve parametreleme sahte HTTP ile test edildi;
   şema DDL'i, `FINAL`/JOIN sorguları ve tarih biçimi dönüşümleri gerçek 24.8 sunucusunda doğrulanmalı.
2. **Docker Compose / nginx** yapılandırması çalıştırılmadı (Docker yok).
3. **Arayüz tarayıcıda görsel olarak doğrulanmadı** (Chrome eklentisi bağlı değildi). API'ler ve paket derlemesi doğrulandı;
   ekran düzeni, RTL görünümü, klavye gezintisi ve kontrast elle kontrol edilmeli.
4. Gerçek LLM uç noktasıyla deneme yapılmadı (yalnız mock ve sahte fetch).
5. Gerçek kalite metrikleri ölçülmedi (altın set yok).
6. MVP dışı: parola değiştirme/sıfırlama, kullanıcı devre dışı bırakma, çeviri hattı (tablo hazır, üretici yok),
   embedding adaptörü, kalıcı zamanlanmış alım.
