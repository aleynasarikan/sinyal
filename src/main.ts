// SİNYAL sunucu giriş noktası.

import { createApp } from "./api/server.ts";
import { buildDeps } from "./app.ts";
import { seedUsers } from "./auth/auth.ts";
import { loadConfig } from "./config.ts";
import { log } from "./log.ts";
import { runIngestion } from "./pipeline/ingest.ts";
import { buildWebAssets } from "./web/build.ts";

const cfg = loadConfig();
const deps = await buildDeps(cfg);
await seedUsers(deps.repo, cfg.seed);

// Demo kurulumunda (mock sağlayıcı) açılışta bir kez örnek veri alınır. İdempotent: tekrar başlatmada kopya oluşmaz.
if (deps.provider.name === "mock") await runIngestion(deps.provider, deps.repo, deps.gz);

const handler = createApp({ cfg, ...deps, assets: await buildWebAssets() });

const server = Bun.serve({
  hostname: cfg.host,
  port: cfg.port,
  maxRequestBodySize: cfg.maxBodyBytes,
  fetch: (req, srv) => handler(req, srv.requestIP(req)?.address ?? null),
  error: (e) => {
    log("error", "sunucu hatası", { err: e.message });
    return new Response("Sunucu hatası", { status: 500 });
  },
});

log("info", "SİNYAL başladı", {
  url: `http://${server.hostname}:${server.port}`, store: deps.repo.kind, data_provider: deps.provider.name,
  llm: `${deps.llm.name}${deps.llm.mock ? " (MOCK)" : ""}`, cookie_secure: cfg.cookieSecure,
});
