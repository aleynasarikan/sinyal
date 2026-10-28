// HTTP yardımcıları: güvenlik başlıkları, JSON yanıt, gövde okuma (boyut sınırlı), çerez.

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Dış CDN, inline betik ve eval YOK.
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...extra },
  });
}

export async function readJson(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().startsWith("application/json")) throw new HttpError(415, "İçerik türü application/json olmalı");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError(413, "İstek gövdesi çok büyük");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "İstek gövdesi çok büyük");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Geçersiz JSON");
  }
}

export const SESSION_COOKIE = "sinyal_session";

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

export function clientIp(req: Request, trustProxy: boolean, socketIp: string | null): string {
  // X-Real-IP yalnız güvenilen ters vekil (nginx) arkasında okunur; aksi halde istemci sahteleyebilir.
  if (trustProxy) { const h = req.headers.get("x-real-ip"); if (h) return h.slice(0, 64); }
  return socketIp || "unknown";
}

export const intParam = (v: string | null, d: number, min: number, max: number): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export const strParam = (v: string | null, max = 200): string | undefined => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : undefined;
};
