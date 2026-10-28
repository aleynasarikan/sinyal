import { describe, expect, test } from "bun:test";
import { verifyClaim, type VerifyContext } from "../src/claims/verify.ts";
import { gz, ingestedRepo } from "./helpers.ts";

async function ctxFor(eventKey: string) {
  const r = await ingestedRepo();
  const members = await r.repo.membersOf([r.eventOf(eventKey)]);
  const arts = await r.repo.getArticles(members.map((m) => m.article_id));
  const ents = await r.repo.entitiesFor(arts.map((a) => a.article_id));
  const ctx: VerifyContext = {
    articles: new Map(arts.map((a) => [a.article_id, a])),
    eventArticleIds: new Set(arts.map((a) => a.article_id)),
    entitiesByArticle: new Map(arts.map((a) => [a.article_id, ents.filter((e) => e.article_id === a.article_id)])),
    gz,
  };
  return { ...r, ctx, id: (k: string) => r.byKey.get(k)!.article_id };
}

describe("İddia–kaynak denetimi", () => {
  test("Birebir alıntı + sayılar kaynakta → dayanaklı", async () => {
    const { ctx, id } = await ctxFor("a1");
    const v = verifyClaim({ text_tr: "Ajansa göre depremde 12 kişi öldü, 140 kişi yaralandı.", sources: [{ article_id: id("a2"), quote: "The Kestria Disaster Agency said 12 people were killed and 140 injured." }] }, ctx);
    expect(v.status).toBe("supported");
  });

  test("Arapça alıntı harekeli/harekesiz farkına rağmen bulunur", async () => {
    const { ctx, id } = await ctxFor("a1");
    const v = verifyClaim({ text_tr: "Depremde 12 kişi öldü.", sources: [{ article_id: id("a4"), quote: "إن 12 شخصًا لقوا حتفهم" }] }, ctx);
    expect(v.sources[0]!.support).toBe("supported");
  });

  test("Kaynak kimliği olmayan iddia → kaynaksız", async () => {
    const { ctx } = await ctxFor("a1");
    expect(verifyClaim({ text_tr: "Deprem oldu.", sources: [] }, ctx).status).toBe("no_source");
  });

  test("Olayda olmayan/uydurma kaynak kimliği → bulunamadı", async () => {
    const { ctx, id } = await ctxFor("a1");
    const v = verifyClaim({ text_tr: "Anlaşma 15 yıllık.", sources: [{ article_id: id("b1"), quote: "The 15-year agreement covers joint management" }] }, ctx);
    expect(v.sources[0]!.support).toBe("not_found");
    expect(v.status).toBe("unverified");
    const v2 = verifyClaim({ text_tr: "Deprem oldu.", sources: [{ article_id: "art_uydurma", quote: "whatever text here" }] }, ctx);
    expect(v2.sources[0]!.support).toBe("not_found");
  });

  test("Alıntı kaynak metinde yoksa bulunamadı", async () => {
    const { ctx, id } = await ctxFor("a1");
    const v = verifyClaim({ text_tr: "Bina çöktü.", sources: [{ article_id: id("a2"), quote: "Dozens of buildings collapsed in the old town" }] }, ctx);
    expect(v.sources[0]!.support).toBe("not_found");
  });

  test("Model kaynakta olmayan sayı eklerse → çelişki/doğrulanamadı", async () => {
    const { ctx, id } = await ctxFor("a1");
    const v = verifyClaim({ text_tr: "Depremde 25 kişi öldü.", sources: [{ article_id: id("a2"), quote: "The Kestria Disaster Agency said 12 people were killed and 140 injured." }] }, ctx);
    expect(v.status).toBe("contradicted");
    const v2 = verifyClaim({ text_tr: "Depremde 12 kişi öldü, 300 bina yıkıldı.", sources: [{ article_id: id("a2"), quote: "The Kestria Disaster Agency said 12 people were killed and 140 injured." }] }, ctx);
    expect(v2.status).toBe("unverified");
    expect(v2.notes.join(" ")).toContain("300");
  });

  test("Model kaynakta olmayan kişi eklerse (sözlükte olan) → doğrulanamadı", async () => {
    const { ctx, id } = await ctxFor("a1");
    const v = verifyClaim({ text_tr: "Sofia Brandt deprem bölgesini ziyaret etti.", sources: [{ article_id: id("a1"), quote: "Arama kurtarma çalışmaları sürüyor." }] }, ctx);
    expect(v.status).toBe("unverified");
    expect(v.notes.join(" ")).toContain("Sofia Brandt");
  });

  test("Model sözlük dışı uydurma ad eklerse → doğrulanamayan ad", async () => {
    const { ctx, id } = await ctxFor("a1");
    const v = verifyClaim({ text_tr: "Bakan Mehmet Uydurmaoğlu açıklama yaptı.", sources: [{ article_id: id("a1"), quote: "Arama kurtarma çalışmaları sürüyor." }] }, ctx);
    expect(v.status).toBe("unverified");
    expect(v.notes.join(" ")).toContain("Mehmet Uydurmaoğlu");
  });

  test("Kaynakta geçen kişi farklı alfabede olsa da (sözlük üzerinden) desteklenir", async () => {
    const { ctx, id } = await ctxFor("a1");
    const v = verifyClaim({ text_tr: "Arman Velio deprem bölgesini ziyaret etti.", sources: [{ article_id: id("a8"), quote: "آرمان ولیو، نخست‌وزیر کستریا، از منطقه زلزله‌زده بازدید کرد" }] }, ctx);
    expect(v.status).toBe("supported");
  });

  test("Kısa/boş alıntı denetlenemez", async () => {
    const { ctx, id } = await ctxFor("a1");
    const v = verifyClaim({ text_tr: "Deprem oldu.", sources: [{ article_id: id("a1"), quote: "" }] }, ctx);
    expect(v.sources[0]!.support).toBe("unverifiable");
  });
});
