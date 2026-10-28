// SİNYAL web arayüzü — bağımlılıksız TypeScript.
// GÜVENLİK: Sunucudan gelen hiçbir metin innerHTML ile eklenmez; tüm içerik textContent ile yazılır.

type Json = any; // API yanıtları sunucu tarafında şemalıdır; arayüzde yalnız gösterim için okunur.

// ---------- DOM yardımcıları ----------
type Child = Node | string | number | null | undefined | false | Child[];
function h(tag: string, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const add = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}
const RTL = new Set(["ar", "fa"]);
/** Özgün dilde metin: doğru lang + yön özniteliği ile. */
const orig = (text: string, lang: string, tag = "div", cls = "orig") =>
  h(tag, { class: cls, lang: lang && lang !== "und" ? lang : undefined, dir: RTL.has(lang) ? "rtl" : "auto" }, text);
const badge = (text: string, kind = "muted", title?: string) => h("span", { class: `badge b-${kind}`, title }, text);
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—");

const LANG_TR: Record<string, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça", ru: "Rusça", fr: "Fransızca", de: "Almanca", fa: "Farsça", und: "Belirsiz" };
const NOVELTY: Record<string, [string, string]> = {
  new_event: ["Yeni olay", "info"],
  significant_update: ["Anlamlı gelişme", "ok"],
  duplicate: ["Tekrar haber", "muted"],
  unverified_claim: ["Doğrulanmamış iddia", "warn"],
  uncertain_date_or_source: ["Tarih/kaynak belirsiz", "bad"],
};
const DATEQ: Record<string, [string, string]> = {
  exact: ["Tarih kesin", "muted"], estimated: ["Tarih tahmini", "warn"], missing: ["Tarih yok", "bad"], invalid: ["Tarih geçersiz", "bad"], future: ["Tarih gelecekte", "bad"],
};
const CLAIM: Record<string, [string, string]> = {
  supported: ["Kaynakta dayanağı bulundu", "ok"],
  partially_supported: ["Kısmen dayanaklı", "warn"],
  contradicted: ["Kaynakla çelişiyor", "bad"],
  unverified: ["Doğrulanamadı", "warn"],
  no_source: ["Kaynaksız", "bad"],
};
const SUPPORT: Record<string, [string, string]> = {
  supported: ["alıntı bulundu", "ok"], not_found: ["bulunamadı", "bad"], contradicted: ["çelişki", "bad"], unverifiable: ["denetlenemedi", "warn"],
};
const REVIEW: Record<string, string> = { pending: "İnceleme bekliyor", approved: "Onaylandı", corrected: "Düzeltildi", rejected: "Reddedildi" };
const nov = (k: string) => badge(...((NOVELTY[k] ?? [k, "muted"]) as [string, string]));
const langBadge = (l: string, conf?: number) =>
  badge(`${(l || "und").toUpperCase()}${conf !== undefined && conf < 0.7 ? " ?" : ""}`, conf !== undefined && conf < 0.7 ? "warn" : "muted",
    `${LANG_TR[l] ?? l}${conf !== undefined ? ` — tespit güveni ${Math.round(conf * 100)}% (sezgisel)` : ""}`);

