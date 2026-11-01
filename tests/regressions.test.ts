// Denetim bulgularına (2026-10-28) karşı regresyon testleri. Her test önce başarısız olacak biçimde yazıldı.
import { describe, expect, test } from "bun:test";
import { createApp } from "../src/api/server.ts";
import { createUser } from "../src/auth/auth.ts";
import { verifyClaim, type VerifyContext } from "../src/claims/verify.ts";
import { dateRangeParam } from "../src/api/http.ts";
import { loadConfig } from "../src/config.ts";
import { analyzeEvent } from "../src/llm/analyze.ts";
import { MockLlmProvider } from "../src/llm/mock.ts";
import { LlmError, type LlmProvider } from "../src/llm/types.ts";
import { initLlmStats } from "../src/metrics.ts";
import { runIngestion } from "../src/pipeline/ingest.ts";
import { MockDataProvider } from "../src/providers/mock.ts";
import type { DataProvider } from "../src/providers/types.ts";
import { MemoryRepo } from "../src/store/memory.ts";
import { extractFactNumbers, matchKey } from "../src/text/normalize.ts";
import { localDayBounds, pageInfo } from "../src/web/paging.ts";
import { gz, ingestedRepo, now } from "./helpers.ts";

/** Tek haberlik sağlayıcı (kayıtlı demo kaynağından). */
function one(key: string, lang: string, title: string, body: string, opts: { hoursAgo?: number; url?: string; source?: string } = {}): DataProvider {
  return {
    name: "mock",
    status: async () => ({ provider: "mock", state: "ok", demo: true, message: "" }),
    fetchBatch: async () => ({
      ok: true, demo: true, sources: [],
      articles: [{
        external_id: key, source_id: opts.source ?? "demo-en-wire", url: opts.url ?? `https://wire-en.example/reg/${key}`, title, body,
        lang_declared: lang, published_at: new Date(now().getTime() - (opts.hoursAgo ?? 4) * 36e5).toISOString(), date_estimated: false,
      }],
    }),
  };
}
async function ingestOne(r: Awaited<ReturnType<typeof ingestedRepo>>, p: DataProvider) {
  const res = await runIngestion(p, r.repo, gz, { now });
  const id = Object.keys(res.labels)[0]!;
  const m = (await r.repo.memberOfArticles([id]))[0]!;
  return { id, label: res.labels[id], member: m };
}

// ---------- 1. Olay eşleştirme ----------
describe("Bulgu 1 — ortak sayı tek başına eşleştirme kanıtı değildir", () => {
  test("Konu sözcüğü tanınmayan farklı olay (aynı şehir + rastlantısal ortak sayı) depreme bağlanmaz", async () => {
    const r = await ingestedRepo();
    const x = await ingestOne(r, one("blaze", "en", "Blaze destroys warehouse in Norvik, Kestria", "A blaze destroyed a warehouse in Norvik, Kestria. 12 firefighters were deployed."));
    expect(x.member.event_id).not.toBe(r.eventOf("a1"));
    expect(x.member.event_id).not.toBe(r.eventOf("c1"));
  });

  test("Yalnız yer + ortak sayı ile (konu bilgisi her iki tarafta da yokken) birleştirme yapılmaz", async () => {
    const r = await ingestedRepo();
    const a = await ingestOne(r, one("q1", "en", "Concert held in Lisvane", "Some 300 people attended a concert in Lisvane."));
    const b = await ingestOne(r, one("q2", "en", "Lisvane hosts book fair", "The book fair in Lisvane drew 300 visitors.", { hoursAgo: 3 }));
    expect(b.member.event_id).not.toBe(a.member.event_id);
  });

  test("Konu sözcüğü olmayan ama aynı kurum + yer içeren gerçek gelişme hâlâ eşleşir; temkinli olarak 'belirsiz' işaretlenir", async () => {
    const r = await ingestedRepo();
    const x = await ingestOne(r, one("toll", "en", "Norvik toll rises to 25, Kestria Disaster Agency says", "The Kestria Disaster Agency said the toll in Norvik rose to 25."));
    expect(x.member.event_id).toBe(r.eventOf("a1"));
    expect(x.member.match_status).toBe("uncertain");
    expect(x.member.reason.notes.join(" ")).toContain("konu");
  });
});

// ---------- 2. İddia dayanağı ----------
async function claimCtx() {
  const r = await ingestedRepo();
  const members = await r.repo.membersOf([r.eventOf("a1")]);
  const arts = await r.repo.getArticles(members.map((m) => m.article_id));
  const ents = await r.repo.entitiesFor(arts.map((a) => a.article_id));
  const ctx: VerifyContext = {
    articles: new Map(arts.map((a) => [a.article_id, a])),
    eventArticleIds: new Set(arts.map((a) => a.article_id)),
    entitiesByArticle: new Map(arts.map((a) => [a.article_id, ents.filter((e) => e.article_id === a.article_id)])),
    gz,
  };
  return { ctx, id: (k: string) => r.byKey.get(k)!.article_id };
}

