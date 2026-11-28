// NOVA Studio · app de reservas
// Una sola página: cada pantalla es un «#hash» y se pinta en <main id="app">.
// Los datos del negocio (servicios, equipo, horario) llegan de /api/catalog.
// El panel del equipo está en panel.js y solo se descarga al entrar en #equipo.

// Versión de los archivos (la «?v=» con la que se cargó este): panel.js usa la misma.
const ASSET_V = (document.currentScript?.src.match(/[?&]v=(\d+)/) || [])[1] || "0";
let panelP = null;
function loadPanel() {
  return (panelP ||= new Promise((ok, ko) => {
    const el = document.createElement("script");
    el.src = "/panel.js?v=" + ASSET_V;
    el.onload = ok;
    el.onerror = () => {
      panelP = null;
      el.remove();
      ko(Object.assign(Error("No se ha podido abrir el panel. Revisa la conexión y prueba otra vez."), { network: true }));
    };
    document.head.append(el);
  }));
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const euro = (n) =>
  n == null
    ? L("Consultar", "Ask us")
    : LANG === "en"
      ? `€${Number.isInteger(Number(n)) ? Number(n) : Number(n).toFixed(2)}`
      : Number.isInteger(Number(n))
        ? `${Number(n)} €`
        : `${Number(n).toFixed(2).replace(".", ",")} €`;
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const shiftMonth = (key, n) => {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
};
const dayDate = (iso) => new Date(iso + "T12:00:00");
// «Ahora» en Canarias, aunque el móvil esté en hora peninsular o de otro país:
// así «hoy», el mes del calendario y lo que ya ha pasado coinciden con el salón.
const salonFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Atlantic/Canary", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const salonDate = () => {
  const p = Object.fromEntries(salonFmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
};
const fmtDay = (iso, opts) => dayDate(iso).toLocaleDateString(LOC(), opts).replace(".", "");
const longDay = (iso) => cap(fmtDay(iso, { weekday: "long", day: "numeric", month: "long" }));
const shortDay = (iso) => cap(fmtDay(iso, { weekday: "short", day: "numeric", month: "short" }));
const first = (name) => String(name || "").split(" ")[0];
const initial = (name) => esc(String(name || "N").trim().charAt(0).toUpperCase());

// ── Iconos ─────────────────────────────────────────────────────────────────
const svg = (d, cls = "") => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M12 8v13M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M16 5.5h3V7a3 3 0 0 1-3 3M8 5.5H5V7a3 3 0 0 0 3 3M12 13v4M8.5 21h7M9.5 21v-2.2c0-.9.7-1.8 2.5-1.8s2.5.9 2.5 1.8V21"/>',
  agenda: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  beard: '<path d="M5 4v5a7 7 0 0 0 14 0V4"/><path d="M8.5 13c1-.8 2.2-1.2 3.5-1.2s2.5.4 3.5 1.2M9 17.5c.9.6 1.9.9 3 .9s2.1-.3 3-.9"/>',
  star: '<path d="M12 2.5c.9 6 3.5 8.6 9.5 9.5-6 .9-8.6 3.5-9.5 9.5-.9-6-3.5-8.6-9.5-9.5 6-.9 8.6-3.5 9.5-9.5z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chat: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/><path d="M9 10.5c.3 1.6 2 3.3 3.6 3.6l1.2-1.1 1.6.8"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>',
  comb: '<rect x="3" y="5" width="18" height="5" rx="1.5"/><path d="M6 10v8M9 10v8M12 10v8M15 10v8M18 10v8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  shieldCheck: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.5 2 3 0-3-.5-5.5 1-8.5z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  userPlus: '<circle cx="10" cy="8" r="4"/><path d="M3 21c1.2-3.6 3.8-5.5 7-5.5 1.5 0 2.8.4 4 1.1M18 14v6M15 17h6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.2 3.4-5 6.5-5s5.5 1.8 6.5 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c1.8.6 3 2.2 3.5 5"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h3l8 5V4L7 9H4a1 1 0 0 0-1 1z"/><path d="M19 9a4 4 0 0 1 0 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  gem: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M12 21 8.5 9 12 3l3.5 6z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  cake: '<path d="M4 21V12a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v9M3 21h18M4 15.5c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0M12 11V7M12 3.5c.8.7 1 1.4.6 2.1"/>',
  cup: '<path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2.5c.6.8.6 1.7 0 2.5M12 2.5c.6.8.6 1.7 0 2.5"/>',
  drop: '<path d="M12 3s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
  jar: '<rect x="5" y="8" width="14" height="13" rx="3"/><path d="M6 4h12v4H6zM9 13h6"/>',
  shirt: '<path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>',
  till: '<rect x="3" y="11" width="18" height="9" rx="1"/><path d="M6 11V5h8v6"/><path d="M9 8h2"/><path d="M7 15h2M11 15h2M15 15h2"/>',
  hanger: '<path d="M12 7.5a2 2 0 1 1 2-2c0 1.2-2 1.5-2 3.2L3.5 15a1.6 1.6 0 0 0 1 2.9h15a1.6 1.6 0 0 0 1-2.9z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
};

// Dibujos de los servicios: línea fina en degradado dorado, dibujados a 32 px.
// Cada uno tiene su gesto al pasar el ratón (las tijeras cortan, la luna brilla…).
const SVC_ICONS = {
  scissors:
    '<g class="si-a"><path d="M12.4 21.2 21.6 4.2c.6-1.1 2-.6 1.6.6l-4.9 12.4-3.3 2.6"/><ellipse cx="10" cy="24.6" rx="3.9" ry="3.5" transform="rotate(-20 10 24.6)"/></g>' +
    '<g class="si-b"><path d="M19.6 21.2 10.4 4.2c-.6-1.1-2-.6-1.6.6l4.9 12.4 3.3 2.6"/><ellipse cx="22" cy="24.6" rx="3.9" ry="3.5" transform="rotate(20 22 24.6)"/></g>' +
    '<circle class="si-f" cx="16" cy="14.5" r="1.1"/>',
  beard:
    '<path class="si-f si-hair" d="M5.6 9.4C4.6 4.4 9 .6 15.4.8c2.2 0 3.6.6 4.4 1.4 1-.6 2.6-.4 3.6.6 2.4 2 3.4 4.4 3 6.6l-2.8-.2c-.2-1.6-1.2-2.6-2.6-3-2.4 1.2-6 1.4-9 .6-1.6.6-2.6 1.6-3 2.8z"/>' +
    '<path class="si-f" fill-rule="evenodd" d="M5.6 7.6h2.8c0 5.4 1.4 9.4 4 11.2 1.6-.5 5.6-.5 7.2 0 2.6-1.8 4-5.8 4-11.2h2.8c0 12-4.6 21.6-10.4 21.6S5.6 19.6 5.6 7.6zM13 21.2c1.8 1.5 4.2 1.5 6 0-1.6 2.6-4.4 2.6-6 0z"/>' +
    '<path class="si-f si-stache" d="M16 15.4c-1.8-1.7-4.6-1.8-6.4-.2-.6.5-1.4.5-1.9 0 .3 2.2 2.6 2.9 4.3 2.5 1.5-.3 2.9-.8 4-1.3 1.1.5 2.5 1 4 1.3 1.7.4 4-.3 4.3-2.5-.5.5-1.3.5-1.9 0-1.8-1.6-4.6-1.5-6.4.2z"/>',
  star:
    '<path d="M9.5 6h13l5 7L16 27 4.5 13z"/><path class="si-thin" d="M4.5 13h23M12.6 6 10.4 13 16 27l5.6-14-2.2-7M10.4 13 16 6l5.6 7"/>' +
    '<path class="si-f si-spark" d="M26 1.8c.25 1.7.7 2.15 2.4 2.4-1.7.25-2.15.7-2.4 2.4-.25-1.7-.7-2.15-2.4-2.4 1.7-.25 2.15-.7 2.4-2.4z"/>',
  moon:
    '<path class="si-moon" d="M23.6 21.2A10.2 10.2 0 1 1 13.4 6.1a8 8 0 0 0 10.2 15.1z"/>' +
    '<path class="si-f si-spark" d="M23.5 4.5c.3 2.2.9 2.8 3.1 3.1-2.2.3-2.8.9-3.1 3.1-.3-2.2-.9-2.8-3.1-3.1 2.2-.3 2.8-.9 3.1-3.1z"/>' +
    '<path class="si-f si-spark si-late" d="M27 13.2c.15 1.1.45 1.4 1.55 1.55-1.1.15-1.4.45-1.55 1.55-.15-1.1-.45-1.4-1.55-1.55 1.1-.15 1.4-.45 1.55-1.55z"/>',
  crown:
    '<g class="si-crown"><path d="M5.5 11.5 10 19l6-10.5L22 19l4.5-7.5L24.6 23H7.4z"/>' +
    '<circle class="si-f" cx="5.3" cy="10.2" r="1.4"/><circle class="si-f" cx="16" cy="6.6" r="1.5"/><circle class="si-f" cx="26.7" cy="10.2" r="1.4"/>' +
    '<path class="si-gem" d="M16 15.8l1.7 2.2-1.7 2.2-1.7-2.2z"/></g><path d="M7.6 26.5h16.8"/>',
};
// Donde se nombra la marca en grande va el logo, no la palabra escrita.
// «inv» lo pasa a blanco para fondos oscuros.
const novaLogo = (cls = "") => `<img class="nova-logo ${cls}" src="/assets/logo.png" alt="NOVA" width="410" height="145">`;
const svcIcon = (k) =>
  `<svg viewBox="0 0 32 32" class="si si-${esc(k)}" aria-hidden="true" fill="none" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${SVC_ICONS[k] || SVC_ICONS.scissors}</svg>`;
// El degradado dorado que usan esos dibujos, una sola vez en la página.
document.body.insertAdjacentHTML(
  "afterbegin",
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><linearGradient id="nova-gold" gradientUnits="userSpaceOnUse" x1="5" y1="3" x2="27" y2="29"><stop offset="0" stop-color="#fff1cf"/><stop offset=".45" stop-color="#f3cf8a"/><stop offset="1" stop-color="#c98f3e"/></linearGradient></defs></svg>',
);

// ── Estado ─────────────────────────────────────────────────────────────────
let staffHint = null; // la cuenta es de alguien del equipo que aún no ha puesto su clave
let catalog = null,
  user = null,
  memb = null, // su membresía Socio NOVA+ (cortes, días vista…), de /api/me
  staff = false,
  authCh = { email: true, phone: false, code: true }, // por defecto se entra con código; /api/me lo confirma
  draft = load("nova_draft") || {},
  calMonth = "",
  selectedDate = "",
  dayPicked = false,
  lastBooked = null,
  renderId = 0,
  lastPage = "",
  staffDay = "",
  staffMonth = "",
  cobroDay = "",
  cobroPre = "";
const availCache = new Map();
 // refresco automático de la agenda
let staffMove = ""; // cita que el equipo está cambiando de hora desde la agenda
let catalogBust = false; // tras un cambio en el panel, pedir el catálogo saltándose la caché del CDN

function load(k) {
  try {
    return JSON.parse(sessionStorage.getItem(k));
  } catch {
    return null;
  }
}
function saveDraft() {
  try {
    sessionStorage.setItem("nova_draft", JSON.stringify(draft));
  } catch {}
}

// ── Red ────────────────────────────────────────────────────────────────────
// Si la red no contesta en 15 s se corta y se dice claro qué pasa (sin conexión
// o conexión lenta). El error lleva `network` para poder reintentar, y `data`
// con lo que manda el servidor (por ejemplo, horas alternativas).
async function api(path, body, { timeout = 15000 } = {}) {
  const ctl = new AbortController(),
    timer = setTimeout(() => ctl.abort(), timeout);
  let r,
    j = {};
  try {
    r = await fetch("/api/" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      // include: la PWA instalada (iOS y Android) manda y guarda la cookie de sesión.
      credentials: "include",
      signal: ctl.signal,
    });
    j = await r.json().catch(() => ({}));
  } catch {
    const e = Error(navigator.onLine === false ? "Estás sin conexión. Revisa los datos o el wifi y prueba otra vez." : "La conexión va lenta y no ha llegado respuesta. Prueba otra vez.");
    e.network = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    const e = Error(j.error || "Algo ha fallado. Prueba otra vez.");
    e.status = r.status;
    e.data = j;
    throw e;
  }
  return j;
}
// Clave de cada intento de reserva (el servidor no la guarda dos veces).
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));
// Una sola petición aunque lo pidan varios a la vez (el arranque y la primera pantalla).
let catalogP = null;
function loadCatalog() {
  if (catalog) return Promise.resolve(catalog);
  return (catalogP ||= fetchCatalog().finally(() => (catalogP = null)));
}
async function fetchCatalog() {
  if (!catalog) {
    try {
      catalog = await api("catalog" + (catalogBust ? "?t=" + Date.now() : ""));
      catalogBust = false;
      try {
        localStorage.setItem("nova_catalog", JSON.stringify(catalog));
      } catch {}
    } catch (err) {
      // Sin red: se abre con lo último que se vio (las horas libres sí hacen falta en vivo).
      const saved = err.network && load2("nova_catalog");
      if (!saved) throw err;
      catalog = saved;
    }
    applyTheme(catalog.site?.theme);
  }
  return catalog;
}
function load2(k) {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
}
// Tema de la web (lo elige el dueño en «Web»): plata por defecto o rosa.
// Se recuerda en el móvil para pintarlo bien desde el primer instante.
function applyTheme(t) {
  const rosa = t === "rosa";
  if (rosa) document.documentElement.dataset.theme = "rosa";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem("nova_theme", rosa ? "rosa" : "plata");
  } catch {}
}
async function refreshMe() {
  try {
    const r = await api("me");
    user = r.user;
    memb = r.membership || null;
    staff = r.staff;
    staffHint = r.staffHint || null;
    authCh = r.auth || authCh;
    if (staff || staffHint) (window.requestIdleCallback || setTimeout)(() => loadPanel().catch(() => {}));
  } catch {}
}
// Horas libres de un mes ({ "2026-12-01": ["10:00", …] }). Se guardan un minuto:
// con la app abierta mucho rato no se enseñan horas que ya se ha llevado otro.
// `days.full` (no sale al recorrer el objeto): días completos donde pedir aviso.
// El equipo ve también los días de antes de la fecha de apertura (paso desde Booksy).
function getAvail(service, provider, month) {
  const k = `${service}|${provider}|${month}|${staff ? 1 : 0}`,
    hit = availCache.get(k);
  if (!hit || Date.now() - hit.at > 60000) {
    const p = api(`avail?service=${encodeURIComponent(service)}&provider=${encodeURIComponent(provider)}&month=${month}${staff ? "&staff=1" : ""}`).then((r) =>
      Object.defineProperty(r.days, "full", { value: new Set(r.full || []), enumerable: false }),
    );
    p.catch(() => availCache.delete(k));
    availCache.set(k, { p, at: Date.now() });
  }
  return availCache.get(k).p;
}
// Al volver a la app tras más de un minuto fuera, el calendario se vuelve a pedir.
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return void (hiddenAt = Date.now());
  if (hiddenAt && Date.now() - hiddenAt > 60000) {
    availCache.clear();
    if (["time", "move"].includes(document.body.dataset.page) || (location.hash === "#equipo" && !$(".sheet-back"))) render();
  }
});
const svcById = (id) => catalog?.services.find((s) => s.id === id);
// «Sin preferencia»: la primera hora libre de cualquiera del equipo.
const ANY = {
  id: "any",
  get name() {
    return L("Sin preferencia", "No preference");
  },
  get role() {
    return L("El primero que esté libre", "Whoever is free first");
  },
};
const provById = (id) => (id === "any" ? ANY : catalog?.providers.find((p) => p.id === id));
const wa = (text) => `https://wa.me/${catalog.business.whatsapp}?text=${encodeURIComponent(text)}`;

// ── Piezas comunes ─────────────────────────────────────────────────────────
function toast(text) {
  const n = $("#notice");
  n.textContent = text;
  n.classList.add("visible");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => n.classList.remove("visible"), 4200);
}
const heading = (title, sub = "") => `<div class="heading"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>`;
const back = (to, label) => `<a class="back-link" href="#${to}">← ${tx(label)}</a>`;
const face = (p, cls = "face") =>
  p?.id === "any"
    ? `<span class="${cls} face-any" aria-hidden="true">${svg(ICONS.users)}</span>`
    : (p = p && !p.image ? provById(p.id) || p : p)?.image ? `<img class="${cls}" src="${esc(p.image)}" alt="">` : `<span class="${cls}" aria-hidden="true">${initial(p?.name)}</span>`;
const legalLinks = () =>
  `<div class="legal-links" role="navigation" aria-label="Información legal"><a href="#privacidad">Privacidad</a><span>·</span><a href="#condiciones">Condiciones</a><span>·</span><a href="#cookies">Cookies</a><span>·</span><a href="#aviso-legal">Aviso legal</a><span>·</span><a href="#equipo">Equipo</a></div>`;
function onForm(id, fn) {
  const f = document.getElementById(id);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = f.querySelector("[type=submit]");
    if (btn) btn.disabled = true;
    try {
      await fn(Object.fromEntries(new FormData(f)), f);
    } catch (err) {
      toast(err.message);
    } finally {
      if (btn && document.body.contains(btn)) btn.disabled = false;
    }
  });
}
function untilLabel(iso) {
  const today = salonDate();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((dayDate(iso) - today) / 86400000);
  const w = Math.round(days / 7);
  return days <= 0
    ? L("Hoy", "Today")
    : days === 1
      ? L("Mañana", "Tomorrow")
      : days < 7
        ? L(`En ${days} días`, `In ${days} days`)
        : L(`En ${w} ${w === 1 ? "semana" : "semanas"}`, `In ${w} ${w === 1 ? "week" : "weeks"}`);
}
function sheet(html) {
  const back = document.createElement("div");
  back.className = "sheet-back";
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button type="button" class="sheet-close" aria-label="Cerrar">×</button>${html}</div>`;
  const close = () => back.remove();
  back.addEventListener("click", (e) => e.target === back && close());
  back.querySelector(".sheet-close").onclick = close;
  document.body.append(back);
  return { el: back.querySelector(".sheet"), close };
}

// ── Navegación ─────────────────────────────────────────────────────────────
function nav() {
  const item = (to, label, icon) => `<a href="#${to}" data-sect="${to}" aria-label="${label}"><span class="nav-ic">${icon}</span><span class="nav-lb">${label}</span></a>`;
  const me = user?.photo
    ? `<img class="nav-initial" src="${esc(user.photo)}" alt="">`
    : user?.name
      ? `<span class="nav-initial">${initial(user.name)}</span>`
      : svg(ICONS.user);
  const acc = $("#account-link");
  acc.innerHTML = user
    ? `${user.photo ? `<img class="hdr-av" src="${esc(user.photo)}" alt="">` : `<span class="hdr-av">${initial(user.name)}</span>`}<span>Mi cuenta</span>`
    : `${svg(ICONS.user)}<span>Entrar</span>`;
  $("#book-link").textContent = L("Reservar", "Book");
  $("#nav").innerHTML =
    item("home", L("Inicio", "Home"), svg(ICONS.home)) +
    item("bookings", L("Citas", "Visits"), svg(ICONS.cal)) +
    item("rewards", L("Puntos", "Points"), svg(ICONS.gift)) +
    item("ranking", L("Ranking", "Rank"), svg(ICONS.trophy)) +
    item("profile", L("Perfil", "Profile"), me) +
    (staff || staffHint ? item("equipo", staff ? L("Agenda", "Diary") : L("Panel", "Panel"), svg(ICONS.agenda)) : "");
}
function markNav(page) {
  const sect =
    { barber: "home", time: "home", details: "home", consulta: "home", booked: "home", booking: "bookings", move: "bookings", login: "profile", code: "profile", supply: "home" }[page] || page;
  const links = $$("#nav a"),
    i = links.findIndex((a) => a.dataset.sect === sect);
  links.forEach((a) => a.classList.toggle("active", a.dataset.sect === sect));
  // La pastilla dorada se desliza hasta la sección activa.
  const n = $("#nav");
  n.style.setProperty("--n", links.length);
  n.style.setProperty("--i", Math.max(i, 0));
  n.classList.toggle("no-active", i < 0);
}

// ── Inicio ─────────────────────────────────────────────────────────────────
function serviceList() {
  const bookable = catalog.services.filter((s) => !s.consult),
    consult = catalog.services.filter((s) => s.consult);
  const row = (s) => {
    const only = s.providers?.length === 1 ? provById(s.providers[0]) : null;
    return `<a class="svc${s.consult ? " svc-wa" : ""}" href="#${s.consult ? "consulta" : "barber"}/${esc(s.id)}">
      <span class="svc-ic">${svcIcon(s.icon)}</span>
      <span class="svc-txt"><strong>${esc(s.name)}</strong>${
        s.consult
          ? `<span class="svc-dur">${svg(ICONS.chat)}Por WhatsApp</span>`
          : `<span class="svc-dur">${svg(ICONS.clock)}${s.duration} min</span>`
      }${only ? `<span class="only-tag">${L("Solo con", "Only with")} ${esc(first(only.name))}</span>` : ""}</span>
      <b class="svc-price">${s.consult && s.price ? "<small>desde</small>" : ""}${euro(s.price)}</b>
      <span class="svc-go" aria-hidden="true">›</span>
    </a>`;
  };
  return (
    `<div class="svc-list">${bookable.map(row).join("")}</div>` +
    (consult.length
      ? `<div class="svc-head"><p class="section-label">Fuera de carta</p><small>Se cuadra por WhatsApp</small></div><div class="svc-list">${consult.map(row).join("")}</div>`
      : "")
  );
}

function nextApptCard(b) {
  const p = provById(b.provider.id);
  return `<a class="next-appt" href="#booking/${esc(b.id)}">
    <div class="na-top"><span class="na-live"><i></i>Reserva activa</span><span class="na-when">${esc(untilLabel(b.date))}</span></div>
    <div class="na-main">
      <div class="na-date"><small>${esc(fmtDay(b.date, { weekday: "short" }))}</small><strong>${dayDate(b.date).getDate()}</strong><small>${esc(fmtDay(b.date, { month: "short" }))}</small></div>
      <div class="na-info"><strong class="na-time">${esc(b.start)}</strong><span>${esc(b.service.name)}</span><span>${L("con", "with")} ${esc(first(b.provider.name))}</span></div>
      ${face(p, "na-face")}
    </div>
    <div class="na-foot"><span>${L("Pago en el local", "Pay at the shop")}${b.service.price ? ` · ${euro(b.service.price)}` : ""}</span><b>Ver mi cita ›</b></div>
  </a>`;
}

// ── Portada ────────────────────────────────────────────────────────────────
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
// Hora de Canarias, se mire desde donde se mire.
function salonNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: catalog.business.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday), min: +parts.hour * 60 + +parts.minute };
}
const hm = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
function openState() {
  const W = catalog.business.week;
  if (!W) return null;
  const { wd, min } = salonNow();
  for (const [a, b] of W[wd] || []) if (min >= hm(a) && min < hm(b)) return { open: true, text: L(`Abierto · hasta las ${b}`, `Open · until ${b}`) };
  for (let i = 0; i < 8; i++) {
    const d = (wd + i) % 7,
      slot = (W[d] || []).find(([a]) => i > 0 || hm(a) > min);
    if (slot)
      return {
        open: false,
        text: L(
          `Cerrado · abre ${i === 0 ? "hoy" : i === 1 ? "mañana" : "el " + DAY_NAMES[d]} a las ${slot[0]}`,
          `Closed · opens ${i === 0 ? "today" : i === 1 ? "tomorrow" : "on " + DAY_EN[d]} at ${slot[0]}`,
        ),
      };
  }
  return null;
}
// El primer hueco libre de todo el equipo para el servicio principal.
// El próximo hueco libre de la portada: una sola llamada, que además el CDN
// guarda 30 s (antes eran tres, una por barbero).
async function nextFreeSlot() {
  const s = svcById("corte") || catalog.services.find((x) => !x.consult);
  if (!s) return null;
  const r = await api("next?service=" + encodeURIComponent(s.id));
  const p = r.provider && provById(r.provider);
  return r.date && p ? { s, p, date: r.date, start: r.start } : null;
}
function homeHero() {
  const B = catalog.business,
      st = openState(),
      team = catalog.providers;
  return `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-media" id="hero-media">
      ${heroPicture()}
    </div>
    <div class="hero-grain" aria-hidden="true"></div>
    <div class="hero-in" id="hero-in">
      <div class="hero-copy">
        <h1 id="hero-title" class="sr-only">NOVA Studio · Barbería en Vecindario</h1>
        <div class="hero-meta">
          ${st ? `<span class="hero-chip${st.open ? " is-open" : ""}"><i></i>${esc(st.text)}</span>` : ""}
          <a class="hero-chip hero-rate" href="${esc(B.rating.url)}" target="_blank" rel="noopener noreferrer"><b>★ ${esc(B.rating.score)}</b>${B.rating.count} ${L("reseñas", "reviews")}</a>
        </div>
        <div class="hero-team">
          <span class="hero-faces">${team.map((p) => face(p, "hf")).join("")}</span>
          <span>${esc(team.map((p) => first(p.name)).join(", ").replace(/, ([^,]*)$/, L(" y $1", " and $1")))}<small>te esperan</small></span>
        </div>
      </div>
      <a class="hero-slot is-loading" id="hero-slot" href="#servicios">
        <span class="hs-txt"><small>Próximo hueco libre</small><strong id="hs-when">Buscando…</strong><span id="hs-who">&nbsp;</span></span>
        <b class="hs-go">Reservar <span aria-hidden="true">→</span></b>
      </a>
    </div>  </section>`;
}
function initHero() {
  const slot = $("#hero-slot");
  if (!slot) return;
  slot.addEventListener("click", (e) => {
    if (!slot.dataset.ready) return; // sin hueco: baja a los servicios
    e.preventDefault();
    tap();
    const { s, p, date, start } = JSON.parse(slot.dataset.ready);
    draft = { service: s, provider: p, date, start };
    calMonth = date.slice(0, 7);
    selectedDate = date;
    dayPicked = true;
    saveDraft();
    go("details");
  });
  nextFreeSlot().then(
    (b) => {
      if (!document.body.contains(slot)) return;
      slot.classList.remove("is-loading");
      if (!b) {
        $("#hs-when").textContent = "Elige tu día";
        $("#hs-who").textContent = "Mira toda la agenda";
        return;
      }
      const when = untilLabel(b.date);
      $("#hs-when").textContent = `${[L("Hoy", "Today"), L("Mañana", "Tomorrow")].includes(when) ? when : shortDay(b.date)} · ${b.start}`;
      $("#hs-who").textContent = L(`${b.s.name} con ${first(b.p.name)}`, `${tx(b.s.name)} with ${first(b.p.name)}`);
      slot.insertAdjacentHTML("afterbegin", face(b.p, "hs-face"));
      slot.dataset.ready = JSON.stringify({ s: b.s.id, p: b.p.id, date: b.date, start: b.start });
    },
    () => slot.classList.remove("is-loading"),
  );
}
function teamBlock() {
  const team = catalog.providers;
  return `<section class="home-block team-block" aria-labelledby="team-title">
    <p class="eyebrow">El equipo</p>
    <h2 id="team-title">Manos que <em class="serif">marcan estilo.</em></h2>
    <div class="team-row">${team
      .map(
        (p) => `<a class="mate" href="#time/${esc(p.id)}" data-pid="${esc(p.id)}">
          <span class="mate-photo">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="600" height="800">` : `<b>${initial(p.name)}</b>`}</span>
          <span class="mate-name">${esc(first(p.name))}</span><span class="mate-role">${esc(p.role.split("·").pop().trim())}</span>
        </a>`,
      )
      .join("")}</div>
  </section>`;
}
// Vibración cortita al tocar algo importante (solo Android la nota).
const tap = () => {
  try {
    navigator.vibrate?.(8);
  } catch {}
};

// Las últimas reseñas de la ficha de Google, tal cual las da Google (sin elegir
// las buenas). Google pide que salga el nombre de quien la escribe, con enlace a
// su perfil, y que se vea que vienen de Google Maps.
function googleReviews(list, ext) {
  if (!list?.length) return "";
  return `<div class="g-reviews" role="list">${list
    .map(
      (r) => `<figure class="g-review" role="listitem">
      <span class="g-stars" role="img" aria-label="${L(`${r.rating} de 5 estrellas`, `${r.rating} out of 5 stars`)}">${"★".repeat(r.rating)}<i>${"★".repeat(5 - r.rating)}</i></span>
      <blockquote>${esc(r.text)}</blockquote>
      <figcaption>${r.uri ? `<a href="${esc(r.uri)}" ${ext}>${esc(r.author)}</a>` : `<b>${esc(r.author)}</b>`}${r.at ? ` · <time datetime="${esc(r.at)}">${ago(r.at)}</time>` : ""}</figcaption>
    </figure>`,
    )
    .join("")}</div>
  <p class="g-attr">${L("Reseñas de Google Maps", "Reviews from Google Maps")}</p>`;
}
// «hace 3 semanas» desde una fecha AAAA-MM-DD.
function ago(iso) {
  const d = Math.max(0, Math.round((Date.parse(isoDay(salonDate())) - Date.parse(iso)) / 864e5));
  if (d < 1) return L("hoy", "today");
  const [n, es, esN, en] =
    d < 7 ? [d, "día", "días", "day"] : d < 30 ? [Math.floor(d / 7), "semana", "semanas", "week"] : d < 365 ? [Math.floor(d / 30), "mes", "meses", "month"] : [Math.floor(d / 365), "año", "años", "year"];
  return L(`hace ${n} ${n === 1 ? es : esN}`, `${n} ${en}${n === 1 ? "" : "s"} ago`);
}

function homeExtras() {
  const B = catalog.business,
    ext = 'target="_blank" rel="noopener noreferrer"';
  return `
<section class="home-block" aria-labelledby="reviews-title">
  <p class="eyebrow">Lo que dicen de nosotros</p>
  <h2 id="reviews-title">El corte se nota.<br><em class="serif">La experiencia, también.</em></h2>
  <a class="rating-card" href="${esc(B.rating.url)}" ${ext} aria-label="${L(`NOVA Studio en ${esc(B.rating.source)}: ${esc(B.rating.score)} sobre 5, ${B.rating.count} reseñas`, `NOVA Studio on ${esc(B.rating.source)}: ${esc(B.rating.score)} out of 5, ${B.rating.count} reviews`)}">
    <span class="rating-src">${esc(B.rating.source)}</span>
    <span class="rating-number">${esc(B.rating.score)}<small>/ 5</small></span>
    <span class="stars" aria-hidden="true">★★★★★</span>
    <span class="rating-count"><b data-count="${B.rating.count}">${B.rating.count}</b> ${B.rating.source === "Google" ? L("reseñas en Google", "reviews on Google") : L("reseñas verificadas", "verified reviews")} · ${esc(tx(B.drink))}</span>
  </a>
  ${googleReviews(B.rating.reviews, ext)}
  <div class="home-actions">
    <a class="btn secondary" href="${esc(B.rating.url)}" ${ext}>Leer reseñas ↗</a>
    <a class="btn secondary" href="${esc(B.instagram)}" ${ext}>Ver trabajos en Instagram ↗</a>
  </div>
</section>
<section class="home-block" aria-labelledby="location-title">
  <p class="eyebrow">Tu barbería en Vecindario</p>
  <h2 id="location-title">Nos vemos en <em class="serif">el estudio.</em></h2>
  <div class="map-frame" id="map-frame" role="region" aria-label="${L("Mapa del estudio", "Map of the studio")}"><span class="map-pin" aria-hidden="true"></span><a class="map-open" href="${esc(B.maps)}" ${ext}>Ver en Google Maps ↗</a><small class="map-attr">© <a href="https://www.openstreetmap.org/copyright" ${ext}>OpenStreetMap</a></small></div>
  <div class="visit card">
    <address><strong>${esc(B.street)}</strong><span>${esc(B.city)}</span></address>
    <div class="hours">${B.hoursText.map(([d, h]) => `<div><span>${esc(d)}</span><strong>${esc(h)}</strong></div>`).join("")}<span class="closed">${esc(B.closedText)}</span></div>
    <a class="btn wide" href="${esc(B.maps)}" ${ext}>${svg(ICONS.pin)} Cómo llegar</a>
  </div>
</section>
${galleryBlock()}
<section class="home-block" aria-labelledby="about-title">
  <p class="eyebrow">Barbería en Gran Canaria</p>
  <h2 id="about-title">Imagen <em class="serif">y estilo.</em></h2>
  <div class="about-photos">
    <figure><img src="${pic("cabina")}" alt="Barbero trabajando con un cliente" loading="lazy"><figcaption>En cabina</figcaption></figure>
    <figure><img src="${pic("acabado")}" alt="Detalle del acabado de un corte" loading="lazy"><figcaption>El acabado</figcaption></figure>
    <figure><img src="${pic("oficio")}" alt="Herramientas de barbería" loading="lazy"><figcaption>El oficio</figcaption></figure>
    <figure><img src="${pic("casa")}" alt="Espejo dorado del estudio" loading="lazy"><figcaption>La casa</figcaption></figure>
  </div>
  <p>${L(
    `Un espacio donde la barbería se encuentra con la creatividad, la moda y la cultura urbana. Hacemos <strong>corte de pelo</strong>, degradados, <strong>corte y barba</strong> y <strong>corte privado</strong> en ${esc(B.street)}, Vecindario. Reserva en segundos, sin llamar y sin descargar nada.`,
    `A space where barbering meets creativity, fashion and street culture. We do <strong>haircuts</strong>, fades, <strong>haircut &amp; beard</strong> and <strong>private haircuts</strong> at ${esc(B.street)}, Vecindario. Book in seconds, no phone call and nothing to download.`,
  )}</p>
  <ul class="about-tags" aria-label="Servicios"><li>Corte de pelo</li><li>Degradado</li><li>Corte y barba</li><li>Corte privado</li><li>Fuera de horario</li><li>VIP a domicilio</li></ul>
</section>
<div id="home-products"></div>
<section class="home-block shop-home" aria-labelledby="shop-title">
  <p class="eyebrow">${esc(catalog.shop.name)} · Clothing</p>
  <h2 id="shop-title">La ropa <em class="serif">de la casa.</em></h2>
  <div class="shop-pics">
    <figure class="shop-main"><img src="${pic("supply")}" alt="${L(`Camisetas de ${esc(catalog.shop.name)} rosas y grises`, `Pink and grey ${esc(catalog.shop.name)} T-shirts`)}" loading="lazy" width="760" height="1350"></figure>
    <figure class="shop-item"><img src="${pic("supply-rosa")}" alt="${L(`Camiseta rosa de ${esc(catalog.shop.name)} con el emblema en el pecho`, `Pink ${esc(catalog.shop.name)} T-shirt with the emblem on the chest`)}" loading="lazy" width="920" height="781"><figcaption>Camiseta · Rosa</figcaption></figure>
  </div>
  <p>${L(
    `Algodón pesado, corte boxy y el emblema de la estrella. Diseñada en el estudio. <strong>Cada euro en ropa te suma ${catalog.points.perEuro} puntos</strong> en el Club, y desde ${esc(catalog.leagues.find((lg) => lg.perks.some((p) => /%.*Supply/.test(p)))?.name || "")} tienes descuento en cada prenda.`,
    `Heavyweight cotton, boxy fit and the star emblem. Designed in the studio. <strong>Every euro spent on clothing earns you ${catalog.points.perEuro} points</strong> in the Club, and from ${esc(catalog.leagues.find((lg) => lg.perks.some((p) => /%.*Supply/.test(p)))?.name || "")} league you get a discount on every garment.`,
  )}</p>
  <div class="home-actions">
    <a class="btn" href="#supply">${L("Pedir y recoger en el estudio", "Order and pick up at the studio")}</a>
    <a class="btn secondary" href="${esc(catalog.shop.url)}" target="_blank" rel="noopener">${L("Ver la tienda", "Visit the shop")} · ${esc(catalog.shop.label)} ↗</a>
    <a class="btn secondary" href="#rewards">Cómo suma en el Club</a>
  </div>
</section>
${trainingCard()}
<footer class="home-footer">
  ${novaLogo("hf-logo inv")}
  <p class="hf-tag">Barbería · Vecindario, Gran Canaria</p>
  <span class="hf-rule" aria-hidden="true"></span>
  <div class="hf-cols">
    <div><small>Dirección</small><a href="${esc(B.maps)}" ${ext}>${esc(B.street)}<br>${esc(B.city)}</a></div>
    <div><small>Horario</small>${B.hoursText.map(([d, h]) => `<span>${esc(tx(d))} · ${esc(h)}</span>`).join("")}<span class="hf-muted">${esc(B.closedText)}</span></div>
    <div><small>Contacto</small><a href="${wa("Hola NOVA Studio 👋")}" ${ext}>WhatsApp</a><a href="${esc(B.instagram)}" ${ext}>Instagram</a><a href="${esc(catalog.shop.url)}" ${ext}>${esc(catalog.shop.name)}</a><a href="#productos">Productos</a><a href="#formacion">Formación</a></div>
  </div>
  <p class="hf-copy">© ${new Date().getFullYear()} NOVA Studio · <em class="serif">Good people, better days.</em></p>
</footer>`;
}

// ── Mapa de la portada ─────────────────────────────────────────────────────
// Mapa de verdad, en color y que se mueve con el dedo (Leaflet, servido desde
// /assets). Las piezas del mapa pasan por nuestro servidor (/api/tile), así el
// móvil no habla con nadie más. Tocar sin arrastrar abre Google Maps. Mientras
// carga (o si algo falla) se ve la imagen fija de antes y al tocarla también
// se abre Google Maps.
let leafletP = null;
function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (!leafletP)
    leafletP = new Promise((ok, ko) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/assets/leaflet/leaflet.css?v=1.9.4";
      document.head.append(css);
      const js = document.createElement("script");
      js.src = "/assets/leaflet/leaflet.js?v=1.9.4";
      js.onload = () => ok(window.L);
      js.onerror = () => ((leafletP = null), ko(Error("leaflet")));
      document.head.append(js);
    });
  return leafletP;
}
function initMap() {
  const box = $("#map-frame"),
    B = catalog.business;
  if (!box || !B.geo) return;
  const openMaps = () => window.open(B.maps, "_blank", "noopener");
  // Hasta que el mapa esté listo, tocar la imagen abre Google Maps.
  box.onclick = (e) => !box.classList.contains("live") && !e.target.closest("a") && openMaps();
  const start = async () => {
    let Lf;
    try {
      Lf = await loadLeaflet();
    } catch {
      return;
    }
    if (!document.body.contains(box) || box.classList.contains("live")) return;
    const at = [B.geo.lat, B.geo.lng];
    const holder = document.createElement("div");
    holder.className = "map-live";
    box.prepend(holder);
    const map = Lf.map(holder, {
      center: at,
      zoom: 16,
      minZoom: 13,
      maxZoom: 18,
      scrollWheelZoom: false, // en el ordenador, la rueda sigue bajando la página
      attributionControl: false,
      maxBounds: Lf.latLng(at).toBounds(24000),
      maxBoundsViscosity: 0.8,
    });
    Lf.tileLayer("/api/tile/{z}/{x}/{y}.png", { maxZoom: 18, minZoom: 13, detectRetina: false }).addTo(map);
    const pin = Lf.marker(at, {
      icon: Lf.divIcon({ className: "map-marker", html: '<span class="map-pin"></span>', iconSize: [28, 28], iconAnchor: [14, 34] }),
      keyboard: false,
      title: B.name,
    }).addTo(map);
    // «click» no salta después de arrastrar: solo un toque abre Google Maps.
    map.on("click", openMaps);
    pin.on("click", openMaps);
    box.classList.add("live");
  };
  if (!("IntersectionObserver" in window)) return start();
  const io = new IntersectionObserver(
    (en) => {
      if (en.some((x) => x.isIntersecting)) {
        io.disconnect();
        start();
      }
    },
    { rootMargin: "300px" },
  );
  io.observe(box);
}

