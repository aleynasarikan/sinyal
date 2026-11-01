import { describe, expect, test } from "bun:test";
import { denialPhrases } from "../src/pipeline/match.ts";
import { atlasEvent } from "../src/spread/atlas.ts";
import { eventSpread } from "../src/spread/load.ts";
import { MOCK_ARTICLES } from "../data/mock/articles.ts";
import { NOW, ingestedRepo } from "./helpers.ts";

async function gapOf() {
  const r = await ingestedRepo();
  const ev = r.eventOf("f1");
  const s = await eventSpread(r.repo, ev, NOW.getTime());
  const a = atlasEvent({ event_id: ev, title_tr: "Sınır kapatma" }, s);
  const id = (k: string) => r.byKey.get(k)!.article_id;
  return { ...r, ev, s, a, id };
}

describe("Yalanlama ifadeleri", () => {
  test("Dillere göre yakalanır", () => {
    expect(denialPhrases("Doravia denied the reports", "en")).toEqual(["denied"]);
    expect(denialPhrases("Dorawien dementiert", "de")).toEqual(["dementier"]);
    expect(denialPhrases("Bakanlık haberleri yalanladı", "tr")).toEqual(["yalanla"]);
    expect(denialPhrases("نفت الحكومة", "ar")).toEqual(["نفت"]);
  });
  test("Kelime içinde geçen kısa kök yalanlama sayılmaz", () => {
    expect(denialPhrases("الانفتاح الاقتصادي", "ar")).toEqual([]);
  });
  test("Demo verideki iddia haberlerinin hiçbiri yalanlama sayılmaz", () => {
    const flagged = MOCK_ARTICLES.filter((m) => denialPhrases(m.title + "\n" + m.body, m.lang).length).map((m) => m.key);
    expect(flagged.sort()).toEqual(["g1", "g2", "g3"]);
  });
});

describe("Düzeltme boşluğu — E5", () => {
  test("Yalanlamalar aynı olaya bağlanır ama iddia zincirine karışmaz", async () => {
    const { eventOf, s, id } = await gapOf();
    for (const k of ["g1", "g2", "g3"]) expect(eventOf(k)).toBe(eventOf("f1"));
    const claimIds = new Set(s.nodes.map((n) => n.article_id));
    for (const k of ["g1", "g2", "g3"]) expect(claimIds.has(id(k))).toBe(false);
    expect(s.first_seen).toBe(id("f1"));
  });

  test("Yalanlama kendi zincirini kurar (atıfla)", async () => {
    const { s, id } = await gapOf();
    const c = s.correction!;
    expect(c.first_seen).toBe(id("g1"));
    expect(c.roots).toEqual([id("g1")]);
    const node = (k: string) => c.nodes.find((n) => n.article_id === id(k))!;
    expect(node("g2").parent).toBe(id("g1"));
    expect(node("g3").parent).toBe(id("g1"));
  });

  test("Kapsama ve boşluk ülke/dil olarak hesaplanır", async () => {
    const { a } = await gapOf();
    const g = a.correction!;
    expect(g.covered.sort()).toEqual(["DE", "GB", "TR"]);
    expect(g.gap.sort()).toEqual(["IR", "QA", "RU", "US"]);
    expect(g.gap_langs.sort()).toEqual(["ar", "fa", "ru"]);
    expect(g.coverage).toBe(0.43);
  });

  test("Öncelikli hedef: bilgiyi değiştirip Arapçaya taşıyan kaynak", async () => {
    const { a, id } = await gapOf();
    const t = a.correction!.targets;
    expect(t[0]!.cc).toBe("QA");
    expect(t[0]!.article_id).toBe(id("f5"));
    expect(t[0]!.reasons).toContain("changed");
    expect(t[0]!.reasons).toContain("brought_lang");
    expect(t[0]!.changes.some((c) => c.kind === "number_changed" && c.to === "400")).toBe(true);
    expect(t.at(-1)!.cc).toBe("US"); // yalnız kopyalayan, yeni dil getirmeyen en sona
  });

  test("Yalanlamadan sonra iddiayı yayanlar listelenir", async () => {
    const { a, id } = await gapOf();
    expect(a.correction!.after.map((x) => x.article_id).sort()).toEqual([id("f6"), id("f7"), id("f8")].sort());
  });

  test("Yalanlaması olmayan olayda boşluk verisi yok", async () => {
    const r = await ingestedRepo();
    const s = await eventSpread(r.repo, r.eventOf("a1"), NOW.getTime());
    expect(s.correction).toBeNull();
    expect(atlasEvent({ event_id: "x", title_tr: "" }, s).correction).toBeNull();
  });
});
