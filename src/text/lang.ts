// İçerik tabanlı dil tespiti (deterministik, bağımlılıksız) — MVP'nin 7 dili için.
// Sonuç KESİN DEĞİLDİR: güven puanı döner; çağıran taraf düşük güveni "doğrulanmadı" olarak göstermelidir.

export interface LangGuess {
  lang: string; // ISO-639-1 ya da "und"
  confidence: number; // 0..1 (sezgisel; kalibre edilmemiştir)
  method: "script" | "script+lexicon" | "lexicon" | "insufficient";
}

const LEX: Record<string, RegExp> = {
  tr: /(?<![\p{L}])(ve|bir|için|ile|bu|olarak|sonra|göre|değil|daha|kadar|açıkladı|yaptı|oldu|bakanı?|cumhurbaşkanı)(?![\p{L}])/giu,
  en: /\b(the|and|of|to|in|for|with|that|this|from|said|will|have|was|were|after)\b/gi,
  de: /(?<![\p{L}])(und|der|die|das|den|dem|für|mit|nicht|auch|wird|sich|nach|eine?|über|wurde)(?![\p{L}])/giu,
  fr: /(?<![\p{L}])(le|la|les|des|une?|et|pour|dans|avec|qui|que|pas|sur|est|selon|été|du|au)(?![\p{L}])/giu,
};
const LATIN_MARKS: Record<string, RegExp> = {
  tr: /[ığşİĞŞ]/g,
  de: /[äöüßÄÖÜ]/g,
  fr: /[éèêàâçîôûœëÉÈ]/g,
};
// Farsçaya özgü harfler (Arapçada yok) ve sık sözcükler.
const FA_LETTERS = /[پچژگیک]/g; // پ چ ژ گ ی ک
const FA_WORDS = /(?<![\p{L}])(است|این|که|را|می|های|برای|شد|کرد|گفت|آن)(?![\p{L}])/gu;
const AR_LETTERS = /[ةيكى]/g; // Arapça ي/ك/ة/ى (Farsça yazımda ی/ک kullanılır)
const AR_WORDS = /(?<![\p{L}])(في|من|على|إلى|عن|أن|التي|الذي|قال|وقال)(?![\p{L}])/gu;

const count = (s: string, re: RegExp) => (s.match(re) || []).length;

export function detectLanguage(input: string): LangGuess {
  const text = String(input ?? "").slice(0, 4000);
  let latin = 0, cyr = 0, arab = 0, letters = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (/\p{L}/u.test(ch)) letters++; else continue;
    if (cp >= 0x0400 && cp <= 0x04ff) cyr++;
    else if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0xfb50 && cp <= 0xfdff)) arab++;
    else if (cp < 0x0250 || (cp >= 0x1e00 && cp <= 0x1eff)) latin++;
  }
  if (letters < 8) return { lang: "und", confidence: 0, method: "insufficient" };

  if (cyr / letters > 0.5) {
    // Ukraynaca vb. kapsam dışı dillerde düşük güven.
    const ukr = /[іїєґ]/i.test(text);
    return { lang: ukr ? "uk" : "ru", confidence: ukr ? 0.6 : 0.95, method: "script" };
  }
  if (arab / letters > 0.5) {
    const fa = count(text, FA_LETTERS) * 2 + count(text, FA_WORDS) * 3;
    const ar = count(text, AR_LETTERS) * 2 + count(text, AR_WORDS) * 3;
    if (fa === 0 && ar === 0) return { lang: "ar", confidence: 0.55, method: "script" };
    const lang = fa > ar ? "fa" : "ar";
    const margin = Math.abs(fa - ar) / Math.max(1, fa + ar);
    return { lang, confidence: Math.min(0.97, 0.6 + 0.4 * margin), method: "script+lexicon" };
  }
  if (latin / letters > 0.5) {
    const words = Math.max(1, (text.match(/\p{L}+/gu) || []).length);
    const scores: Array<[string, number]> = ["tr", "en", "de", "fr"].map((l) => {
      const lex = count(text, LEX[l]!) / words;
      const marks = LATIN_MARKS[l] ? count(text, LATIN_MARKS[l]!) / words : 0;
      return [l, lex + marks * 0.8];
    });
    scores.sort((a, b) => b[1] - a[1]);
    const [best, second] = [scores[0]!, scores[1]!];
    if (best[1] === 0) return { lang: "und", confidence: 0.1, method: "lexicon" };
    const margin = (best[1] - second[1]) / best[1];
    const conf = Math.min(0.95, 0.4 + 0.55 * margin * Math.min(1, best[1] * 4));
    return { lang: best[0], confidence: Number(conf.toFixed(2)), method: "lexicon" };
  }
  return { lang: "und", confidence: 0.1, method: "insufficient" };
}
