// YAYILIM — bir olayın yayıncılar ve diller arasında NASIL yayıldığını çıkarır.
//
// SİNYAL'in diğer katmanları "ne oldu, söylenen kaynakta var mı?" sorusunu yanıtlar. Bu katman şunu sorar:
// "Bilgi kimden kime geçti, yolda nasıl değişti, yayılma hızlanıyor mu?"
//
// Yöntem (deterministik, model YOK, her karar gerekçesiyle):
//  1. Yalnız KESİN yayın zamanı olan haberler zincire yerleştirilir; tarihi belirsiz olanlar ayrıca listelenir
//     (ingest'teki ilke: belirsiz tarih hiçbir kararın tek dayanağı olmaz).
//  2. Her haber için kendisinden ÖNCE yayımlanmış adaylar puanlanır:
//       • atıf    — metin, adayın yayıncı adını anıyor ("Demo Zeitung reported", "به گزارش ...")  +0.50
//       • kopya   — aynı dilde başlık ve gövde neredeyse aynı (yeniden yayın)                        +0.60
//       • olgu    — ortak kanonik varlık/kavram + olgu sayıları (diller arası)                       ×0.30
//       • metin   — aynı dilde gövde sözcük benzerliği                                               ×0.20
//     En yüksek puanlı aday "olası kaynak" olur. Eşik altı → bağımsız giriş (zincirin yeni kökü).
//  3. Her kenarda MUTASYON aranır: teyitsizlik ifadesinin düşmesi/eklenmesi, sayıların değişmesi/eklenmesi/düşmesi.
//  4. Yayılma ölçüleri: nesil derinliği, R (yayın başına ortalama aktarım), erişim eğrisi, ivme.
//
// SINIRLAR: Puanlar SEZGİSELDİR, kalibre edilmemiştir. "Olası kaynak" kanıtlanmış kopyalama ilişkisi değildir;
// arayüz bunu gerekçeleriyle birlikte gösterir. "İlk görülen" = SİNYAL'in gördüğü en erken haber; gerçek köken
// SİNYAL'in izlemediği bir yayın olabilir.

import type { Article, ExtractedEntity, Source } from "../domain/types.ts";
import { hedgePhrases } from "../pipeline/match.ts";
import { extractFactNumbers, jaccard, matchKey, tokens } from "../text/normalize.ts";

export const SPREAD_VERSION = "yayilim-v1";

export const SPREAD_PARAMS = {
  /** Kenar kurmak için en düşük puan */
  minEdgeScore: 0.2,
  /** Bundan uzak adaylar kaynak sayılmaz (saat) */
  maxHoursBack: 96,
  /** R hesabında son N saatte yayımlanan haberler dışlanır: henüz aktarılma fırsatı bulamadılar (sağdan sansür) */
  censorHours: 3,
  /** İvme penceresi (saat) */
  momentumHours: 6,
  nearDup: 0.8,
} as const;

const W = { citation: 0.5, copy: 0.6, facts: 0.3, text: 0.2 } as const;

export type EdgeKind = "copy" | "citation" | "shared_facts";
export type MutationKind = "hedge_dropped" | "hedge_added" | "number_changed" | "number_added" | "number_dropped";
export type Severity = "high" | "medium" | "low";
export type Momentum = "accelerating" | "steady" | "slowing" | "dormant";

export interface Mutation {
  kind: MutationKind;
  severity: Severity;
  text_tr: string;
  from?: string;
  to?: string;
}

export interface SpreadEdge {
  kind: EdgeKind;
  score: number;
  evidence: string[];
}

export interface SpreadNode {
  article_id: string;
  source_id: string;
  source_name: string;
  country: string;
  lang: string;
  title: string;
  time: string | null;
  placed: boolean;
  generation: number | null;
  parent: string | null;
  edge: SpreadEdge | null;
  children: string[];
  hedges: string[];
  facts: string[];
  mutations: Mutation[];
}

export interface SpreadAlert extends Mutation {
  article_id: string;
  parent: string;
}

