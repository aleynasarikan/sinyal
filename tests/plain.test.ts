import { describe, expect, test } from "bun:test";
import { changeText, countryName, duration, eventLine, sourceName, status, visibleChanges, weakLinkNote } from "../src/web/plain.ts";

describe("Sade dil katmanı", () => {
  test("Ülke kodu Türkçe ada çevrilir; bilinmeyen kod aynen kalır", () => {
    expect(countryName("DE")).toBe("Almanya");
    expect(countryName("GB")).toBe("Birleşik Krallık");
    expect(countryName("XK")).toBe("Kosova");
    expect(countryName("ZZ")).toBe("ZZ");
  });
  test("Yayıncı adındaki ülke etiketi atılır", () => {
    expect(sourceName("Demo Zeitung (DE)")).toBe("Demo Zeitung");
  });
  test("Durum etiketleri teknik terim içermez", () => {
    for (const m of ["accelerating", "steady", "slowing", "dormant"]) {
      const s = status(m);
      expect(s.label).not.toMatch(/\bR\b|ivme|nesil|momentum/);
      expect(s.hint.length).toBeGreaterThan(10);
    }
    expect(status("accelerating")).toMatchObject({ label: "Hızla yayılıyor", tone: "bad" });
  });
  test("Değişiklikler sade cümleye çevrilir; küçük farklar gizlenir", () => {
    expect(changeText({ kind: "hedge_dropped", severity: "high" })).toContain("kesin bilgi gibi");
    expect(changeText({ kind: "number_changed", severity: "high", from: "40", to: "400" })).toBe("Rakam değişti: 40 → 400");
    expect(changeText({ kind: "number_dropped", severity: "low", from: "400" })).toBeNull();
    expect(changeText({ kind: "number_added", severity: "low", to: "21" })).toBeNull();
    expect(changeText({ kind: "hedge_added", severity: "low" })).toBeNull();
  });
  test("Görünür değişiklik sayısı ve olay satırı", () => {
    const e = { first: { cc: "DE" }, countries: ["DE", "GB", "QA"], hours_span: 8, links: [
      { changes: [{ kind: "hedge_dropped", severity: "high" }] },
      { changes: [{ kind: "number_dropped", severity: "low" }] },
    ] };
    expect(visibleChanges(e)).toBe(1);
    expect(eventLine(e)).toBe("İlk çıktığı yer: Almanya · 3 ülkeye ulaştı · 8 saat");
    expect(eventLine({ first: null, countries: ["RU"], hours_span: null })).toBe("Tek ülkede kaldı");
  });
  test("Süre ve zayıf bağlantı notu", () => {
    expect(duration(0.5)).toBe("30 dakika");
    expect(duration(25)).toBe("25 saat");
    expect(duration(72)).toBe("3 gün");
    expect(weakLinkNote("shared_facts")).toContain("Olası");
    expect(weakLinkNote("citation")).toBeNull();
  });
});
