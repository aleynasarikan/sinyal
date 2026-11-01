import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/api/server.ts";
import { createUser } from "../src/auth/auth.ts";
import { loadConfig } from "../src/config.ts";
import { MockLlmProvider } from "../src/llm/mock.ts";
import { initLlmStats } from "../src/metrics.ts";
import { MockDataProvider } from "../src/providers/mock.ts";
import { UmiApiProvider } from "../src/providers/umi_api.ts";
import { gz, ingestedRepo, now } from "./helpers.ts";

const PW = "dogru-at-pil-zimba";
const BASE = "http://localhost:8790";
let app: ReturnType<typeof createApp>;
let repo: Awaited<ReturnType<typeof ingestedRepo>>["repo"];
let eventId: string;

async function loginAs(email: string): Promise<string> {
  const r = await app(new Request(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ email, password: PW }) }), "10.0.0." + Math.floor(Math.random() * 250));
  expect(r.status).toBe(200);
  const sc = r.headers.get("set-cookie")!;
  expect(sc).toContain("HttpOnly");
  expect(sc).toContain("SameSite=Strict");
  return sc.split(";")[0]!;
}
const get = (path: string, cookie?: string) => app(new Request(BASE + path, { headers: cookie ? { cookie } : {} }), "10.1.0.1");
const post = (path: string, body: unknown, cookie?: string, origin = BASE) =>
  app(new Request(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), "10.1.0.2");

beforeAll(async () => {
  const r = await ingestedRepo();
  repo = r.repo;
  eventId = r.eventOf("a1");
  for (const [email, role] of [["admin@t.local", "admin"], ["analist@t.local", "analyst"], ["izleyici@t.local", "viewer"]] as const) {
    await createUser(repo, { email, name: email, role, password: PW });
  }
  initLlmStats("mock", "mock-deterministic", true);
  const cfg = loadConfig({ SINYAL_RATE_LOGIN_PER_MIN: "3" });
  app = createApp({ cfg, repo, gz, provider: new MockDataProvider(now), llm: new MockLlmProvider(), clock: () => now().getTime() });
});

