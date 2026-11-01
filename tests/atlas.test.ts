import { describe, expect, test } from "bun:test";
import { atlasEvent, countrySummary } from "../src/spread/atlas.ts";
import { eventSpread } from "../src/spread/load.ts";
import pointsJson from "../data/geo/country_points.json" with { type: "json" };
import shapesJson from "../data/geo/countries.json" with { type: "json" };
import { NOW, ingestedRepo } from "./helpers.ts";

async function atlasOf(key: string) {
  const r = await ingestedRepo();
  const evId = r.eventOf(key);
  const ev = (await r.repo.getEvent(evId))!;
  return { ...r, a: atlasEvent(ev, await eventSpread(r.repo, evId, NOW.getTime())) };
}

describe("Yayılım atlası — ülke düzeyi", () => {
  test("E5: ilk görülen DE, 7 ülke, ülkeler arası bağlantılar zaman sıralı", async () => {
    const { a } = await atlasOf("f1");
    expect(a.first!.cc).toBe("DE");
    expect(new Set(a.countries)).toEqual(new Set(["DE", "GB", "US", "QA", "IR", "RU", "TR"]));
    const pairs = a.links.map((l) => `${l.from_cc}>${l.to_cc}`);
    expect(pairs).toContain("DE>GB");
    expect(pairs).toContain("GB>QA");
    expect(pairs).toContain("DE>DE"); // aynı ülke içi aktarım da korunur (haritada yay çizilmez)
  });

  test("Mutasyon önemi bağlantıya ve ulaşılan düğüme taşınır", async () => {
    const { a } = await atlasOf("f1");
    const gbqa = a.links.find((l) => l.from_cc === "GB" && l.to_cc === "QA")!;
    expect(gbqa.severity).toBe("high");
    expect(gbqa.mutations.join(" ")).toContain("40 → 400");
    expect(a.nodes.find((n) => n.cc === "QA")!.severity).toBe("high");
    expect(a.links.find((l) => l.from_cc === "GB" && l.to_cc === "US")!.kind).toBe("copy");
  });

  test("Ülkesi bilinmeyen kaynak haritaya konmaz, sayısı bildirilir", async () => {
    const { a } = await atlasOf("d1");
    expect(a.unmapped).toBe(1); // kayıtsız blog
    expect(a.nodes.every((n) => n.cc)).toBe(true);
  });

  test("Ülke özeti haber ve ilk görülme sayılarını toplar", async () => {
    const { a } = await atlasOf("f1");
    const s = countrySummary([a]);
    expect(s.DE).toEqual({ articles: 2, events: 1, first_seen: 1 });
    expect(s.GB!.first_seen).toBe(0);
  });
});

describe("Atlas coğrafi verisi", () => {
  test("Demo yayıncı ülkelerinin hepsinin çizim noktası var", () => {
    const pts = pointsJson as unknown as Record<string, [number, number]>;
    for (const cc of ["TR", "GB", "US", "QA", "RU", "FR", "DE", "IR"]) expect(pts[cc]).toBeDefined();
    expect(pts.RU![0]).toBeGreaterThan(0); // tarih değiştirme hattı düzeltmesi
  });
  test("Hiçbir halka 180° hattını boydan boya kesmez", () => {
    const bad: string[] = [];
    for (const f of (shapesJson as any).features) for (const poly of f.geometry.coordinates) for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) bad.push(f.properties.iso);
    }
    expect(bad).toEqual([]);
  });
});
