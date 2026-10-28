import { DEMO_GAZETTEER } from "../data/mock/gazetteer.ts";
import { MOCK_ARTICLES } from "../data/mock/articles.ts";
import { Gazetteer } from "../src/pipeline/entities.ts";
import { runIngestion } from "../src/pipeline/ingest.ts";
import { MockDataProvider } from "../src/providers/mock.ts";
import { MemoryRepo } from "../src/store/memory.ts";

export const NOW = new Date("2026-10-28T12:00:00Z");
export const now = () => NOW;
export const gz = new Gazetteer(DEMO_GAZETTEER);

export async function ingestedRepo() {
  const repo = new MemoryRepo();
  const res = await runIngestion(new MockDataProvider(now), repo, gz, { now });
  const arts = await repo.getArticles(Object.keys(res.labels));
  const byKey = new Map(arts.map((a) => [MOCK_ARTICLES.find((m) => m.url === a.url)!.key, a]));
  const members = await repo.memberOfArticles(arts.map((a) => a.article_id));
  const eventOf = (key: string) => members.find((m) => m.article_id === byKey.get(key)!.article_id)!.event_id;
  const labelOf = (key: string) => res.labels[byKey.get(key)!.article_id];
  return { repo, res, byKey, eventOf, labelOf };
}
