// MOCK LLM — gerçek model DEĞİLDİR. Çıktıları "[MOCK]" önekiyle ve `mock: true` bayrağıyla işaretlenir.
// Girdi istemindeki JSON bloğunu okuyup kaynak cümlelerini AYNEN alıntılayan deterministik bir yanıt üretir.

import { extractPayload } from "./prompt.ts";
import { LlmError, type ChatMessage, type LlmProvider } from "./types.ts";

export type MockBehavior = "ok" | "timeout" | "bad_json" | "bad_schema" | "http_500";

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "mock-deterministic";
  readonly mock = true;
  calls = 0;

  /** Testlerde sırayla uygulanacak davranışlar; boşsa her zaman "ok". */
  constructor(private readonly script: MockBehavior[] = []) {}

  async complete(messages: ChatMessage[], o: { timeoutMs: number }): Promise<string> {
    const behavior = this.script[this.calls++] ?? "ok";
    if (behavior === "timeout") {
      await new Promise((r) => setTimeout(r, Math.min(o.timeoutMs + 5, 50)));
      throw new LlmError(`LLM zaman aşımı (${o.timeoutMs} ms)`, "timeout", true);
    }
    if (behavior === "http_500") {
      throw new LlmError("LLM HTTP 500", "http", true);
    }
    if (behavior === "bad_json") return "Elbette! İşte analiz: {kesik";
    if (behavior === "bad_schema") return JSON.stringify({ title: 1, claims: "yok" });

    const payload = extractPayload(messages.find((m) => m.role === "user")?.content ?? "");
    const arts = payload?.articles ?? [];
    const claims = arts.slice(0, 3).map((a) => {
      const first = (a.text.split(/(?<=[.!?؟。])\s+/)[0] ?? a.text).trim();
      return { text_tr: `[MOCK] Kaynak cümlesi (${a.lang}): ${first}`, sources: [{ article_id: a.id, quote: first }] };
    });
    return JSON.stringify({
      title_tr: `[MOCK] ${payload?.rule_title ?? "Olay"}`,
      summary_tr: `[MOCK] Bu özet sahte sağlayıcıyla üretildi; ${arts.length} haber, ${new Set(arts.map((a) => a.lang)).size} dil. Gerçek model analizi değildir.`,
      claims,
    });
  }
}