export interface SpreadResult {
  version: string;
  event_id: string;
  nodes: SpreadNode[];
  roots: string[];
  first_seen: string | null;
  unplaced: string[];
  stats: {
    placed: number;
    generations: number;
    r_estimate: number | null;
    r_eligible: number;
    censor_hours: number;
    langs: string[];
    countries: string[];
    first_at: string | null;
    last_at: string | null;
    hours_span: number | null;
  };
  reach: Array<{ t: string; articles: number; langs: number; countries: number }>;
  momentum: { label: Momentum; last: number; prev: number; window_hours: number };
  alerts: SpreadAlert[];
  notes: string[];
}

export interface SpreadInput {
  event_id: string;
  articles: Article[];
  entities: ExtractedEntity[];
  sources: Source[];
  nowMs: number;
}

interface Work {
  a: Article;
  node: SpreadNode;
  t: number | null;
  lang: string;
  bodyKey: string;
  titleTok: Set<string>;
  bodyTok: Set<string>;
  signals: Set<string>; // kanonik varlıklar + olgu sayıları (diller arası karşılaştırma)
  numbers: Set<string>;
}

const H = 3_600_000;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Yayıncı adının metinde aranacak biçimi: "Demo Zeitung (DE)" → "demo zeitung". */
export function citeKey(name: string): string {
  return matchKey(name.replace(/\s*\([^)]*\)\s*/g, " "));
}