// ── Cita: tarjetas ─────────────────────────────────────────────────────────
function bookingCard(b, now) {
  const past = b.date + " " + b.start < now,
    canceled = b.status === "canceled",
    absent = b.attendance === "absent",
    state = canceled ? ["Cancelada", "st-cancel"] : absent ? ["No vino", "st-cancel"] : past ? ["✓ Realizada", "st-done"] : [`<i class="live-dot"></i>${L("Activa", "Upcoming")} · ${untilLabel(b.date)}`, "st-ok"],
    kind = canceled || past ? "is-past" : "is-active";
  return `<a class="appt ${kind}" href="#booking/${esc(b.id)}">
    <span class="appt-date"><small>${esc(fmtDay(b.date, { month: "short" }))}</small><strong>${dayDate(b.date).getDate()}</strong><small>${esc(fmtDay(b.date, { weekday: "short" }))}</small></span>
    <span class="appt-body"><strong>${esc(b.service.name)}</strong><span>${esc(b.start)} · ${esc(b.provider.name)}</span><span class="appt-chips"><span class="appt-state ${state[1]}">${state[0]}</span>${b.membership?.included ? `<span class="appt-state st-mem">NOVA+</span>` : ""}</span></span>
  </a>`;
}
// Botón de calendario: en iPhone/Mac abre el calendario del sistema (.ics);
// en el resto, Google Calendar. Debajo, el otro por si acaso.
function calButtons(b, style = "") {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const ics = `/api/bookings/${encodeURIComponent(b.id)}/ics`,
    g = gcalLink(b);
  return (
    `<a class="btn wide secondary" style="${style}" href="${apple ? ics : g}" ${apple ? "" : 'target="_blank" rel="noopener"'}>${svg(ICONS.cal)} Añadir a mi calendario</a>` +
    `<p class="cal-alt"><a href="${apple ? g : ics}" ${apple ? 'target="_blank" rel="noopener"' : ""}>${apple ? "¿Usas Google Calendar?" : "¿Usas el calendario del iPhone u Outlook?"}</a></p>`
  );
}
function gcalLink(b) {
  const d = b.date.replace(/-/g, ""),
    t = (x) => x.replace(":", "") + "00";
  const B = catalog.business;
  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(`${b.service.name} · ${B.name}`)}` +
    `&dates=${d}T${t(b.start)}/${d}T${t(b.end)}&ctz=${encodeURIComponent(B.tz)}` +
    `&location=${encodeURIComponent(B.street + ", " + B.city)}` +
    `&details=${encodeURIComponent(L(`Con ${b.provider.name}. Referencia ${b.id}.`, `With ${b.provider.name}. Reference ${b.id}.`))}`
  );
}

// ── Pantallas ──────────────────────────────────────────────────────────────
// ── Páginas legales ────────────────────────────────────────────────────────
// Privacidad, cookies, condiciones y aviso legal. La versión que vale es la
// española; LEGAL_EN es una traducción de cortesía. Si cambia lo que hace la
// app con los datos (un proveedor nuevo, otro correo automático, otra cosa
// guardada en el móvil), hay que contarlo aquí y cambiar LEGAL_DATE.
const LEGAL_DATE = ["12 de noviembre de 2026", "12 November 2026"];
// Nombre y NIF del titular: solo para el aviso legal, no vienen en el catálogo.
let aviso = { holder: "", nif: "" };
async function loadAviso() {
  if (aviso.nif) return aviso;
  try {
    aviso = await api("legal");
  } catch {}
  return aviso;
}
const lgMail = () => `<a href="mailto:${esc(catalog.business.email)}">${esc(catalog.business.email)}</a>`;
const lgAddr = () => `${esc(catalog.business.street)}, ${esc(catalog.business.city)}`;
const lgRows = (rows) =>
  `<table class="legal-table"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("")}</tbody></table>`;
const lgGrid = (head, rows) =>
  `<div class="legal-scroll"><table class="legal-table grid"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows
    .filter(Boolean)
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
const lgDate = (en) => `<p class="legal-date">${en ? "Last updated · " + LEGAL_DATE[1] : "Última actualización · " + LEGAL_DATE[0]}</p>`;
const lgWho = (en) => {
  const B = catalog.business;
  return lgRows(
    en
      ? [
          ["Owner", esc(aviso.holder)],
          ["Tax ID (NIF)", esc(aviso.nif)],
          ["Address", lgAddr()],
          ["Phone", esc(B.phone)],
          ["Email", lgMail()],
          ["Trade name", `${esc(B.name)} (barbershop) and NOVA Supply Clothing (clothing)`],
        ]
      : [
          ["Titular", esc(aviso.holder)],
          ["NIF", esc(aviso.nif)],
          ["Domicilio", lgAddr()],
          ["Teléfono", esc(B.phone)],
          ["Correo", lgMail()],
          ["Nombre comercial", `${esc(B.name)} (barbería) y NOVA Supply Clothing (ropa)`],
        ],
  );
};

const LEGAL = {
  privacidad: [
    "Política de privacidad",
    () => `${lgDate()}
    <p>Aquí te contamos qué datos tuyos tratamos en esta app, para qué, con quién los compartimos y qué puedes hacer al respecto. Cumple con el Reglamento (UE) 2016/679 (RGPD), la Ley Orgánica 3/2018 (LOPDGDD) y la Ley 34/2002 (LSSI).</p>

    <h3>1 · Quién trata tus datos</h3>
    ${lgWho()}
    <p>Por el tamaño y el tipo de actividad no estamos obligados a tener delegado de protección de datos. Para cualquier cosa sobre tus datos, escríbenos a ${lgMail()}.</p>

    <h3>2 · Qué datos tratamos, para qué y durante cuánto tiempo</h3>
    ${lgGrid(
      ["Para qué", "Qué datos", "Base legal", "Cuánto tiempo"],
      [
        ["Crear tu cuenta y que entres en ella", "Nombre, correo, teléfono (opcional), foto de perfil (opcional) y la fecha de alta" + (authCh.code === false ? "" : ", y el código de 6 cifras que te mandamos para entrar (caduca a los 10 minutos)"), "El contrato: lo necesitamos para darte el servicio (art. 6.1.b RGPD)", "Hasta que pidas borrar la cuenta o pasen 3 años sin citas ni uso"],
        ["Gestionar tus citas", "Servicio, barbero, día y hora, cambios y cancelaciones, si viniste, lo que pagaste y cómo (efectivo, tarjeta o Bizum) y las citas periódicas si las pides", "El contrato (art. 6.1.b RGPD)", "Igual que la cuenta. Los cobros, 6 años"],
        ["Avisarte de tus citas", "Tu correo y los datos de la cita: confirmación, cambios, recordatorio el día antes y unas horas antes, y el aviso de la lista de espera si te apuntas", "El contrato (art. 6.1.b RGPD)", "Lo que dura la cita. La lista de espera se borra al pasar ese día"],
        cardOn() && ["Tarjeta en garantía y cobro de faltas", "La tarjeta la guarda Stripe, no nosotros. Nosotros solo vemos la marca, los 4 últimos números y la caducidad, además de las faltas, las cancelaciones tardías y lo que se haya cobrado o devuelto", "El contrato (art. 6.1.b RGPD) y nuestro interés legítimo en que no se pierdan huecos (art. 6.1.f)", "La tarjeta, hasta que la quites. Los cobros, 6 años"],
        ["Pedidos de NOVA Supply", "Las prendas, tallas e importe de tus pedidos para recoger en el local, su estado (pendiente, pagado, listo, entregado) y la fecha. Si pagas online, el pago lo hace Stripe: aquí solo guardamos que está pagado", "El contrato: tu pedido (art. 6.1.b RGPD) y la obligación de conservar las facturas (art. 6.1.c)", "Mientras tengas cuenta; los datos de facturación, el plazo legal"],
        ["Club NOVA", "Puntos, liga, medallas, premios canjeados, las compras de ropa de NOVA Supply que el equipo apunta a tu cuenta (fecha, importe y prendas), tu código de amigo, quién te invitó, los amigos que añades al ranking y si has pulsado «Dejar mi reseña»", "El contrato: las condiciones del Club (art. 6.1.b RGPD)", "Mientras tengas cuenta"],
        ["Ranking del Club", "Tu foto de perfil (si has puesto una), el nombre o apodo que elijas, tu liga y tus puntos ganados. Los ven los demás socios que han entrado en la app. Tus amigos te ven siempre; en el ranking de todo el Club puedes dejar de salir desde tu perfil cuando quieras", "El contrato: las condiciones del Club (art. 6.1.b RGPD)", "Mientras tengas cuenta"],
        ["Ofrecerte «tu cita de siempre»", "A partir de tu historial calculamos tu día, hora, barbero y servicio habituales y cada cuánto vienes. Se calcula en el momento y no se guarda aparte", "Interés legítimo en facilitarte la reserva (art. 6.1.f RGPD)", "Mientras tengas cuenta"],
        ["Correos comerciales nuestros: «¿cuándo vuelves?», «te echamos de menos» (a veces con una oferta) y la petición de reseña", "Nombre, correo, fecha de tu último corte y tu barbero", "Eres cliente y son servicios como los que ya usas (art. 21.2 LSSI), y nuestro interés legítimo (art. 6.1.f RGPD). Cada correo trae un enlace para darte de baja", "Hasta que te des de baja. Guardamos la baja para no volver a escribirte"],
        ["Lista de interesados en la formación", "Lo que pones en el formulario: nombre, teléfono, correo, Instagram si lo das, nivel, preferencias y mensaje", "Tu consentimiento (art. 6.1.a RGPD)", "2 años desde el último contacto, o hasta que lo retires"],
        ["Facturación y contabilidad", "Los cobros: fecha, importe, forma de pago y servicio o prenda", "Obligación legal (art. 6.1.c RGPD)", "6 años (Código de Comercio y normativa fiscal)"],
        ["Copias de seguridad", "Una copia de los datos de la app que se manda cada semana al correo del titular", "Interés legítimo en no perder las citas (art. 6.1.f RGPD)", "1 año"],
        ["Responderte si nos escribes", "Lo que nos cuentes por correo o WhatsApp", "Tu consentimiento o nuestro interés legítimo en atenderte", "1 año desde el último mensaje"],
        ["Que la app funcione y esté segura", "Registros del servidor: dirección IP, navegador y páginas pedidas", "Interés legítimo en la seguridad (art. 6.1.f RGPD)", "Lo que los guarde el proveedor de alojamiento"],
      ],
    )}
    <p><b>Sobre «tu cita de siempre» y «te echamos de menos».</b> Es un análisis sencillo de tu historial (cada cuánto vienes y cuándo te toca) que solo sirve para recordarte el corte y ofrecerte la hora que sueles coger. No tomamos decisiones automáticas que te afecten de forma importante. Cobrar una falta lo decide siempre una persona, nunca la app. Puedes oponerte a este análisis y a los correos comerciales cuando quieras.</p>
    <p>No vendemos tus datos ni compramos listas. Todos los datos nos los das tú, salvo las compras de ropa y los cobros, que apunta el equipo cuando pagas en el estudio.</p>

    <h3>3 · Quién del equipo ve tus datos</h3>
    <p>${esc(aviso.holder)}, como titular, puede verlo todo. Cada barbero, que es trabajador del estudio, ve las citas y los datos de contacto de quienes atiende, y le llega un aviso con tu nombre, el servicio y la hora a su correo y al calendario de su móvil. La tableta de caja solo ve los cobros del día y la agenda (nombre, servicio y hora, sin teléfono ni correo). Todo el equipo tiene deber de confidencialidad.</p>

    <h3>4 · Con quién los compartimos</h3>
    <p>Para funcionar nos apoyamos en estos proveedores. Tratan los datos por encargo nuestro y solo para lo que les pedimos:</p>
    ${lgGrid(
      ["Proveedor", "Para qué", "Dónde están los datos"],
      [
        ["Vercel Inc. (EE. UU.)", "Alojar la app y ejecutar el servidor", "Unión Europea y EE. UU."],
        ["Upstash Inc.", "La base de datos: cuentas, citas, Club y cobros", "Reino Unido (Londres)"],
        ["Resend Inc. (EE. UU.)", "Enviar los correos de la app desde la dirección de NOVA", "EE. UU."],
        cardOn() && ["Stripe Payments Europe Ltd. (Irlanda)", "Guardar tu tarjeta y hacer los cobros por faltas. Stripe es responsable de cumplir sus propias obligaciones como entidad de pago", "Unión Europea y EE. UU."],
        ["Google Ireland Ltd.", "Nuestro correo (Gmail), donde recibimos tus respuestas, los avisos y las copias de seguridad. Y el calendario de Google si el barbero lo usa para ver su agenda", "Unión Europea y EE. UU."],
        ["Apple Distribution International (Irlanda)", "El calendario de iCloud, si el barbero lo usa para ver su agenda", "Unión Europea y EE. UU."],
        ["WhatsApp Ireland Ltd. (Meta)", "Hablar contigo cuando nos escribes o te escribimos por WhatsApp", "Unión Europea y EE. UU."],
      ],
    )}
    <p>Si pulsas un enlace a Booksy, Google Reseñas, Instagram o WhatsApp, sales de la app y se aplica la política de ese sitio. También podemos tener que dar datos a la Administración cuando lo exija una ley: Hacienda, juzgados o fuerzas de seguridad.</p>
    <p><b>Transferencias fuera de la Unión Europea.</b> El Reino Unido cuenta con una decisión de adecuación de la Comisión Europea: protege los datos de forma equivalente a la UE. Los envíos a EE. UU. se amparan en el Marco de Privacidad de Datos UE-EE. UU., en las cláusulas contractuales tipo de la Comisión Europea o en ambos. Puedes pedirnos copia de esas garantías.</p>

    <h3>5 · Cuánto tiempo los guardamos</h3>
    <p>Lo indicado en la tabla del punto 2. Si una cuenta pasa 3 años sin citas ni uso, la borramos, y con ella los puntos del Club. Lo que una ley nos obliga a conservar, como los cobros durante 6 años, se queda bloqueado: solo se usa si lo pide la Administración o un juez.</p>

    <h3>6 · Tus derechos</h3>
    <ul>
      <li><b>Acceso:</b> saber qué datos tuyos tenemos.</li>
      <li><b>Rectificación:</b> corregir lo que esté mal. Casi todo lo puedes cambiar tú en «Perfil».</li>
      <li><b>Supresión:</b> que borremos tus datos, incluida la cuenta entera.</li>
      <li><b>Oposición:</b> a lo que hacemos por interés legítimo, como el análisis de tu historial o los correos comerciales.</li>
      <li><b>Limitación:</b> que conservemos los datos pero no los usemos.</li>
      <li><b>Portabilidad:</b> recibir tus datos en un formato que se pueda leer con un ordenador.</li>
      <li><b>Retirar tu consentimiento</b> cuando quieras, sin que afecte a lo hecho antes.</li>
    </ul>
    <p>Escríbenos a ${lgMail()} desde el correo de tu cuenta diciendo qué quieres. Es gratis y te contestamos en un mes como máximo. Para dejar de recibir correos comerciales no hace falta escribir: basta con el enlace «Darte de baja» que viene en cada uno.</p>
    <p>Si crees que no te hemos atendido bien, puedes reclamar ante la Agencia Española de Protección de Datos (C/ Jorge Juan 6, 28001 Madrid, <a href="https://www.aepd.es" target="_blank" rel="noopener">www.aepd.es</a>). Te agradecemos que antes nos lo cuentes a nosotros.</p>

    <h3>7 · Seguridad</h3>
    <p>La app funciona siempre por HTTPS. ${authCh.code === false ? "De momento se entra en tu cuenta solo con tu correo, sin contraseña ni código; cuando activemos el código por correo, te lo pediremos al entrar." : "Para entrar en tu cuenta te mandamos un código a tu correo."} Cada persona del equipo entra con su propio PIN, que se guarda cifrado.${cardOn() ? " Los números de tu tarjeta van directamente de tu móvil a Stripe y nunca pasan por nuestro servidor." : ""} Las claves de los servicios están en el servidor, nunca en la app. Si hubiera una brecha de seguridad que pudiera afectarte, te avisaríamos y lo comunicaríamos a la AEPD como manda la ley.</p>

    <h3>8 · Menores</h3>
    <p>Para tener cuenta hay que tener al menos 14 años. Si quieres reservar para un menor de 14, hazlo desde tu cuenta: la cita queda a tu nombre y eres tú quien responde de ella. Si descubrimos una cuenta de un menor de 14 sin permiso de sus padres o tutores, la borramos.</p>

    <h3>9 · Cookies</h3>
    <p>Solo usamos lo necesario para que la app funcione: nada de analítica ni publicidad. Lo tienes con detalle en la <a href="#cookies">política de cookies</a>.</p>

    <h3>10 · Cambios</h3>
    <p>Si cambiamos esta política, actualizaremos la fecha de arriba. Si el cambio te afecta de verdad, por ejemplo si empezamos a usar tus datos para algo nuevo, te avisaremos por correo antes de aplicarlo.</p>`,
  ],

  cookies: [
    "Política de cookies",
    () => `${lgDate()}
    <h3>1 · Qué son</h3>
    <p>Una cookie es un archivo pequeño que una web guarda en tu dispositivo. El artículo 22.2 de la LSSI obliga a pedirte permiso antes de usarlas, salvo las que son estrictamente necesarias para darte el servicio que pides. La misma regla vale para otras formas de guardar datos en el navegador, como el almacenamiento local.</p>

    <h3>2 · Qué guarda esta app en tu dispositivo</h3>
    <p>Solo lo necesario para que funcione y para recordar lo que tú eliges. Por eso no te mostramos ningún cartel de cookies: la ley no lo exige para estas.</p>
    ${lgGrid(
      ["Nombre", "Qué es", "Para qué", "Cuánto dura"],
      [
        ["nova_s", "Cookie propia", "Mantener tu sesión iniciada para que no tengas que volver a entrar", "1 año, y se renueva cada vez que abres la app. Se borra al cerrar sesión"],
        ["nova_staff", "Cookie propia", "Mantener abierta la sesión del panel. Solo existe en los dispositivos del equipo", "1 año"],
        ["nova_lang, nova_theme", "Almacenamiento local", "Recordar el idioma y la apariencia que eliges", "Hasta que los borres"],
        ["nova_catalog", "Almacenamiento local", "Una copia de los servicios y precios para que la app abra rápido. No contiene datos tuyos", "Hasta que lo borres"],
        ["nova_ref", "Almacenamiento local", "El código del amigo que te invitó, si entras por su enlace, para sumarle los puntos", "Hasta que te registres o lo borres"],
        ["nova_seen_…", "Almacenamiento local", "Las medallas y ligas que ya te hemos celebrado, para no repetir la animación. El nombre incluye tu correo", "Hasta que lo borres"],
        ["nova_train", "Almacenamiento local", "Tu nombre y la fecha, si te apuntaste a la formación, para mostrarte que ya estás en la lista", "Hasta que lo borres"],
        ["nova_staff_who", "Almacenamiento local", "El último barbero elegido en la caja. Solo en dispositivos del equipo", "Hasta que lo borres"],
        ["nova_install", "Almacenamiento local", "Recordar si ya te ofrecimos instalar la app, o si la instalaste, para no volver a preguntarte en un mes", "Hasta que lo borres"],
        ["nova_draft, nova_next, nova_splash", "Almacenamiento de sesión", "La cita que estás reservando, a qué pantalla volver después de entrar y no repetir la animación de inicio", "Se borran al cerrar la pestaña"],
        ["Caché de la app", "Service worker", "Guardar los archivos de la app (diseño, letras, iconos) para que abra rápido y también sin conexión. No contiene datos tuyos", "Hasta la siguiente versión de la app"],
        cardOn() && ["__stripe_mid, __stripe_sid", "Cookies de Stripe", "Prevenir el fraude cuando añades una tarjeta. Solo aparecen en ese momento y son necesarias para el pago", "1 año y 30 minutos"],
      ],
    )}

    <h3>3 · Lo que no usamos</h3>
    <ul>
      <li>Ni Google Analytics ni ninguna otra analítica.</li>
      <li>Ni publicidad ni píxeles de redes sociales.</li>
      <li>Nada que te siga por otras webs.</li>
    </ul>
    <p>Las tipografías están alojadas en nuestro propio servidor, así que tampoco se conecta nadie más para cargarlas.</p>

    <h3>4 · El mapa y los enlaces externos</h3>
    <p>El mapa de la portada (con datos de © OpenStreetMap) <b>se sirve desde nuestro propio servidor</b>: las piezas del mapa las pedimos nosotros a OpenStreetMap y te las damos ya guardadas, así que verlo y moverlo no conecta tu móvil con nadie más. Si lo tocas o pulsas «Cómo llegar», se abre Google Maps, que recibe tu dirección IP y puede guardar sus propias cookies según <a href="https://policies.google.com/technologies/cookies" target="_blank" rel="noopener">su política</a>. Lo mismo pasa si sigues un enlace a Booksy, Instagram o WhatsApp: al salir de la app se aplican las cookies de esos sitios.</p>

    <h3>5 · Cómo borrarlas</h3>
    <p>Al cerrar sesión se borra la cookie de sesión. Para borrar todo lo demás, borra los datos de este sitio en tu navegador: <a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener">Chrome</a>, <a href="https://support.apple.com/es-es/105082" target="_blank" rel="noopener">Safari</a>, <a href="https://support.mozilla.org/es/kb/Borrar%20cookies" target="_blank" rel="noopener">Firefox</a> o <a href="https://support.microsoft.com/es-es/microsoft-edge" target="_blank" rel="noopener">Edge</a>. Si bloqueas las cookies de esta app, no podrás mantener la sesión iniciada.</p>

    <h3>6 · Si algún día cambia</h3>
    <p>Si algún día añadimos algo que no sea necesario, como analítica o publicidad, antes de activarlo aparecerá un aviso para pedirte permiso, con la opción de rechazar tan fácil como la de aceptar, y lo detallaremos aquí. Para dudas, escríbenos a ${lgMail()}. Lo relativo a tus datos está en la <a href="#privacidad">política de privacidad</a>.</p>`,
  ],

  condiciones: [
    "Condiciones de uso y reserva",
    () => {
      const R = catalog.rules;
      return `${lgDate()}
    <p>Estas condiciones regulan el uso de la app de ${esc(catalog.business.name)}, las reservas y el Club NOVA. Al crear tu cuenta o reservar las aceptas. Se rigen por el Real Decreto Legislativo 1/2007 (Ley General para la Defensa de los Consumidores y Usuarios) y por la Ley 34/2002 (LSSI).</p>

    <h3>1 · Quién presta el servicio</h3>
    ${lgWho()}

    <h3>2 · Tu cuenta</h3>
    <p>Para reservar necesitas una cuenta con tu nombre y un correo que sea tuyo, y tener al menos 14 años. Las citas de un menor de 14 las reserva su padre, madre o tutor desde su propia cuenta. Cada persona tiene una sola cuenta y es responsable de lo que se haga con ella. Si alguien usa la app para hacer reservas falsas o trampas en el Club, podemos cerrarle la cuenta.</p>

    <h3>3 · Reservas</h3>
    <ul>
      <li>Eliges servicio, barbero (o «Sin preferencia»), día y hora entre los huecos libres. La cita queda confirmada al terminar, la ves en «Mis citas» y te llega un correo.</li>
      <li>Se puede reservar con al menos ${esc(R.leadMinutes ?? 15)} minutos de antelación y hasta ${esc(R.daysAhead ?? 60)} días vista, con un máximo de ${esc(R.maxActive ?? 3)} citas pendientes a la vez.</li>
      ${R.recurring ? `<li>Si eliges repetir la cita cada cierto tiempo, cada una de las citas cuenta como una reserva independiente, con las mismas normas de cambio y cancelación.</li>` : ""}
      <li>Si un día está completo puedes apuntarte a la lista de espera. Te avisamos si se libera un hueco, pero eso no lo reserva: se lo queda quien lo coja antes.</li>
      <li>Pulsar «Reservar» supone aceptar estas condiciones y la <a href="#privacidad">política de privacidad</a>.</li>
    </ul>

    <h3>4 · Precios y pago</h3>
    <p>Los precios son los que ves en la app y ya incluyen el IGIC. Se paga en el estudio, después del servicio, en efectivo, con tarjeta o por Bizum. Si en el momento pides algo más (por ejemplo, un extra), se cobra según la tarifa del estudio y te lo decimos antes. Si por un error un precio estuviera mal en la app, te lo diremos antes de cobrarte.</p>

    <h3>5 · Cambios y cancelaciones</h3>
    <p>Puedes cambiar la cita desde la app hasta ${esc(R.cancelHours)} horas antes y cancelarla hasta la hora de la cita. Si faltan menos de ${esc(R.cancelHours)} horas, para cambiarla escríbenos por WhatsApp. Si no podemos atenderte (enfermedad, avería…), te avisaremos lo antes posible para darte otra hora o anularla, sin coste para ti.</p>

    <h3>6 · Puntualidad</h3>
    <p>Si llegas tarde puede que haya que acortar el servicio para no retrasar al siguiente cliente. Si el retraso no deja tiempo para hacerlo bien, quizá haya que darte otra hora.</p>

    <h3>7 · ${cardOn() ? "Tarjeta en garantía y faltas" : "Faltas"}</h3>
    ${
      cardOn()
        ? `<p>Para reservar online dejas una tarjeta en garantía. Al guardarla no se cobra nada. La custodia Stripe, nuestro proveedor de pagos, y queda en tu perfil para tus próximas citas. Puedes cambiarla o quitarla cuando quieras, salvo que tengas citas pendientes garantizadas con ella.</p>
    <p><b>Si no vienes a la cita, o la cancelas con menos de ${esc(R.cancelHours)} horas de antelación, autorizas a ${esc(aviso.holder)} (${esc(catalog.business.name)}) a cobrar en esa tarjeta ${pctText(R.noShowFeePct)} del servicio reservado si no vienes, y ${pctText(R.lateFeePct)} si cancelas tarde</b>, sin que tengas que estar presente. Nunca se cobra más que el precio del servicio reservado.</p>
    <p>El cobro no es automático: tu barbero revisa cada caso y, si hay un motivo justificado, no se cobra. Si tu banco pide confirmación o rechaza el cargo, te avisamos y puedes pagarlo desde «Mis citas». Si crees que un cobro es un error, escríbenos y lo revisamos. Si procede, te devolvemos el dinero en la misma tarjeta.</p>`
        : `<p>Si faltas varias veces sin avisar, podremos pedirte una garantía o limitar tus reservas online.</p>`
    }

    <h3>8 · Club NOVA</h3>
    <ul>
      <li>Es gratis y forma parte de tu cuenta. Sumas puntos por los servicios y por la ropa de NOVA Supply que pagas en el estudio, según la tabla que ves en la app. Los puntos llegan cuando el equipo te cobra, no al reservar.</li>
      <li>Los puntos, las ligas, las medallas, los premios y los descuentos no tienen valor en dinero, no se pueden cambiar por dinero ni pasar a otra persona.</li>
      <li>El ranking ordena a los socios por los puntos que han ganado desde siempre (canjear premios no resta). En él sale tu foto de perfil (si has puesto una), el nombre o apodo que elijas, tu liga y tus puntos. Puedes dejar de salir en el ranking de todo el Club desde tu perfil; tus amigos te siguen viendo. El ranking no da premios por sí solo.</li>
      <li>Los premios y ventajas pueden cambiar. Si cambian a peor o cerramos el Club, te avisaremos con al menos 30 días para que puedas canjear tus puntos.</li>
      <li>Si borras la cuenta o pasan 3 años sin usarla, se pierden los puntos.</li>
      <li>Si detectamos trampas (cuentas falsas para conseguir puntos por invitar, por ejemplo), anularemos los puntos conseguidos así.</li>
    </ul>

    <h3>9 · Reclamaciones</h3>
    <p>Si algo no ha ido bien, escríbenos a ${lgMail()} o díselo al equipo: casi todo se arregla así. En el estudio tienes a tu disposición hojas oficiales de reclamación. Si no llegamos a un acuerdo, puedes acudir a la Dirección General de Consumo del Gobierno de Canarias, a la Junta Arbitral de Consumo o a los tribunales.</p>

    <h3>10 · Ley aplicable</h3>
    <p>Estas condiciones se rigen por la ley española. Si eres consumidor, cualquier conflicto se resolverá en los juzgados de tu domicilio. Si las cambiamos, actualizaremos la fecha de arriba. Los cambios no afectan a las citas que ya tengas reservadas.</p>`;
    },
  ],

  "aviso-legal": [
    "Aviso legal",
    () => `${lgDate()}
    <p>En cumplimiento del artículo 10 de la Ley 34/2002 (LSSI), estos son los datos del titular de esta app.</p>

    <h3>1 · Titular</h3>
    ${lgWho()}
    <p>Persona física (autónomo): no procede la inscripción en el Registro Mercantil.</p>

    <h3>2 · Para qué es esta app</h3>
    <p>Para reservar servicios de barbería en ${esc(catalog.business.name)}, gestionar tus citas, participar en el Club NOVA, ver los productos del estudio y apuntarte a la lista de la formación. Las reservas se rigen por las <a href="#condiciones">condiciones de uso y reserva</a>.</p>

    <h3>3 · Uso</h3>
    <p>Te comprometes a usar la app de buena fe y conforme a la ley. En particular, no puedes hacer reservas falsas, entrar en cuentas o zonas que no son tuyas, alterar la app o meter código dañino, ni hacer un uso automatizado que la sobrecargue. Podemos retirar el acceso a quien no cumpla estas normas.</p>

    <h3>4 · Propiedad intelectual</h3>
    <p>La marca NOVA, su emblema, las fotografías, los textos, el diseño y el código de esta app pertenecen a su titular o se usan con permiso de sus autores, y los protege la ley de propiedad intelectual e industrial. Puedes usar la app y compartir enlaces a ella, pero no reproducir ni explotar sus contenidos sin permiso por escrito.</p>

    <h3>5 · Responsabilidad</h3>
    <p>Cuidamos que la información (precios, horarios, huecos libres) sea correcta y esté al día, pero puede haber erratas o cortes por mantenimiento o por fallos de los proveedores. No respondemos del contenido de los sitios externos a los que enlazamos (Booksy, Instagram, WhatsApp, Google Maps, NOVA Supply).</p>

    <h3>6 · Ley aplicable</h3>
    <p>Se rige por la ley española. Si eres consumidor, son competentes los juzgados de tu domicilio.</p>`,
  ],
};

