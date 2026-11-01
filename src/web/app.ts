// SİNYAL web arayüzü — bağımlılıksız TypeScript.
// GÜVENLİK: Sunucudan gelen hiçbir metin innerHTML ile eklenmez; tüm içerik textContent ile yazılır.

import { localDayBounds, pageInfo } from "./paging.ts";
import { changeText, conflictTitle, countryName, duration, eventLine, gapLine, langName, newsKind, num, pct, sourceName, status, targetReasons, updateText, visibleChanges, weakLinkNote, when } from "./plain.ts";

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
/** Herkesin gördüğü sayfalar; teknik sayfalar rol bazlı "Yönetim" grubundadır. */
const NAV: Array<[string, string]> = [["#/panel", "Özet"], ["#/olaylar", "Olaylar"], ["#/atlas", "Yayılım"], ["#/arama", "Haber Ara"]];
const ADMIN_NAV: Array<[string, string, Array<string>]> = [
  ["#/kanit", "İddia Denetimi", ["analyst", "admin"]], ["#/sistem", "Sistem Durumu", ["admin"]], ["#/yonetim", "Kullanıcılar", ["admin"]],
];

function route(): { name: string; arg: string; query: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, "") || "panel";
  const [path, qs] = raw.split("?");
  const [name, arg] = (path ?? "").split("/");
  return { name: name || "panel", arg: decodeURIComponent(arg ?? ""), query: new URLSearchParams(qs ?? "") };
}
function go(hash: string) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener("hashchange", () => render());

function navLink(href: string, label: string, cur: string): HTMLElement {
  const active = href === "#/" + cur || (href === "#/olaylar" && cur === "olay") || (href === "#/atlas" && cur === "rapor");
  return h("a", { href, "aria-current": active ? "page" : undefined }, label);
}

function shell(title: string, content: HTMLElement, actions?: HTMLElement): HTMLElement {
  const r = route();
  const nav = h("nav", { class: "nav", "aria-label": "Ana menü" },
    h("div", { class: "brand" }, "SİNYAL"),
    h("div", { class: "brand-sub" }, "Çok dilli medya istihbaratı"),
    NAV.map(([href, label]) => navLink(href, label, r.name)),
    (() => {
      const adm = ADMIN_NAV.filter(([, , roles]) => roles.includes(state.user?.role));
      return adm.length ? [h("div", { class: "nav-group" }, "Yönetim"), adm.map(([href, label]) => navLink(href, label, r.name))] : null;
    })(),
    h("div", { class: "spacer" }),
    h("div", { class: "who" }, h("div", {}, state.user?.name ?? ""), roleTr(state.user?.role) !== state.user?.name ? h("div", {}, roleTr(state.user?.role)) : null,
      h("button", { class: "secondary", onclick: async () => { await post("/api/auth/logout").catch(() => null); state.user = null; render(); } }, "Çıkış")),
  );
  const top = h("div", { class: "top" }, h("h1", {}, title),
    state.demo ? badge("Demo veri", "demo", "Veriler kurgusaldır") : null,
    state.llmMock && state.user?.role === "admin" ? badge("Deneme modeli", "demo", "Yapay zekâ çıktıları gerçek modelden değil, deneme sağlayıcısından gelir") : null,
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
  if (state.demo) return h("div", { class: "banner demo" }, "Demo: Bu ekrandaki haberler, yayıncılar ve olaylar kurgusaldır; gerçek bir gelişmeyi temsil etmez.");
  if (state.providerState && state.providerState !== "ok") return h("div", { class: "banner warn" }, "Haber kaynağı bağlantısı henüz kurulmadı. Gösterilenler yalnız sistemde kayıtlı haberlerdir.");
  return null;
}

// ---------- Sayfalar ----------
async function render() {
  if (!state.user) {
    try { state.user = (await api("/api/auth/me")).user; } catch { /* giriş yok */ }
    if (!state.user) return renderLogin();
  }
  teardown?.(); teardown = null; // önceki ekranın kaynaklarını bırak (ör. atlasın WebGL bağlamı)
  const r = route();
  switch (r.name) {
    case "panel": return renderDashboard(r.query.get("w") === "72" ? 72 : 24);
    case "olaylar": return renderEvents(r.query);
    case "olay": return renderEvent(r.arg);
    case "yayilim": return go("#/atlas"); // eski Radar bağlantıları Yayılım sayfasına gider
    case "atlas": return renderAtlas(r.query.get("w") === "24" ? 24 : 72, r.query.get("olay") ?? "");
    case "rapor": return renderReport(r.query);
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
  const actions = h("div", { class: "row" },
    h("div", { class: "seg", role: "group", "aria-label": "Zaman aralığı" },
      h("button", { "aria-pressed": String(w === 24), onclick: () => go("#/panel") }, "Son 24 saat"),
      h("button", { "aria-pressed": String(w === 72), onclick: () => go("#/panel?w=72") }, "Son 3 gün")),
    h("button", { onclick: () => go(`#/rapor${w === 24 ? "?w=24" : ""}`) }, "Rapor indir"));
  await page("Özet", async () => {
    const [d, atlas] = await Promise.all([api(`/api/dashboard?window=${w}`), api(`/api/atlas?window=${w}`).catch(() => ({ events: [] }))]);
    state.demo = d.demo; state.providerState = d.pipeline.provider.state; state.llmMock = d.model.mock;
    const c = d.counts;
    const scope = w === 24 ? "Son 24 saatte" : "Son 3 günde";
    const changed = (atlas.events as Json[]).filter((e) => visibleChanges(e) > 0);
    const tile = (v: number, label: string, hint: string, href?: string, tone = "") =>
      h(href ? "a" : "div", { class: `tile ${tone}`, href }, h("div", { class: "v" }, num(v)), h("div", { class: "l" }, label), h("div", { class: "hint" }, hint));

    const attention = (atlas.events as Json[]).slice(0, 5);
    const watch = h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", {}, "Dikkat gerektirenler"), h("a", { href: "#/atlas" }, "Haritada izle →")),
      attention.length ? h("ul", { class: "watch" }, attention.map((e) => {
        const st = status(e.momentum.label), n = visibleChanges(e);
        return h("li", { class: n ? "hot" : "" },
          h("a", { class: "watch-title", href: `#/olay/${encodeURIComponent(e.event_id)}` }, e.title_tr || "Adlandırılmamış olay"),
          h("div", { class: "row" }, badge(st.label, st.tone, st.hint), h("span", { class: "small muted" }, eventLine(e))),
          n ? h("div", { class: "small warn-text" }, `⚠ Yayılırken ${n} kez değişti`) : null,
          e.correction ? h("div", { class: `small ${e.correction.gap.length ? "warn-text" : "ok-text"}` },
            e.correction.gap.length ? `⚠ Yalanlama, iddianın ulaştığı ${e.correction.gap.length} ülkeye ulaşmadı · ` : "✓ Yalanlama, iddianın ulaştığı tüm ülkelere ulaştı",
            e.correction.gap.length ? h("a", { href: `#/atlas?olay=${encodeURIComponent(e.event_id)}` }, "Boşluğu gör →") : null) : null);
      })) : empty(`${scope} dikkat gerektiren bir olay yok.`));

    const bars = (title: string, data: Array<[string, number]>) => {
      const max = Math.max(1, ...data.map((x) => x[1]));
      return h("div", { class: "card" }, h("h2", {}, title), data.length ? h("ul", { class: "bars" }, data.map(([k, v]) =>
        h("li", {}, h("span", { class: "bar-label" }, k), h("span", { class: "bar-track" }, h("span", { class: "bar", "data-w": Math.round((v / max) * 100) })), h("span", { class: "bar-v" }, num(v))))) : empty("Bu aralıkta veri yok."));
    };
    const langs = Object.entries<number>(d.by_lang).sort((a, b) => b[1] - a[1]).map(([k, v]) => [langName(k), v] as [string, number]);
    const sources = Object.entries<number>(d.by_source).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [sourceName(k.replace(/\s*\(kayıtsız kaynak\)$/, "")), v] as [string, number]);
    const last = d.pipeline.last_ingestion;
    const sys = state.user?.role === "admin" ? h("p", { class: "sys-line" },
      d.pipeline.healthy ? badge("Sistem sağlıklı", "ok") : badge("Sistemde dikkat gerekiyor", "warn"),
      last ? ` Son veri güncellemesi: ${when(last.finished_at)}. ` : " Henüz veri alınmadı. ",
      h("a", { href: "#/sistem" }, "Ayrıntılar →")) : null;

    const el = h("div", {}, providerBanner(),
      h("p", { class: "lead" }, `${scope} ${num(c.articles)} haber izlendi${c.new_events ? `, ${num(c.new_events)} yeni olay tespit edildi` : ""}.`),
      h("div", { class: "tiles" },
        tile(c.new_events, "Yeni olay", "İlk kez haber olan gelişmeler", "#/olaylar"),
        tile(changed.length, "Yayılırken değişen olay", "Rakamı değişen veya iddiası kesinleşen", "#/atlas", changed.length ? "bad" : ""),
        tile(c.unverified_claims, "Doğrulanmamış iddia", "“İddia edildi” diye verilen haberler", "#/arama?novelty=unverified_claim", c.unverified_claims ? "warn" : ""),
        tile(c.active_events, "Takip edilen olay", "Bu aralıkta haberi olan olaylar", "#/olaylar")),
      watch,
      h("div", { class: "grid cols2" }, bars("Haberler hangi dillerde?", langs), bars("En çok haber yapan kaynaklar", sources)),
      sys);
    // Çubuk genişlikleri CSSOM ile (CSP: inline style özniteliği kullanılmaz).
    el.querySelectorAll<HTMLElement>(".bar").forEach((b) => { b.style.width = `${Math.max(3, Number(b.dataset.w))}%`; });
    return el;
  }, actions);
}

