// Çok dilli metin normalizasyonu.
//
// İLKE: Özgün metin ASLA değiştirilmez/saklanan biçimi bozulmaz. Bu dosyadaki fonksiyonlar yalnız
// EŞLEŞTİRME ve ARAMA anahtarı üretir. Arapça/Farsça katlama muhafazakârdır: yalnız aynı harfin
// yazım/kodlama varyantları birleştirilir; ayrı harfler (پ/ب, چ/ج, ژ/ز, گ/ک, ة/ه) BİRLEŞTİRİLMEZ —
// aksi halde farklı adlar aynı anahtara düşer.

const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭ]/g; // harekeler, üstün elif, Kur'an işaretleri
const TATWEEL = /ـ/g;
const ZW = /[​‌‍⁠﻿]/g; // sıfır genişlikli karakterler (ZWNJ dahil)
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

// Aynı harfin varyantları → tek biçim (yalnız eşleştirme anahtarında).
const ARABIC_FOLD: Record<string, string> = {
  "أ": "ا", // أ → ا
  "إ": "ا", // إ → ا
  "آ": "ا", // آ → ا
  "ٱ": "ا", // ٱ → ا
  "ى": "ي", // ى (elif maksure) → ي
  "ی": "ي", // Farsça ی → ي (aynı harf, farklı kod noktası)
  "ک": "ك", // Farsça ک → ك (aynı harf, farklı kod noktası)
};

const EASTERN_DIGITS: Record<string, string> = {};
for (let i = 0; i < 10; i++) {
  EASTERN_DIGITS[String.fromCharCode(0x0660 + i)] = String(i); // Arapça-Hint
  EASTERN_DIGITS[String.fromCharCode(0x06f0 + i)] = String(i); // Farsça
}

/** Saklama için güvenli Unicode biçimi: NFC + görünmez yön/kontrol karakterlerini temizler. Harfleri değiştirmez. */
export function cleanForStorage(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .replace(BIDI_CONTROLS, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

export function foldDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => EASTERN_DIGITS[d] ?? d);
}

/** Dil duyarlı küçük harfe çevirme: Türkçe'de I→ı, İ→i; diğer dillerde kök küçültme. */
export function lower(s: string, lang?: string): string {
  return lang === "tr" ? s.toLocaleLowerCase("tr-TR") : s.toLowerCase();
}

/** Eşleştirme/arama anahtarı. */
export function matchKey(s: string, lang?: string): string {
  let t = foldDigits(String(s ?? "").normalize("NFKC"));
  t = t.replace(BIDI_CONTROLS, "").replace(TATWEEL, "").replace(ARABIC_DIACRITICS, "").replace(ZW, "");
  t = t.replace(/[آأإٱىیک]/g, (c) => ARABIC_FOLD[c] ?? c);
  t = lower(t, lang);
  // Latin aksanlarını arama anahtarında katla (é→e, ü→u). Türkçe ı/i ayrımı korunur (ı ayrık harf).
  t = t.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
  return t.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

// Dil başına sık (anlamsız) kelimeler — başlık benzerliğinde gürültüyü azaltır.
const STOP: Record<string, string[]> = {
  tr: ["ve", "ile", "bir", "bu", "da", "de", "için", "olarak", "sonra", "göre", "dedi", "açıkladı", "haber", "son", "ki", "mi"],
  en: ["the", "and", "for", "with", "says", "said", "after", "over", "amid", "from", "that", "this", "are", "was", "has", "have", "its", "new", "into", "will"],
  fr: ["le", "la", "les", "des", "une", "un", "et", "pour", "dans", "avec", "qui", "que", "sur", "est", "aux", "du", "au", "par", "selon"],
  de: ["der", "die", "das", "den", "dem", "und", "mit", "für", "nach", "ein", "eine", "ist", "wird", "von", "auf", "bei", "im", "zu"],
  ru: ["и", "в", "на", "с", "по", "что", "это", "для", "из", "после", "как", "не", "о", "от", "за"],
  ar: ["في", "من", "علي", "الي", "عن", "ان", "مع", "بعد", "هذا", "التي", "الذي", "و"],
  fa: ["در", "از", "به", "با", "که", "را", "این", "است", "و", "براي", "پس", "تا", "يك"],
};
const STOP_KEYS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(STOP).map(([l, ws]) => [l, new Set(ws.map((w) => matchKey(w, l)))]),
);

export function tokens(s: string, lang?: string): string[] {
  const stop = (lang && STOP_KEYS[lang]) || new Set<string>();
  return matchKey(s, lang).split(" ").filter((w) => w.length >= 2 && !stop.has(w));
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Metindeki sayısal olguları çıkarır (ondalık ayırıcı ve doğu rakamları katlanır).
 * Yıllar (1900–2100) ve tek haneli sayılar gürültü olduğu için atlanır.
 */
export function extractNumbers(s: string): string[] {
  const t = foldDigits(String(s ?? "")).replace(/٫/g, ".").replace(/٬/g, ",");
  const out = new Set<string>();
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const raw = m[0];
    const norm = raw.replace(",", ".");
    const n = Number(norm);
    if (!Number.isFinite(n)) continue;
    if (Number.isInteger(n) && n >= 1900 && n <= 2100) continue;
    if (Number.isInteger(n) && n < 10) continue;
    out.add(String(n));
  }
  return [...out];
}
