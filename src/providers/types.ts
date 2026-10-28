// Veri erişim adaptörleri. SİNYAL dış sistemlerden YALNIZ OKUR.

export interface RawSource {
  source_id: string;
  name: string;
  domain: string;
  country: string;
  default_lang: string;
}

export interface RawArticle {
  external_id: string;
  source_id: string;
  url: string;
  title: string;
  body: string;
  lang_declared: string;
  published_at: string | null;
  /** Sağlayıcı yayın tarihini tahmin ettiyse (ör. tarama zamanı) true */
  date_estimated: boolean;
}

export type ProviderState = "ok" | "not_configured" | "contract_unverified" | "error";

export interface ProviderStatus {
  provider: string;
  state: ProviderState;
  /** Bu sağlayıcının verisi demo/sentetik mi? UI bunu açıkça gösterir. */
  demo: boolean;
  message: string;
}

export type FetchResult =
  | { ok: true; demo: boolean; sources: RawSource[]; articles: RawArticle[] }
  | { ok: false; state: Exclude<ProviderState, "ok">; message: string };

export interface DataProvider {
  readonly name: string;
  status(): Promise<ProviderStatus>;
  fetchBatch(opts: { limit: number }): Promise<FetchResult>;
}