async function entityOptions(selected: string): Promise<HTMLSelectElement> {
  const ents = await api("/api/entities").catch(() => ({ items: [] }));
  const typeTr: Record<string, string> = { person: "Kişi", org: "Kurum", place: "Yer", keyword: "Konu" };
  return h("select", { name: "entity" }, h("option", { value: "" }, "Tümü"),
    ents.items.map((e: Json) => h("option", { value: e.id, selected: e.id === selected }, `${typeTr[e.type] ?? e.type}: ${e.label}`))) as HTMLSelectElement;
}
const langSelect = (sel: string, all = "Tümü") => h("select", { name: "lang", "aria-label": "Dil" }, h("option", { value: "" }, all),
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

const PAGE_SIZE = 20;

/** Önceki/sonraki sayfalama denetimi. Filtre değişince offset sıfırlanır (form yeni sorgu üretir). */
function pager(base: string, q: URLSearchParams, total: number): HTMLElement {
  const p = pageInfo(total, Math.max(0, Number(q.get("offset")) || 0), PAGE_SIZE);
  const link = (o: number) => { const n = new URLSearchParams(q); if (o) n.set("offset", String(o)); else n.delete("offset"); return `${base}?${n}`; };
  return h("nav", { class: "row", "aria-label": "Sayfalama" },
    h("button", { class: "secondary", disabled: p.prevOffset === null, onclick: () => go(link(p.prevOffset!)) }, "← Önceki"),
    h("span", { class: "meta" }, p.outOfRange ? `Bu sayfada sonuç yok (toplam ${total}).` : total ? `${p.from}–${p.to} / ${total}${p.isLast ? " · son sayfa" : ""}` : "0 sonuç"),
    h("button", { class: "secondary", disabled: p.nextOffset === null, onclick: () => go(link(p.nextOffset!)) }, "Sonraki →"),
    p.outOfRange ? h("a", { href: link(0) }, "İlk sayfaya dön") : null);
}

/** Sade arama çubuğu: tek arama kutusu + birkaç seçim; geri kalanlar "Daha fazla filtre" altında. */
function simpleSearch(base: string, q: URLSearchParams, placeholder: string, quick: HTMLElement[], more: HTMLElement[]): HTMLElement {
  const moreOpen = more.some((el) => { const f = el.querySelector("input,select") as HTMLInputElement | null; return !!(f && f.value); });
  return h("form", {
    class: "search", role: "search",
    onsubmit: (e: Event) => {
      e.preventDefault();
      const qs = new URLSearchParams();
      for (const [k, v] of new FormData(e.target as HTMLFormElement).entries()) if (String(v).trim()) qs.set(k, String(v).trim());
      go(`${base}?${qs}`);
    },
  },
    h("div", { class: "search-main" },
      h("input", { name: "q", value: q.get("q") ?? "", placeholder, "aria-label": "Ara" }),
      quick, h("button", { type: "submit" }, "Ara"),
      [...q.keys()].some((k) => k !== "offset" && k !== "view") ? h("button", { type: "button", class: "secondary", onclick: () => go(base) }, "Temizle") : null),
    more.length ? h("details", { class: "search-more", open: moreOpen }, h("summary", {}, "Daha fazla filtre"), h("div", { class: "search-more-body" }, more)) : null);
}

async function renderEvents(q: URLSearchParams) {
  await page("Olaylar", async () => {
    const qs = new URLSearchParams(q); qs.set("limit", String(PAGE_SIZE));
    const [d, entSel] = await Promise.all([api(`/api/events?${qs}`), entityOptions(q.get("entity") ?? "")]);
    const form = simpleSearch("#/olaylar", q, "Olay ara (ör. deprem, Norvik)",
      [h("select", { name: "window", "aria-label": "Zaman" }, [["", "Tüm zamanlar"], ["24", "Son 24 saat"], ["72", "Son 3 gün"], ["168", "Son 7 gün"]].map(([v, l]) => h("option", { value: v, selected: (q.get("window") ?? "") === v }, l)))],
      [h("label", {}, "Dil", langSelect(q.get("lang") ?? "")), h("label", {}, "Kişi, kurum, yer veya konu", entSel)]);
    const list = d.items.length ? h("ul", { class: "event-list" }, d.items.map((e: Json) => h("li", {},
      h("a", { class: "event-row", href: `#/olay/${encodeURIComponent(e.event_id)}` },
        h("strong", {}, e.title_tr || "Adlandırılmamış olay"),
        h("span", { class: "small muted" }, `${num(e.article_count)} haber · ${num(e.sources)} kaynak · ${e.langs.length} dilde · Son: ${when(e.last_updated_at)}`),
        h("span", { class: "row" },
          e.novelty.significant_update ? badge(`${e.novelty.significant_update} yeni bilgi`, "ok") : null,
          e.novelty.unverified_claim ? badge(`${e.novelty.unverified_claim} doğrulanmamış iddia`, "warn") : null))))) : empty(d.total ? "Bu sayfada olay yok." : "Aramanıza uyan olay yok.");
    return h("div", {}, providerBanner(), form, h("p", { class: "count" }, `${num(d.total)} olay`), list, d.total > PAGE_SIZE ? pager("#/olaylar", q, d.total) : null);
  });
}

async function renderEvent(id: string) {
  await page("Olay", async () => {
    const [d, spread] = await Promise.all([
      api(`/api/events/${encodeURIComponent(id)}`),
      api(`/api/events/${encodeURIComponent(id)}/spread`).catch(() => null),
    ]);
    const ev = d.event;
    const analyst = can("analyze");
    const artById = new Map<string, Json>(d.articles.map((a: Json) => [a.article_id, a]));
    const artLabel = (aid: string) => { const a = artById.get(aid); return a ? sourceName(a.source.name) : aid; };
    const nSources = new Set(d.articles.map((a: Json) => a.source.id)).size;
    const corrIds = new Set<string>((spread?.correction?.nodes ?? []).map((n: Json) => n.article_id));

    // ---- Başlık ----
    const header = h("div", { class: "card event-head" },
      h("h2", {}, ev.title_tr || "Adlandırılmamış olay"),
      h("p", { class: "small muted" }, `${num(d.articles.length)} haber · ${num(nSources)} kaynak · İlk: ${when(ev.first_seen_at)} · Son: ${when(ev.last_updated_at)}`),
      h("div", { class: "row" },
        h("a", { class: "btn", href: `#/atlas?olay=${encodeURIComponent(id)}` }, "Haritada izle"),
        h("a", { class: "btn secondary", href: `#/rapor?olay=${encodeURIComponent(id)}` }, "Rapor indir")));

    // ---- Yapay zekâ özeti (varsa; yoksa yalnız analiste "oluştur") ----
    const alertBox = h("div");
    const lastFailed = d.last_run && d.last_run.status === "error" ? d.last_run : null;
    const analyzeBtn = analyst ? h("button", {
      class: d.analysis ? "secondary" : "",
      onclick: async (e: Event) => {
        const b = e.target as HTMLButtonElement; b.disabled = true; b.textContent = "Hazırlanıyor…";
        try { await post(`/api/events/${encodeURIComponent(id)}/analyze`); render(); }
        catch (err) { b.disabled = false; b.textContent = "Tekrar dene"; alertBox.replaceChildren(errorBox(err)); }
      },
    }, d.analysis ? "Özeti yenile" : "Yapay zekâ özeti oluştur") : null;
    const summary = d.analysis?.status === "ok"
      ? h("div", { class: "card" },
          h("div", { class: "card-head" }, h("h2", {}, "Özet"), d.analysis.mock ? badge("Deneme modeli", "demo", "Gerçek yapay zekâ modeli yapılandırılmadı") : badge("Yapay zekâ — doğrulama gerekir", "warn")),
          h("h3", {}, d.analysis.title_tr), h("p", {}, d.analysis.summary_tr),
          lastFailed && analyst ? h("p", { class: "small warn-text" }, `Son yenileme denemesi başarısız oldu (${when(lastFailed.started_at)}).`) : null,
          h("div", { class: "row" }, analyzeBtn), alertBox)
      : analyst ? h("div", { class: "card card-quiet" }, h("div", { class: "row" }, h("span", { class: "muted" }, lastFailed ? "Yapay zekâ özeti oluşturulamadı." : "Bu olay için henüz yapay zekâ özeti yok."), analyzeBtn), alertBox)
      : null;

    // ---- Kaynaklar ne diyor? (rakam farklılıkları) ----
    const conflicts = d.conflicts.length ? h("div", { class: "card" }, h("h2", {}, "Kaynaklar ne diyor?"),
      d.conflicts.map((c: Json) => h("div", { class: "conflict" },
        h("p", {}, h("strong", {}, conflictTitle(c.kind, c.label_tr))),
        h("ul", { class: "values" }, c.values.map((v: Json) => h("li", {},
          h("span", { class: "value" }, v.value),
          h("span", {}, `${v.article_ids.length} kaynak`, h("span", { class: "small muted" }, ` — ${v.article_ids.map(artLabel).join(", ")}`))))),
        h("p", { class: "small muted" }, "Hangisinin doğru olduğu otomatik olarak belirlenmedi.")))) : null;

    // ---- Gelişmeler ----
    const updates = (d.timeline as Json[]).filter((u) => newsKind(u.label));
    const timeline = updates.length ? h("div", { class: "card" }, h("h2", {}, "Gelişmeler"),
      h("ol", { class: "timeline" }, updates.map((u) => {
        const k = newsKind(u.label)!, a = artById.get(u.article_id);
        return h("li", {},
          h("div", { class: "row" }, badge(k.label, k.tone), h("span", { class: "small muted" }, `${when(u.created_at)} · ${a ? sourceName(a.source.name) : ""}${a?.source.country ? ", " + countryName(a.source.country) : ""}`)),
          h("div", {}, updateText(u.label, u.new_facts)));
      }))) : null;

    // ---- Haberler (sade liste; metin açılır) ----
    const news = h("div", { class: "card" }, h("h2", {}, `Haberler (${num(d.articles.length)})`),
      h("ul", { class: "news" }, d.articles.map((a: Json) => {
        const k = newsKind(a.member.novelty);
        const denial = corrIds.has(a.article_id);
        return h("li", {},
          h("div", { class: "row" },
            h("strong", {}, sourceName(a.source.name)),
            h("span", { class: "small muted" }, [a.source.country ? countryName(a.source.country) : "Bilinmeyen kaynak", langName(a.lang), when(a.published_at ?? a.first_seen_at)].join(" · ")),
            denial ? badge("Yalanlama", "ok", "Metin bir yalanlama/düzeltme içeriyor") : k ? badge(k.label, k.tone) : null),
          orig(a.title_original, a.lang, "div", "orig news-title"),
          a.translation_tr ? h("div", { class: "small" }, "Türkçesi: ", a.translation_tr.title) : null,
          h("details", {}, h("summary", {}, "Metni göster"), orig(a.body_original, a.lang, "p", "small"),
            h("a", { href: a.url, rel: "noopener noreferrer", target: "_blank" }, "Habere git ↗")));
      })));

    // ---- Kimler ve neler geçiyor? ----
    const groups: Array<[string, string]> = [["person", "Kişiler"], ["org", "Kurumlar"], ["place", "Yerler"], ["keyword", "Konular"]];
    const entities = d.entities.length ? h("div", { class: "card" }, h("h2", {}, "Kimler ve neler geçiyor?"),
      h("div", { class: "chips-groups" }, groups.map(([t, label]) => {
        const xs = d.entities.filter((e: Json) => e.type === t);
        return xs.length ? h("div", {}, h("div", { class: "small muted" }, label), h("div", { class: "chips" }, xs.map((e: Json) =>
          h("a", { class: "chip", href: `#/arama?entity=${encodeURIComponent(e.id)}`, title: e.surfaces.join(" · ") }, e.label, h("span", {}, String(e.articles.length)))))) : null;
      }))) : null;

    // ---- Teknik ayrıntılar (yalnız analist/yönetici) ----
    const tech = analyst ? h("details", { class: "card tech" }, h("summary", {}, "Teknik ayrıntılar (analist için)"),
      h("p", { class: "meta" }, h("span", { class: "mono" }, ev.event_id), "Başlık kural tabanlıdır (sözlükteki konu ve yerlerden üretilir)."),
      d.claims.length ? null : h("p", { class: "meta" }, "İddia denetimi için yapay zekâ özeti gerekir."),
      h("table", {}, h("thead", {}, h("tr", {}, ["Kaynak", "Sınıf", "Eşleşme", "Tarih", "Dil güveni", "Gerekçe"].map((t) => h("th", {}, t)))),
        h("tbody", {}, d.articles.map((a: Json) => h("tr", {},
          h("td", {}, a.source.name, a.source.unknown ? [" ", badge("Kayıtsız", "bad")] : null),
          h("td", {}, nov(a.member.novelty)),
          h("td", {}, `${a.member.score}`, a.member.status === "uncertain" ? [" ", badge("belirsiz", "warn")] : null),
          h("td", {}, badge(...(DATEQ[a.date_quality] ?? [a.date_quality, "muted"]) as [string, string])),
          h("td", {}, `${Math.round(a.lang_confidence * 100)}%`),
          h("td", { class: "small" }, [
            a.member.reason.shared_entities?.length ? `Varlık: ${a.member.reason.shared_entities.join(", ")}` : "",
            a.member.reason.shared_places?.length ? `Yer: ${a.member.reason.shared_places.join(", ")}` : "",
            a.member.reason.shared_numbers?.length ? `Sayı: ${a.member.reason.shared_numbers.join(", ")}` : "",
            ...(a.member.reason.notes ?? []),
          ].filter(Boolean).join(" · ") || "—")))))) : null;

    return h("div", {}, providerBanner(), header,
      spread ? spreadSection(spread, id) : null,
      summary, d.claims.length ? claimsSection(d, artLabel) : null,
      conflicts, timeline, news, entities, tech);
  });
}

// ---------- Yayılım: analist için teknik görünüm (olay sayfasında "Teknik ayrıntılar" altında) ----------
const EDGE: Record<string, [string, string, string]> = {
  citation: ["Atıf", "info", "Metin bu yayıncıyı kaynak olarak anıyor"],
  copy: ["Kopya", "muted", "Aynı dilde neredeyse birebir metin"],
  shared_facts: ["Ortak olgu — zayıf bağ", "warn", "Yalnız ortak varlık/sayıya dayanır; aktarım kanıtlanmadı"],
};
const SEV: Record<string, string> = { high: "bad", medium: "warn", low: "muted" };
const shortSrc = (n: string) => n.replace(/^Demo\s+/, "").replace(/\s*\([^)]*\)/, "");
const rText = (r: number | null) => (r === null ? "—" : r.toFixed(2).replace(".", ","));

