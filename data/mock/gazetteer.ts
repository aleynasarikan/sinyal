// DEMO GAZETEER — tamamen KURGUSAL varlıklar (Kestria, Doravia, Norvik ...).
// Gerçek kişi/kurum/yer içermez; gerçek haber gibi okunmaması için bilinçli olarak uydurulmuştur.
// Gerçek kullanımda bu tablo analist onaylı bir varlık sözlüğünden veya LLM çıkarımı + analist doğrulamasından gelir.

import type { EntityType } from "../../src/domain/types.ts";

export interface GazetteerEntry {
  id: string;
  type: EntityType;
  label_tr: string;
  /** Eşleştirmede kullanılır mı? (ör. "can kaybı" kavramı olay ayırt etmez, yalnız çelişki slotudur) */
  matchable: boolean;
  aliases: Partial<Record<"tr" | "en" | "ar" | "ru" | "fr" | "de" | "fa", string[]>>;
}

export const DEMO_GAZETTEER: GazetteerEntry[] = [
  {
    id: "place:kestria", type: "place", label_tr: "Kestriya", matchable: true,
    aliases: {
      tr: ["Kestriya"], en: ["Kestria", "Kestrian"], ar: ["كيستريا"], ru: ["Кестрия", "Кестрии", "Кестрию", "Кестрией"],
      fr: ["Kestrie", "kestrien"], de: ["Kestrien", "kestrische", "kestrischen"], fa: ["کستریا"],
    },
  },
  {
    id: "place:doravia", type: "place", label_tr: "Doravya", matchable: true,
    aliases: {
      tr: ["Doravya"], en: ["Doravia", "Doravian"], ar: ["دورافيا"], ru: ["Доравия", "Доравии", "Доравию"],
      fr: ["Doravie", "doravienne"], de: ["Dorawien", "dorawische"], fa: ["دوراویا"],
    },
  },
  {
    id: "place:norvik", type: "place", label_tr: "Norvik", matchable: true,
    aliases: { tr: ["Norvik"], en: ["Norvik"], ar: ["نورفيك"], ru: ["Норвик", "Норвике", "Норвика"], fr: ["Norvik"], de: ["Norvik"], fa: ["نورویک"] },
  },
  {
    id: "place:lisvane", type: "place", label_tr: "Lisvane", matchable: true,
    aliases: { tr: ["Lisvane"], en: ["Lisvane"], ar: ["ليسفين"], ru: ["Лисвейн", "Лисвейне"], fr: ["Lisvane"], de: ["Lisvane"], fa: ["لیسوین"] },
  },
  {
    id: "person:arman_velio", type: "person", label_tr: "Arman Velio", matchable: true,
    aliases: { tr: ["Arman Velio"], en: ["Arman Velio"], ar: ["أرمان فيليو"], ru: ["Арман Велио"], fr: ["Arman Velio"], de: ["Arman Velio"], fa: ["آرمان ولیو"] },
  },
  {
    id: "person:sofia_brandt", type: "person", label_tr: "Sofia Brandt", matchable: true,
    aliases: { tr: ["Sofia Brandt"], en: ["Sofia Brandt"], ar: ["صوفيا براندت"], ru: ["София Брандт"], fr: ["Sofia Brandt"], de: ["Sofia Brandt"], fa: ["سوفیا برانت"] },
  },
  {
    id: "org:kestria_disaster_agency", type: "org", label_tr: "Kestriya Afet Ajansı", matchable: true,
    aliases: {
      tr: ["Kestriya Afet Ajansı"], en: ["Kestria Disaster Agency"], ar: ["وكالة الكوارث في كيستريا"],
      ru: ["Агентства по чрезвычайным ситуациям Кестрии"], fr: ["Agence des catastrophes de Kestrie"],
      de: ["Katastrophenamt von Kestrien"], fa: ["سازمان مدیریت بحران کستریا"],
    },
  },
  {
    id: "org:doravia_central_bank", type: "org", label_tr: "Doravya Merkez Bankası", matchable: true,
    aliases: {
      tr: ["Doravya Merkez Bankası"], en: ["Central Bank of Doravia"], ar: ["البنك المركزي في دورافيا"],
      ru: ["Центральный банк Доравии"], fr: ["Banque centrale de Doravie"], de: ["Zentralbank von Dorawien"], fa: ["بانک مرکزی دوراویا"],
    },
  },
  // ---- Kavramlar (anahtar kelime) ----
  {
    id: "concept:earthquake", type: "keyword", label_tr: "Deprem", matchable: true,
    aliases: { tr: ["deprem"], en: ["earthquake", "quake"], ar: ["زلزال"], ru: ["землетрясение", "землетрясения"], fr: ["séisme"], de: ["Erdbeben"], fa: ["زلزله"] },
  },
  {
    id: "concept:wildfire", type: "keyword", label_tr: "Orman yangını", matchable: true,
    aliases: { tr: ["orman yangını", "yangın"], en: ["wildfire", "forest fire"], ar: ["حريق"], ru: ["пожар"], fr: ["incendie"], de: ["Waldbrand"], fa: ["آتش‌سوزی"] },
  },
  {
    id: "concept:agreement", type: "keyword", label_tr: "Anlaşma", matchable: true,
    aliases: { tr: ["anlaşma"], en: ["agreement"], ar: ["اتفاقية"], ru: ["соглашение"], fr: ["accord"], de: ["Abkommen", "Hafenabkommen"], fa: ["توافق", "قرارداد"] },
  },
  {
    id: "concept:port", type: "keyword", label_tr: "Liman", matchable: true,
    aliases: { tr: ["liman"], en: ["port"], ar: ["الموانئ", "ميناء"], ru: ["портовое", "порт"], fr: ["portuaire"], de: ["Hafen"], fa: ["بندر"] },
  },
  {
    id: "concept:cyberattack", type: "keyword", label_tr: "Siber saldırı", matchable: true,
    aliases: { tr: ["siber saldırı"], en: ["cyberattack", "cyber attack"], ar: ["هجوم إلكتروني"], ru: ["кибератаке", "кибератака"], fr: ["cyberattaque"], de: ["Cyberangriff"], fa: ["حمله سایبری"] },
  },
  {
    id: "concept:border_closure", type: "keyword", label_tr: "Sınır kapatma", matchable: true,
    aliases: {
      tr: ["sınır"], en: ["border"], ar: ["الحدود"], ru: ["граница", "границу", "границы"],
      fr: ["frontière"], de: ["Grenze", "Grenzübergang"], fa: ["مرز"],
    },
  },
  {
    id: "concept:casualties", type: "keyword", label_tr: "Can kaybı", matchable: false,
    aliases: {
      tr: ["hayatını kaybetti", "hayatını kaybedenlerin", "can kaybı"], en: ["killed", "dead", "death toll"],
      ar: ["لقوا حتفهم", "قتلى"], ru: ["погибли", "погибших"], fr: ["morts", "tuées"], de: ["Toten", "Todesopfer"], fa: ["کشته", "قربانیان"],
    },
  },
];
