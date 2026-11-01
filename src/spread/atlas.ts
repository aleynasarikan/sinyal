// YAYILIM ATLASI verisi: olayların yayılımını ÜLKE düzeyine indirger.
//  • Genel görünüm: ülke başına haber/olay sayısı + her olayın ilk görüldüğü ülke.
//  • Olay görünümü: ülkeler arası aktarım bağlantıları (zaman, tür, mutasyon önemi) — arayüz zaman kaydırıcısıyla oynatır.
// Koordinat İÇERMEZ: ülke kodu → çizim noktası eşlemesi istemcide, depoya işlenmiş statik dosyadan gelir (data/geo).
// Ülkesi bilinmeyen kaynak (kayıtsız yayıncı) haritaya konmaz; sayısı `unmapped` ile bildirilir.

import type { Event } from "../domain/types.ts";
import type { MutationKind, Severity, SpreadNode, SpreadResult } from "./spread.ts";

/** Arayüzün sade dille anlatabilmesi için değişikliğin türü ve değerleri. */
export interface AtlasChange { kind: MutationKind; severity: Severity; from?: string; to?: string; hedges?: string[] }

export interface AtlasNode {
  article_id: string; cc: string; source: string; lang: string; time: string; generation: number;
  severity: Severity | null; title: string; hedged: boolean; root: boolean;
}
export interface AtlasLink {
  from: string; to: string; from_cc: string; to_cc: string; time: string;
  kind: "copy" | "citation" | "shared_facts"; severity: Severity | null; mutations: string[]; changes: AtlasChange[];
}
export interface AtlasEvent {
  event_id: string; title_tr: string;
  momentum: SpreadResult["momentum"]; r_estimate: number | null; hours_span: number | null;
  alerts: { high: number; medium: number };
  first: AtlasNode | null;
  nodes: AtlasNode[]; links: AtlasLink[];
  countries: string[]; unmapped: number;
  /** DÜZELTME BOŞLUĞU: olayda yalanlama varsa iddianın ulaşıp yalanlamanın ulaşmadığı yerler. */
  correction: CorrectionGap | null;
}

/** Açıklamanın gönderilmesi önerilen yer: boşluktaki ülkede iddiayı ilk yayan kaynak. */
export interface GapTarget {
  cc: string; lang: string; source: string; article_id: string; time: string;
  /** brought_lang: iddiayı bu dile ilk taşıyan · changed: aktarırken bilgiyi değiştiren · root: iddianın ilk çıktığı yer */
  reasons: Array<"brought_lang" | "changed" | "root">;
  changes: AtlasChange[];
  /** Bu ülkede iddiayı yayan toplam kaynak sayısı */
  sources_in_country: number;
}
export interface CorrectionGap {
  first: AtlasNode | null;
  nodes: AtlasNode[]; links: AtlasLink[];
  claim_countries: string[]; covered: string[]; gap: string[];
  claim_langs: string[]; covered_langs: string[]; gap_langs: string[];
  /** Yalanlamanın ulaştığı iddia ülkelerinin oranı (0–1) */
  coverage: number;
  targets: GapTarget[];
  /** İlk yalanlamadan SONRA iddiayı (yalanlamayı anmadan) yayımlayanlar */
  after: Array<{ article_id: string; source: string; cc: string; time: string }>;
}

const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const worst = (xs: Severity[]): Severity | null => (xs.length ? xs.reduce((a, b) => (SEV_RANK[b] < SEV_RANK[a] ? b : a)) : null);

function mapChain(all: SpreadNode[], withChanges: boolean): { nodes: AtlasNode[]; links: AtlasLink[] } {
  const placed = all.filter((n) => n.placed);
  const byId = new Map(placed.map((n) => [n.article_id, n]));
  const nodes: AtlasNode[] = placed.filter((n) => n.country).map((n) => ({
    article_id: n.article_id, cc: n.country, source: n.source_name, lang: n.lang, time: n.time!, generation: n.generation ?? 0,
    severity: withChanges ? worst(n.mutations.map((m) => m.severity).filter((x) => x !== "low")) : null, title: n.title, hedged: n.hedges.length > 0,
    root: n.generation === 0,
  }));
  const links: AtlasLink[] = [];
  for (const n of placed) {
    const p = n.parent ? byId.get(n.parent) : undefined;
    if (!p || !n.edge || !p.country || !n.country) continue;
    const muts = withChanges ? n.mutations : [];
    links.push({
      from: p.article_id, to: n.article_id, from_cc: p.country, to_cc: n.country, time: n.time!, kind: n.edge.kind,
      severity: worst(muts.map((m) => m.severity).filter((x) => x !== "low")),
      mutations: muts.map((m) => m.text_tr),
      changes: muts.map((m) => ({ kind: m.kind, severity: m.severity, from: m.from, to: m.to, hedges: m.kind === "hedge_dropped" ? p.hedges : undefined })),
    });
  }
  return { nodes, links };
}