function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

/** Yayılım şeridi: x = zaman, satır = dil; çizgiler olası aktarımlar, renkler mutasyon önemi. */
function spreadChart(s: Json): Element {
  const nodes = s.nodes.filter((n: Json) => n.placed);
  if (!nodes.length) return empty("Kesin yayın zamanı olan haber yok; yayılım çizilemedi.");
  const langs: string[] = [...new Set<string>(nodes.map((n: Json) => n.lang))];
  const W = 960, padL = 92, padR = 70, laneH = 54, top = 26, Hh = top + langs.length * laneH + 34;
  const ts = nodes.map((n: Json) => Date.parse(n.time));
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const x = (t: number) => (t1 === t0 ? (padL + W - padR) / 2 : padL + ((t - t0) / (t1 - t0)) * (W - padL - padR));
  const y = (l: string) => top + langs.indexOf(l) * laneH + laneH / 2;
  const pos = new Map<string, [number, number]>(nodes.map((n: Json) => [n.article_id, [x(Date.parse(n.time)), y(n.lang)]]));

  const root = svg("svg", { viewBox: `0 0 ${W} ${Hh}`, class: "spread-chart", role: "img", "aria-label": "Yayılım şeridi: zaman ekseninde dillere göre haberler ve olası aktarımlar" });
  langs.forEach((l, i) => {
    root.append(svg("rect", { x: 0, y: top + i * laneH, width: W, height: laneH, class: i % 2 ? "lane alt" : "lane" }));
    root.append(svg("text", { x: 10, y: y(l) + 4, class: "lane-label" }, `${LANG_TR[l] ?? l}`));
  });
  const hours = (t1 - t0) / 3_600_000;
  const step = hours <= 12 ? 1 : hours <= 48 ? 6 : 24;
  for (let hh = 0; hh <= hours + 1e-9; hh += step) {
    const xx = x(t0 + hh * 3_600_000);
    root.append(svg("line", { x1: xx, x2: xx, y1: top, y2: Hh - 30, class: "tick" }));
    root.append(svg("text", { x: xx, y: Hh - 12, class: "tick-label", "text-anchor": "middle" }, hh === 0 ? fmt(new Date(t0).toISOString()) : `+${hh} sa`));
  }
  for (const n of nodes) {
    if (!n.parent || !pos.has(n.parent)) continue;
    const [x1, y1] = pos.get(n.parent)!, [x2, y2] = pos.get(n.article_id)!;
    const mx = (x1 + x2) / 2;
    const hasHigh = n.mutations.some((m: Json) => m.severity === "high");
    root.append(svg("path", { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, class: `edge edge-${n.edge.kind}${hasHigh ? " edge-mut" : ""}` }));
  }
  // Düğümler — aynı şeritte birbirine yakın düğümlerin etiketi sırayla alta alınır (üst üste binmesin).
  const lastX = new Map<string, number>(), below = new Map<string, boolean>();
  for (const n of nodes) {
    const [cx, cy] = pos.get(n.article_id)!;
    const near = lastX.has(n.lang) && cx - lastX.get(n.lang)! < 80;
    const down = near ? !below.get(n.lang) : false;
    lastX.set(n.lang, cx); below.set(n.lang, down);
    const sev = n.mutations.some((m: Json) => m.severity === "high") ? "high" : n.mutations.some((m: Json) => m.severity === "medium") ? "medium" : "";
    const g = svg("g", { class: `node${sev ? " node-" + sev : ""}${n.generation === 0 ? " node-root" : ""}` });
    g.append(svg("title", {}, `${n.source_name} · ${fmt(n.time)}\n${n.title}${n.mutations.length ? "\n⚠ " + n.mutations.map((m: Json) => m.text_tr).join("\n⚠ ") : ""}`));
    if (n.generation === 0) g.append(svg("circle", { cx, cy, r: 12, class: "ring" }));
    g.append(svg("circle", { cx, cy, r: 7 }));
    g.append(svg("text", { x: cx, y: down ? cy + 22 : cy - 13, "text-anchor": "middle", class: "node-label" }, shortSrc(n.source_name)));
    root.append(g);
  }
  return h("div", { class: "chart-wrap" }, root,
    h("div", { class: "legend small" },
      h("span", {}, h("i", { class: "lg lg-root" }), "İlk görülen / bağımsız giriş"),
      h("span", {}, h("i", { class: "lg lg-high" }), "Yüksek önemli mutasyon"),
      h("span", {}, h("i", { class: "lg lg-cite" }), "Atıf"),
      h("span", {}, h("i", { class: "lg lg-copy" }), "Kopya"),
      h("span", {}, h("i", { class: "lg lg-weak" }), "Zayıf bağ")));
}

