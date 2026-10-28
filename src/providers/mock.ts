// MockDataProvider — geliştirme ve demo için SENTETİK veri. Her sonuç `demo: true` taşır.

import { MOCK_ARTICLES, MOCK_SOURCES } from "../../data/mock/articles.ts";
import type { DataProvider, FetchResult, ProviderStatus, RawArticle } from "./types.ts";

export class MockDataProvider implements DataProvider {
  readonly name = "mock";
  constructor(private readonly now: () => Date = () => new Date()) {}

  async status(): Promise<ProviderStatus> {
    return { provider: this.name, state: "ok", demo: true, message: "Demo veri: kurgusal olaylar ve yayıncılar (.example)" };
  }

  async fetchBatch(opts: { limit: number }): Promise<FetchResult> {
    const base = this.now().getTime();
    const articles: RawArticle[] = MOCK_ARTICLES.slice(0, opts.limit).map((m) => ({
      external_id: "mock:" + m.key,
      source_id: m.source_id,
      url: m.url,
      title: m.title,
      body: m.body,
      lang_declared: m.lang,
      published_at: m.hoursAgo === null ? null : new Date(base - m.hoursAgo * 3_600_000).toISOString(),
      date_estimated: !!m.dateEstimated,
    }));
    return { ok: true, demo: true, sources: MOCK_SOURCES, articles };
  }
}
