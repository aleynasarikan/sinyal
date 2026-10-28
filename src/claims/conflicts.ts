// Kaynaklar arası sayısal farklılık tespiti (ör. can kaybı). Çelişkiyi GİZLEMEZ, analistin önüne koyar.
// Yöntem (baseline): başlığında "can kaybı" kavramı geçen haberlerin başlığındaki ≥10 tam sayılar slot değeri sayılır.
// Birbirine yakın zamanda (≤4 saat) farklı değer veren kaynaklar → "çelişki"; daha uzak aralık → "zaman içinde değişim".

import type { Article } from "../domain/types.ts";
import type { Gazetteer } from "../pipeline/entities.ts";
import { extractNumbers } from "../text/normalize.ts";

export interface SlotValue { value: string; article_ids: string[]; earliest: string | null; latest: string | null }
export interface SlotConflict {
  slot: "casualties";
  label_tr: string;
  kind: "conflict" | "evolution";
  values: SlotValue[];
  explanation: string;
}

const CLOSE_MS = 4 * 3_600_000;

export function detectConflicts(articles: Article[], gz: Gazetteer): SlotConflict[] {
  const obs: Array<{ value: string; a: Article; t: number | null }> = [];
  for (const a of articles) {
    const lang = a.lang_detected !== "und" ? a.lang_detected : a.lang_declared;
    if (!gz.extract(a.article_id, a.title_original, lang).some((e) => e.canonical_id === "concept:casualties")) continue;
    const vals = extractNumbers(a.title_original).filter((n) => Number.isInteger(Number(n)) && Number(n) >= 10);
    if (vals.length !== 1) continue; // birden çok sayı varsa hangisinin can kaybı olduğu belirsiz → kullanma
    obs.push({ value: vals[0]!, a, t: a.date_quality === "exact" && a.published_at ? Date.parse(a.published_at) : null });
  }
  const distinct = [...new Set(obs.map((o) => o.value))];
  if (distinct.length < 2) return [];

  let close = false;
  for (const x of obs) for (const y of obs) {
    if (x.value !== y.value && x.t !== null && y.t !== null && Math.abs(x.t - y.t) <= CLOSE_MS) close = true;
  }
  const values: SlotValue[] = distinct.map((v) => {
    const os = obs.filter((o) => o.value === v);
    const ts = os.map((o) => o.a.published_at).filter((x): x is string => !!x).sort();
    return { value: v, article_ids: os.map((o) => o.a.article_id), earliest: ts[0] ?? null, latest: ts.at(-1) ?? null };
  }).sort((a, b) => (a.earliest ?? "").localeCompare(b.earliest ?? ""));

  return [{
    slot: "casualties",
    label_tr: "Can kaybı",
    kind: close ? "conflict" : "evolution",
    values,
    explanation: close
      ? "Birbirine yakın zamanda yayımlanan kaynaklar farklı değerler veriyor. Hangisinin doğru olduğu otomatik belirlenmedi."
      : "Değer zaman içinde değişmiş görünüyor; yakın zamanlı çelişen kaynak bulunmadı.",
  }];
}