export function computeSpread(inp: SpreadInput): SpreadResult {
  const srcById = new Map(inp.sources.map((s) => [s.source_id, s]));
  const entsBy = new Map<string, string[]>();
  for (const e of inp.entities) {
    if (!e.canonical_id) continue;
    const arr = entsBy.get(e.article_id) ?? [];
    arr.push(e.canonical_id);
    entsBy.set(e.article_id, arr);
  }

  const work: Work[] = inp.articles.map((a) => {
    const lang = a.lang_detected !== "und" ? a.lang_detected : a.lang_declared;
    const s = srcById.get(a.source_id);
    const text = a.title_original + "\n" + a.body_original;
    const numbers = new Set(extractFactNumbers(text));
    const t = a.date_quality === "exact" && a.published_at ? Date.parse(a.published_at) : null;
    return {
      a, t, lang, numbers,
      bodyKey: " " + matchKey(text, lang) + " ",
      titleTok: new Set(tokens(a.title_original, lang)),
      bodyTok: new Set(tokens(a.body_original, lang)),
      signals: new Set([...(entsBy.get(a.article_id) ?? []), ...[...numbers].map((n) => "#" + n)]),
      node: {
        article_id: a.article_id, source_id: a.source_id, source_name: s?.name ?? a.source_id, country: s?.country ?? "",
        lang, title: a.title_original, time: t === null ? null : new Date(t).toISOString(), placed: t !== null,
        generation: null, parent: null, edge: null, children: [], hedges: hedgePhrases(text, lang), facts: [...numbers], mutations: [],
      },
    };
  });

  const placed = work.filter((w) => w.t !== null).sort((x, y) => x.t! - y.t! || x.a.article_id.localeCompare(y.a.article_id));
  const byId = new Map(work.map((w) => [w.a.article_id, w]));
  const notes: string[] = [];

  // ---- 1-2. Olası kaynak ----
  for (let i = 0; i < placed.length; i++) {
    const c = placed[i]!;
    let best: { p: Work; edge: SpreadEdge } | null = null;
    for (let j = 0; j < i; j++) {
      const p = placed[j]!;
      if (p.t! >= c.t!) continue; // aynı anda yayımlanan biri diğerinin kaynağı sayılamaz
      if (c.t! - p.t! > SPREAD_PARAMS.maxHoursBack * H) continue;
      if (p.a.source_id === c.a.source_id && !sameStory(p, c)) continue;
      const edge = scoreEdge(p, c, srcById);
      if (edge.score < SPREAD_PARAMS.minEdgeScore) continue;
      // Eşitlikte: atıf/kopya kenarında daha yakın zamanlı aday (zincirdeki son halka); yalnız ortak olguya
      // dayanan kenarda olguyu İLK getiren aday — aksi halde ajans haberleri sahte derin zincir oluşturur.
      const tie = best && Math.abs(edge.score - best.edge.score) <= 1e-9;
      const preferLater = edge.kind !== "shared_facts";
      if (!best || edge.score > best.edge.score + 1e-9 || (tie && (preferLater ? p.t! > best.p.t! : p.t! < best.p.t!))) best = { p, edge };
    }
    if (best) {
      c.node.parent = best.p.a.article_id;
      c.node.edge = best.edge;
      best.p.node.children.push(c.a.article_id);
      c.node.mutations = mutationsOf(best.p, c, best.edge);
    }
  }

  // ---- Nesiller ----
  const roots = placed.filter((w) => !w.node.parent).map((w) => w.a.article_id);
  for (const w of placed) w.node.generation = w.node.parent ? (byId.get(w.node.parent)!.node.generation ?? 0) + 1 : 0;
  const generations = placed.length ? Math.max(...placed.map((w) => w.node.generation ?? 0)) + 1 : 0;

  // ---- R: yayın başına ortalama aktarım (sağdan sansürlü) ----
  const cutoff = inp.nowMs - SPREAD_PARAMS.censorHours * H;
  const eligible = placed.filter((w) => w.t! <= cutoff);
  const r = eligible.length ? round(eligible.reduce((s, w) => s + w.node.children.length, 0) / eligible.length) : null;
  if (placed.length && eligible.length < placed.length) {
    notes.push(`Son ${SPREAD_PARAMS.censorHours} saatte yayımlanan ${placed.length - eligible.length} haber R hesabına katılmadı (henüz aktarılma fırsatı bulamadılar).`);
  }

  // ---- Erişim eğrisi ----
  const reach: SpreadResult["reach"] = [];
  const seenL = new Set<string>(), seenC = new Set<string>();
  placed.forEach((w, i) => {
    seenL.add(w.lang);
    if (w.node.country) seenC.add(w.node.country);
    reach.push({ t: w.node.time!, articles: i + 1, langs: seenL.size, countries: seenC.size });
  });

  // ---- İvme ----
  const mh = SPREAD_PARAMS.momentumHours * H;
  const last = placed.filter((w) => w.t! > inp.nowMs - mh && w.t! <= inp.nowMs).length;
  const prev = placed.filter((w) => w.t! > inp.nowMs - 2 * mh && w.t! <= inp.nowMs - mh).length;
  let label: Momentum;
  if (last + prev === 0) label = "dormant";
  else if (last >= 3 && last >= prev * 1.5) label = "accelerating"; // 2 haberle "hızlanıyor" demek aşırı iddia olur
  else if (last <= prev * 0.5) label = "slowing";
  else label = "steady";

  // ---- Uyarılar ----
  const sevRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  const alerts: SpreadAlert[] = placed
    .flatMap((w) => w.node.mutations.map((m) => ({ ...m, article_id: w.a.article_id, parent: w.node.parent! })))
    .sort((x, y) => sevRank[x.severity] - sevRank[y.severity]);

  const unplaced = work.filter((w) => w.t === null).map((w) => w.a.article_id);
  if (unplaced.length) notes.push(`${unplaced.length} haberin yayın zamanı kesin olmadığı için zincire yerleştirilmedi.`);
  if (roots.length > 1) notes.push(`${roots.length} bağımsız giriş noktası var: bu haberler önceki yayınlara bağlanacak yeterli kanıt taşımıyor.`);

  const first = placed[0];
  return {
    version: SPREAD_VERSION,
    event_id: inp.event_id,
    nodes: [...placed, ...work.filter((w) => w.t === null)].map((w) => w.node),
    roots,
    first_seen: first ? first.a.article_id : null,
    unplaced,
    stats: {
      placed: placed.length,
      generations,
      r_estimate: r,
      r_eligible: eligible.length,
      censor_hours: SPREAD_PARAMS.censorHours,
      langs: [...seenL],
      countries: [...seenC],
      first_at: first?.node.time ?? null,
      last_at: placed.at(-1)?.node.time ?? null,
      hours_span: first ? round((placed.at(-1)!.t! - first.t!) / H, 1) : null,
    },
    reach,
    momentum: { label, last, prev, window_hours: SPREAD_PARAMS.momentumHours },
    alerts,
    notes,
  };
}

function sameStory(p: Work, c: Work): boolean {
  return p.lang === c.lang && jaccard(p.bodyTok, c.bodyTok) >= 0.3;
}

