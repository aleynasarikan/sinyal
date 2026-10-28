// Süreç içi sayaçlar (Model ve Sistem Durumu ekranı). Süreç yeniden başlarsa sıfırlanır;
// kalıcı geçmiş analysis_runs / ingestion_runs tablolarındadır.

export interface LlmStats {
  provider: string;
  model: string;
  mock: boolean;
  ok: number;
  errors: Record<string, number>;
  retries: number;
  inflight: number;
  queued: number;
  latenciesMs: number[]; // son 200 istek
  lastOkAt: string | null;
  lastError: string | null;
}

export const metrics = {
  startedAt: new Date().toISOString(),
  llm: null as LlmStats | null,
  http: { requests: 0, errors5xx: 0, rateLimited: 0 },
};

export function initLlmStats(provider: string, model: string, mock: boolean): LlmStats {
  metrics.llm = { provider, model, mock, ok: 0, errors: {}, retries: 0, inflight: 0, queued: 0, latenciesMs: [], lastOkAt: null, lastError: null };
  return metrics.llm;
}

export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