function spreadTree(s: Json): HTMLElement {
  const byId = new Map<string, Json>(s.nodes.map((n: Json) => [n.article_id, n]));
  const item = (n: Json): HTMLElement => h("li", {},
    h("div", { class: "row" },
      badge(n.generation === 0 ? "Kök" : `${n.generation}. nesil`, n.generation === 0 ? "info" : "muted"),
      h("strong", {}, n.source_name), langBadge(n.lang), n.country ? h("span", { class: "meta" }, n.country) : null,
      h("span", { class: "meta" }, fmt(n.time)),
      n.edge ? badge(EDGE[n.edge.kind]![0], EDGE[n.edge.kind]![1], `${EDGE[n.edge.kind]![2]} · puan ${n.edge.score} (sezgisel)`) : null,
      n.hedges.length ? badge("Teyitsizlik ifadesi var", "muted", n.hedges.join(", ")) : null),
    orig(n.title, n.lang, "div", "orig small"),
    n.mutations.map((m: Json) => h("div", { class: `mut mut-${m.severity}` }, badge(m.severity === "high" ? "Mutasyon" : m.severity === "medium" ? "Değişim" : "Not", SEV[m.severity]), " ", m.text_tr)),
    n.edge ? h("details", {}, h("summary", {}, "Bağ gerekçesi"), h("ul", { class: "small" }, n.edge.evidence.map((e: string) => h("li", {}, e)))) : null,
    n.children.length ? h("ul", { class: "tree" }, n.children.map((c: string) => item(byId.get(c)))) : null);
  return h("ul", { class: "tree tree-root" }, s.roots.map((r: string) => item(byId.get(r))));
}

