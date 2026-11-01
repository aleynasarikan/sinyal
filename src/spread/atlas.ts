// YAYILIM ATLASI verisi: olayların yayılımını ÜLKE düzeyine indirger.
//  • Genel görünüm: ülke başına haber/olay sayısı + her olayın ilk görüldüğü ülke.
//  • Olay görünümü: ülkeler arası aktarım bağlantıları (zaman, tür, mutasyon önemi) — arayüz zaman kaydırıcısıyla oynatır.
// Koordinat İÇERMEZ: ülke kodu → çizim noktası eşlemesi istemcide, depoya işlenmiş statik dosyadan gelir (data/geo).
// Ülkesi bilinmeyen kaynak (kayıtsız yayıncı) haritaya konmaz; sayısı `unmapped` ile bildirilir.

import type { Event } from "../domain/types.ts";
import type { MutationKind, Severity, SpreadResult } from "./spread.ts";

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
}

const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const worst = (xs: Severity[]): Severity | null => (xs.length ? xs.reduce((a, b) => (SEV_RANK[b] < SEV_RANK[a] ? b : a)) : null);

export function atlasEvent(ev: Pick<Event, "event_id" | "title_tr">, s: SpreadResult): AtlasEvent {
  const placed = s.nodes.filter((n) => n.placed);
  const byId = new Map(placed.map((n) => [n.article_id, n]));
  const nodes: AtlasNode[] = placed.filter((n) => n.country).map((n) => ({
    article_id: n.article_id, cc: n.country, source: n.source_name, lang: n.lang, time: n.time!, generation: n.generation ?? 0,
    severity: worst(n.mutations.map((m) => m.severity).filter((x) => x !== "low")), title: n.title, hedged: n.hedges.length > 0,
    root: n.generation === 0,
  }));
  const links: AtlasLink[] = [];
  for (const n of placed) {
    const p = n.parent ? byId.get(n.parent) : undefined;
    if (!p || !n.edge || !p.country || !n.country) continue;
    links.push({
      from: p.article_id, to: n.article_id, from_cc: p.country, to_cc: n.country, time: n.time!, kind: n.edge.kind,
      severity: worst(n.mutations.map((m) => m.severity).filter((x) => x !== "low")),
      mutations: n.mutations.map((m) => m.text_tr),
      changes: n.mutations.map((m) => ({ kind: m.kind, severity: m.severity, from: m.from, to: m.to, hedges: m.kind === "hedge_dropped" ? p.hedges : undefined })),
    });
  }
  const first = s.first_seen ? nodes.find((n) => n.article_id === s.first_seen) ?? null : null;
  return {
    event_id: ev.event_id, title_tr: ev.title_tr,
    momentum: s.momentum, r_estimate: s.stats.r_estimate, hours_span: s.stats.hours_span,
    alerts: { high: s.alerts.filter((a) => a.severity === "high").length, medium: s.alerts.filter((a) => a.severity === "medium").length },
    first, nodes, links,
    countries: [...new Set(nodes.map((n) => n.cc))],
    unmapped: placed.length - nodes.length,
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