// Traducción de cortesía. La versión que vale es la española.
const lgEnNote = () => `<p><i>English translation for convenience. The Spanish version is the legally binding one.</i></p>`;
const LEGAL_EN = {
  privacidad: [
    "Privacy policy",
    () => `${lgEnNote()}${lgDate(1)}
    <p>This page explains what personal data this app processes, why, who we share it with and what you can do about it, under the GDPR (EU 2016/679), Spanish Organic Law 3/2018 (LOPDGDD) and Law 34/2002 (LSSI).</p>

    <h3>1 · Who processes your data</h3>
    ${lgWho(1)}
    <p>We are not required to have a data protection officer. For anything about your data, write to ${lgMail()}.</p>

    <h3>2 · What we process, why and for how long</h3>
    ${lgGrid(
      ["Purpose", "Data", "Legal basis", "How long"],
      [
        ["Your account and logging in", "Name, email, phone (optional), profile photo (optional) and sign-up date" + (authCh.code === false ? "" : ", plus the 6-digit code we send you to log in (it expires after 10 minutes)"), "Contract (art. 6.1.b GDPR)", "Until you ask us to delete it, or 3 years without bookings or use"],
        ["Managing your bookings", "Service, barber, date and time, changes and cancellations, attendance, what you paid and how (cash, card, Bizum), recurring bookings if you set them", "Contract (art. 6.1.b GDPR)", "Same as the account. Payments: 6 years"],
        ["Booking notices", "Your email and the booking details: confirmation, changes, reminders the day before and a few hours before, and waitlist alerts if you join one", "Contract (art. 6.1.b GDPR)", "For as long as the booking lasts. Waitlists are deleted once the day has passed"],
        cardOn() && ["Guarantee card and no-show charges", "Your card is stored by Stripe, not by us. We only see the brand, the last 4 digits and the expiry date, plus your no-shows, late cancellations and any charges or refunds", "Contract (art. 6.1.b) and our legitimate interest in not losing slots (art. 6.1.f)", "The card: until you remove it. Charges: 6 years"],
        ["NOVA Supply orders", "The items, sizes and amount of your studio pick-up orders, their status (pending, paid, ready, delivered) and the date. If you pay online, Stripe takes the payment: we only keep that it is paid", "Contract: your order (art. 6.1.b GDPR) and the duty to keep invoices (art. 6.1.c)", "While you have an account; billing data, the legal period"],
        ["NOVA Club", "Points, league, medals, redeemed rewards, the NOVA Supply clothing purchases the team adds to your account (date, amount, items), your friend code, who invited you, the friends you add to the ranking and whether you tapped “Leave my review”", "Contract: the Club terms (art. 6.1.b GDPR)", "While you have an account"],
        ["Club ranking", "Your profile photo (if you've added one), the name or nickname you choose, your league and the points you've earned. Other members who have logged in to the app can see them. Your friends always see you; you can stop appearing in the whole-Club ranking from your profile at any time", "Contract: the Club terms (art. 6.1.b GDPR)", "While you have an account"],
        ["Offering “your usual booking”", "From your history we work out your usual day, time, barber and service, and how often you come. It is computed on the spot and not stored separately", "Legitimate interest in making booking easier (art. 6.1.f GDPR)", "While you have an account"],
        ["Our own marketing emails: “when are you coming back?”, “we miss you” (sometimes with an offer) and review requests", "Name, email, date of your last cut and your barber", "You are a client and these are for similar services (art. 21.2 LSSI), plus our legitimate interest (art. 6.1.f GDPR). Every email has an unsubscribe link", "Until you unsubscribe. We keep the unsubscribe so we don't write to you again"],
        ["Training interest list", "What you enter in the form: name, phone, email, Instagram if given, level, preferences and message", "Your consent (art. 6.1.a GDPR)", "2 years from the last contact, or until you withdraw consent"],
        ["Invoicing and accounting", "Payments: date, amount, payment method and service or item", "Legal obligation (art. 6.1.c GDPR)", "6 years (Commercial Code and tax law)"],
        ["Backups", "A copy of the app's data, emailed to the owner every week", "Legitimate interest in not losing bookings (art. 6.1.f GDPR)", "1 year"],
        ["Replying when you write to us", "Whatever you tell us by email or WhatsApp", "Your consent or our legitimate interest", "1 year from the last message"],
        ["Keeping the app running and secure", "Server logs: IP address, browser and pages requested", "Legitimate interest in security (art. 6.1.f GDPR)", "As kept by the hosting provider"],
      ],
    )}
    <p><b>About “your usual booking” and “we miss you”.</b> It is a simple analysis of your history (how often you come and when you're due) that is only used to remind you and offer you your usual time. We make no automated decisions that significantly affect you. Charging a no-show is always decided by a person, never by the app. You can object to this analysis and to marketing emails at any time.</p>
    <p>We don't sell your data or buy lists. All data comes from you, except clothing purchases and payments, which the team records when you pay at the studio.</p>

    <h3>3 · Who in the team sees your data</h3>
    <p>${esc(aviso.holder)}, as owner, can see everything. Each barber is an employee of the studio. They see the bookings and contact details of the clients they serve, and get a notice with your name, service and time in their email and phone calendar. The front-desk tablet only sees the day's payments. Everyone in the team is bound by confidentiality.</p>

    <h3>4 · Who we share it with</h3>
    <p>We rely on these providers, who process data on our behalf and only for what we ask of them:</p>
    ${lgGrid(
      ["Provider", "Purpose", "Where the data is"],
      [
        ["Vercel Inc. (USA)", "Hosting the app and running the server", "EU and USA"],
        ["Upstash Inc.", "The database: accounts, bookings, Club and payments", "United Kingdom (London)"],
        ["Resend Inc. (USA)", "Sending the app's emails from NOVA's address", "USA"],
        cardOn() && ["Stripe Payments Europe Ltd. (Ireland)", "Storing your card and processing no-show charges. Stripe meets its own obligations as a payment institution", "EU and USA"],
        ["Google Ireland Ltd.", "Our email (Gmail), where we receive your replies, notices and backups. Google Calendar, if a barber uses it to view their schedule", "EU and USA"],
        ["Apple Distribution International (Ireland)", "iCloud Calendar, if a barber uses it to view their schedule", "EU and USA"],
        ["WhatsApp Ireland Ltd. (Meta)", "Talking to you when you message us or we message you on WhatsApp", "EU and USA"],
      ],
    )}
    <p>If you follow a link to Booksy, Google Reviews, Instagram or WhatsApp, you leave the app and that site's policy applies. We may also have to disclose data to public authorities when the law requires it: tax office, courts or police.</p>
    <p><b>Transfers outside the EU.</b> The United Kingdom has an adequacy decision from the European Commission, so it protects data to an EU-equivalent standard. Transfers to the USA rely on the EU-US Data Privacy Framework, the Commission's standard contractual clauses, or both. You can ask us for a copy of these safeguards.</p>

    <h3>5 · How long we keep it</h3>
    <p>As shown in the table in section 2. Accounts with no bookings or use for 3 years are deleted, along with their Club points. Anything the law requires us to keep, such as payments for 6 years, stays blocked and is only used if a public authority or a court asks for it.</p>

    <h3>6 · Your rights</h3>
    <ul>
      <li><b>Access:</b> find out what data we hold about you.</li>
      <li><b>Rectification:</b> correct what is wrong. You can change most of it yourself in “Profile”.</li>
      <li><b>Erasure:</b> have your data deleted, including your whole account.</li>
      <li><b>Objection:</b> to anything we do on the basis of legitimate interest, such as the history analysis or marketing emails.</li>
      <li><b>Restriction:</b> have us keep your data without using it.</li>
      <li><b>Portability:</b> receive your data in a machine-readable format.</li>
      <li><b>Withdraw consent</b> at any time, without affecting what was done before.</li>
    </ul>
    <p>Write to ${lgMail()} from your account's email address saying what you want. It's free and we reply within one month. To stop marketing emails you don't need to write: just use the “Unsubscribe” link in any of them.</p>
    <p>If you think we haven't handled your request properly, you can complain to the Spanish Data Protection Agency (C/ Jorge Juan 6, 28001 Madrid, <a href="https://www.aepd.es" target="_blank" rel="noopener">www.aepd.es</a>). We'd appreciate it if you told us first.</p>

    <h3>7 · Security</h3>
    <p>The app always runs over HTTPS. ${authCh.code === false ? "For now you log in with just your email, no password or code; once we switch on the email code, we'll ask for it when you log in." : "To log in, we send a code to your email."} Each team member logs in with their own PIN, which is stored encrypted.${cardOn() ? " Your card number goes straight from your phone to Stripe and never passes through our server." : ""} Service keys live on the server, never in the app. If a security breach could affect you, we would tell you and report it to the AEPD as the law requires.</p>

    <h3>8 · Minors</h3>
    <p>You must be at least 14 to have an account. To book for a child under 14, use your own account: the booking is in your name and you are responsible for it. If we find an account belonging to someone under 14 without their parents' or guardians' permission, we delete it.</p>

    <h3>9 · Cookies</h3>
    <p>We only use what the app needs to work: no analytics and no advertising. The details are in the <a href="#cookies">cookie policy</a>.</p>

    <h3>10 · Changes</h3>
    <p>If we change this policy, we'll update the date at the top. If a change really affects you, for example if we start using your data for something new, we'll email you before it applies.</p>`,
  ],

  cookies: [
    "Cookie policy",
    () => `${lgEnNote()}${lgDate(1)}
    <h3>1 · What they are</h3>
    <p>A cookie is a small file a website stores on your device. Article 22.2 of the Spanish LSSI requires your permission before using them, except for those strictly necessary to provide the service you ask for. The same applies to other browser storage, such as local storage.</p>

    <h3>2 · What this app stores on your device</h3>
    <p>Only what it needs to work and to remember your choices. That's why there is no cookie banner: the law doesn't require one for these.</p>
    ${lgGrid(
      ["Name", "Type", "Purpose", "Duration"],
      [
        ["nova_s", "First-party cookie", "Keeps you logged in so you don't have to log in again", "1 year, renewed each time you open the app. Deleted when you log out"],
        ["nova_staff", "First-party cookie", "Keeps the staff panel session open. Only on team devices", "1 year"],
        ["nova_lang, nova_theme", "Local storage", "Remembers the language and look you choose", "Until you clear it"],
        ["nova_catalog", "Local storage", "A copy of services and prices so the app opens quickly. Contains no personal data", "Until you clear it"],
        ["nova_ref", "Local storage", "The code of the friend who invited you, if you came through their link, so they get their points", "Until you sign up or clear it"],
        ["nova_seen_…", "Local storage", "Which medals and leagues we've already celebrated with you, so the animation doesn't repeat. The name includes your email", "Until you clear it"],
        ["nova_train", "Local storage", "Your name and the date, if you joined the training list, to show you're already on it", "Until you clear it"],
        ["nova_staff_who", "Local storage", "The last barber chosen at the front desk. Only on team devices", "Until you clear it"],
        ["nova_install", "Local storage", "Remembers whether we've already offered to install the app, or you installed it, so we don't ask again for a month", "Until you clear it"],
        ["nova_draft, nova_next, nova_splash", "Session storage", "The booking you're making, where to return after logging in, and not repeating the intro animation", "Deleted when you close the tab"],
        ["App cache", "Service worker", "Stores the app's files (design, fonts, icons) so it opens quickly and works offline. Contains no personal data", "Until the next app version"],
        cardOn() && ["__stripe_mid, __stripe_sid", "Stripe cookies", "Fraud prevention when you add a card. Only set at that moment and necessary for the payment", "1 year and 30 minutes"],
      ],
    )}

    <h3>3 · What we don't use</h3>
    <ul>
      <li>No Google Analytics or any other analytics.</li>
      <li>No advertising or social media pixels.</li>
      <li>Nothing that tracks you across other websites.</li>
    </ul>
    <p>Fonts are hosted on our own server, so loading them doesn't connect you to anyone else either.</p>

    <h3>4 · The map and external links</h3>
    <p>The map on the home page (with © OpenStreetMap data) <b>is served from our own server</b>: we fetch the map pieces from OpenStreetMap and serve them to you already cached, so seeing it and moving it doesn't connect your phone to anyone else. If you tap it or “Directions”, Google Maps opens, which receives your IP address and may set its own cookies under <a href="https://policies.google.com/technologies/cookies" target="_blank" rel="noopener">its policy</a>. The same goes for links to Booksy, Instagram or WhatsApp: once you leave the app, those sites' cookies apply.</p>

    <h3>5 · How to delete them</h3>
    <p>Logging out deletes the session cookie. To delete everything else, clear this site's data in your browser: <a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener">Chrome</a>, <a href="https://support.apple.com/en-us/105082" target="_blank" rel="noopener">Safari</a>, <a href="https://support.mozilla.org/en-US/kb/clear-cookies-and-site-data-firefox" target="_blank" rel="noopener">Firefox</a> or <a href="https://support.microsoft.com/en-us/microsoft-edge" target="_blank" rel="noopener">Edge</a>. If you block this app's cookies, you won't be able to stay logged in.</p>

    <h3>6 · If this changes</h3>
    <p>If we ever add something that isn't necessary, such as analytics or advertising, a notice asking for your permission will appear before it is switched on, with an option to refuse that is as easy as accepting, and we'll list it here. Questions: ${lgMail()}. Anything about your personal data is in the <a href="#privacidad">privacy policy</a>.</p>`,
  ],

  condiciones: [
    "Terms of use and booking",
    () => {
      const R = catalog.rules;
      return `${lgEnNote()}${lgDate(1)}
    <p>These terms govern the use of the ${esc(catalog.business.name)} app, bookings and the NOVA Club. By creating an account or booking you accept them. They are governed by Spanish Royal Legislative Decree 1/2007 (consumer protection) and Law 34/2002 (LSSI).</p>

    <h3>1 · Who provides the service</h3>
    ${lgWho(1)}

    <h3>2 · Your account</h3>
    <p>To book you need an account with your name and an email address of your own, and you must be at least 14. Bookings for under-14s are made by a parent or guardian from their own account. One account per person, and you are responsible for what is done with it. We may close the account of anyone who makes fake bookings or cheats in the Club.</p>

    <h3>3 · Bookings</h3>
    <ul>
      <li>You choose a service, a barber (or “No preference”), a day and a time from the free slots. The booking is confirmed when you finish: you'll see it in “My bookings” and get an email.</li>
      <li>You can book at least ${esc(R.leadMinutes ?? 15)} minutes ahead and up to ${esc(R.daysAhead ?? 60)} days in advance, with at most ${esc(R.maxActive ?? 3)} upcoming bookings at a time.</li>
      ${R.recurring ? `<li>If you choose to repeat a booking regularly, each booking counts separately and follows the same change and cancellation rules.</li>` : ""}
      <li>If a day is full you can join the waitlist. We'll tell you if a slot opens up, but that doesn't reserve it: it goes to whoever books it first.</li>
      <li>Tapping “Book” means you accept these terms and the <a href="#privacidad">privacy policy</a>.</li>
    </ul>

    <h3>4 · Prices and payment</h3>
    <p>Prices are as shown in the app and already include IGIC (Canary Islands tax). You pay at the studio after the service, in cash, by card or by Bizum. If you ask for something more on the day (an extra, for example), it is charged at the studio's rates and we tell you first. If a price in the app is wrong by mistake, we'll tell you before charging.</p>

    <h3>5 · Changes and cancellations</h3>
    <p>You can change your booking in the app up to ${esc(R.cancelHours)} hours before, and cancel it up to the time of the appointment. With less than ${esc(R.cancelHours)} hours to go, message us on WhatsApp to change it. If we can't see you (illness, a breakdown…), we'll let you know as soon as possible to offer another time or cancel, at no cost to you.</p>

    <h3>6 · Punctuality</h3>
    <p>If you arrive late, the service may have to be shortened so the next client isn't delayed. If there isn't enough time left to do it properly, we may need to give you another time.</p>

    <h3>7 · ${cardOn() ? "Guarantee card and no-shows" : "No-shows"}</h3>
    ${
      cardOn()
        ? `<p>To book online you leave a guarantee card. Nothing is charged when you save it. It is held by Stripe, our payment provider, and stays on your profile for your next bookings. You can change or remove it at any time, unless you have upcoming bookings guaranteed with it.</p>
    <p><b>If you don't come to your appointment, or cancel less than ${esc(R.cancelHours)} hours in advance, you authorise ${esc(aviso.holder)} (${esc(catalog.business.name)}) to charge that card ${pctText(R.noShowFeePct)} of the booked service if you don't show up, and ${pctText(R.lateFeePct)} if you cancel late</b>, without you needing to be present. We never charge more than the price of the booked service.</p>
    <p>The charge isn't automatic: your barber reviews each case and, if there's a good reason, nothing is charged. If your bank asks for confirmation or declines the charge, we'll let you know and you can pay it from “My bookings”. If you think a charge is a mistake, write to us and we'll review it. Where appropriate, we'll refund it to the same card.</p>`
        : `<p>If you miss several appointments without notice, we may ask for a guarantee or limit your online bookings.</p>`
    }

    <h3>8 · NOVA Club</h3>
    <ul>
      <li>It's free and part of your account. You earn points for services and for NOVA Supply clothing paid for at the studio, as shown in the app. Points arrive when the team charges you, not when you book.</li>
      <li>Points, leagues, medals, rewards and discounts have no cash value, can't be exchanged for money and can't be transferred to anyone else.</li>
      <li>The ranking orders members by the points they've earned since they joined (redeeming rewards doesn't subtract). It shows your profile photo (if you've added one), the name or nickname you choose, your league and your points. You can stop appearing in the whole-Club ranking from your profile; your friends still see you. The ranking doesn't give prizes on its own.</li>
      <li>Rewards and perks may change. If they get worse or we close the Club, we'll give you at least 30 days' notice so you can redeem your points.</li>
      <li>If you delete your account or don't use it for 3 years, your points are lost.</li>
      <li>If we detect cheating (for example, fake accounts to earn referral points), we'll cancel the points earned that way.</li>
    </ul>

    <h3>9 · Complaints</h3>
    <p>If something went wrong, write to ${lgMail()} or tell the team: almost everything gets sorted that way. Official complaint forms are available at the studio. If we can't reach an agreement, you can go to the Canary Islands Consumer Affairs office (Dirección General de Consumo), the Consumer Arbitration Board, or the courts.</p>

    <h3>10 · Governing law</h3>
    <p>These terms are governed by Spanish law. If you are a consumer, any dispute will be heard by the courts where you live. If we change these terms, we'll update the date at the top. Changes don't affect bookings you already have.</p>`;
    },
  ],

  "aviso-legal": [
    "Legal notice",
    () => `${lgEnNote()}${lgDate(1)}
    <p>As required by article 10 of Spanish Law 34/2002 (LSSI), these are the details of the owner of this app.</p>

    <h3>1 · Owner</h3>
    ${lgWho(1)}
    <p>Sole trader: registration in the Commercial Register does not apply.</p>

    <h3>2 · What this app is for</h3>
    <p>Booking barber services at ${esc(catalog.business.name)}, managing your bookings, taking part in the NOVA Club, browsing the studio's products and joining the training list. Bookings are governed by the <a href="#condiciones">terms of use and booking</a>.</p>

    <h3>3 · Use</h3>
    <p>You agree to use the app in good faith and lawfully. In particular, you may not make fake bookings, access accounts or areas that aren't yours, tamper with the app or insert malicious code, or use it in an automated way that overloads it. We may remove access for anyone who breaks these rules.</p>

    <h3>4 · Intellectual property</h3>
    <p>The NOVA brand, its emblem, the photographs, texts, design and code of this app belong to their owner or are used with the authors' permission, and are protected by intellectual and industrial property law. You may use the app and share links to it, but you may not reproduce or exploit its content without written permission.</p>

    <h3>5 · Liability</h3>
    <p>We take care that information (prices, opening hours, free slots) is correct and up to date, but there may be errors, or outages due to maintenance or provider failures. We are not responsible for the content of external sites we link to (Booksy, Instagram, WhatsApp, Google Maps, NOVA Supply).</p>

    <h3>6 · Governing law</h3>
    <p>Spanish law applies. If you are a consumer, the courts where you live have jurisdiction.</p>`,
  ],
};

const pages = {
  async home() {
    const parts = [];
    let habit = null;
    if (user) {
      try {
        const r = await api("bookings");
        if (r.upcoming[0]) parts.push(nextApptCard(r.upcoming[0]));
        else if (r.habit && r.habit.visits >= 2 && provById(r.habit.provider) && svcById(r.habit.service)) {
          habit = r.habit;
          parts.push(`<div id="habit-card"></div>`);
        }
      } catch {}
    }
    show(
      homeHero() +
        parts.join("") +
        `<div class="heading" id="servicios"><p class="eyebrow">Reserva en un minuto</p><h2 class="h1">¿Qué te hacemos?</h2><p class="sub">Elige tu servicio. Después, tu barbero y tu hora.</p></div>` +
        serviceList() +
        teamBlock() +
        homeExtras() +
        legalLinks(),
    );
    initProducts();
    initMap();
    if (habit) initHabit(habit);
    initHero();
    $$(".mate").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        tap();
        const s = svcById("corte") || catalog.services.find((x) => !x.consult);
        draft = { service: s.id };
        saveDraft();
        go("time/" + a.dataset.pid);
      }),
    );
    // Precarga del mes al tocar un servicio: el calendario abre al instante.
    $$(".svc[href^='#barber/']").forEach((a) =>
      a.addEventListener(
        "pointerdown",
        () => {
          const s = svcById(a.getAttribute("href").split("/")[1]);
          teamFor(s).forEach((p) => getAvail(s.id, p.id, monthKey(salonDate())).catch(() => {}));
        },
        { once: true },
      ),
    );
  },

  async barber([sid]) {
    const s = svcById(sid);
    if (!s || s.consult) return go("home");
    if (draft.service !== s.id || draft.moving) draft = { service: s.id };
    saveDraft();
    const team = teamFor(s);
    show(
      back("home", "Cambiar servicio") +
        heading("Elige a tu barbero", `${esc(tx(s.name))} · ${s.duration} min · ${euro(s.price)}`) +
        (team.length > 1
          ? `<a class="any-pick" href="#time/any"><span class="any-ic" aria-hidden="true">${svg(ICONS.users)}</span><span><strong>Sin preferencia</strong><small>La primera hora libre de cualquiera del equipo</small></span><span class="any-go" aria-hidden="true">→</span></a>`
          : "") +
        `<div class="cromos${team.length === 1 ? " solo" : ""}">${team
          .map(
            (p, i) => `<a class="cromo" href="#time/${esc(p.id)}">
              <span class="cromo-photo">${
                p.image
                  ? `<img src="${esc(p.image)}" alt="" width="600" height="800">`
                  : `<span class="cromo-mono"><img src="/assets/icon-512.png" alt=""><b>${initial(p.name)}</b></span>`
              }<span class="cromo-num">${pad(i + 1)}</span></span>
              <span class="cromo-foot"><span class="cromo-name">${esc(p.name)}</span><span class="cromo-role">${esc(p.role)}</span></span>
            </a>`,
          )
          .join("")}</div>`,
    );
    team.forEach((p) => getAvail(s.id, p.id, monthKey(salonDate())).catch(() => {}));
    if (team.length > 1) getAvail(s.id, "any", monthKey(salonDate())).catch(() => {});
    $$(".cromo").forEach((a) =>
      a.addEventListener("click", (e) => {
        if (a.classList.contains("picked")) return;
        e.preventDefault();
        tap();
        a.classList.add("picked");
        setTimeout(() => go(a.getAttribute("href").slice(1)), 160);
      }),
    );
  },

  async consulta([sid]) {
    const s = svcById(sid);
    if (!s) return go("home");
    const msg = L(`Hola NOVA Studio, me interesa el servicio «${s.name}». ¿Qué hueco tenéis?`, `Hi NOVA Studio, I'm interested in the "${tx(s.name)}" service (${s.name}). When do you have a slot?`);
    show(
      back("home", "Volver") +
        `<section class="con-hero"><span class="face svc-ic">${svcIcon(s.icon)}</span><div><small>Fuera de carta</small><h1>${esc(s.name)}</h1><span>${s.price ? L("Desde ", "From ") + euro(s.price) : "Precio a consultar"}</span></div></section>` +
        `<p>${esc(s.desc || "")}</p>` +
        `<ol class="cs-steps">
          <li><b>1</b><div><strong>Escríbenos por WhatsApp</strong><span>Cuéntanos qué necesitas y qué día te vendría bien.</span></div></li>
          <li><b>2</b><div><strong>Lo cuadramos contigo</strong><span>Te decimos precio final y hora.</span></div></li>
          <li><b>3</b><div><strong>Te la apuntamos</strong><span>La cita aparece en la agenda del salón.</span></div></li>
        </ol>` +
        `<a class="btn wide wa-btn" href="${wa(msg)}" target="_blank" rel="noopener">${svg(ICONS.chat)}Escribir por WhatsApp</a>` +
        legalLinks(),
    );
  },

  async time([pid]) {
    if (!draft.service) return go("home");
    if (draft.provider !== pid) {
      dayPicked = false;
      calMonth = monthKey(salonDate());
      delete draft.start;
    }
    draft.provider = pid;
    saveDraft();
    await calendar({ backTo: `barber/${draft.service}`, backLabel: "Cambiar barbero" });
  },

  // Enlace de los correos a clientes dormidos: #reservar/<servicio>/<barbero> deja puestos los de siempre.
  async reservar([sid, pid]) {
    const s = svcById(sid);
    if (!s || s.consult || !provById(pid)) return go("home");
    draft = { service: s.id, provider: pid };
    saveDraft();
    location.replace("#time/" + pid);
  },

  async hueco([sid, pid, date]) {
    const s = svcById(sid);
    if (!s || s.consult || !provById(pid) || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return go("home");
    draft = { service: s.id, provider: pid };
    saveDraft();
    calMonth = date.slice(0, 7);
    selectedDate = date;
    dayPicked = true;
    availCache.clear();
    location.replace("#time/" + pid);
  },

  async move([id]) {
    const { booking: b } = await api("bookings/" + id);
    draft = { service: b.service.id, provider: b.provider.id, moving: b.id };
    if (!calMonth) calMonth = monthKey(salonDate());
    const panel = staff && staffMove === b.id;
    await calendar({ backTo: panel ? "equipo" : `booking/${b.id}`, backLabel: panel ? "Volver a la agenda" : "Volver a la cita" });
  },

  async details() {
    if (!draft.start || !draft.date) return go("home");
    const s = svcById(draft.service),
      p = provById(draft.provider);
    const summary = `<div class="pick-summary">${face(p)}<div><strong>${esc(tx(s.name))} · ${euro(s.price)}</strong><span>${esc(p.name)} · ${esc(longDay(draft.date))} · ${esc(draft.start)}</span></div></div>` + memberHint(s, draft.date);
    // Sin cuenta (o sin nombre): se entra aquí mismo con el correo y el código,
    // y al acabar se vuelve a esta pantalla, ya para confirmar con un toque.
    if (!user || !user.name) {
      show(
        back(`time/${draft.provider}`, "Cambiar hora") +
          (user
            ? heading(L("Un último paso", "One last step"), L("Dinos tu nombre y confirmas tu cita.", "Tell us your name and confirm your booking."))
            : heading(L("¿Quién reserva?", "Who's booking?"), authCh.code === false ? L("Pon tu correo y tu nombre. Así la cita queda a tu nombre.", "Enter your email and your name. That way the booking is in your name.") : L("Pon tu correo y te mandamos un código. Así la cita queda a tu nombre.", "Enter your email and we'll send you a code. That way the booking is in your name."))) +
          summary +
          `<div id="auth" class="auth-box"></div>` +
          (user
            ? ""
            : `<div class="club-card"><span class="club-tag">CLUB</span><h2>${L("Entras en el Club al reservar", "You join the Club when you book")}</h2><p>${authCh.code === false ? L("Con tu correo, sin contraseñas.", "With your email, no passwords.") : L("Con un código a tu correo, sin contraseñas.", "With a code sent to your email, no passwords.")}</p><ul class="club-perks"><li>${L(`${catalog.points.welcome} puntos de regalo al entrar`, `${catalog.points.welcome} welcome points when you join`)}</li><li>${L(`${catalog.points.perEuro} puntos por cada euro, en la silla y en ${esc(catalog.shop.name)}`, `${catalog.points.perEuro} points per euro, in the chair and at ${esc(catalog.shop.name)}`)}</li><li>${L("Un ranking con todo el Club y con tus amigos", "A ranking with the whole Club and with your friends")}</li></ul></div>`),
      );
      authFlow($("#auth"), {
        step: user ? "name" : "",
        onDone: () => render(),
        // Con el código ya puesto, la pantalla pasa a ser «un último paso».
        onStep: () => {
          $(".auth-box + .club-card")?.remove();
          const h = $(".heading h1"),
            sub = $(".heading .sub");
          if (h) h.textContent = L("Un último paso", "One last step");
          if (sub) sub.textContent = L("Dinos tu nombre y confirmas tu cita.", "Tell us your name and confirm your booking.");
        },
      });
      return;
    }
    let shop = null;
    try {
      shop = await loadShop(true);
    } catch {}
    show(
      back(`time/${draft.provider}`, "Cambiar hora") +
        heading("Confirma tu cita", "Un toque y listo.") +
        summary +
        `<form id="details" novalidate>
          <div class="quick-who">${user.photo ? `<img src="${esc(user.photo)}" alt="">` : `<b>${initial(user.name)}</b>`}<div><strong>${esc(user.name)}</strong><span>${esc(user.email)}${user.phone ? " · " + esc(user.phone) : ""}</span></div><a href="#profile">Cambiar</a></div>
          <div class="club-joined"><span class="club-check">✓</span><div><strong>Eres del Club NOVA</strong><span>${L(`Cuando pagues esta cita en el estudio, sumas ${svcPoints(s)} puntos.`, `Once you pay for this booking at the studio, you earn ${svcPoints(s)} points.`)}</span></div></div>
          ${cardOn() ? guaranteeBox(s) : ""}
          ${merchBox(shop)}
          <button class="btn wide book-btn" type="submit">${cardOn() && !user.card ? "Añadir tarjeta y reservar" : "Confirmar reserva"}</button>
          ${
            catalog.rules.recurring
              ? `<div class="repeat-box"><label for="f-every" style="margin-top:0">Repetir esta cita</label><div class="form-actions" style="margin-top:0"><select id="f-every" name="every"><option value="">No, solo esta</option><option value="1">Cada semana</option><option value="2">Cada 2 semanas</option><option value="3">Cada 3 semanas</option><option value="4">Cada 4 semanas</option></select><select name="times" aria-label="Cuántas veces">${Array.from({ length: catalog.rules.recurringMax - 1 }, (_, i) => i + 2).map((n) => `<option value="${n}" ${n === Math.min(4, catalog.rules.recurringMax) ? "selected" : ""}>${n} ${L("citas", "bookings")}</option>`).join("")}</select></div><small>Mismo día de la semana, misma hora y mismo barbero. Si algún día ya está ocupado, te lo decimos.</small></div>`
              : ""
          }
          <p class="terms-note">${L(
            `Al reservar aceptas las <a href="#condiciones" target="_blank">condiciones</a> y la <a href="#privacidad" target="_blank">privacidad</a>. Puedes cambiarla desde la app hasta ${catalog.rules.cancelHours} h antes.`,
            `By booking you accept the <a href="#condiciones" target="_blank">terms</a> and the <a href="#privacidad" target="_blank">privacy policy</a>. You can change it in the app up to ${catalog.rules.cancelHours} h before.`,
          )}${
            cardOn()
              ? ` <b>${L(
                  `Si no vienes o cancelas con menos de ${catalog.rules.cancelHours} h, autorizas a ${esc(catalog.business.name)} a cobrar hasta ${euro(Math.max(feePct(s, "noShow"), feePct(s, "late")))} en tu tarjeta.`,
                  `If you don't show up or cancel less than ${catalog.rules.cancelHours} h before, you authorise ${esc(catalog.business.name)} to charge up to ${euro(Math.max(feePct(s, "noShow"), feePct(s, "late")))} to your card.`,
                )}</b>`
              : ""
          }</p>
          <p class="pay-note">${svg(ICONS.card)} ${cardOn() ? "Ahora no se cobra nada. El servicio se paga en el local, en efectivo o con tarjeta." : "En el local puedes pagar en efectivo o con tarjeta."}</p>
        </form>`,
    );
    $("#g-change")?.addEventListener("click", async () => {
      if (await addCard()) render();
    });
    bindMerchBox(shop);
    onForm("details", async (d) => {
      Object.assign(draft, { terms: true });
      saveDraft();
      // Tarjeta en garantía: se guarda una vez y queda en el perfil para las próximas citas.
      if (cardOn() && !user?.card) {
        const card = await addCard();
        if (!card) return toast("Sin tarjeta en garantía no podemos guardar la cita.");
      }
      const repeat = d.every ? { every: Number(d.every), times: Number(d.times) } : null;
      const merch = merchPicked(shop, d);
      // Una clave por hora elegida: si la red se corta y se reintenta, el servidor
      // reconoce que es la misma reserva y no dice «esa hora ya no está libre».
      const slot = [draft.service, draft.provider, draft.date, draft.start].join("|");
      if (draft.keyFor !== slot) Object.assign(draft, { key: newKey(), keyFor: slot });
      saveDraft();
      const book = async () => {
        for (let i = 0; ; i++) {
          try {
            return await api("book", { service: draft.service, provider: draft.provider, date: draft.date, start: draft.start, terms: true, repeat, key: draft.key, ...(merch.length ? { merch } : {}) }, { timeout: 20000 });
          } catch (err) {
            if (!(err.network || err.data?.pending) || i >= 3) throw err;
            if (!i) toast("La conexión va lenta. Seguimos intentándolo…");
            await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
          }
        }
      };
      let r;
      try {
        try {
          r = await book();
        } catch (err) {
          if (err.status !== 402) throw err;
          if (!(await addCard())) return toast("Sin tarjeta en garantía no podemos guardar la cita.");
          r = await book();
        }
      } catch (err) {
        // La sesión se cerró mientras tanto: se vuelve a entrar sin perder la hora elegida.
        if (err.status === 401) {
          user = null;
          nav();
          return render();
        }
        if (err.status !== 409 || !err.data?.alternatives?.length) throw err;
        availCache.clear();
        return pickAlternative(err.data.alternatives);
      }
      availCache.clear();
      lastBooked = { id: r.id, membership: r.membership, service: s, provider: (r.provider && provById(r.provider.id)) || r.provider || p, date: draft.date, start: draft.start, series: r.series, merch: r.merch };
      draft = {};
      saveDraft();
      go("booked");
    });
  },

  async booked() {
    if (!lastBooked) return go(user ? "bookings" : "home");
    const b = lastBooked,
      pts = svcPoints(svcById(b.service.id) || b.service);
    show(
      `<div class="booked-hero">
        <svg class="booked-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="m15 27 7 7 15-16"/></svg>
        <h1>${user?.name ? L(`¡Hecho, ${esc(first(user.name))}!`, `All set, ${esc(first(user.name))}!`) : "¡Cita reservada!"}</h1><p class="sub">Te esperamos en <em class="serif">el estudio.</em></p>
      </div>` +
        `<div class="ticket">
          <div class="tix-top"><img src="/assets/logo.png" alt="NOVA Studio"><span class="tix-ok">✓ Confirmada</span></div>
          <div class="tix-who">${face(b.provider, "tix-face")}<div><small>Tu barbero</small><strong>${esc(b.provider.name)}</strong></div></div>
          <div class="tix-grid">
            <div><small>Día</small><strong>${esc(cap(fmtDay(b.date, { weekday: "short", day: "numeric", month: "short" })))}</strong></div>
            <div><small>Hora</small><strong>${esc(b.start)}</strong></div>
            <div><small>Servicio</small><strong>${esc(b.service.name)}</strong></div>
            <div><small>${b.membership ? L("Membresía", "Membership") : "Precio"}</small><strong>${b.membership ? L("Incluida", "Included") : euro(b.service.price)}</strong></div>
          </div>
          <div class="tix-cut" aria-hidden="true"></div>
          <div class="tix-foot"><span>Ref. <b>${esc(b.id)}</b></span><span class="tix-pts">+${pts} ${pts === 1 ? L("punto", "point") : L("puntos", "points")} ${L("al pagar", "when you pay")}</span></div>
        </div>` +
        (b.series
          ? `<div class="card series-note"><strong>${L(
              `${b.series.made} citas, cada ${b.series.every === 1 ? "semana" : b.series.every + " semanas"}`,
              `${b.series.made} bookings, every ${b.series.every === 1 ? "week" : b.series.every + " weeks"}`,
            )}</strong><span>${b.series.dates.map((x) => esc(shortDay(x))).join(" · ")}</span>${
              b.series.skipped.length
                ? `<span class="warn-line">${L(
                    `No había hueco a las ${esc(b.start)} el ${b.series.skipped.map((x) => esc(shortDay(x))).join(", ")}: elige otra hora para ese día.`,
                    `There was no slot at ${esc(b.start)} on ${b.series.skipped.map((x) => esc(shortDay(x))).join(", ")}: pick another time for that day.`,
                  )}</span>`
                : ""
            }</div>`
          : "") +
        (b.merch
          ? `<div class="card series-note"><strong>${L("NOVA Supply: lo recoges en tu cita", "NOVA Supply: pick it up at your visit")}</strong><span>${b.merch.items.map((l) => `${esc(l.nombre)} · ${esc(l.talla)}${l.cantidad > 1 ? " × " + l.cantidad : ""}`).join(" · ")}</span><span>${L(`Total ${euro(b.merch.total)}, se paga en el local.`, `Total ${euro(b.merch.total)}, paid at the studio.`)}</span></div>`
          : "") +
        calButtons({ ...b, end: addMin(b.start, b.service.duration) }) +
        `<a class="btn wide" style="margin-top:10px" href="#booking/${esc(b.id)}">Ver, cambiar o cancelar mi cita</a>`,
    );
    confetti();
    installAfterBooking();
  },

  async bookings() {
    if (!user) return loginScreen("Entra para ver tus citas.", "bookings");
    const r = await api("bookings");
    const owe = r.past.filter((b) => isPending(b.charge));
    show(
      heading("Mis citas") +
        owe
          .map(
            (b) =>
              `<a class="owe" href="#booking/${esc(b.id)}"><strong>${L(`Tienes un pago pendiente de ${euro(b.charge.amount)}`, `You have a pending payment of ${euro(b.charge.amount)}`)}</strong><span>${L(
                `No viniste a la cita del ${esc(shortDay(b.date))} · ${esc(b.service.name)}. Toca para pagarlo.`,
                `You missed your booking on ${esc(shortDay(b.date))} · ${esc(tx(b.service.name))}. Tap to pay it.`,
              )}</span></a>`,
          )
          .join("") +
        (r.upcoming[0] ? nextApptCard(r.upcoming[0]) : "") +
        (r.upcoming.length > 1 ? `<div class="appts">${r.upcoming.slice(1).map((b) => bookingCard(b, r.now)).join("")}</div>` : "") +
        (!r.upcoming.length ? `<a class="appt-empty" href="#home"><strong>No tienes citas pendientes</strong><span>Reserva tu próximo corte en un minuto ›</span></a>` : "") +
        // Historial: las 5 últimas a la vista y el resto a un toque (no hace falta bajar por un año de citas).
        (r.past.length
          ? `<p class="section-label">Historial</p><div class="appts">${r.past.slice(0, 5).map((b) => bookingCard(b, r.now)).join("")}</div>` +
            (r.past.length > 5
              ? `<div class="appts" id="past-more" hidden>${r.past.slice(5).map((b) => bookingCard(b, r.now)).join("")}</div><button type="button" class="btn wide secondary" id="past-btn" style="margin-top:10px">${L(`Ver las ${r.past.length - 5} anteriores`, `Show ${r.past.length - 5} earlier`)}</button>`
              : "")
          : ""),
    );
    const more = $("#past-btn");
    if (more) more.onclick = () => (($("#past-more").hidden = false), more.remove());
  },

  async booking([id]) {
    const r = await api("bookings/" + id),
      b = r.booking,
      p = provById(b.provider.id),
      active = b.status === "confirmed" && !r.past;
    show(
      back("bookings", "Mis citas") +
        heading(esc(tx(b.service.name)), `${esc(longDay(b.date))} · ${esc(b.start)}`) +
        `<div class="pick-summary">${face(p)}<div><strong>${L("Con", "With")} ${esc(b.provider.name)}</strong><span>${b.service.duration} min · ${b.membership?.included ? L("incluida en tu membresía", "included in your membership") : `${euro(b.service.price)} · ${L("pago en el local", "pay at the shop")}`}</span></div></div>` +
        `<div class="card"><dl class="detail-list">
          <div><dt>Estado</dt><dd>${b.status === "canceled" ? (b.late ? "Cancelada tarde" : "Cancelada") : b.attendance === "absent" ? "No vino" : r.past ? "Realizada" : "Confirmada"}</dd></div>
          <div><dt>Referencia</dt><dd>${esc(b.id)}</dd></div>
          <div><dt>Dónde</dt><dd>${esc(catalog.business.street)}</dd></div>
          ${b.guarantee && active ? `<div><dt>Garantía</dt><dd>${esc(cardLabel(b.guarantee))}</dd></div>` : ""}
        </dl></div>` +
        chargeNote(b) +
        (active
          ? `<div class="stack">
              ${calButtons(b)}
              <a class="btn wide secondary" href="${esc(catalog.business.maps)}" target="_blank" rel="noopener">${svg(ICONS.pin)} Cómo llegar</a>
              ${
                r.canChange
                  ? `<a class="btn wide" href="#move/${esc(b.id)}">Cambiar día u hora</a><button class="btn wide danger" type="button" id="cancel">Cancelar cita</button>`
                  : `<p class="warning">${L(
                      `Quedan menos de ${catalog.rules.cancelHours} horas. Para cambiarla de hora, escríbenos. Si la cancelas ahora${
                        r.lateFee ? `, según las condiciones se te pueden cobrar ${euro(r.lateFee)}: tu barbero lo revisará y, si hay un motivo justificado, no se cobra` : ", avísanos"
                      }.`,
                      `Less than ${catalog.rules.cancelHours} hours to go. To change the time, message us. If you cancel now${
                        r.lateFee ? `, under the terms you may be charged ${euro(r.lateFee)}: your barber will review it and, if there's a good reason, nothing is charged` : ", please let us know"
                      }.`,
                    )}</p><a class="btn wide wa-btn" href="${wa(
                      L(`Hola, tengo cita el ${longDay(b.date)} a las ${b.start} (ref. ${b.id}) y necesito cambiarla.`, `Hi, I have a booking on ${longDay(b.date)} at ${b.start} (ref. ${b.id}) and I need to change it.`),
                    )}" target="_blank" rel="noopener">${svg(ICONS.chat)} Escribir por WhatsApp</a>${
                      r.canCancel ? `<button class="btn wide danger" type="button" id="cancel">Cancelar cita</button>` : ""
                    }`
              }
            </div>`
          : `<a class="btn wide" href="#barber/${esc(b.service.id)}">Reservar otra igual</a>`),
    );
    $("#pay-now")?.addEventListener("click", () => payPending(b).catch((e) => toast(e.message)));
    $("#cancel")?.addEventListener("click", () => {
      const sh = sheet(
        `<h2>¿Cancelar la cita?</h2><p>${L(
          `${esc(b.service.name)} con ${esc(first(b.provider.name))}, ${esc(longDay(b.date))} a las ${esc(b.start)}. La hora quedará libre para otra persona.`,
          `${esc(tx(b.service.name))} with ${esc(first(b.provider.name))}, ${esc(longDay(b.date))} at ${esc(b.start)}. The time will be freed up for someone else.`,
        )}</p>${
          r.late && r.lateFee
            ? `<p class="warning">${L(
                `Cancelas con menos de ${catalog.rules.cancelHours} h. Según las condiciones se te pueden cobrar <b>${euro(r.lateFee)}</b>. Lo decide tu barbero: si tienes un motivo justificado, escríbenos por WhatsApp.`,
                `You're cancelling less than ${catalog.rules.cancelHours} h before. Under the terms you may be charged <b>${euro(r.lateFee)}</b>. Your barber decides: if you have a good reason, message us on WhatsApp.`,
              )}</p>`
            : ""
        }${b.series ? `<label class="check"><input type="checkbox" id="all-series"><span>Cancelar también las siguientes citas de esta serie</span></label>` : ""}<div class="form-actions"><button type="button" class="btn secondary" id="no">No</button><button type="button" class="btn danger" id="yes">Sí, cancelar</button></div>`,
      );
      sh.el.querySelector("#no").onclick = sh.close;
      sh.el.querySelector("#yes").onclick = async (e) => {
        e.currentTarget.disabled = true;
        const allSeries = !!sh.el.querySelector("#all-series")?.checked;
        try {
          const x = await api(`bookings/${b.id}/cancel`, { series: allSeries });
          availCache.clear();
          sh.close();
          toast(x.late ? "Cita cancelada. Tu barbero revisará si se cobra." : x.cutReturned ? L("Cita cancelada. Te devolvemos el corte de tu membresía.", "Booking cancelled. Your membership cut is back.") : "Cita cancelada.");
          render();
        } catch (err) {
          e.currentTarget.disabled = false;
          toast(err.message);
        }
      };
    });
  },

  // #login/<pantalla>: adónde ir después de entrar (por defecto, el perfil).
  async login([next]) {
    const to = /^[a-z]+$/.test(next || "") ? next : "profile";
    if (user?.name) return go(to);
    loginScreen("", to);
  },

  // (Antes el código iba en su propia pantalla; ahora va dentro de «Entrar».)
  async code() {
    go("login");
  },

  async profile() {
    if (!user) return loginScreen("", "profile");
    const back_ = socioReturn === "ok" ? "membership?sync=1" : "membership";
    const [m, bk, mem] = await Promise.all([api("member"), api("bookings").catch(() => ({ upcoming: [] })), api(back_).catch(() => null)]);
    user = m.user;
    if (mem) memb = mem.mine;
    nav();
    const L = leagueOf(m.earned),
      got = m.medals.filter((x) => x.got).length;
    show(
      `<section class="ph" style="${leagueVars(L.league)}">
        <div class="ph-top"><span class="ph-brand">${tl("SOCIO DEL <b>CLUB</b>", "CLUB <b>MEMBER</b>")}</span><span class="ph-league">${leagueArt(L.league)}${esc(L.label.toUpperCase())}</span></div>
        <div class="ph-id">
          <label class="ph-avatar" title="Cambiar foto">${user.photo ? `<img src="${esc(user.photo)}" alt="Tu foto">` : `<b>${initial(user.name || user.email)}</b>`}<span class="ph-cam">${svg(ICONS.camera)}</span><input type="file" accept="image/*" id="photo-in" class="sr-only"></label>
          <div class="ph-name"><h1>${esc(user.name || "Tu perfil")}</h1><span>${tl("Socio Nº", "Member No.")} ${String(user.no || 0).padStart(4, "0")} · ${tl("desde", "since")} ${esc(monthYear(user.since))}</span></div>
        </div>
        <div class="ph-count"><strong>${nf(m.earned)}</strong><span>${m.earned === 1 ? "punto" : "puntos"}<br>ganados</span></div>
        <div class="ph-bar"><i style="width:${L.pct}%"></i></div>
        <div class="ph-next">${
          L.toNext
            ? tl(`${nf(L.toNext)} ${L.toNext === 1 ? "punto" : "puntos"} para <b>✦ ${esc(L.nextLabel)}</b>`, `${nf(L.toNext)} ${L.toNext === 1 ? "point" : "points"} to <b>✦ ${esc(L.nextLabel)}</b>`)
            : tl(`Has llegado a lo más alto: <b>${esc(topLeague().name)}</b>`, `You've reached the very top: <b>${esc(topLeague().name)}</b>`)
        }</div>
      </section>
      <div class="stat3">
        <a href="#bookings"><strong>${m.metrics.cuts}</strong><span>${m.metrics.cuts === 1 ? "Corte" : "Cortes"}</span></a>
        <button type="button" data-scroll="medallas"><strong>${got}</strong><span>Medallas</span></button>
        <button type="button" data-scroll="amigos"><strong>${m.metrics.friends}</strong><span>Amigos</span></button>
      </div>
      <p class="section-label">Tus citas</p>
      ${
        bk.upcoming.length
          ? bk.upcoming.map((b, i) => (i ? `<div class="appts">${bookingCard(b, bk.now)}</div>` : nextApptCard(b))).join("") + `<p class="muted pf-hint">Toca una cita para cambiarla de día u hora o cancelarla. <a href="#bookings">Ver historial</a></p>`
          : `<a class="appt-empty" href="#home"><strong>No tienes citas pendientes</strong><span>Reserva tu próximo corte en un minuto ›</span></a>`
      }
      ${installCard()}
      ${leagueStrip(L.index)}
      ${nextBlock(m, L)}
      ${medalsBlock(m)}
      ${supplyBlock(L)}
      ${inviteBlock(m)}
      ${memberBlock(mem)}
      ${
        cardOn()
          ? `<p class="section-label">Tu tarjeta</p>
        <div class="card my-card">${
          user.card
            ? `<div class="mc-row"><span class="mc-chip">${esc((BRANDS[user.card.brand] || "Tarjeta").toUpperCase())}</span><div><strong>···· ${esc(user.card.last4)}</strong><span>${tl("Caduca", "Expires")} ${esc(user.card.exp || "")}</span></div></div>
               <p class="muted">${tl(
                 `Garantiza tus citas. Solo se usa si no vienes o cancelas con menos de ${catalog.rules.cancelHours} h, y lo revisa tu barbero antes de cobrar.`,
                 `It guarantees your bookings. It's only used if you don't show up or cancel less than ${catalog.rules.cancelHours} h before, and your barber reviews it before charging.`,
               )}</p>
               <div class="form-actions" style="margin-top:6px"><button type="button" class="btn secondary" id="card-change">Cambiar</button><button type="button" class="btn danger" id="card-remove">Quitar</button></div>`
            : `<p class="muted" style="margin-top:0">Aún no tienes tarjeta guardada. Te la pediremos al reservar, para garantizar la cita. No se cobra nada salvo que faltes sin avisar.</p><button type="button" class="btn wide secondary" id="card-change">Añadir tarjeta</button>`
        }</div>`
          : ""
      }
      <p class="section-label">Ranking</p>
      <div class="card rk-pref">
        <label class="check"><input type="checkbox" id="rk-show" ${user.rank !== false ? "checked" : ""}><span>${tl("Salir en el ranking de todo el Club", "Appear in the whole-Club ranking")}<small>${tl(
          `Se ve ${user.photo ? "tu foto, " : ""}<b>${esc(user.rankName || rankName(user.name))}</b>, tu liga y tus puntos. Tus amigos te ven siempre.`,
          `It shows ${user.photo ? "your photo, " : ""}<b>${esc(user.rankName || rankName(user.name))}</b>, your league and your points. Your friends always see you.`,
        )}</small></span></label>
        <a class="btn wide secondary" href="#ranking" style="margin-top:12px">${svg(ICONS.trophy)} ${tl("Ver el ranking", "See the ranking")}</a>
      </div>
      <p class="section-label">Tus datos</p>
      <form id="profile" class="card">
        <label for="p-name" style="margin-top:0">${tl("Nombre o apodo", "Name or nickname")} <small class="opt">${tl("(la reserva y el ranking)", "(your booking and the ranking)")}</small></label><input id="p-name" name="name" required maxlength="60" autocomplete="name" value="${esc(user.name || "")}">
        <label for="p-phone">${tl("Teléfono", "Phone")} <small class="opt">${tl("(opcional, por si el estudio necesita contactarte)", "(optional, in case the studio needs to reach you)")}</small></label><input id="p-phone" name="phone" type="tel" inputmode="tel" maxlength="30" autocomplete="tel" value="${esc(user.phone || "")}">
        <label for="p-email">Correo</label><input id="p-email" value="${esc(user.email)}" readonly>
        <button class="btn wide" style="margin-top:18px" type="submit">Guardar</button>
      </form>
      ${aiBlock()}
      <button class="btn wide secondary" type="button" id="logout">${svg(ICONS.logout)} Cerrar sesión</button>` + legalLinks(),
    );
    $$("[data-scroll]").forEach((b) => (b.onclick = () => document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" })));
    $("#install-btn")?.addEventListener("click", installNow);
    celebrate(m, L);
    $("#photo-in").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        await api("profile/photo", { photo: await shrinkImage(f, 320) });
        await refreshMe();
        toast("Foto actualizada.");
        render();
      } catch (err) {
        toast(err.message || "No se ha podido leer esa foto.");
      }
    };
    bindInvite();
    bindMember(mem);
    bindAi();
    $("#rk-show").onchange = async (e) => {
      const box = e.currentTarget;
      box.disabled = true;
      try {
        await api("profile/rank", { show: box.checked });
        await refreshMe();
        toast(box.checked ? L("Vuelves a salir en el ranking.", "You're back on the ranking.") : L("Ya no sales en el ranking de todo el Club.", "You no longer appear in the whole-Club ranking."));
      } catch (err) {
        box.checked = !box.checked;
        toast(err.message);
      } finally {
        box.disabled = false;
      }
    };
    $("#card-change")?.addEventListener("click", async () => {
      try {
        if (await addCard()) render();
      } catch (e) {
        toast(e.message);
      }
    });
    const rm = $("#card-remove");
    if (rm)
      rm.onclick = async () => {
        if (rm.dataset.sure !== "1") {
          rm.dataset.sure = "1";
          rm.textContent = "¿Seguro? Pulsa otra vez";
          return;
        }
        rm.disabled = true;
        try {
          await api("card/remove", {});
          await refreshMe();
          toast("Tarjeta quitada.");
          render();
        } catch (e) {
          rm.disabled = false;
          toast(e.message);
        }
      };
    onForm("profile", async (d) => {
      await api("profile", { name: d.name, phone: d.phone });
      await refreshMe();
      nav();
      toast("Guardado.");
      render();
    });
    $("#logout").onclick = async () => {
      await api("auth/logout", {});
      user = null;
      nav();
      go("home");
    };
  },

  async ranking([sub]) {
    const scope = sub === "amigos" ? "friends" : "global";
    if (!user) {
      show(
        heading("Ranking", L("Los socios del Club, por puntos ganados. Todo el Club y tus amigos, en directo.", "Club members by points earned. The whole Club and your friends, live.")) +
          `<div class="rk-me rk-off"><p>${L(
            `Entra con tu correo para ver en qué puesto vas. Empiezas con ${catalog.points.welcome} puntos de regalo.`,
            `Log in with your email to see where you stand. You start with ${catalog.points.welcome} welcome points.`,
          )}</p><a class="btn" href="#login/ranking">${L("Entrar o crear cuenta", "Log in or sign up")}</a></div>`,
      );
      return;
    }
    if (!user.name) {
      show(heading("Ranking", L("Antes, dinos tu nombre: es el que sale en el ranking.", "First, tell us your name: it's the one shown in the ranking.")) + `<div id="auth" class="auth-box"></div>`);
      authFlow($("#auth"), { step: "name", onDone: () => render() });
      return;
    }
    await rankingPage(scope);
  },

  async rewards() {
    const P = catalog.points;
    if (!user) {
      show(
        `<section class="pts"><span class="pts-tag">EL CLUB</span><strong class="pts-num">${P.welcome}</strong><p>${tl(
          `puntos de regalo al entrar · ${P.perEuro} por cada euro, en la silla y en ${esc(catalog.shop.name)} · +${P.perFriend} por cada amigo`,
          `welcome points when you join · ${P.perEuro} per euro, in the chair and at ${esc(catalog.shop.name)} · +${P.perFriend} per friend`,
        )}</p><div class="pts-league">${leagueArt(catalog.leagues[0])}<span>${tl(
          `Empiezas en <b>${esc(catalog.leagues[0].name)} III</b> y subes hasta <b>${esc(topLeague().name)}</b>`,
          `You start in <b>${esc(catalog.leagues[0].name)} III</b> and climb up to <b>${esc(topLeague().name)}</b>`,
        )}</span></div></section>` +
          `<a class="btn wide" href="#home">Reservar mi primer corte</a><a class="btn wide secondary" style="margin-top:10px" href="#login">Ya soy del Club · Entrar</a>` +
          `<p class="section-label">Las ligas</p>${leagueList(-1)}` +
          `<p class="section-label">Premios del Club</p><div class="rw-list">${catalog.rewards.map((r) => rewardRow(r, 0)).join("")}</div>` +
          supplyBlock(null),
      );
      return;
    }
    const m = await api("member"),
      L = leagueOf(m.earned),
      open = m.redemptions.filter((r) => r.status === "pending");
    show(
      `<section class="pts" style="${leagueVars(L.league)}">
        <span class="pts-tag">TUS PUNTOS</span>
        <strong class="pts-num">${nf(m.balance)}</strong>
        <p>${tl(
          `${P.perEuro} puntos por cada euro, en la silla y en ${esc(catalog.shop.name)} · +${P.perFriend} por cada amigo`,
          `${P.perEuro} points per euro, in the chair and at ${esc(catalog.shop.name)} · +${P.perFriend} per friend`,
        )}</p>
        <div class="pts-league">${leagueArt(L.league)}<span>${tl(`Liga <b>${esc(L.label)}</b> · ${nf(m.earned)} puntos ganados`, `<b>${esc(L.label)}</b> league · ${nf(m.earned)} points earned`)}</span></div>
      </section>` +
        `<a class="rk-mini" id="rk-mini" href="#ranking" hidden></a>` +
        nextBlock(m, L) +
        (open.length
          ? `<p class="section-label">Para recoger en el local</p><div class="rw-list">${open
              .map((r) => `<div class="rw ticket"><span class="rw-ic">${svg(ICONS.gift)}</span><div><strong>${esc(r.reward.name)}</strong><span>Enséñale este código a tu barbero</span></div><b class="tk-code">${esc(r.id)}</b></div>`)
              .join("")}</div>`
          : "") +
        `<p class="section-label">Premios del Club</p><div class="rw-list">${catalog.rewards.map((r) => rewardRow(r, m.balance)).join("")}</div>` +
        supplyBlock(L) +
        `<p class="section-label">Las ligas</p>${leagueList(L.index, m.earned)}` +
        (m.moves.length
          ? `<p class="section-label">Movimientos</p><div class="card mv-list">${m.moves
              .slice(0, 12)
              .map((x) => `<div class="mv"><span>${esc(tx(x.text))}${x.when ? `<small>${esc(shortDay(x.when.slice(0, 10)))}</small>` : ""}</span><b class="${x.pts > 0 ? "plus" : "minus"}">${x.pts > 0 ? "+" : ""}${nf(x.pts)}</b></div>`)
              .join("")}</div>`
          : "") +
        `<a class="btn wide secondary" style="margin-top:18px" href="#profile">Ver mi perfil y medallas</a>`,
    );
    rkMini();
    celebrate(m, L);
    $$("[data-redeem]").forEach(
      (b) =>
        (b.onclick = () => {
          const r = catalog.rewards.find((x) => x.id === b.dataset.redeem);
          const sh = sheet(
            `<p class="eyebrow">Canjear premio</p><h2>${esc(r.name)}</h2><p>${tl(
              `${esc(r.desc)}. Se descuentan <b>${nf(r.cost)} puntos</b> de tu saldo (te quedarán ${nf(m.balance - r.cost)}). Tu liga no baja.`,
              `${esc(tx(r.desc))}. <b>${nf(r.cost)} points</b> come off your balance (you'll have ${nf(m.balance - r.cost)} left). Your league doesn't drop.`,
            )}</p><div class="form-actions"><button type="button" class="btn secondary" id="no">Ahora no</button><button type="button" class="btn" id="yes">Canjear</button></div>`,
          );
          sh.el.querySelector("#no").onclick = sh.close;
          sh.el.querySelector("#yes").onclick = async (e) => {
            e.currentTarget.disabled = true;
            try {
              const res = await api("rewards/redeem", { reward: r.id });
              sh.el.innerHTML = `<div class="booked-hero"><span class="booked-check">✓</span><h2>¡Canjeado!</h2><p class="sub">${esc(r.name)}</p></div><div class="tk-big"><small>Tu código</small><strong>${esc(res.redemption.id)}</strong><span>Enséñaselo a tu barbero en tu próxima visita.</span></div><button type="button" class="btn wide" id="ok">Hecho</button>`;
              sh.el.querySelector("#ok").onclick = () => (sh.close(), render());
            } catch (err) {
              e.currentTarget.disabled = false;
              toast(err.message);
            }
          };
        }),
    );
  },

  // Panel del equipo: cada barbero entra con su clave y ve su agenda y su caja.
  // El dueño ve a todo el equipo y, solo él, las comisiones.
  async productos() {
    await productsPage();
  },

  async supply() {
    await supplyPage();
  },

  async formacion() {
    await trainingPage();
  },

  async equipo(args = []) {
    await loadPanel();
    if (!staff) return staffLogin();
    try {
      if (staff.caja) return await (args[0] === "agenda" ? staffAgenda : staffCobros)();
      await ({ mas: staffMore, cobrar: staffCobros, caja: staffCaja, progreso: staffProgress, ganancias: staffEarnings, socios: staffMembers, faltas: staffFaltas, formacion: staffTraining, productos: staffProducts, ajustes: staffTeam, web: staffWeb, servicios: staffServices, clientes: staffClients, avisos: staffAvisos, ropa: staffRopa }[args[0]] || staffAgenda)();
    } catch (e) {
      if (e.status !== 401) throw e;
      staff = null;
      render();
    }
  },
};
for (const k of Object.keys(LEGAL))
  pages[k] = async () => {
    await loadAviso();
    const [title, body] = (LANG === "en" ? LEGAL_EN : LEGAL)[k];
    show(back("home", "Volver") + heading(title, catalog.business.name) + `<article class="legal-page">${body()}</article>` + legalLinks());
  };

// La hora elegida se la acaba de llevar otro: se ofrecen las más cercanas y
// con un toque se reserva la que elija (mismos datos, sin volver a escribir nada).
function pickAlternative(list) {
  const sh = sheet(
    `<p class="eyebrow">Se acaba de ocupar</p><h2>Otra persona ha cogido esa hora</h2><p class="muted" style="margin-top:6px">Estas siguen libres. Toca una y queda reservada.</p>
     <div class="alt-list">${list
       .map(
         (a, i) =>
           `<button type="button" class="alt-item" data-i="${i}"><span><strong>${esc(a.start)}</strong><small>${esc(shortDay(a.date))}</small></span><span>${a.provider ? L("con ", "with ") + esc(first(a.provider.name)) : "con quien esté libre"}</span><b aria-hidden="true">→</b></button>`,
       )
       .join("")}</div>
     <button type="button" class="btn wide secondary" style="margin-top:14px" id="alt-cal">Ver el calendario</button>`,
  );
  sh.el.querySelectorAll(".alt-item").forEach(
    (b) =>
      (b.onclick = async () => {
        const a = list[+b.dataset.i];
        Object.assign(draft, { date: a.date, start: a.start }, a.provider ? { provider: a.provider.id } : {});
        saveDraft();
        sh.close();
        await render();
        $("#details")?.requestSubmit();
      }),
  );
  sh.el.querySelector("#alt-cal").onclick = () => {
    sh.close();
    delete draft.start;
    saveDraft();
    go("time/" + draft.provider);
  };
}

// ── Calendario (reservar y cambiar de hora) ────────────────────────────────
async function calendar({ backTo, backLabel }) {
  const s = svcById(draft.service),
    p = provById(draft.provider);
  if (!s || !p) return go("home");
  // Paso desde Booksy: el cliente reserva aquí solo desde `openFrom`; el calendario empieza en ese mes.
  const openFrom = !staff && catalog.rules.openFrom,
    thisMonth = openFrom ? openFrom.slice(0, 7) : monthKey(salonDate());
  if (!calMonth || calMonth < thisMonth) calMonth = thisMonth;
  let avail = await getAvail(s.id, p.id, calMonth);
  const firstOpen = (a) => Object.keys(a).sort().find((d) => a[d].length);
  // Si este mes ya no tiene horas, se pasa solo al siguiente.
  if (!dayPicked && !firstOpen(avail) && calMonth === thisMonth) {
    calMonth = shiftMonth(calMonth, 1);
    avail = await getAvail(s.id, p.id, calMonth);
  }
  if (!selectedDate.startsWith(calMonth) || (!dayPicked && !avail[selectedDate]?.length)) selectedDate = firstOpen(avail) || "";
  getAvail(s.id, p.id, shiftMonth(calMonth, 1)).catch(() => {});

  const [cy, cm] = calMonth.split("-").map(Number),
    lead = (new Date(cy, cm - 1, 1).getDay() + 6) % 7,
    total = new Date(cy, cm, 0).getDate(),
    todayIso = isoDay(salonDate()),
    times = avail[selectedDate] || [],
    morning = times.filter((t) => t < "14:00"),
    afternoon = times.filter((t) => t >= "14:00"),
    pill = (t) => `<button type="button" class="time-pill" data-time="${t}">${t}</button>`,
    monthName = cap(new Date(cy, cm - 1, 1).toLocaleDateString(LOC(), { month: "long" })) + " " + cy;
  // Punto de disponibilidad: verde = mucha, naranja = media, rojo = pocas.
  // Se compara con el día más libre del mes (un día sin reservas).
  // Días completos (solo al reservar, no al cambiar de hora): se pueden tocar para pedir aviso.
  const full = !draft.moving && avail.full ? avail.full : new Set();
  const fullDay = Math.max(1, ...Object.values(avail).map((a) => a.length)),
    level = (n) =>
      n <= 2 || n / fullDay <= 0.25
        ? ["low", L(", quedan pocas horas", ", only a few times left")]
        : n / fullDay <= 0.6
          ? ["mid", L(", disponibilidad media", ", some availability")]
          : ["", ""];
  let cells = "";
  for (let i = 0; i < lead; i++) cells += `<span class="cal-cell blank" aria-hidden="true"></span>`;
  for (let d = 1; d <= total; d++) {
    const iso = `${calMonth}-${pad(d)}`,
      n = (avail[iso] || []).length,
      open = n > 0,
      isFull = !open && full.has(iso),
      [lv, lvLabel] = open ? level(n) : ["", ""];
    cells += `<button type="button" class="cal-cell${open ? " open" : ""}${isFull ? " full" : ""}${lv ? " lvl-" + lv : ""}${iso === selectedDate ? " selected" : ""}${iso === todayIso ? " today" : ""}" data-day="${iso}" ${open || isFull ? "" : "disabled"} aria-pressed="${iso === selectedDate}" aria-label="${esc(longDay(iso))}${open ? lvLabel : isFull ? L(", completo: puedes pedir aviso", ", fully booked: you can ask to be notified") : L(", sin horas", ", no times")}">${d}</button>`;
  }
  const maxMonth = shiftMonth(monthKey(salonDate()), Math.ceil(Math.max(catalog.rules.daysAhead, memb?.live ? memb.daysAhead : 0) / 30));
  show(
    back(backTo, backLabel) +
      heading(draft.moving ? "Elige la nueva hora" : "Día y hora") +
      `<div class="pick-summary">${face(p)}<div><strong>${esc(s.name)}</strong><span>${esc(p.name)} · ${s.duration} min · ${euro(s.price)}</span></div></div>` +
      (openFrom
        ? `<p class="open-from">${L(`Aquí se reserva a partir del <b>${esc(fmtDay(openFrom, { weekday: "long", day: "numeric", month: "long" }))}</b>. Para antes, pide tu cita en Booksy.`, `Online booking here starts on <b>${esc(longDay(openFrom))}</b>. For earlier dates, book on Booksy.`)}${
            catalog.rules.openBefore ? ` <a href="${esc(catalog.rules.openBefore)}" target="_blank" rel="noopener noreferrer">${L("Ir a Booksy ↗", "Go to Booksy ↗")}</a>` : ""
          }</p>`
        : "") +
      `<div class="cal-card"><div class="cal-head"><button type="button" class="cal-nav" id="prev-month" aria-label="Mes anterior" ${calMonth <= thisMonth ? "disabled" : ""}>‹</button><strong>${monthName}</strong><button type="button" class="cal-nav" id="next-month" aria-label="Mes siguiente" ${calMonth >= maxMonth ? "disabled" : ""}>›</button></div><div class="cal-week">${L("LMXJVSD", "MTWTFSS")
        .split("")
        .map((c) => `<span>${c}</span>`)
        .join("")}</div><div class="cal-grid">${cells}</div><div class="cal-legend"><span><i></i>Muchas horas</span><span><i class="mid"></i>Algunas horas</span><span><i class="low"></i>Pocas horas</span></div></div>` +
      (selectedDate && full.has(selectedDate) && !times.length
        ? `<div class="times"><h2 class="times-title">${esc(longDay(selectedDate))}</h2>
            <div class="wl-box" id="wl-box"><strong>Este día está completo</strong><span>Si alguien cancela, te escribimos al momento para que elijas hora antes que nadie.</span>
            ${user ? "" : `<label for="wl-email">Tu correo</label><input id="wl-email" type="email" autocomplete="email" value="${esc(draft.email || "")}">`}
            <button type="button" class="btn wide" id="wl-btn">Avísame si se libera</button></div></div>`
        : selectedDate
        ? `<div class="times"><h2 class="times-title">${esc(longDay(selectedDate))}</h2>${morning.length ? `<p class="times-label">${L("Mañana", "Morning")}</p><div class="time-grid">${morning.map(pill).join("")}</div>` : ""}${afternoon.length ? `<p class="times-label">${L("Tarde", "Afternoon")}</p><div class="time-grid">${afternoon.map(pill).join("")}</div>` : ""}</div>`
        : '<p class="empty">No quedan horas libres este mes. Prueba el mes siguiente.</p>') +
      `<div style="height:150px"></div>`,
  );
  $("#prev-month").onclick = () => ((calMonth = shiftMonth(calMonth, -1)), (dayPicked = false), render());
  $("#next-month").onclick = () => ((calMonth = shiftMonth(calMonth, 1)), (dayPicked = false), render());
  $$(".cal-cell[data-day]:not([disabled])").forEach((b) => (b.onclick = () => ((selectedDate = b.dataset.day), (dayPicked = true), render())));
  $("#wl-btn")?.addEventListener("click", async (e) => {
    const email = user ? user.email : ($("#wl-email")?.value || "").trim();
    if (!user && !$("#wl-email").reportValidity()) return;
    e.currentTarget.disabled = true;
    try {
      await api("waitlist", { service: s.id, provider: draft.provider, date: selectedDate, email });
      if (!user) Object.assign(draft, { email }), saveDraft();
      $("#wl-box").innerHTML = L(
        `<strong>Listo, te avisamos</strong><span>Si se libera una hora el ${esc(shortDay(selectedDate))}, te llega un correo a ${esc(email)}. Se la lleva quien reserve primero.</span>`,
        `<strong>Done, we'll let you know</strong><span>If a time opens up on ${esc(shortDay(selectedDate))}, you'll get an email at ${esc(email)}. First to book gets it.</span>`,
      );
    } catch (err) {
      e.currentTarget.disabled = false;
      toast(err.message);
    }
  });

  // Elegir hora solo la marca; se avanza con «Continuar» por si se equivoca.
  const bar = document.createElement("div");
  bar.className = "continue-bar visible";
  bar.innerHTML = `<div class="continue-info"><span>${draft.moving ? "Nueva hora" : "Tu cita"}</span><strong id="continue-when">Elige una hora</strong></div><button type="button" class="btn" id="continue-btn" disabled>${draft.moving ? "Cambiar" : "Continuar"}</button>`;
  $("#app").append(bar);
  const pick = (b) => {
    $$(".time-pill.selected").forEach((x) => (x.classList.remove("selected"), x.setAttribute("aria-pressed", "false")));
    b.classList.add("selected");
    b.setAttribute("aria-pressed", "true");
    draft.date = selectedDate;
    draft.start = b.dataset.time;
    saveDraft();
    $("#continue-when").textContent = `${shortDay(selectedDate)} · ${b.dataset.time}`;
    $("#continue-btn").disabled = false;
  };
  $$("[data-time]").forEach((b) => {
    b.setAttribute("aria-pressed", "false");
    b.onclick = () => pick(b);
    if (draft.date === selectedDate && draft.start === b.dataset.time) pick(b);
  });
  // Las horas quedan por encima de la barra fija, sin taparla.
  requestAnimationFrame(() => {
    const times = document.querySelector(".times, .empty");
    const bar = document.querySelector(".continue-bar");
    if (!times || !bar) return;
    const gap = times.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + 12;
    if (gap > 0) window.scrollBy({ top: gap, behavior: "smooth" });
  });
  $("#continue-btn").onclick = async (e) => {
    if (draft.date !== selectedDate || !draft.start) return;
    if (!draft.moving) return go("details");
    e.currentTarget.disabled = true;
    try {
      await api(`bookings/${draft.moving}/move`, { date: draft.date, start: draft.start });
      availCache.clear();
      const id = draft.moving,
        day = draft.date;
      draft = {};
      saveDraft();
      toast("Cita cambiada.");
      if (staff && staffMove === id) {
        staffMove = "";
        staffDay = day;
        return go("equipo");
      }
      go("booking/" + id);
    } catch (err) {
      e.currentTarget.disabled = false;
      availCache.clear();
      toast(err.message);
    }
  };
}

// ── Club ───────────────────────────────────────────────────────────────────
const DIV = ["III", "II", "I"];
const nf = (n) => Number(n || 0).toLocaleString(LOC());
const topLeague = () => catalog.leagues[catalog.leagues.length - 1];
// Puntos que da un servicio: su precio × puntos por euro.
const svcPoints = (s) => Math.round((s?.price ?? 15) * catalog.points.perEuro);
// Liga y división como en un ranking: cada liga (menos la última) tiene III, II y I.
function leagueOf(pts) {
  const Ls = catalog.leagues;
  let i = Ls.length - 1;
  while (i > 0 && pts < Ls[i].min) i--;
  const lg = Ls[i],
    next = Ls[i + 1];
  if (!next) return { league: lg, index: i, label: lg.name, pct: 100, toNext: 0 };
  const step = (next.min - lg.min) / 3,
    k = Math.min(2, Math.floor((pts - lg.min) / step)),
    from = Math.ceil(lg.min + step * k),
    to = k < 2 ? Math.ceil(lg.min + step * (k + 1)) : next.min,
    nextLabel = k < 2 ? `${lg.name} ${DIV[k + 1]}` : next === topLeague() ? next.name : `${next.name} III`;
  return { league: lg, index: i, label: `${lg.name} ${DIV[k]}`, pct: pts > from ? Math.max(4, Math.round(((pts - from) / (to - from)) * 100)) : 0, toNext: to - pts, nextLabel };
}
const leagueVars = (lg) => `--c1:${lg.c1};--c2:${lg.c2}`;
const monthYear = (stamp) => (stamp ? new Date(String(stamp).slice(0, 10) + "T12:00:00").toLocaleDateString(LOC(), { month: "long", year: "numeric" }) : L("hoy", "today"));
// El mejor descuento en la tienda que da tu liga (o null).
function shopDiscount(index) {
  let best = null;
  catalog.leagues.slice(0, index + 1).forEach((lg) => lg.perks.forEach((p) => /%.*Supply/.test(p) && (best = p)));
  return best;
}
// Cuántos cortes son unos puntos, para que se entienda la distancia.
const cutsFor = (pts) => Math.max(1, Math.ceil(pts / svcPoints(svcById("corte") || { price: 15 })));

// Insignia de cada liga: escudo con degradado y un astro que crece con la liga,
// de la chispa a la estrella de cuatro puntas del emblema, y su explosión.
const LEAGUE_GLYPH = [
  '<path d="M32 23.5c.7 4.4 2.1 5.8 6.5 6.5-4.4.7-5.8 2.1-6.5 6.5-.7-4.4-2.1-5.8-6.5-6.5 4.4-.7 5.8-2.1 6.5-6.5z"/>',
  '<circle cx="37" cy="26" r="4.2"/><path d="M33.6 29.4 22 41M36.4 31 29 38.5M31.8 27.6 24.5 34"/>',
  '<circle cx="32" cy="31" r="6"/><path d="M20.5 35.5c-2-2.6 3-7.4 11-10.3s14.6-2.6 15.9.4c.8 1.9-1.3 4.4-5.1 6.8"/>',
  '<path d="M32 22l2.9 6 6.6.8-4.9 4.5 1.3 6.5L32 36.6l-5.9 3.2 1.3-6.5-4.9-4.5 6.6-.8z"/>',
  '<path d="M32 19c1 8 4 11 12 12-8 1-11 4-12 12-1-8-4-11-12-12 8-1 11-4 12-12z"/>',
  '<path d="M32 21.5c.8 6.3 3.2 8.7 9.5 9.5-6.3.8-8.7 3.2-9.5 9.5-.8-6.3-3.2-8.7-9.5-9.5 6.3-.8 8.7-3.2 9.5-9.5z"/><path d="M22.5 20.5l2.6 2.6M41.5 20.5l-2.6 2.6M22.5 41.5l2.6-2.6M41.5 41.5l-2.6-2.6M32 15.5v2M32 44.5v2"/>',
];
function leagueArt(lg, locked = false) {
  const i = catalog.leagues.indexOf(lg),
    id = `lg-${lg.id}${locked ? "-x" : ""}`,
    c1 = locked ? "#f1f0eb" : lg.c1,
    c2 = locked ? "#c9c7bf" : lg.c2,
    top = !locked && i === catalog.leagues.length - 1;
  return `<svg viewBox="0 0 64 64" class="lg-art${top ? " lg-top" : ""}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <path d="M32 4 54 13v17c0 14-9 24-22 30C19 54 10 44 10 30V13z" fill="url(#${id})"/>
    <path d="M32 10.5 48.5 17.2V30c0 10.5-6.6 18-16.5 22.6C22.1 48 15.5 40.5 15.5 30V17.2z" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.3"/>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="${c2}" stroke-width="5" opacity=".55">${LEAGUE_GLYPH[i]}</g><g stroke="#fff" stroke-width="2.4">${LEAGUE_GLYPH[i]}</g></g></svg>`;
}
function leagueStrip(index) {
  return `<div class="lg-strip" role="list" style="--n:${catalog.leagues.length}">${catalog.leagues
    .map((lg, i) => `<div role="listitem" class="lg-step${i === index ? " on" : ""}${i < index ? " past" : ""}" style="${leagueVars(lg)}">${leagueArt(lg, i > index)}<span>${esc(lg.name)}</span></div>`)
    .join("")}</div>`;
}
function leagueList(index, earned = 0) {
  return `<div class="lg-list">${catalog.leagues
    .map((lg, i) => {
      const state = i === index ? "Tu liga" : i < index ? "✓ Superada" : `${nf(lg.min)} pts`,
        left = i > index ? lg.min - earned : 0;
      return `<div class="lg-row${i === index ? " on" : ""}${i > index ? " locked" : ""}${i === catalog.leagues.length - 1 ? " top" : ""}" style="${leagueVars(lg)}">${leagueArt(lg, i > index)}<div><strong>${esc(lg.name)}<small>${esc(lg.motto)}</small></strong><ul class="lg-perks">${lg.perks.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>${
        user && i === index + 1 ? `<span class="lg-left">${toGo(left)}</span>` : ""
      }</div><em>${state}</em></div>`;
    })
    .join("")}</div>`;
}

// Medallas: rueda dentada (silla), sello (constancia), rombo (NOVA Supply),
// escudo (amigos) y hexágono (especiales).
const GEAR = (() => {
  const pts = [],
    n = 12;
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2,
      h = Math.PI / n;
    [
      [t - 0.13, 30],
      [t + 0.13, 30],
      [t + h - 0.12, 25.5],
      [t + h + 0.12, 25.5],
    ].forEach(([a, r]) => pts.push(`${(32 + r * Math.sin(a)).toFixed(2)},${(32 - r * Math.cos(a)).toFixed(2)}`));
  }
  return "M" + pts.join("L") + "Z";
})();
const SEAL = (() => {
  const pts = [],
    n = 16;
  for (let k = 0; k < n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2,
      r = k % 2 ? 26.5 : 30;
    pts.push(`${(32 + r * Math.sin(a)).toFixed(2)},${(32 - r * Math.cos(a)).toFixed(2)}`);
  }
  return "M" + pts.join("L") + "Z";
})();
const MEDAL_SHAPE = {
  silla: GEAR,
  constancia: SEAL,
  supply: "M32 2.5 61.5 32 32 61.5 2.5 32z",
  amigos: "M32 3 55 11v19c0 15-10 25-23 31C19 55 9 45 9 30V11z",
  especiales: "M32 3l25 14.5v29L32 61 7 46.5v-29z",
};
const MEDAL_TINT = {
  silla: ["#fff3cc", "#f3cf8a", "#a8701c", "#5c3d0c"],
  constancia: ["#fff0e0", "#ffb37a", "#c24d1c", "#5e1f08"],
  supply: ["#ffeef4", "#f4a9c2", "#b23d63", "#4d1426"],
  amigos: ["#eef6ff", "#a9cdf7", "#3b6db0", "#16335c"],
  especiales: ["#f4ebff", "#cdb2ff", "#6d43c2", "#33196b"],
};
function medalArt(md, got) {
  const [c1, cm, c2, ink] = got ? MEDAL_TINT[md.group] : ["#fbfbfa", "#dededa", "#aeaea8", "#8a8a85"],
    id = `md-${md.group}-${got ? 1 : 0}`;
  return `<svg viewBox="0 0 64 64" class="md-svg" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".5" stop-color="${cm}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <path d="${MEDAL_SHAPE[md.group]}" fill="url(#${id})" stroke="${c2}" stroke-width=".8"/>
    <circle cx="32" cy="31" r="17" fill="${got ? "#1b1814" : "#f2f2f0"}" stroke="${got ? cm : "#d3d3cf"}" stroke-width="1.2"/>
    <g transform="translate(23 21) scale(.75)" fill="none" stroke="${got ? cm : "#a2a29d"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[md.icon] || ICONS.star}</g>
    <text x="32" y="44" text-anchor="middle" font-family="Arial" font-size="4.4" font-weight="700" letter-spacing=".5" fill="${got ? cm : ink}">${esc(md.code)}</text></svg>`;
}
const MEDAL_UNIT = { cuts: ["corte", "cortes"], friends: ["amigo", "amigos"], items: ["prenda", "prendas"], fresh: ["vuelta", "vueltas"], streak: ["mes", "meses"] };
const MEDAL_UNIT_EN = { cuts: ["haircut", "haircuts"], friends: ["friend", "friends"], items: ["garment", "garments"], fresh: ["return", "returns"], streak: ["month", "months"] };
// «Falta 1 corte», «Faltan 2 meses»… o la descripción si no se cuenta en unidades.
function medalLeft(md, st) {
  const left = md.goal - st.progress,
    unit = (LANG === "en" ? MEDAL_UNIT_EN : MEDAL_UNIT)[md.metric];
  if (LANG === "en") return unit && md.goal > 1 ? `${left} more ${left === 1 ? unit[0] : unit[1]} to go` : tx(md.desc) || `${left} more to go`;
  return unit && md.goal > 1 ? `Falta${left === 1 ? "" : "n"} ${left} ${left === 1 ? unit[0] : unit[1]}` : md.desc || `Falta${left === 1 ? "" : "n"} ${left}`;
}
// «Te faltan 300 puntos · unos 2 cortes»
const toGo = (pts) =>
  L(
    `Te faltan ${nf(pts)} puntos · ${cutsFor(pts) === 1 ? "con un corte" : `unos ${cutsFor(pts)} cortes`}`,
    `${nf(pts)} points to go · ${cutsFor(pts) === 1 ? "one haircut" : `about ${cutsFor(pts)} haircuts`}`,
  );
function medalCard(md, st) {
  const sub = st.got ? "✓ Conseguida" : medalLeft(md, st),
    bar = !st.got && md.goal > 1 ? `<div class="md-bar" title="${st.progress}/${md.goal}"><i style="width:${Math.max(4, Math.round((st.progress / md.goal) * 100))}%"></i></div>` : "";
  return `<div class="md${st.got ? " got" : ""}" title="${esc(md.desc || md.name)}"><div class="md-art">${medalArt(md, st.got)}${st.got ? "" : `<span class="md-lock">${svg(ICONS.lock)}</span>`}</div><strong>${esc(md.name)}</strong><span class="md-sub">${esc(sub)}</span>${bar}${medalAction(md, st)}</div>`;
}
// Las medallas sin puntos (la de la reseña) no enseñan «+0 pts».
const pts = (md) => (md.bonus ? `+${nf(md.bonus)}` : "");
function medalAction(md, st) {
  if (md.metric === "review" && !st.got && catalog.reviews)
    return `<a class="md-chip md-act" href="/api/resena" target="_blank" rel="noopener">${svg(ICONS.star)}${L("Dejar reseña", "Leave a review")}</a>`;
  return md.bonus ? `<span class="md-chip">${svg(ICONS.gift)}+${nf(md.bonus)} pts</span>` : "";
}
// Al volver de dejar la reseña, la medalla ya sale conseguida.
document.addEventListener("click", (e) => {
  if (!e.target.closest?.(".md-act")) return;
  addEventListener("focus", () => render(), { once: true });
});
function medalsBlock(m) {
  const all = catalog.medals.map((md, i) => [md, m.medals[i]]),
    got = m.medals.filter((x) => x.got).length;
  return (
    `<div id="medallas"><p class="section-label">${L("Medallas", "Medals")} · ${got}/${all.length}</p>` +
    catalog.medalGroups
      .map((g) => {
        const list = all.filter(([md]) => md.group === g.id);
        return `<div class="md-head"><p>${esc(g.name)}</p><span>${list.filter(([, s]) => s.got).length}/${list.length}</span></div><div class="md-grid">${list.map(([md, s]) => medalCard(md, s)).join("")}</div>`;
      })
      .join("") +
    `</div>`
  );
}

// «Lo próximo»: las medallas que tienes más cerca. Es lo que hace volver:
// ver que te falta un corte para algo.
function nearMedals(m, n = 3) {
  return catalog.medals
    .map((md, i) => [md, m.medals[i]])
    .filter(([md, s]) => !s.got && !["profile", "year"].includes(md.metric))
    .sort(([a, sa], [b, sb]) => sb.progress / b.goal - sa.progress / a.goal || a.goal - sa.progress - (b.goal - sb.progress) || b.bonus - a.bonus)
    .slice(0, n);
}
function nextBlock(m, L) {
  const near = nearMedals(m),
    target = L.toNext ? catalog.leagues.find((lg) => L.nextLabel.split(" ")[0] === lg.name) || L.league : null;
  if (!near.length && !target) return "";
  return (
    `<p class="section-label">Lo próximo</p><div class="nx-list">` +
    (target
      ? `<div class="nx nx-league" style="${leagueVars(target)}">${leagueArt(target)}<div><strong>${esc(L.nextLabel)}</strong><span>${toGo(L.toNext)}</span><div class="md-bar"><i style="width:${L.pct}%"></i></div></div></div>`
      : "") +
    near
      .map(
        ([md, s]) =>
          `<div class="nx"><span class="nx-art">${medalArt(md, false)}</span><div><strong>${esc(md.name)}</strong><span>${esc(medalLeft(md, s))}${md.desc && MEDAL_UNIT[md.metric] && md.goal > 1 ? ` · ${esc(tx(md.desc))}` : ""}</span>${
            md.goal > 1 ? `<div class="md-bar"><i style="width:${Math.max(4, Math.round((s.progress / md.goal) * 100))}%"></i></div>` : ""
          }</div><b>${pts(md)}</b></div>`,
      )
      .join("") +
    `</div>`
  );
}

// Celebración al entrar si desde la última vez hay medalla nueva o subes de liga.
// La primera vez en un aparato solo se apunta lo que hay, sin fiesta.
function celebrate(m, L) {
  const key = "nova_seen_" + (user?.email || ""),
    got = catalog.medals.filter((_, i) => m.medals[i].got).map((md) => md.id);
  let seen = null;
  try {
    seen = JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify({ medals: got, league: L.label, index: L.index }));
  } catch {}
  if (!seen) return;
  const fresh = catalog.medals.filter((md) => got.includes(md.id) && !seen.medals.includes(md.id)),
    up = L.label !== seen.league && (L.index > seen.index || (L.index === seen.index && DIV.indexOf(L.label.split(" ").pop()) > DIV.indexOf(String(seen.league).split(" ").pop())));
  if (!fresh.length && !up) return;
  const newLeague = up && L.index > seen.index;
  const sh = sheet(
    (up
      ? `<div class="cel" style="${leagueVars(L.league)}"><div class="cel-art">${leagueArt(L.league)}</div><p class="eyebrow">${newLeague ? "Nueva liga" : "Subes de división"}</p><h2>${esc(L.label)}</h2><p class="cel-motto">${esc(L.league.motto)}</p>${
          newLeague ? `<ul class="lg-perks cel-perks">${L.league.perks.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""
        }</div>`
      : "") +
      (fresh.length
        ? `<div class="cel-medals"><p class="eyebrow">${fresh.length === 1 ? "Medalla nueva" : tl(`${fresh.length} medallas nuevas`, `${fresh.length} new medals`)}</p>${fresh
            .slice(0, 4)
            .map((md) => `<div class="nx"><span class="nx-art">${medalArt(md, true)}</span><div><strong>${esc(md.name)}</strong><span>${esc(md.desc || "Conseguida")}</span></div><b>${pts(md)}</b></div>`)
            .join("")}${fresh.length > 4 ? `<p class="muted" style="text-align:center;margin:4px 0 0">${tl(`y ${fresh.length - 4} más en tu perfil`, `and ${fresh.length - 4} more on your profile`)}</p>` : ""}</div>`
        : "") +
      `<button type="button" class="btn wide" id="cel-ok">Seguir</button>`,
  );
  sh.el.querySelector("#cel-ok").onclick = sh.close;
  confetti();
}

// NOVA Supply: la ropa de la casa. Lo que compras allí también suma.
function supplyBlock(L) {
  const S = catalog.shop,
    disc = L ? shopDiscount(L.index) : null;
  return `<section class="supply">
    <figure class="sp-photo"><img src="${pic("supply")}" alt="${tl(`Camisetas de ${esc(S.name)}`, `${esc(S.name)} T-shirts`)}" loading="lazy" width="760" height="1350"></figure>
    <div class="sp-txt">
      <span class="club-tag">${esc(S.name.toUpperCase())}</span>
      <h2>La ropa de <em class="serif">la casa.</em></h2>
      <p>${tl(
        `Cada euro en ropa también suma: <b>${catalog.points.perEuro} puntos por euro</b>. Di tu código del Club al pagar en el estudio.`,
        `Every euro on clothing counts too: <b>${catalog.points.perEuro} points per euro</b>. Give your Club code when you pay at the studio.`,
      )}</p>
      ${
        disc
          ? `<p class="sp-disc" style="${leagueVars(L.league)}">${leagueArt(L.league)}<span>${tl(`Tu liga ${esc(L.league.name)}`, `Your ${esc(L.league.name)} league`)}: <b>${esc(tx(disc))}</b></span></p>`
          : `<p class="sp-disc sp-soon">${tl(
              `Desde ${esc(catalog.leagues.find((lg) => lg.perks.some((p) => /%.*Supply/.test(p)))?.name || "")}, descuento en cada prenda.`,
              `From ${esc(catalog.leagues.find((lg) => lg.perks.some((p) => /%.*Supply/.test(p)))?.name || "")} league, a discount on every garment.`,
            )}</p>`
      }
      <a class="btn wide club-btn" href="#supply">${tl("Pedir y recoger en el estudio", "Order and pick up at the studio")}</a>
      <a class="btn wide secondary" href="${esc(S.url)}" target="_blank" rel="noopener">${tl("Ver la tienda", "Visit the shop")} · ${esc(S.label)} ↗</a>
    </div>
  </section>`;
}
function inviteBlock(m) {
  return `<section class="invite" id="amigos">
    <span class="club-tag">INVITA Y SUMA</span>
    <h2>${L(`+${catalog.points.perFriend} puntos por cada amigo`, `+${catalog.points.perFriend} points for every friend`)}</h2>
    <p>${L(
      "Pásale tu código para que lo ponga al crear su cuenta. Los puntos son tuyos en cuanto venga a su primera cita, y os veréis en el ranking de amigos.",
      "Give them your code to enter when they sign up. The points are yours as soon as they come to their first appointment, and you'll see each other in the friends ranking.",
    )}</p>
    <div class="inv-code"><strong id="my-code">${esc(user.ref || "—")}</strong><button type="button" id="copy-code" aria-label="Copiar código">${svg(ICONS.copy)}</button></div>
    <button type="button" class="btn wide club-btn" id="share-code">${svg(ICONS.share)} Compartir mi código</button>
    ${
      m.friends.length
        ? `<div class="inv-friends">${m.friends.map((f) => `<span class="${f.counted ? "ok" : ""}">${esc(f.name)}${f.counted ? " ✓" : L(" · aún no ha venido", " · hasn't come yet")}</span>`).join("")}</div>`
        : ""
    }
  </section>`;
}
// ── Socio NOVA+ (membresía mensual de pago) ───────────────────────────────
// Distinta del Club de puntos (gratis): aquí se paga una cuota al mes y a
// cambio hay cortes incluidos, más días vista y un descuento. Sin Stripe va en
// modo demo (alta y baja al momento, sin cobro).
const socioReturn = new URLSearchParams(location.search).get("socio");
const memDate = (d) => cap(fmtDay(d, { day: "numeric", month: "long" }));
const planPerks = (pl) =>
  [
    pl.cuts ? L(`${pl.cuts} ${pl.cuts === 1 ? "corte incluido" : "cortes incluidos"} al mes (${pl.services.map((id) => esc(tx(svcById(id)?.name || id))).join(", ")})`, `${pl.cuts} ${pl.cuts === 1 ? "cut" : "cuts"} included per month (${pl.services.map((id) => esc(tx(svcById(id)?.name || id))).join(", ")})`) : "",
    pl.daysAhead > catalog.rules.daysAhead ? L(`Reserva hasta ${pl.daysAhead} días vista (el resto, ${catalog.rules.daysAhead})`, `Book up to ${pl.daysAhead} days ahead (others: ${catalog.rules.daysAhead})`) : "",
    pl.discountPct ? L(`${pl.discountPct} % de descuento en el resto de servicios y en la ropa`, `${pl.discountPct}% off other services and clothing`) : "",
  ].filter(Boolean);
// Aviso al reservar: la cita sale incluida si el socio tiene cortes (el servidor decide).
function memberHint(s, date) {
  if (!memb?.live || !memb.plan?.services?.includes(s.id)) return "";
  if (memb.left > 0 && date < memb.renews) return `<p class="mem-hint">${L(`Incluida en tu membresía ${esc(memb.plan.name)}: no pagas nada en el local. Te quedan ${memb.left} ${memb.left === 1 ? "corte" : "cortes"} este mes.`, `Included in your ${esc(memb.plan.name)} membership: nothing to pay at the shop. ${memb.left} ${memb.left === 1 ? "cut" : "cuts"} left this month.`)}</p>`;
  if (date >= memb.renews && !memb.cancelAtPeriodEnd) return `<p class="mem-hint">${L("Cae en tu próximo mes de membresía: saldrá incluida si se renueva.", "It falls in your next membership month: it will be included if it renews.")}</p>`;
  return `<p class="mem-hint mem-hint-off">${L("Este mes ya has usado tus cortes incluidos: esta cita se paga en el local.", "You've used your included cuts this month: this one is paid at the shop.")}</p>`;
}
function memberBlock(mem) {
  if (!mem?.plans?.length) return "";
  const m = mem.mine;
  const demo = mem.demo ? `<span class="mem-demo">${L("Modo demo · sin cobro real", "Demo mode · no real charge")}</span>` : "";
  let body;
  if (m?.live || m?.status === "past_due") {
    body = `<div class="mem-top"><div><strong>${esc(m.plan.name)}</strong><span>${euro(m.plan.price)}${L("/mes", "/month")}</span></div>${m.demo ? demo : ""}</div>
      ${m.status === "past_due" ? `<p class="warning">${L("No hemos podido cobrar tu cuota. Mientras tanto no tienes las ventajas: actualiza tu pago.", "We couldn't charge your fee. You don't have the perks until it's fixed: update your payment.")}</p>` : ""}
      ${m.cuts ? `<div class="mem-cuts" aria-label="${L("Cortes", "Cuts")}">${Array.from({ length: Math.min(m.cuts, 12) }, (_, i) => `<i class="${i < m.used ? "used" : ""}"></i>`).join("")}</div><p class="mem-line"><b>${m.left}</b> ${L(`de ${m.cuts} ${m.cuts === 1 ? "corte disponible" : "cortes disponibles"} este mes`, `of ${m.cuts} ${m.cuts === 1 ? "cut" : "cuts"} left this month`)}</p>` : ""}
      <ul class="mem-perks">${planPerks(m.plan).map((x) => `<li>${x}</li>`).join("")}</ul>
      <p class="muted mem-line">${m.cancelAtPeriodEnd ? L(`Baja programada: tienes tus ventajas hasta el ${esc(memDate(m.renews))}.`, `Cancellation scheduled: you keep your perks until ${esc(memDate(m.renews))}.`) : L(`Próxima renovación: ${esc(memDate(m.renews))}.`, `Next renewal: ${esc(memDate(m.renews))}.`)}</p>
      <div class="form-actions" style="margin-top:6px">
        ${!m.demo ? `<button type="button" class="btn secondary" id="mem-portal">${L("Gestionar pago", "Manage payment")}</button>` : ""}
        ${m.cancelAtPeriodEnd ? `<button type="button" class="btn secondary" id="mem-resume">${L("Mantener mi membresía", "Keep my membership")}</button>` : `<button type="button" class="btn danger" id="mem-cancel">${L("Darme de baja", "Cancel membership")}</button>`}
      </div>`;
  } else {
    body =
      (m?.status === "canceled" ? `<p class="muted" style="margin-top:0">${L("Tu membresía está de baja. Puedes volver cuando quieras.", "Your membership has ended. You can come back any time.")}</p>` : m?.status === "incomplete" ? `<p class="muted" style="margin-top:0">${L("Tu alta no llegó a completarse. Puedes intentarlo otra vez.", "Your sign-up wasn't completed. You can try again.")}</p>` : "") +
      mem.plans
        .map(
          (pl) => `<div class="mem-plan"><div class="mem-top"><div><strong>${esc(pl.name)}</strong><span>${euro(pl.price)}${L("/mes", "/month")}</span></div>${demo}</div>
          ${pl.desc ? `<p class="muted" style="margin:0 0 8px">${esc(pl.desc)}</p>` : ""}
          <ul class="mem-perks">${planPerks(pl).map((x) => `<li>${x}</li>`).join("")}</ul>
          <button type="button" class="btn wide" data-mem-join="${esc(pl.id)}">${L(`Hacerme socio · ${euro(pl.price)}/mes`, `Join · ${euro(pl.price)}/month`)}</button></div>`,
        )
        .join("");
  }
  return `<p class="section-label" id="socio">${esc(mem.name || "Socio NOVA+")}</p>
    <div class="card mem-box">${socioReturn === "cancel" && !m?.live ? `<p class="muted" style="margin-top:0">${L("No se ha hecho ningún cobro.", "Nothing was charged.")}</p>` : ""}${body}
      <p class="muted mem-fine">${L("Es aparte del Club de puntos, que sigue siendo gratis.", "This is separate from the points Club, which stays free.")}</p></div>`;
}
function bindMember(mem) {
  if (!mem?.plans?.length) return;
  if (socioReturn === "ok") {
    toast(mem.mine?.live ? L("¡Ya eres socio NOVA+!", "You're a NOVA+ member!") : L("Estamos confirmando tu pago. Vuelve a abrir el perfil en un momento.", "We're confirming your payment. Reopen your profile in a moment."));
    history.replaceState(null, "", "/#profile");
  }
  $$("[data-mem-join]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await api("membership/join", { plan: b.dataset.memJoin });
          if (r.url) return void (location.href = r.url); // Stripe Checkout
          await refreshMe();
          toast(L("¡Ya eres socio NOVA+! (modo demo, sin cobro)", "You're a NOVA+ member! (demo mode, no charge)"));
          render();
        } catch (e) {
          b.disabled = false;
          toast(e.message);
        }
      }),
  );
  const act = (id, path, body, msg) => {
    const el = $(id);
    if (el)
      el.onclick = async () => {
        if (el.classList.contains("danger") && el.dataset.sure !== "1") {
          el.dataset.sure = "1";
          el.textContent = L("¿Seguro? Pulsa otra vez", "Sure? Tap again");
          return;
        }
        el.disabled = true;
        try {
          const r = await api(path, body);
          if (r.url) return void (location.href = r.url);
          await refreshMe();
          toast(msg);
          render();
        } catch (e) {
          el.disabled = false;
          toast(e.message);
        }
      };
  };
  act("#mem-cancel", "membership/cancel", {}, L("Baja hecha.", "Membership cancelled."));
  act("#mem-resume", "membership/cancel", { resume: true }, L("Tu membresía sigue en marcha.", "Your membership continues."));
  act("#mem-portal", "membership/portal", {}, "");
}

// ── Conectar mi asistente de IA ───────────────────────────────────────────
// El cliente genera un token para que su asistente (Claude, ChatGPT, Grok…)
// reserve por él en /api/mcp. El token se enseña una sola vez; luego solo se
// ven sus datos (nombre, cuándo se creó y se usó) para poder revocarlo.
const mcpUrl = () => `${location.origin}/api/mcp`;
function aiBlock() {
  return `<p class="section-label" id="asistente">Conectar mi asistente de IA</p>
    <div class="card ai-box">
      <p class="ai-lead">Pídele cita a tu asistente de IA (Claude, ChatGPT, Grok…) sin abrir la app.</p>
      <p class="muted ai-example">${L("«Pídeme cita con Airam el jueves por la tarde»", "“Book me in with Airam on Thursday afternoon”")}</p>
      <ol class="ai-steps">
        <li><span>Añade este servidor MCP en tu asistente:</span><span class="ai-copy-row"><code id="ai-url">${esc(mcpUrl())}</code><button type="button" class="ai-copy" id="ai-url-copy" aria-label="Copiar dirección">${svg(ICONS.copy)}</button></span></li>
        <li><span>Genera aquí tu token y ponlo como cabecera</span> <code class="ai-hdr">Authorization: Bearer &lt;token&gt;</code><span>. También puede pedirlo tu asistente con tu correo y el código que te llega.</span></li>
      </ol>
      <div id="ai-new" aria-live="polite"></div>
      <button type="button" class="btn wide secondary" id="ai-gen">${svg(ICONS.link)} Generar token</button>
      <div id="ai-list" class="ai-list"></div>
    </div>`;
}
async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast(text);
  }
}
async function loadAiTokens() {
  const box = $("#ai-list");
  if (!box) return;
  let r;
  try {
    r = await api("assistant/tokens");
  } catch {
    box.innerHTML = "";
    return;
  }
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString(LOC(), { day: "numeric", month: "short", year: "numeric" }) : "");
  box.innerHTML = r.tokens.length
    ? `<p class="ai-list-h">Tokens activos</p>` +
      r.tokens
        .map(
          (t) => `<div class="ai-tok"><div><strong>${esc(t.label)}</strong><span>${esc(
            L(`Creado el ${when(t.created)}`, `Created ${when(t.created)}`) + " · " + (t.used ? L(`último uso el ${when(t.used)}`, `last used ${when(t.used)}`) : L("sin usar todavía", "not used yet")),
          )}</span></div><button type="button" class="btn small danger" data-revoke="${esc(t.id)}">Revocar</button></div>`,
        )
        .join("") +
      `<p class="muted ai-note">${L(
        `Caducan a los ${r.days} días sin uso. Como mucho ${r.max}: al crear otro se revoca el más antiguo.`,
        `They expire after ${r.days} days without use. ${r.max} at most: creating another revokes the oldest.`,
      )}</p>`
    : `<p class="muted ai-note">Aún no has conectado ningún asistente.</p>`;
  box.querySelectorAll("[data-revoke]").forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.sure !== "1") {
        b.dataset.sure = "1";
        b.textContent = "¿Seguro?";
        return;
      }
      b.disabled = true;
      try {
        await api(`assistant/tokens/${encodeURIComponent(b.dataset.revoke)}/revoke`, {});
        toast("Token revocado. Ese asistente ya no puede reservar por ti.");
        loadAiTokens();
      } catch (e) {
        b.disabled = false;
        toast(e.message);
      }
    };
  });
}
function bindAi() {
  const gen = $("#ai-gen");
  if (!gen) return;
  $("#ai-url-copy").onclick = () => copyText(mcpUrl(), "Dirección copiada.");
  gen.onclick = async () => {
    gen.disabled = true;
    try {
      const t = await api("assistant/tokens", {});
      $("#ai-new").innerHTML = `<div class="ai-token"><code id="ai-token">${esc(t.token)}</code><button type="button" class="ai-copy" id="ai-token-copy" aria-label="Copiar token">${svg(ICONS.copy)}</button></div>
        <p class="warning">Cópialo ahora: no lo volveremos a enseñar. Quien lo tenga puede reservar y cancelar a tu nombre. Si lo pierdes o ya no lo usas, revócalo.</p>`;
      $("#ai-token-copy").onclick = () => copyText(t.token, "Token copiado.");
      loadAiTokens();
    } catch (e) {
      toast(e.message);
    } finally {
      gen.disabled = false;
    }
  };
  loadAiTokens();
}
function bindInvite() {
  const code = user?.ref;
  if (!code) return;
  $("#copy-code").onclick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast("Código copiado.");
    } catch {
      toast(code);
    }
  };
  $("#share-code").onclick = shareMyCode;
}
// Compartir mi código: sirve para invitar (quien se da de alta con él) y para
// que alguien que ya es del Club me añada a su ranking de amigos.
async function shareMyCode() {
  const code = user?.ref;
  if (!code) return;
  const url = `${location.origin}/?ref=${encodeURIComponent(code)}`,
    text = L(`Reserva en NOVA Studio con mi código ${code} 💈`, `Book at NOVA Studio with my code ${code} 💈`);
  if (navigator.share) {
    try {
      await navigator.share({ title: "NOVA Studio", text, url });
    } catch {}
  } else window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank", "noopener");
}

// ── Ranking ────────────────────────────────────────────────────────────────
// Se pide cada 6 s mientras está en pantalla (y al volver a la app). El
// servidor solo manda la lista si algo ha cambiado; entonces las filas se
// deslizan a su nuevo puesto y los puntos que cambian se marcan un momento.
let rkGen = 0,
  rkLast = null,
  rkTimer = 0;
const RK_EVERY = 6000;
async function rankingPage(scope) {
  const gen = ++rkGen;
  rkLast = null;
  const r = await api(`ranking?scope=${scope}`);
  if (gen !== rkGen) return;
  show(
    heading("Ranking", L("Puntos ganados en el Club. Canjear premios no te hace bajar.", "Points earned in the Club. Redeeming rewards doesn't move you down.")) +
      `<div class="tabs rk-tabs"><a href="#ranking" class="${scope === "global" ? "active" : ""}">${L("Todo el Club", "Whole Club")}</a><a href="#ranking/amigos" class="${scope === "friends" ? "active" : ""}">${L("Amigos", "Friends")}</a></div>
       <div class="rk-bar"><span class="rk-live" title="${L("Se actualiza solo", "Updates by itself")}"><i aria-hidden="true"></i>${L("En directo", "Live")}</span></div>
       <div id="rk-me" aria-live="polite"></div><ol id="rk-list" class="rk-list"></ol><div id="rk-foot"></div>`,
  );
  rkDraw(r);
  rkPoll(gen);
}
async function rkFetch(gen, force) {
  const s = rkLast;
  if (!s) return;
  try {
    const r = await api(`ranking?scope=${s.scope}${force ? "" : "&v=" + encodeURIComponent(s.v)}`);
    if (gen !== rkGen || document.body.dataset.page !== "ranking" || !$("#rk-list")) return;
    if (!r.same) rkDraw(r);
  } catch {}
}
function rkPoll(gen) {
  clearTimeout(rkTimer);
  const loop = async () => {
    if (gen !== rkGen || document.body.dataset.page !== "ranking") return;
    if (!document.hidden) await rkFetch(gen);
    if (gen === rkGen) rkTimer = setTimeout(loop, rkLast?.building ? 2500 : RK_EVERY);
  };
  rkTimer = setTimeout(loop, rkLast?.building ? 2500 : RK_EVERY);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && document.body.dataset.page === "ranking") rkFetch(rkGen);
});
const ptsWord = (n) => (n === 1 ? L("punto", "point") : L("puntos", "points"));
function rkDraw(r) {
  const prev = rkLast && rkLast.scope === r.scope ? rkLast : null;
  rkLast = r;
  $("#rk-me").innerHTML = rkMe(r);
  rkList(r);
  $("#rk-foot").innerHTML = rkFoot(r);
  // Has subido (o te han pasado): una marca en tu fila y, si subes, un aviso.
  if (prev?.me && r.me && prev.me.r !== r.me.r) {
    const up = r.me.r < prev.me.r,
      row = $("#rk-list .rk-row.me");
    row?.insertAdjacentHTML("beforeend", `<span class="rk-delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(prev.me.r - r.me.r)}</span>`);
    if (up) toast(L(`¡Subes al puesto ${r.me.r}!`, `You're up to #${r.me.r}!`));
  }
  $("#rk-unhide")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api("profile/rank", { show: true });
      await refreshMe();
      rkFetch(rkGen, true);
    } catch (err) {
      toast(err.message);
    }
  });
  $("#rk-add")?.addEventListener("click", rkAddFriend);
  $("#rk-invite")?.addEventListener("click", shareMyCode);
  $$("#rk-list [data-friend]").forEach(
    (el) =>
      (el.onclick = el.onkeydown =
        (e) => {
          if (e.type === "keydown" && e.key !== "Enter") return;
          rkFriendSheet(r.rows.find((x) => String(x.k) === el.dataset.k));
        }),
  );
}
function rkMe(r) {
  const friends = r.scope === "friends",
    per = L("en total", "in total");
  if (r.me) {
    const gap = r.me.ahead
      ? L(
          `Te faltan <b>${nf(r.me.ahead.gap)}</b> ${ptsWord(r.me.ahead.gap)} para adelantar a <b>${esc(r.me.ahead.n)}</b>`,
          `You need <b>${nf(r.me.ahead.gap)}</b> ${ptsWord(r.me.ahead.gap)} to overtake <b>${esc(r.me.ahead.n)}</b>`,
        )
      : r.total > 1
        ? L("Vas el primero. Que no te alcancen.", "You're in first place. Don't let them catch you.")
        : friends
          ? L("Añade a tus amigos para competir con ellos.", "Add your friends to compete with them.")
          : "";
    return `<div class="rk-me"><div class="rk-pos"><small>${friends ? L("Entre tus amigos", "Among your friends") : L("Tu puesto", "Your position")}</small><strong>${r.me.r}<sup>${L("º", "")}</sup></strong><span>${L(`de ${nf(r.total)}`, `of ${nf(r.total)}`)}</span></div>
      <div class="rk-pts"><strong>${nf(r.me.p)}</strong><span>${ptsWord(r.me.p)} ${per}</span></div>${gap ? `<p class="rk-gap">${gap}</p>` : ""}</div>`;
  }
  if (r.building) return `<div class="rk-me rk-off"><p>${L("Preparando el ranking…", "Getting the ranking ready…")}</p></div>`;
  if (!friends && r.hidden)
    return `<div class="rk-me rk-off"><p>${L("No sales en el ranking de todo el Club. Tus amigos sí te ven.", "You're hidden from the whole-Club ranking. Your friends can still see you.")}</p><button type="button" class="btn secondary" id="rk-unhide">${L("Volver a salir", "Show me again")}</button></div>`;
  return `<div class="rk-me rk-off"><p>${L("Aún no sales en el ranking. Apareces en cuanto sumes tus primeros puntos.", "You're not on the ranking yet. You'll appear once you earn your first points.")}</p></div>`;
}
// La cara de cada socio: su foto de perfil o su inicial, con la insignia de su liga.
const rkFace = (x, lg, cls = "rk-av") =>
  `<span class="${cls}">${x.ph ? `<img src="/api/ranking/photo/${esc(x.k)}?v=${esc(x.ph)}" alt="" loading="lazy" decoding="async">` : `<b>${initial(x.n)}</b>`}<i class="rk-lgb">${leagueArt(lg.league)}</i></span>`;