// ---------- API ----------
class ApiError extends Error { constructor(readonly status: number, msg: string) { super(msg); } }
async function api(path: string, init: RequestInit = {}): Promise<Json> {
  const res = await fetch(path, {
    ...init, credentials: "same-origin",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  let data: Json = null;
  try { data = await res.json(); } catch { /* gövde yok */ }
  if (res.status === 401 && state.user && !path.startsWith("/api/auth/")) { state.user = null; render(); throw new ApiError(401, "Oturum süresi doldu"); }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`);
  return data;
}
const post = (path: string, body: unknown = {}) => api(path, { method: "POST", body: JSON.stringify(body) });

// ---------- Durum ve yönlendirme ----------
const state: { user: Json | null; demo: boolean | null; providerState: string | null; llmMock: boolean | null } = { user: null, demo: null, providerState: null, llmMock: null };
const root = document.getElementById("root")!;
const NAV: Array<[string, string, string?]> = [
  ["#/panel", "Analist Paneli"], ["#/olaylar", "Olay Haritası"], ["#/arama", "Haber Arama"],
  ["#/kanit", "Kanıt Laboratuvarı"], ["#/sistem", "Model ve Sistem"], ["#/yonetim", "Yönetim", "admin"],
];

function route(): { name: string; arg: string; query: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, "") || "panel";
  const [path, qs] = raw.split("?");
  const [name, arg] = (path ?? "").split("/");
  return { name: name || "panel", arg: decodeURIComponent(arg ?? ""), query: new URLSearchParams(qs ?? "") };
}
function go(hash: string) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener("hashchange", () => render());

function shell(title: string, content: HTMLElement, actions?: HTMLElement): HTMLElement {
  const r = route();
  const nav = h("nav", { class: "nav", "aria-label": "Ana menü" },
    h("div", { class: "brand" }, "SİNYAL"),
    h("div", { class: "brand-sub" }, "Çok dilli medya istihbaratı"),
    NAV.filter(([, , role]) => !role || state.user?.role === role).map(([href, label]) =>
      h("a", { href, "aria-current": href === "#/" + r.name || (href === "#/olaylar" && r.name === "olay") ? "page" : undefined }, label)),
    h("div", { class: "spacer" }),
    h("div", { class: "who" }, h("div", {}, state.user?.name ?? ""), h("div", {}, roleTr(state.user?.role)),
      h("button", { class: "secondary", onclick: async () => { await post("/api/auth/logout").catch(() => null); state.user = null; render(); } }, "Çıkış")),
  );
  const top = h("div", { class: "top" }, h("h1", {}, title),
    state.demo ? badge("DEMO VERİ", "demo", "Veriler kurgusal ve sentetiktir") : null,
    state.llmMock ? badge("MOCK MODEL", "demo", "Model çıktıları sahte sağlayıcıdan gelir") : null,
    actions ?? null);
  return h("div", { class: "layout" }, nav, h("div", {}, top, h("main", { id: "main", tabindex: "-1" }, content)));
}
const roleTr = (r?: string) => ({ admin: "Yönetici", analyst: "Analist", viewer: "İzleyici" } as Record<string, string>)[r ?? ""] ?? "";
const can = (perm: "review" | "analyze" | "ingest" | "admin") =>
  state.user && ({ viewer: [], analyst: ["review", "analyze"], admin: ["review", "analyze", "ingest", "admin"] } as Record<string, string[]>)[state.user.role]?.includes(perm);

const loading = () => h("div", { class: "empty", role: "status" }, "Yükleniyor…");
const empty = (msg: string) => h("div", { class: "empty" }, msg);
const errorBox = (e: unknown) => h("div", { class: "error-box", role: "alert" }, `Hata: ${(e as Error).message}`);

/** Sayfa iskeletini hemen çizer, veriyi yükleyip içeriği değiştirir (yükleniyor/hata durumlarıyla). */
async function page(title: string, load: () => Promise<HTMLElement>, actions?: HTMLElement) {
  const holder = h("div", {}, loading());
  root.replaceChildren(shell(title, holder, actions));
  try { holder.replaceChildren(await load()); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) holder.replaceChildren(errorBox(e)); }
}

function providerBanner(): HTMLElement | null {
  if (state.demo) return h("div", { class: "banner demo" }, "Bu ekrandaki tüm haberler, yayıncılar ve olaylar KURGUSAL demo verisidir (MockDataProvider). Gerçek bir gelişmeyi temsil etmez.");
  if (state.providerState && state.providerState !== "ok") return h("div", { class: "banner warn" }, "Veri entegrasyonu yapılandırılmadı veya doğrulanmadı. Gösterilen sayılar yalnız SİNYAL veritabanındaki mevcut kayıtlardır.");
  return null;
}

// ---------- Sayfalar ----------
async function render() {
  if (!state.user) {
    try { state.user = (await api("/api/auth/me")).user; } catch { /* giriş yok */ }
    if (!state.user) return renderLogin();
  }
  const r = route();
  switch (r.name) {
    case "panel": return renderDashboard(r.query.get("w") === "72" ? 72 : 24);
    case "olaylar": return renderEvents(r.query);
    case "olay": return renderEvent(r.arg);
    case "arama": return renderSearch(r.query);
    case "kanit": return renderEvidence();
    case "sistem": return renderSystem();
    case "yonetim": return state.user.role === "admin" ? renderAdmin() : go("#/panel");
    default: return go("#/panel");
  }
}

function renderLogin() {
  const msg = h("p", { role: "alert", class: "small" });
  const email = h("input", { type: "email", name: "email", autocomplete: "username", required: true }) as HTMLInputElement;
  const pw = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true }) as HTMLInputElement;
  const form = h("form", {
    class: "login", onsubmit: async (e: Event) => {
      e.preventDefault(); msg.textContent = "";
      try { state.user = (await post("/api/auth/login", { email: email.value, password: pw.value })).user; go("#/panel"); }
      catch (err) { msg.textContent = (err as Error).message; }
    },
  }, h("h1", {}, "SİNYAL"), h("p", { class: "meta" }, "Bağımsız çok dilli medya analiz platformu"),
    h("label", {}, "E-posta", email), h("label", {}, "Parola", pw), h("button", { type: "submit" }, "Giriş yap"), msg);
  root.replaceChildren(h("main", { id: "main" }, form));
  email.focus();
}

async function renderDashboard(w: 24 | 72) {
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Zaman penceresi" },
    h("button", { "aria-pressed": String(w === 24), onclick: () => go("#/panel") }, "Son 24 saat"),
    h("button", { "aria-pressed": String(w === 72), onclick: () => go("#/panel?w=72") }, "Son 72 saat"));
  await page("Analist Paneli", async () => {
    const d = await api(`/api/dashboard?window=${w}`);
    state.demo = d.demo; state.providerState = d.pipeline.provider.state; state.llmMock = d.model.mock;
    const c = d.counts;
    const kpi = (v: number, l: string, href?: string) => h("div", { class: "kpi" }, h("div", { class: "v" }, href ? h("a", { href }, String(v)) : String(v)), h("div", { class: "l" }, l));
    const dist = (title: string, data: Record<string, number>, label: (k: string) => string) => {
      const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...entries.map((e) => e[1]));
      return h("div", { class: "card" }, h("h2", {}, title), entries.length ? h("table", {}, h("tbody", {},
        entries.map(([k, v]) => h("tr", {}, h("td", {}, label(k)), h("td", { style: undefined }, h("div", { class: "bar", "aria-hidden": "true", "data-w": v })), h("td", {}, String(v)))))) : empty("Bu pencerede veri yok."));
    };
    const el = h("div", {}, providerBanner(),
      h("div", { class: "grid kpis" },
        kpi(c.new_events, "Yeni tespit edilen olay", "#/olaylar"),
        kpi(c.updated_events, "Anlamlı gelişme olan olay"),
        kpi(c.duplicates, "Tekrar haber", "#/arama?novelty=duplicate"),
        kpi(c.unverified_claims, "Doğrulanmamış iddia", "#/arama?novelty=unverified_claim"),
        kpi(c.uncertain_date_or_source, "Tarihi/kaynağı belirsiz", "#/arama?novelty=uncertain_date_or_source"),
        kpi(c.articles, "Haber (pencere içinde)"),
        kpi(c.active_events, "Aktif olay")),
      h("div", { class: "grid cols2" },
        dist("Dil dağılımı", d.by_lang, (k) => `${LANG_TR[k] ?? k} (${k})`),
        dist("Kaynak dağılımı", d.by_source, (k) => k),
        h("div", { class: "card" }, h("h2", {}, "İşleme hattı"),
          h("p", {}, d.pipeline.healthy ? badge("Sağlıklı", "ok") : badge("Dikkat gerekiyor", "warn"), " ", d.pipeline.provider.message),
          d.pipeline.last_ingestion ? h("p", { class: "meta" }, `Son alım: ${fmt(d.pipeline.last_ingestion.finished_at)} · ${d.pipeline.last_ingestion.inserted} yeni · ${d.pipeline.last_ingestion.skipped_duplicates} atlandı · durum: ${d.pipeline.last_ingestion.status}`) : h("p", { class: "meta" }, "Henüz alım yapılmadı.")),
        h("div", { class: "card" }, h("h2", {}, "Model durumu"),
          h("p", {}, `${d.model.provider} / ${d.model.model} `, d.model.mock ? badge("MOCK", "demo") : null),
          h("p", { class: "meta" }, `Son ${d.model.recent_runs} analizde ${d.model.recent_errors} hata · işlemde: ${d.model.inflight}`),
          h("a", { href: "#/sistem" }, "Ayrıntılı durum →"))),
    );
    // Çubuk genişlikleri CSS değişkeni ile değil, doğrudan stil özelliğiyle (CSP: inline style özniteliği değil, CSSOM).
    el.querySelectorAll<HTMLElement>(".bar").forEach((b) => {
      const tbl = b.closest("table")!; const vals = [...tbl.querySelectorAll<HTMLElement>(".bar")].map((x) => Number(x.dataset.w));
      b.style.width = `${Math.round((Number(b.dataset.w) / Math.max(1, ...vals)) * 100)}%`;
    });
    return el;
  }, seg);
}

async function entityOptions(selected: string): Promise<HTMLSelectElement> {
  const ents = await api("/api/entities").catch(() => ({ items: [] }));
  const typeTr: Record<string, string> = { person: "Kişi", org: "Kurum", place: "Yer", keyword: "Konu" };
  return h("select", { name: "entity" }, h("option", { value: "" }, "Tümü"),
    ents.items.map((e: Json) => h("option", { value: e.id, selected: e.id === selected }, `${typeTr[e.type] ?? e.type}: ${e.label}`))) as HTMLSelectElement;
}
const langSelect = (sel: string) => h("select", { name: "lang" }, h("option", { value: "" }, "Tümü"),
  ["tr", "en", "ar", "ru", "fr", "de", "fa"].map((l) => h("option", { value: l, selected: l === sel }, `${LANG_TR[l]} (${l})`)));

function filterForm(base: string, fields: HTMLElement[]): HTMLElement {
  return h("form", {
    class: "filters", role: "search",
    onsubmit: (e: Event) => {
      e.preventDefault();
      const fd = new FormData(e.target as HTMLFormElement);
      const qs = new URLSearchParams();
      for (const [k, v] of fd.entries()) if (String(v).trim()) qs.set(k, String(v).trim());
      go(`${base}?${qs}`);
    },
  }, fields, h("button", { type: "submit" }, "Filtrele"), h("button", { type: "button", class: "secondary", onclick: () => go(base) }, "Temizle"));
}

async function renderEvents(q: URLSearchParams) {
  await page("Olay Haritası", async () => {
    const qs = new URLSearchParams(q);
    const [d, entSel] = await Promise.all([api(`/api/events?${qs}`), entityOptions(q.get("entity") ?? "")]);
    const form = filterForm("#/olaylar", [
      h("label", {}, "Arama", h("input", { name: "q", value: q.get("q") ?? "", placeholder: "Olay veya haber başlığında ara" })),
      h("label", {}, "Dil", langSelect(q.get("lang") ?? "")),
      h("label", {}, "Varlık / konu", entSel),
      h("label", {}, "Pencere", h("select", { name: "window" }, [["", "Tümü"], ["24", "24 saat"], ["72", "72 saat"], ["168", "7 gün"]].map(([v, l]) => h("option", { value: v, selected: (q.get("window") ?? "") === v }, l)))),
    ]);
    const list = d.items.length ? d.items.map((e: Json) => h("article", { class: "card event-card" },
      h("h3", {}, h("a", { href: `#/olay/${encodeURIComponent(e.event_id)}` }, e.title_tr || "Adlandırılmamış olay")),
      e.analysis ? h("p", { class: "small" }, "Model başlığı: ", e.analysis.title_tr, " ", e.analysis.mock ? badge("MOCK", "demo") : null) : null,
      h("div", { class: "meta" },
        h("span", {}, `${e.article_count} haber · ${e.sources} kaynak`),
        h("span", {}, e.langs.map((l: string) => langBadge(l))),
        h("span", {}, `İlk: ${fmt(e.first_seen_at)} · Son: ${fmt(e.last_updated_at)}`),
        e.novelty.significant_update ? badge(`${e.novelty.significant_update} gelişme`, "ok") : null,
        e.novelty.unverified_claim ? badge(`${e.novelty.unverified_claim} doğrulanmamış iddia`, "warn") : null,
        e.novelty.uncertain_date_or_source ? badge(`${e.novelty.uncertain_date_or_source} tarih/kaynak belirsiz`, "bad") : null,
        e.uncertain_matches ? badge(`${e.uncertain_matches} belirsiz eşleşme`, "warn") : null,
      ))) : [empty("Filtrelere uyan olay yok.")];
    return h("div", {}, providerBanner(), form, h("p", { class: "meta" }, `${d.total} olay`), list);
  });
}

