// DEMO / SENTETİK HABERLER — kurgusal olaylar, kurgusal yayıncılar (.example alan adları, RFC 2606).
// Zamanlar "kaç saat önce" olarak verilir; MockDataProvider bunları çalışma anındaki `now`a göre üretir.
// `expect` alanları yalnız testler ve sentetik değerlendirme içindir (analist etiketi DEĞİLDİR).

export interface MockSource {
  source_id: string; name: string; domain: string; country: string; default_lang: string;
}

export interface MockArticle {
  key: string;
  source_id: string;
  lang: string;
  url: string;
  title: string;
  body: string;
  /** Kaç saat önce yayımlandı; null = yayın tarihi yok; negatif = gelecekte (geçersiz) */
  hoursAgo: number | null;
  /** Sağlayıcı tarihi tahmini olarak işaretlediyse */
  dateEstimated?: boolean;
  expect: { event: string; novelty: string };
}

export const MOCK_SOURCES: MockSource[] = [
  { source_id: "demo-tr-haber", name: "Demo Haber (TR)", domain: "haber-tr.example", country: "TR", default_lang: "tr" },
  { source_id: "demo-en-wire", name: "Demo Wire (EN)", domain: "wire-en.example", country: "GB", default_lang: "en" },
  { source_id: "demo-en-repost", name: "Demo Repost (EN)", domain: "repost-en.example", country: "US", default_lang: "en" },
  { source_id: "demo-ar-akhbar", name: "Demo Akhbar (AR)", domain: "akhbar-ar.example", country: "QA", default_lang: "ar" },
  { source_id: "demo-ru-novosti", name: "Demo Novosti (RU)", domain: "novosti-ru.example", country: "RU", default_lang: "ru" },
  { source_id: "demo-fr-journal", name: "Demo Journal (FR)", domain: "journal-fr.example", country: "FR", default_lang: "fr" },
  { source_id: "demo-de-zeitung", name: "Demo Zeitung (DE)", domain: "zeitung-de.example", country: "DE", default_lang: "de" },
  { source_id: "demo-fa-khabar", name: "Demo Khabar (FA)", domain: "khabar-fa.example", country: "IR", default_lang: "fa" },
  { source_id: "demo-de-grenzblog", name: "Demo Grenzblog (DE)", domain: "grenzblog-de.example", country: "DE", default_lang: "de" },
];

