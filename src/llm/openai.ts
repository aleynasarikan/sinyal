// OpenAI uyumlu Chat Completions sağlayıcısı.
// GÜVENLİK: TLS doğrulaması KAPATILAMAZ (özel CA gerekiyorsa NODE_EXTRA_CA_CERTS). Anahtar loglanmaz.

import { LlmError, type ChatMessage, type LlmProvider } from "./types.ts";

export interface OpenAiOptions { baseUrl: string; apiKey: string; model: string }

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = "openai";
  readonly mock = false;
  readonly model: string;

  constructor(private readonly opts: OpenAiOptions, private readonly fetchImpl: typeof fetch = fetch) {
    if (!opts.baseUrl || !opts.model) throw new LlmError("LLM_BASE_URL ve LLM_MODEL tanımlı olmalı", "config", false);
    const u = new URL(opts.baseUrl);
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(u.hostname);
    if (u.protocol !== "https:" && !loopback) throw new LlmError("LLM uç noktası HTTPS olmalı", "config", false);
    this.model = opts.model;
  }

  async complete(messages: ChatMessage[], o: { timeoutMs: number; json: boolean }): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages,
          ...(o.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(o.timeoutMs),
      });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new LlmError(`LLM zaman aşımı (${o.timeoutMs} ms)`, "timeout", true);
      throw new LlmError("LLM uç noktasına bağlanılamadı", "network", true);
    }
    if (!res.ok) {
      // Yanıt gövdesi loglara/istemciye taşınmaz (iç bilgi sızabilir); yalnız durum kodu.
      throw new LlmError(`LLM HTTP ${res.status}`, "http", res.status === 429 || res.status >= 500);
    }
    const raw = await res.text();
    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = JSON.parse(raw);
    } catch {
      throw new LlmError("LLM yanıtı JSON değil", "parse", true);
    }
    const out = data.choices?.[0]?.message?.content;
    if (typeof out !== "string" || !out.trim()) throw new LlmError("LLM boş yanıt döndürdü", "parse", true);
    return out;
  }
}
