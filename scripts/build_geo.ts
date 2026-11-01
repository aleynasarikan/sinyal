// Atlas için ülke sınırlarını üretir: world-atlas (Natural Earth 1:50m, kamu malı) → GeoJSON + ISO alpha-2 + çizim noktası.
// Çıktı depoya işlenir (data/geo/countries.json); çalışma anında dış istek YOK. Yeniden üretmek: bun scripts/build_geo.ts
//
// NOT: Sınırlar Natural Earth'ün "fiili" (de facto) sınırlarıdır. Tartışmalı bölgelerin (ör. Kıbrıs) gösterimi kurumsal
// karar gerektirir; bu betik özellikleri değiştirmez, kodsuz olanları `iso: ""` ile bırakır.

import countries from "i18n-iso-countries";
import trLocale from "i18n-iso-countries/langs/tr.json" with { type: "json" };
import { feature } from "topojson-client";
import topo50 from "world-atlas/countries-50m.json" with { type: "json" };
import topo110 from "world-atlas/countries-110m.json" with { type: "json" };

// ISO 3166'da numerik kodu olmayan ama yaygın kullanılan kullanıcı-atamalı kodlar.
const EXTRA: Record<string, string> = { Kosovo: "XK" };
// Tarih değiştirme hattını geçen ülkelerde ağırlık merkezi kayar; görsel merkez elle verilir.
const POINT_OVERRIDE: Record<string, [number, number]> = { RU: [96, 62] };

type Ring = [number, number][];
const round = (n: number) => Math.round(n * 100) / 100;

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] + r[i]![0]) * (r[j]![1] - r[i]![1]);
  return Math.abs(a / 2);
}
function ringCentroid(r: Ring): [number, number] {
  let x = 0, y = 0, a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
    x += (r[j]![0] + r[i]![0]) * f; y += (r[j]![1] + r[i]![1]) * f; a += f;
  }
  return a ? [x / (3 * a), y / (3 * a)] : r[0]!;
}

/** Halka 180° hattını atlıyorsa (ardışık noktalar arası |Δboylam| > 180) sürekli hale getirir. */
function unwrap(r: Ring): Ring {
  const out: Ring = [];
  let off = 0;
  for (let i = 0; i < r.length; i++) {
    if (i && r[i]![0] + off - out[i - 1]![0] > 180) off -= 360;
    else if (i && r[i]![0] + off - out[i - 1]![0] < -180) off += 360;
    out.push([r[i]![0] + off, r[i]![1]]);
  }
  return out;
}
/** Sutherland–Hodgman: halkayı x = k doğrusunun bir yanına kırpar. */
function clip(r: Ring, k: number, keepLeft: boolean): Ring {
  const inside = (p: [number, number]) => (keepLeft ? p[0] <= k : p[0] >= k);
  const out: Ring = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) { const t = (k - a[0]) / (b[0] - a[0]); out.push([k, a[1] + t * (b[1] - a[1])]); }
  }
  if (out.length && (out[0]![0] !== out.at(-1)![0] || out[0]![1] !== out.at(-1)![1])) out.push(out[0]!);
  return out;
}
/** 180° hattını geçen poligonu iki yarıya böler (maplibre aksi halde dünyayı boydan boya kesen şeritler çizer). */
function splitAntimeridian(polys: Ring[][]): Ring[][] {
  const out: Ring[][] = [];
  for (const p of polys) {
    const outer = p[0]!;
    if (!outer.some((pt, i) => i && Math.abs(pt[0] - outer[i - 1]![0]) > 180)) { out.push(p); continue; }
    const u = unwrap(outer);
    const base = Math.min(...u.map((q) => q[0])) < -180 ? -180 : 180;
    const west = clip(u, base, true), east = clip(u, base, false);
    const norm = (r: Ring): Ring => r.map(([x, y]) => [x > 180 ? x - 360 : x < -180 ? x + 360 : x, y]);
    // Kırpılmış kenar tam ±180'de kalmalı: normalize sırasında 180 → -180 olmasın diye işaretle.
    const fix = (r: Ring, side: number): Ring => norm(r).map(([x, y], i) => [r[i]![0] === base ? side : x, y]);
    // Batı yarısı (x ≤ kesim) normalize edilince 180°'nin doğu yakasına (+180), doğu yarısı batı yakasına (-180) düşer.
    if (west.length >= 4) out.push([fix(west, 180)]);
    if (east.length >= 4) out.push([fix(east, -180)]);
  }
  return out;
}

function build(topo: any, withGeometry: boolean) {
  const fc = feature(topo, topo.objects.countries) as any;
  const feats: any[] = [];
  for (const f of fc.features) {
    const name0 = f.properties?.name ?? "";
    if (name0 === "Antarctica") continue; // haber yayılımı için anlamsız; kutup çevresi halkası Mercator'da şerit çizer
    const raw: Ring[][] = f.geometry?.type === "Polygon" ? [f.geometry.coordinates] : f.geometry?.coordinates ?? [];
    if (!raw.length) continue;
    const polys = splitAntimeridian(raw);
    const main = polys.reduce((m, p) => (ringArea(p[0]!) > ringArea(m[0]!) ? p : m));
    const name = f.properties?.name ?? "";
    const iso = (f.id ? countries.numericToAlpha2(String(f.id).padStart(3, "0")) : undefined) ?? EXTRA[name] ?? "";
    const [lx, ly] = ringCentroid(main[0]!);
    // Koordinatları 0.01° hassasiyete indir (dosya boyutu); halkalardaki ardışık tekrarları at.
    const geometry = withGeometry ? {
      type: "MultiPolygon",
      coordinates: polys.map((p) => p.map((r) => r.map(([x, y]) => [round(x), round(y)]).filter((pt, i, arr) => !i || pt[0] !== arr[i - 1]![0] || pt[1] !== arr[i - 1]![1]))),
    } : null;
    feats.push({ type: "Feature", properties: { iso, name, lx: round(lx), ly: round(ly) }, geometry });
  }
  return feats;
}

const dir = new URL("../data/geo/", import.meta.url).pathname;
// Çizim: 1:110m sınırlar (hafif). Ok uçları: 1:50m'den ülke çizim noktaları (küçük ülkeler de dahil).
const shapes = build(topo110, true);
const points: Record<string, [number, number]> = {};
for (const f of build(topo50, false)) if (f.properties.iso) {
  const [x, y] = POINT_OVERRIDE[f.properties.iso] ?? [f.properties.lx, f.properties.ly];
  points[f.properties.iso] = [x > 180 ? x - 360 : x < -180 ? x + 360 : x, y];
}
await Bun.write(dir + "countries.json", JSON.stringify({ type: "FeatureCollection", features: shapes }));
await Bun.write(dir + "country_points.json", JSON.stringify(points));
// Arayüzde ülke kodu yerine Türkçe ad gösterilir (resmi Türkçe kullanım; i18n-iso-countries "tr" yerel ayarı).
countries.registerLocale(trLocale as any);
const names: Record<string, string> = { XK: "Kosova" };
for (const cc of Object.keys(points)) names[cc] ??= countries.getName(cc, "tr") ?? cc;
await Bun.write(dir + "country_names_tr.json", JSON.stringify(names));
const kb = (f: string) => Math.round(Bun.file(dir + f).size / 1024);
const missing = shapes.filter((f) => !f.properties.iso).map((f) => f.properties.name);
console.log(`${shapes.length} sınır (${kb("countries.json")} KB), ${Object.keys(points).length} çizim noktası (${kb("country_points.json")} KB); ISO kodu olmayan: ${missing.join(", ") || "yok"}`);
