// ClickHouse HTTP istemcisi.
// GÜVENLİK: Değerler SQL metnine ASLA birleştirilmez; ClickHouse sorgu parametreleri ({ad:Tür} + param_ad) kullanılır.
// Kimlik bilgisi URL'de değil başlıklarda gönderilir (log'lara sızmaz).

export type Params = Record<string, string | number | boolean | string[] | null>;

export interface ChOptions { url: string; db: string; user: string; password: string; maxConcurrency: number }

class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    else this.active++;
    try { return await fn(); } finally { const n = this.waiters.shift(); if (n) n(); else this.active--; }
  }
}

/**
 * ClickHouse HTTP parametre değeri biçimi. Parametreler SQL olarak yorumlanmaz; ClickHouse değeri
 * TSV kaçış kurallarıyla okur, bu yüzden ters bölü/sekme/satır sonu kaçışlanır (veri bozulmasın diye).
 */
const tsvEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
export function encodeParam(v: Params[string]): string {
  if (v === null) return "\\N";
  if (Array.isArray(v)) return tsvEscape("[" + v.map((x) => "'" + String(x).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'").join(",") + "]");
  if (typeof v === "boolean") return v ? "1" : "0";
  return tsvEscape(String(v));
}

export class ChClient {
  private readonly sem: Semaphore;
  constructor(private readonly o: ChOptions, private readonly fetchImpl: typeof fetch = fetch) {
    this.sem = new Semaphore(o.maxConcurrency);
  }

  private async exec(sql: string, params: Params = {}, body?: string): Promise<string> {
    const u = new URL(this.o.url);
    u.searchParams.set("database", this.o.db);
    u.searchParams.set("date_time_input_format", "best_effort");
    u.searchParams.set("date_time_output_format", "iso");
    u.searchParams.set("output_format_json_quote_64bit_integers", "0");
    for (const [k, v] of Object.entries(params)) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(k)) throw new Error("geçersiz parametre adı");
      u.searchParams.set("param_" + k, encodeParam(v));
    }
    let payload = sql;
    if (body !== undefined) { u.searchParams.set("query", sql); payload = body; }
    return this.sem.run(async () => {
      const res = await this.fetchImpl(u.toString(), {
        method: "POST",
        headers: { "X-ClickHouse-User": this.o.user, "X-ClickHouse-Key": this.o.password, "Content-Type": "text/plain; charset=utf-8" },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      // Hata gövdesi SQL/şema ayrıntısı içerebilir: yalnız sunucu log'una, kısaltılmış olarak.
      if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 300)}`);
      return text;
    });
  }

  async command(sql: string, params: Params = {}): Promise<void> { await this.exec(sql, params); }

  async query<T>(sql: string, params: Params = {}): Promise<T[]> {
    const text = await this.exec(sql + "\nFORMAT JSONEachRow", params);
    return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
  }

  async insert(table: string, rows: object[]): Promise<void> {
    if (!rows.length) return;
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error("geçersiz tablo adı");
    await this.exec(`INSERT INTO ${table} FORMAT JSONEachRow`, {}, rows.map((r) => JSON.stringify(r)).join("\n"));
  }
}