/** Olay sayfasındaki Yayılım kartı: önce herkesin anlayacağı özet, teknik ayrıntılar katlanmış bölümde. */
function spreadSection(s: Json, _eventId: string): HTMLElement {
  const first = s.nodes.find((n: Json) => n.article_id === s.first_seen);
  const st = s.stats;
  const byId = new Map<string, Json>(s.nodes.map((n: Json) => [n.article_id, n]));
  const stt = status(s.momentum.label);
  const changes = s.alerts
    .map((a: Json) => ({ a, text: changeText(a) }))
    .filter((x: Json) => x.text);
  const kpi = (v: Child, l: string, title?: string) => h("div", { class: "kpi", title }, h("div", { class: "v" }, v), h("div", { class: "l" }, l));
  return h("div", { class: "card", id: "yayilim" },
    h("div", { class: "row spread-head" }, h("h2", {}, "Bu haber nasıl yayıldı?"), badge(stt.label, stt.tone, stt.hint)),
    h("dl", { class: "facts facts-inline" },
      first ? [h("dt", {}, "İlk çıktığı yer"), h("dd", {}, `${first.country ? countryName(first.country) + " — " : ""}${sourceName(first.source_name)}`, h("span", { class: "small muted" }, ` · ${when(first.time)}`))] : null,
      first?.hedges.length ? [h("dt", {}, "Nasıl başladı"), h("dd", { class: "warn-text" }, "Doğrulanmamış bir iddia olarak")] : null,
      [h("dt", {}, "Ulaştığı ülkeler"), h("dd", {}, st.countries.length ? st.countries.map(countryName).join(", ") : "—")],
      st.hours_span ? [h("dt", {}, "Süre"), h("dd", {}, duration(st.hours_span))] : null),
    changes.length ? h("div", { class: "spread-changes" }, h("h3", {}, "Yayılırken neler değişti?"),
      h("ul", {}, changes.map(({ a, text }: Json) => {
        const p = byId.get(a.parent), c = byId.get(a.article_id);
        return h("li", {}, h("strong", {}, `${sourceName(p?.source_name ?? "")} → ${sourceName(c?.source_name ?? "")}`), h("span", {}, text));
      }))) : h("p", { class: "muted small" }, "Yayılırken bilgide dikkat çeken bir değişiklik görülmedi."),
    s.gap ? gapCard(s.gap, _eventId) : null,
    !can("analyze") ? null : h("details", { class: "tech" }, h("summary", {}, "Teknik ayrıntılar (analist için)"),
      h("p", { class: "meta" }, "Bağlar otomatik çıkarımdır, kalibre edilmemiştir; kanıtlanmış kopyalama değildir."),
      h("div", { class: "grid kpis" },
        kpi(String(st.generations), "Nesil derinliği"),
        kpi(rText(st.r_estimate), "R — yayın başına aktarım", `Son ${st.censor_hours} saatten eski ${st.r_eligible} haber üzerinden; >1 büyüyen yayılım`),
        kpi(`${st.langs.length} / ${st.countries.length}`, "Dil / ülke"),
        kpi(`${s.momentum.last} / ${s.momentum.prev}`, `Son ${s.momentum.window_hours} sa / önceki`)),
      s.alerts.length ? h("ul", { class: "small" }, s.alerts.map((a: Json) => h("li", {}, badge(a.severity, SEV[a.severity]), " ", a.text_tr))) : null,
      spreadChart(s),
      spreadTree(s),
      s.notes.map((n: string) => h("p", { class: "meta" }, "ℹ ", n))));
}

/** Düzeltme boşluğu (olay sayfası): yalanlama iddianın ulaştığı yerlere ulaştı mı? */
function gapCard(g: Json, eventId: string): HTMLElement {
  const fill = h("span", { class: "gap-fill" });
  fill.style.width = `${Math.max(2, Math.round(g.coverage * 100))}%`;
  return h("section", { class: "gap" },
    h("h3", {}, "Düzeltme boşluğu"),
    h("p", { class: "gap-line" }, gapLine(g)),
    h("div", { class: "gap-bar", role: "img", "aria-label": `Yalanlama kapsaması ${pct(g.coverage)}` }, fill),
    h("p", { class: "small muted" }, `Yalanlama, iddianın ulaştığı ülkelerin ${pct(g.coverage)} kadarına ulaştı.`,
      g.first ? ` İlk yalanlama: ${countryName(g.first.cc)} — ${sourceName(g.first.source)}, ${when(g.first.time)}.` : ""),
    g.gap_langs.length ? h("p", {}, "Yalanlamanın hiç yayımlanmadığı diller: ", h("strong", {}, g.gap_langs.map(langName).join(", "))) : null,
    g.targets.length ? [h("h4", {}, "Açıklama gönderilmesi önerilen yerler"),
      h("ol", { class: "gap-targets" }, g.targets.map((t: Json) => h("li", {},
        h("strong", {}, countryName(t.cc)), ` — ${sourceName(t.source)} `, h("span", { class: "small muted" }, `(${langName(t.lang)})`),
        h("ul", { class: "small" }, targetReasons(t).map((r) => h("li", {}, r))))))] : h("p", { class: "ok-text" }, "Yalanlama, iddianın ulaştığı tüm ülkelere ulaştı."),
    g.after.length ? h("p", { class: "small warn-text" }, `⚠ İlk yalanlamadan sonra ${g.after.length} yayın iddiayı yaymaya devam etti: ${g.after.map((x: Json) => `${sourceName(x.source)} (${countryName(x.cc)})`).join(", ")}`) : null,
    h("a", { class: "btn secondary", href: `#/atlas?olay=${encodeURIComponent(eventId)}` }, "Haritada izle"));
}

let teardown: (() => void) | null = null;

const windowSeg = (base: string, w: 24 | 72, extra = "") => h("div", { class: "seg", role: "group", "aria-label": "Zaman aralığı" },
  h("button", { "aria-pressed": String(w === 24), onclick: () => go(`${base}?w=24${extra}`) }, "Son 24 saat"),
  h("button", { "aria-pressed": String(w === 72), onclick: () => go(`${base}${extra ? "?" + extra.slice(1) : ""}`) }, "Son 3 gün"));

async function renderAtlas(w: 24 | 72, initial: string) {
  const actions = h("div", { class: "row" }, windowSeg("#/atlas", w),
    h("button", { onclick: () => go(`#/rapor${w === 24 ? "?w=24" : ""}`) }, "Rapor indir"));
  await page("Yayılım", async () => {
    // Harita kütüphanesi (~1 MB) yalnız bu ekranda, ayrı parça olarak yüklenir.
    const [d, mod] = await Promise.all([api(`/api/atlas?window=${w}`), import("./atlas.ts")]);
    state.demo = d.demo;
    const holder = h("div", {}, loading());
    const wrap = h("div", {}, providerBanner(), holder);
    // Harita kapsayıcısı DOM'a eklendikten SONRA kurulmalı (aksi halde tuval boyutu 0 okunur).
    requestAnimationFrame(async () => {
      try {
        const dispose = await mod.mountAtlas(holder, d, {
          h, badge, initial,
          onReport: (id) => go(`#/rapor?olay=${encodeURIComponent(id)}${w === 24 ? "&w=24" : ""}`),
        });
        if (route().name === "atlas") teardown = dispose; else dispose();
      } catch (e) { holder.replaceChildren(errorBox(e)); }
    });
    return wrap;
  }, actions);
}

