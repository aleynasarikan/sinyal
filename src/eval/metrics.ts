// Değerlendirme metrikleri. Girdi: analist etiketli altın set + sistem çıktısı.
// UYARI: Altın set yoksa bu metrikler ÜRETİLMEZ; sentetik set yalnız hattın doğru çalıştığını gösterir.

export interface GoldItem {
  article_id: string;
  lang: string;
  gold_event: string; // analistin olay etiketi
  gold_novelty?: string;
  gold_names?: string[]; // kaynakta geçen kişi adları (özgün yazımla)
}
export interface SysItem { article_id: string; sys_event: string; sys_novelty?: string; sys_names?: string[]; latency_ms?: number }

export interface ClaimJudgement { claim_id: string; system_status: string; analyst_supported: boolean }

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const f1 = (p: number, r: number) => (p + r ? (2 * p * r) / (p + r) : 0);

/** B-cubed precision/recall/F1 (Bagga & Baldwin 1998): her öğe için küme kesişimi oranlarının ortalaması. */
export function bcubed(gold: Map<string, string>, sys: Map<string, string>) {
  const ids = [...gold.keys()].filter((i) => sys.has(i));
  const byGold = new Map<string, Set<string>>(), bySys = new Map<string, Set<string>>();
  for (const i of ids) {
    (byGold.get(gold.get(i)!) ?? byGold.set(gold.get(i)!, new Set()).get(gold.get(i)!)!).add(i);
    (bySys.get(sys.get(i)!) ?? bySys.set(sys.get(i)!, new Set()).get(sys.get(i)!)!).add(i);
  }
  let p = 0, r = 0;
  for (const i of ids) {
    const g = byGold.get(gold.get(i)!)!, s = bySys.get(sys.get(i)!)!;
    let inter = 0;
    for (const x of s) if (g.has(x)) inter++;
    p += inter / s.size; r += inter / g.size;
  }
  const P = ids.length ? p / ids.length : 0, R = ids.length ? r / ids.length : 0;
  return { precision: r3(P), recall: r3(R), f1: r3(f1(P, R)), n: ids.length };
}

/** Diller arası recall: altında aynı olaydaki FARKLI dilli çiftlerden kaçı sistemde de aynı olayda. */
export function crossLingualRecall(items: GoldItem[], sys: Map<string, string>) {
  let pairs = 0, hit = 0;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i]!, b = items[j]!;
    if (a.gold_event !== b.gold_event || a.lang === b.lang) continue;
    pairs++;
    if (sys.get(a.article_id) && sys.get(a.article_id) === sys.get(b.article_id)) hit++;
  }
  return { recall: pairs ? r3(hit / pairs) : null, pairs };
}

/** Yanlış birleştirme oranı: sistemin aynı olaya koyduğu çiftlerden altında FARKLI olaya ait olanların oranı. */
export function falseMergeRate(gold: Map<string, string>, sys: Map<string, string>) {
  const ids = [...gold.keys()].filter((i) => sys.has(i));
  let pairs = 0, wrong = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (sys.get(ids[i]!) !== sys.get(ids[j]!)) continue;
    pairs++;
    if (gold.get(ids[i]!) !== gold.get(ids[j]!)) wrong++;
  }
  return { rate: pairs ? r3(wrong / pairs) : null, pairs };
}

/** Sınıf başına precision/recall (yeni gelişme sınıflandırması). */
export function perClassPR(pairs: Array<{ gold: string; sys: string }>) {
  const labels = [...new Set(pairs.flatMap((p) => [p.gold, p.sys]))].sort();
  return Object.fromEntries(labels.map((l) => {
    const tp = pairs.filter((p) => p.gold === l && p.sys === l).length;
    const fp = pairs.filter((p) => p.gold !== l && p.sys === l).length;
    const fn = pairs.filter((p) => p.gold === l && p.sys !== l).length;
    const P = tp + fp ? tp / (tp + fp) : 0, R = tp + fn ? tp / (tp + fn) : 0;
    return [l, { precision: r3(P), recall: r3(R), f1: r3(f1(P, R)), support: tp + fn }];
  }));
}

/** İddia–kaynak destek doğruluğu: sistemin "supported" kararı analistin kararıyla ne sıklıkla örtüşüyor. */
export function claimSupportAccuracy(js: ClaimJudgement[]) {
  if (!js.length) return { accuracy: null, n: 0, false_supported: 0 };
  const sysSup = (j: ClaimJudgement) => j.system_status === "supported";
  return {
    accuracy: r3(js.filter((j) => sysSup(j) === j.analyst_supported).length / js.length),
    n: js.length,
    false_supported: js.filter((j) => sysSup(j) && !j.analyst_supported).length, // en tehlikeli hata
  };
}

/** Kişi adı sadakati: altındaki adların sistemde (özgün yazım korunarak) birebir bulunma oranı. */
export function nameFidelity(items: Array<{ gold: string[]; sys: string[] }>) {
  let total = 0, exact = 0, invented = 0;
  for (const it of items) {
    const sys = new Set(it.sys.map((s) => s.normalize("NFC")));
    const gold = new Set(it.gold.map((s) => s.normalize("NFC")));
    total += gold.size;
    for (const g of gold) if (sys.has(g)) exact++;
    for (const s of sys) if (!gold.has(s)) invented++;
  }
  return { exact_rate: total ? r3(exact / total) : null, invented_names: invented, gold_names: total };
}

export function latency(ms: number[]) {
  if (!ms.length) return { p50: null, p95: null, n: 0 };
  const s = [...ms].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { p50: q(0.5), p95: q(0.95), n: s.length };
}
