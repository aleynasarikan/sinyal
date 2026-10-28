# UMİ Entegrasyonu — Kontrollü Hazırlık (Aşama 11)

## Mevcut durum

- `UmiApiProvider` **istek göndermez**. `UMI_API_BASE_URL`/`UMI_API_KEY` yoksa `not_configured`,
  varsa ama `UMI_API_CONTRACT_VERIFIED=1` değilse `contract_unverified` döner. Alım bu durumda veri yazmaz ve
  durumu `ingestion_runs` tablosuna kaydeder; arayüz "entegrasyon yapılandırılmadı" uyarısı gösterir.
- UMİ kodunda `X-API-Key` ile çalışan salt-okunur bir `/api/v1` görülmüştür. Bunun **yetkili ve belgelenmiş
  arayüz olduğu doğrulanmadı**; endpoint yolları, alan adları veya kimlik biçimi SİNYAL koduna yazılmadı.
- API anahtarı yalnız SİNYAL sunucusunda kalır; tarayıcı UMİ'ye hiçbir zaman doğrudan istek atmaz.

## Durma noktası — gereken kurum onayları ve girdiler

1. UMİ verisinin SİNYAL'de işlenmesine ilişkin yetki (kapsam: hangi kaynaklar, hangi alanlar, hangi zaman aralığı).
2. Belgelenmiş API sözleşmesi: uç noktalar, yanıt şeması, sayfalama, hız sınırı, hata kodları, alan anlamları
   (özellikle yayın tarihi alanının "kesin" mi "tarama zamanı" mı olduğu).
3. SİNYAL için ayrı, **salt-okunur** kapsamlı API anahtarı (UMİ yönetim panelinden) ve anahtarın secret yönetimi.
4. Ağ erişimi (SİNYAL sunucusundan UMİ API host'una HTTPS) ve kurum CA'sı gerekiyorsa `NODE_EXTRA_CA_CERTS`.
5. Kişisel veri ve saklama politikası (KVKK).
6. `cluster_id`'nin aday sinyal olarak kullanılmasına izin verilip verilmediği.

## Sözleşme geldikten sonra yapılacaklar

1. `src/providers/umi_api.ts` içinde alan eşlemesi + yanıt şeması doğrulaması (bilinmeyen/eksik alan → kayıt atlanır ve sayılır).
2. Sözleşmeden üretilen kaydedilmiş örnek yanıtlarla (gerçek veri değil) adaptör testleri.
3. `date_estimated` eşlemesi: UMİ'de tarih tahmini ise `true`.
4. Yalnız `UMI_API_CONTRACT_VERIFIED=1` ve test ortamında, açık onayla ilk okuma denemesi.
5. Doğrudan veritabanı okuma (`UmiReadOnlyDatabaseProvider`) yalnız ayrıca onaylanırsa; ayrı kullanıcı + yalnız SELECT yetkisi + ayrı ağ kuralı ile.
