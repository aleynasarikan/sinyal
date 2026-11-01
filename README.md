# SİNYAL

Bağımsız, çok dilli medya istihbaratı ve olay analizi platformu (MVP).
Farklı dillerdeki haberleri SİNYAL'e ait olaylar etrafında birleştirir, yeni gelişmeleri sınıflar,
her analiz iddiasını kaynak haberlere bağlar ve kaynakta dayanağı olmayanı "doğrulanamadı" olarak gösterir.
**Yayılım** katmanı bir iddianın yayıncılar ve diller arasında kimden kime geçtiğini, yolda nasıl değiştiğini
(teyitsizlik ifadesinin düşmesi, sayının şişmesi) ve yayılmanın hızlanıp hızlanmadığını gösterir; **Yayılım Atlası** bunu
ülkeler arası animasyonlu harita olarak gösterir (dış harita sunucusu kullanmadan); sade dilde hazırlanan rapor PDF olarak
indirilebilir (`docs/MIMARI.md`).

> UMİ'den ayrı bir uygulamadır: kendi deposu, API'si, arayüzü ve ClickHouse veritabanı vardır.
> UMİ'nin koduna, arayüzüne veya veritabanına yazmaz. Varsayılan olarak **kurgusal demo verisi** ve **mock model** ile çalışır.

## Hızlı başlangıç (yerel, Docker'sız)

Gereksinim: Bun ≥ 1.2.

```bash
bun install
bun run check                 # typecheck + 138 test
SINYAL_COOKIE_SECURE=0 SINYAL_DEMO_USERS=1 bun run start
# → http://127.0.0.1:8790
```

İlk açılışta yönetici (ve `SINYAL_DEMO_USERS=1` ise analist/izleyici) hesapları için rastgele parolalar
üretilir ve `var/.sinyal-seed-password` dosyasına (izin 0600) yazılır; log'a yazılmaz.
Bu kipte depo bellek içidir (`SINYAL_STORE=memory`): süreç kapanınca veri kaybolur.

## Docker Compose ile (bağımsız ClickHouse 24.8 + uygulama + nginx)

```bash
cp .env.example .env          # CLICKHOUSE_PASSWORD'u güçlü bir değerle değiştirin
# .env içinde: SINYAL_COOKIE_SECURE=0 (yerel HTTP), SINYAL_PUBLIC_ORIGIN=http://localhost:8080
docker compose up -d --build
docker compose exec app cat /app/var/.sinyal-seed-password
# → http://localhost:8080
```

ClickHouse yalnız `127.0.0.1:8124`'e açılır (UMİ'nin 8123'üyle çakışmaz). Migration'lar uygulama açılışında
otomatik çalışır; elle: `bun run migrate`.

> Compose kurulumu 2026-10-31'de yerelde (Colima) çalıştırılarak doğrulandı. Bkz. `docs/TEST_RAPORU.md`.

## Komutlar

| Komut | Açıklama |
|---|---|
| `bun run start` / `dev` | Sunucu (dev: dosya izleme) |
| `bun test` | Otomatik testler |
| `bun run typecheck` | TypeScript denetimi |
| `bun run migrate` | ClickHouse migration'ları |
| `bun scripts/build_geo.ts` | Atlas ülke sınırlarını yeniden üretir (`data/geo/`) |
| `bun run eval --synthetic` | Değerlendirme hattını sentetik setle çalıştırır (kalite ölçümü değildir) |
| `bun run eval --gold g.jsonl --system s.jsonl` | Analist altın setiyle ölçüm |

## Belgeler

- `docs/UMI_REFERANS_RAPORU.md` — UMİ salt-okuma inceleme raporu (yerel; depoya dahil değildir)
- `docs/MIMARI.md` — mimari, veri modeli, eşleştirme ve sınıflandırma
- `docs/GUVENLIK.md` — güvenlik kararları ve açık konular
- `docs/ENTEGRASYON.md` — UMİ entegrasyonu için kontrollü hazırlık ve gereken onaylar
- `docs/DEGERLENDIRME.md` — metrikler ve altın set için gereken insan girdileri
- `docs/TEST_RAPORU.md` — çalıştırılan komutlar ve sonuçlar