/** Okura gösterilen değişiklik mi? (plain.changeText ile aynı ölçüt: düşük önemli sayı eklemesi ve küçük farklar hariç) */
const visible = (c: AtlasChange) => c.kind === "hedge_dropped" || c.kind === "number_changed" || (c.kind === "number_added" && c.severity !== "low");

export function correctionGap(claim: { nodes: AtlasNode[]; links: AtlasLink[] }, s: SpreadResult): CorrectionGap | null {
  if (!s.correction) return null;
  const { nodes, links } = mapChain(s.correction.nodes, false);
  const first = s.correction.first_seen ? nodes.find((n) => n.article_id === s.correction!.first_seen) ?? null : null;
  const uniq = (xs: string[]) => [...new Set(xs)];
  const claimCountries = uniq(claim.nodes.map((n) => n.cc));
  const claimLangs = uniq(claim.nodes.map((n) => n.lang));
  const corrCountries = new Set(nodes.map((n) => n.cc));
  const corrLangs = new Set(nodes.map((n) => n.lang));
  const covered = claimCountries.filter((c) => corrCountries.has(c));
  const gap = claimCountries.filter((c) => !corrCountries.has(c));

  // Boşluktaki her ülke için: iddiayı o ülkeye ilk getiren kaynak (açıklamanın muhatabı).
  const ordered = [...claim.nodes].sort((a, b) => a.time.localeCompare(b.time));
  const firstInLang = new Map<string, string>();
  for (const n of ordered) if (!firstInLang.has(n.lang)) firstInLang.set(n.lang, n.article_id);
  const inLink = new Map(claim.links.map((l) => [l.to, l]));
  const targets: GapTarget[] = gap.map((cc) => {
    const here = ordered.filter((n) => n.cc === cc);
    const n = here[0]!;
    const changes = (inLink.get(n.article_id)?.changes ?? []).filter(visible);
    const reasons: GapTarget["reasons"] = [];
    if (n.root) reasons.push("root");
    if (!n.root && firstInLang.get(n.lang) === n.article_id) reasons.push("brought_lang");
    if (changes.length) reasons.push("changed");
    return { cc, lang: n.lang, source: n.source, article_id: n.article_id, time: n.time, reasons, changes, sources_in_country: new Set(here.map((x) => x.source)).size };
  });
  // Öncelik: bilgiyi değiştiren > yeni dile taşıyan > ilk çıkan > diğer; eşitlikte erken olan.
  const rank = (t: GapTarget) => (t.reasons.includes("changed") ? 0 : t.reasons.includes("brought_lang") ? 1 : t.reasons.includes("root") ? 2 : 3);
  targets.sort((a, b) => rank(a) - rank(b) || a.time.localeCompare(b.time));

  const after = first ? ordered.filter((n) => n.time > first.time).map((n) => ({ article_id: n.article_id, source: n.source, cc: n.cc, time: n.time })) : [];
  return {
    first, nodes, links,
    claim_countries: claimCountries, covered, gap,
    claim_langs: claimLangs, covered_langs: claimLangs.filter((l) => corrLangs.has(l)), gap_langs: claimLangs.filter((l) => !corrLangs.has(l)),
    coverage: claimCountries.length ? Math.round((covered.length / claimCountries.length) * 100) / 100 : 0,
    targets, after,
  };
}

export function atlasEvent(ev: Pick<Event, "event_id" | "title_tr">, s: SpreadResult): AtlasEvent {
  const { nodes, links } = mapChain(s.nodes, true);
  const first = s.first_seen ? nodes.find((n) => n.article_id === s.first_seen) ?? null : null;
  return {
    event_id: ev.event_id, title_tr: ev.title_tr,
    momentum: s.momentum, r_estimate: s.stats.r_estimate, hours_span: s.stats.hours_span,
    alerts: { high: s.alerts.filter((a) => a.severity === "high").length, medium: s.alerts.filter((a) => a.severity === "medium").length },
    first, nodes, links,
    countries: [...new Set(nodes.map((n) => n.cc))],
    unmapped: s.nodes.filter((n) => n.placed).length - nodes.length,
    correction: correctionGap({ nodes, links }, s),
  };
}

/** Pencere geneli ülke özeti (genel görünümde ülke dolgusu için). */
export function countrySummary(events: AtlasEvent[]): Record<string, { articles: number; events: number; first_seen: number }> {
  const out: Record<string, { articles: number; events: number; first_seen: number }> = {};
  for (const e of events) {
    const seen = new Set<string>();
    for (const n of e.nodes) {
      const c = (out[n.cc] ??= { articles: 0, events: 0, first_seen: 0 });
      c.articles++;
      if (!seen.has(n.cc)) { c.events++; seen.add(n.cc); }
    }
    if (e.first) (out[e.first.cc] ??= { articles: 0, events: 0, first_seen: 0 }).first_seen++;
  }
  return out;
}
