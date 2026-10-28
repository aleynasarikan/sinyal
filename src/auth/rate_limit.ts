// Sabit pencereli hız sınırlayıcı (süreç içi). Çok örnekli dağıtımda nginx limit_req ile birlikte kullanılmalı.

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly max: number, private readonly windowMs = 60_000, private readonly now = () => Date.now()) {}

  /** true → sınır aşıldı (istek reddedilmeli). */
  limited(key: string): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || t >= h.resetAt) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      if (this.hits.size > 50_000) this.sweep(t);
      return false;
    }
    h.count++;
    return h.count > this.max;
  }

  retryAfterSec(key: string): number {
    const h = this.hits.get(key);
    return h ? Math.max(1, Math.ceil((h.resetAt - this.now()) / 1000)) : 1;
  }

  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (t >= v.resetAt) this.hits.delete(k);
  }
}
