// Gazetteer tabanlı baseline varlık/kavram çıkarımı (diller arası kanonik kimlik üretir).
// Sınırlar: yalnız sözlükte bulunan varlıkları tanır; morfoloji kaba önek kuralıyla ele alınır.
// Sözlük dışı adlar için LLM çıkarımı + analist doğrulaması gerekir (docs/MIMARI.md).

import type { GazetteerEntry } from "../../data/mock/gazetteer.ts";
import type { EntityType, ExtractedEntity } from "../domain/types.ts";
import { matchKey } from "../text/normalize.ts";
import { latinKey } from "../text/translit.ts";

export const EXTRACTOR_VERSION = "gazetteer-v1";

const ARABIC_SCRIPT = /[؀-ۿ]/;
const ARABIC_PROCLITICS = ["و", "ف", "ب", "ل", "ك"];

interface Word { key: string; surface: string }

/** Metni sözcüklere böler; her sözcüğün özgün biçimi ve eşleştirme anahtarı birlikte tutulur. */
function words(text: string, lang: string): Word[] {
  const out: Word[] = [];
  for (const surface of String(text ?? "").split(/[^\p{L}\p{N}\p{M}‌‍]+/u)) {
    if (!surface) continue;
    const key = matchKey(surface, lang);
    if (key) for (const part of key.split(" ")) out.push({ key: part, surface });
  }
  return out;
}

/** Arap yazısında ön ek (و/ب/ل...) ve harf-i tarif (ال) soyulmuş varyantlar. */
function variants(tok: string): string[] {
  if (!ARABIC_SCRIPT.test(tok)) return [tok];
  const v = new Set([tok]);
  const strip = (t: string) => { if (t.startsWith("ال") && t.length > 4) v.add(t.slice(2)); };
  strip(tok);
  if (ARABIC_PROCLITICS.includes(tok[0]!) && tok.length > 3) { v.add(tok.slice(1)); strip(tok.slice(1)); }
  return [...v];
}

function tokMatch(aliasTok: string, textTok: string): boolean {
  for (const t of variants(textTok)) {
    if (t === aliasTok) return true;
    // Kaba morfoloji: uzun takma ad önek olarak eşleşebilir (Norvik'te, Norvike, depreminde, Erdbebengebiet).
    if (aliasTok.length >= 5 && t.startsWith(aliasTok) && t.length - aliasTok.length <= 8) return true;
  }
  return false;
}

interface CompiledAlias { entry: GazetteerEntry; toks: string[] }

export class Gazetteer {
  private readonly compiled: CompiledAlias[] = [];
  readonly byId = new Map<string, GazetteerEntry>();

  constructor(entries: GazetteerEntry[]) {
    for (const e of entries) {
      this.byId.set(e.id, e);
      for (const [lang, list] of Object.entries(e.aliases)) {
        for (const a of list ?? []) {
          const toks = matchKey(a, lang).split(" ").filter(Boolean);
          if (toks.length) this.compiled.push({ entry: e, toks });
        }
      }
    }
    // Uzun takma adlar önce: "Kestria Disaster Agency" "Kestria"dan önce denenir.
    this.compiled.sort((a, b) => b.toks.length - a.toks.length);
  }

  label(id: string): string { return this.byId.get(id)?.label_tr ?? id; }
  matchable(id: string): boolean { return this.byId.get(id)?.matchable ?? false; }
  typeOf(id: string): EntityType | undefined { return this.byId.get(id)?.type; }

  extract(articleId: string, text: string, lang: string): ExtractedEntity[] {
    const ws = words(text, lang);
    const used = new Array<boolean>(ws.length).fill(false);
    const found = new Map<string, ExtractedEntity>();
    for (const { entry, toks } of this.compiled) {
      for (let i = 0; i + toks.length <= ws.length; i++) {
        let ok = true;
        for (let j = 0; j < toks.length && ok; j++) ok = !used[i + j] && tokMatch(toks[j]!, ws[i + j]!.key);
        if (!ok) continue;
        for (let j = 0; j < toks.length; j++) used[i + j] = true;
        const surface = [...new Set(ws.slice(i, i + toks.length).map((w) => w.surface))].join(" ");
        if (!found.has(entry.id)) {
          found.set(entry.id, {
            article_id: articleId,
            entity_type: entry.type,
            surface,
            canonical_id: entry.id,
            canonical_label: entry.label_tr,
            latin_key: latinKey(surface),
            confidence: toks.length > 1 ? 0.9 : 0.75,
            origin: { kind: "rule", version: EXTRACTOR_VERSION },
          });
        }
      }
    }
    return [...found.values()];
  }
}
