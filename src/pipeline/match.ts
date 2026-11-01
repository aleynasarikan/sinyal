// Baseline çok dilli olay eşleştirme + yeni gelişme sınıflandırması.
//
// Embedding KULLANMAZ. Diller arası köprü, gazetteer'ın verdiği kanonik varlık/kavram kimlikleridir;
// buna sayılar, zaman yakınlığı ve (aynı dilde) başlık benzerliği eklenir. Her karar gerekçesiyle kaydedilir.
// Skorlar SEZGİSELDİR (kalibre edilmemiştir); eşikler altın setle ayarlanmalıdır (docs/DEGERLENDIRME.md).

import type { Article, DateQuality, ExtractedEntity, MatchReason, MatchStatus, NoveltyDecision } from "../domain/types.ts";
import { extractFactNumbers, jaccard, matchKey, tokens } from "../text/normalize.ts";
import type { Gazetteer } from "./entities.ts";

export const MATCHER_VERSION = "baseline-v1";

export const THRESHOLDS = {
  confident: 0.6,
  uncertain: 0.45,
  maxHoursApart: 96,
  nearDupTitle: 0.8,
  nearDupBody: 0.8,
} as const;

const WEIGHTS = { concept: 0.3, place: 0.25, entity: 0.25, number: 0.1, title: 0.1 } as const;

// Belirsizlik/iddia belirteçleri (eşleştirme anahtarı biçiminde aranır).
const HEDGES: Record<string, string[]> = {
  tr: ["iddia", "öne sürül", "ileri sürül", "doğrulanmamış", "haberlere göre", "dayandırılan", "teyit edilmedi"],
  en: ["reportedly", "allegedly", "unconfirmed", "unverified", "claims that", "rumou"],
  ru: ["якобы", "неподтвержд", "по слухам", "предположительно"],
  ar: ["يزعم", "مزاعم", "غير مؤكد", "انباء عن", "انباء غير"],
  fa: ["تایید نشده", "تأیید نشده", "ادعا", "گفته میشود", "شایعه"],
  fr: ["non confirm", "prétendu", "présumé", "selon des rumeurs", "aurait été"],
  de: ["angeblich", "unbestätigt", "mutmaßlich", "gerüchte"],
};
const HEDGE_KEYS: Record<string, string[]> = Object.fromEntries(
  Object.entries(HEDGES).map(([l, hs]) => [l, hs.map((h) => matchKey(h, l))]),
);

/** isHedged ile aynı denetim; eşleştirme anahtarı yerine sözlükteki ÖZGÜN ifadeyi döndürür (gösterim için). */
export function hedgePhrases(text: string, lang: string): string[] {
  const k = " " + matchKey(text, lang) + " ";
  return (HEDGES[lang] ?? []).filter((_, i) => k.includes(HEDGE_KEYS[lang]![i]!));
}

export function isHedged(text: string, lang: string): string[] {
  const k = " " + matchKey(text, lang) + " ";
  return (HEDGE_KEYS[lang] ?? []).filter((h) => k.includes(h));
}

export interface ArticleFeatures {
  article_id: string;
  lang: string;
  timeMs: number | null; // güvenilir yayın zamanı; yoksa null
  firstSeenMs: number;
  dateQuality: DateQuality;
  sourceKnown: boolean;
  entities: Set<string>; // kişi + kurum
  places: Set<string>;
  concepts: Set<string>; // eşleştirilebilir kavramlar
  numbers: Set<string>;
  titleTokens: Set<string>;
  bodyTokens: Set<string>;
  hedges: string[];
}

export function featuresOf(a: Article, ents: ExtractedEntity[], gz: Gazetteer, sourceKnown: boolean): ArticleFeatures {
  const lang = a.lang_detected !== "und" ? a.lang_detected : a.lang_declared;
  const pick = (types: string[]) =>
    new Set(ents.filter((e) => e.canonical_id && types.includes(e.entity_type) && gz.matchable(e.canonical_id)).map((e) => e.canonical_id));
  const reliable = a.date_quality === "exact" && a.published_at;
  return {
    article_id: a.article_id,
    lang,
    timeMs: reliable ? Date.parse(a.published_at!) : null,
    firstSeenMs: Date.parse(a.first_seen_at),
    dateQuality: a.date_quality,
    sourceKnown,
    entities: pick(["person", "org"]),
    places: pick(["place"]),
    concepts: pick(["keyword"]),
    numbers: new Set([...extractFactNumbers(a.title_original), ...extractFactNumbers(a.body_original)]),
    titleTokens: new Set(tokens(a.title_original, lang)),
    bodyTokens: new Set(tokens(a.body_original, lang)),
    hedges: isHedged(a.title_original + " " + a.body_original, lang),
  };
}

