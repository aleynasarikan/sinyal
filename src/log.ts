// Basit yapılandırılmış logger. GÜVENLİK: anahtar/parola/token/çerez içeren alanlar maskelenir.

const SENSITIVE_KEY = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|session/i;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 4) return "[derin]";
  if (typeof v === "string") return v.replace(BEARER, "$1***");
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = SENSITIVE_KEY.test(k) ? "***" : redact(x, depth + 1);
    return out;
  }
  return v;
}

type Level = "debug" | "info" | "warn" | "error";
const quiet = process.env.SINYAL_LOG_QUIET === "1" || process.env.NODE_ENV === "test";

export function log(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (quiet && level !== "error") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(fields ? (redact(fields) as object) : {}) });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}
