// Gerçek ClickHouse olmadan: SQL'e değer birleştirilmediğini, parametre kodlamasını ve migration ayrıştırmayı doğrular.
import { describe, expect, test } from "bun:test";
import { ChClient, encodeParam } from "../src/store/ch_client.ts";
import { ClickHouseRepo } from "../src/store/clickhouse.ts";
import { loadMigrations, splitStatements } from "../src/store/migrate.ts";

function fakeCh() {
  const calls: Array<{ url: URL; body: string; headers: Headers }> = [];
  const f = (async (u: string, init: RequestInit) => {
    calls.push({ url: new URL(u), body: String(init.body), headers: new Headers(init.headers) });
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, ch: new ChClient({ url: "http://127.0.0.1:8124", db: "sinyal", user: "sinyal", password: "gizli", maxConcurrency: 2 }, f) };
}

describe("ClickHouse istemcisi", () => {
  test("Kullanıcı girdisi SQL metnine girmez, param_* ile gider", async () => {
    const { calls, ch } = fakeCh();
    const repo = new ClickHouseRepo(ch);
    const evil = "x' OR 1=1 --";
    await repo.searchArticles({ q: evil, lang: evil, entity: evil, limit: 10, offset: 0 });
    for (const c of calls) {
      expect(c.body).not.toContain("OR 1=1");
      expect(c.url.searchParams.get("param_lang")).toBe(evil);
    }
  });
  test("Kimlik bilgisi URL'de değil başlıkta", async () => {
    const { calls, ch } = fakeCh();
    await new ClickHouseRepo(ch).getUser("u1");
    expect(calls[0]!.url.toString()).not.toContain("gizli");
    expect(calls[0]!.headers.get("x-clickhouse-key")).toBe("gizli");
  });
  test("Parametre kodlaması: kaçış ve diziler", () => {
    expect(encodeParam("a\\b\tc\nd")).toBe("a\\\\b\\tc\\nd");
    expect(encodeParam(["a'b", "c"])).toBe("['a\\\\'b','c']");
    expect(encodeParam(null)).toBe("\\N");
  });
  test("INSERT gövdesi JSONEachRow, tablo adı doğrulanır", async () => {
    const { calls, ch } = fakeCh();
    await ch.insert("articles", [{ a: 1 }, { a: 2 }]);
    expect(calls[0]!.url.searchParams.get("query")).toBe("INSERT INTO articles FORMAT JSONEachRow");
    expect(calls[0]!.body).toBe('{"a":1}\n{"a":2}');
    await expect(ch.insert("articles; DROP TABLE x", [{}])).rejects.toThrow();
  });
});

describe("Migration", () => {
  test("Dosyalar sıralı yüklenir, yorumlar atılır, ifadeler ayrılır", async () => {
    const ms = await loadMigrations(new URL("../migrations", import.meta.url).pathname);
    expect(ms[0]!.version).toBe(1);
    const tables = ms[0]!.statements.map((s) => s.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1]);
    expect(tables).toEqual(["sources", "articles", "article_translations", "extracted_entities", "events", "event_members", "event_updates", "claims", "claim_sources", "claim_reviews", "analysis_runs", "ingestion_runs", "users", "sessions", "audit_logs"]);
    for (const s of ms[0]!.statements) { expect(s).not.toContain("--"); expect(s).not.toMatch(/ALTER TABLE .* (UPDATE|DELETE)/); expect(s).not.toContain("TTL"); }
  });
  test("splitStatements", () => {
    expect(splitStatements("-- a\nSELECT 1;\nSELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });
});
