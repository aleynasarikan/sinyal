// Değerlendirme aracı.
//   bun run eval --synthetic            → sentetik demo setiyle HATTI doğrular (gerçek kalite ölçümü DEĞİLDİR)
//   bun run eval --gold eval/gold/x.jsonl --system out.jsonl → analist etiketli altın setle ölçüm
// Altın set satır biçimi: {"article_id","lang","gold_event","gold_novelty"?,"gold_names"?}
// Sistem satır biçimi:    {"article_id","sys_event","sys_novelty"?,"sys_names"?,"latency_ms"?}

import { readFile } from "node:fs/promises";
import { MOCK_ARTICLES } from "../../data/mock/articles.ts";
import { DEMO_GAZETTEER } from "../../data/mock/gazetteer.ts";
import { Gazetteer } from "../pipeline/entities.ts";
import { runIngestion } from "../pipeline/ingest.ts";
import { MockDataProvider } from "../providers/mock.ts";
import { MemoryRepo } from "../store/memory.ts";
import { bcubed, crossLingualRecall, falseMergeRate, latency, perClassPR, type GoldItem, type SysItem } from "./metrics.ts";

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

async function readJsonl<T>(p: string): Promise<T[]> {
  return (await readFile(p, "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

export function report(gold: GoldItem[], sys: SysItem[]) {
  const g = new Map(gold.map((x) => [x.article_id, x.gold_event]));
  const s = new Map(sys.map((x) => [x.article_id, x.sys_event]));
  const sysById = new Map(sys.map((x) => [x.article_id, x]));
  const nov = gold.filter((x) => x.gold_novelty && sysById.get(x.article_id)?.sys_novelty)
    .map((x) => ({ gold: x.gold_novelty!, sys: sysById.get(x.article_id)!.sys_novelty! }));
  return {
    n_gold: gold.length,
    bcubed: bcubed(g, s),
    cross_lingual: crossLingualRecall(gold, s),
    false_merge: falseMergeRate(g, s),
    novelty: perClassPR(nov),
    latency_ms: latency(sys.map((x) => x.latency_ms).filter((x): x is number => typeof x === "number")),
  };
}

if (import.meta.main) {
  if (args.includes("--synthetic")) {
    const repo = new MemoryRepo();
    const gz = new Gazetteer(DEMO_GAZETTEER);
    const t0 = performance.now();
    const res = await runIngestion(new MockDataProvider(), repo, gz);
    const perArticle = (performance.now() - t0) / Math.max(1, res.run.inserted);
    const arts = await repo.getArticles(Object.keys(res.labels));
    const members = await repo.memberOfArticles(arts.map((a) => a.article_id));
    const gold: GoldItem[] = [], sys: SysItem[] = [];
    for (const a of arts) {
      const m = MOCK_ARTICLES.find((x) => x.url === a.url)!;
      gold.push({ article_id: a.article_id, lang: m.lang, gold_event: m.expect.event, gold_novelty: m.expect.novelty });
      sys.push({ article_id: a.article_id, sys_event: members.find((x) => x.article_id === a.article_id)!.event_id, sys_novelty: res.labels[a.article_id], latency_ms: Math.round(perArticle * 100) / 100 });
    }
    console.log("UYARI: SENTETİK set (21 haber, geliştiricinin yazdığı beklentiler). Bu sayılar sistem kalitesini ÖLÇMEZ;");
    console.log("yalnız değerlendirme hattının uçtan uca çalıştığını doğrular. Gerçek ölçüm için analist etiketli altın set gerekir.\n");
    console.log(JSON.stringify(report(gold, sys), null, 2));
  } else if (arg("--gold") && arg("--system")) {
    console.log(JSON.stringify(report(await readJsonl<GoldItem>(arg("--gold")!), await readJsonl<SysItem>(arg("--system")!)), null, 2));
  } else {
    console.error("Kullanım: bun run eval --synthetic | --gold <altın.jsonl> --system <sistem.jsonl>");
    process.exit(2);
  }
}