export class EventState {
  readonly members: ArticleFeatures[] = [];
  readonly entities = new Set<string>();
  readonly places = new Set<string>();
  readonly concepts = new Set<string>();
  readonly numbers = new Set<string>();
  firstMs = Infinity;
  lastMs = -Infinity;
  constructor(readonly event_id: string) {}

  add(f: ArticleFeatures): void {
    this.members.push(f);
    for (const x of f.entities) this.entities.add(x);
    for (const x of f.places) this.places.add(x);
    for (const x of f.concepts) this.concepts.add(x);
    for (const x of f.numbers) this.numbers.add(x);
    const t = f.timeMs ?? f.firstSeenMs;
    this.firstMs = Math.min(this.firstMs, t);
    this.lastMs = Math.max(this.lastMs, t);
  }
}

/** Kesişimin küçük kümeye oranı (0..1). İki taraf da boşsa null (bilgi yok). */
function overlap(a: Set<string>, b: Set<string>): { ratio: number | null; shared: string[] } {
  if (!a.size || !b.size) return { ratio: null, shared: [] };
  const shared = [...a].filter((x) => b.has(x));
  return { ratio: shared.length / Math.min(a.size, b.size), shared };
}

export interface MatchResult { score: number; reason: MatchReason; rejected: string | null; cautious?: boolean }

export function scoreAgainst(f: ArticleFeatures, ev: EventState, gz: Gazetteer): MatchResult {
  const notes: string[] = [];
  const con = overlap(f.concepts, ev.concepts);
  const plc = overlap(f.places, ev.places);
  const ent = overlap(f.entities, ev.entities);
  const num = overlap(f.numbers, ev.numbers);
  let title: number | null = null;
  for (const m of ev.members) if (m.lang === f.lang) title = Math.max(title ?? 0, jaccard(f.titleTokens, m.titleTokens));

  const t = f.timeMs;
  let hours: number | null = null;
  if (t !== null && Number.isFinite(ev.firstMs)) {
    const d = t < ev.firstMs ? ev.firstMs - t : t > ev.lastMs ? t - ev.lastMs : 0;
    hours = Math.round(d / 36e5);
  } else if (t === null) {
    notes.push("Yayın tarihi güvenilir değil; zaman yakınlığı denetlenemedi.");
  }

  const reason: MatchReason = {
    shared_entities: ent.shared.map((x) => gz.label(x)),
    shared_places: plc.shared.map((x) => gz.label(x)),
    shared_numbers: num.shared,
    title_similarity: Number((title ?? 0).toFixed(2)),
    hours_apart: hours,
    score: 0,
    notes,
  };

  // ---- Sert kurallar: farklı olayları birleştirmemek için ----
  if (f.concepts.size && ev.concepts.size && con.ratio === 0) {
    return { score: 0, reason: { ...reason, notes: [...notes, "Olay türü farklı (ortak kavram yok)."] }, rejected: "concept_conflict" };
  }
  if (hours !== null && hours > THRESHOLDS.maxHoursApart) {
    return { score: 0, reason: { ...reason, notes: [...notes, `Zaman farkı ${hours} saat > ${THRESHOLDS.maxHoursApart}.`] }, rejected: "time_window" };
  }

  const parts: Array<[number, number | null]> = [
    [WEIGHTS.concept, con.ratio], [WEIGHTS.place, plc.ratio], [WEIGHTS.entity, ent.ratio],
    [WEIGHTS.number, num.ratio === null ? null : Math.min(1, num.shared.length / 2)], [WEIGHTS.title, title],
  ];
  let wsum = 0, s = 0;
  for (const [w, v] of parts) {
    if (v === null) continue; // bilgi yoksa ağırlık dağıtılır (eksik bilgi ceza sayılmaz)
    wsum += w; s += w * v;
  }
  const score = wsum ? s / wsum : 0;
  reason.score = Number(score.toFixed(3));
  // Ortak sayı yalnız skoru destekler; bağımsız kanıt sayılmaz (rastlantısal çakışma: 12 itfaiyeci / 12 ölü).
  const substantive = [con.ratio, plc.ratio, ent.ratio].filter((v) => v !== null && v > 0).length + ((title ?? 0) >= 0.3 ? 1 : 0);
  if (substantive < 2) {
    return { score: 0, reason: { ...reason, notes: [...notes, "Birleştirme için sayı dışında en az iki bağımsız sinyal (konu, yer, kişi/kurum, başlık) gerekir."] }, rejected: "weak_evidence" };
  }
  // Bir tarafta konu bilgisi yoksa olay türü denetlenemez: ortak kişi/kurum şartı aranır ve eşleşme belirsiz sayılır.
  const cautious = !(f.concepts.size && ev.concepts.size);
  if (cautious) {
    if (!ent.ratio) {
      return { score: 0, reason: { ...reason, notes: [...notes, "Olay türü (konu) bilinmiyor ve ortak kişi/kurum yok; birleştirilmedi."] }, rejected: "no_concept_no_entity" };
    }
    reason.notes.push("Bir tarafta konu bilgisi yok; olay türü denetlenemediği için eşleşme belirsiz işaretlendi.");
  }
  return { score, reason, rejected: null, cautious };
}