describe("Bulgu 2 — bilinen yer adı aynı ifadedeki kişi/unvanı doğrulamaz", () => {
  test("“Kestriya Bakanı Mehmet Uydurma” → supported OLAMAZ", async () => {
    const { ctx, id } = await claimCtx();
    const v = verifyClaim({ text_tr: "Kestriya Bakanı Mehmet Uydurma depremi doğruladı.", sources: [{ article_id: id("a1"), quote: "Arama kurtarma çalışmaları sürüyor." }] }, ctx);
    expect(v.status).not.toBe("supported");
    expect(v.notes.join(" ")).toContain("Mehmet Uydurma");
  });

  test("Bilinen kişi adıyla bitişik uydurma ad da yakalanır", async () => {
    const { ctx, id } = await claimCtx();
    const v = verifyClaim({ text_tr: "Arman Velio ve Selim Hayali bölgeyi ziyaret etti.", sources: [{ article_id: id("a8"), quote: "آرمان ولیو، نخست‌وزیر کستریا، از منطقه زلزله‌زده بازدید کرد" }] }, ctx);
    expect(v.status).not.toBe("supported");
    expect(v.notes.join(" ")).toContain("Selim Hayali");
  });

  test("Kaynakta geçen kişi (farklı alfabede) tek başına hâlâ dayanaklıdır", async () => {
    const { ctx, id } = await claimCtx();
    const v = verifyClaim({ text_tr: "Arman Velio deprem bölgesini ziyaret etti.", sources: [{ article_id: id("a8"), quote: "آرمان ولیو، نخست‌وزیر کستریا، از منطقه زلزله‌زده بازدید کرد" }] }, ctx);
    expect(v.status).toBe("supported");
  });
});

// ---------- 3. Anlamlı gelişme ----------
describe("Bulgu 3 — saat/tarih/yüzde biçimi tek başına gelişme değildir", () => {
  test("Sayı çıkarımı: saat ve tarih olgu sayılmaz; yüzde biçimden bağımsız normalize edilir", () => {
    expect(extractFactNumbers("At 10:45 local time on 28 October, 19 people were killed.")).toEqual(["19"]);
    expect(extractFactNumbers("Saat 10.45'te açıklama yapıldı; 28 Ekim 2026 tarihinde 19 kişi öldü.")).toEqual(["19"]);
    expect(extractFactNumbers("Am 28.10.2026 um 10:45 Uhr")).toEqual([]);
    expect(extractFactNumbers("turnout 61%")).toEqual(["61%"]);
    expect(extractFactNumbers("katılım %61")).toEqual(["61%"]);
    expect(extractFactNumbers("participation de 61 pour cent")).toEqual(["61%"]);
    expect(extractFactNumbers("۱۹ نفر در ساعت ۱۰:۴۵")).toEqual(["19"]);
    expect(extractFactNumbers("12 markets closed and 19 decided to stay; 25 may leave")).toEqual(["12", "19", "25"]);
    expect(extractFactNumbers("28 октября погибли 19 человек")).toEqual(["19"]);
    expect(extractFactNumbers("Kestriya'da 15 Ekim'de 40 kişi")).toEqual(["40"]);
  });

  test("Yalnız saat ekleyen tekrar haber → anlamlı gelişme DEĞİL", async () => {
    const r = await ingestedRepo();
    const x = await ingestOne(r, one("time", "en", "Norvik earthquake: 19 killed, Kestria Disaster Agency says", "The Kestria Disaster Agency said at 10:45 local time that 19 people were killed in the Norvik earthquake."));
    expect(x.member.event_id).toBe(r.eventOf("a1"));
    expect(x.label).toBe("duplicate");
  });

  test("Gerçekten yeni sayı hâlâ anlamlı gelişmedir", async () => {
    const r = await ingestedRepo();
    const x = await ingestOne(r, one("new25", "en", "Norvik earthquake death toll rises to 25", "The Kestria Disaster Agency said on Thursday at 09:30 that the earthquake death toll in Norvik rose to 25."));
    expect(x.label).toBe("significant_update");
  });
});

