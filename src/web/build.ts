// Arayüzü bellekte derler (Bun.build). Ek bağımlılık veya dış CDN yok.
import { readFile } from "node:fs/promises";

export async function buildWebAssets(): Promise<Map<string, [string, string]>> {
  const dir = new URL(".", import.meta.url).pathname;
  const out = await Bun.build({ entrypoints: [dir + "app.ts"], minify: true, target: "browser", sourcemap: "none" });
  if (!out.success) throw new Error("Arayüz derlenemedi: " + out.logs.map((l) => l.message).join("; "));
  const js = await out.outputs[0]!.text();
  return new Map<string, [string, string]>([
    ["/index.html", [await readFile(dir + "index.html", "utf8"), "text/html; charset=utf-8"]],
    ["/app.css", [await readFile(dir + "app.css", "utf8"), "text/css; charset=utf-8"]],
    ["/app.js", [js, "text/javascript; charset=utf-8"]],
  ]);
}
