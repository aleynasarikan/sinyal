import { describe, expect, test } from "bun:test";
import { MOCK_ARTICLES } from "../data/mock/articles.ts";
import { runIngestion } from "../src/pipeline/ingest.ts";
import { MockDataProvider } from "../src/providers/mock.ts";
import { gz, ingestedRepo, now } from "./helpers.ts";

describe("Çok dilli olay eşleştirme", () => {
  test("Yedi dildeki haberler beklenen olaylara bağlanır (sentetik beklenti)", async () => {
    const { eventOf } = await ingestedRepo();
    const groups = new Map<string, Set<string>>();
    for (const m of MOCK_ARTICLES) groups.set(m.expect.event, (groups.get(m.expect.event) ?? new Set()).add(eventOf(m.key)));
    for (const [, evs] of groups) expect(evs.size).toBe(1); // her beklenen olay tek SİNYAL olayına düştü
    expect(new Set([...groups.values()].map((s) => [...s][0])).size).toBe(groups.size); // olaylar ayrık
  });

  test("Deprem olayı tr/en/ar/ru/fr/de/fa haberlerini içerir", async () => {
    const { repo, eventOf } = await ingestedRepo();
    const members = await repo.membersOf([eventOf("a1")]);
    const arts = await repo.getArticles(members.map((m) => m.article_id));
    expect(new Set(arts.map((a) => a.lang_detected))).toEqual(new Set(["tr", "en", "ar", "ru", "fr", "de", "fa"]));
  });

  test("Aynı yerdeki farklı olay (Norvik depremi vs orman yangını) birleştirilmez", async () => {
    const { eventOf } = await ingestedRepo();
    expect(eventOf("c1")).not.toBe(eventOf("a1"));
    expect(eventOf("c3")).not.toBe(eventOf("a8"));
  });

  test("Aynı kişileri/ülkeleri paylaşan farklı olay (anlaşma vs siber saldırı) birleştirilmez", async () => {
    const { eventOf } = await ingestedRepo();
    expect(eventOf("d1")).not.toBe(eventOf("b1"));
    expect(eventOf("a7")).not.toBe(eventOf("b1")); // Arman Velio iki olayda da geçiyor
  });

  test("Her üyelik eşleştirme gerekçesi taşır", async () => {
    const { repo, eventOf, byKey } = await ingestedRepo();
    const m = (await repo.memberOfArticles([byKey.get("a4")!.article_id]))[0]!;
    expect(m.event_id).toBe(eventOf("a1"));
    expect(m.reason.shared_places).toEqual(expect.arrayContaining(["Norvik", "Kestriya"]));
    expect(m.reason.score).toBeGreaterThan(0.6);
  });

  test("Olay kimliği SİNYAL'e aittir (sağlayıcı küme kimliği kullanılmaz)", async () => {
    const { eventOf } = await ingestedRepo();
    expect(eventOf("a1")).toMatch(/^evt_[0-9a-f]{24}$/);
  });
});

describe("İdempotency", () => {
  test("Aynı parti tekrar işlenince kopya oluşmaz", async () => {
    const { repo } = await ingestedRepo();
    const before = await repo.searchArticles({ limit: 1000, offset: 0 });
    const ev1 = await repo.listEvents({ limit: 100, offset: 0 });
    const r2 = await runIngestion(new MockDataProvider(now), repo, gz, { now });
    expect(r2.run.inserted).toBe(0);
    expect(r2.run.skipped_duplicates).toBe(MOCK_ARTICLES.length);
    expect((await repo.searchArticles({ limit: 1000, offset: 0 })).total).toBe(before.total);
    expect((await repo.listEvents({ limit: 100, offset: 0 })).total).toBe(ev1.total);
  });

  test("Aynı partide yinelenen URL (izleme parametresiyle) tek kayıt olur", async () => {
    const { MemoryRepo } = await import("../src/store/memory.ts");
    const repo = new MemoryRepo();
    const base = MOCK_ARTICLES[0]!;
    const provider = {
      name: "mock", status: async () => ({ provider: "mock", state: "ok" as const, demo: true, message: "" }),
      fetchBatch: async () => ({
        ok: true as const, demo: true, sources: [],
        articles: [base.url, base.url + "?utm_source=x#top"].map((url, i) => ({ external_id: "x" + i, source_id: base.source_id, url, title: base.title, body: base.body, lang_declared: "tr", published_at: now().toISOString(), date_estimated: false })),
      }),
    };
    const r = await runIngestion(provider, repo, gz, { now });
    expect(r.run.inserted).toBe(1);
    expect(r.run.skipped_duplicates).toBe(1);
  });

  test("İlk görülme zamanı yeniden alımda korunur", async () => {
    const { repo, byKey } = await ingestedRepo();
    const later = () => new Date(now().getTime() + 3_600_000);
    await runIngestion(new MockDataProvider(now), repo, gz, { now: later });
    const a = (await repo.getArticles([byKey.get("a1")!.article_id]))[0]!;
    expect(a.first_seen_at).toBe(now().toISOString());
  });
});