// ---------- 4. Tarih filtresi ----------
describe("Bulgu 4 — bitiş tarihi seçilen günün tamamını kapsar", () => {
  test("Sunucu: yalın tarih UTC gün sınırına yuvarlanır; tam zaman damgası aynen kalır", () => {
    expect(dateRangeParam("2026-10-28", "from")).toBe("2026-10-28T00:00:00.000Z");
    expect(dateRangeParam("2026-10-28", "to")).toBe("2026-10-28T23:59:59.999Z");
    expect(dateRangeParam("2026-10-28T09:00:00+03:00", "to")).toBe("2026-10-28T06:00:00.000Z");
    expect(dateRangeParam("bozuk", "to")).toBeUndefined();
    expect(dateRangeParam(null, "to")).toBeUndefined();
  });

  test("Arayüz: yerel gün sınırları saat dilimi farkıyla hesaplanır (İstanbul UTC+3, New York UTC-4)", () => {
    expect(localDayBounds("2026-10-28", -180)).toEqual({ from: "2026-10-27T21:00:00.000Z", to: "2026-10-28T20:59:59.999Z" });
    expect(localDayBounds("2026-10-28", 240)).toEqual({ from: "2026-10-28T04:00:00.000Z", to: "2026-10-29T03:59:59.999Z" });
    expect(localDayBounds("28.10.2026", 0)).toBeNull();
  });

  test("API: to=<gün> o günün haberlerini içerir ve tarihsiz dışlananları bildirir", async () => {
    const { app, login } = await apiFixture();
    const c = await login("izleyici@t.local");
    const all = await (await app(new Request("http://localhost:8790/api/articles?limit=100", { headers: { cookie: c } }))).json();
    const sameDay = all.items.filter((a: { published_at: string | null }) => a.published_at?.startsWith("2026-10-28")).length;
    expect(sameDay).toBeGreaterThan(0);
    const res = await (await app(new Request("http://localhost:8790/api/articles?limit=100&to=2026-10-28", { headers: { cookie: c } }))).json();
    expect(res.items.filter((a: { published_at: string | null }) => a.published_at?.startsWith("2026-10-28")).length).toBe(sameDay);
    expect(res.excluded_undated).toBe(1); // b5: yayın tarihi yok
    const noDate = await (await app(new Request("http://localhost:8790/api/articles?limit=100", { headers: { cookie: c } }))).json();
    expect(noDate.excluded_undated).toBe(0);
  });
});

