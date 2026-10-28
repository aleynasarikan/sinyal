# Güvenlik

## Uygulanan önlemler

| Alan | Uygulama |
|---|---|
| Parola | Bun.password (argon2id); en az 12 karakter; hesap yokken de sahte doğrulama (zamanlama sızıntısı yok) |
| Oturum | 32 bayt rastgele jeton, yalnız `HttpOnly; SameSite=Strict` çerezde (`Secure` varsayılan açık); DB'de sha256; 12 saat ömür; çıkışta iptal |
| Yetki | Roller `admin`/`analyst`/`viewer`; izin denetimi her uçta **sunucuda** (`can()`); yetkisiz denemeler denetim kaydına yazılır |
| CSRF | Durum değiştiren isteklerde Origin izin listesi + `application/json` zorunlu + SameSite=Strict |
| CORS | Hiç CORS başlığı verilmez (aynı köken) |
| Hız sınırı | Giriş: IP başına ve global; API: IP başına; model analizi: kullanıcı başına. nginx'te ayrıca `limit_req` |
| İstek boyutu | 256 KB (Bun `maxRequestBodySize` + uygulama + nginx) |
| Başlıklar | CSP (`script-src 'self'`, inline/eval yok), X-Frame-Options DENY, nosniff, Referrer-Policy, COOP/CORP, Permissions-Policy |
| XSS | Arayüz sunucu verisini yalnız `textContent` ile yazar; `innerHTML` kullanılmaz |
| SQL | ClickHouse sorgu parametreleri (`{ad:Tür}`); değer birleştirme yok; tablo/parametre adları beyaz listede |
| Hata yanıtı | İstemciye genel mesaj; ayrıntı yalnız sunucu log'unda |
| Log | Anahtar/parola/token/çerez alanları maskelenir; LLM hata gövdesi log'a/istemciye taşınmaz |
| Gizli bilgiler | Yalnız env; `.env*` Git'te yok; `.env.example` sahte değerler; başlangıç parolaları 0600 dosyada |
| TLS | TLS doğrulamasını kapatan **hiçbir** ayar yok; LLM ve UMİ uç noktaları HTTPS zorunlu (loopback hariç) |
| Proxy IP | `X-Real-IP` yalnız `SINYAL_TRUST_PROXY=1` iken okunur (aksi halde sahtelenebilir) |
| Model güvenliği | Haber metni güvenilmeyen veri; JSON veri bloğunda; çıktı şema + kaynak denetiminden geçer; varsayılan olarak yalnız ilk paragraf gönderilir |
| Ağ | ClickHouse ve nginx portları yalnız `127.0.0.1`'e bağlanır; uygulama container'ı root olmayan kullanıcıyla çalışır |
| Denetim kaydı | giriş (başarılı/başarısız), çıkış, analiz, iddia incelemesi, alım, kullanıcı oluşturma, yetkisiz erişim |

## Bilinen sınırlar / açık konular

1. **Hız sınırları süreç içidir**: birden çok uygulama örneğinde paylaşılmaz (nginx katmanı bunu kısmen telafi eder).
2. **Parola değiştirme / sıfırlama ve hesap devre dışı bırakma uçları yok** (MVP dışı). İlk girişte parola değiştirme zorunluluğu eklenmeli.
3. **Oturum ve denetim kayıtları için saklama süresi** tanımlanmadı; kurum politikası bekleniyor (otomatik silme yapılmadı).
4. **Üretim TLS'i**: `deploy/nginx/sinyal.conf` yalnız 80/HTTP'dir. Üretimde kurum sertifikasıyla 443, HSTS ve `SINYAL_COOKIE_SECURE=1` gerekir.
5. **Kişisel veri**: haber metinleri kişi adları içerir. KVKK kapsamında işleme amacı, saklama ve dışa aktarma kuralları kurumca belirlenmeli.
6. **Dış model**: `LLM_PROVIDER=openai` ile haber parçaları dış bir uç noktaya gider. Hangi uç noktanın kullanılabileceği kurum onayına tabidir.
7. Bu inceleme geliştirici öz-değerlendirmesidir; bağımsız güvenlik testi (pentest) yapılmadı.