export function matchStatusFor(score: number, f: ArticleFeatures, cautious = false): MatchStatus | null {
  if (score >= THRESHOLDS.confident) return f.timeMs === null || cautious ? "uncertain" : "confident";
  if (score >= THRESHOLDS.uncertain) return "uncertain";
  return null;
}

export function findBestEvent(f: ArticleFeatures, events: Iterable<EventState>, gz: Gazetteer) {
  let best: { ev: EventState; res: MatchResult } | null = null;
  for (const ev of events) {
    const res = scoreAgainst(f, ev, gz);
    if (res.rejected) continue;
    if (!best || res.score > best.res.score) best = { ev, res };
  }
  if (!best) return null;
  const status = matchStatusFor(best.res.score, f, best.res.cautious);
  return status ? { ...best, status } : null;
}

function dateOrSourceProblems(f: ArticleFeatures): string[] {
  const r: string[] = [];
  if (f.dateQuality === "missing") r.push("Yayın tarihi yok.");
  if (f.dateQuality === "estimated") r.push("Yayın tarihi tahmini.");
  if (f.dateQuality === "invalid") r.push("Yayın tarihi çözümlenemedi.");
  if (f.dateQuality === "future") r.push("Yayın tarihi gelecekte görünüyor.");
  if (!f.sourceKnown) r.push("Kaynak kayıtlı yayıncılar arasında değil.");
  return r;
}

export function classifyNovelty(f: ArticleFeatures, ev: EventState | null, gz: Gazetteer): NoveltyDecision {
  const problems = dateOrSourceProblems(f);
  if (!ev) {
    if (problems.length) return { label: "uncertain_date_or_source", reasons: [...problems, "Yeni olay tespiti tarih/kaynak belirsizliği nedeniyle kesinleştirilmedi."], new_facts: [] };
    if (f.hedges.length) return { label: "unverified_claim", reasons: [`İddia/teyitsizlik ifadesi: ${f.hedges.join(", ")}`], new_facts: [] };
    return { label: "new_event", reasons: ["Son pencerede eşleşen olay bulunamadı."], new_facts: [] };
  }

  for (const m of ev.members) {
    if (m.lang === f.lang && jaccard(m.titleTokens, f.titleTokens) >= THRESHOLDS.nearDupTitle && jaccard(m.bodyTokens, f.bodyTokens) >= THRESHOLDS.nearDupBody) {
      return { label: "duplicate", reasons: ["Aynı dilde neredeyse aynı başlık ve metin (yeniden yayın)."], new_facts: [] };
    }
  }

  const newFacts = [
    ...[...f.numbers].filter((x) => !ev.numbers.has(x)).map((x) => `sayı: ${x}`),
    ...[...f.entities].filter((x) => !ev.entities.has(x)).map((x) => `varlık: ${gz.label(x)}`),
    ...[...f.places].filter((x) => !ev.places.has(x)).map((x) => `yer: ${gz.label(x)}`),
  ];

  if (problems.length) return { label: "uncertain_date_or_source", reasons: [...problems, "Yeni bilgi içerse bile kesin gelişme sayılmadı."], new_facts: newFacts };
  if (!newFacts.length) return { label: "duplicate", reasons: ["Olayda zaten bulunan bilgileri tekrarlıyor (yeni varlık/sayı yok)."], new_facts: [] };
  if (f.hedges.length) return { label: "unverified_claim", reasons: [`Yeni bilgi iddia/teyitsizlik ifadesiyle verilmiş: ${f.hedges.join(", ")}`], new_facts: newFacts };
  if (f.timeMs !== null && f.timeMs < ev.firstMs) {
    return { label: "duplicate", reasons: ["Olaydaki ilk haberden daha eski tarihli; geç gelen eski haber."], new_facts: newFacts };
  }
  return { label: "significant_update", reasons: ["Olaya yeni bilgi ekliyor."], new_facts: newFacts };
}