async function renderEvent(id: string) {
  await page("Olay ayrıntısı", async () => {
    const d = await api(`/api/events/${encodeURIComponent(id)}`);
    const ev = d.event;
    const artById = new Map<string, Json>(d.articles.map((a: Json) => [a.article_id, a]));
    const artLabel = (aid: string) => { const a = artById.get(aid); return a ? `${a.source.name} (${a.lang})` : aid; };

    const analyzeBtn = can("analyze") ? h("button", {
      onclick: async (e: Event) => {
        const b = e.target as HTMLButtonElement; b.disabled = true; b.textContent = "Analiz ediliyor…";
        try { await post(`/api/events/${encodeURIComponent(id)}/analyze`); render(); }
        catch (err) { b.disabled = false; b.textContent = "Analizi çalıştır"; alertBox.replaceChildren(errorBox(err)); }
      },
    }, d.analysis ? "Analizi yeniden çalıştır" : "Analizi çalıştır") : null;
    const alertBox = h("div");

    const header = h("div", { class: "card" },
      h("h2", {}, ev.title_tr, " ", badge("kural tabanlı başlık", "muted", "Gazetteer kavram ve yerlerinden üretildi; model çıktısı değildir")),
      h("div", { class: "meta" }, h("span", { class: "mono" }, ev.event_id), h("span", {}, `İlk görülme: ${fmt(ev.first_seen_at)}`), h("span", {}, `Son güncelleme: ${fmt(ev.last_updated_at)}`), h("span", {}, `${d.articles.length} haber`)));

    const analysis = h("div", { class: "card" }, h("h2", {}, "Türkçe analiz"),
      d.analysis
        ? h("div", {},
            h("div", { class: "meta" }, `${d.analysis.provider} / ${d.analysis.model}`, d.analysis.mock ? badge("MOCK — gerçek model sonucu değildir", "demo") : badge("Model çıktısı — analist denetimi gerekir", "warn"), `· ${fmt(d.analysis.started_at)}`, d.analysis.status === "error" ? badge("Başarısız", "bad") : null),
            d.analysis.status === "ok" ? [h("h3", {}, d.analysis.title_tr), h("p", {}, d.analysis.summary_tr)] : h("p", {}, d.analysis.error))
        : empty("Bu olay için henüz model analizi çalıştırılmadı."),
      h("div", { class: "row" }, analyzeBtn), alertBox);

    const conflicts = d.conflicts.length ? h("div", { class: "card" }, h("h2", {}, "Kaynaklar arası farklılıklar"),
      d.conflicts.map((c: Json) => h("div", {},
        h("p", {}, badge(c.kind === "conflict" ? "Çelişki" : "Zaman içinde değişim", c.kind === "conflict" ? "bad" : "info"), " ", h("strong", {}, c.label_tr), " — ", c.explanation),
        h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Değer"), h("th", {}, "Kaynaklar"), h("th", {}, "İlk / son yayın"))),
          h("tbody", {}, c.values.map((v: Json) => h("tr", {}, h("td", {}, h("strong", {}, v.value)), h("td", {}, v.article_ids.map(artLabel).join(", ")), h("td", {}, `${fmt(v.earliest)} / ${fmt(v.latest)}`)))))))) : null;

    const timeline = h("div", { class: "card" }, h("h2", {}, "Zaman çizelgesi"),
      d.timeline.length ? h("ol", { class: "timeline" }, d.timeline.map((u: Json) => h("li", {},
        h("div", { class: "row" }, nov(u.label), h("span", { class: "meta" }, fmt(u.created_at)), h("span", { class: "small" }, artLabel(u.article_id))),
        h("div", { class: "small" }, u.summary_tr),
        u.new_facts.length ? h("div", { class: "small" }, "Yeni bilgi: ", u.new_facts.join(" · ")) : null))) : empty("Zaman çizelgesi boş."));

    const typeTr: Record<string, string> = { person: "Kişiler", org: "Kurumlar", place: "Yerler", keyword: "Anahtar kavramlar" };
    const entities = h("div", { class: "card" }, h("h2", {}, "Kişiler, kurumlar, yerler ve kavramlar"),
      h("p", { class: "meta" }, "Özgün yazımlar korunur; kanonik etiket demo sözlüğünden gelir."),
      ["person", "org", "place", "keyword"].map((t) => {
        const xs = d.entities.filter((e: Json) => e.type === t);
        return xs.length ? h("div", {}, h("h3", {}, typeTr[t]), h("ul", {}, xs.map((e: Json) => h("li", {},
          h("a", { href: `#/arama?entity=${encodeURIComponent(e.id)}` }, e.label), ` (${e.articles.length} haber) — `,
          e.surfaces.map((s: string, i: number) => [i ? " · " : "", h("bdi", {}, s)]))))) : null;
      }));

    const compare = h("div", { class: "card" }, h("h2", {}, "Kaynak karşılaştırma"),
      h("div", { class: "compare" }, d.articles.map((a: Json) => h("div", { class: "card" },
        h("div", { class: "row" }, nov(a.member.novelty), langBadge(a.lang, a.lang_confidence), badge(...(DATEQ[a.date_quality] ?? [a.date_quality, "muted"]) as [string, string]),
          a.source.unknown ? badge("Kayıtsız kaynak", "bad") : null,
          a.member.status === "uncertain" ? badge("Belirsiz eşleşme", "warn") : null),
        h("div", { class: "meta" }, h("strong", {}, a.source.name), a.source.country ? `(${a.source.country})` : null, `Yayın: ${fmt(a.published_at)}`, `SİNYAL ilk görme: ${fmt(a.first_seen_at)}`),
        orig(a.title_original, a.lang, "h3"),
        orig(a.body_original, a.lang, "p", "small"),
        a.translation_tr ? h("p", { class: "small" }, "Türkçe çeviri: ", a.translation_tr.title) : h("p", { class: "meta" }, "Türkçe çeviri yok (çeviri modeli yapılandırılmadı)."),
        h("a", { href: a.url, rel: "noopener noreferrer", target: "_blank" }, "Kaynağa git ↗"),
        h("details", {}, h("summary", {}, `Eşleştirme gerekçesi (skor ${a.member.score})`),
          h("ul", { class: "small" },
            h("li", {}, `Ortak varlıklar: ${a.member.reason.shared_entities?.join(", ") || "—"}`),
            h("li", {}, `Ortak yerler: ${a.member.reason.shared_places?.join(", ") || "—"}`),
            h("li", {}, `Ortak sayılar: ${a.member.reason.shared_numbers?.join(", ") || "—"}`),
            h("li", {}, `Başlık benzerliği (aynı dil): ${a.member.reason.title_similarity}`),
            h("li", {}, `Zaman farkı: ${a.member.reason.hours_apart ?? "bilinmiyor"} saat`),
            (a.member.reason.notes ?? []).map((n: string) => h("li", {}, n))))))));

    return h("div", {}, providerBanner(), header, analysis, conflicts, claimsSection(d, artLabel), timeline, entities, compare);
  });
}