// ---------- 5. Son başarılı analiz ----------
async function apiFixture(llm: LlmProvider = new MockLlmProvider()) {
  const r = await ingestedRepo();
  for (const [email, role] of [["admin@t.local", "admin"], ["analist@t.local", "analyst"], ["izleyici@t.local", "viewer"]] as const) {
    await createUser(r.repo, { email, name: email, role, password: "dogru-at-pil-zimba" });
  }
  initLlmStats(llm.name, llm.model, llm.mock);
  const app = createApp({ cfg: loadConfig({ SINYAL_RATE_ANALYSIS_PER_MIN: "50" }), repo: r.repo, gz, provider: new MockDataProvider(now), llm });
  const login = async (email: string) => {
    const res = await app(new Request("http://localhost:8790/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "dogru-at-pil-zimba" }) }), "10.7." + Math.floor(Math.random() * 250) + ".1");
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };
  return { ...r, app, login };
}

describe("Bulgu 5 — son çalıştırma başarısız olsa da önceki iddialar kaybolmaz", () => {
  test("Başarılı → başarısız çalıştırma sonrası iddialar ve hata ayrı gösterilir", async () => {
    let fail = false;
    const mock = new MockLlmProvider();
    const llm: LlmProvider = {
      name: "mock", model: "mock-deterministic", mock: true,
      complete: (m, o) => (fail ? Promise.reject(new LlmError("LLM HTTP 401", "http", false)) : mock.complete(m, o)),
    };
    const { app, login, eventOf } = await apiFixture(llm);
    const c = await login("analist@t.local");
    const ev = eventOf("a1");
    const post = () => app(new Request(`http://localhost:8790/api/events/${ev}/analyze`, { method: "POST", headers: { "Content-Type": "application/json", cookie: c }, body: "{}" }));
    expect((await post()).status).toBe(200);
    fail = true;
    expect((await post()).status).toBe(502);
    const d = await (await app(new Request(`http://localhost:8790/api/events/${ev}`, { headers: { cookie: c } }))).json();
    expect(d.analysis.status).toBe("ok");
    expect(d.claims.length).toBeGreaterThan(0);
    expect(d.claims.every((x: { analysis_run_id: string }) => x.analysis_run_id === d.analysis.run_id)).toBe(true);
    expect(d.last_run.status).toBe("error");
    expect(d.last_run.run_id).not.toBe(d.analysis.run_id);
  });
});

// ---------- 6. Sayfalama ----------
describe("Bulgu 6 — sayfalama", () => {
  test("pageInfo: aralık, önceki/sonraki ve son sayfa", () => {
    expect(pageInfo(45, 0, 20)).toEqual({ from: 1, to: 20, total: 45, prevOffset: null, nextOffset: 20, isLast: false, outOfRange: false });
    expect(pageInfo(45, 40, 20)).toEqual({ from: 41, to: 45, total: 45, prevOffset: 20, nextOffset: null, isLast: true, outOfRange: false });
    expect(pageInfo(0, 0, 20)).toEqual({ from: 0, to: 0, total: 0, prevOffset: null, nextOffset: null, isLast: true, outOfRange: false });
    expect(pageInfo(10, 40, 20).outOfRange).toBe(true);
  });

  test("API: offset/limit ile sayfalar örtüşmez ve toplamı kapsar", async () => {
    const { app, login } = await apiFixture();
    const c = await login("izleyici@t.local");
    const ids: string[] = [];
    let total = 0;
    for (let off = 0; off < 30; off += 8) {
      const p = await (await app(new Request(`http://localhost:8790/api/articles?limit=8&offset=${off}`, { headers: { cookie: c } }))).json();
      total = p.total;
      ids.push(...p.items.map((a: { article_id: string }) => a.article_id));
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(total);
    const ev = await (await app(new Request("http://localhost:8790/api/events?limit=3&offset=3", { headers: { cookie: c } }))).json();
    expect(ev.items.length).toBe(2);
    expect(ev.total).toBe(5);
  });
});

// ---------- 7. Özgün metin ----------
describe("Bulgu 7 — özgün metin aynen korunur, eşleştirme ayrı anahtarla yapılır", () => {
  const NFD_TITLE = "Kestriya'nın Norvik kentinde deprem: yaralılar hastanelerde tedavi altında".normalize("NFD"); // ı/ğ/ş ayrık işaretli
  const FA_BODY = "شمار کشته‌شدگان زلزله در نورویک‏ به ۱۹ نفر رسید.‎";

  test("NFD, RLM/LRM ve ZWNJ saklanan haberde birebir korunur", async () => {
    const repo = new MemoryRepo();
    const res = await runIngestion(one("nfd", "fa", NFD_TITLE, FA_BODY, { source: "demo-fa-khabar", url: "https://khabar-fa.example/x" }), repo, gz, { now });
    const a = (await repo.getArticles(Object.keys(res.labels)))[0]!;
    expect(a.title_original).toBe(NFD_TITLE);
    expect(a.body_original).toBe(FA_BODY);
    expect(a.body_original).toContain("‌");
    expect(a.body_original).toContain("‏");
    expect(a.body_original).toContain("‎");
  });

  test("Eşleştirme anahtarı NFC/NFD ve yön işaretlerinden bağımsızdır", () => {
    expect(matchKey(NFD_TITLE, "tr")).toBe(matchKey(NFD_TITLE.normalize("NFC"), "tr"));
    expect(matchKey("نورویک‏", "fa")).toBe(matchKey("نورویک", "fa"));
  });

  test("NFC sorgu NFD saklanmış haberi bulur; aynı URL'nin NFC sürümü kopya oluşturmaz", async () => {
    const repo = new MemoryRepo();
    await runIngestion(one("nfd", "tr", NFD_TITLE, "Gövde.", { source: "demo-tr-haber", url: "https://haber-tr.example/n" }), repo, gz, { now });
    expect((await repo.searchArticles({ q: "kentinde deprem", limit: 10, offset: 0 })).total).toBe(1);
    const again = await runIngestion(one("nfc", "tr", NFD_TITLE.normalize("NFC"), "Gövde.", { source: "demo-tr-haber", url: "https://haber-tr.example/n" }), repo, gz, { now });
    expect(again.run.inserted).toBe(0);
    expect(again.run.skipped_duplicates).toBe(1);
  });
});

// ---------- Mock kanıt göstergesi ----------
describe("Mock iddiaları gerçek doğrulama gibi sayılmaz", () => {
  test("Mock çalıştırmada claims_supported 0 kaydedilir ve her iddiada uyarı notu bulunur", async () => {
    const r = await ingestedRepo();
    const res = await analyzeEvent(r.eventOf("a1"), { repo: r.repo, gz, llm: new MockLlmProvider() }, { timeoutMs: 50, maxRetries: 0, sendFullText: false, maxCharsPerArticle: 500 }, "u");
    expect(res.run.claims_total).toBeGreaterThan(0);
    expect(res.run.claims_supported).toBe(0);
    for (const c of res.claims) expect(c.check_notes.join(" ")).toContain("gerçek doğrulama değildir");
  });
});
