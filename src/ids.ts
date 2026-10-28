import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Deterministik kimlik: aynı girdi → aynı kimlik (idempotent yazımlar için). */
export const stableId = (prefix: string, ...parts: string[]): string => prefix + "_" + sha256(parts.join("␟")).slice(0, 24);

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export const nowIso = (): string => new Date().toISOString();

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** URL'yi kanonik biçime getirir: şema/host küçük harf, parça (#) ve izleme parametreleri atılır. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return String(raw ?? "").trim();
  }
}
