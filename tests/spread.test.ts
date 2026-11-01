import { describe, expect, test } from "bun:test";
import { eventSpread } from "../src/spread/load.ts";
import { citeKey, computeSpread } from "../src/spread/spread.ts";
import { NOW, ingestedRepo } from "./helpers.ts";

async function spreadOf(eventKey: string) {
  const r = await ingestedRepo();
  const s = await eventSpread(r.repo, r.eventOf(eventKey), NOW.getTime());
  const id = (k: string) => r.byKey.get(k)!.article_id;
  const node = (k: string) => s.nodes.find((n) => n.article_id === id(k))!;
  return { ...r, s, id, node };
}

describe("Yayılım — E5 sınır kapatma iddiası", () => {
  test("İlk görülen kaynak teyitsiz blog; tek kök", async () => {
    const { s, id, node } = await spreadOf("f1");
    expect(s.first_seen).toBe(id("f1"));
    expect(s.roots).toEqual([id("f1")]);
    expect(node("f1").hedges.length).toBeGreaterThan(0);
  });

  test("Atıf zinciri diller arasında izlenir", async () => {
    const { node, id } = await spreadOf("f1");
    expect(node("f2").parent).toBe(id("f1"));
    expect(node("f3").parent).toBe(id("f2"));
    expect(node("f5").parent).toBe(id("f3"));
    expect(node("f6").parent).toBe(id("f5"));
    expect(node("f7").parent).toBe(id("f6"));
    expect(node("f8").parent).toBe(id("f1"));
    expect(node("f5").edge!.kind).toBe("citation");
    expect(node("f7").generation).toBe(5);
  });

  test("Birebir yeniden yayın kopya olarak bağlanır (atıftan önce)", async () => {
    const { node, id } = await spreadOf("f1");
    expect(node("f4").parent).toBe(id("f3"));
    expect(node("f4").edge!.kind).toBe("copy");
  });

  test("Teyitsizlik ifadesinin düşmesi yüksek önemli mutasyon", async () => {
    const { node, s, id } = await spreadOf("f1");
    expect(node("f3").mutations.map((m) => m.kind)).toContain("hedge_dropped");
    expect(s.alerts.find((a) => a.article_id === id("f3"))!.severity).toBe("high");
  });

  test("Sayı şişmesi: 40 → 400", async () => {
    const { node } = await spreadOf("f1");
    const m = node("f5").mutations.find((x) => x.kind === "number_changed")!;
    expect(m).toMatchObject({ from: "40", to: "400", severity: "high" });
    expect(node("f7").mutations.map((x) => x.kind)).toEqual(["number_dropped"]);
  });

  test("R sağdan sansürlü hesaplanır, ivme hızlanıyor", async () => {
    const { s } = await spreadOf("f1");
    expect(s.stats.r_eligible).toBe(6); // son 3 saatteki f7, f8 hariç
    expect(s.stats.r_estimate).toBe(1.17);
    expect(s.momentum.label).toBe("accelerating");
    expect(s.stats.langs.length).toBe(6);
  });
});

describe("Yayılım — yanlış alarm ve belirsizlik koruması", () => {
  test("Yalnız ortak olguya dayanan zayıf bağ sahte derin zincir üretmez", async () => {
    const { node, id } = await spreadOf("a1");
    for (const k of ["a2", "a4", "a5", "a6"]) {
      expect(node(k).parent).toBe(id("a1"));
      expect(node(k).edge!.kind).toBe("shared_facts");
    }
  });

  test("Zayıf bağda teyitsizlik değişimi mutasyon sayılmaz, sayı farkı düşük önemlidir", async () => {
    const { s } = await spreadOf("a1");
    expect(s.alerts.some((a) => a.kind === "hedge_dropped")).toBe(false);
    expect(s.alerts.every((a) => a.severity === "low")).toBe(true);
  });

  test("Tarihi belirsiz haberler zincire yerleştirilmez", async () => {
    const { s, id } = await spreadOf("b1");
    expect(s.unplaced.sort()).toEqual([id("b5"), id("b6")].sort());
    expect(s.nodes.filter((n) => !n.placed).every((n) => n.generation === null && n.parent === null)).toBe(true);
  });

  test("Eski olay sönümlenmiş görünür", async () => {
    const { s } = await spreadOf("b1");
    expect(s.momentum.label).toBe("dormant");
  });

  test("Boş olay güvenle işlenir", () => {
    const s = computeSpread({ event_id: "x", articles: [], entities: [], sources: [], nowMs: NOW.getTime() });
    expect(s).toMatchObject({ first_seen: null, roots: [], stats: { placed: 0, generations: 0, r_estimate: null } });
  });

  test("Atıf anahtarı ülke etiketini atar", () => {
    expect(citeKey("Demo Zeitung (DE)")).toBe("demo zeitung");
  });
});
