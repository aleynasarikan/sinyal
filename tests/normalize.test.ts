import { describe, expect, test } from "bun:test";
import { cleanForStorage, extractNumbers, matchKey, tokens } from "../src/text/normalize.ts";
import { detectLanguage } from "../src/text/lang.ts";
import { latinKey } from "../src/text/translit.ts";

describe("Unicode ve dil normalizasyonu", () => {
  test("Türkçe büyük/küçük harf: I→ı, İ→i", () => {
    expect(matchKey("ISPARTA İZMİR", "tr")).toBe("ısparta izmir");
    expect(matchKey("ISTANBUL", "en")).toBe("istanbul");
  });

  test("Arapça: harekeler ve tatvil kaldırılır, elif varyantları katlanır", () => {
    expect(matchKey("أَرْمَان")).toBe(matchKey("ارمان"));
    expect(matchKey("إسـلام")).toBe(matchKey("اسلام"));
  });

  test("Farsça ی/ک ile Arapça ي/ك aynı anahtara düşer (kodlama farkı)", () => {
    expect(matchKey("کستریا")).toBe(matchKey("كستريا"));
  });

  test("Farklı harfler BİRLEŞTİRİLMEZ: پ/ب, چ/ج, ژ/ز, گ/ک, ة/ه", () => {
    expect(matchKey("پارس")).not.toBe(matchKey("بارس"));
    expect(matchKey("چمن")).not.toBe(matchKey("جمن"));
    expect(matchKey("ژاله")).not.toBe(matchKey("زاله"));
    expect(matchKey("گل")).not.toBe(matchKey("کل"));
    expect(matchKey("فاطمة")).not.toBe(matchKey("فاطمه"));
  });

  test("ZWNJ eşleştirme anahtarında kaldırılır, saklama biçiminde korunur", () => {
    expect(matchKey("آتش‌سوزی")).toBe(matchKey("آتشسوزی"));
    expect(cleanForStorage("آتش‌سوزی")).toContain("‌");
  });

  test("Saklama temizliği yön kontrol karakterlerini atar, harfleri değiştirmez", () => {
    expect(cleanForStorage("‮أرمان‬")).toBe("أرمان");
  });

  test("Doğu Arap ve Farsça rakamları + ondalık ayırıcı", () => {
    expect(extractNumbers("۱۹ نفر و ۶٫۱ ریشتر")).toEqual(expect.arrayContaining(["19", "6.1"]));
    expect(extractNumbers("١٤٠ مصابا")).toEqual(["140"]);
    expect(extractNumbers("6,1 büyüklüğünde, 2026 yılında, 3 kişi")).toEqual(["6.1"]);
  });

  test("Durdurma sözcükleri dil bazında atılır", () => {
    expect(tokens("The earthquake and the agency", "en")).toEqual(["earthquake", "agency"]);
  });

  test("Latin harf anahtarı yalnız yardımcıdır; özgün ad değişmez", () => {
    expect(latinKey("Арман Велио")).toBe("arman velio");
    const original = "آرمان ولیو";
    latinKey(original);
    expect(original).toBe("آرمان ولیو");
  });
});

describe("Dil tespiti", () => {
  const cases: Array<[string, string]> = [
    ["tr", "Kestriya'nın kuzeyindeki kentte deprem meydana geldi ve arama çalışmaları sürüyor."],
    ["en", "A magnitude 6.1 earthquake struck the city on Tuesday and rescue teams are searching."],
    ["de", "Nach dem Erdbeben ist die Zahl der Todesopfer gestiegen und die Rettung wird fortgesetzt."],
    ["fr", "Un séisme a frappé la ville et les secours sont sur place selon les autorités."],
    ["ru", "Землетрясение произошло утром в городе на севере страны."],
    ["ar", "ضرب زلزال قوي المدينة صباح اليوم وقالت الوكالة إن عمليات الإنقاذ مستمرة."],
    ["fa", "زلزله‌ای در شهر رخ داد و مقامات از منطقه زلزله‌زده بازدید کردند."],
  ];
  for (const [lang, text] of cases) {
    test(`${lang} doğru tespit edilir ve güven puanı döner`, () => {
      const r = detectLanguage(text);
      expect(r.lang).toBe(lang);
      expect(r.confidence).toBeGreaterThan(0.5);
    });
  }
  test("Çok kısa metinde 'und' ve sıfır güven", () => {
    expect(detectLanguage("OK")).toEqual({ lang: "und", confidence: 0, method: "insufficient" });
  });
});