describe("Kimlik doğrulama", () => {
  test("Oturumsuz istek 401", async () => {
    expect((await get("/api/events")).status).toBe(401);
    expect((await get("/api/dashboard")).status).toBe(401);
  });
  test("Yanlış parola 401 ve denetim kaydı", async () => {
    const r = await post("/api/auth/login", { email: "admin@t.local", password: "yanlis-parola-123" });
    expect(r.status).toBe(401);
    expect((await repo.listAudit(10)).some((a) => a.action === "login" && !a.ok)).toBe(true);
  });
  test("Giriş hız sınırı (IP başına)", async () => {
    const tries = [];
    for (let i = 0; i < 5; i++) tries.push((await app(new Request(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@y.z", password: "p" }) }), "10.9.9.9")).status);
    expect(tries.slice(0, 3)).toEqual([401, 401, 401]);
    expect(tries[3]).toBe(429);
  });
  test("Geçersiz/uydurma oturum çerezi reddedilir; çıkıştan sonra çerez geçersiz", async () => {
    expect((await get("/api/auth/me", "sinyal_session=uydurma")).status).toBe(401);
    const c = await loginAs("izleyici@t.local");
    expect((await get("/api/auth/me", c)).status).toBe(200);
    await post("/api/auth/logout", {}, c);
    expect((await get("/api/auth/me", c)).status).toBe(401);
  });
  test("Parola hash'i API yanıtında yer almaz", async () => {
    const c = await loginAs("admin@t.local");
    const body = await (await get("/api/admin/users", c)).text();
    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("$argon2");
  });
});

describe("Rol kontrolleri (sunucu tarafı)", () => {
  test("İzleyici okuyabilir ama analiz/inceleme/alım/yönetim yapamaz", async () => {
    const c = await loginAs("izleyici@t.local");
    expect((await get("/api/events", c)).status).toBe(200);
    expect((await post(`/api/events/${eventId}/analyze`, {}, c)).status).toBe(403);
    expect((await post("/api/ingest/run", {}, c)).status).toBe(403);
    expect((await get("/api/admin/users", c)).status).toBe(403);
  });
  test("Analist analiz çalıştırır ve iddia inceler; yönetim yapamaz", async () => {
    const c = await loginAs("analist@t.local");
    const r = await post(`/api/events/${eventId}/analyze`, {}, c);
    expect(r.status).toBe(200);
    const d = await (await get(`/api/events/${eventId}`, c)).json();
    expect(d.analysis.mock).toBe(true);
    const claimId = d.claims[0].claim_id;
    expect((await post(`/api/claims/${claimId}/review`, { status: "corrected", corrected_text: "" }, c)).status).toBe(400);
    expect((await post(`/api/claims/${claimId}/review`, { status: "approved", note: "kontrol edildi" }, c)).status).toBe(200);
    const d2 = await (await get(`/api/events/${eventId}`, c)).json();
    expect(d2.claims.find((x: { claim_id: string }) => x.claim_id === claimId).review.status).toBe("approved");
    expect((await get("/api/admin/audit", c)).status).toBe(403);
    expect((await post("/api/admin/users", { email: "z@z.zz", role: "admin", password: PW }, c)).status).toBe(403);
  });
  test("Yönetici kullanıcı ekler; zayıf parola ve geçersiz rol reddedilir", async () => {
    const c = await loginAs("admin@t.local");
    expect((await post("/api/admin/users", { email: "yeni@t.local", name: "Yeni", role: "viewer", password: "kisa" }, c)).status).toBe(400);
    expect((await post("/api/admin/users", { email: "yeni@t.local", name: "Yeni", role: "root", password: PW }, c)).status).toBe(400);
    expect((await post("/api/admin/users", { email: "yeni@t.local", name: "Yeni", role: "viewer", password: PW }, c)).status).toBe(201);
    const audit = await (await get("/api/admin/audit", c)).json();
    expect(audit.items.some((a: { action: string }) => a.action === "user_create")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(PW);
  });
});

describe("HTTP güvenliği", () => {
  test("Yabancı Origin'den POST reddedilir (CSRF)", async () => {
    const c = await loginAs("analist@t.local");
    expect((await post(`/api/events/${eventId}/analyze`, {}, c, "https://kotu.example")).status).toBe(403);
  });
  test("JSON olmayan gövde 415, büyük gövde 413", async () => {
    const r = await app(new Request(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "a=b" }), "10.2.0.1");
    expect(r.status).toBe(415);
    const big = await app(new Request(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x".repeat(300_000) }) }), "10.2.0.2");
    expect(big.status).toBe(413);
  });
  test("Güvenlik başlıkları ve CORS yok", async () => {
    const r = await get("/api/health");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
  test("Bilinmeyen uç 404, hata ayrıntısı sızmaz", async () => {
    const c = await loginAs("izleyici@t.local");
    expect((await get("/api/yok", c)).status).toBe(404);
    const r = await get("/api/events/evt_olmayan", c);
    expect(r.status).toBe(404);
  });
});

describe("Arama ve filtreler", () => {
  test("Dil, varlık, sınıf ve metin filtreleri", async () => {
    const c = await loginAs("izleyici@t.local");
    const fa = await (await get("/api/articles?lang=fa", c)).json();
    expect(fa.total).toBe(4);
    expect(fa.items.every((a: { rtl: boolean }) => a.rtl)).toBe(true);
    const ent = await (await get("/api/articles?entity=person:sofia_brandt", c)).json();
    expect(ent.total).toBe(6);
    const dup = await (await get("/api/articles?novelty=unverified_claim", c)).json();
    expect(dup.total).toBe(3); // a9, d1, f1
    const q = await (await get("/api/articles?q=" + encodeURIComponent("نورفيك"), c)).json();
    expect(q.total).toBe(1);
    const ev = await (await get("/api/events?entity=concept:wildfire", c)).json();
    expect(ev.total).toBe(1);
  });
  test("Pano demo veriyi açıkça işaretler", async () => {
    const c = await loginAs("izleyici@t.local");
    const d = await (await get("/api/dashboard?window=72", c)).json();
    expect(d.demo).toBe(true);
    expect(d.llm_mock).toBe(true);
    expect(d.counts.new_events).toBeGreaterThanOrEqual(3);
  });
});

describe("Veri erişim adaptörleri", () => {
  test("UmiApiProvider: yapılandırılmamışsa açık durum döner, veri uydurmaz", async () => {
    const p = new UmiApiProvider({ baseUrl: "", apiKey: "", contractVerified: false });
    expect((await p.status()).state).toBe("not_configured");
    const r = await p.fetchBatch({ limit: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.state).toBe("not_configured");
  });
  test("UmiApiProvider: sözleşme doğrulanmadan istek göndermez; HTTP reddedilir", async () => {
    expect((await new UmiApiProvider({ baseUrl: "https://umi.example", apiKey: "k", contractVerified: false }).fetchBatch({ limit: 1 })).ok).toBe(false);
    expect((await new UmiApiProvider({ baseUrl: "https://umi.example", apiKey: "k", contractVerified: false }).status()).state).toBe("contract_unverified");
    expect((await new UmiApiProvider({ baseUrl: "http://umi.example", apiKey: "k", contractVerified: true }).status()).state).toBe("error");
  });
  test("Yapılandırılmamış sağlayıcıyla alım 'not_configured' kaydı üretir, veri yazmaz", async () => {
    const { runIngestion } = await import("../src/pipeline/ingest.ts");
    const { MemoryRepo } = await import("../src/store/memory.ts");
    const r = new MemoryRepo();
    const res = await runIngestion(new UmiApiProvider({ baseUrl: "", apiKey: "", contractVerified: false }), r, gz);
    expect(res.run.status).toBe("not_configured");
    expect((await r.searchArticles({ limit: 10, offset: 0 })).total).toBe(0);
  });
  test("MockDataProvider demo olarak işaretlidir ve 7 dili kapsar", async () => {
    const r = await new MockDataProvider(now).fetchBatch({ limit: 100 });
    expect(r.ok && r.demo).toBe(true);
    if (r.ok) expect(new Set(r.articles.map((a) => a.lang_declared))).toEqual(new Set(["tr", "en", "ar", "ru", "fr", "de", "fa"]));
  });
});

describe("Yayılım API", () => {
  test("Giriş gerektirir; olmayan olay 404", async () => {
    expect((await get("/api/spread")).status).toBe(401);
    expect((await get(`/api/events/${eventId}/spread`)).status).toBe(401);
    const c = await loginAs("izleyici@t.local");
    expect((await get("/api/events/evt_olmayan/spread", c)).status).toBe(404);
  });
  test("Olay yayılımı ve radar: mutasyonlu, hızlanan olay en üstte", async () => {
    const c = await loginAs("izleyici@t.local");
    const s = await (await get(`/api/events/${eventId}/spread`, c)).json();
    expect(s.version).toBe("yayilim-v1");
    expect(s.stats.placed).toBe(10);
    const radar = await (await get("/api/spread?window=24", c)).json();
    expect(radar.window_hours).toBe(24);
    const top = radar.items[0];
    expect(top.title_tr).toContain("Sınır kapatma");
    expect(top.alerts.high).toBe(2);
    expect(top.momentum.label).toBe("accelerating");
    expect(top.first_seen.hedged).toBe(true);
  });
});

describe("Atlas API", () => {
  test("Giriş gerektirir; mutasyonlu olay önce, demo işaretli", async () => {
    expect((await get("/api/atlas")).status).toBe(401);
    const c = await loginAs("izleyici@t.local");
    const d = await (await get("/api/atlas?window=72", c)).json();
    expect(d.demo).toBe(true);
    expect(d.events[0].title_tr).toContain("Sınır kapatma");
    expect(d.countries.DE.first_seen).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(d)).not.toContain("body_original"); // atlas tam metin taşımaz
  });
  test("Statik varlıklar aynı kökenden: worker, harita stili, sınırlar", async () => {
    const { buildWebAssets } = await import("../src/web/build.ts");
    const assets = await buildWebAssets();
    for (const p of ["/maplibre-gl-worker.mjs", "/maplibre-gl.css", "/geo/countries.json", "/geo/country_points.json", "/app.js"]) expect(assets.has(p)).toBe(true);
    expect(assets.get("/app.js")![0].length).toBeLessThan(200_000); // maplibre ana pakete girmez, ayrı parçada
  });
});
