// Numaralı migration çalıştırıcı. migrations/NNN_ad.sql dosyaları sırayla, yalnız bir kez uygulanır.
// Uygulanan sürümler schema_migrations tablosuna yazılır. Migration'lar yalnız ileri yönlüdür;
// geri alma gerekiyorsa yeni bir migration yazılır (ClickHouse'ta DDL işlem içinde geri alınamaz).

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../log.ts";
import type { ChClient } from "./ch_client.ts";

export interface Migration { version: number; name: string; statements: string[] }

/** SQL dosyasını ifadelere böler: satır yorumları atılır, ';' ile biten satırlar ifadeyi kapatır. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  for (const line of sql.split("\n")) {
    const t = line.replace(/--.*$/, "").trimEnd();
    if (!t.trim()) continue;
    buf.push(t);
    if (t.endsWith(";")) { out.push(buf.join("\n").replace(/;$/, "")); buf = []; }
  }
  if (buf.join("").trim()) out.push(buf.join("\n"));
  return out;
}

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const out: Migration[] = [];
  for (const f of files) {
    out.push({ version: Number(f.slice(0, 3)), name: f, statements: splitStatements(await readFile(join(dir, f), "utf8")) });
  }
  const versions = out.map((m) => m.version);
  if (new Set(versions).size !== versions.length) throw new Error("yinelenen migration sürümü");
  return out;
}

export async function migrate(ch: ChClient, dir: string): Promise<{ applied: string[] }> {
  await ch.command(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version UInt32, name String, applied_at DateTime64(3, 'UTC') DEFAULT now64(3)) ENGINE = MergeTree ORDER BY version",
  );
  const done = new Set((await ch.query<{ version: number }>("SELECT version FROM schema_migrations")).map((r) => Number(r.version)));
  const applied: string[] = [];
  for (const m of await loadMigrations(dir)) {
    if (done.has(m.version)) continue;
    for (const st of m.statements) await ch.command(st);
    await ch.insert("schema_migrations", [{ version: m.version, name: m.name }]);
    applied.push(m.name);
    log("info", "migration uygulandı", { name: m.name });
  }
  return { applied };
}
