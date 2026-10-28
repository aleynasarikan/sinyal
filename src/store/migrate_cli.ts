import { loadConfig } from "../config.ts";
import { ChClient } from "./ch_client.ts";
import { migrate } from "./migrate.ts";

const cfg = loadConfig();
if (!cfg.clickhouse.password) {
  console.error("CLICKHOUSE_PASSWORD tanımlı değil; migration çalıştırılmadı.");
  process.exit(1);
}
const res = await migrate(new ChClient(cfg.clickhouse), new URL("../../migrations", import.meta.url).pathname);
console.log(res.applied.length ? `Uygulanan: ${res.applied.join(", ")}` : "Şema güncel.");