// ---------- Rapor (PDF) ----------
/**
 * Yazdırılabilir yayılım raporu. "PDF olarak indir" tarayıcının yazdırma penceresini açar (Hedef: PDF olarak kaydet).
 * Neden sunucuda PDF üretilmiyor: Arapça/Farsça metin şekillendirme ve Türkçe karakterler için yazı tipi gömme ek
 * bağımlılık ister; tarayıcı bunları zaten doğru çizer. Harita görüntüleri ekran dışı haritadan PNG olarak alınır.
 */
async function renderReport(q: URLSearchParams) {
  const w: 24 | 72 = q.get("w") === "24" ? 24 : 72;
  const only = q.get("olay") ?? "";
  const pdfBtn = h("button", { disabled: true }, "Hazırlanıyor…") as HTMLButtonElement;
  const back = h("button", { class: "secondary", onclick: () => go(`#/atlas${only ? `?olay=${encodeURIComponent(only)}` : ""}`) }, "← Geri");
  const actions = h("div", { class: "row no-print" }, back, pdfBtn);
  await page("Rapor", async () => {
    const [d, dash, mod] = await Promise.all([api(`/api/atlas?window=${w}`), api(`/api/dashboard?window=${w}`), import("./atlas.ts")]);
    state.demo = d.demo;
    const all: Json[] = d.events;
    const events = only ? all.filter((e) => e.event_id === only) : all;
    if (!events.length) return empty("Raporlanacak olay bulunamadı.");
    const featured = only ? events : events.filter((e) => e.countries.length > 1 || visibleChanges(e) > 0).slice(0, 6);
    const others = only ? [] : events.filter((e) => !featured.includes(e));
    const changedEvents = events.filter((e) => visibleChanges(e) > 0);
    const widest = [...events].sort((a, b) => b.countries.length - a.countries.length)[0];
    const now = new Date();
    const stamp = now.toLocaleString("tr-TR", { dateStyle: "long", timeStyle: "short" });
    const scope = w === 24 ? "Son 24 saat" : "Son 3 gün";

    const imgSlot = (alt: string) => h("div", { class: "r-map" }, h("div", { class: "r-map-wait" }, "Harita hazırlanıyor…"), alt ? h("span", { hidden: true }, alt) : null);
    const slots = new Map<string, HTMLElement>();
    const gapSlots = new Map<string, HTMLElement>();
    const overviewSlot = only ? null : imgSlot("Genel yayılım haritası");

    const eventSection = (e: Json) => {
      const stt = status(e.momentum.label);
      const byId = new Map<string, Json>(e.nodes.map((n: Json) => [n.article_id, n]));
      const steps = [...e.links].sort((a: Json, b: Json) => a.time.localeCompare(b.time));
      const slot = imgSlot(e.title_tr);
      slots.set(e.event_id, slot);
      const g = e.correction;
      const gapSlot = g ? imgSlot(`${e.title_tr} düzeltme boşluğu`) : null;
      if (gapSlot) gapSlots.set(e.event_id, gapSlot);
      const gapFill = h("span", {});
      if (g) gapFill.style.width = `${Math.max(2, Math.round(g.coverage * 100))}%`;
      const gapBlock = g ? h("div", { class: "r-gap" },
        h("h3", {}, "Düzeltme boşluğu"),
        h("p", {}, h("strong", {}, gapLine(g)), ` (kapsama ${pct(g.coverage)})`),
        h("div", { class: "r-gapbar" }, gapFill),
        g.first ? h("p", {}, `İlk yalanlama: ${countryName(g.first.cc)} — ${sourceName(g.first.source)} (${when(g.first.time)}).`) : null,
        g.gap_langs.length ? h("p", {}, "Yalanlamanın hiç yayımlanmadığı diller: ", h("strong", {}, g.gap_langs.map(langName).join(", ")), ".") : null,
        gapSlot,
        h("p", { class: "r-caption" }, "Yeşil: yalanlamanın ulaştığı ülkeler. Turuncu: iddianın ulaşıp yalanlamanın ulaşmadığı ülkeler."),
        g.targets.length ? [h("h3", {}, "Açıklama gönderilmesi önerilen yerler"),
          h("table", { class: "r-steps" },
            h("thead", {}, h("tr", {}, h("th", {}, "Öncelik"), h("th", {}, "Ülke"), h("th", {}, "Kaynak (dil)"), h("th", {}, "Neden"))),
            h("tbody", {}, g.targets.map((t: Json, i: number) => h("tr", {},
              h("td", {}, String(i + 1)), h("td", {}, countryName(t.cc)),
              h("td", {}, sourceName(t.source), h("div", { class: "r-sub" }, langName(t.lang))),
              h("td", {}, targetReasons(t).join(" "))))))] : h("p", {}, "Yalanlama, iddianın ulaştığı tüm ülkelere ulaştı."),
        g.after.length ? h("p", { class: "r-callout" }, `İlk yalanlamadan sonra ${g.after.length} yayın iddiayı yaymaya devam etti: ${g.after.map((x: Json) => `${sourceName(x.source)} (${countryName(x.cc)})`).join(", ")}.`) : null) : null;
      return h("section", { class: "r-event" },
        h("h2", {}, e.title_tr || "Adlandırılmamış olay"),
        h("p", { class: "r-status" }, h("span", { class: `r-chip r-${stt.tone}` }, stt.label), " ", stt.hint),
        e.first?.hedged ? h("p", { class: "r-callout" }, "Bu haber ilk olarak doğrulanmamış bir iddia olarak ortaya çıktı.") : null,
        h("table", { class: "r-facts" }, h("tbody", {},
          e.first ? h("tr", {}, h("th", {}, "İlk çıktığı yer"), h("td", {}, `${countryName(e.first.cc)} — ${sourceName(e.first.source)} (${when(e.first.time)})`)) : null,
          h("tr", {}, h("th", {}, "Ulaştığı ülkeler"), h("td", {}, `${e.countries.length}: ${e.countries.map(countryName).join(", ")}`)),
          e.hours_span ? h("tr", {}, h("th", {}, "Süre"), h("td", {}, duration(e.hours_span))) : null,
          h("tr", {}, h("th", {}, "Yayılırken değişiklik"), h("td", {}, visibleChanges(e) ? `${visibleChanges(e)} kez` : "Görülmedi")),
          g ? h("tr", {}, h("th", {}, "Yalanlama"), h("td", {}, `${g.covered.length} / ${g.claim_countries.length} ülkeye ulaştı (${pct(g.coverage)})`)) : null)),
        slot,
        steps.length ? [h("h3", {}, "Nasıl yayıldı?"),
          h("table", { class: "r-steps" },
            h("thead", {}, h("tr", {}, h("th", {}, "Zaman"), h("th", {}, "Nereden"), h("th", {}, "Nereye"), h("th", {}, "Not"))),
            h("tbody", {}, steps.map((l: Json) => {
              const a = byId.get(l.from), b = byId.get(l.to);
              const notes = l.changes.map(changeText).filter(Boolean) as string[];
              return h("tr", { class: notes.length ? "r-changed" : "" },
                h("td", { class: "r-nowrap" }, when(l.time)),
                h("td", {}, countryName(l.from_cc), h("div", { class: "r-sub" }, sourceName(a?.source ?? ""))),
                h("td", {}, countryName(l.to_cc), h("div", { class: "r-sub" }, sourceName(b?.source ?? ""))),
                h("td", {}, notes.length ? notes.join(" ") : null, weakLinkNote(l.kind) ? h("div", { class: "r-sub" }, weakLinkNote(l.kind)) : null, !notes.length && !weakLinkNote(l.kind) ? "—" : null));
            })))] : null,
        gapBlock);
    };

    const report = h("article", { class: "report" },
      h("header", { class: "r-head" },
        h("div", { class: "r-brand" }, "SİNYAL"),
        h("h1", {}, only ? events[0].title_tr : "Durum Raporu"),
        h("p", { class: "r-meta" }, `${only ? "Olay raporu" : "Kapsam: " + scope} · Hazırlanma: ${stamp} · Hazırlayan: ${state.user?.name ?? ""}`)),
      d.demo ? h("p", { class: "r-demo" }, "Bu rapordaki haberler, yayıncılar ve olaylar kurgusal demo verisidir; gerçek bir gelişmeyi temsil etmez.") : null,
      only ? null : h("section", { class: "r-summary" },
        h("h2", {}, "Özet"),
        h("p", {}, `${w === 24 ? "Son 24 saatte" : "Son 3 günde"} ${num(dash.counts.articles)} haber ve ${num(events.length)} olay izlendi. En geniş yayılım ${num(widest?.countries.length ?? 0)} ülkeye ulaştı.`),
        h("div", { class: "r-tiles" },
          h("div", { class: "r-tile" }, h("b", {}, num(dash.counts.new_events)), h("span", {}, "yeni olay")),
          h("div", { class: "r-tile" }, h("b", {}, num(changedEvents.length)), h("span", {}, "olayda bilgi yayılırken değişti")),
          h("div", { class: "r-tile" }, h("b", {}, num(dash.counts.unverified_claims)), h("span", {}, "doğrulanmamış iddia"))),
        h("h3", {}, "Öne çıkanlar"),
        h("ul", { class: "r-findings" }, featured.slice(0, 3).map((e) => {
          const n = visibleChanges(e);
          const gp = e.correction && e.correction.gap.length ? ` Yalanlama iddianın ulaştığı ${e.correction.claim_countries.length} ülkeden yalnız ${e.correction.covered.length} tanesine ulaştı.` : "";
          return h("li", {}, h("strong", {}, e.title_tr), ` — ${status(e.momentum.label).label}. ${eventLine(e)}.${n ? ` Yayılırken ${n} kez değişti.` : ""}${gp}`);
        })),
        overviewSlot,
        h("p", { class: "r-caption" }, "Haritada çizgiler haberin bir ülkeden diğerine aktarıldığını, kırmızı renk aktarılırken bilginin değiştiğini gösterir.")),
      featured.map(eventSection),
      others.length ? h("section", { class: "r-others" }, h("h2", {}, "Diğer olaylar"),
        h("table", { class: "r-steps" },
          h("thead", {}, h("tr", {}, h("th", {}, "Olay"), h("th", {}, "Durum"), h("th", {}, "İlk çıktığı yer"), h("th", {}, "Ülke"))),
          h("tbody", {}, others.map((e) => h("tr", {}, h("td", {}, e.title_tr), h("td", {}, status(e.momentum.label).label),
            h("td", {}, e.first ? countryName(e.first.cc) : "—"), h("td", {}, String(e.countries.length))))))) : null,
      h("footer", { class: "r-foot" },
        h("h2", {}, "Bu rapor nasıl okunur?"),
        h("ul", {},
          h("li", {}, "“İlk çıktığı yer”, SİNYAL'in bu haberi gördüğü en erken yayındır; daha önce izlenmeyen bir kaynakta çıkmış olabilir."),
          h("li", {}, "Ülkeler arası çizgiler, haberin metnindeki atıflara ve benzerliğe göre otomatik çıkarılır; kesin kopyalama kanıtı değildir."),
          h("li", {}, "“Yayılırken değişti” notları, bir yayının önceki yayından farklı bir rakam vermesini veya iddiayı kesin bilgi gibi aktarmasını gösterir."),
          h("li", {}, "“Düzeltme boşluğu”, iddianın ulaştığı ama yalanlamanın ulaşmadığı ülke ve dilleri gösterir. Yalanlama haberleri metindeki yalanlama ifadelerinden otomatik tanınır; önerilen hedefler, iddiayı o ülkeye ilk getiren kaynaklardır.")),
        h("p", { class: "r-disclaimer" }, "Bu rapor SİNYAL tarafından otomatik hazırlanmıştır. Önemli kararlardan önce analist doğrulaması önerilir.")));

    const hint = h("p", { class: "no-print report-hint" }, "“PDF olarak indir”e bastığınızda açılan pencerede Hedef olarak “PDF olarak kaydet”i seçin.");
    const wrap = h("div", { class: "report-wrap" }, hint, report);

    // Harita görüntüleri: sayfa çizildikten sonra ekran dışı haritada üretilir.
    requestAnimationFrame(async () => {
      try {
        const imgs = await mod.reportImages(d, featured.map((e) => e.event_id), !only);
        const put = (slot: HTMLElement | null | undefined, src: string | null | undefined, alt: string) => {
          if (!slot) return;
          slot.replaceChildren(src ? h("img", { src, alt }) : h("div", { class: "r-map-wait" }, "Harita oluşturulamadı."));
        };
        put(overviewSlot, imgs.overview, "Genel yayılım haritası");
        for (const e of featured) put(slots.get(e.event_id), imgs.events[e.event_id], `${e.title_tr} yayılım haritası`);
        for (const e of featured) put(gapSlots.get(e.event_id), imgs.gaps[e.event_id], `${e.title_tr} düzeltme boşluğu haritası`);
      } catch (e) {
        for (const s of [overviewSlot, ...slots.values(), ...gapSlots.values()]) s?.replaceChildren(h("div", { class: "r-map-wait" }, `Harita oluşturulamadı: ${(e as Error).message}`));
      }
      pdfBtn.disabled = false; pdfBtn.textContent = "PDF olarak indir";
    });
    const fileTitle = `SINYAL-${only ? "Olay" : "Durum"}-Raporu-${now.toISOString().slice(0, 10)}`;
    pdfBtn.onclick = () => {
      const prev = document.title;
      document.title = fileTitle; // tarayıcı PDF dosya adını sayfa başlığından önerir
      window.addEventListener("afterprint", () => { document.title = prev; }, { once: true });
      window.print();
    };
    return wrap;
  }, actions);
}

