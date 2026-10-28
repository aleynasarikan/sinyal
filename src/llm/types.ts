export interface ChatMessage { role: "system" | "user"; content: string }

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** true ise çıktı SAHTEDİR ve arayüzde öyle gösterilmelidir. */
  readonly mock: boolean;
  complete(messages: ChatMessage[], opts: { timeoutMs: number; json: boolean }): Promise<string>;
}

export class LlmError extends Error {
  /** Hata fırlatılana kadar yapılan deneme sayısı (callWithRetry doldurur). */
  attempts = 1;
  constructor(message: string, readonly kind: "timeout" | "http" | "network" | "parse" | "schema" | "config", readonly retryable: boolean) {
    super(message);
  }
}
