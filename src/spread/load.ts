// Yayılım hesabı için olay verisini depodan toplar (salt okuma; yeni tablo/yazım yok).

import type { Repo } from "../store/repo.ts";
import { computeSpread, type SpreadResult } from "./spread.ts";

export async function eventSpread(repo: Repo, eventId: string, nowMs: number): Promise<SpreadResult> {
  const members = await repo.membersOf([eventId]);
  const ids = members.map((m) => m.article_id);
  const [articles, entities, sources] = await Promise.all([repo.getArticles(ids), repo.entitiesFor(ids), repo.listSources()]);
  return computeSpread({ event_id: eventId, articles, entities, sources, nowMs });
}
