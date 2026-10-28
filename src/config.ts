// Merkezî yapılandırma. Tüm ortam değişkeni okuması burada toplanır.
// GÜVENLİK: hiçbir gizli değerin kod içinde varsayılanı yoktur; gizli değerler yalnız env'den gelir.

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const flag = (v: string | undefined, d: boolean): boolean => (v === undefined || v === "" ? d : v === "1" || v === "true");
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d;

export type StoreKind = "memory" | "clickhouse";
export type DataProviderKind = "mock" | "umi_api";
export type LlmProviderKind = "mock" | "openai";

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  return {
    host: env.HOST ?? "127.0.0.1",
    port: num(env.PORT, 8790),
    // Durum değiştiren isteklerde Origin denetimi için izinli köken(ler).
    publicOrigins: (env.SINYAL_PUBLIC_ORIGIN ?? "http://localhost:8790,http://127.0.0.1:8790")
      .split(",").map((s) => s.trim()).filter(Boolean),
    cookieSecure: flag(env.SINYAL_COOKIE_SECURE, true),
    // Yalnız nginx gibi güvenilen bir ters vekil arkasında 1 yapın (X-Real-IP'ye güvenilir).
    trustProxy: flag(env.SINYAL_TRUST_PROXY, false),
    maxBodyBytes: num(env.SINYAL_MAX_BODY_BYTES, 256_000),

    store: oneOf<StoreKind>(env.SINYAL_STORE, ["memory", "clickhouse"], "memory"),
    clickhouse: {
      url: env.CLICKHOUSE_URL ?? "http://127.0.0.1:8124",
      db: env.CLICKHOUSE_DB ?? "sinyal",
      user: env.CLICKHOUSE_USER ?? "sinyal",
      password: env.CLICKHOUSE_PASSWORD ?? "",
      maxConcurrency: num(env.CLICKHOUSE_MAX_CONC, 8),
    },

    dataProvider: oneOf<DataProviderKind>(env.SINYAL_DATA_PROVIDER, ["mock", "umi_api"], "mock"),
    umiApi: {
      // Belgelenmiş ve yetkilendirilmiş arayüz doğrulanana kadar boş kalmalıdır.
      baseUrl: env.UMI_API_BASE_URL ?? "",
      apiKey: env.UMI_API_KEY ?? "",
      contractVerified: flag(env.UMI_API_CONTRACT_VERIFIED, false),
    },

    llm: {
      provider: oneOf<LlmProviderKind>(env.LLM_PROVIDER, ["mock", "openai"], "mock"),
      baseUrl: env.LLM_BASE_URL ?? "",
      apiKey: env.LLM_API_KEY ?? "",
      model: env.LLM_MODEL ?? "",
      timeoutMs: num(env.LLM_TIMEOUT_MS, 60_000),
      maxRetries: Math.min(3, Math.max(0, Number(env.LLM_MAX_RETRIES ?? 2) || 0)),
      // Varsayılan: modele yalnız başlık + ilk paragraf gönderilir (tam metin değil).
      sendFullText: flag(env.LLM_SEND_FULLTEXT, false),
      maxCharsPerArticle: num(env.LLM_MAX_CHARS_PER_ARTICLE, 1200),
    },

    rate: {
      loginPerMin: num(env.SINYAL_RATE_LOGIN_PER_MIN, 5),
      apiPerMin: num(env.SINYAL_RATE_API_PER_MIN, 300),
      analysisPerMin: num(env.SINYAL_RATE_ANALYSIS_PER_MIN, 6),
    },

    seed: {
      adminEmail: env.SINYAL_ADMIN_EMAIL ?? "admin@sinyal.local",
      adminPassword: env.SINYAL_ADMIN_PASSWORD ?? "",
      seedPasswordFile: env.SINYAL_SEED_PASSWORD_FILE ?? "var/.sinyal-seed-password",
      demoUsers: flag(env.SINYAL_DEMO_USERS, false),
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
