// Latin harfe YARDIMCI çeviri. Sonuç yalnız ikincil eşleştirme anahtarıdır (latin_key);
// özgün ad her zaman ayrıca saklanır ve gösterilir. Arap yazısında sesli harfler yazılmadığından
// sonuç kayıplı bir ünsüz iskeletidir — tek başına iki adın aynı olduğuna KANIT sayılmaz.

import { matchKey } from "./normalize.ts";

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g",
};
const ARAB: Record<string, string> = {
  ا: "a", ب: "b", پ: "p", ت: "t", ث: "s", ج: "j", چ: "ch", ح: "h", خ: "kh", د: "d", ذ: "z", ر: "r", ز: "z",
  ژ: "zh", س: "s", ش: "sh", ص: "s", ض: "z", ط: "t", ظ: "z", ع: "", غ: "gh", ف: "f", ق: "q", ك: "k", گ: "g",
  ل: "l", م: "m", ن: "n", ه: "h", و: "v", ي: "y", ة: "a", ء: "",
};

export function latinKey(name: string): string {
  const k = matchKey(name); // katlanmış biçim (ی→ي, ک→ك, أ→ا)
  let out = "";
  for (const ch of k) out += CYR[ch] ?? ARAB[ch] ?? ch;
  return out.replace(/[^a-z0-9ıçğöşü ]/g, "").trim();
}

/** Ünsüz iskeleti: alfabeler arası kaba karşılaştırma için (ör. "arman velio" → "rmn vl"). */
export function consonantSkeleton(name: string): string {
  return latinKey(name).replace(/[aeiouyıöü]/g, "").replace(/(.)\1+/g, "$1");
}
