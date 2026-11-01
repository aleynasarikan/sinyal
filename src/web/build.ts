// Arayüzü bellekte derler (Bun.build). Dış CDN yok: tüm betik, stil ve veri SİNYAL'in kendi kökeninden servis edilir.
// Atlas (maplibre-gl, ~1 MB) ayrı parçaya bölünür; yalnız Atlas ekranı açılınca yüklenir.
import { readFile } from "node:fs/promises";

const MAPLIBRE = new URL("../../node_modules/maplibre-gl/dist/", import.meta.url).pathname;
const GEO = new URL("../../data/geo/", import.meta.url).pathname;

export async function buildWebAssets(): Promise<Map<string, [string, string]>> {
  const dir = new URL(".", import.meta.url).pathname;
  const out = await Bun.build({
    entrypoints: [dir + "app.ts"], minify: true, target: "browser", sourcemap: "none", splitting: true, format: "esm",
    naming: { entry: "[name].[ext]", chunk: "chunk-[hash].[ext]" },
  });
  if (!out.success) throw new Error("Arayüz derlenemedi: " + out.logs.map((l) => l.message).join("; "));
  const assets = new Map<string, [string, string]>([
    ["/index.html", [await readFile(dir + "index.html", "utf8"), "text/html; charset=utf-8"]],
    ["/app.css", [await readFile(dir + "app.css", "utf8"), "text/css; charset=utf-8"]],
    // maplibre'nin kendi worker'ı ve stili — aynı kökenden (CSP: script-src/worker 'self').
    ["/maplibre-gl-worker.mjs", [await readFile(MAPLIBRE + "maplibre-gl-worker.mjs", "utf8"), "text/javascript; charset=utf-8"]],
    ["/maplibre-gl.css", [await readFile(MAPLIBRE + "maplibre-gl.css", "utf8"), "text/css; charset=utf-8"]],
    // Ülke sınırları ve çizim noktaları (Natural Earth, kamu malı) — scripts/build_geo.ts üretir.
    ["/geo/countries.json", [await readFile(GEO + "countries.json", "utf8"), "application/json; charset=utf-8"]],
    ["/geo/country_points.json", [await readFile(GEO + "country_points.json", "utf8"), "application/json; charset=utf-8"]],
  ]);
  for (const o of out.outputs) assets.set("/" + o.path.replace(/^\.\//, ""), [await o.text(), "text/javascript; charset=utf-8"]);
  return assets;
}
