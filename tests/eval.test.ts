import { describe, expect, test } from "bun:test";
import { bcubed, claimSupportAccuracy, crossLingualRecall, falseMergeRate, nameFidelity, perClassPR } from "../src/eval/metrics.ts";

const m = (o: Record<string, string>) => new Map(Object.entries(o));

describe("Değerlendirme metrikleri", () => {
  test("B-cubed: mükemmel kümeleme = 1", () => {
    expect(bcubed(m({ a: "1", b: "1", c: "2" }), m({ a: "x", b: "x", c: "y" }))).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });
  test("B-cubed: her şeyi tek kümeye koymak precision'ı düşürür", () => {
    const r = bcubed(m({ a: "1", b: "1", c: "2", d: "2" }), m({ a: "x", b: "x", c: "x", d: "x" }));
    expect(r.recall).toBe(1);
    expect(r.precision).toBe(0.5);
  });
  test("B-cubed: tekil kümeler recall'u düşürür", () => {
    const r = bcubed(m({ a: "1", b: "1" }), m({ a: "x", b: "y" }));
    expect(r).toMatchObject({ precision: 1, recall: 0.5 });
  });
  test("Diller arası recall yalnız farklı dilli çiftleri sayar", () => {
    const items = [{ article_id: "a", lang: "tr", gold_event: "1" }, { article_id: "b", lang: "ar", gold_event: "1" }, { article_id: "c", lang: "tr", gold_event: "1" }];
    expect(crossLingualRecall(items, m({ a: "x", b: "x", c: "y" }))).toEqual({ recall: 0.5, pairs: 2 });
  });
  test("Yanlış birleştirme oranı", () => {
    expect(falseMergeRate(m({ a: "1", b: "2", c: "2" }), m({ a: "x", b: "x", c: "x" }))).toEqual({ rate: 0.667, pairs: 3 });
  });
  test("Sınıf başına P/R", () => {
    const r = perClassPR([{ gold: "new", sys: "new" }, { gold: "dup", sys: "new" }, { gold: "dup", sys: "dup" }]);
    expect(r.new).toMatchObject({ precision: 0.5, recall: 1 });
    expect(r.dup).toMatchObject({ precision: 1, recall: 0.5 });
  });
  test("İddia destek doğruluğu ve yanlış 'dayanaklı' sayımı", () => {
    expect(claimSupportAccuracy([{ claim_id: "1", system_status: "supported", analyst_supported: false }, { claim_id: "2", system_status: "unverified", analyst_supported: false }]))
      .toEqual({ accuracy: 0.5, n: 2, false_supported: 1 });
    expect(claimSupportAccuracy([]).accuracy).toBeNull();
  });
  test("Ad sadakati: özgün yazım birebir, uydurma ad sayılır", () => {
    expect(nameFidelity([{ gold: ["آرمان ولیو"], sys: ["آرمان ولیو", "Uydurma Kişi"] }])).toEqual({ exact_rate: 1, invented_names: 1, gold_names: 1 });
  });
});