function claimsSection(d: Json, artLabel: (id: string) => string): HTMLElement {
  return h("div", { class: "card" }, h("h2", {}, "Kanıt ve kaynaklar (iddialar)"),
    h("p", { class: "meta" }, "“Kaynakta dayanağı bulundu”: alıntı kaynak metinde birebir geçiyor ve iddiadaki sayılar/adlar alıntılarda var. Bu sözcüksel bir denetimdir; doğruluk onayı değildir."),
    d.claims.length ? d.claims.map((c: Json) => {
      const [label, kind] = (CLAIM[c.status] ?? [c.status, "muted"]) as [string, string];
      const reviewBox = h("div");
      const reviewUi = can("review") ? (() => {
        const sel = h("select", { "aria-label": "İnceleme durumu" }, Object.entries(REVIEW).map(([k, v]) => h("option", { value: k }, v))) as HTMLSelectElement;
        const txt = h("textarea", { "aria-label": "Düzeltilmiş metin veya not", placeholder: "Düzeltilmiş iddia metni (düzeltme için zorunlu) veya not" }) as HTMLTextAreaElement;
        return h("details", {}, h("summary", {}, "Analist incelemesi"), h("div", { class: "row" }, sel,
          h("button", { onclick: async () => {
            try {
              await post(`/api/claims/${encodeURIComponent(c.claim_id)}/review`, { status: sel.value, corrected_text: sel.value === "corrected" ? txt.value : "", note: sel.value === "corrected" ? "" : txt.value });
              render();
            } catch (err) { reviewBox.replaceChildren(errorBox(err)); }
          } }, "Kaydet")), txt, reviewBox);
      })() : null;
      return h("div", { class: "card" },
        h("div", { class: "row" }, badge(label, kind), c.origin?.mock ? badge("MOCK", "demo") : null,
          c.review ? badge(`${REVIEW[c.review.status]}`, c.review.status === "approved" ? "ok" : c.review.status === "rejected" ? "bad" : "info") : badge("İnceleme bekliyor", "muted")),
        h("p", {}, c.text_tr),
        c.review?.status === "corrected" ? h("p", {}, h("strong", {}, "Analist düzeltmesi: "), c.review.corrected_text) : null,
        c.check_notes.filter((n: string) => !n.startsWith("denetleyici:")).map((n: string) => h("p", { class: "small" }, "⚠ ", n)),
        c.sources.length ? h("ul", {}, c.sources.map((s: Json) => h("li", {},
          badge(...(SUPPORT[s.support] ?? [s.support, "muted"]) as [string, string]), " ", artLabel(s.article_id),
          s.quote ? h("blockquote", { class: "quote", lang: undefined, dir: "auto" }, s.quote) : null,
          s.notes.map((n: string) => h("div", { class: "small" }, n))))) : h("p", { class: "small" }, "Kaynak kimliği yok."),
        reviewUi);
    }) : empty("Henüz iddia yok. Model analizi çalıştırıldığında kaynaklı iddialar burada listelenir."));
}

