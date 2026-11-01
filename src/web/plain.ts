// SADE DİL katmanı: yayılım verisini teknik olmayan okur için kısa, anlaşılır ifadelere çevirir.
// Saf fonksiyonlardır (DOM yok) — hem arayüz hem rapor kullanır, testle doğrulanır.
// Türkçe ek uyumu (Almanya'da / İran'da) hataya açık olduğundan cümle yerine "etiket: değer" biçimi tercih edilir.

import names from "../../data/geo/country_names_tr.json" with { type: "json" };

const NAMES = names as unknown as Record<string, string>;

export const countryName = (cc: string): string => NAMES[cc] ?? cc;

/** "Demo Zeitung (DE)" → "Demo Zeitung" (ülke etiketi ayrıca gösterildiği için tekrar edilmez). */
export const sourceName = (n: string): string => n.replace(/\s*\([^)]*\)\s*$/, "");

export type Tone = "bad" | "warn" | "info" | "muted" | "ok";

/** Yayılma durumunu tek kelimelik, renkli bir etikete çevirir. */
export function status(momentum: string): { label: string; tone: Tone; hint: string } {
  switch (momentum) {
    case "accelerating": return { label: "Hızla yayılıyor", tone: "bad", hint: "Son 6 saatte, önceki 6 saate göre belirgin biçimde daha çok yayın yaptı." };
    case "steady": return { label: "Yayılmaya devam ediyor", tone: "warn", hint: "Son saatlerde yeni yayınlar gelmeye devam ediyor." };
    case "slowing": return { label: "Yavaşlıyor", tone: "info", hint: "Yeni yayın sayısı azalıyor." };
    default: return { label: "Durdu", tone: "muted", hint: "Son 12 saatte yeni yayın yok." };
  }
}

export interface PlainChange { kind: string; severity: string; from?: string; to?: string; hedges?: string[] }

/** Yolda gerçekleşen değişikliği sade dille anlatır. Düşük önemli notlar (ör. sayının aktarılmaması) atlanır. */
export function changeText(c: PlainChange): string | null {
  switch (c.kind) {
    case "hedge_dropped": return "“İddia” olarak verilen bilgi, kesin bilgi gibi aktarıldı.";
    case "number_changed": return `Rakam değişti: ${c.from} → ${c.to}`;
    case "number_added": return c.severity === "low" ? null : `Önceki haberde olmayan bir rakam eklendi: ${c.to}`;
    default: return null; // hedge_added, number_dropped: okuru yormayan küçük farklar
  }
}

/** Yalnız ortak bilgilere dayanan (atıf/kopya kanıtı olmayan) bağlantı için okura gösterilecek not. */
export const weakLinkNote = (kind: string): string | null =>
  kind === "shared_facts" ? "Olası bağlantı (yalnız benzer bilgilere dayanıyor)" : null;

/** Saati kısa biçimde verir: "31 Eki 14:01". */
export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Süreyi sade verir: "45 dakika", "8 saat", "2 gün". */
export function duration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} dakika`;
  if (hours < 48) return `${Math.round(hours)} saat`;
  return `${Math.round(hours / 24)} gün`;
}

/** Olayın sayılabilir değişiklikleri (yalnız okura gösterilecek olanlar). */
export function visibleChanges(e: { links: Array<{ changes: PlainChange[] }> }): number {
  return e.links.reduce((s, l) => s + l.changes.filter((c) => changeText(c) !== null).length, 0);
}

/** Olay kartındaki tek satırlık özet: "İlk: Almanya · 7 ülkeye ulaştı · 8 saat". */
export function eventLine(e: { first: { cc: string } | null; countries: string[]; hours_span: number | null }): string {
  const parts: string[] = [];
  if (e.first) parts.push(`İlk çıktığı yer: ${countryName(e.first.cc)}`);
  parts.push(e.countries.length > 1 ? `${e.countries.length} ülkeye ulaştı` : "Tek ülkede kaldı");
  if (e.hours_span) parts.push(duration(e.hours_span));
  return parts.join(" · ");
}

// ---------- Genel sayfalar ----------
const LANGS: Record<string, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça", ru: "Rusça", fr: "Fransızca", de: "Almanca", fa: "Farsça" };
export const langName = (code: string): string => LANGS[code] ?? "Bilinmeyen dil";

/**
 * Haberin olaya katkısını okura anlatan etiket. "Tekrar haber" okuru ilgilendirmediği için etiketsizdir (null).
 */
export function newsKind(label: string): { label: string; tone: Tone } | null {
  switch (label) {
    case "new_event": return { label: "İlk haber", tone: "info" };
    case "significant_update": return { label: "Yeni bilgi", tone: "ok" };
    case "unverified_claim": return { label: "Doğrulanmamış iddia", tone: "warn" };
    case "uncertain_date_or_source": return { label: "Tarihi veya kaynağı belirsiz", tone: "muted" };
    default: return null;
  }
}

/** "sayı: 19", "varlık: Arman Velio" → "19", "Arman Velio" (teknik önekler atılır). */
export const plainFacts = (facts: string[]): string[] => facts.map((f) => f.replace(/^(sayı|varlık|yer):\s*/, ""));

/** Gelişme satırının sade açıklaması (kural gerekçesi yerine). */
export function updateText(label: string, facts: string[]): string {
  const f = plainFacts(facts);
  switch (label) {
    case "new_event": return "Olay ilk kez haber oldu.";
    case "significant_update": return f.length ? `Yeni bilgi geldi: ${f.join(", ")}` : "Yeni bilgi geldi.";
    case "unverified_claim": return f.length ? `Doğrulanmamış iddia: ${f.join(", ")}` : "Bilgi “iddia” olarak verildi.";
    case "uncertain_date_or_source": return "Yayın tarihi veya kaynağı belirsiz; dikkatle değerlendirin.";
    default: return "";
  }
}

/** Kaynaklar arası rakam farklılığının başlığı. */
export const conflictTitle = (kind: string, label: string): string =>
  kind === "conflict" ? `${label}: kaynaklar farklı rakamlar veriyor` : `${label}: rakam zaman içinde değişti`;

/** 1 234 → "1.234" (Türkçe binlik ayırıcı). */
export const num = (n: number): string => n.toLocaleString("tr-TR");
