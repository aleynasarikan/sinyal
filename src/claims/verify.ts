// İddia–kaynak destek denetimi (deterministik).
//
// Ne denetlenir:
//  1) İddianın en az bir kaynağı var mı, kaynak kimliği bu olayın üyesi mi?
//  2) Alıntı (quote) kaynak haberin özgün metninde BİREBİR geçiyor mu? (Unicode/harf katlamalı karşılaştırma)
//  3) İddiadaki sayılar alıntılarda geçiyor mu? Alıntıda farklı sayı varsa → çelişki.
//  4) İddiadaki sözlük varlıkları (kişi/kurum/yer) kaynak haberlerde çıkarılmış mı?
//  5) Sözlük dışı ad benzeri ifadeler (ardışık büyük harfli sözcükler) kaynak metinde geçiyor mu?
//
// SINIR: Bu SÖZCÜKSEL bir dayanak denetimidir; alıntının iddiayı anlamsal olarak gerektirdiğini KANITLAMAZ.
// "supported" = "kaynakta dayanağı bulundu"; doğruluk onayı değildir. Nihai karar analistindir.

import type { Article, ClaimSource, ClaimStatus, ExtractedEntity, SupportStatus } from "../domain/types.ts";
import type { Gazetteer } from "../pipeline/entities.ts";
import { extractNumbers, matchKey } from "../text/normalize.ts";

export const VERIFIER_VERSION = "lexical-v1";
const MIN_QUOTE_CHARS = 12;

export interface ClaimInput { text_tr: string; sources: Array<{ article_id: string; quote: string }> }
export interface VerifyContext {
  articles: Map<string, Article>;
  eventArticleIds: Set<string>;
  entitiesByArticle: Map<string, ExtractedEntity[]>;
  gz: Gazetteer;
}
export interface VerifyResult { status: ClaimStatus; notes: string[]; sources: Omit<ClaimSource, "claim_id">[] }

/** Sözlük dışı, kişi/kurum adına benzeyen ifadeler: en az iki ardışık büyük harfle başlayan sözcük. */
function namelikePhrases(text: string): string[] {
  const out: string[] = [];
  const re = /(?:\p{Lu}[\p{Ll}'’.-]+)(?:\s+\p{Lu}[\p{Ll}'’.-]+)+/gu;
  for (const m of text.replace(/\[MOCK\]/g, "").matchAll(re)) out.push(m[0]);
  return out;
}

export function verifyClaim(c: ClaimInput, ctx: VerifyContext): VerifyResult {
  const notes: string[] = [];
  if (!c.sources.length) return { status: "no_source", notes: ["İddia için kaynak kimliği verilmedi."], sources: [] };

  const claimNums = extractNumbers(c.text_tr);
  const sources: VerifyResult["sources"] = [];
  const foundArticles: Article[] = [];
  const quoteNums = new Set<string>();

  for (const s of c.sources) {
    const sNotes: string[] = [];
    const a = ctx.articles.get(s.article_id);
    let support: SupportStatus;
    if (!a || !ctx.eventArticleIds.has(s.article_id)) {
      support = "not_found";
      sNotes.push("Kaynak kimliği bu olayın haberleri arasında yok.");
    } else if (matchKey(s.quote).length < MIN_QUOTE_CHARS) {
      support = "unverifiable";
      sNotes.push("Alıntı yok veya denetlenemeyecek kadar kısa.");
      foundArticles.push(a);
    } else if (!matchKey(a.title_original + " " + a.body_original).includes(matchKey(s.quote))) {
      support = "not_found";
      sNotes.push("Alıntı kaynak metinde birebir bulunamadı.");
    } else {
      foundArticles.push(a);
      const qn = extractNumbers(s.quote);
      for (const n of qn) quoteNums.add(n);
      const missing = claimNums.filter((n) => !qn.includes(n));
      if (claimNums.length && missing.length && qn.length && !claimNums.some((n) => qn.includes(n))) {
        support = "contradicted";
        sNotes.push(`İddiadaki sayı(lar) ${missing.join(", ")} alıntıda yok; alıntıda ${qn.join(", ")} geçiyor.`);
      } else {
        support = "supported";
      }
    }
    sources.push({ article_id: s.article_id, quote: s.quote, support, notes: sNotes });
  }

  // İddiada geçip hiçbir kaynakta olmayan sayılar (model uydurması riski).
  const unsupportedNums = claimNums.filter((n) => !quoteNums.has(n));
  if (unsupportedNums.length && sources.some((s) => s.support === "supported")) notes.push(`Kaynak alıntılarında olmayan sayı: ${unsupportedNums.join(", ")}`);

  // İddiadaki sözlük varlıkları kaynaklarda var mı?
  const claimEnts = ctx.gz.extract("claim", c.text_tr, "tr").filter((e) => e.entity_type !== "keyword");
  const srcEntIds = new Set(foundArticles.flatMap((a) => (ctx.entitiesByArticle.get(a.article_id) ?? []).map((e) => e.canonical_id)));
  const unsupportedEnts = claimEnts.filter((e) => !srcEntIds.has(e.canonical_id));
  if (unsupportedEnts.length) notes.push(`Kaynak haberlerde geçmeyen varlık: ${unsupportedEnts.map((e) => e.canonical_label).join(", ")}`);

  // Sözlük dışı ad/unvan benzeri ifadeler SÖZCÜK düzeyinde denetlenir: bilinen bir varlığın (ör. yer adı)
  // aynı ifadede geçmesi, yanındaki kişi adını veya unvanı doğrulamaz. Bilinen varlık sözcükleri çıkarıldıktan
  // sonra kalan her ardışık parça kaynak metinlerde (katlanmış biçimde) ayrıca aranır.
  const knownTokens = new Set(claimEnts.flatMap((e) => matchKey(e.surface, "tr").split(" ")));
  const srcText = " " + matchKey(foundArticles.map((a) => a.title_original + " " + a.body_original).join(" ")) + " ";
  const unknownNames: string[] = [];
  for (const phrase of namelikePhrases(c.text_tr)) {
    let seg: string[] = [];
    const flush = () => {
      if (seg.length && !srcText.includes(" " + matchKey(seg.join(" "), "tr") + " ")) unknownNames.push(seg.join(" "));
      seg = [];
    };
    for (const w of phrase.split(/\s+/)) {
      if (knownTokens.has(matchKey(w, "tr"))) flush(); else seg.push(w);
    }
    flush();
  }
  if (unknownNames.length) notes.push(`Kaynakta doğrulanamayan ad/unvan: ${unknownNames.join(", ")}`);

  const supported = sources.filter((s) => s.support === "supported").length;
  let status: ClaimStatus;
  if (sources.some((s) => s.support === "contradicted")) status = "contradicted";
  else if (notes.length) status = "unverified";
  else if (supported === sources.length) status = "supported";
  else if (supported > 0) status = "partially_supported";
  else status = "unverified";
  return { status, notes, sources };
}
