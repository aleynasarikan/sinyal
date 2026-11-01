// YAYILIM — maplibre-gl ile ülke düzeyinde yayılım haritası (canlı ekran + rapor için harita görüntüleri).
// Ayrı parça olarak yalnız Yayılım ve Rapor ekranlarında yüklenir.
//
// DIŞ İSTEK YOK: harita karosu/stil/font sunucusu kullanılmaz. Sınırlar ve çizim noktaları SİNYAL'in kendi kökeninden
// (/geo/*.json), worker /maplibre-gl-worker.mjs'ten gelir. Etiketler maplibre yazı katmanı (glyph sunucusu ister) yerine
// HTML işaretçileridir (canlı ekran) veya 2B tuvale çizilir (rapor); içerik textContent ile yazılır (innerHTML yok).
//
// SADE ARAYÜZ: teknik terimler (R, nesil, atıf/kopya) gösterilmez; dil ./plain.ts'ten gelir.

import {
  AttributionControl, LngLatBounds, Map as MlMap, Marker, NavigationControl, setWorkerUrl,
  type GeoJSONSource, type StyleSpecification,
} from "maplibre-gl";
import { changeText, countryName, eventLine, gapLine, langName, pct, sourceName, status, targetReasons, visibleChanges, weakLinkNote, when } from "./plain.ts";

type Json = any;
type Child = Node | string | number | null | undefined | false | Child[];
type H = (tag: string, attrs?: Record<string, any>, ...children: Child[]) => HTMLElement;
type Pt = [number, number];

export interface AtlasUi {
  h: H;
  badge: (text: string, kind?: string, title?: string) => HTMLElement;
  /** Seçili olayın raporunu aç (olay kimliği) */
  onReport: (eventId: string) => void;
  /** Açılışta seçilecek olay */
  initial?: string;
}

setWorkerUrl("/maplibre-gl-worker.mjs");

let cssLoaded = false;
function ensureCss() {
  if (cssLoaded) return;
  cssLoaded = true;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/maplibre-gl.css";
  document.head.append(l);
}

let pointsCache: Record<string, Pt> | null = null;
async function countryPoints(): Promise<Record<string, Pt>> {
  if (!pointsCache) pointsCache = await (await fetch("/geo/country_points.json", { credentials: "same-origin" })).json();
  return pointsCache!;
}

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const HOUR = 3_600_000;

/** İki nokta arasında kavisli yay (enlem/boylam düzleminde ikinci derece Bezier). */
function arc(a: Pt, b: Pt, frac = 1, n = 48, side = 1): Pt[] {
  const [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  // side = -1: ters yönde kavis (yalanlama çizgileri iddia çizgileriyle üst üste binmesin)
  const bend = side * Math.min(18, len * 0.22);
  const cx = (x1 + x2) / 2 - (dy / len) * bend, cy = (y1 + y2) / 2 + (dx / len) * bend;
  const pts: Pt[] = [];
  const steps = Math.max(2, Math.round(n * frac));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * frac;
    pts.push([(1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2]);
  }
  return pts;
}

// ---------- Ortak harita kurulumu ----------
interface Palette { sea: string; land: string; border: string; flow: string; changed: string; ok: string; gap: string; text: string; labelBg: string; labelBorder: string }
const livePalette = (): Palette => ({
  sea: cssVar("--bg"), land: cssVar("--surface-2"), border: cssVar("--border"), flow: cssVar("--info"), changed: cssVar("--bad"), ok: cssVar("--ok"), gap: cssVar("--warn"),
  text: cssVar("--text"), labelBg: cssVar("--surface"), labelBorder: cssVar("--border"),
});
/** Rapor (kâğıt) için açık tema — ekranın koyu/açık temasından bağımsız. */
const PRINT_PALETTE: Palette = {
  sea: "#eef3f8", land: "#d8e0ea", border: "#aab7c6", flow: "#1f5fd1", changed: "#c62828", ok: "#178a4c", gap: "#d97706", text: "#14202e", labelBg: "#ffffff", labelBorder: "#aab7c6",
};

function makeStyle(C: Palette): StyleSpecification {
  return {
    version: 8,
    sources: {
      countries: { type: "geojson", data: "/geo/countries.json", promoteId: "iso" },
      links: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      corrections: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": C.sea } },
      { id: "land-base", type: "fill", source: "countries", paint: { "fill-color": C.land, "fill-opacity": 1 } },
      // Zeminin üstünde yarı saydam renk: yoğunluk (genel görünüm) / ulaşıldı / bilgi değişti.
      {
        id: "land", type: "fill", source: "countries",
        paint: {
          // corrected: yalanlama ulaştı (yeşil) · gap: iddia ulaştı, yalanlama ulaşmadı (turuncu, "Boşluğu göster" modunda)
          "fill-color": ["case",
            ["boolean", ["feature-state", "corrected"], false], C.ok,
            ["boolean", ["feature-state", "gap"], false], C.gap,
            ["boolean", ["feature-state", "changed"], false], C.changed, C.flow],
          "fill-opacity": ["case",
            ["boolean", ["feature-state", "corrected"], false], 0.4,
            ["boolean", ["feature-state", "gap"], false], 0.5,
            ["boolean", ["feature-state", "changed"], false], 0.35,
            ["boolean", ["feature-state", "reached"], false], 0.28,
            ["interpolate", ["linear"], ["coalesce", ["feature-state", "n"], 0], 0, 0, 1, 0.14, 10, 0.4]],
        },
      },
      { id: "borders", type: "line", source: "countries", paint: { "line-color": C.border, "line-width": 0.6 } },
      {
        id: "links", type: "line", source: "links",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["get", "changed"], C.changed, C.flow],
          "line-width": ["case", ["get", "changed"], 3.5, 2.4],
          "line-opacity": ["get", "op"],
        },
      },
      {
        id: "corr-links", type: "line", source: "corrections",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": C.ok, "line-width": 2.6, "line-dasharray": [1.6, 1.2], "line-opacity": ["get", "op"] },
      },
    ],
  };
}

