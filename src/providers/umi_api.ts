// UmiApiProvider — GELECEKTEKİ yetkilendirilmiş, salt-okunur UMİ API bağlantısı için yer tutucu.
//
// BİLİNÇLİ OLARAK UYGULANMADI: UMİ'nin belgelenmiş ve kurumca yetkilendirilmiş API sözleşmesi
// (endpoint yolları, alan şeması, kimlik doğrulama biçimi, sayfalama, hız sınırı) henüz DOĞRULANMADI.
// Endpoint/alan adı UYDURULMAZ. Sözleşme gelene kadar bu sağlayıcı hiçbir istek göndermez ve
// açık bir durum döndürür; asla boş/sahte veriyi gerçek veri gibi sunmaz.
//
// GÜVENLİK: API anahtarı yalnız sunucu tarafında kalır; tarayıcıya hiçbir zaman gönderilmez.
// TLS doğrulaması kapatılamaz; düz HTTP reddedilir (loopback hariç).

import type { DataProvider, FetchResult, ProviderStatus } from "./types.ts";

export interface UmiApiOptions {
  baseUrl: string;
  apiKey: string;
  contractVerified: boolean;
}

export class UmiApiProvider implements DataProvider {
  readonly name = "umi_api";
  constructor(private readonly opts: UmiApiOptions) {}

  private check(): { ok: true } | { ok: false; state: "not_configured" | "contract_unverified" | "error"; message: string } {
    if (!this.opts.baseUrl || !this.opts.apiKey) {
      return { ok: false, state: "not_configured", message: "UMİ entegrasyonu yapılandırılmadı (UMI_API_BASE_URL / UMI_API_KEY tanımlı değil)." };
    }
    let u: URL;
    try {
      u = new URL(this.opts.baseUrl);
    } catch {
      return { ok: false, state: "error", message: "UMI_API_BASE_URL geçerli bir URL değil." };
    }
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(u.hostname);
    if (u.protocol !== "https:" && !loopback) {
      return { ok: false, state: "error", message: "UMİ API yalnız HTTPS üzerinden kullanılabilir." };
    }
    if (!this.opts.contractVerified) {
      return {
        ok: false, state: "contract_unverified",
        message: "UMİ API sözleşmesi (endpoint, alan şeması, yetki kapsamı) kurumca doğrulanmadı; istek gönderilmedi.",
      };
    }
    return { ok: true };
  }

  async status(): Promise<ProviderStatus> {
    const c = this.check();
    if (!c.ok) return { provider: this.name, state: c.state, demo: false, message: c.message };
    return {
      provider: this.name, state: "error", demo: false,
      message: "Sözleşme doğrulandı olarak işaretli ancak eşleme kodu henüz yazılmadı (docs/ENTEGRASYON.md).",
    };
  }

  async fetchBatch(_opts: { limit: number }): Promise<FetchResult> {
    const c = this.check();
    if (!c.ok) return { ok: false, state: c.state, message: c.message };
    // Belgelenmiş sözleşme geldiğinde: alan eşlemesi + şema doğrulaması + sayfalama burada uygulanacak.
    return { ok: false, state: "error", message: "UMİ API eşlemesi henüz uygulanmadı; belgelenmiş sözleşme bekleniyor." };
  }
}