async function renderSearch(q: URLSearchParams) {
  const view = q.get("view") === "tr" ? "tr" : "orig";
  const toggle = h("div", { class: "seg", role: "group", "aria-label": "Görünüm" },
    h("button", { "aria-pressed": String(view === "orig"), onclick: () => { q.delete("view"); go(`#/arama?${q}`); } }, "Özgün metin"),
    h("button", { "aria-pressed": String(view === "tr"), onclick: () => { q.set("view", "tr"); go(`#/arama?${q}`); } }, "Türkçe analiz"));
  await page("Haber Arama", async () => {
    const qs = new URLSearchParams(q); qs.delete("view");
    const [d, entSel, srcs] = await Promise.all([api(`/api/articles?${qs}`), entityOptions(q.get("entity") ?? ""), api("/api/sources")]);
    const countries = [...new Set<string>(srcs.items.map((s: Json) => s.country).filter(Boolean))].sort();
    const form = filterForm("#/arama", [
      h("label", {}, "Arama", h("input", { name: "q", value: q.get("q") ?? "", placeholder: "Başlık veya metin (özgün dilde)" })),
      h("label", {}, "Dil", langSelect(q.get("lang") ?? "")),
      h("label", {}, "Ülke", h("select", { name: "country" }, h("option", { value: "" }, "Tümü"), countries.map((c) => h("option", { value: c, selected: c === q.get("country") }, c)))),
      h("label", {}, "Kaynak", h("select", { name: "source" }, h("option", { value: "" }, "Tümü"), srcs.items.map((s: Json) => h("option", { value: s.source_id, selected: s.source_id === q.get("source") }, s.name)))),
      h("label", {}, "Kişi / kurum / yer / konu", entSel),
      h("label", {}, "Başlangıç", h("input", { type: "date", name: "from", value: q.get("from") ?? "" })),
      h("label", {}, "Bitiş", h("input", { type: "date", name: "to", value: q.get("to") ?? "" })),
      h("label", {}, "Sınıf", h("select", { name: "novelty" }, h("option", { value: "" }, "Tümü"), Object.entries(NOVELTY).map(([k, [l]]) => h("option", { value: k, selected: k === q.get("novelty") }, l)))),
      view === "tr" ? h("input", { type: "hidden", name: "view", value: "tr" }) : null,
    ].filter(Boolean) as HTMLElement[]);
    const items = d.items.length ? d.items.map((a: Json) => h("article", { class: "card" },
      h("div", { class: "row" }, a.event ? nov(a.event.novelty) : badge("Olaya bağlı değil", "muted"), langBadge(a.lang, a.lang_confidence), badge(...(DATEQ[a.date_quality] ?? [a.date_quality, "muted"]) as [string, string]), a.source.unknown ? badge("Kayıtsız kaynak", "bad") : null),
      view === "orig"
        ? [orig(a.title_original, a.lang, "h3"), orig(a.snippet, a.lang, "p", "small")]
        : [h("h3", {}, a.translation_tr?.title ?? a.event?.title_tr ?? "Türkçe analiz yok"),
           h("p", { class: "small" }, a.translation_tr ? a.translation_tr.summary : "Bu haberin Türkçe çevirisi yok; olay düzeyindeki kural tabanlı başlık gösteriliyor. Özgün metin için görünümü değiştirin.")],
      h("div", { class: "meta" }, h("strong", {}, a.source.name), a.source.country || null, `Yayın: ${fmt(a.published_at)}`,
        h("a", { href: a.url, rel: "noopener noreferrer", target: "_blank" }, "Kaynak URL ↗"),
        a.event ? h("a", { href: `#/olay/${encodeURIComponent(a.event.event_id)}` }, `Olay: ${a.event.title_tr}`) : null))) : [empty("Filtrelere uyan haber yok.")];
    return h("div", {}, providerBanner(), form, h("p", { class: "meta" }, `${d.total} haber`), items);
  }, toggle);
}

