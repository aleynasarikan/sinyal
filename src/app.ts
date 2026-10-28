// Bağımlılıkların kurulumu (yapılandırmaya göre depo, veri sağlayıcı ve model sağlayıcı seçimi).

import { DEMO_GAZETTEER } from "../data/mock/gazetteer.ts";
import type { Config } from "./config.ts";
import { MockLlmProvider } from "./llm/mock.ts";
import { OpenAiCompatibleProvider } from "./llm/openai.ts";
import type { LlmProvider } from "./llm/types.ts";
import { log } from "./log.ts";
import { initLlmStats } from "./metrics.ts";
import { Gazetteer } from "./pipeline/entities.ts";
import { MockDataProvider } from "./providers/mock.ts";
import type { DataProvider } from "./providers/types.ts";
import { UmiApiProvider } from "./providers/umi_api.ts";
import { ChClient } from "./store/ch_client.ts";
import { ClickHouseRepo } from "./store/clickhouse.ts";
import { MemoryRepo } from "./store/memory.ts";
import { migrate } from "./store/migrate.ts";
import type { Repo } from "./store/repo.ts";

export async function buildDeps(cfg: Config): Promise<{ repo: Repo; provider: DataProvider; llm: LlmProvider; gz: Gazetteer }> {
  let repo: Repo;
  if (cfg.store === "clickhouse") {
    if (!cfg.clickhouse.password) throw new Error("SINYAL_STORE=clickhouse için CLICKHOUSE_PASSWORD gerekli");
    const ch = new ChClient(cfg.clickhouse);
    await migrate(ch, new URL("../migrations", import.meta.url).pathname);
    repo = new ClickHouseRepo(ch);
  } else {
    repo = new MemoryRepo();
    log("warn", "bellek içi depo kullanılıyor: veriler süreç kapanınca kaybolur");
  }

  const provider: DataProvider = cfg.dataProvider === "umi_api" ? new UmiApiProvider(cfg.umiApi) : new MockDataProvider();

  let llm: LlmProvider;
  if (cfg.llm.provider === "openai") {
    llm = new OpenAiCompatibleProvider({ baseUrl: cfg.llm.baseUrl, apiKey: cfg.llm.apiKey, model: cfg.llm.model });
  } else {
    llm = new MockLlmProvider();
  }
  initLlmStats(llm.name, llm.model, llm.mock);

  return { repo, provider, llm, gz: new Gazetteer(DEMO_GAZETTEER) };
}