async function createMap(el: HTMLElement, C: Palette, forPrint: boolean): Promise<MlMap> {
  const map = new MlMap({
    container: el, style: makeStyle(C), center: [25, 35], zoom: 1.4, minZoom: 0.6, maxZoom: 6,
    attributionControl: false, dragRotate: false, pitchWithRotate: false, renderWorldCopies: false,
    interactive: !forPrint, fadeDuration: 0,
    canvasContextAttributes: forPrint ? { preserveDrawingBuffer: true, antialias: true } : undefined,
  });
  await new Promise<void>((r) => (map.loaded() ? r() : map.once("load", () => r())));
  // Ülke durumları (feature-state) sınır verisi işlenmeden ayarlanırsa ilk çizimde dünyayı kesen bozuk üçgenler
  // kalabiliyor; GeoJSON kaynağı tamamen yüklenene kadar bekle.
  if (!map.isSourceLoaded("countries")) {
    await new Promise<void>((r) => {
      const on = () => { if (map.isSourceLoaded("countries")) { map.off("sourcedata", on); r(); } };
      map.on("sourcedata", on);
    });
  }
  return map;
}

const changedLink = (l: Json) => l.changes.some((c: Json) => changeText(c) !== null);
const changedNode = (e: Json, articleId: string) => e.links.some((l: Json) => l.to === articleId && changedLink(l));

/** Ülke durumlarını tutan küçük yardımcı (temizlenebilir feature-state). */
function stateKeeper(map: MlMap) {
  const set = new Set<string>();
  return {
    set(iso: string, st: Record<string, unknown>) { set.add(iso); map.setFeatureState({ source: "countries", id: iso }, st); },
    clear() { for (const iso of set) map.removeFeatureState({ source: "countries", id: iso }); set.clear(); },
  };
}

function overviewFeatures(events: Json[], at: (cc: string) => Pt | undefined) {
  return {
    type: "FeatureCollection" as const,
    features: events.flatMap((e) => e.links.filter((l: Json) => l.from_cc !== l.to_cc && at(l.from_cc) && at(l.to_cc)).map((l: Json) => ({
      type: "Feature" as const, properties: { changed: changedLink(l), op: changedLink(l) ? 0.8 : 0.4 },
      geometry: { type: "LineString" as const, coordinates: arc(at(l.from_cc)!, at(l.to_cc)!) },
    }))),
  };
}

/** Yalanlama aktarım çizgileri (ülkeler arası). */
function corrFeatures(e: Json, at: (cc: string) => Pt | undefined, upTo = Infinity, frac: (l: Json) => number = () => 1) {
  const links: Json[] = e.correction?.links ?? [];
  return {
    type: "FeatureCollection" as const,
    features: links.filter((l) => Date.parse(l.time) <= upTo && l.from_cc !== l.to_cc && at(l.from_cc) && at(l.to_cc)).map((l) => ({
      type: "Feature" as const, properties: { op: 0.95 },
      geometry: { type: "LineString" as const, coordinates: arc(at(l.from_cc)!, at(l.to_cc)!, frac(l), 48, -1) },
    })),
  };
}
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