async function renderEvidence() {
  await page("Kanıt ve Kaynak Laboratuvarı", async () => {
    const d = await api("/api/events?limit=100");
    const rows = await Promise.all(d.items.map(async (e: Json) => ({ e, detail: await api(`/api/events/${encodeURIComponent(e.event_id)}`) })));
    return h("div", {}, providerBanner(),
      h("p", { class: "meta" }, "Her olay için iddiaların kaynak desteği, çelişkiler ve analist inceleme durumu."),
      h("table", {}, h("thead", {}, h("tr", {}, ["Olay", "Analiz", "İddia", "Dayanaklı", "Doğrulanamadı / çelişki / kaynaksız", "İncelenen", "Kaynak farklılığı"].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows.map(({ e, detail }) => {
          const cl = detail.claims as Json[];
          const bad = cl.filter((c) => ["unverified", "contradicted", "no_source", "partially_supported"].includes(c.status)).length;
          return h("tr", {},
            h("td", {}, h("a", { href: `#/olay/${encodeURIComponent(e.event_id)}` }, e.title_tr)),
            h("td", {}, detail.analysis ? [detail.analysis.status === "ok" ? badge("var", "ok") : badge("hata", "bad"), detail.analysis.mock ? badge("MOCK", "demo") : null] : badge("yok", "muted")),
            h("td", {}, String(cl.length)),
            h("td", {}, String(cl.filter((c) => c.status === "supported").length)),
            h("td", {}, bad ? badge(String(bad), "warn") : "0"),
            h("td", {}, String(cl.filter((c) => c.review && c.review.status !== "pending").length)),
            h("td", {}, detail.conflicts.length ? detail.conflicts.map((c: Json) => badge(c.kind === "conflict" ? "Çelişki" : "Değişim", c.kind === "conflict" ? "bad" : "info")) : "—"));
        }))));
  });
}

async function renderSystem() {
  const ingestMsg = h("span", { role: "status", class: "small" });
  const actions = can("ingest") ? h("div", { class: "row" }, h("button", {
    onclick: async (e: Event) => {
      const b = e.target as HTMLButtonElement; b.disabled = true; ingestMsg.textContent = "Alım çalışıyor…";
      try { const r = await post("/api/ingest/run"); sessionStorage.setItem("sinyal_ingest_msg", `Alım tamamlandı: ${r.run.inserted} yeni, ${r.run.skipped_duplicates} tekrar atlandı.`); render(); }
      catch (err) { ingestMsg.textContent = `Alım başarısız: ${(err as Error).message}`; b.disabled = false; }
    },
  }, "Alımı şimdi çalıştır"), ingestMsg) : undefined;
  try { const m = sessionStorage.getItem("sinyal_ingest_msg"); if (m) { ingestMsg.textContent = m; sessionStorage.removeItem("sinyal_ingest_msg"); } } catch { /* depolama yok */ }
  await page("Model ve Sistem Durumu", async () => {
    const s = await api("/api/system");
    state.demo = s.data_provider.demo; state.providerState = s.data_provider.state; state.llmMock = s.llm.mock;
    const kv = (rows: Array<[string, Child]>) => h("table", {}, h("tbody", {}, rows.map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, v)))));
    return h("div", {}, providerBanner(),
      h("div", { class: "grid cols2" },
        h("div", { class: "card" }, h("h2", {}, "Sağlık kontrolleri"), kv(s.checks.map((c: Json) => [c.name, [badge(c.ok ? "Tamam" : "Sorun", c.ok ? "ok" : "bad"), " ", c.detail]]))),
        h("div", { class: "card" }, h("h2", {}, "Model sağlayıcısı"), kv([
          ["Sağlayıcı / model", [`${s.llm.provider} / ${s.llm.model} `, s.llm.mock ? badge("MOCK", "demo") : null]],
          ["Başarılı istek", String(s.llm.ok)],
          ["Hatalar", Object.entries(s.llm.errors).map(([k, v]) => `${k}: ${v}`).join(", ") || "0"],
          ["Yeniden deneme", String(s.llm.retries)],
          ["Gecikme p50 / p95", `${s.llm.latency_p50_ms ?? "—"} / ${s.llm.latency_p95_ms ?? "—"} ms`],
          ["Son başarılı", fmt(s.llm.last_ok_at)],
          ["Son hata", s.llm.last_error ?? "—"],
          ["Modele tam metin", s.llm.send_full_text ? "Evet" : "Hayır (yalnız ilk paragraf)"],
          ["Zaman aşımı / azami deneme", `${s.llm.timeout_ms} ms / ${s.llm.max_retries + 1}`],
        ])),
        h("div", { class: "card" }, h("h2", {}, "Veri sağlayıcı ve kuyruk"), kv([
          ["Sağlayıcı", [s.data_provider.provider, " ", badge(s.data_provider.state, s.data_provider.state === "ok" ? "ok" : "warn")]],
          ["Açıklama", s.data_provider.message],
          ["Depo", `${s.store.kind} — ${s.store.message}`],
          ["Alım çalışıyor", s.queue.ingest_running ? "Evet" : "Hayır"],
          ["Model kuyruğu (işlemde)", String(s.queue.llm_inflight)],
          ["Son başarılı alım", fmt(s.last_successful_ingestion)],
          ["HTTP istek / 5xx / hız sınırı", `${s.http.requests} / ${s.http.errors5xx} / ${s.http.rateLimited}`],
        ]))),
      h("div", { class: "card" }, h("h2", {}, "Alım çalıştırmaları"), s.ingestion_runs.length ? h("table", {},
        h("thead", {}, h("tr", {}, ["Başlangıç", "Sağlayıcı", "Durum", "Alınan", "Yeni", "Atlanan (tekrar)", "Hata", "Mesaj"].map((t) => h("th", {}, t)))),
        h("tbody", {}, s.ingestion_runs.map((r: Json) => h("tr", {}, h("td", {}, fmt(r.started_at)), h("td", {}, r.provider), h("td", {}, badge(r.status, r.status === "ok" ? "ok" : "warn")), h("td", {}, String(r.fetched)), h("td", {}, String(r.inserted)), h("td", {}, String(r.skipped_duplicates)), h("td", {}, String(r.errors)), h("td", {}, r.message)))))
        : empty("Henüz alım yok.")),
      h("div", { class: "card" }, h("h2", {}, "Model analiz çalıştırmaları"), s.analysis_runs.length ? h("table", {},
        h("thead", {}, h("tr", {}, ["Zaman", "Olay", "Model", "Durum", "Deneme", "Gecikme", "İddia (dayanaklı)"].map((t) => h("th", {}, t)))),
        h("tbody", {}, s.analysis_runs.map((r: Json) => h("tr", {}, h("td", {}, fmt(r.started_at)), h("td", {}, h("a", { href: `#/olay/${encodeURIComponent(r.event_id)}` }, "aç")), h("td", {}, `${r.provider}/${r.model}`, r.mock ? [" ", badge("MOCK", "demo")] : null), h("td", {}, badge(r.status, r.status === "ok" ? "ok" : "bad"), r.error ? ` ${r.error}` : null), h("td", {}, String(r.attempts)), h("td", {}, `${r.latency_ms} ms`), h("td", {}, `${r.claims_total} (${r.claims_supported})`)))))
        : empty("Henüz model analizi yok.")));
  }, actions);
}