const rkRow = (x, friends) => {
  const lg = leagueOf(x.a || 0),
    tap = friends && !x.me;
  return `${x.out ? `<li class="rk-skip" aria-hidden="true">···</li>` : ""}<li class="rk-row${x.me ? " me" : ""}${x.r <= 3 ? " podium" : ""}" data-k="${esc(x.k)}" data-p="${x.p}" style="${leagueVars(lg.league)}"${tap ? ` data-friend role="button" tabindex="0"` : ""}>
    <span class="rk-r">${x.r}</span>${rkFace(x, lg)}
    <span class="rk-n"><strong>${esc(x.n)}${x.me ? ` <em>${L("Tú", "You")}</em>` : ""}</strong><small>${esc(lg.label)}</small></span>
    <b class="rk-p">${nf(x.p)}</b></li>`;
};
// Pinta la lista y desliza cada fila desde donde estaba (FLIP).
function rkList(r) {
  const list = $("#rk-list"),
    friends = r.scope === "friends";
  const before = new Map([...list.querySelectorAll(".rk-row")].map((el) => [el.dataset.k, { top: el.getBoundingClientRect().top, p: el.dataset.p }]));
  const rows = r.rows || [];
  list.innerHTML = rows.length
    ? rows.map((x) => rkRow(x, friends)).join("")
    : `<li class="rk-empty">${
        friends
          ? L("Aún no tienes amigos en el ranking. Añádelos con su código del Club o invita a alguien nuevo.", "No friends on your ranking yet. Add them with their Club code or invite someone new.")
          : L("Aún no hay nadie en el ranking.", "Nobody on the ranking yet.")
      }</li>`;
  if (!before.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of list.querySelectorAll(".rk-row")) {
    const b = before.get(el.dataset.k);
    if (!b) {
      el.classList.add("rk-in");
      continue;
    }
    const dy = b.top - el.getBoundingClientRect().top;
    if (dy) {
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      void el.offsetWidth;
      el.style.transition = "";
      el.style.transform = "";
    }
    if (b.p !== el.dataset.p) el.classList.add("rk-bump");
  }
}
function rkFoot(r) {
  if (r.scope === "friends")
    return `<div class="rk-actions"><button type="button" class="btn wide" id="rk-add">${svg(ICONS.users)} ${L("Añadir amigo", "Add a friend")}</button><button type="button" class="btn wide secondary" id="rk-invite">${svg(ICONS.share)} ${L("Invitar a alguien nuevo", "Invite someone new")}</button></div>
      <p class="rk-note">${L(
        `Tu código es <b>${esc(r.code)}</b>. Quien ya sea del Club lo pone en «Añadir amigo». Si alguien nuevo lo usa al darse de alta, sumas ${catalog.points.perFriend} puntos con su primera cita.`,
        `Your code is <b>${esc(r.code)}</b>. Club members enter it in “Add a friend”. If someone new uses it when signing up, you earn ${catalog.points.perFriend} points with their first appointment.`,
      )}</p>`;
  return `<p class="rk-note">${
    r.total ? L(`${nf(r.total)} ${r.total === 1 ? "socio" : "socios"} en la lista.`, `${nf(r.total)} ${r.total === 1 ? "member" : "members"} on the board.`) + " " : ""
  }${L("Cada socio sale con el nombre o apodo que eligió. Si prefieres no salir, cámbialo en tu perfil.", "Each member shows with the name or nickname they chose. If you'd rather not appear, change it in your profile.")}</p>`;
}
function rkAddFriend() {
  const sh = sheet(
    `<p class="eyebrow">${L("Ranking de amigos", "Friends ranking")}</p><h2>${L("Añadir amigo", "Add a friend")}</h2>
     <p class="muted">${L("Pídele su código del Club: lo tiene en su perfil, en «Invita y suma».", "Ask for their Club code: it's in their profile, under “Invite and earn”.")}</p>
     <form id="rk-add-f"><label for="rk-code">${L("Su código", "Their code")}</label><input id="rk-code" name="code" required autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="16" placeholder="${L("Ej.: CARLOS482", "E.g. CARLOS482")}">
     <button class="btn wide" style="margin-top:16px" type="submit">${L("Añadir", "Add")}</button></form>`,
  );
  setTimeout(() => sh.el.querySelector("#rk-code")?.focus(), 50);
  onForm("rk-add-f", async (d) => {
    const r = await api("ranking/friends", { code: d.code });
    sh.close();
    toast(L(`${r.name} ya está en tus amigos.`, `${r.name} is now on your friends list.`));
    rkFetch(rkGen, true);
  });
}
function rkFriendSheet(x) {
  if (!x) return;
  const lg = leagueOf(x.a || 0);
  const sh = sheet(
    `<div class="rk-sheet" style="${leagueVars(lg.league)}">${rkFace(x, lg, "rk-av big")}<div><h2>${esc(x.n)}</h2><p class="muted">${esc(lg.label)} · ${nf(x.a || 0)} ${L("puntos ganados", "points earned")}</p></div></div>
     <button type="button" class="btn wide danger" id="rk-rm">${L("Quitar de mis amigos", "Remove from my friends")}</button>`,
  );
  sh.el.querySelector("#rk-rm").onclick = async (e) => {
    const b = e.currentTarget;
    if (b.dataset.sure !== "1") {
      b.dataset.sure = "1";
      b.textContent = L("¿Seguro? Pulsa otra vez", "Sure? Tap again");
      return;
    }
    b.disabled = true;
    try {
      await api("ranking/friends/remove", { id: x.k });
      sh.close();
      rkFetch(rkGen, true);
    } catch (err) {
      b.disabled = false;
      toast(err.message);
    }
  };
}
// Tarjeta de «Puntos y premios»: tu puesto en el Club, a un toque del ranking.
async function rkMini() {
  const el = $("#rk-mini");
  if (!el) return;
  try {
    const r = await api("ranking?scope=global&mini=1");
    if (!document.body.contains(el)) return;
    el.innerHTML = `<span class="rk-mini-ic">${svg(ICONS.trophy)}</span><span class="rk-mini-t"><strong>${
      r.me ? L(`Vas ${r.me.r}º en el Club`, `You're #${r.me.r} in the Club`) : L("Ranking del Club", "Club ranking")
    }</strong><small>${
      r.me?.ahead
        ? L(`${nf(r.me.ahead.gap)} ${ptsWord(r.me.ahead.gap)} para adelantar a ${esc(r.me.ahead.n)}`, `${nf(r.me.ahead.gap)} ${ptsWord(r.me.ahead.gap)} to overtake ${esc(r.me.ahead.n)}`)
        : r.me
          ? L(`de ${nf(r.total)} · ¡vas en cabeza!`, `of ${nf(r.total)} · you're in the lead!`)
          : L("Mira quién va primero y compite con tus amigos", "See who's leading and compete with your friends")
    }</small></span><b aria-hidden="true">›</b>`;
    el.hidden = false;
  } catch {}
}
function rewardRow(r, balance) {
  const can = user && balance >= r.cost;
  return `<div class="rw${can ? " can" : ""}"><span class="rw-ic">${svg(ICONS[r.icon] || ICONS.gift)}</span><div><strong>${esc(r.name)}</strong><span>${esc(r.desc)}</span>${
    user && !can ? `<div class="md-bar"><i style="width:${Math.max(4, Math.round((balance / r.cost) * 100))}%"></i></div>` : ""
  }</div>${can ? `<button type="button" class="rw-btn" data-redeem="${esc(r.id)}">Canjear<small>${nf(r.cost)} pts</small></button>` : `<span class="rw-cost">${nf(r.cost)}<small>pts</small></span>`}</div>`;
}
// Recorta la foto en cuadrado y la deja en ~20 KB.
// Cualquier foto (aunque venga cruda de un iPhone) sale de aquí en .webp de
// 200 KB como mucho, para que la web cargue al instante. Safari no sabe hacer
// webp con <canvas>: entonces sale en .jpg, con el mismo límite.
const LIGHT_MAX = 200 * 1024;
function encodeLight(canvas) {
  let c = canvas;
  for (let round = 0; round < 6; round++) {
    for (const type of ["image/webp", "image/jpeg"]) {
      for (const q of [0.82, 0.72, 0.6, 0.5, 0.4]) {
        const d = c.toDataURL(type, q);
        if (!d.startsWith("data:" + type)) break; // este navegador no sabe ese formato
        if (((d.length - d.indexOf(",") - 1) * 3) / 4 <= LIGHT_MAX) return d;
      }
    }
    // Aún pesa demasiado: se encoge un 20 % y se vuelve a probar.
    const n = document.createElement("canvas");
    n.width = Math.round(c.width * 0.8);
    n.height = Math.round(c.height * 0.8);
    n.getContext("2d").drawImage(c, 0, 0, n.width, n.height);
    c = n;
  }
  throw Error("big");
}
async function shrinkImage(file, size) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(img.naturalWidth, img.naturalHeight),
      c = document.createElement("canvas");
    c.width = c.height = size;
    c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return encodeLight(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}
// Código de amigo que llega en el enlace (?ref=CARLOS482): se guarda para la primera reserva.
function refCode() {
  try {
    return localStorage.getItem("nova_ref") || "";
  } catch {
    return "";
  }
}
{
  const r = new URLSearchParams(location.search).get("ref");
  if (r) {
    try {
      localStorage.setItem("nova_ref", r.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16));
    } catch {}
    history.replaceState(null, "", location.pathname + location.hash);
  }
}
const unidadesTxt = (t) => (t.stock === null ? "sin contar" : `${t.libres} libre${t.libres === 1 ? "" : "s"}${t.apartadas ? ` · ${t.apartadas} apartada${t.apartadas === 1 ? "" : "s"}` : ""}`);

// ── Entrar ─────────────────────────────────────────────────────────────────
function loginScreen(reason, next) {
  try {
    sessionStorage.setItem("nova_next", next);
  } catch {}
  show(
    heading(
      L("Entra o crea tu cuenta", "Log in or sign up"),
      reason ||
        (authCh.code === false
          ? L("Solo con tu correo, sin contraseñas. Si es tu primera vez, la cuenta se crea al entrar.", "Just your email, no passwords. If it's your first time, your account is created as you log in.")
          : L("Te mandamos un código de 6 cifras a tu correo. Si es tu primera vez, la cuenta se crea al entrar.", "We'll send a 6-digit code to your email. The first time, your account is created as you log in.")),
    ) +
      `<div id="auth" class="auth-box"></div>` +
      `<p class="muted" style="margin-top:26px;text-align:center">¿Trabajas en el estudio? <a href="#equipo">Entra en tu panel</a></p>` +
      legalLinks(),
  );
  authFlow($("#auth"), {
    step: user && !user.name ? "name" : "",
    onDone: () => {
      toast(L("¡Hola", "Hi") + (user?.name ? ", " + first(user.name) : "") + "!");
      go(sessionStorage.getItem("nova_next") || "profile");
    },
  });
}

// Entrar y darse de alta son el mismo camino: correo → código de 6 cifras →
// nombre (solo si la cuenta aún no lo tiene). Se pinta dentro de `host`, así
// sirve en «Entrar» y en medio de una reserva sin salir de ella.
// `step: "name"`: la sesión ya está abierta y solo falta el nombre.
function authFlow(host, { step = "", onDone, onStep } = {}) {
  const st = { via: "email", to: "", challenge: "", fresh: false, wait: 0 };
  const draw = (html, focus) => {
    host.innerHTML = html;
    if (focus) setTimeout(() => host.querySelector(focus)?.focus(), 30);
  };
  const finish = async () => {
    await refreshMe();
    nav();
    await onDone?.();
  };

  // 1 · Correo (o teléfono, cuando esté activo).
  const idStep = () => {
    if (!authCh.email && !authCh.phone)
      return draw(
        `<p class="warning">${L("Ahora mismo no podemos mandar códigos para entrar. Para reservar o cambiar una cita, escríbenos por WhatsApp.", "We can't send login codes right now. To book or change an appointment, message us on WhatsApp.")}</p>
         <a class="btn wide wa-btn" href="${wa(L("Hola, quiero reservar una cita.", "Hi, I'd like to book an appointment."))}" target="_blank" rel="noopener">${svg(ICONS.chat)} WhatsApp</a>`,
      );
    if (!authCh.email) st.via = "phone";
    const phone = st.via === "phone";
    draw(
      `<form id="au-id" class="auth-step" novalidate>
        ${
          authCh.email && authCh.phone
            ? `<div class="auth-via" role="tablist"><button type="button" role="tab" data-via="email" aria-selected="${!phone}">${L("Correo", "Email")}</button><button type="button" role="tab" data-via="phone" aria-selected="${phone}">${L("Teléfono", "Phone")}</button></div>`
            : ""
        }
        ${
          phone
            ? `<label for="au-to">${L("Tu número de móvil", "Your mobile number")}</label><input id="au-to" name="to" type="tel" inputmode="tel" required autocomplete="tel" maxlength="22" placeholder="+34 600 000 000" value="${esc(st.via === "phone" ? st.to : "")}">`
            : `<label for="au-to">${L("Tu correo", "Your email")}</label><input id="au-to" name="to" type="email" inputmode="email" required autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120" value="${esc(st.via === "email" ? st.to : "")}">`
        }
        <button class="btn wide" type="submit">${authCh.code === false ? L("Continuar", "Continue") : L("Recibir código", "Get a code")}</button>
        <p class="auth-note">${
          authCh.code === false
            ? L("Sin contraseñas: con tu correo basta.", "No passwords: your email is enough.")
            : phone
              ? L("Te mandamos un código de 6 cifras por SMS para comprobar que el número es tuyo.", "We'll text you a 6-digit code to check the number is yours.")
              : L("Te mandamos un código de 6 cifras para comprobar que el correo es tuyo.", "We'll send you a 6-digit code to check the email is yours.")
        }</p>
      </form>`,
      "#au-to",
    );
    host.querySelectorAll("[data-via]").forEach(
      (b) =>
        (b.onclick = () => {
          st.via = b.dataset.via;
          idStep();
        }),
    );
    onForm("au-id", async (d, f) => {
      const input = f.querySelector("#au-to");
      if (!input.reportValidity()) return;
      st.to = String(d.to || "").trim();
      const r = await send();
      // Sin código (aún no hay correo montado): se entra ya y, si falta, se pide el nombre.
      if (r.direct) {
        st.fresh = !!r.fresh;
        await refreshMe();
        nav();
        return r.needName ? nameStep() : finish();
      }
      codeStep();
    });
  };
  const send = async () => {
    const r = await api("auth/request", st.via === "phone" ? { phone: st.to } : { email: st.to });
    st.challenge = r.challenge;
    st.wait = Date.now() + 30000;
    if (r.dev) toast("Modo prueba: el código sale en la consola del servidor.");
    return r;
  };

  // 2 · El código.
  const codeStep = () => {
    draw(
      `<form id="au-code" class="auth-step" novalidate>
        <p class="auth-to">${L("Código enviado a", "Code sent to")} <b>${esc(st.to)}</b> <button type="button" class="link-btn" id="au-back">${L("Cambiar", "Change")}</button></p>
        <label for="au-c">${L("Código de 6 cifras", "6-digit code")}</label>
        <input id="au-c" class="code-input" name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="······">
        <button class="btn wide" type="submit">${L("Entrar", "Log in")}</button>
        <p class="auth-note">${L("Caduca en diez minutos. Si no lo ves, mira en spam o promociones.", "It expires in ten minutes. If you can't see it, check spam or promotions.")} <button type="button" class="link-btn" id="au-again"></button></p>
      </form>`,
      "#au-c",
    );
    const again = host.querySelector("#au-again"),
      input = host.querySelector("#au-c");
    const tick = () => {
      if (!host.contains(again)) return;
      const left = Math.ceil((st.wait - Date.now()) / 1000);
      again.disabled = left > 0;
      again.textContent = left > 0 ? L(`Reenviar en ${left} s`, `Resend in ${left} s`) : L("Reenviar código", "Resend code");
      if (left > 0) setTimeout(tick, 1000);
    };
    tick();
    again.onclick = async () => {
      again.disabled = true;
      try {
        await send();
        toast(L("Te hemos mandado otro código.", "We've sent you another code."));
        input.value = "";
        input.focus();
      } catch (e) {
        toast(e.message);
      }
      tick();
    };
    host.querySelector("#au-back").onclick = idStep;
    // Con las 6 cifras puestas (o pegadas) se entra solo.
    input.oninput = () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
      if (input.value.length === 6) host.querySelector("#au-code").requestSubmit();
    };
    let checking = false;
    onForm("au-code", async (d) => {
      const code = String(d.code || "").replace(/\D/g, "");
      if (code.length !== 6) return toast(L("El código tiene 6 cifras.", "The code has 6 digits."));
      if (checking) return;
      checking = true;
      let r;
      try {
        r = await api("auth/verify", { code, challenge: st.challenge });
      } catch (e) {
        input.select();
        throw e;
      } finally {
        checking = false;
      }
      st.fresh = !!r.fresh;
      if (r.needName) {
        await refreshMe();
        nav();
        return nameStep();
      }
      await finish();
    });
  };

  // 3 · El nombre, que es el que sale en el ranking. Si la cuenta es nueva,
  // también el código del amigo que te invitó.
  const nameStep = () => {
    onStep?.("name");
    draw(
      `<form id="au-name" class="auth-step" novalidate>
        ${st.fresh ? `<p class="auth-welcome">${L(`¡Ya eres del Club! Tienes <b>${catalog.points.welcome} puntos</b> de regalo.`, `You're in the Club! You've got <b>${catalog.points.welcome} points</b> as a gift.`)}</p>` : ""}
        <label for="au-n">${L("Tu nombre", "Your name")}</label>
        <input id="au-n" name="name" required minlength="2" maxlength="60" autocomplete="name" autocapitalize="words" placeholder="${L("Tu nombre o un apodo", "Your name or a nickname")}" value="${esc(user?.name || "")}">
        <p class="auth-note">${L("Solo te lo pedimos esta vez. Es el nombre de tu reserva y el que sale en el ranking del Club.", "We only ask once. It's the name on your booking and in the Club ranking.")}</p>
        <p class="auth-note" id="au-prev"></p>
        <label for="au-p">${L("Teléfono", "Phone")} <small class="opt">${L("(opcional, por si el estudio necesita contactarte)", "(optional, in case the studio needs to reach you)")}</small></label>
        <input id="au-p" name="phone" type="tel" inputmode="tel" maxlength="30" autocomplete="tel" placeholder="+34 600 000 000" value="${esc(user?.phone || "")}">
        ${st.fresh || step === "name" ? refBoxHtml() : ""}
        <button class="btn wide" type="submit">${L("Continuar", "Continue")}</button>
      </form>`,
      "#au-n",
    );
    const n = host.querySelector("#au-n"),
      prev = host.querySelector("#au-prev");
    const preview = () => {
      const r = rankName(n.value);
      prev.innerHTML = r ? L(`Así saldrás en el ranking del Club: <b>${esc(r)}</b>`, `This is how you'll appear in the Club ranking: <b>${esc(r)}</b>`) : L("Puede ser tu nombre o un apodo. Así te verá tu barbero y así saldrás en el ranking del Club.", "It can be your name or a nickname. Your barber will see it, and so will the Club ranking.");
    };
    n.oninput = preview;
    preview();
    const ref = bindRefBox(host);
    onForm("au-name", async (d) => {
      if (!n.reportValidity()) return;
      const code = await ref.value();
      if (code === false) return toast(L("Ese código de amigo no existe. Revísalo o bórralo.", "That friend code doesn't exist. Check it or clear it."));
      await api("auth/name", { name: String(d.name || "").trim(), ref: code || "", phone: String(d.phone || "").trim() });
      try {
        localStorage.removeItem("nova_ref");
      } catch {}
      await finish();
    });
  };

  (step === "name" ? nameStep : idStep)();
}
// Nombre o apodo tal cual, hasta 20 letras (igual que el servidor).
function rankName(name) {
  const s = String(name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (s.length <= 20) return s;
  const cut = s.slice(0, 21);
  return cut.includes(" ") ? cut.replace(/\s+\S*$/, "") : s.slice(0, 20);
}
// «¿Te ha invitado un amigo?»: el código se comprueba mientras se escribe y dice quién te invita.
const refBoxHtml = () =>
  `<div class="ref-box${refCode() ? " open" : ""}" id="ref-box"><button type="button" class="ref-toggle" id="ref-toggle"><span aria-hidden="true">🎁</span>¿Te ha invitado un amigo?<b>Pon su código</b></button>
    <div class="ref-field"><label for="ref-input">${L("Código del amigo que te invitó", "Code of the friend who invited you")} <small class="opt">${L("(si tienes)", "(if you have one)")}</small></label><input id="ref-input" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="16" placeholder="Ej.: CARLOS482" value="${esc(refCode())}"><p class="ref-state" id="ref-state" aria-live="polite"></p></div></div>`;
// Devuelve value(): el código válido, "" si no hay, o false si el que hay no existe.
function bindRefBox(root) {
  const refIn = root.querySelector("#ref-input"),
    refState = root.querySelector("#ref-state");
  if (!refIn) return { value: async () => "" };
  let ok = null,
    t = 0;
  const check = async () => {
    const code = (refIn.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (refIn.value !== code) refIn.value = code;
    ok = null;
    refState.className = "ref-state";
    refState.textContent = "";
    if (code.length < 4) return;
    refState.textContent = "Comprobando…";
    try {
      const r = await api("referral/" + encodeURIComponent(code));
      if (refIn.value !== code) return;
      ok = code;
      refState.className = "ref-state ok";
      refState.innerHTML = L(
        `✓ Te invita <b>${esc(r.name)}</b>. ${esc(r.name)} sumará ${r.points} puntos cuando vengas a tu primera cita, y os veréis en el ranking de amigos.`,
        `✓ Invited by <b>${esc(r.name)}</b>. ${esc(r.name)} will earn ${r.points} points when you come to your first appointment, and you'll see each other in the friends ranking.`,
      );
    } catch (err) {
      if (refIn.value !== code) return;
      ok = false;
      refState.className = "ref-state bad";
      refState.textContent = err.message;
    }
  };
  root.querySelector("#ref-toggle").onclick = () => {
    root.querySelector("#ref-box").classList.add("open");
    setTimeout(() => refIn.focus(), 50);
  };
  refIn.oninput = () => {
    clearTimeout(t);
    t = setTimeout(check, 350);
  };
  if (refIn.value) check();
  return {
    value: async () => {
      if (!refIn.value) return "";
      if (ok === null) await check();
      return ok || false;
    },
  };
}

// ── Productos del estudio ──────────────────────────────────────────────────
// Lo que se vende en el local. El dueño los sube desde su panel (pestaña
// «Productos»); aquí se enseñan y se compran en el estudio.
let productsP = null;
const loadProducts = (fresh) => {
  if (fresh || !productsP) {
    productsP = api("products").then((r) => r.products);
    productsP.catch(() => (productsP = null));
  }
  return productsP;
};
const prodImg = (p, cls = "") => (p.img ? `<img class="${cls}" src="/api/products/${esc(p.id)}/photo?v=${esc(p.img)}" alt="" loading="lazy">` : `<span class="${cls} pr-noimg" aria-hidden="true">${svg(ICONS.jar)}</span>`);
const prodCard = (p) =>
  `<button type="button" class="pr-card${p.soldOut ? " out" : ""}" data-prod="${esc(p.id)}">
    <span class="pr-pic">${prodImg(p)}${p.soldOut ? `<em>Agotado</em>` : ""}</span>
    ${p.brand ? `<small>${esc(p.brand)}</small>` : ""}<strong>${esc(p.name)}</strong><b>${euro(p.price)}</b>
  </button>`;
function bindProducts(list) {
  $$("[data-prod]").forEach(
    (el) =>
      (el.onclick = () => {
        const p = list.find((x) => x.id === el.dataset.prod);
        if (!p) return;
        sheet(
          `<div class="pr-sheet"><span class="pr-big">${prodImg(p)}</span>
            ${p.brand ? `<p class="eyebrow">${esc(p.brand)}</p>` : ""}<h2>${esc(p.name)}</h2>
            <p class="pr-price">${euro(p.price)}${p.soldOut ? ` <span class="appt-state st-cancel">Agotado</span>` : ""}</p>
            ${p.desc ? `<p>${esc(p.desc)}</p>` : ""}
            <p class="muted">Se compra en el estudio. Pídeselo a tu barbero en tu próxima cita.</p>
            <a class="btn wide wa-btn" target="_blank" rel="noopener" href="${wa(L(`Hola, me interesa ${p.name}${p.brand ? " de " + p.brand : ""}. ¿Lo tenéis?`, `Hi, I'm interested in ${p.name}${p.brand ? " by " + p.brand : ""}. Do you have it?`))}">${svg(ICONS.chat)} Preguntar por WhatsApp</a></div>`,
        );
      }),
  );
}
// En la portada: los primeros productos, si hay alguno.
async function initProducts() {
  const box = $("#home-products");
  if (!box) return;
  let list;
  try {
    list = (await loadProducts()).filter((p) => p.visible !== false);
  } catch {
    return;
  }
  if (!list.length || !document.body.contains(box)) return;
  box.innerHTML = `<section class="home-block" aria-labelledby="prod-title">
    <p class="eyebrow">En el estudio</p>
    <h2 id="prod-title">Productos <em class="serif">para casa.</em></h2>
    <div class="pr-grid">${list.slice(0, 4).map(prodCard).join("")}</div>
    ${list.length > 4 ? `<div class="home-actions"><a class="btn secondary" href="#productos">${L(`Ver los ${list.length} productos`, `See all ${list.length} products`)}</a></div>` : ""}
  </section>`;
  bindProducts(list);
}
async function productsPage() {
  const list = (await loadProducts(true)).filter((p) => p.visible !== false);
  show(
    back("home", "Inicio") +
      heading("Productos", "Lo que usamos en la silla, para que lo tengas en casa. Se compran en el estudio.") +
      (list.length ? `<div class="pr-grid">${list.map(prodCard).join("")}</div>` : `<p class="ag-free">Pronto subiremos los productos del estudio.</p>`) +
      legalLinks(),
  );
  bindProducts(list);
}


// ── NOVA Supply en la app: pedir ropa y recogerla en el local ──────────────
// El catálogo, el stock y las ventas son los de la tienda (el servidor aparta las
// unidades al hacer el pedido). Se paga siempre en el local; con Stripe también
// online, y en demo el pago online es simulado.
let shopData = null;
let cart = []; // [{ prenda, talla, cantidad }]
async function loadShop(force) {
  if (force || !shopData) shopData = await api("shop");
  return shopData;
}
const supImg = (p, cls = "") => (p.img ? `<img class="${cls}" src="/api/supply/${esc(p.id)}/photo?v=${esc(p.img)}" alt="${esc(p.nombre)}" loading="lazy">` : `<span class="${cls} pr-noimg" aria-hidden="true">${svg(ICONS.shirt)}</span>`);
const supName = (p) => p.nombre + (p.variante ? " · " + p.variante : "");
// Precio final que calcula el servidor: promo de novasupply.es o descuento de socio (el mejor, no se suman).
const supUnit = (p) => (p.precioFinal != null ? p.precioFinal : p.precio);
const supPrice = (p) => (supUnit(p) < p.precio ? `<s>${euro(p.precio)}</s> <b>${euro(supUnit(p))}</b>` : `<b>${euro(p.precio)}</b>`);
// «Black Friday · Del 23 al 30 de noviembre» (solo si esa prenda tiene la promo aplicada).
const supPromo = (p, shop) => (p.aplicado === "promo" && shop?.oferta ? `<span class="sup-promo">${esc(shop.oferta.nombre)} · ${esc(shop.oferta.fechas)}</span>` : "");
const cartTotal = (shop) => Math.round(cart.reduce((a, l) => a + supUnit(shop.prendas.find((p) => p.id === l.prenda) || { precio: 0 }) * l.cantidad, 0) * 100) / 100;
const ORDER_STATE = {
  pendiente: ["Pendiente de pago", "Awaiting payment", "st-wait"],
  pagado: ["Pagado", "Paid", "st-ok"],
  listo: ["Listo para recoger", "Ready for pickup", "st-ok"],
  entregado: ["Entregado", "Delivered", ""],
  cancelado: ["Cancelado", "Cancelled", "st-cancel"],
};
const orderState = (o) => {
  const [es, en, cls] = ORDER_STATE[o.estado] || ORDER_STATE.pendiente;
  return `<span class="appt-state ${cls}">${L(es, en)}</span>`;
};
const orderWhere = (o) => (o.booking ? L("Lo recoges en tu cita", "Pick it up at your visit") : L("Lo recoges en el local cuando quieras", "Pick it up at the studio any time"));

function supplyCartBox(shop) {
  if (!cart.length) return `<p class="muted sup-empty">${L("Elige una prenda, su talla y cuántas quieres.", "Pick an item, its size and how many.")}</p>`;
  const total = cartTotal(shop);
  const pays = [
    ["local", L("Pagar en el local", "Pay at the studio"), L("En efectivo o con tarjeta, al recogerlo.", "Cash or card, when you collect it.")],
    ...(shop.online ? [["online", shop.online === "demo" ? L("Pagar ahora (simulado)", "Pay now (simulated)") : L("Pagar ahora con tarjeta", "Pay now by card"), shop.online === "demo" ? L("Modo demo: no se cobra nada de verdad.", "Demo mode: nothing is really charged.") : L("Pago seguro con Stripe.", "Secure payment with Stripe.")]] : []),
  ];
  return `<div class="card sup-cart"><p class="section-label" style="margin-top:0">${L("Tu pedido", "Your order")}</p>
    ${cart
      .map((l, i) => {
        const p = shop.prendas.find((x) => x.id === l.prenda);
        return `<div class="sup-line"><span><strong>${esc(supName(p))}</strong><small>${L("Talla", "Size")} ${esc(l.talla)} × ${l.cantidad}</small></span><b>${euro(supUnit(p) * l.cantidad)}</b><button type="button" class="sup-x" data-sup-rm="${i}" aria-label="${L("Quitar", "Remove")}">×</button></div>`;
      })
      .join("")}
    <div class="sup-total"><span>Total</span><strong>${euro(total)}</strong></div>
    ${cart.some((l) => shop.prendas.find((p) => p.id === l.prenda)?.aplicado === "socio") ? `<p class="mem-hint">${L(`Incluye tu ${shop.discountPct} % de descuento de socio NOVA+.`, `Includes your ${shop.discountPct}% NOVA+ member discount.`)}</p>` : ""}
    ${cart.some((l) => shop.prendas.find((p) => p.id === l.prenda)?.aplicado === "promo") ? `<p class="mem-hint">${L(`Incluye la promo ${esc(shop.oferta.nombre)} (${esc(shop.oferta.fechas)}). No se suma al descuento de socio: se aplica el mejor.`, `Includes the ${esc(shop.oferta.nombre)} offer (${esc(shop.oferta.fechas)}). It doesn't stack with the member discount: the better one applies.`)}</p>` : ""}
    <div class="sup-pay">${pays.map(([v, t, d], i) => `<label class="sup-pay-opt"><input type="radio" name="sup-pay" value="${v}" ${i === 0 ? "checked" : ""}><span><b>${t}</b><small>${d}</small></span></label>`).join("")}</div>
    <p class="muted" style="font-size:12px">${L(`Sumas ${nf(Math.round(total * catalog.points.perEuro))} puntos del Club cuando se cobre. Entrega: recoger en el local.`, `You earn ${nf(Math.round(total * catalog.points.perEuro))} Club points once it's paid. Delivery: pick up at the studio.`)}</p>
    <button type="button" class="btn wide" id="sup-go">${L("Hacer el pedido", "Place order")}</button></div>`;
}

function supplySheet(shop, p, redraw) {
  const open = p.tallas.filter((t) => t.max > 0);
  const sh = sheet(`<div class="pr-sheet"><span class="pr-big">${supImg(p)}</span>
    <h2>${esc(supName(p))}</h2><p class="pr-price">${supPrice(p)}</p>${supPromo(p, shop) ? `<p class="sup-promo-row">${supPromo(p, shop)}</p>` : ""}
    ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ""}
    ${
      open.length
        ? `<p class="section-label">${L("Talla", "Size")}</p><div class="tchips">${p.tallas.map((t) => `<label class="tchip${t.max ? "" : " dis"}"><input type="radio" name="sup-t" value="${esc(t.talla)}" ${t.max ? "" : "disabled"}><span>${esc(t.talla)}</span></label>`).join("")}</div>
      <label for="sup-q">${L("Cuántas", "How many")}</label><select id="sup-q"></select>
      <button type="button" class="btn wide" id="sup-add" style="margin-top:14px">${L("Añadir al pedido", "Add to order")}</button>`
        : `<p class="warning">${L("Ahora mismo no queda ninguna talla.", "No sizes left right now.")}</p>`
    }
    <p class="muted" style="font-size:12px">${L("Se recoge en el local. Se paga allí o, si quieres, online.", "Pick-up at the studio. Pay there or, if you prefer, online.")}</p></div>`);
  const q = sh.el.querySelector("#sup-q");
  const fill = (t) => {
    const max = Math.min(10, p.tallas.find((x) => x.talla === t)?.max || 0);
    q.innerHTML = Array.from({ length: max }, (_, i) => `<option>${i + 1}</option>`).join("");
  };
  fill("");
  sh.el.querySelectorAll("[name=sup-t]").forEach((r) => (r.onchange = () => fill(r.value)));
  const add = sh.el.querySelector("#sup-add");
  if (add)
    add.onclick = () => {
      const t = sh.el.querySelector("[name=sup-t]:checked")?.value;
      if (!t) return toast(L("Elige la talla.", "Pick a size."));
      const n = Number(q.value) || 1;
      const prev = cart.find((l) => l.prenda === p.id && l.talla === t);
      const max = p.tallas.find((x) => x.talla === t).max;
      if (prev) prev.cantidad = Math.min(max, prev.cantidad + n);
      else cart.push({ prenda: p.id, talla: t, cantidad: n });
      sh.close();
      redraw();
    };
}

async function supplyPage() {
  // Al volver de Stripe (?pedido=…&pago=ok|cancel): se pone al día el pedido, que el webhook puede tardar.
  const ret = new URLSearchParams(location.search);
  const back_ = ret.get("pedido");
  if (back_ && user) {
    history.replaceState(null, "", "/#supply");
    if (ret.get("pago") === "ok") {
      try {
        const r = await api(`shop/orders/${encodeURIComponent(back_)}?sync=1`);
        toast(r.order.estado === "pagado" ? L("¡Pago recibido! Te lo guardamos para recoger.", "Payment received! We'll keep it for you to collect.") : L("Estamos confirmando tu pago. Mira «Mis pedidos» en un momento.", "We're confirming your payment. Check “My orders” in a moment."));
      } catch (e) {
        toast(e.message);
      }
    } else toast(L("No se ha hecho ningún cobro. Tu pedido sigue guardado: puedes pagarlo en el local o cancelarlo.", "Nothing was charged. Your order is still saved: you can pay at the studio or cancel it."));
  }
  const shop = await loadShop(true);
  let orders = [];
  if (user) orders = (await api("shop/orders").catch(() => ({ orders: [] }))).orders;
  const draw = () => {
    show(
      back("home", "Inicio") +
        heading("NOVA Supply", L("La ropa de la casa. La pides aquí y la recoges en el local, en tu cita o cuando quieras.", "The house clothing. Order here and pick it up at the studio, at your visit or whenever you like.")) +
        (shop.discountPct ? `<p class="mem-hint">${L(`Como socio NOVA+ tienes ${shop.discountPct} % de descuento (si hay promo, se aplica la mejor de las dos): ya está en los precios.`, `As a NOVA+ member you get ${shop.discountPct}% off (if there's an offer, the better of the two applies): it's already in the prices.`)}</p>` : "") +
        (shop.oferta?.activa ? `<p class="mem-hint">${esc(shop.oferta.nombre)} · ${esc(shop.oferta.fechas)}: −${shop.oferta.descuento} %</p>` : "") +
        (shop.prendas.length
          ? `<div class="pr-grid">${shop.prendas.map((p) => `<button type="button" class="pr-card" data-sup="${esc(p.id)}"><span class="pr-pic">${supImg(p)}</span><strong>${esc(supName(p))}</strong><span class="pr-p">${supPrice(p)}</span>${supPromo(p, shop)}</button>`).join("")}</div>`
          : `<p class="ag-free">${L("Ahora mismo no hay prendas para pedir. Vuelve pronto.", "Nothing to order right now. Check back soon.")}</p>`) +
        `<div id="sup-cart">${shop.prendas.length ? supplyCartBox(shop) : ""}</div>` +
        (orders.length
          ? `<p class="section-label">${L("Mis pedidos", "My orders")}</p>` +
            orders
              .map(
                (o) => `<div class="card sup-order"><div class="tr-item-top"><div><strong>${o.items.map((l) => esc(l.nombre) + " · " + esc(l.talla) + (l.cantidad > 1 ? " × " + l.cantidad : "")).join(", ")}</strong><span>${euro(o.total)} · ${esc(o.pay === "local" ? L("pago en el local", "pay at the studio") : o.pay === "demo" ? L("pago simulado", "simulated payment") : L("pagado online", "paid online"))} · ${orderWhere(o)}</span></div>${orderState(o)}</div>
                  ${o.estado === "pendiente" ? `<div class="form-actions" style="margin-top:8px">${o.url ? `<a class="btn small" href="${esc(o.url)}">${L("Terminar el pago", "Finish payment")}</a>` : ""}<button type="button" class="btn small secondary" data-sup-cancel="${esc(o.id)}">${L("Cancelar pedido", "Cancel order")}</button></div>` : ""}</div>`,
              )
              .join("")
          : "") +
        legalLinks(),
    );
    $$("[data-sup]").forEach((b) => (b.onclick = () => supplySheet(shop, shop.prendas.find((p) => p.id === b.dataset.sup), draw)));
    $$("[data-sup-rm]").forEach(
      (b) =>
        (b.onclick = () => {
          cart.splice(Number(b.dataset.supRm), 1);
          draw();
        }),
    );
    $$("[data-sup-cancel]").forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          try {
            await api(`shop/orders/${encodeURIComponent(b.dataset.supCancel)}/cancel`, {});
            toast(L("Pedido cancelado.", "Order cancelled."));
            render();
          } catch (e) {
            b.disabled = false;
            toast(e.message);
          }
        }),
    );
    const go_ = $("#sup-go");
    if (go_)
      go_.onclick = async () => {
        if (!user) return loginScreen(L("Entra con tu correo para hacer el pedido.", "Sign in with your email to place your order."), "supply");
        go_.disabled = true;
        try {
          const r = await api("shop/orders", { items: cart, pay: $("[name=sup-pay]:checked")?.value === "online" ? "online" : "local" }, { timeout: 20000 });
          cart = [];
          if (r.url) return void (location.href = r.url); // Stripe Checkout
          toast(r.demo ? L("¡Pedido pagado! (modo demo, sin cobro real)", "Order paid! (demo mode, no real charge)") : L("¡Pedido hecho! Te lo guardamos para recoger y pagar en el local.", "Order placed! We'll keep it for you to collect and pay at the studio."));
          render();
        } catch (e) {
          go_.disabled = false;
          if (e.status === 401) return loginScreen(e.message, "supply");
          toast(e.message);
          if (e.status === 409) render();
        }
      };
  };
  draw();
}

// Paso opcional al reservar: «Añade algo para recoger en el local».
function merchBox(shop) {
  if (!shop?.prendas?.length) return "";
  return `<details class="merch-box"><summary>${svg(ICONS.bag)} ${L("Añade algo para recoger en el local", "Add something to pick up at the studio")}</summary>
    <p class="muted" style="margin:8px 0 10px;font-size:13px">${L("Te lo guardamos y lo recoges en tu cita. Se paga en el local.", "We'll keep it for you to collect at your visit. Pay at the studio.")}</p>
    ${shop.prendas
      .map((p) => {
        const open = p.tallas.filter((t) => t.max > 0);
        return `<div class="merch-row"><span class="merch-pic">${supImg(p)}</span><div class="merch-txt"><strong>${esc(supName(p))}</strong><span>${supPrice(p)}</span>${supPromo(p, shop)}
          ${
            open.length
              ? `<div class="merch-pick"><select name="mt-${esc(p.id)}" aria-label="${L("Talla", "Size")}"><option value="">${L("Talla…", "Size…")}</option>${open.map((t) => `<option value="${esc(t.talla)}">${esc(t.talla)}</option>`).join("")}</select><select name="mq-${esc(p.id)}" aria-label="${L("Cantidad", "Quantity")}">${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select></div>`
              : `<small>${L("Agotada", "Sold out")}</small>`
          }</div></div>`;
      })
      .join("")}
    <p class="merch-total" id="merch-total"></p></details>`;
}
function merchPicked(shop, d) {
  return (shop?.prendas || []).filter((p) => d["mt-" + p.id]).map((p) => ({ prenda: p.id, talla: d["mt-" + p.id], cantidad: Number(d["mq-" + p.id]) || 1 }));
}
function bindMerchBox(shop) {
  const f = $("#details"),
    out = $("#merch-total");
  if (!f || !out) return;
  const upd = () => {
    const list = merchPicked(shop, Object.fromEntries(new FormData(f)));
    const total = Math.round(list.reduce((a, l) => a + supUnit(shop.prendas.find((p) => p.id === l.prenda)) * l.cantidad, 0) * 100) / 100;
    out.textContent = list.length ? L(`Para recoger en la cita: ${euro(total)}, se paga en el local.`, `To pick up at your visit: ${euro(total)}, paid at the studio.`) : "";
  };
  f.addEventListener("change", upd);
  upd();
}

// ── Equipo y normas (solo el dueño) ────────────────────────────────────────
// Airam pone aquí cuántas horas antes se puede cancelar gratis, cuánto se
// cobra si alguien cancela tarde o no viene, y lleva el equipo: altas,
// cambios, horario, servicios, comisión, clave y bajas.
// ── Tu cita de siempre ─────────────────────────────────────────────────────
// Con lo que suele pedir el cliente (día, hora, barbero, servicio y cada
// cuánto viene) se le propone la próxima cita y se reserva en un toque.
const DAY_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DAY_LONG = new Proxy([], { get: (_, k) => (LANG === "en" ? DAY_EN : DAY_ES)[k] });
const everyText = (d) =>
  !d
    ? ""
    : LANG === "en"
      ? d === 1
        ? "every day"
        : d % 7 === 0
          ? d === 7
            ? "every week"
            : `every ${d / 7} weeks`
          : `every ${d} days`
      : d === 1
        ? "cada día"
        : d % 7 === 0
          ? d === 7
            ? "cada semana"
            : `cada ${d / 7} semanas`
          : `cada ${d} días`;
async function initHabit(h) {
  const box = $("#habit-card");
  if (!box) return;
  const s = svcById(h.service),
    p = provById(h.provider);
  // Primera fecha posible: cuando «le toca» (o mañana) y en su día de la semana.
  let from = salonDate();
  from.setDate(from.getDate() + 1);
  if (h.every) {
    const due = dayDate(h.last);
    due.setDate(due.getDate() + h.every);
    if (due > from) from = due;
  }
  while (from.getDay() !== h.weekday) from.setDate(from.getDate() + 1);
  let pick = null;
  for (let w = 0; w < 6 && !pick; w++) {
    const iso = isoDay(from);
    try {
      const days = await getAvail(s.id, p.id, iso.slice(0, 7));
      const times = days[iso] || [];
      if (times.length) {
        const near = times.includes(h.start) ? h.start : times.slice().sort((a, b) => Math.abs(hm(a) - hm(h.start)) - Math.abs(hm(b) - hm(h.start)))[0];
        if (Math.abs(hm(near) - hm(h.start)) <= 120) pick = { date: iso, start: near };
      }
    } catch {}
    from.setDate(from.getDate() + 7);
  }
  if (!document.body.contains(box)) return;
  const when = pick ? `${cap(DAY_LONG[dayDate(pick.date).getDay()])} ${dayDate(pick.date).getDate()} ${fmtDay(pick.date, { month: "short" })} · ${pick.start}` : "";
  box.outerHTML = `<section class="habit${h.due ? " due" : ""}">
    <p class="eyebrow">${h.due ? "Te toca" : "Tu cita de siempre"}</p>
    <div class="habit-main">${face(p, "habit-face")}<div><strong>${esc(cap(DAY_LONG[h.weekday]).replace(/([^s])$/, "$1s"))}${h.start ? " · " + esc(h.start) : ""}</strong><span>${esc(tx(s.name))} ${L("con", "with")} ${esc(first(p.name))}${h.every ? " · " + esc(everyText(h.every)) : ""}</span></div></div>
    ${
      pick
        ? `<button type="button" class="btn wide" id="habit-go">${L("Reservar", "Book")} ${esc(when)}</button>`
        : `<a class="btn wide secondary" href="#time/${esc(p.id)}" id="habit-cal">${L(`Ver huecos con ${esc(first(p.name))}`, `See free times with ${esc(first(p.name))}`)}</a>`
    }
    <small>${h.due ? L(`Hace ${h.since} días de tu último corte.`, `It's been ${h.since} days since your last haircut.`) : "Lo calculamos con tus últimas citas."}</small>
  </section>`;
  const go2 = $("#habit-go");
  if (go2)
    go2.onclick = () => {
      tap();
      draft = { service: s.id, provider: p.id, date: pick.date, start: pick.start };
      calMonth = pick.date.slice(0, 7);
      selectedDate = pick.date;
      dayPicked = true;
      saveDraft();
      go("details");
    };
  const cal = $("#habit-cal");
  if (cal)
    cal.onclick = () => {
      draft = { service: s.id };
      saveDraft();
    };
}

// ── Aviso temporal, logo y galería (lo que Airam cambia en «Web») ──────────
function siteChrome() {
  let flag = $("#demo-flag");
  if (authCh.demo) {
    if (!flag) {
      flag = document.createElement("div");
      flag.id = "demo-flag";
      flag.className = "demo-flag";
      flag.textContent = "Modo demo";
      document.body.prepend(flag);
    }
  } else flag?.remove();
  const n = catalog?.site?.notice;
  let bar = $("#site-notice");
  if (n && !document.body.dataset.page?.startsWith("equipo")) {
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "site-notice";
      bar.setAttribute("role", "status");
      $("#app").before(bar);
    }
    bar.className = "site-notice " + n.tone;
    bar.textContent = n.text;
  } else bar?.remove();
  const logo = catalog?.site?.photos?.logo;
  const img = $(".hdr-logo img");
  if (img) {
    const want = logo ? `/api/site/logo/photo?v=${encodeURIComponent(logo)}` : "/assets/logo.png";
    if (img.getAttribute("src") !== want) {
      img.onerror = () => ((img.onerror = null), img.setAttribute("src", "/assets/logo.png"));
      img.setAttribute("src", want);
    }
  }
}
function galleryBlock() {
  const g = catalog?.site?.gallery || [];
  if (!g.length) return "";
  return `<section class="home-block" aria-labelledby="gal-title">
    <p class="eyebrow">Trabajos recientes</p>
    <h2 id="gal-title">Recién salidos <em class="serif">de la silla.</em></h2>
    <div class="gal-grid">${g.map((id) => `<figure><img src="${esc(pic(id))}" alt="Corte reciente hecho en el estudio" loading="lazy"></figure>`).join("")}</div>
  </section>`;
}

// ── Fotos de la web y reseñas (solo el dueño) ──────────────────────────────
// Cada foto de la web tiene un hueco. Si Airam sube otra desde su panel
// (pestaña «Web»), sale la suya; si no, la original.
const PIC_DEFAULT = { hero: "/assets/hero-plata.jpg", "hero-wide": "/assets/hero-plata-wide.jpg", cabina: "/assets/cabina.jpg", acabado: "/assets/acabado.jpg", oficio: "/assets/oficio.jpg", casa: "/assets/casa.jpg", supply: "/assets/supply.jpg", "supply-rosa": "/assets/supply-rosa.jpg", formacion: "/assets/oficio.jpg" };
const PIC_ROSA = { hero: "/assets/hero-rosa.jpg", "hero-wide": "/assets/hero-rosa-wide.jpg" };
const webpOf = (url) => (String(url).startsWith("/assets/") && url.endsWith(".jpg") ? url.replace(/\.jpg$/, ".webp") : "");
// WebP primero (más ligero en el móvil) y el JPEG si el navegador no lo entiende.
function heroPicture() {
  const wide = pic("hero-wide"),
    port = pic("hero"),
    land = ' media="(orientation: landscape)"';
  const webp = (url, media = "") => (webpOf(url) ? `<source type="image/webp"${media} srcset="${esc(webpOf(url))}">` : "");
  return `<picture>${webp(wide, land)}<source${land} srcset="${esc(wide)}">${webp(port)}<img class="hero-photo" src="${esc(port)}" alt="Herramientas de barbería de NOVA Studio con el logo" fetchpriority="high" width="780" height="1692"></picture>`;
}
const pic = (slot) => {
  const v = catalog?.site?.photos?.[slot];
  if (v) return `/api/site/${slot}/photo?v=${encodeURIComponent(v)}`;
  return (catalog?.site?.theme === "rosa" && PIC_ROSA[slot]) || PIC_DEFAULT[slot];
};

// ── Formación ──────────────────────────────────────────────────────────────
// Fase 1: una página para quien quiere aprender (no para clientes) y una lista
// de interesados que solo ve el dueño. Se comparte con nova.appflu.es/formacion.
const TR_KEY = "nova_train";
function trainSaved() {
  try {
    return JSON.parse(localStorage.getItem(TR_KEY));
  } catch {
    return null;
  }
}

function trainingCard() {
  if (!catalog.training) return "";
  const a = provById(catalog.training.teacher);
  return `<section class="home-block" aria-labelledby="train-title">
    <a class="train-card" href="#formacion">
      <span class="tc-photo"><img src="${pic("formacion")}" alt="" loading="lazy"></span>
      <span class="tc-txt"><small>${L("Formación", "Training")} · ${esc(tx(catalog.training.status))}</small>
        <strong id="train-title">¿Quieres aprender <em class="serif">a cortar?</em></strong>
        <span>${L(
          `${esc(first(a?.name || "Airam"))} prepara clases para empezar desde cero o para afinar tu técnica.`,
          `${esc(first(a?.name || "Airam"))} is preparing classes to start from scratch or to sharpen your technique.`,
        )}</span>
        <b>Apúntate a la lista <span aria-hidden="true">→</span></b></span>
    </a>
  </section>`;
}

function trainForm(T) {
  const opt = (name, list, type, req = false) =>
    list
      .map((x) => {
        const id = x.id || x,
          label = x.name || x;
        return `<label class="tchip"><input type="${type}" name="${name}" value="${esc(id)}" ${req ? "required" : ""}><span>${esc(label)}</span></label>`;
      })
      .join("");
  return `<form id="train" class="card tr-form" novalidate>
    <p class="eyebrow">Lista de interesados</p><h2>Apúntate <em class="serif">sin compromiso.</em></h2>
    <label for="t-name">Nombre</label><input id="t-name" name="name" required maxlength="120" autocomplete="name" value="${esc(user?.name || "")}">
    <label for="t-phone">Teléfono <small>(opcional, por si el estudio necesita contactarte)</small></label><input id="t-phone" name="phone" type="tel" inputmode="tel" maxlength="25" autocomplete="tel" value="${esc(user?.phone || "")}">
    <label for="t-email">Correo <small>(opcional)</small></label><input id="t-email" name="email" type="email" autocomplete="email" value="${esc(user?.email || "")}">
    <label for="t-insta">Instagram <small>(opcional, para ver tus cortes)</small></label><input id="t-insta" name="instagram" maxlength="40" autocapitalize="off" placeholder="@tuusuario">
    <fieldset class="tr-field"><legend>¿Cuál es tu nivel?</legend><div class="tr-levels pick">${T.levels
      .map((l) => `<label class="tr-level"><input type="radio" name="level" value="${esc(l.id)}" required><strong>${esc(l.name)}</strong><span>${esc(l.desc)}</span></label>`)
      .join("")}</div></fieldset>
    <fieldset class="tr-field"><legend>¿Cómo prefieres las clases?</legend><div class="tchips">${opt("format", T.formats, "radio")}</div></fieldset>
    <fieldset class="tr-field"><legend>¿Qué te interesa? <small>Marca todo lo que quieras</small></legend><div class="tchips">${opt("topics", T.topics, "checkbox")}</div></fieldset>
    <fieldset class="tr-field"><legend>¿Cuándo te viene bien?</legend><div class="tchips">${opt("availability", T.availability, "checkbox")}</div></fieldset>
    <label for="t-msg">¿Algo más? <small>(opcional)</small></label><textarea id="t-msg" name="message" rows="3" maxlength="600" placeholder="Tu experiencia, qué te gustaría conseguir…"></textarea>
    <label class="check"><input type="checkbox" name="consent" required><span>Acepto que me contactéis por WhatsApp o correo sobre la formación. <a href="#privacidad" target="_blank">Privacidad</a>.</span></label>
    <button class="btn wide" type="submit">Apuntarme a la lista</button>
    <p class="pay-note">Gratis y sin compromiso. Puedes pedir que te borremos cuando quieras.</p>
  </form>`;
}
const trainDone = (s) =>
  `<div class="card tr-done"><span class="tr-check" aria-hidden="true">✓</span><h2>${L("Estás en la lista", "You're on the list")}${s.name ? `, <em class="serif">${esc(first(s.name))}.</em>` : "."}</h2>
    <p>Te escribiremos por WhatsApp en cuanto haya fechas, antes de anunciarlo a nadie más.</p>
    <button type="button" class="btn secondary wide" id="tr-edit">Cambiar mis respuestas</button></div>`;

async function trainingPage() {
  const T = catalog.training,
    a = provById(T.teacher),
    who = first(a?.name || "Airam");
  show(
    back("home", "Inicio") +
      `<section class="tr-hero">
        <span class="tr-photo">${a?.image ? `<img src="${esc(a.image)}" alt="${esc(a.name)}">` : ""}</span>
        <div class="tr-hero-in">
          <span class="tr-status"><i></i>${esc(tx(T.status))} · ${L("lista abierta", "list open")}</span>
          <p class="eyebrow">Formación</p>
          <h1>${L("Aprende el oficio", "Learn the craft")} <em>${L("con", "with")} ${esc(who)}.</em></h1>
          <p class="sub">Clases prácticas de barbería en el estudio de Vecindario, para empezar desde cero o para afinar tu técnica.</p>
          <a class="btn" href="#tr-form" id="tr-jump">Quiero apuntarme</a>
        </div>
      </section>
      <section class="tr-block"><p class="eyebrow">Qué vas a aprender</p><h2>Del primer degradado <em>al acabado.</em></h2>
        <ul class="tr-topics">${T.topics.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></section>
      <section class="tr-block"><p class="eyebrow">Para quién</p><h2>Vengas de donde <em>vengas.</em></h2>
        <div class="tr-levels">${T.levels.map((l, i) => `<div class="tr-level"><small>${pad(i + 1)}</small><strong>${esc(l.name)}</strong><span>${esc(l.desc)}</span></div>`).join("")}</div></section>
      <section class="tr-block"><p class="eyebrow">Cómo funciona</p><h2>Primero, <em>la lista.</em></h2>
        <ol class="tr-steps">
          <li><strong>Te apuntas.</strong> Es gratis y no te compromete a nada.</li>
          <li>${L(
            `<strong>${esc(who)} prepara las fechas</strong> según el nivel y los horarios de quienes se apuntan.`,
            `<strong>${esc(who)} sets the dates</strong> based on the level and schedules of those who sign up.`,
          )}</li>
          <li><strong>Te escribimos los primeros</strong>, antes de anunciarlo, con fechas, plazas y precio.</li>
        </ol></section>
      <section class="tr-block" id="tr-form">${trainSaved() ? trainDone(trainSaved()) : trainForm(T)}</section>
      <p class="muted tr-wa">¿Dudas? <a href="${wa(L(`Hola, me interesa la formación de barbería con ${who}.`, `Hi, I'm interested in the barbering training with ${who}.`))}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a>.</p>` +
      legalLinks(),
  );
  $("#tr-jump").onclick = (e) => {
    e.preventDefault();
    $("#tr-form").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  bindTrainForm(T);
}
function bindTrainForm(T) {
  $("#tr-edit")?.addEventListener("click", () => {
    $("#tr-form").innerHTML = trainForm(T);
    bindTrainForm(T);
  });
  const f = $("#train");
  if (!f) return;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    for (const el of f.querySelectorAll("input[required]:not([type=radio])")) if (!el.reportValidity()) return;
    const fd = new FormData(f);
    if (!fd.get("level")) {
      f.querySelector("[name=level]").closest("fieldset").scrollIntoView({ behavior: "smooth", block: "center" });
      return toast("Dinos tu nivel.");
    }
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await api("training/interest", {
        name: fd.get("name"),
        phone: fd.get("phone"),
        email: fd.get("email"),
        instagram: fd.get("instagram"),
        level: fd.get("level"),
        format: fd.get("format") || "",
        topics: fd.getAll("topics"),
        availability: fd.getAll("availability"),
        message: fd.get("message"),
        consent: fd.get("consent") === "on",
      });
      const saved = { name: String(fd.get("name") || "").trim(), at: Date.now() };
      try {
        localStorage.setItem(TR_KEY, JSON.stringify(saved));
      } catch {}
      tap();
      $("#tr-form").innerHTML = trainDone(saved);
      bindTrainForm(T);
      $("#tr-form").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
}

// ── Tarjeta en garantía (Stripe) ───────────────────────────────────────────
// La tarjeta la guarda Stripe; aquí solo se ve la marca y los 4 últimos números.
const cardOn = () => !!catalog?.card?.enabled;
const BRANDS = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", jcb: "JCB", diners: "Diners", unionpay: "UnionPay" };
const cardLabel = (c) => (c ? `${BRANDS[c.brand] || L("Tarjeta", "Card")} ···· ${c.last4}` : "");
const isPending = (c) => c && ["requires_action", "requires_payment_method"].includes(c.status);

const feePct = (s, kind) => Math.round((Number(s.price) || 0) * (kind === "late" ? catalog.rules.lateFeePct : catalog.rules.noShowFeePct)) / 100;
const pctText = (n) => (Number(n) >= 100 ? L("el precio entero", "the full price") : L(`el ${n} %`, `${n} %`));
function guaranteeBox(s) {
  const fee = euro(Math.max(feePct(s, "noShow"), feePct(s, "late")));
  return user?.card
    ? `<div class="guarantee has"><span class="g-ic">${svg(ICONS.shieldCheck)}</span><div><strong>${L("Cita garantizada con", "Booking guaranteed with")} ${esc(cardLabel(user.card))}</strong><span>${L(
        `No se cobra nada ahora. Solo si no vienes o cancelas con menos de ${catalog.rules.cancelHours} h se te pueden cobrar ${fee}.`,
        `Nothing is charged now. Only if you don't show up or cancel less than ${catalog.rules.cancelHours} h before can you be charged ${fee}.`,
      )}</span></div><button type="button" class="g-link" id="g-change">Cambiar</button></div>`
    : `<div class="guarantee"><span class="g-ic">${svg(ICONS.card)}</span><div><strong>Tarjeta en garantía</strong><span>${L(
        `Para reservar dejas una tarjeta. <b>No se cobra nada ahora</b>: solo si no vienes o cancelas con menos de ${catalog.rules.cancelHours} h se te pueden cobrar ${fee}. Se guarda en tu perfil y no la vuelves a poner.`,
        `To book you leave a card. <b>Nothing is charged now</b>: only if you don't show up or cancel less than ${catalog.rules.cancelHours} h before can you be charged ${fee}. It's saved on your profile so you won't need to enter it again.`,
      )}</span></div></div>`;
}

let stripeP = null;
function loadStripe() {
  if (!stripeP)
    stripeP = new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.onload = () => ok(window.Stripe(catalog.card.pk, { locale: LANG }));
      s.onerror = () => {
        stripeP = null;
        ko(Error("No se ha podido cargar el pago seguro. Revisa tu conexión."));
      };
      document.head.append(s);
    });
  return stripeP;
}
const STRIPE_LOOK = {
  theme: "stripe",
  variables: { colorPrimary: "#171717", colorText: "#171717", colorBackground: "#ffffff", colorDanger: "#a62a29", borderRadius: "12px", fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif", fontSizeBase: "16px" },
  rules: { ".Input": { border: "1px solid #ccc9c0", boxShadow: "none", padding: "13px" }, ".Input:focus": { border: "1px solid #171717", boxShadow: "0 0 0 1px #171717" } },
};
const fakeFields = () =>
  `<div class="fake-card"><p class="fake-tag">Modo prueba · no es un cobro real</p>
    <label for="fc-num">Número de tarjeta</label><input id="fc-num" inputmode="numeric" autocomplete="off" value="4242 4242 4242 4242">
    <div class="form-actions" style="margin-top:0"><div><label for="fc-exp">Caducidad</label><input id="fc-exp" value="12 / 30"></div><div><label for="fc-cvc">CVC</label><input id="fc-cvc" inputmode="numeric" value="123"></div></div>
    <p class="muted fake-help">${L(
      "Acabada en <b>0002</b> la rechaza el banco al cobrar; en <b>3155</b> el banco pide confirmación. Cualquier otra se cobra bien.",
      "Ending in <b>0002</b> the bank declines the charge; in <b>3155</b> the bank asks for confirmation. Any other goes through.",
    )}</p></div>`;

// Hoja con el formulario de Stripe. Resuelve al terminar (true) o al cerrarla (false).
function paySheet({ eyebrow, title, text, cta, mount, submit }) {
  return new Promise((resolve) => {
    const sh = sheet(
      `<p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p class="muted">${text}</p>
      <form id="pay-form"><div id="pay-mount" class="pay-mount"><p class="muted">Cargando pago seguro…</p></div>
      <p class="pay-err" id="pay-err" role="alert"></p>
      <button class="btn wide" type="submit" id="pay-go" disabled>${cta}</button></form>
      <p class="secure-note">${svg(ICONS.lock)} Pago seguro con Stripe. NOVA nunca ve el número de tu tarjeta.</p>`,
    );
    let finished = false;
    const back = sh.el.parentElement;
    const watch = new MutationObserver(() => {
      if (!document.body.contains(back)) {
        watch.disconnect();
        if (!finished) resolve(false);
      }
    });
    watch.observe(document.body, { childList: true });
    const btn = sh.el.querySelector("#pay-go"),
      err = sh.el.querySelector("#pay-err");
    Promise.resolve(mount(sh.el.querySelector("#pay-mount")))
      .then(() => (btn.disabled = false))
      .catch((e) => (err.textContent = e.message));
    sh.el.querySelector("#pay-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true;
      err.textContent = "";
      try {
        await submit(sh.el);
        finished = true;
        sh.close();
        resolve(true);
      } catch (x) {
        err.textContent = x.message;
        btn.disabled = false;
      }
    });
  });
}

// Estado del cobro por no presentarse, tal como lo ve el cliente.
function chargeNote(b) {
  const c = b.charge;
  if (!c) {
    if (b.waived) return `<p class="charge-note ok">Tu barbero ha decidido no cobrarte nada por esta cita.</p>`;
    if (b.late)
      return `<p class="charge-note">${L(
        `La cancelaste con menos de ${catalog.rules.cancelHours} h. Tu barbero revisará si se cobra; si tienes un motivo justificado, <a href="${wa(`Hola, cancelé tarde mi cita del ${longDay(b.date)} (ref. ${b.id}) porque…`)}" target="_blank" rel="noopener">cuéntaselo por WhatsApp</a>.`,
        `You cancelled less than ${catalog.rules.cancelHours} h before. Your barber will review whether there's a charge; if you have a good reason, <a href="${wa(`Hi, I cancelled my booking on ${longDay(b.date)} late (ref. ${b.id}) because…`)}" target="_blank" rel="noopener">tell them on WhatsApp</a>.`,
      )}</p>`;
    return "";
  }
  if (c.status === "succeeded")
    return `<p class="charge-note">${L(
      `Se cobraron ${euro(c.amount)} en tu ${esc(cardLabel(c))} por ${c.kind === "late" ? "cancelar con poca antelación" : "no venir ni cancelar a tiempo"}.`,
      `${euro(c.amount)} was charged to your ${esc(cardLabel(c))} for ${c.kind === "late" ? "cancelling at short notice" : "not showing up or cancelling in time"}.`,
    )}</p>`;
  if (c.status === "refunded") return `<p class="charge-note ok">${L(`El cobro de ${euro(c.amount)} por esta cita se te ha devuelto.`, `The ${euro(c.amount)} charge for this booking has been refunded.`)}</p>`;
  if (isPending(c))
    return `<div class="warning"><strong>${L("Pago pendiente", "Pending payment")}: ${euro(c.amount)}</strong><br>${L(
      `${c.kind === "late" ? "La cancelaste con poca antelación" : "No viniste y no la cancelaste a tiempo"}, así que según las condiciones se cobra. ${c.status === "requires_action" ? "Tu banco pide que lo confirmes." : "Tu tarjeta no se pudo cobrar."}`,
      `${c.kind === "late" ? "You cancelled at short notice" : "You didn't show up or cancel in time"}, so under the terms it's charged. ${c.status === "requires_action" ? "Your bank is asking you to confirm it." : "Your card couldn't be charged."}`,
    )}</div><button type="button" class="btn wide" id="pay-now">${L("Pagar", "Pay")} ${euro(c.amount)}</button>`;
  return "";
}

// Guardar (o cambiar) la tarjeta. `who` lleva los datos de la reserva si aún no tiene cuenta.
async function addCard(who = {}) {
  let setup;
  try {
    setup = await api("card/setup", who);
  } catch (e) {
    if (e.status === 409) {
      // El correo ya tiene cuenta: que entre y vuelva aquí con su reserva intacta.
      sessionStorage.setItem("nova_next", "details");
      toast(e.message);
      go("login");
      return null;
    }
    throw e;
  }
  if (!user) {
    await refreshMe();
    nav();
  }
  let stripe, elements;
  const ok = await paySheet({
    eyebrow: "Tarjeta en garantía",
    title: user?.card ? "Cambiar tarjeta" : "Añade tu tarjeta",
    text: "No se cobra nada ahora. Queda guardada en tu perfil para tus próximas citas y puedes quitarla cuando quieras.",
    cta: "Guardar tarjeta",
    mount: async (el) => {
      if (setup.fake) return void (el.innerHTML = fakeFields());
      stripe = await loadStripe();
      el.innerHTML = "";
      elements = stripe.elements({ clientSecret: setup.clientSecret, appearance: STRIPE_LOOK });
      const pe = elements.create("payment", { layout: "tabs" });
      pe.mount(el);
      await new Promise((r) => pe.on("ready", r));
    },
    submit: async (sheetEl) => {
      let id = setup.id,
        number;
      if (setup.fake) number = sheetEl.querySelector("#fc-num").value;
      else {
        const r = await stripe.confirmSetup({ elements, redirect: "if_required", confirmParams: { return_url: location.href } });
        if (r.error) throw Error(r.error.message);
        id = r.setupIntent.id;
      }
      await api("card/confirm", { id, number });
    },
  });
  if (!ok) return null;
  await refreshMe();
  toast(`${L("Tarjeta guardada", "Card saved")}: ${cardLabel(user.card)}.`);
  return user.card;
}

// Pagar un cargo que el banco no dejó cobrar solo (confirmación o tarjeta rechazada).
async function payPending(b) {
  const r = await api(`bookings/${b.id}/pay`, {});
  if (r.done) return toast("Ya estaba pagado. Gracias.");
  let stripe, elements;
  const ok = await paySheet({
    eyebrow: "Pago pendiente",
    title: `${euro(b.charge.amount)} · ${L("cita del", "booking on")} ${esc(shortDay(b.date))}`,
    text: r.status === "requires_action" ? "Tu banco pide que confirmes el pago." : "Tu tarjeta no se pudo cobrar. Prueba otra vez o usa otra tarjeta.",
    cta: `${L("Pagar", "Pay")} ${euro(b.charge.amount)}`,
    mount: async (el) => {
      if (r.fake) return void (el.innerHTML = `<p class="fake-tag">Modo prueba · no es un cobro real</p>`);
      stripe = await loadStripe();
      if (r.status === "requires_action") return void (el.innerHTML = `<p class="muted">Al pulsar el botón, tu banco te pedirá la confirmación.</p>`);
      el.innerHTML = "";
      elements = stripe.elements({ clientSecret: r.clientSecret, appearance: STRIPE_LOOK });
      const pe = elements.create("payment", { layout: "tabs" });
      pe.mount(el);
      await new Promise((ok2) => pe.on("ready", ok2));
    },
    submit: async () => {
      if (!r.fake) {
        const x =
          r.status === "requires_action"
            ? await stripe.handleNextAction({ clientSecret: r.clientSecret })
            : await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { return_url: location.href } });
        if (x.error) throw Error(x.error.message);
      }
      const c = await api(`bookings/${b.id}/pay/check`, {});
      if (c.status !== "succeeded") throw Error("El pago aún no se ha completado. Prueba otra vez.");
    },
  });
  if (ok) {
    toast("Pago completado. Gracias.");
    render();
  }
}

// Lluvia de confeti dorado al confirmar una cita (nada si el móvil pide menos movimiento).
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas"),
    x = c.getContext("2d"),
    dpr = Math.min(devicePixelRatio || 1, 2),
    W = innerWidth,
    H = innerHeight;
  c.className = "confetti";
  c.width = W * dpr;
  c.height = H * dpr;
  x.scale(dpr, dpr);
  document.body.append(c);
  const cs = getComputedStyle(document.documentElement),
    a1 = cs.getPropertyValue("--accent").trim() || "#c8cacd",
    a2 = cs.getPropertyValue("--accent-2").trim() || "#dedfe1";
  const colors = [a1, a2, "#ffffff", "#0a090c", a1, "#ffffff"];
  const bits = Array.from({ length: 120 }, (_, i) => ({
    x: W / 2 + (Math.random() - 0.5) * 60,
    y: H * 0.28,
    vx: (Math.random() - 0.5) * 13,
    vy: -Math.random() * 13 - 4,
    w: 5 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.35,
    c: colors[i % colors.length],
  }));
  const t0 = performance.now();
  (function frame(t) {
    const k = (t - t0) / 1000;
    x.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += 0.38;
      b.vx *= 0.985;
      b.x += b.vx;
      b.y += b.vy;
      b.r += b.vr;
      x.save();
      x.globalAlpha = Math.max(0, 1 - Math.max(0, k - 1.6) / 0.8);
      x.translate(b.x, b.y);
      x.rotate(b.r);
      x.scale(1, Math.cos(b.r * 2));
      x.fillStyle = b.c;
      x.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      x.restore();
    }
    if (k < 2.4 && document.body.contains(c)) requestAnimationFrame(frame);
    else c.remove();
  })(t0);
}

// ── Movimiento ─────────────────────────────────────────────────────────────
// Lo que entra en pantalla aparece con un deslizamiento suave, la portada hace
// parallax, la cabecera se vuelve de cristal al bajar y las tarjetas siguen al ratón.
const calm = matchMedia("(prefers-reduced-motion: reduce)");
let revealIO = null;
function countUp(el) {
  const to = Number(el.dataset.count),
    t0 = performance.now();
  (function step(t) {
    const k = Math.min(1, (t - t0) / 1400);
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}
function motion() {
  revealIO?.disconnect();
  onScroll();
  if (calm.matches || !("IntersectionObserver" in window)) return;
  const els = $$(
    "#app .home-block > *, #app #servicios > *, #app .svc-list > .svc, #app .svc-head, #app .mate, #app .about-photos figure, #app .home-footer > *",
  );
  revealIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        revealIO.unobserve(el);
        el.classList.add("in");
        el.querySelectorAll("[data-count]").forEach(countUp);
        // Al terminar se quitan las clases para que el hover vuelva a ir fino.
        setTimeout(() => el.classList.remove("rv", "in"), 1100 + (parseFloat(el.style.getPropertyValue("--d")) || 0) * 1000);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  els.forEach((el) => {
    const sibs = [...el.parentElement.children].filter((x) => els.includes(x));
    el.style.setProperty("--d", Math.min(sibs.indexOf(el), 6) * 0.07 + "s");
    el.classList.add("rv");
    revealIO.observe(el);
  });
}
let scrollQueued = false;
function onScroll() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const y = scrollY,
      hero = $(".hero"),
      h = hero?.offsetHeight || 0;
    document.body.classList.toggle("scrolled", hero ? y > h - 90 : y > 4);
    if (!hero || calm.matches || y > h) return;
    const media = $("#hero-media"),
      inner = $("#hero-in");
    if (media) media.style.transform = `translate3d(0, ${y * 0.38}px, 0)`;
    if (inner) {
      inner.style.transform = `translate3d(0, ${y * 0.12}px, 0)`;
      inner.style.opacity = Math.max(0, 1 - y / (h * 0.75)).toFixed(3);
    }
  });
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll, { passive: true });
let tilted = null;
document.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType !== "mouse" || calm.matches) return;
    const g = e.target.closest?.(".svc, .rating-card, .hero-slot");
    if (g) {
      const r = g.getBoundingClientRect();
      g.style.setProperty("--mx", e.clientX - r.left + "px");
      g.style.setProperty("--my", e.clientY - r.top + "px");
    }
    const t = e.target.closest?.(".cromo, .mate-photo");
    if (tilted && tilted !== t) tilted.style.transform = "";
    tilted = t;
    if (!t) return;
    const r = t.getBoundingClientRect(),
      x = (e.clientX - r.left) / r.width - 0.5,
      yy = (e.clientY - r.top) / r.height - 0.5;
    t.style.transform = `perspective(800px) rotateX(${(-yy * 9).toFixed(2)}deg) rotateY(${(x * 11).toFixed(2)}deg) translateY(-4px)`;
    t.style.setProperty("--gx", (x + 0.5) * 100 + "%");
    t.style.setProperty("--gy", (yy + 0.5) * 100 + "%");
  },
  { passive: true },
);

// ── Motor ──────────────────────────────────────────────────────────────────
const teamFor = (s) => catalog.providers.filter((p) => (!s.providers?.length || s.providers.includes(p.id)) && (!p.services?.length || p.services.includes(s.id)));
const addMin = (hhmm, n) => {
  const [h, m] = hhmm.split(":").map(Number),
    t = h * 60 + m + n;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};
const go = (hash) => {
  if (location.hash.slice(1) === hash) render();
  else location.hash = hash;
};
let currentShow = null;
function show(html) {
  currentShow?.(html);
}

async function render() {
  const id = ++renderId;
  let hash = location.hash.slice(1) || "home";
  const bookStart = hash === "reservar" || hash === "servicios";
  if (bookStart) hash = "home";
  const route = hash.split("/"),
    page = pages[route[0]] ? route[0] : "home",
    app = $("#app");
  nav();
  markNav(page);
  $$(".sheet-back").forEach((x) => x.remove());
  const busy = setTimeout(() => id === renderId && app.classList.add("is-loading"), 180);
  currentShow = (html) => {
    if (id !== renderId) return;
    clearTimeout(busy);
    app.classList.remove("is-loading");
    app.innerHTML = html;
    if (page !== lastPage) {
      window.scrollTo(0, 0);
      // Entrada suave de la pantalla nueva (solo al cambiar de pantalla).
      app.classList.remove("enter");
      void app.offsetWidth;
      app.classList.add("enter");
    }
    document.body.dataset.page = page;
    siteChrome();
    motion();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", page === "home" ? "#0a090c" : "#f5f4f1");
    lastPage = page;
    hideSplash();
    installNudge(page);
  };
  try {
    await loadCatalog();
    await pages[page](route.slice(1));
    if (id === renderId && bookStart && page === "home") requestAnimationFrame(scrollToServices);
  } catch (err) {
    if (id !== renderId) return;
    if (err.status === 401) {
      await refreshMe();
      return loginScreen(err.message, route.join("/"));
    }
    currentShow(heading("Vaya…") + `<p class="error">${esc(err.message)}</p><a class="btn wide" href="#home">Volver al inicio</a>`);
  } finally {
    clearTimeout(busy);
    if (id === renderId) app.classList.remove("is-loading");
  }
}

// ── Instalar la app ────────────────────────────────────────────────────────
// Chrome, Edge y Samsung (Android) avisan con `beforeinstallprompt`: se guarda
// ese aviso y, en vez de la barra del navegador, sale nuestra ventana. Solo a
// quien entra sin sesión, en el inicio y desde el móvil; con sesión se ofrece
// en el Perfil. El iPhone no avisa: se explica cómo añadirla desde Compartir.
// `nova_install`: cuándo se ofreció (no se repite en 30 días) o «done» si ya se instaló.
let installEvt = null,
  installTimer = 0;
function installSeen() {
  try {
    return localStorage.getItem("nova_install") || "";
  } catch {
    return "x";
  }
}
function installMark(v) {
  try {
    localStorage.setItem("nova_install", v);
  } catch {}
}
// "prompt": se instala con un toque · "ios": desde Compartir · "menu": desde el
// menú del navegador · "": aquí no se puede (ordenador, navegador de Instagram…) o ya está instalada.
function installWhere() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) return "";
  if (!matchMedia("(pointer: coarse)").matches) return "";
  const ua = navigator.userAgent;
  if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat|GSA\/|; wv\)/.test(ua)) return "";
  if (installEvt) return "prompt";
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "menu";
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvt = e;
  if (installSeen() === "done") installMark(""); // si el navegador vuelve a ofrecerla es que se desinstaló
  installNudge(document.body.dataset.page);
});
window.addEventListener("appinstalled", () => {
  installEvt = null;
  installMark("done");
  $("#install-card")?.remove();
  toast(L("Lista: ya la tienes en tu pantalla de inicio.", "Done: it's on your home screen now."));
});
// Cuenta la visita una vez por pestaña. La hoja de instalar no sale en la primera.
function countVisit() {
  try {
    if (sessionStorage.getItem("nova_visit_counted")) return Number(localStorage.getItem("nova_visits") || "1");
    sessionStorage.setItem("nova_visit_counted", "1");
    const n = Number(localStorage.getItem("nova_visits") || "0") + 1;
    localStorage.setItem("nova_visits", String(n));
    return n;
  } catch {
    return 1;
  }
}
const installCooled = () => {
  const seen = installSeen();
  return seen === "done" || seen === "x" || (seen && Date.now() - Number(seen) < 30 * 864e5);
};
// La primera visita se deja libre para reservar. A partir de la segunda, en el
// inicio y sin sesión, se ofrece a los 20 s. Tras reservar, se ofrece al momento.
function installNudge(page) {
  clearTimeout(installTimer);
  if (page !== "home" || user || staff) return;
  const how = installWhere();
  if ((how !== "prompt" && how !== "ios") || installCooled() || countVisit() < 2) return;
  installTimer = setTimeout(() => {
    if (document.body.dataset.page !== "home" || user || staff || $(".sheet-back")) return;
    installMark(String(Date.now()));
    installSheet();
  }, 20000);
}
function installAfterBooking() {
  const how = installWhere();
  if ((how !== "prompt" && how !== "ios") || installCooled()) return;
  setTimeout(() => {
    if (document.body.dataset.page !== "booked" || $(".sheet-back")) return;
    installMark(String(Date.now()));
    installSheet();
  }, 1800);
}
async function installNow() {
  const e = installEvt;
  if (!e) return installSheet();
  installEvt = null; // cada aviso del navegador sirve una sola vez
  e.prompt();
  const r = await e.userChoice.catch(() => null);
  if (r?.outcome === "accepted") installMark("done");
}
const SHARE_ICON =
  '<svg class="inst-share" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14V3M8.5 6.5 12 3l3.5 3.5M9 9.5H5.5v11h13v-11H15" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
function installSheet() {
  const how = installWhere();
  if (!how) return;
  const steps =
    how === "ios"
      ? [
          L(`Pulsa <b>Compartir</b> ${SHARE_ICON}. En Safari, si no lo ves, está en el menú <b>···</b>.`, `Tap <b>Share</b> ${SHARE_ICON}. In Safari, if you can't see it, it's in the <b>···</b> menu.`),
          L("Elige <b>Añadir a pantalla de inicio</b> y pulsa <b>Añadir</b>.", "Choose <b>Add to Home Screen</b> and tap <b>Add</b>."),
        ]
      : [
          L("Abre el menú del navegador (<b>⋮</b> o <b>≡</b>).", "Open your browser menu (<b>⋮</b> or <b>≡</b>)."),
          L("Elige <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>.", "Choose <b>Install app</b> or <b>Add to Home screen</b>."),
        ];
  const s = sheet(`<div class="inst">
    <img class="inst-icon" src="/assets/icon-192.png" alt="" width="56" height="56">
    <h2>${L("Instala la app", "Install the app")}</h2>
    <p class="inst-lead">${L(
      "Ábrela desde la pantalla de inicio como cualquier otra app: reservas en dos toques y tienes tus citas siempre a mano. Sin pasar por la tienda y casi sin ocupar espacio.",
      "Open it from your home screen like any other app: book in two taps and keep your appointments at hand. No app store, and it takes up almost no space.",
    )}</p>
    ${
      how === "prompt"
        ? `<button type="button" class="btn wide" data-install>${L("Instalar", "Install")}</button><button type="button" class="btn wide secondary" data-later>${L("Ahora no", "Not now")}</button>`
        : `<ol class="inst-steps">${steps.map((x) => `<li><span>${x}</span></li>`).join("")}</ol><button type="button" class="btn wide" data-later>${L("Entendido", "Got it")}</button>`
    }
  </div>`);
  s.el.querySelector("[data-later]").onclick = s.close;
  const b = s.el.querySelector("[data-install]");
  if (b)
    b.onclick = () => {
      s.close();
      installNow();
    };
}
// La tarjeta del Perfil para quien ya tiene sesión.
function installCard() {
  if (!installWhere() || installSeen() === "done") return "";
  return `<div id="install-card"><p class="section-label">${L("La app", "The app")}</p>
    <div class="card inst-card">
      <img class="inst-icon" src="/assets/icon-192.png" alt="" width="44" height="44">
      <div class="inst-txt"><strong>${L("Instálala en tu móvil", "Install it on your phone")}</strong><span>${L("Ábrela desde la pantalla de inicio, sin buscarla en el navegador.", "Open it from your home screen, no need to find it in your browser.")}</span></div>
      <button type="button" class="btn wide secondary" id="install-btn">${L("Instalar", "Install")}</button>
    </div></div>`;
}

// Rutas «bonitas» que llevan a una pantalla (por si se comparten).
const entry = { "/acceder": "login", "/mis-citas": "bookings", "/perfil": "profile", "/equipo": "equipo", "/reservar": "reservar", "/formacion": "formacion", "/productos": "productos", "/supply": "supply", "/privacidad": "privacidad", "/cookies": "cookies", "/condiciones": "condiciones", "/aviso-legal": "aviso-legal" }[location.pathname.replace(/\/$/, "")];
if (entry && !location.hash) history.replaceState(null, "", "/#" + entry);

// Intro con el logo: solo la primera vez en cada visita y como mínimo un instante, para que se vea.
const splashAt = performance.now();
function hideSplash() {
  const sp = $("#splash");
  if (!sp || sp.classList.contains("out")) return;
  if (document.documentElement.classList.contains("no-splash")) return document.documentElement.classList.add("ready");
  setTimeout(() => {
    document.documentElement.classList.add("ready");
    sp.classList.add("out");
    setTimeout(() => sp.remove(), 700);
  }, Math.max(0, 1100 - (performance.now() - splashAt)));
  try {
    sessionStorage.setItem("nova_splash", "1");
  } catch {}
}
setTimeout(hideSplash, 4000); // por si algo falla, que nunca se quede tapando

function scrollToServices() {
  const el = document.getElementById("servicios");
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - 76;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}
// «Reservar» de la cabecera abre el flujo en la lista de servicios, no en la foto.
$("#book-link").addEventListener("click", (e) => {
  e.preventDefault();
  const hash = location.hash.slice(1);
  if (hash === "reservar") return scrollToServices();
  location.hash = "reservar";
});
// ES / EN: se cambia el idioma y se repinta la pantalla en la que estás.
$("#lang-btn").addEventListener("click", () => {
  setLang(LANG === "en" ? "es" : "en");
  render();
});
window.addEventListener("hashchange", render);
Promise.all([refreshMe(), loadCatalog().catch(() => {})]).then(render);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