function claimsSection(d: Json, artLabel: (id: string) => string): HTMLElement {
  return h("div", { class: "card" }, h("h2", {}, "Kanıt ve kaynaklar (iddialar)"),
    h("p", { class: "meta" }, "“Kaynakta dayanağı bulundu”: alıntı kaynak metinde birebir geçiyor ve iddiadaki sayılar/adlar alıntılarda var. Bu sözcüksel bir denetimdir; doğruluk onayı değildir."),
    d.claims.length ? d.claims.map((c: Json) => {
      // Mock iddia kaynak cümlesinin kopyasıdır: sözcüksel denetimin geçmesi doğrulama sayılmaz.
      const [label, kind] = c.origin?.mock ? ["MOCK — denetim anlamlı değil", "demo"] : (CLAIM[c.status] ?? [c.status, "muted"]) as [string, string];
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
    h("button", { "aria-pressed": String(view === "orig"), onclick: () => { q.delete("view"); go(`#/arama?${q}`); } }, "Özgün dil"),
    h("button", { "aria-pressed": String(view === "tr"), onclick: () => { q.set("view", "tr"); go(`#/arama?${q}`); } }, "Türkçe"));
  await page("Haber Ara", async () => {
    const qs = new URLSearchParams(q); qs.delete("view"); qs.set("limit", String(PAGE_SIZE));
    // Tarih seçicileri kullanıcının YEREL gününü kapsar: başlangıç günün başı, bitiş günün sonu.
    for (const edge of ["from", "to"] as const) {
      const v = q.get(edge);
      const b = v ? localDayBounds(v, new Date(`${v}T12:00:00`).getTimezoneOffset()) : null;
      if (b) qs.set(edge, b[edge]); else qs.delete(edge);
    }
    const [d, entSel, srcs] = await Promise.all([api(`/api/articles?${qs}`), entityOptions(q.get("entity") ?? ""), api("/api/sources")]);
    const countries = [...new Set<string>(srcs.items.map((s: Json) => s.country).filter(Boolean))].sort((a, b) => countryName(a).localeCompare(countryName(b), "tr"));
    const kinds: Array<[string, string]> = [["significant_update", "Yeni bilgi"], ["unverified_claim", "Doğrulanmamış iddia"], ["new_event", "İlk haber"], ["uncertain_date_or_source", "Tarihi veya kaynağı belirsiz"], ["duplicate", "Tekrar haber"]];
    const form = simpleSearch("#/arama", q, "Haberlerde ara (özgün dilde de arar)",
      [langSelect(q.get("lang") ?? "", "Tüm diller"), view === "tr" ? h("input", { type: "hidden", name: "view", value: "tr" }) : null].filter(Boolean) as HTMLElement[],
      [
        h("label", {}, "Ülke", h("select", { name: "country" }, h("option", { value: "" }, "Tümü"), countries.map((c) => h("option", { value: c, selected: c === q.get("country") }, countryName(c))))),
        h("label", {}, "Kaynak", h("select", { name: "source" }, h("option", { value: "" }, "Tümü"), srcs.items.map((s: Json) => h("option", { value: s.source_id, selected: s.source_id === q.get("source") }, sourceName(s.name))))),
        h("label", {}, "Kişi, kurum, yer veya konu", entSel),
        h("label", {}, "Haber türü", h("select", { name: "novelty" }, h("option", { value: "" }, "Tümü"), kinds.map(([k, l]) => h("option", { value: k, selected: k === q.get("novelty") }, l)))),
        h("label", {}, "Başlangıç", h("input", { type: "date", name: "from", value: q.get("from") ?? "" })),
        h("label", {}, "Bitiş", h("input", { type: "date", name: "to", value: q.get("to") ?? "" })),
      ]);
    const items = d.items.length ? h("ul", { class: "news results" }, d.items.map((a: Json) => {
      const k = a.event ? newsKind(a.event.novelty) : null;
      const title = view === "orig" ? orig(a.title_original, a.lang, "div", "orig news-title") : h("div", { class: "news-title" }, a.translation_tr?.title ?? a.event?.title_tr ?? a.title_original);
      const text = view === "orig" ? orig(a.snippet, a.lang, "p", "small clamp") : h("p", { class: "small clamp" }, a.translation_tr?.summary ?? "Türkçe çevirisi henüz yok.");
      return h("li", {},
        h("div", { class: "row" },
          h("strong", {}, sourceName(a.source.name)),
          h("span", { class: "small muted" }, [a.source.country ? countryName(a.source.country) : "Bilinmeyen kaynak", langName(a.lang), when(a.published_at)].join(" · ")),
          k ? badge(k.label, k.tone) : null),
        title, text,
        h("div", { class: "row small" },
          a.event ? h("a", { href: `#/olay/${encodeURIComponent(a.event.event_id)}` }, `Olay: ${a.event.title_tr}`) : null,
          h("a", { href: a.url, rel: "noopener noreferrer", target: "_blank" }, "Habere git ↗")));
    })) : empty(d.total ? "Bu sayfada haber yok." : "Aramanıza uyan haber yok.");
    const undated = d.excluded_undated ? h("p", { class: "small muted" },
      `${num(d.excluded_undated)} haberin yayın tarihi bilinmediği için tarih filtresine girmedi.`) : null;
    return h("div", {}, providerBanner(), form, h("p", { class: "count" }, `${num(d.total)} haber`), undated, items, d.total > PAGE_SIZE ? pager("#/arama", q, d.total) : null);
  }, toggle);
}

async function renderEvidence() {
  await page("İddia Denetimi", async () => {
    const d = await api("/api/events?limit=100");
    const rows = await Promise.all(d.items.map(async (e: Json) => ({ e, detail: await api(`/api/events/${encodeURIComponent(e.event_id)}`) })));
    return h("div", {}, providerBanner(),
      h("p", { class: "muted" }, "Yapay zekâ özetlerindeki iddiaların haber metinlerinde karşılığı olup olmadığı ve analist incelemesi."),
      h("table", {}, h("thead", {}, h("tr", {}, ["Olay", "Yapay zekâ özeti", "İddia", "Kaynakta bulunan", "Sorunlu", "İncelenen", "Rakam farklılığı"].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows.map(({ e, detail }) => {
          const cl = detail.claims as Json[];
          const bad = cl.filter((c) => ["unverified", "contradicted", "no_source", "partially_supported"].includes(c.status)).length;
          return h("tr", {},
            h("td", {}, h("a", { href: `#/olay/${encodeURIComponent(e.event_id)}` }, e.title_tr)),
            h("td", {}, detail.analysis ? [detail.analysis.status === "ok" ? badge("Var", "ok") : badge("Hata", "bad"), detail.analysis.mock ? [" ", badge("Deneme", "demo")] : null] : badge("Yok", "muted")),
            h("td", {}, String(cl.length)),
            detail.analysis?.mock
              ? h("td", { colspan: "2" }, badge("Deneme modeli — sayılmadı", "demo", "Deneme modelinin iddiaları kaynak cümlesini kopyalar; denetim sonucu doğrulama değildir"))
              : [h("td", {}, String(cl.filter((c) => c.status === "supported").length)), h("td", {}, bad ? badge(String(bad), "warn") : "0")],
            h("td", {}, String(cl.filter((c) => c.review && c.review.status !== "pending").length)),
            h("td", {}, detail.conflicts.length ? detail.conflicts.map((c: Json) => badge(c.kind === "conflict" ? "Kaynaklar çelişiyor" : "Zamanla değişti", c.kind === "conflict" ? "bad" : "info")) : "—"));
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
  }, "Verileri şimdi güncelle"), ingestMsg) : undefined;
  try { const m = sessionStorage.getItem("sinyal_ingest_msg"); if (m) { ingestMsg.textContent = m; sessionStorage.removeItem("sinyal_ingest_msg"); } } catch { /* depolama yok */ }
  await page("Sistem Durumu", async () => {
    const s = await api("/api/system");
    state.demo = s.data_provider.demo; state.providerState = s.data_provider.state; state.llmMock = s.llm.mock;
    const kv = (rows: Array<[string, Child]>) => h("table", {}, h("tbody", {}, rows.map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, v)))));
    const allOk = s.checks.every((c: Json) => c.ok);
    return h("div", {}, providerBanner(),
      h("div", { class: `status-hero ${allOk ? "ok" : "bad"}` },
        h("strong", {}, allOk ? "Her şey yolunda" : "Dikkat gerektiren bir sorun var"),
        h("span", {}, `Son veri güncellemesi: ${when(s.last_successful_ingestion)}`)),
      h("details", { class: "card tech", open: !allOk }, h("summary", {}, "Teknik ayrıntılar"),
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
        h("tbody", {}, s.analysis_runs.map((r: Json) => h("tr", {}, h("td", {}, fmt(r.started_at)), h("td", {}, h("a", { href: `#/olay/${encodeURIComponent(r.event_id)}` }, "aç")), h("td", {}, `${r.provider}/${r.model}`, r.mock ? [" ", badge("MOCK", "demo")] : null), h("td", {}, badge(r.status, r.status === "ok" ? "ok" : "bad"), r.error ? ` ${r.error}` : null), h("td", {}, String(r.attempts)), h("td", {}, `${r.latency_ms} ms`), h("td", {}, r.mock ? `${r.claims_total} (MOCK — sayılmadı)` : `${r.claims_total} (${r.claims_supported})`)))))
        : empty("Henüz model analizi yok."))));
  }, actions);
}

async function renderAdmin() {
  await page("Kullanıcılar", async () => {
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