// ======================================================================
// CANLI EKRAN
// ======================================================================
export async function mountAtlas(container: HTMLElement, data: Json, ui: AtlasUi): Promise<() => void> {
  const { h, badge } = ui;
  ensureCss();
  const pts = await countryPoints();
  const at = (cc: string) => pts[cc];
  const events: Json[] = data.events.filter((e: Json) => e.nodes.some((n: Json) => at(n.cc)));
  const chip = (momentum: Json) => { const s = status(momentum.label); return badge(s.label, s.tone, s.hint); };

  // ---------- İskelet ----------
  const mapEl = h("div", { class: "atlas-map", role: "img", "aria-label": "Yayılım haritası. Aynı bilgiler yandaki listede yazılı olarak da var." });
  const side = h("aside", { class: "atlas-side", "aria-label": "Olaylar" });
  const play = h("button", { class: "secondary" }, "▶ Oynat") as HTMLButtonElement;
  const slider = h("input", { type: "range", min: "0", max: "1000", value: "1000", "aria-label": "Zaman" }) as HTMLInputElement;
  const timeLbl = h("span", { class: "atlas-time" }, "");
  const timeline = h("div", { class: "atlas-timeline", hidden: true }, play, slider, timeLbl);
  const globeBtn = h("button", { class: "secondary atlas-proj", "aria-pressed": "false", title: "Dünyayı küre olarak göster" }, "Küre görünümü") as HTMLButtonElement;
  const legend = h("div", { class: "atlas-legend small" },
    h("span", {}, h("i", { class: "lg lg-flow" }), "Haber aktarıldı"),
    h("span", {}, h("i", { class: "lg lg-mut" }), "Aktarılırken bilgi değişti"),
    h("span", {}, h("i", { class: "lg lg-root" }), "İlk çıktığı yer"));
  const legendCorr = [
    h("span", { class: "lg-corr", hidden: true }, h("i", { class: "lg lg-ok" }), "Yalanlama ulaştı"),
    h("span", { class: "lg-corr lg-gapitem", hidden: true }, h("i", { class: "lg lg-gap" }), "Yalanlama ulaşmadı"),
  ];
  legend.append(...legendCorr);
  container.replaceChildren(h("div", { class: "atlas" }, h("div", { class: "atlas-stage" }, mapEl, globeBtn, legend, timeline), side));

  const map = await createMap(mapEl, livePalette(), false);
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new AttributionControl({ compact: true, customAttribution: "Sınırlar: Natural Earth" }), "bottom-right");
  map.touchZoomRotate.disableRotation();
  const ro = new ResizeObserver(() => map.resize());
  ro.observe(mapEl);
  const states = stateKeeper(map);
  const linksSrc = () => map.getSource("links") as GeoJSONSource;
  const corrSrc = () => map.getSource("corrections") as GeoJSONSource;

  let markers: Marker[] = [];
  const clearMarkers = () => { markers.forEach((m) => m.remove()); markers = []; };
  /** Etiket çakışmasını önler: her etiket sağ / alt / üst / sol konumlardan çakışmayana yerleşir. */
  const placeLabels = (items: Array<{ el: HTMLElement; at: Pt }>) => {
    const boxes: Array<[number, number, number, number]> = [];
    for (const it of items) { const q = map.project(it.at); boxes.push([q.x - 10, q.y - 10, q.x + 10, q.y + 10]); }
    for (const it of items.sort((a, b) => a.at[1] - b.at[1])) {
      const p = map.project(it.at);
      const own = boxes.find((o) => o[0] === p.x - 10 && o[1] === p.y - 10);
      const w = (it.el.querySelector(".lbl")?.textContent?.length ?? 8) * 6.8 + 16;
      const cands: Array<[string, [number, number, number, number]]> = [
        ["", [p.x + 10, p.y - 10, p.x + 10 + w, p.y + 10]],
        ["pos-below", [p.x - w / 2, p.y + 10, p.x + w / 2, p.y + 30]],
        ["pos-above", [p.x - w / 2, p.y - 32, p.x + w / 2, p.y - 12]],
        ["pos-left", [p.x - 10 - w, p.y - 10, p.x - 10, p.y + 10]],
      ];
      const free = (b: [number, number, number, number]) => !boxes.some((o) => o !== own && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
      const pick = cands.find(([, b]) => free(b)) ?? cands[0]!;
      if (pick[0]) it.el.classList.add(pick[0]);
      boxes.push(pick[1]);
    }
  };
  const addPins = (pins: Array<{ el: HTMLElement; at: Pt }>) => {
    placeLabels(pins);
    for (const p of pins) markers.push(new Marker({ element: p.el, anchor: "center" }).setLngLat(p.at).addTo(map));
  };

  // ---------- Genel görünüm ----------
  let selected: Json | null = null;
  function overview() {
    stop(); selected = null; timeline.hidden = true;
    states.clear();
    for (const [cc, v] of Object.entries<Json>(data.countries)) if (at(cc)) states.set(cc, { n: v.articles });
    linksSrc().setData(overviewFeatures(events, at));
    corrSrc().setData(EMPTY_FC);
    gapView = false; syncLegend();
    overviewMarkers();
    map.easeTo({ center: [25, 35], zoom: 1.4, duration: reducedMotion() ? 0 : 600 });
    renderSide();
  }
  function overviewMarkers() {
    clearMarkers();
    const byCc = new Map<string, Json[]>();
    for (const e of events) if (e.first && at(e.first.cc)) byCc.set(e.first.cc, [...(byCc.get(e.first.cc) ?? []), e]);
    const pins: Array<{ el: HTMLElement; at: Pt }> = [];
    for (const [cc, evs] of byCc) {
      const hot = evs.some((e) => visibleChanges(e) > 0);
      const el = h("button", { class: `atlas-pin${hot ? " hot" : ""}`, title: evs.map((e) => e.title_tr).join("\n"), "aria-label": `${countryName(cc)}: ${evs.length} olay burada çıktı` },
        h("span", { class: "dot" }), h("span", { class: "lbl" }, countryName(cc)));
      el.addEventListener("click", () => select(evs[0]));
      pins.push({ el, at: at(cc)! });
    }
    addPins(pins);
  }

  // ---------- Olay görünümü (oynatma) ----------
  let t0 = 0, t1 = 0, cur = 0, markerKey = "";
  /** "Boşluğu göster": zamanı sona alır; yalanlamanın ulaştığı ülkeler yeşil, ulaşmadığı ülkeler turuncu. */
  let gapView = false;
  const syncLegend = () => {
    const has = !!selected?.correction;
    legendCorr[0]!.hidden = !has;
    legendCorr[1]!.hidden = !(has && gapView);
  };
  const ANIM_MS = 9000;
  let raf = 0, playing = false;

  function select(e: Json) {
    stop(); selected = e; markerKey = ""; gapView = false; syncLegend();
    const ts = [...e.nodes, ...(e.correction?.nodes ?? [])].map((n: Json) => Date.parse(n.time));
    const span = Math.max(Math.max(...ts) - Math.min(...ts), HOUR);
    t0 = Math.min(...ts) - span * 0.04; t1 = Math.max(...ts) + span * 0.04;
    timeline.hidden = false;
    const b = new LngLatBounds();
    for (const n of [...e.nodes, ...(e.correction?.nodes ?? [])]) if (at(n.cc)) b.extend(at(n.cc)!);
    map.fitBounds(b, { padding: { top: 80, bottom: 130, left: 90, right: 150 }, maxZoom: 3.6, duration: reducedMotion() ? 0 : 900 });
    renderSide();
    setTime(t1);
    if (!reducedMotion()) { setTime(t0); start(); }
  }

  function draw() {
    if (!selected) return;
    const e = selected;
    const grow = (t1 - t0) * 0.05;
    const reached = new Map<string, Json[]>();
    for (const n of e.nodes) if (Date.parse(n.time) <= cur && at(n.cc)) reached.set(n.cc, [...(reached.get(n.cc) ?? []), n]);
    const corrected = new Map<string, Json[]>();
    for (const n of e.correction?.nodes ?? []) if (Date.parse(n.time) <= cur && at(n.cc)) corrected.set(n.cc, [...(corrected.get(n.cc) ?? []), n]);
    const freshWin = (t1 - t0) * 0.06;
    const isFresh = (ns: Json[]) => ns.some((n) => cur - Date.parse(n.time) < freshWin);
    const ccs = [...new Set([...reached.keys(), ...corrected.keys()])];
    const key = (gapView ? "G" : "") + ccs.map((cc) => `${cc}:${reached.get(cc)?.length ?? 0}:${corrected.get(cc)?.length ?? 0}:${isFresh([...(reached.get(cc) ?? []), ...(corrected.get(cc) ?? [])]) ? 1 : 0}`).join("|");
    if (key !== markerKey) {
      markerKey = key;
      states.clear(); clearMarkers();
      const pins: Array<{ el: HTMLElement; at: Pt }> = [];
      for (const cc of ccs) {
        const ns = reached.get(cc) ?? [], cs = corrected.get(cc) ?? [];
        const changed = ns.some((n) => changedNode(e, n.article_id));
        const ok = cs.length > 0;
        states.set(cc, ok ? { corrected: true } : gapView ? { gap: true } : changed ? { changed: true } : { reached: true });
        const root = ns.some((n) => n.root);
        const cls = ok ? " ok" : gapView ? " nofix" : changed ? " chg" : "";
        const tip = [...ns.map((n) => `${sourceName(n.source)} · ${when(n.time)}`), ...cs.map((n) => `✓ Yalanlama: ${sourceName(n.source)} · ${when(n.time)}`)].join("\n");
        const el = h("div", { class: `atlas-node${cls}${root ? " root" : ""}${isFresh([...ns, ...cs]) ? " fresh" : ""}`, title: tip },
          h("span", { class: "dot" }), h("span", { class: "lbl" }, ok ? `✓ ${countryName(cc)}` : countryName(cc)));
        pins.push({ el, at: at(cc)! });
      }
      addPins(pins);
    }
    corrSrc().setData(corrFeatures(e, at, cur, (l) => (reducedMotion() ? 1 : Math.min(1, Math.max(0.05, (cur - Date.parse(l.time)) / grow)))));
    linksSrc().setData({
      type: "FeatureCollection",
      features: e.links.filter((l: Json) => Date.parse(l.time) <= cur && at(l.from_cc) && at(l.to_cc) && l.from_cc !== l.to_cc).map((l: Json) => ({
        type: "Feature" as const, properties: { changed: changedLink(l), op: 0.95 },
        geometry: { type: "LineString" as const, coordinates: arc(at(l.from_cc)!, at(l.to_cc)!, reducedMotion() ? 1 : Math.min(1, Math.max(0.05, (cur - Date.parse(l.time)) / grow))) },
      })),
    });
    timeLbl.textContent = when(new Date(cur).toISOString());
    slider.value = String(Math.round(((cur - t0) / (t1 - t0)) * 1000));
    side.querySelectorAll<HTMLElement>("[data-t]").forEach((li) => li.classList.toggle("done", Number(li.dataset.t) <= cur));
  }

  function setTime(t: number) { cur = Math.min(t1, Math.max(t0, t)); draw(); }
  function start() {
    if (cur >= t1) cur = t0;
    playing = true; play.textContent = "❚❚ Durdur";
    let last = performance.now();
    const tick = (now: number) => {
      if (!playing) return;
      setTime(cur + ((now - last) / ANIM_MS) * (t1 - t0)); last = now;
      if (cur >= t1) { stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function stop() { playing = false; cancelAnimationFrame(raf); play.textContent = "▶ Oynat"; }
  const leaveGap = () => { if (gapView) { gapView = false; syncLegend(); renderSide(); } };
  play.addEventListener("click", () => { leaveGap(); if (playing) stop(); else start(); });
  slider.addEventListener("input", () => { stop(); leaveGap(); setTime(t0 + (Number(slider.value) / 1000) * (t1 - t0)); });
  globeBtn.addEventListener("click", () => {
    const globe = globeBtn.getAttribute("aria-pressed") !== "true";
    globeBtn.setAttribute("aria-pressed", String(globe));
    map.setProjection({ type: globe ? "globe" : "mercator" });
  });
  map.on("moveend", () => { if (selected) { markerKey = ""; draw(); } else overviewMarkers(); });

  // ---------- Düzeltme boşluğu ----------
  function showGap() {
    stop(); gapView = true; syncLegend(); markerKey = "";
    renderSide(); setTime(t1);
  }
  function gapSection(e: Json): HTMLElement {
    const g = e.correction;
    const bar = h("div", { class: "gap-bar", role: "img", "aria-label": `Yalanlama kapsaması ${pct(g.coverage)}` }, h("span", { class: "gap-fill", "data-w": Math.round(g.coverage * 100) }));
    const sec = h("section", { class: "gap" },
      h("h3", {}, "Düzeltme boşluğu"),
      h("p", { class: "gap-line" }, gapLine(g)),
      bar,
      h("p", { class: "small muted" }, `Yalanlama, iddianın ulaştığı ülkelerin ${pct(g.coverage)} kadarına ulaştı.`),
      g.first ? h("p", { class: "small" }, "İlk yalanlama: ", h("strong", {}, `${countryName(g.first.cc)} — ${sourceName(g.first.source)}`), ` · ${when(g.first.time)}`) : null,
      g.gap_langs.length ? h("p", { class: "gap-langs" }, "Yalanlamanın hiç yayımlanmadığı diller: ", h("strong", {}, g.gap_langs.map(langName).join(", "))) : null,
      g.targets.length ? [
        h("h4", {}, "Açıklama gönderilmesi önerilen yerler"),
        h("ol", { class: "gap-targets" }, g.targets.map((t: Json) => h("li", {},
          h("div", {}, h("strong", {}, countryName(t.cc)), ` — ${sourceName(t.source)} `, h("span", { class: "small muted" }, `(${langName(t.lang)})`)),
          h("ul", { class: "small" }, targetReasons(t).map((r) => h("li", {}, r))))))] : h("p", { class: "ok-text" }, "Yalanlama, iddianın ulaştığı tüm ülkelere ulaştı."),
      g.after.length ? h("p", { class: "small warn-text" }, `⚠ İlk yalanlamadan sonra ${g.after.length} yayın iddiayı yaymaya devam etti: `,
        g.after.map((x: Json) => `${sourceName(x.source)} (${countryName(x.cc)})`).join(", ")) : null,
      h("button", { class: gapView ? "secondary" : "", onclick: () => (gapView ? (leaveGap(), setTime(t1)) : showGap()) }, gapView ? "Yayılım görünümüne dön" : "Boşluğu haritada göster"));
    requestAnimationFrame(() => sec.querySelectorAll<HTMLElement>(".gap-fill").forEach((b) => { b.style.width = `${Math.max(2, Number(b.dataset.w))}%`; }));
    return sec;
  }

  // ---------- Yan panel ----------
  function renderSide() {
    if (!selected) {
      side.replaceChildren(h("div", {},
        h("p", { class: "atlas-intro" }, "Bir olay seçin; haberin dünyaya nasıl yayıldığını haritada izleyin."),
        events.length ? h("ul", { class: "atlas-list" }, events.map((e) => {
          const n = visibleChanges(e);
          return h("li", {}, h("button", { class: `atlas-item${n ? " hot" : ""}`, onclick: () => select(e) },
            h("strong", {}, e.title_tr || "Adlandırılmamış olay"),
            h("span", { class: "row" }, chip(e.momentum)),
            h("span", { class: "small muted" }, eventLine(e)),
            n ? h("span", { class: "small warn-text" }, `⚠ Yayılırken ${n} kez değişti`) : null,
            e.correction ? h("span", { class: "small ok-text" }, `✓ Yalanlama var · ${e.correction.covered.length} / ${e.correction.claim_countries.length} ülkeye ulaştı`) : null));
        })) : h("p", { class: "muted" }, "Bu zaman aralığında gösterilecek olay yok.")));
      return;
    }
    const e = selected;
    const byId = new Map<string, Json>(e.nodes.map((n: Json) => [n.article_id, n]));
    const steps = [...e.links].sort((a: Json, b: Json) => a.time.localeCompare(b.time));
    const corr = e.correction;
    const corrById = new Map<string, Json>((corr?.nodes ?? []).map((n: Json) => [n.article_id, n]));
    const corrSteps: Array<{ t: number; el: HTMLElement }> = corr ? [
      ...(corr.first ? [{ t: Date.parse(corr.first.time), el: h("li", { "data-t": Date.parse(corr.first.time), class: "corr" },
        h("span", { class: "small muted" }, when(corr.first.time)),
        h("div", {}, "✓ ", h("strong", {}, "Yalanlama yayımlandı: "), h("strong", {}, countryName(corr.first.cc)), ` — ${sourceName(corr.first.source)}`)) }] : []),
      ...corr.links.map((l: Json) => ({ t: Date.parse(l.time), el: h("li", { "data-t": Date.parse(l.time), class: "corr" },
        h("button", { class: "step", onclick: () => { stop(); leaveGap(); setTime(Date.parse(l.time)); }, title: `${sourceName(corrById.get(l.from)?.source ?? "")} → ${sourceName(corrById.get(l.to)?.source ?? "")}` },
          h("span", { class: "small muted" }, when(l.time)),
          h("div", {}, "✓ Yalanlama: ", l.from_cc === l.to_cc ? [h("strong", {}, countryName(l.to_cc)), " içinde başka bir yayın"] : [h("strong", {}, countryName(l.from_cc)), " → ", h("strong", {}, countryName(l.to_cc))]))) })),
    ] : [];
    side.replaceChildren(h("div", {},
      h("button", { class: "linkback", onclick: overview }, "← Tüm olaylar"),
      h("h2", {}, e.title_tr || "Adlandırılmamış olay"),
      h("div", { class: "row" }, chip(e.momentum)),
      h("dl", { class: "facts" },
        e.first ? [h("dt", {}, "İlk çıktığı yer"), h("dd", {}, `${countryName(e.first.cc)} — ${sourceName(e.first.source)}`, h("div", { class: "small muted" }, when(e.first.time)))] : null,
        e.first?.hedged ? [h("dt", {}, "Nasıl başladı"), h("dd", { class: "warn-text" }, "Doğrulanmamış bir iddia olarak")] : null,
        [h("dt", {}, "Ulaştığı ülkeler"), h("dd", {}, e.countries.map(countryName).join(", "))],
        e.hours_span ? [h("dt", {}, "Süre"), h("dd", {}, eventLine({ first: null, countries: [], hours_span: e.hours_span }).replace(/^Tek ülkede kaldı · /, ""))] : null),
      e.correction ? gapSection(e) : null,
      h("h3", {}, "Nasıl yayıldı?"),
      h("ol", { class: "atlas-steps" },
        e.first ? h("li", { "data-t": Date.parse(e.first.time) }, h("span", { class: "small muted" }, when(e.first.time)), h("div", {}, h("strong", {}, countryName(e.first.cc)), " — ilk haber")) : null,
        [...steps.map((l: Json) => {
          const t = Date.parse(l.time);
          const notes = l.changes.map(changeText).filter(Boolean) as string[];
          const a = byId.get(l.from), b = byId.get(l.to);
          return h("li", { "data-t": t, class: notes.length ? "changed" : "" },
            h("button", { class: "step", onclick: () => { stop(); leaveGap(); setTime(t); }, title: `${sourceName(a?.source ?? "")} → ${sourceName(b?.source ?? "")}` },
              h("span", { class: "small muted" }, when(l.time)),
              h("div", {}, l.from_cc === l.to_cc ? [h("strong", {}, countryName(l.to_cc)), " içinde başka bir yayın"] : [h("strong", {}, countryName(l.from_cc)), " → ", h("strong", {}, countryName(l.to_cc))])),
            notes.map((t2) => h("div", { class: "change" }, "⚠ ", t2)),
            weakLinkNote(l.kind) ? h("div", { class: "small muted" }, weakLinkNote(l.kind)) : null);
        }).map((el: HTMLElement) => ({ t: Number(el.dataset.t), el })), ...corrSteps].sort((a, b) => a.t - b.t).map((x) => x.el)),
      h("div", { class: "side-actions" },
        h("button", { onclick: () => ui.onReport(e.event_id) }, "Bu olayın raporunu indir"),
        h("a", { href: `#/olay/${encodeURIComponent(e.event_id)}` }, "Haberleri gör →"))));
  }

  const initial = ui.initial ? events.find((e) => e.event_id === ui.initial) : null;
  if (initial) { overview(); select(initial); } else overview();
  return () => { stop(); ro.disconnect(); clearMarkers(); map.remove(); };
}

// ======================================================================
// RAPOR İÇİN HARİTA GÖRÜNTÜLERİ
// ======================================================================
/**
 * Ekran dışı bir haritada genel görünümü ve her olayın son halini çizer, PNG (data URL) olarak döndürür.
 * Noktalar ve ülke adları 2B tuvale çizilir (HTML işaretçiler WebGL görüntüsüne girmez).
 */
export async function reportImages(data: Json, eventIds: string[], withOverview: boolean): Promise<{ overview: string | null; events: Record<string, string>; gaps: Record<string, string> }> {
  ensureCss();
  const pts = await countryPoints();
  const at = (cc: string) => pts[cc];
  const W = 1000, Hh = 520;
  const host = document.createElement("div");
  host.className = "atlas-offscreen";
  host.style.width = `${W}px`; host.style.height = `${Hh}px`;
  document.body.append(host);
  const C = PRINT_PALETTE;
  const map = await createMap(host, C, true);
  const states = stateKeeper(map);
  const src = map.getSource("links") as GeoJSONSource;
  const csrc = map.getSource("corrections") as GeoJSONSource;

  const idle = () => new Promise<void>((r) => {
    let done = false;
    const fin = () => { if (!done) { done = true; r(); } };
    map.once("idle", fin); map.triggerRepaint(); setTimeout(fin, 4000);
  });
  const capture = (pins: Array<{ at: Pt; label: string; changed: boolean; root: boolean; ok?: boolean; gap?: boolean }>): string => {
    const gl = map.getCanvas();
    const c = document.createElement("canvas");
    c.width = W * 2; c.height = Hh * 2;
    const g = c.getContext("2d")!;
    g.drawImage(gl, 0, 0, c.width, c.height);
    g.scale(2, 2);
    g.font = "600 13px system-ui, -apple-system, 'Segoe UI', sans-serif";
    const boxes: Array<[number, number, number, number]> = pins.map((p) => { const q = map.project(p.at); return [q.x - 9, q.y - 9, q.x + 9, q.y + 9]; });
    for (const p of pins) {
      const q = map.project(p.at);
      if (p.root) { g.beginPath(); g.arc(q.x, q.y, 11, 0, Math.PI * 2); g.strokeStyle = C.flow; g.lineWidth = 2; g.stroke(); }
      g.beginPath(); g.arc(q.x, q.y, 6.5, 0, Math.PI * 2);
      g.fillStyle = p.ok ? C.ok : p.gap ? C.gap : p.changed ? C.changed : C.flow; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke();
    }
    for (const p of pins) {
      const q = map.project(p.at);
      const w = g.measureText(p.label).width + 12;
      const own = boxes.find((o) => o[0] === q.x - 9 && o[1] === q.y - 9);
      const cands: Array<[number, number]> = [[q.x + 13, q.y - 10], [q.x - w / 2, q.y + 12], [q.x - w / 2, q.y - 32], [q.x - 13 - w, q.y - 10]];
      const free = ([x, y]: [number, number]) => !boxes.some((o) => o !== own && x < o[2] && x + w > o[0] && y < o[3] && y + 20 > o[1]);
      const [x, y] = cands.find(free) ?? cands[0]!;
      boxes.push([x, y, x + w, y + 20]);
      g.fillStyle = C.labelBg; g.strokeStyle = C.labelBorder; g.lineWidth = 1;
      g.beginPath(); g.roundRect(x, y, w, 20, 4); g.fill(); g.stroke();
      g.fillStyle = C.text; g.fillText(p.label, x + 6, y + 14.5);
    }
    return c.toDataURL("image/png");
  };

  const out: { overview: string | null; events: Record<string, string>; gaps: Record<string, string> } = { overview: null, events: {}, gaps: {} };
  try {
    const events: Json[] = data.events.filter((e: Json) => e.nodes.some((n: Json) => at(n.cc)));
    if (withOverview) {
      for (const [cc, v] of Object.entries<Json>(data.countries)) if (at(cc)) states.set(cc, { n: v.articles });
      src.setData(overviewFeatures(events, at));
      const b = new LngLatBounds();
      for (const e of events) for (const n of e.nodes) if (at(n.cc)) b.extend(at(n.cc)!);
      if (!b.isEmpty()) map.fitBounds(b, { padding: 70, maxZoom: 3.2, duration: 0 });
      await idle();
      const firsts = new Map<string, boolean>();
      for (const e of events) if (e.first && at(e.first.cc)) firsts.set(e.first.cc, (firsts.get(e.first.cc) ?? false) || visibleChanges(e) > 0);
      out.overview = capture([...firsts].map(([cc, changed]) => ({ at: at(cc)!, label: countryName(cc), changed, root: true })));
    }
    for (const id of eventIds) {
      const e = events.find((x) => x.event_id === id);
      if (!e) continue;
      states.clear();
      const byCc = new Map<string, { changed: boolean; root: boolean }>();
      for (const n of e.nodes) {
        if (!at(n.cc)) continue;
        const cur = byCc.get(n.cc) ?? { changed: false, root: false };
        byCc.set(n.cc, { changed: cur.changed || changedNode(e, n.article_id), root: cur.root || n.root });
      }
      for (const [cc, s] of byCc) states.set(cc, s.changed ? { changed: true } : { reached: true });
      src.setData({
        type: "FeatureCollection",
        features: e.links.filter((l: Json) => l.from_cc !== l.to_cc && at(l.from_cc) && at(l.to_cc)).map((l: Json) => ({
          type: "Feature" as const, properties: { changed: changedLink(l), op: 0.95 },
          geometry: { type: "LineString" as const, coordinates: arc(at(l.from_cc)!, at(l.to_cc)!) },
        })),
      });
      csrc.setData(EMPTY_FC);
      const corrCcs = new Set<string>((e.correction?.nodes ?? []).map((n: Json) => n.cc).filter((cc: string) => at(cc)));
      const b = new LngLatBounds();
      for (const cc of [...byCc.keys(), ...corrCcs]) b.extend(at(cc)!);
      map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 80, right: 160 }, maxZoom: 3.6, duration: 0 });
      await idle();
      out.events[id] = capture([...byCc].map(([cc, s]) => ({ at: at(cc)!, label: countryName(cc), ...s })));
      // Düzeltme boşluğu görüntüsü: yalanlamanın ulaştığı ülkeler yeşil, ulaşmadığı iddia ülkeleri turuncu.
      if (e.correction) {
        states.clear();
        for (const cc of new Set([...byCc.keys(), ...corrCcs])) states.set(cc, corrCcs.has(cc) ? { corrected: true } : { gap: true });
        src.setData(EMPTY_FC);
        csrc.setData(corrFeatures(e, at));
        await idle();
        out.gaps[id] = capture([...new Set([...byCc.keys(), ...corrCcs])].map((cc) => ({
          at: at(cc)!, label: corrCcs.has(cc) ? `✓ ${countryName(cc)}` : countryName(cc), changed: false, root: false, ok: corrCcs.has(cc), gap: !corrCcs.has(cc),
        })));
      }
    }
  } finally {
    map.remove(); host.remove();
  }
  return out;
}