function scoreEdge(p: Work, c: Work, srcById: Map<string, Source>): SpreadEdge {
  const evidence: string[] = [];
  let score = 0;
  let kind: EdgeKind = "shared_facts";

  const ps = srcById.get(p.a.source_id);
  const ck = ps ? citeKey(ps.name) : "";
  const cited = ck.length >= 4 && p.a.source_id !== c.a.source_id && c.bodyKey.includes(" " + ck + " ");
  if (cited) {
    score += W.citation;
    kind = "citation";
    evidence.push(`Metin "${ps!.name.replace(/\s*\([^)]*\)/, "")}" adını kaynak olarak anıyor.`);
  }

  const sameLang = p.lang === c.lang;
  const tSim = sameLang ? jaccard(p.titleTok, c.titleTok) : 0;
  const bSim = sameLang ? jaccard(p.bodyTok, c.bodyTok) : 0;
  if (sameLang && tSim >= SPREAD_PARAMS.nearDup && bSim >= SPREAD_PARAMS.nearDup) {
    score += W.copy;
    kind = "copy";
    evidence.push(`Aynı dilde neredeyse birebir metin (başlık ${round(tSim)}, gövde ${round(bSim)}).`);
  } else if (bSim > 0) {
    score += W.text * bSim;
    if (bSim >= 0.3) evidence.push(`Aynı dilde gövde benzerliği ${round(bSim)}.`);
  }

  const fSim = jaccard(p.signals, c.signals);
  if (fSim > 0) {
    score += W.facts * fSim;
    const shared = [...p.signals].filter((x) => c.signals.has(x));
    evidence.push(`Ortak olgu/varlık: ${shared.length} (benzerlik ${round(fSim)}).`);
  }
  // Yalnız ortak olguya dayanan kenar zayıftır: yeterince örtüşme yoksa kurma.
  if (kind === "shared_facts" && fSim < 0.5 && bSim < 0.3) score = 0;
  return { kind, score: round(score, 3), evidence };
}

/**
 * Kenar boyunca değişimler. Yalnız ortak olguya dayanan (zayıf) kenarda aktarım kanıtlanmadığı için teyitsizlik
 * değişimi mutasyon sayılmaz (ikinci kaynak bağımsız bilgiye sahip olabilir); sayı farkları düşük önemle gösterilir.
 */
function mutationsOf(p: Work, c: Work, edge: SpreadEdge): Mutation[] {
  const strong = edge.kind !== "shared_facts";
  const out = strong ? rawMutations(p, c) : rawMutations(p, c).filter((m) => m.kind.startsWith("number_"));
  return strong ? out : out.map((m) => ({ ...m, severity: "low" as const, text_tr: `(Zayıf bağ) ${m.text_tr}` }));
}

function rawMutations(p: Work, c: Work): Mutation[] {
  const out: Mutation[] = [];
  if (p.node.hedges.length && !c.node.hedges.length) {
    out.push({
      kind: "hedge_dropped", severity: "high",
      text_tr: `Kaynakta teyitsizlik ifadesiyle ("${p.node.hedges.join('", "')}") verilen bilgi burada kesin bilgi gibi aktarılmış.`,
    });
  } else if (!p.node.hedges.length && c.node.hedges.length) {
    out.push({ kind: "hedge_added", severity: "low", text_tr: `Teyitsizlik ifadesi eklenmiş ("${c.node.hedges.join('", "')}").` });
  }

  const added = [...c.numbers].filter((n) => !p.numbers.has(n));
  const dropped = [...p.numbers].filter((n) => !c.numbers.has(n));
  if (added.length === 1 && dropped.length === 1 && !added[0]!.endsWith("%") === !dropped[0]!.endsWith("%")) {
    const from = dropped[0]!, to = added[0]!;
    const ratio = Number(to.replace("%", "")) / Number(from.replace("%", ""));
    const big = ratio >= 2 || ratio <= 0.5;
    out.push({
      kind: "number_changed", severity: big ? "high" : "medium", from, to,
      text_tr: `Sayı değişmiş: ${from} → ${to}${Number.isFinite(ratio) ? ` (×${round(ratio, 1)})` : ""}.`,
    });
  } else {
    for (const n of added) out.push({ kind: "number_added", severity: "medium", to: n, text_tr: `Kaynakta olmayan sayı eklenmiş: ${n}.` });
    for (const n of dropped) out.push({ kind: "number_dropped", severity: "low", from: n, text_tr: `Kaynaktaki sayı aktarılmamış: ${n}.` });
  }
  return out;
}
