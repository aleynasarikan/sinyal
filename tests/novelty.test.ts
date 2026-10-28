import { describe, expect, test } from "bun:test";
import { MOCK_ARTICLES } from "../data/mock/articles.ts";
import { detectConflicts } from "../src/claims/conflicts.ts";
import { dateQuality } from "../src/pipeline/ingest.ts";
import { gz, ingestedRepo } from "./helpers.ts";

describe("Yeni gelişme sınıflandırması", () => {
  test("Sentetik setteki tüm beklenen etiketler üretilir", async () => {
    const { labelOf } = await ingestedRepo();
    for (const m of MOCK_ARTICLES) expect([m.key, labelOf(m.key)]).toEqual([m.key, m.expect.novelty as never]);
  });

  test("Yeni sayı + yeni kişi → anlamlı gelişme (a7)", async () => {
    const { repo, eventOf, byKey } = await ingestedRepo();
    const ups = await repo.updatesOf(eventOf("a7"));
    const u = ups.find((x) => x.article_id === byKey.get("a7")!.article_id)!;
    expect(u.label).toBe("significant_update");
    expect(u.new_facts).toEqual(expect.arrayContaining(["sayı: 19", "sayı: 210", "varlık: Arman Velio"]));
  });

  test("Yeniden yayın ve başka dilde aynı bilgi → tekrar haber", async () => {
    const { labelOf } = await ingestedRepo();
    expect(labelOf("a3")).toBe("duplicate");
    expect(labelOf("a8")).toBe("duplicate");
  });

  test("İddia ifadesiyle gelen yeni sayı → doğrulanmamış iddia (a9)", async () => {
    const { labelOf } = await ingestedRepo();
    expect(labelOf("a9")).toBe("unverified_claim");
  });

  test("Tarihsiz, gelecek tarihli ve kayıtsız kaynaklı haber yeni gelişme dayanağı yapılmaz", async () => {
    const { labelOf } = await ingestedRepo();
    expect(labelOf("b5")).toBe("uncertain_date_or_source");
    expect(labelOf("b6")).toBe("uncertain_date_or_source");
    expect(labelOf("d2")).toBe("uncertain_date_or_source");
  });
});

describe("Eksik veya hatalı yayın tarihi", () => {
  const fetched = "2026-10-28T12:00:00.000Z";
  test("yok", () => expect(dateQuality(null, false, fetched)).toEqual({ iso: null, q: "missing" }));
  test("çözümlenemez", () => expect(dateQuality("dün akşam", false, fetched)).toEqual({ iso: null, q: "invalid" }));
  test("gelecekte", () => expect(dateQuality("2026-11-30T00:00:00Z", false, fetched).q).toBe("future"));
  test("tahmini", () => expect(dateQuality("2026-10-27T00:00:00Z", true, fetched).q).toBe("estimated"));
  test("kesin", () => expect(dateQuality("2026-10-27T00:00:00+03:00", false, fetched)).toEqual({ iso: "2026-10-26T21:00:00.000Z", q: "exact" }));
});

describe("Kaynaklar arası çelişki", () => {
  test("Can kaybı: yakın zamanlı 21 vs 19 → çelişki olarak gösterilir, gizlenmez", async () => {
    const { repo, eventOf } = await ingestedRepo();
    const members = await repo.membersOf([eventOf("a1")]);
    const c = detectConflicts(await repo.getArticles(members.map((m) => m.article_id)), gz);
    expect(c).toHaveLength(1);
    expect(c[0]!.kind).toBe("conflict");
    expect(c[0]!.values.map((v) => v.value)).toEqual(["12", "19", "21"]);
  });
});