export const MOCK_ARTICLES: MockArticle[] = [
  // ===== E1: Norvik depremi =====
  {
    key: "a1", source_id: "demo-tr-haber", lang: "tr", hoursAgo: 30,
    url: "https://haber-tr.example/dunya/norvik-deprem-12-olu",
    title: "Kestriya'nın Norvik kentinde 6,1 büyüklüğünde deprem: 12 kişi hayatını kaybetti",
    body: "Kestriya'nın kuzeyindeki Norvik kentinde sabah saatlerinde 6,1 büyüklüğünde deprem meydana geldi. Kestriya Afet Ajansı'nın açıklamasına göre 12 kişi hayatını kaybetti, 140 kişi yaralandı. Arama kurtarma çalışmaları sürüyor.",
    expect: { event: "E1", novelty: "new_event" },
  },
  {
    key: "a2", source_id: "demo-en-wire", lang: "en", hoursAgo: 29,
    url: "https://wire-en.example/world/norvik-earthquake",
    title: "Magnitude 6.1 earthquake strikes Norvik, Kestria; 12 killed",
    body: "A magnitude 6.1 earthquake struck the city of Norvik in northern Kestria on Tuesday morning. The Kestria Disaster Agency said 12 people were killed and 140 injured. Rescue teams are searching collapsed buildings.",
    expect: { event: "E1", novelty: "duplicate" },
  },
  {
    key: "a3", source_id: "demo-en-repost", lang: "en", hoursAgo: 28.5,
    url: "https://repost-en.example/2026/norvik-earthquake-strikes",
    title: "Magnitude 6.1 earthquake strikes Norvik, Kestria; 12 killed",
    body: "A magnitude 6.1 earthquake struck the city of Norvik in northern Kestria on Tuesday morning. The Kestria Disaster Agency said 12 people were killed and 140 injured. Rescue teams are searching collapsed buildings.",
    expect: { event: "E1", novelty: "duplicate" },
  },
  {
    key: "a4", source_id: "demo-ar-akhbar", lang: "ar", hoursAgo: 28,
    url: "https://akhbar-ar.example/news/norvik-zilzal",
    title: "زلزال بقوة 6.1 درجات يضرب مدينة نورفيك في كيستريا ومقتل 12 شخصا",
    body: "ضرب زلزال بقوة 6.1 درجات مدينة نورفيك شمالي كيستريا صباح اليوم. وقالت وكالة الكوارث في كيستريا إن 12 شخصا لقوا حتفهم وأصيب 140 آخرون. وتتواصل عمليات البحث والإنقاذ.",
    expect: { event: "E1", novelty: "duplicate" },
  },
  {
    key: "a5", source_id: "demo-ru-novosti", lang: "ru", hoursAgo: 27,
    url: "https://novosti-ru.example/world/zemletryasenie-norvik",
    title: "Землетрясение магнитудой 6,1 произошло в Норвике (Кестрия): погибли 12 человек",
    body: "Землетрясение магнитудой 6,1 произошло утром в городе Норвик на севере Кестрии. По данным Агентства по чрезвычайным ситуациям Кестрии, погибли 12 человек, 140 получили ранения. Спасатели продолжают поиски.",
    expect: { event: "E1", novelty: "duplicate" },
  },
  {
    key: "a6", source_id: "demo-fr-journal", lang: "fr", hoursAgo: 26,
    url: "https://journal-fr.example/monde/seisme-norvik",
    title: "Un séisme de magnitude 6,1 frappe Norvik, en Kestrie : 12 morts",
    body: "Un séisme de magnitude 6,1 a frappé mardi matin la ville de Norvik, dans le nord de la Kestrie. Selon l'Agence des catastrophes de Kestrie, 12 personnes ont été tuées et 140 blessées.",
    expect: { event: "E1", novelty: "duplicate" },
  },
  {
    key: "a7", source_id: "demo-de-zeitung", lang: "de", hoursAgo: 20,
    url: "https://zeitung-de.example/ausland/erdbeben-norvik-19-tote",
    title: "Erdbeben in Norvik: Zahl der Toten steigt auf 19",
    body: "Nach dem Erdbeben der Stärke 6,1 in der kestrischen Stadt Norvik ist die Zahl der Todesopfer auf 19 gestiegen. Das Katastrophenamt von Kestrien meldete zudem 210 Verletzte. Ministerpräsident Arman Velio besuchte am Mittwoch das Erdbebengebiet.",
    expect: { event: "E1", novelty: "significant_update" },
  },
  {
    key: "a8", source_id: "demo-fa-khabar", lang: "fa", hoursAgo: 19,
    url: "https://khabar-fa.example/news/norvik-zelzele-19",
    title: "شمار قربانیان زلزله نورویک به ۱۹ نفر رسید",
    body: "شمار کشته‌شدگان زلزله ۶٫۱ ریشتری در شهر نورویک در شمال کستریا به ۱۹ نفر رسید. آرمان ولیو، نخست‌وزیر کستریا، از منطقه زلزله‌زده بازدید کرد.",
    expect: { event: "E1", novelty: "duplicate" },
  },
  {
    key: "a9", source_id: "demo-tr-haber", lang: "tr", hoursAgo: 6,
    url: "https://haber-tr.example/dunya/norvik-can-kaybi-21",
    title: "Norvik depreminde can kaybının 21'e yükseldiği iddia edildi",
    body: "Yerel kaynaklara dayandırılan haberlere göre Norvik'teki depremde hayatını kaybedenlerin sayısı 21'e yükseldi. Kestriya Afet Ajansı ise resmi rakamın 19 olduğunu açıkladı.",
    expect: { event: "E1", novelty: "unverified_claim" },
  },
  {
    key: "a10", source_id: "demo-en-wire", lang: "en", hoursAgo: 5,
    url: "https://wire-en.example/world/norvik-earthquake-toll-19",
    title: "Norvik earthquake death toll stands at 19, agency says",
    body: "The death toll from the earthquake in Norvik, Kestria, stands at 19, the Kestria Disaster Agency said on Wednesday.",
    expect: { event: "E1", novelty: "duplicate" },
  },

  // ===== E2: Kestriya–Doravya liman anlaşması =====
  {
    key: "b1", source_id: "demo-en-wire", lang: "en", hoursAgo: 50,
    url: "https://wire-en.example/politics/kestria-doravia-port-agreement",
    title: "Kestria and Doravia sign port cooperation agreement in Lisvane",
    body: "Kestrian Prime Minister Arman Velio and Doravian Foreign Minister Sofia Brandt signed a port cooperation agreement in Lisvane on Monday. The 15-year agreement covers joint management of two container terminals.",
    expect: { event: "E2", novelty: "new_event" },
  },
  {
    key: "b2", source_id: "demo-de-zeitung", lang: "de", hoursAgo: 49,
    url: "https://zeitung-de.example/politik/hafenabkommen-lisvane",
    title: "Kestrien und Dorawien unterzeichnen Hafenabkommen in Lisvane",
    body: "Der kestrische Ministerpräsident Arman Velio und die dorawische Außenministerin Sofia Brandt haben in Lisvane ein Hafenabkommen unterzeichnet. Das Abkommen hat eine Laufzeit von 15 Jahren.",
    expect: { event: "E2", novelty: "duplicate" },
  },
  {
    key: "b3", source_id: "demo-fr-journal", lang: "fr", hoursAgo: 48,
    url: "https://journal-fr.example/politique/accord-portuaire-lisvane",
    title: "La Kestrie et la Doravie signent un accord portuaire à Lisvane",
    body: "Le Premier ministre kestrien Arman Velio et la ministre des Affaires étrangères doravienne Sofia Brandt ont signé lundi à Lisvane un accord de coopération portuaire d'une durée de 15 ans.",
    expect: { event: "E2", novelty: "duplicate" },
  },
  {
    key: "b4", source_id: "demo-ar-akhbar", lang: "ar", hoursAgo: 47,
    url: "https://akhbar-ar.example/news/kestria-doravia-port",
    title: "كيستريا ودورافيا توقعان اتفاقية تعاون في الموانئ في ليسفين",
    body: "وقع رئيس وزراء كيستريا أرمان فيليو ووزيرة خارجية دورافيا صوفيا براندت اتفاقية للتعاون في مجال الموانئ في مدينة ليسفين. وتمتد الاتفاقية لمدة 15 عاما.",
    expect: { event: "E2", novelty: "duplicate" },
  },
  {
    key: "b5", source_id: "demo-tr-haber", lang: "tr", hoursAgo: null,
    url: "https://haber-tr.example/dunya/kestriya-doravya-liman-anlasmasi",
    title: "Kestriya ile Doravya arasında liman anlaşması imzalandı",
    body: "Kestriya Başbakanı Arman Velio ile Doravya Dışişleri Bakanı Sofia Brandt, Lisvane'de 15 yıllık liman işbirliği anlaşması imzaladı.",
    expect: { event: "E2", novelty: "uncertain_date_or_source" },
  },
  {
    key: "b6", source_id: "demo-ru-novosti", lang: "ru", hoursAgo: -72,
    url: "https://novosti-ru.example/politika/portovoe-soglashenie",
    title: "Кестрия и Доравия подписали портовое соглашение",
    body: "Премьер-министр Кестрии Арман Велио и министр иностранных дел Доравии София Брандт подписали в Лисвейне соглашение о портовом сотрудничестве сроком на 15 лет.",
    expect: { event: "E2", novelty: "uncertain_date_or_source" },
  },

  // ===== E3: Norvik yakınında orman yangını (E1 ile AYNI yer, FARKLI olay) =====
  {
    key: "c1", source_id: "demo-ru-novosti", lang: "ru", hoursAgo: 10,
    url: "https://novosti-ru.example/proisshestviya/lesnoy-pozhar-norvik",
    title: "Лесной пожар вблизи Норвика: эвакуированы 300 жителей",
    body: "Крупный лесной пожар вспыхнул в лесах к югу от Норвика. Власти Кестрии эвакуировали 300 жителей из трёх деревень.",
    expect: { event: "E3", novelty: "new_event" },
  },
  {
    key: "c2", source_id: "demo-en-wire", lang: "en", hoursAgo: 9,
    url: "https://wire-en.example/world/norvik-wildfire-evacuation",
    title: "Wildfire near Norvik forces evacuation of 300 residents",
    body: "A wildfire broke out in forests south of Norvik, Kestria, forcing authorities to evacuate 300 residents from three villages.",
    expect: { event: "E3", novelty: "duplicate" },
  },
  {
    key: "c3", source_id: "demo-fa-khabar", lang: "fa", hoursAgo: 8,
    url: "https://khabar-fa.example/news/norvik-atash",
    title: "آتش‌سوزی جنگلی در نزدیکی نورویک؛ ۳۰۰ نفر تخلیه شدند",
    body: "آتش‌سوزی گسترده‌ای در جنگل‌های جنوب نورویک در کستریا رخ داد و مقامات ۳۰۰ نفر از ساکنان سه روستا را تخلیه کردند.",
    expect: { event: "E3", novelty: "duplicate" },
  },

  // ===== E4: Doğrulanmamış siber saldırı iddiası =====
  {
    key: "d1", source_id: "demo-ru-novosti", lang: "ru", hoursAgo: 3,
    url: "https://novosti-ru.example/ekonomika/kiberataka-bank-doravii",
    title: "СМИ: Центральный банк Доравии якобы подвергся кибератаке",
    body: "По неподтверждённым данным, Центральный банк Доравии якобы подвергся кибератаке. Официальных комментариев пока не поступало.",
    expect: { event: "E4", novelty: "unverified_claim" },
  },
  {
    key: "d2", source_id: "demo-unknown-blog", lang: "fa", hoursAgo: 2,
    url: "https://blog-unknown.example/post/doravia-bank",
    title: "گزارش‌ها از حمله سایبری به بانک مرکزی دوراویا حکایت دارد",
    body: "بر اساس گزارش‌های تأیید نشده، بانک مرکزی دوراویا هدف حمله سایبری قرار گرفته است.",
    expect: { event: "E4", novelty: "uncertain_date_or_source" },
  },

  // ===== E5: Sınır kapatma iddiası — YAYILIM senaryosu =====
  // Küçük bir blogda teyitsiz doğan iddia; atıflarla dil değiştirerek yayılır. Yol boyunca:
  //  • Demo Wire'da teyitsizlik ifadesi düşer (iddia kesin bilgiye dönüşür),
  //  • Demo Akhbar'da 40 gözaltı 400'e çıkar, Demo Novosti'de rakam "сотни"ye (yüzlerce) belirsizleşir,
  //  • Demo Repost, Demo Wire'ı birebir kopyalar.
  {
    key: "f1", source_id: "demo-de-grenzblog", lang: "de", hoursAgo: 9,
    url: "https://grenzblog-de.example/2026/dorawien-grenze-geschlossen",
    title: "Dorawien soll Grenze zu Kestrien geschlossen haben – angeblich 40 Festnahmen",
    body: "Nach unbestätigten Berichten von Anwohnern hat Dorawien den Grenzübergang zu Kestrien geschlossen. Angeblich wurden 40 Menschen festgenommen. Eine offizielle Bestätigung gibt es nicht.",
    expect: { event: "E5", novelty: "unverified_claim" },
  },
  {
    key: "f2", source_id: "demo-de-zeitung", lang: "de", hoursAgo: 7.5,
    url: "https://zeitung-de.example/ausland/dorawien-grenze-berichte",
    title: "Berichte: Dorawien schließt Grenze zu Kestrien",
    body: "Wie der Demo Grenzblog berichtet, soll Dorawien den Grenzübergang zu Kestrien geschlossen haben. Dabei seien angeblich 40 Menschen festgenommen worden. Die Regierung von Dorawien hat die Berichte bislang nicht kommentiert.",
    expect: { event: "E5", novelty: "duplicate" },
  },
  {
    key: "f3", source_id: "demo-en-wire", lang: "en", hoursAgo: 5.9,
    url: "https://wire-en.example/world/doravia-closes-border-kestria",
    title: "Doravia closes border with Kestria, 40 detained",
    body: "Doravia has closed its border crossing with Kestria and detained 40 people, Demo Zeitung reported. Doravian officials did not respond to requests for comment.",
    expect: { event: "E5", novelty: "duplicate" },
  },
  {
    key: "f4", source_id: "demo-en-repost", lang: "en", hoursAgo: 5.6,
    url: "https://repost-en.example/2026/doravia-closes-border",
    title: "Doravia closes border with Kestria, 40 detained",
    body: "Doravia has closed its border crossing with Kestria and detained 40 people, Demo Zeitung reported. Doravian officials did not respond to requests for comment.",
    expect: { event: "E5", novelty: "duplicate" },
  },
  {
    key: "f5", source_id: "demo-ar-akhbar", lang: "ar", hoursAgo: 4.5,
    url: "https://akhbar-ar.example/news/doravia-hudud-400",
    title: "دورافيا تغلق الحدود مع كيستريا واعتقال 400 شخص",
    body: "أغلقت دورافيا الحدود مع كيستريا واعتقلت 400 شخص، بحسب ما أفادت Demo Wire. ولم يصدر تعليق رسمي من دورافيا.",
    expect: { event: "E5", novelty: "significant_update" },
  },
  {
    key: "f6", source_id: "demo-fa-khabar", lang: "fa", hoursAgo: 3.5,
    url: "https://khabar-fa.example/news/doravia-marz-400",
    title: "دوراویا مرز با کستریا را بست؛ ۴۰۰ نفر بازداشت شدند",
    body: "به گزارش Demo Akhbar، دوراویا مرز خود با کستریا را بست و ۴۰۰ نفر را بازداشت کرد.",
    expect: { event: "E5", novelty: "duplicate" },
  },
  {
    key: "f7", source_id: "demo-ru-novosti", lang: "ru", hoursAgo: 2.5,
    url: "https://novosti-ru.example/mir/doraviya-zakryla-granitsu",
    title: "Доравия закрыла границу с Кестрией: задержаны сотни человек",
    body: "Власти Доравии закрыли границу с Кестрией, сообщает Demo Khabar. По данным издания, задержаны сотни человек.",
    expect: { event: "E5", novelty: "duplicate" },
  },
  {
    key: "f8", source_id: "demo-tr-haber", lang: "tr", hoursAgo: 1,
    url: "https://haber-tr.example/dunya/doravya-sinir-iddiasi",
    title: "Doravya'nın Kestriya sınırını kapattığı iddia edildi",
    body: "Doravya'nın Kestriya sınır kapısını kapattığı ve 40 kişiyi gözaltına aldığı ileri sürüldü. Haber ilk olarak Demo Grenzblog'da yer aldı; Doravya hükümeti iddiaları teyit etmedi.",
    expect: { event: "E5", novelty: "duplicate" },
  },
];