async function renderAdmin() {
  await page("Yönetim", async () => {
    const [users, audit] = await Promise.all([api("/api/admin/users"), api("/api/admin/audit?limit=100")]);
    const msg = h("p", { role: "status", class: "small" });
    const f = {
      email: h("input", { type: "email", required: true }) as HTMLInputElement, name: h("input", {}) as HTMLInputElement,
      role: h("select", {}, ["viewer", "analyst", "admin"].map((r) => h("option", { value: r }, roleTr(r)))) as HTMLSelectElement,
      password: h("input", { type: "password", autocomplete: "new-password", minlength: 12, required: true }) as HTMLInputElement,
    };
    const form = h("form", { class: "filters", onsubmit: async (e: Event) => {
      e.preventDefault();
      try { await post("/api/admin/users", { email: f.email.value, name: f.name.value, role: f.role.value, password: f.password.value }); render(); }
      catch (err) { msg.textContent = (err as Error).message; }
    } }, h("label", {}, "E-posta", f.email), h("label", {}, "Ad", f.name), h("label", {}, "Rol", f.role), h("label", {}, "Parola (≥12)", f.password), h("button", { type: "submit" }, "Kullanıcı ekle"), msg);
    return h("div", {},
      h("div", { class: "card" }, h("h2", {}, "Kullanıcılar"), form, h("table", {}, h("thead", {}, h("tr", {}, ["E-posta", "Ad", "Rol", "Durum"].map((t) => h("th", {}, t)))),
        h("tbody", {}, users.items.map((u: Json) => h("tr", {}, h("td", {}, u.email), h("td", {}, u.name), h("td", {}, roleTr(u.role)), h("td", {}, u.disabled ? badge("Devre dışı", "bad") : badge("Etkin", "ok"))))))),
      h("div", { class: "card" }, h("h2", {}, "Denetim kayıtları"), audit.items.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Zaman", "Kullanıcı", "İşlem", "Hedef", "IP", "Sonuç", "Ayrıntı"].map((t) => h("th", {}, t)))),
        h("tbody", {}, audit.items.map((a: Json) => h("tr", {}, h("td", {}, fmt(a.ts)), h("td", { class: "mono" }, a.user_id || "—"), h("td", {}, a.action), h("td", { class: "mono" }, a.target || "—"), h("td", { class: "mono" }, a.ip), h("td", {}, badge(a.ok ? "başarılı" : "başarısız", a.ok ? "ok" : "bad")), h("td", { class: "mono" }, a.detail))))) : empty("Kayıt yok.")));
  });
}

render();
