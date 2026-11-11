// NOVA Studio · app de reservas
// Una sola página: cada pantalla es un «#hash» y se pinta en <main id="app">.
// Los datos del negocio (servicios, equipo, horario) llegan de /api/catalog.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const euro = (n) => (n == null ? "Consultar" : Number.isInteger(Number(n)) ? `${Number(n)} €` : `${Number(n).toFixed(2).replace(".", ",")} €`);
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const shiftMonth = (key, n) => {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
};
const dayDate = (iso) => new Date(iso + "T12:00:00");
const fmtDay = (iso, opts) => dayDate(iso).toLocaleDateString("es-ES", opts).replace(".", "");
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
    '<path d="M6.5 5.5v7c0 8.2 4.6 14.5 9.5 14.5s9.5-6.3 9.5-14.5v-7"/>' +
    '<path class="si-f si-stache" d="M16 15.3c-1.4-1.5-3.6-1.8-5.4-.7-1.2.8-2.4.7-3-.2.4 2.4 3 3.2 5.2 2.4 1.4-.5 2.4-.9 3.2-1.5.8.6 1.8 1 3.2 1.5 2.2.8 4.8 0 5.2-2.4-.6.9-1.8 1-3 .2-1.8-1.1-4-.8-5.4.7z"/>' +
    '<path d="M13.8 20.4c1.4.8 3 .8 4.4 0"/><path class="si-thin" d="M12.5 24.2v1.1M16 25v1.2M19.5 24.2v1.1"/>',
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
  staff = false,
  mailOn = true,
  loginCode = false,
  draft = load("nova_draft") || {},
  challenge = null,
  calMonth = "",
  selectedDate = "",
  dayPicked = false,
  lastBooked = null,
  renderId = 0,
  lastPage = "",
  staffDay = "",
  staffMonth = "",
  staffAll = false,
  cobroDay = "",
  cobroPre = "";
const availCache = new Map();

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
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let j = {};
  try {
    j = await r.json();
  } catch {}
  if (!r.ok) {
    const e = Error(j.error || "No hay conexión. Prueba otra vez.");
    e.status = r.status;
    throw e;
  }
  return j;
}
async function loadCatalog() {
  if (!catalog) catalog = await api("catalog");
  return catalog;
}
async function refreshMe() {
  try {
    const r = await api("me");
    user = r.user;
    staff = r.staff;
    staffHint = r.staffHint || null;
    mailOn = r.mail;
    loginCode = r.loginCode;
  } catch {}
}
function getAvail(service, provider, month) {
  const k = `${service}|${provider}|${month}`;
  if (!availCache.has(k)) {
    const p = api(`avail?service=${encodeURIComponent(service)}&provider=${encodeURIComponent(provider)}&month=${month}`).then((r) => r.days);
    p.catch(() => availCache.delete(k));
    availCache.set(k, p);
  }
  return availCache.get(k);
}
const svcById = (id) => catalog?.services.find((s) => s.id === id);
const provById = (id) => catalog?.providers.find((p) => p.id === id);
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
const back = (to, label) => `<a class="back-link" href="#${to}">← ${label}</a>`;
const face = (p, cls = "face") =>
  (p = p && !p.image ? provById(p.id) || p : p)?.image ? `<img class="${cls}" src="${esc(p.image)}" alt="">` : `<span class="${cls}" aria-hidden="true">${initial(p?.name)}</span>`;
const legalLinks = () =>
  `<div class="legal-links" role="navigation" aria-label="Información legal"><a href="#privacidad">Privacidad</a><span>·</span><a href="#condiciones">Condiciones</a><span>·</span><a href="#aviso-legal">Aviso legal</a><span>·</span><a href="#equipo">Equipo</a></div>`;
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
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((dayDate(iso) - today) / 86400000);
  return days <= 0 ? "Hoy" : days === 1 ? "Mañana" : days < 7 ? `En ${days} días` : `En ${Math.round(days / 7)} ${Math.round(days / 7) === 1 ? "semana" : "semanas"}`;
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
  const item = (to, label, icon) => `<a href="#${to}" data-sect="${to}" aria-label="${label}" title="${label}">${icon}</a>`;
  const me = user?.photo
    ? `<img class="nav-initial" src="${esc(user.photo)}" alt="">`
    : user?.name
      ? `<span class="nav-initial">${initial(user.name)}</span>`
      : svg(ICONS.user);
  const acc = $("#account-link");
  acc.innerHTML = user
    ? `${user.photo ? `<img class="hdr-av" src="${esc(user.photo)}" alt="">` : `<span class="hdr-av">${initial(user.name)}</span>`}<span>Mi cuenta</span>`
    : `${svg(ICONS.user)}<span>Entrar</span>`;
  $("#nav").innerHTML =
    item("home", "Inicio", svg(ICONS.home)) +
    item("bookings", "Mis citas", svg(ICONS.cal)) +
    item("rewards", "Puntos y premios", svg(ICONS.gift)) +
    item("profile", "Perfil", me) +
    (staff || staffHint ? item("equipo", staff ? "Agenda" : "Tu panel", svg(ICONS.agenda)) : "");
}
function markNav(page) {
  const sect =
    { barber: "home", time: "home", details: "home", consulta: "home", booked: "home", booking: "bookings", move: "bookings", login: "profile", code: "profile" }[page] || page;
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
      }${only ? `<span class="only-tag">Solo con ${esc(first(only.name))}</span>` : ""}</span>
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
      <div class="na-info"><strong class="na-time">${esc(b.start)}</strong><span>${esc(b.service.name)}</span><span>con ${esc(first(b.provider.name))}</span></div>
      ${face(p, "na-face")}
    </div>
    <div class="na-foot"><span>Pago en el local${b.service.price ? ` · ${euro(b.service.price)}` : ""}</span><b>Ver mi cita ›</b></div>
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
  for (const [a, b] of W[wd] || []) if (min >= hm(a) && min < hm(b)) return { open: true, text: `Abierto · hasta las ${b}` };
  for (let i = 0; i < 8; i++) {
    const d = (wd + i) % 7,
      slot = (W[d] || []).find(([a]) => i > 0 || hm(a) > min);
    if (slot) return { open: false, text: `Cerrado · abre ${i === 0 ? "hoy" : i === 1 ? "mañana" : "el " + DAY_NAMES[d]} a las ${slot[0]}` };
  }
  return null;
}
// El primer hueco libre de todo el equipo para el servicio principal.
async function nextFreeSlot() {
  const s = svcById("corte") || catalog.services.find((x) => !x.consult);
  if (!s) return null;
  const team = teamFor(s),
    m0 = monthKey(new Date());
  for (const month of [m0, shiftMonth(m0, 1)]) {
    const res = await Promise.all(team.map((p) => getAvail(s.id, p.id, month).then((days) => ({ p, days }), () => null)));
    let best = null;
    for (const r of res) {
      if (!r) continue;
      const hit = Object.entries(r.days)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .find(([, t]) => t.length);
      if (hit && (!best || hit[0] + hit[1][0] < best.date + best.start)) best = { s, p: r.p, date: hit[0], start: hit[1][0] };
    }
    if (best) return best;
  }
  return null;
}
function homeHero() {
  const B = catalog.business,
      st = openState(),
      team = catalog.providers;
  return `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-media" id="hero-media">
      <picture><source media="(orientation: landscape)" srcset="${pic("hero-wide")}"><img class="hero-photo" src="${pic("hero")}" alt="Herramientas de barbería de NOVA Studio con el logo" fetchpriority="high"></picture>
    </div>
    <div class="hero-grain" aria-hidden="true"></div>
    <div class="hero-in" id="hero-in">
      <div class="hero-copy">
        <h1 id="hero-title" class="sr-only">NOVA Studio · Barbería en Vecindario</h1>
        <div class="hero-meta">
          ${st ? `<span class="hero-chip${st.open ? " is-open" : ""}"><i></i>${esc(st.text)}</span>` : ""}
          <a class="hero-chip hero-rate" href="${esc(B.rating.url)}" target="_blank" rel="noopener noreferrer"><b>★ ${esc(B.rating.score)}</b>${B.rating.count} reseñas</a>
        </div>
        <div class="hero-team">
          <span class="hero-faces">${team.map((p) => face(p, "hf")).join("")}</span>
          <span>${esc(team.map((p) => first(p.name)).join(", ").replace(/, ([^,]*)$/, " y $1"))}<small>te esperan</small></span>
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
      $("#hs-when").textContent = `${when === "Hoy" || when === "Mañana" ? when : shortDay(b.date)} · ${b.start}`;
      $("#hs-who").textContent = `${b.s.name} con ${first(b.p.name)}`;
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

function homeExtras() {
  const B = catalog.business,
    ext = 'target="_blank" rel="noopener noreferrer"';
  return `
<section class="home-block" aria-labelledby="reviews-title">
  <p class="eyebrow">Lo que dicen de nosotros</p>
  <h2 id="reviews-title">El corte se nota.<br><em class="serif">La experiencia, también.</em></h2>
  <a class="rating-card" href="${esc(B.rating.url)}" ${ext} aria-label="NOVA Studio en ${esc(B.rating.source)}: ${esc(B.rating.score)} sobre 5, ${B.rating.count} reseñas">
    <span class="rating-src">${esc(B.rating.source)}</span>
    <span class="rating-number">${esc(B.rating.score)}<small>/ 5</small></span>
    <span class="stars" aria-hidden="true">★★★★★</span>
    <span class="rating-count"><b data-count="${B.rating.count}">${B.rating.count}</b> reseñas verificadas · ${esc(B.drink)}</span>
  </a>
  <div class="home-actions">
    <a class="btn secondary" href="${esc(B.rating.url)}" ${ext}>Leer reseñas ↗</a>
    <a class="btn secondary" href="${esc(B.instagram)}" ${ext}>Ver trabajos en Instagram ↗</a>
  </div>
</section>
<section class="home-block" aria-labelledby="location-title">
  <p class="eyebrow">Tu barbería en Vecindario</p>
  <h2 id="location-title">Nos vemos en <em class="serif">el estudio.</em></h2>
  <div class="map-frame" id="map-frame">Cargando mapa…</div>
  <div class="visit card">
    <address><strong>${esc(B.street)}</strong><span>${esc(B.city)}</span></address>
    <div class="hours">${B.hoursText.map(([d, h]) => `<div><span>${esc(d)}</span><strong>${esc(h)}</strong></div>`).join("")}<span class="closed">${esc(B.closedText)}</span></div>
    <a class="btn wide" href="${esc(B.maps)}" ${ext}>${svg(ICONS.pin)} Cómo llegar</a>
  </div>
</section>
<section class="home-block" aria-labelledby="about-title">
  <p class="eyebrow">Barbería en Gran Canaria</p>
  <h2 id="about-title">Imagen <em class="serif">y estilo.</em></h2>
  <div class="about-photos">
    <figure><img src="${pic("cabina")}" alt="Barbero trabajando con un cliente" loading="lazy"><figcaption>En cabina</figcaption></figure>
    <figure><img src="${pic("acabado")}" alt="Detalle del acabado de un corte" loading="lazy"><figcaption>El acabado</figcaption></figure>
    <figure><img src="${pic("oficio")}" alt="Herramientas de barbería" loading="lazy"><figcaption>El oficio</figcaption></figure>
    <figure><img src="${pic("casa")}" alt="Espejo dorado del estudio" loading="lazy"><figcaption>La casa</figcaption></figure>
  </div>
  <p>Un espacio donde la barbería se encuentra con la creatividad, la moda y la cultura urbana. Hacemos <strong>corte de pelo</strong>, degradados, <strong>corte y barba</strong> y <strong>corte privado</strong> en ${esc(B.street)}, Vecindario. Reserva en segundos, sin llamar y sin descargar nada.</p>
  <ul class="about-tags" aria-label="Servicios"><li>Corte de pelo</li><li>Degradado</li><li>Corte y barba</li><li>Corte privado</li><li>Fuera de horario</li><li>VIP a domicilio</li></ul>
</section>
<div id="home-products"></div>
<section class="home-block shop-home" aria-labelledby="shop-title">
  <p class="eyebrow">${esc(catalog.shop.name)} · Clothing</p>
  <h2 id="shop-title">La ropa <em class="serif">de la casa.</em></h2>
  <div class="shop-pics">
    <figure class="shop-main"><img src="${pic("supply")}" alt="Camisetas de ${esc(catalog.shop.name)} rosas y grises" loading="lazy" width="760" height="1350"></figure>
    <figure class="shop-item"><img src="${pic("supply-rosa")}" alt="Camiseta rosa de ${esc(catalog.shop.name)} con el emblema en el pecho" loading="lazy" width="920" height="781"><figcaption>Camiseta · Rosa</figcaption></figure>
  </div>
  <p>Algodón pesado, corte boxy y el emblema de la estrella. Diseñada en el estudio. <strong>Cada euro en ropa te suma ${catalog.points.perEuro} puntos</strong> en el Club, y desde ${esc(catalog.leagues.find((lg) => lg.perks.some((p) => /%.*Supply/.test(p)))?.name || "")} tienes descuento en cada prenda.</p>
  <div class="home-actions">
    <a class="btn" href="${esc(catalog.shop.url)}" target="_blank" rel="noopener">Ver la tienda · ${esc(catalog.shop.label)} ↗</a>
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
    <div><small>Horario</small>${B.hoursText.map(([d, h]) => `<span>${esc(d)} · ${esc(h)}</span>`).join("")}<span class="hf-muted">${esc(B.closedText)}</span></div>
    <div><small>Contacto</small><a href="${wa("Hola NOVA Studio 👋")}" ${ext}>WhatsApp</a><a href="${esc(B.instagram)}" ${ext}>Instagram</a><a href="${esc(catalog.shop.url)}" ${ext}>${esc(catalog.shop.name)}</a><a href="#productos">Productos</a><a href="#formacion">Formación</a></div>
  </div>
  <p class="hf-copy">© ${new Date().getFullYear()} NOVA Studio · <em class="serif">Good people, better days.</em></p>
</footer>`;
}
function initMap() {
  const frame = $("#map-frame");
  if (!frame) return;
  const start = () => {
    const f = document.createElement("iframe");
    f.title = "Mapa de NOVA Studio";
    f.src = catalog.business.mapEmbed;
    f.loading = "lazy";
    f.referrerPolicy = "no-referrer-when-downgrade";
    frame.replaceChildren(f);
  };
  if (!("IntersectionObserver" in window)) return start();
  const io = new IntersectionObserver((en) => {
    if (en.some((e) => e.isIntersecting)) {
      io.disconnect();
      start();
    }
  }, { rootMargin: "400px" });
  io.observe(frame);
}

// ── Cita: tarjetas ─────────────────────────────────────────────────────────
function bookingCard(b, now) {
  const past = b.date + " " + b.start < now,
    canceled = b.status === "canceled",
    absent = b.attendance === "absent",
    state = canceled ? ["Cancelada", "st-cancel"] : absent ? ["No vino", "st-cancel"] : past ? ["✓ Realizada", "st-done"] : [`<i class="live-dot"></i>Activa · ${untilLabel(b.date)}`, "st-ok"],
    kind = canceled || past ? "is-past" : "is-active";
  return `<a class="appt ${kind}" href="#booking/${esc(b.id)}">
    <span class="appt-date"><small>${esc(fmtDay(b.date, { month: "short" }))}</small><strong>${dayDate(b.date).getDate()}</strong><small>${esc(fmtDay(b.date, { weekday: "short" }))}</small></span>
    <span class="appt-body"><strong>${esc(b.service.name)}</strong><span>${esc(b.start)} · ${esc(b.provider.name)}</span><span class="appt-chips"><span class="appt-state ${state[1]}">${state[0]}</span></span></span>
  </a>`;
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
    `&details=${encodeURIComponent(`Con ${b.provider.name}. Referencia ${b.id}.`)}`
  );
}

// ── Pantallas ──────────────────────────────────────────────────────────────
const LEGAL = {
  privacidad: [
    "Política de privacidad",
    () => `<p><b>Responsable.</b> ${esc(catalog.business.name)}, ${esc(catalog.business.street)}, ${esc(catalog.business.city)}. Contacto: <a href="mailto:${esc(catalog.business.email)}">${esc(catalog.business.email)}</a>.</p>
    <p><b>Qué datos tratamos.</b> Los que nos das al reservar: nombre, correo y teléfono, el historial de tus citas (servicio, barbero, fecha y si viniste) y lo del Club NOVA: puntos, liga, medallas, premios canjeados, las compras de ropa de NOVA Supply que el equipo apunta a tu cuenta para sumarte puntos (fecha, importe y número de prendas), tu código de amigo, quién te invitó y, si la subes, tu foto de perfil. ${
      catalog.card?.enabled
        ? "Si dejas una tarjeta en garantía, sus datos los guarda Stripe Payments Europe; nosotros solo vemos la marca, los 4 últimos números y la caducidad, y si se ha cobrado alguna falta."
        : "No guardamos datos de tarjeta: se paga en el local."
    }</p>
    <p><b>Para qué.</b> Para gestionar tus citas (crearlas, cambiarlas, cancelarlas y avisarte), darte acceso a tu cuenta con un código por correo y llevar tu Club NOVA. No te enviaremos publicidad sin tu permiso.</p>
    <p><b>Formación.</b> Si te apuntas a la lista de la formación, guardamos lo que pones en el formulario (nombre, teléfono, correo e Instagram si los das, tu nivel y tus preferencias) solo para contactarte sobre los cursos. Lo ve únicamente el dueño del estudio y puedes pedir que lo borremos cuando quieras.</p>
    <p><b>Con quién.</b> Solo con los proveedores necesarios para que la app funcione: el alojamiento y la base de datos, el servicio que envía los correos${catalog.card?.enabled ? " y Stripe, que guarda tu tarjeta y hace los cobros por faltas" : ""}. No vendemos tus datos.</p>
    <p><b>Cuánto tiempo.</b> Mientras tengas cuenta o sigas viniendo y, después, lo que exija la ley.</p>
    <p><b>Tus derechos.</b> Puedes pedir ver, corregir o borrar tus datos escribiendo a <a href="mailto:${esc(catalog.business.email)}">${esc(catalog.business.email)}</a>. Si no te respondemos bien, puedes reclamar ante la AEPD.</p>
    <p><b>Cookies.</b> Solo una cookie técnica para mantener tu sesión iniciada (30 días). Nada de analítica ni publicidad. El mapa de Google puede poner las suyas al verlo.</p>`,
  ],
  condiciones: [
    "Condiciones de reserva",
    () => `<p><b>1. Reservas.</b> Eliges servicio, barbero, día y hora entre los huecos libres. La cita queda confirmada al terminar y la ves en «Mis citas».</p>
    <p><b>2. Precio y pago.</b> Los precios incluyen impuestos. Se paga en el local, en efectivo o con tarjeta.</p>
    <p><b>3. Cambios y cancelaciones.</b> Puedes cambiar la cita desde la app hasta ${catalog.rules.cancelHours} horas antes, y cancelarla hasta la hora de la cita. Con menos de ${catalog.rules.cancelHours} horas, para cambiarla escríbenos por WhatsApp.</p>
    <p><b>4. Puntualidad.</b> Si llegas tarde puede que haya que acortar el servicio para no retrasar al siguiente. Si faltas varias veces sin avisar, podremos limitar tus reservas online.</p>
    ${
      catalog.card?.enabled
        ? `<p><b>4 bis. Tarjeta en garantía y faltas.</b> Para reservar online dejas una tarjeta en garantía. Al guardarla no se cobra nada. Queda guardada en tu perfil (la custodia Stripe, nuestro proveedor de pagos) para tus próximas citas, y puedes cambiarla o quitarla cuando quieras desde tu perfil, salvo que tengas citas pendientes garantizadas con ella. <b>Si no vienes a la cita, o la cancelas con menos de ${catalog.rules.cancelHours} horas de antelación, autorizas a ${esc(catalog.business.name)} a cobrar en esa tarjeta ${pctText(catalog.rules.noShowFeePct)} del servicio si no vienes y ${pctText(catalog.rules.lateFeePct)} si cancelas tarde</b>, sin necesidad de que estés presente. No es automático: tu barbero revisa cada caso y, si hay un motivo justificado, no se cobra. Si tu banco pide confirmación o rechaza el cobro, te avisaremos y podrás pagarlo desde «Mis citas». Si crees que el cobro es un error, escríbenos y lo revisamos; si procede, te devolvemos el dinero.</p>`
        : ""
    }
    <p><b>5. Club NOVA.</b> Es gratis. Los puntos, las ligas, los premios y los descuentos en NOVA Supply no tienen valor en dinero, no se pueden pasar a otra persona y pueden cambiar. Los puntos de la ropa los apunta el equipo al pagar en el estudio.</p>`,
  ],
  "aviso-legal": [
    "Aviso legal",
    () => `<p><b>Titular:</b> ${esc(catalog.business.name)}. <b>Domicilio:</b> ${esc(catalog.business.street)}, ${esc(catalog.business.city)}. <b>Email:</b> ${esc(catalog.business.email)}.</p>
    <p>Esta app sirve para reservar servicios de barbería en ${esc(catalog.business.name)}, gestionar tus citas y participar en el Club NOVA. Los contenidos, el logotipo y las fotos son de su titular.</p>`,
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
    initMap();
    initProducts();
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
          teamFor(s).forEach((p) => getAvail(s.id, p.id, monthKey(new Date())).catch(() => {}));
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
        heading("Elige a tu barbero", `${esc(s.name)} · ${s.duration} min · ${euro(s.price)}`) +
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
    team.forEach((p) => getAvail(s.id, p.id, monthKey(new Date())).catch(() => {}));
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
    const msg = `Hola NOVA Studio, me interesa el servicio «${s.name}». ¿Qué hueco tenéis?`;
    show(
      back("home", "Volver") +
        `<section class="con-hero"><span class="face svc-ic">${svcIcon(s.icon)}</span><div><small>Fuera de carta</small><h1>${esc(s.name)}</h1><span>${s.price ? "Desde " + euro(s.price) : "Precio a consultar"}</span></div></section>` +
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
      calMonth = monthKey(new Date());
      delete draft.start;
    }
    draft.provider = pid;
    saveDraft();
    await calendar({ backTo: `barber/${draft.service}`, backLabel: "Cambiar barbero" });
  },

  async move([id]) {
    const { booking: b } = await api("bookings/" + id);
    draft = { service: b.service.id, provider: b.provider.id, moving: b.id };
    if (!calMonth) calMonth = monthKey(new Date());
    await calendar({ backTo: `booking/${b.id}`, backLabel: "Volver a la cita" });
  },

  async details() {
    if (!draft.start || !draft.date) return go("home");
    const s = svcById(draft.service),
      p = provById(draft.provider);
    const cc = [
      ["🇪🇸", "+34"],
      ["🇬🇧", "+44"],
      ["🇩🇪", "+49"],
      ["🇫🇷", "+33"],
      ["🇮🇹", "+39"],
      ["🇵🇹", "+351"],
      ["🇳🇱", "+31"],
      ["🇺🇸", "+1"],
      ["🇻🇪", "+58"],
      ["🇨🇴", "+57"],
      ["🇦🇷", "+54"],
    ];
    // Con la sesión iniciada y el nombre en el perfil no se pregunta nada.
    const quick = !!(user && user.name);
    const saved = String(draft.phone || user?.phone || "");
    const m = saved.match(/^(\+\d{1,3})\s*(.*)$/);
    const savedCc = m && cc.some(([, c]) => c === m[1]) ? m[1] : "+34",
      savedNum = m ? m[2] : saved;
    show(
      back(`time/${draft.provider}`, "Cambiar hora") +
        (quick ? heading("Confirma tu cita", "Un toque y listo.") : heading("Tus datos", "Solo lo necesario para guardar tu cita.")) +
        `<div class="pick-summary">${face(p)}<div><strong>${esc(s.name)} · ${euro(s.price)}</strong><span>${esc(p.name)} · ${esc(longDay(draft.date))} · ${esc(draft.start)}</span></div></div>` +
        `<form id="details" novalidate>
          ${
            quick
              ? `<div class="quick-who">${user.photo ? `<img src="${esc(user.photo)}" alt="">` : `<b>${initial(user.name)}</b>`}<div><strong>${esc(user.name)}</strong><span>${esc(user.email)}${user.phone ? " · " + esc(user.phone) : ""}</span></div><a href="#profile">Cambiar</a></div>`
              : `${user?.name ? "" : `<label for="f-name">Nombre</label><input id="f-name" name="name" required maxlength="120" autocomplete="name" value="${esc(draft.name || "")}">`}
          ${user ? "" : `<label for="f-email">Correo</label><input id="f-email" name="email" type="email" required autocomplete="email" value="${esc(draft.email || "")}">`}
          <label for="f-phone">Teléfono <small class="opt">(opcional, por si hay algún cambio)</small></label>
          <div class="phone-field"><select name="cc" aria-label="Prefijo del país">${cc.map(([f, c]) => `<option value="${c}" ${c === savedCc ? "selected" : ""}>${f} ${c}</option>`).join("")}</select><input id="f-phone" name="phone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel-national" placeholder="600 000 000" value="${esc(savedNum)}"></div>`
          }
          ${
            user
              ? `<div class="club-joined"><span class="club-check">✓</span><div><strong>Eres del Club NOVA</strong><span>Esta cita te suma ${svcPoints(s)} puntos.</span></div></div>`
              : `<div class="club-card"><span class="club-tag">CLUB</span><h2>Entras en el Club al reservar</h2><p>Con estos mismos datos. Sin contraseñas.</p><ul class="club-perks"><li>${catalog.points.welcome} puntos de regalo al entrar</li><li>${catalog.points.perEuro} puntos por cada euro, en la silla y en ${esc(catalog.shop.name)}</li><li>De ${esc(catalog.leagues[0].name)} a ${esc(topLeague().name)}: ligas con premios y descuentos</li></ul>
                  <div class="ref-box${refCode() ? " open" : ""}" id="ref-box"><button type="button" class="ref-toggle" id="ref-toggle"><span aria-hidden="true">🎁</span>¿Te ha invitado un amigo?<b>Pon su código</b></button>
                  <div class="ref-field"><label class="sr-only" for="ref-input">Código de amigo</label><input id="ref-input" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="16" placeholder="Ej.: CARLOS482" value="${esc(refCode())}"><p class="ref-state" id="ref-state" aria-live="polite"></p></div></div></div>`
          }
          ${cardOn() ? guaranteeBox(s) : ""}
          <button class="btn wide book-btn" type="submit">${cardOn() && !user?.card ? "Añadir tarjeta y reservar" : quick ? "Confirmar reserva" : cardOn() ? "Reservar" : "Reservar y pagar en el local"}</button>
          ${
            catalog.rules.recurring
              ? `<div class="repeat-box"><label for="f-every" style="margin-top:0">Repetir esta cita</label><div class="form-actions" style="margin-top:0"><select id="f-every" name="every"><option value="">No, solo esta</option><option value="1">Cada semana</option><option value="2">Cada 2 semanas</option><option value="3">Cada 3 semanas</option><option value="4">Cada 4 semanas</option></select><select name="times" aria-label="Cuántas veces">${Array.from({ length: catalog.rules.recurringMax - 1 }, (_, i) => i + 2).map((n) => `<option value="${n}" ${n === Math.min(4, catalog.rules.recurringMax) ? "selected" : ""}>${n} citas</option>`).join("")}</select></div><small>Mismo día de la semana, misma hora y mismo barbero. Si algún día ya está ocupado, te lo decimos.</small></div>`
              : ""
          }
          <p class="terms-note">Al reservar aceptas las <a href="#condiciones" target="_blank">condiciones</a> y la <a href="#privacidad" target="_blank">privacidad</a>. Puedes cambiarla desde la app hasta ${catalog.rules.cancelHours} h antes.${
            cardOn() ? ` <b>Si no vienes o cancelas con menos de ${catalog.rules.cancelHours} h, autorizas a ${esc(catalog.business.name)} a cobrar hasta ${euro(Math.max(feePct(s, "noShow"), feePct(s, "late")))} en tu tarjeta.</b>` : ""
          }</p>
          <p class="pay-note">${svg(ICONS.card)} ${cardOn() ? "Ahora no se cobra nada. El servicio se paga en el local, en efectivo o con tarjeta." : "En el local puedes pagar en efectivo o con tarjeta."}</p>
        </form>`,
    );
    // Código de amigo: se comprueba mientras se escribe y dice quién te invita.
    let refOk = null,
      refT = 0;
    const refIn = $("#ref-input"),
      refState = $("#ref-state");
    const checkRef = async () => {
      const code = (refIn.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (refIn.value !== code) refIn.value = code;
      refOk = null;
      refState.className = "ref-state";
      refState.textContent = "";
      if (code.length < 4) return;
      refState.textContent = "Comprobando…";
      try {
        const r = await api("referral/" + encodeURIComponent(code));
        if (refIn.value !== code) return;
        refOk = code;
        refState.className = "ref-state ok";
        refState.innerHTML = `✓ Te invita <b>${esc(r.name)}</b>. ${esc(r.name)} sumará ${r.points} puntos cuando vengas a tu primera cita.`;
      } catch (err) {
        if (refIn.value !== code) return;
        refOk = false;
        refState.className = "ref-state bad";
        refState.textContent = err.message;
      }
    };
    if (refIn) {
      $("#ref-toggle").onclick = () => {
        $("#ref-box").classList.add("open");
        setTimeout(() => refIn.focus(), 50);
      };
      refIn.oninput = () => {
        clearTimeout(refT);
        refT = setTimeout(checkRef, 350);
      };
      if (refIn.value) checkRef();
    }
    $("#g-change")?.addEventListener("click", async () => {
      if (await addCard()) render();
    });
    onForm("details", async (d, f) => {
      for (const el of f.querySelectorAll("input[required]")) if (!el.reportValidity()) return;
      if (refIn?.value && refOk === null) await checkRef();
      if (refIn?.value && !refOk) {
        refIn.focus();
        return toast("Ese código de amigo no existe. Revísalo o bórralo.");
      }
      const num = String(d.phone || "").trim();
      const data = { name: String(d.name || user?.name || "").trim(), email: (user?.email || d.email).trim(), phone: num ? `${d.cc} ${num}` : user?.phone || "" };
      Object.assign(draft, data, { terms: true });
      saveDraft();
      // Tarjeta en garantía: se guarda una vez y queda en el perfil para las próximas citas.
      if (cardOn() && !user?.card) {
        const card = await addCard({ ...data, ref: refOk || "" });
        if (!card) return toast("Sin tarjeta en garantía no podemos guardar la cita.");
      }
      const repeat = d.every ? { every: Number(d.every), times: Number(d.times) } : null;
      const book = () => api("book", { ...data, ref: refOk || "", service: draft.service, provider: draft.provider, date: draft.date, start: draft.start, terms: true, repeat });
      let r;
      try {
        r = await book();
      } catch (err) {
        if (err.status !== 402) throw err;
        if (!(await addCard(data))) return toast("Sin tarjeta en garantía no podemos guardar la cita.");
        r = await book();
      }
      availCache.clear();
      lastBooked = { id: r.id, existing: r.existing, service: s, provider: p, date: draft.date, start: draft.start, series: r.series };
      draft = {};
      saveDraft();
      if (r.session) {
        await refreshMe();
        nav();
      }
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
        <h1>${user?.name ? `¡Hecho, ${esc(first(user.name))}!` : "¡Cita reservada!"}</h1><p class="sub">Te esperamos en <em class="serif">el estudio.</em></p>
      </div>` +
        `<div class="ticket">
          <div class="tix-top"><img src="/assets/logo.png" alt="NOVA Studio"><span class="tix-ok">✓ Confirmada</span></div>
          <div class="tix-who">${face(b.provider, "tix-face")}<div><small>Tu barbero</small><strong>${esc(b.provider.name)}</strong></div></div>
          <div class="tix-grid">
            <div><small>Día</small><strong>${esc(cap(fmtDay(b.date, { weekday: "short", day: "numeric", month: "short" })))}</strong></div>
            <div><small>Hora</small><strong>${esc(b.start)}</strong></div>
            <div><small>Servicio</small><strong>${esc(b.service.name)}</strong></div>
            <div><small>Precio</small><strong>${euro(b.service.price)}</strong></div>
          </div>
          <div class="tix-cut" aria-hidden="true"></div>
          <div class="tix-foot"><span>Ref. <b>${esc(b.id)}</b></span><span class="tix-pts">+${pts} ${pts === 1 ? "punto" : "puntos"} Club NOVA</span></div>
        </div>` +
        (b.series
          ? `<div class="card series-note"><strong>${b.series.made} citas, cada ${b.series.every === 1 ? "semana" : b.series.every + " semanas"}</strong><span>${b.series.dates.map((x) => esc(shortDay(x))).join(" · ")}</span>${
              b.series.skipped.length ? `<span class="warn-line">No había hueco a las ${esc(b.start)} el ${b.series.skipped.map((x) => esc(shortDay(x))).join(", ")}: elige otra hora para ese día.</span>` : ""
            }</div>`
          : "") +
        `<a class="btn wide secondary" href="${gcalLink({ ...b, end: addMin(b.start, b.service.duration) })}" target="_blank" rel="noopener">${svg(ICONS.cal)} Añadir a mi calendario</a>` +
        (b.existing
          ? `<p class="warning">Ya tenías cuenta con este correo. Entra con tu correo para ver y cambiar todas tus citas.</p><a class="btn wide" href="#login">Entrar a mis citas</a>`
          : `<a class="btn wide" style="margin-top:10px" href="#booking/${esc(b.id)}">Ver, cambiar o cancelar mi cita</a>`) +
        (user && !user.phone && !b.existing
          ? `<form id="bk-phone" class="card complete"><strong>Completa tu perfil</strong><span>Déjanos tu teléfono por si hay algún cambio con tu cita. Solo te lo pedimos esta vez.</span>
              <div class="form-actions" style="margin-top:10px"><input name="phone" type="tel" inputmode="tel" required maxlength="25" autocomplete="tel" placeholder="+34 600 000 000" aria-label="Teléfono"><button class="btn" type="submit">Guardar</button></div></form>`
          : ""),
    );
    confetti();
    if ($("#bk-phone"))
      onForm("bk-phone", async (d, f) => {
        await api("profile", { name: user.name, phone: d.phone });
        await refreshMe();
        f.outerHTML = `<p class="charge-note ok">Teléfono guardado. Gracias.</p>`;
      });
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
              `<a class="owe" href="#booking/${esc(b.id)}"><strong>Tienes un pago pendiente de ${euro(b.charge.amount)}</strong><span>No viniste a la cita del ${esc(shortDay(b.date))} · ${esc(b.service.name)}. Toca para pagarlo.</span></a>`,
          )
          .join("") +
        (r.upcoming[0] ? nextApptCard(r.upcoming[0]) : "") +
        (r.upcoming.length > 1 ? `<div class="appts">${r.upcoming.slice(1).map((b) => bookingCard(b, r.now)).join("")}</div>` : "") +
        (!r.upcoming.length ? `<a class="appt-empty" href="#home"><strong>No tienes citas pendientes</strong><span>Reserva tu próximo corte en un minuto ›</span></a>` : "") +
        (r.past.length ? `<p class="section-label">Historial</p><div class="appts">${r.past.map((b) => bookingCard(b, r.now)).join("")}</div>` : ""),
    );
  },

  async booking([id]) {
    const r = await api("bookings/" + id),
      b = r.booking,
      p = provById(b.provider.id),
      active = b.status === "confirmed" && !r.past;
    show(
      back("bookings", "Mis citas") +
        heading(esc(b.service.name), `${esc(longDay(b.date))} · ${esc(b.start)}`) +
        `<div class="pick-summary">${face(p)}<div><strong>Con ${esc(b.provider.name)}</strong><span>${b.service.duration} min · ${euro(b.service.price)} · pago en el local</span></div></div>` +
        `<div class="card"><dl class="detail-list">
          <div><dt>Estado</dt><dd>${b.status === "canceled" ? (b.late ? "Cancelada tarde" : "Cancelada") : b.attendance === "absent" ? "No vino" : r.past ? "Realizada" : "Confirmada"}</dd></div>
          <div><dt>Referencia</dt><dd>${esc(b.id)}</dd></div>
          <div><dt>Dónde</dt><dd>${esc(catalog.business.street)}</dd></div>
          ${b.guarantee && active ? `<div><dt>Garantía</dt><dd>${esc(cardLabel(b.guarantee))}</dd></div>` : ""}
        </dl></div>` +
        chargeNote(b) +
        (active
          ? `<div class="stack">
              <a class="btn wide secondary" href="${gcalLink(b)}" target="_blank" rel="noopener">${svg(ICONS.cal)} Añadir a mi calendario</a>
              <a class="btn wide secondary" href="${esc(catalog.business.maps)}" target="_blank" rel="noopener">${svg(ICONS.pin)} Cómo llegar</a>
              ${
                r.canChange
                  ? `<a class="btn wide" href="#move/${esc(b.id)}">Cambiar día u hora</a><button class="btn wide danger" type="button" id="cancel">Cancelar cita</button>`
                  : `<p class="warning">Quedan menos de ${catalog.rules.cancelHours} horas. Para cambiarla de hora, escríbenos. Si la cancelas ahora${
                      r.lateFee ? `, según las condiciones se te pueden cobrar ${euro(r.lateFee)}: tu barbero lo revisará y, si hay un motivo justificado, no se cobra` : ", avísanos"
                    }.</p><a class="btn wide wa-btn" href="${wa(`Hola, tengo cita el ${longDay(b.date)} a las ${b.start} (ref. ${b.id}) y necesito cambiarla.`)}" target="_blank" rel="noopener">${svg(ICONS.chat)} Escribir por WhatsApp</a>${
                      r.canCancel ? `<button class="btn wide danger" type="button" id="cancel">Cancelar cita</button>` : ""
                    }`
              }
            </div>`
          : `<a class="btn wide" href="#barber/${esc(b.service.id)}">Reservar otra igual</a>`),
    );
    $("#pay-now")?.addEventListener("click", () => payPending(b).catch((e) => toast(e.message)));
    $("#cancel")?.addEventListener("click", () => {
      const sh = sheet(
        `<h2>¿Cancelar la cita?</h2><p>${esc(b.service.name)} con ${esc(first(b.provider.name))}, ${esc(longDay(b.date))} a las ${esc(b.start)}. La hora quedará libre para otra persona.</p>${
          r.late && r.lateFee
            ? `<p class="warning">Cancelas con menos de ${catalog.rules.cancelHours} h. Según las condiciones se te pueden cobrar <b>${euro(r.lateFee)}</b>. Lo decide tu barbero: si tienes un motivo justificado, escríbenos por WhatsApp.</p>`
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
          toast(x.late ? "Cita cancelada. Tu barbero revisará si se cobra." : "Cita cancelada.");
          render();
        } catch (err) {
          e.currentTarget.disabled = false;
          toast(err.message);
        }
      };
    });
  },

  async login() {
    loginScreen("", "bookings");
  },

  async code() {
    if (!challenge) return go("login");
    show(
      heading("Mira tu correo", "Te hemos enviado un código de 6 cifras. Caduca en diez minutos.") +
        `<form id="code"><label for="f-code">Código</label><input id="f-code" name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" style="letter-spacing:8px;font-size:22px;text-align:center"><button class="btn wide" style="margin-top:16px" type="submit">Entrar</button></form>` +
        `<a class="btn wide secondary" style="margin-top:10px" href="#login">Usar otro correo</a>`,
    );
    $("#f-code").focus();
    onForm("code", async (d) => {
      await api("auth/verify", { code: d.code, challenge });
      challenge = null;
      await refreshMe();
      nav();
      toast(`¡Hola${user?.name ? ", " + first(user.name) : ""}!`);
      go(sessionStorage.getItem("nova_next") || "bookings");
    });
  },

  async profile() {
    if (!user) return loginScreen("", "profile");
    const [m, bk] = await Promise.all([api("member"), api("bookings").catch(() => ({ upcoming: [] }))]);
    user = m.user;
    nav();
    const L = leagueOf(m.earned),
      got = m.medals.filter((x) => x.got).length;
    show(
      `<section class="ph" style="${leagueVars(L.league)}">
        <div class="ph-top"><span class="ph-brand">SOCIO DEL <b>CLUB</b></span><span class="ph-league">${leagueArt(L.league)}${esc(L.label.toUpperCase())}</span></div>
        <div class="ph-id">
          <label class="ph-avatar" title="Cambiar foto">${user.photo ? `<img src="${esc(user.photo)}" alt="Tu foto">` : `<b>${initial(user.name || user.email)}</b>`}<span class="ph-cam">${svg(ICONS.camera)}</span><input type="file" accept="image/*" id="photo-in" class="sr-only"></label>
          <div class="ph-name"><h1>${esc(user.name || "Tu perfil")}</h1><span>Socio Nº ${String(user.no || 0).padStart(4, "0")} · desde ${esc(monthYear(user.since))}</span></div>
        </div>
        <div class="ph-count"><strong>${nf(m.earned)}</strong><span>${m.earned === 1 ? "punto" : "puntos"}<br>ganados</span></div>
        <div class="ph-bar"><i style="width:${L.pct}%"></i></div>
        <div class="ph-next">${L.toNext ? `${nf(L.toNext)} ${L.toNext === 1 ? "punto" : "puntos"} para <b>✦ ${esc(L.nextLabel)}</b>` : `Has llegado a lo más alto: <b>${esc(topLeague().name)}</b>`}</div>
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
      ${leagueStrip(L.index)}
      ${nextBlock(m, L)}
      ${medalsBlock(m)}
      ${supplyBlock(L)}
      ${inviteBlock(m)}
      ${
        cardOn()
          ? `<p class="section-label">Tu tarjeta</p>
        <div class="card my-card">${
          user.card
            ? `<div class="mc-row"><span class="mc-chip">${esc((BRANDS[user.card.brand] || "Tarjeta").toUpperCase())}</span><div><strong>···· ${esc(user.card.last4)}</strong><span>Caduca ${esc(user.card.exp || "")}</span></div></div>
               <p class="muted">Garantiza tus citas. Solo se usa si no vienes o cancelas con menos de ${catalog.rules.cancelHours} h, y lo revisa tu barbero antes de cobrar.</p>
               <div class="form-actions" style="margin-top:6px"><button type="button" class="btn secondary" id="card-change">Cambiar</button><button type="button" class="btn danger" id="card-remove">Quitar</button></div>`
            : `<p class="muted" style="margin-top:0">Aún no tienes tarjeta guardada. Te la pediremos al reservar, para garantizar la cita. No se cobra nada salvo que faltes sin avisar.</p><button type="button" class="btn wide secondary" id="card-change">Añadir tarjeta</button>`
        }</div>`
          : ""
      }
      <p class="section-label">Tus datos</p>
      <form id="profile" class="card">
        <label for="p-name" style="margin-top:0">Nombre</label><input id="p-name" name="name" required maxlength="120" autocomplete="name" value="${esc(user.name || "")}">
        <label for="p-phone">Teléfono</label><input id="p-phone" name="phone" type="tel" maxlength="30" autocomplete="tel" value="${esc(user.phone || "")}">
        <label for="p-email">Correo</label><input id="p-email" value="${esc(user.email)}" readonly>
        <button class="btn wide" style="margin-top:18px" type="submit">Guardar</button>
      </form>
      <button class="btn wide secondary" type="button" id="logout">${svg(ICONS.logout)} Cerrar sesión</button>` + legalLinks(),
    );
    $$("[data-scroll]").forEach((b) => (b.onclick = () => document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" })));
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

  async rewards() {
    const P = catalog.points;
    if (!user) {
      show(
        `<section class="pts"><span class="pts-tag">EL CLUB</span><strong class="pts-num">${P.welcome}</strong><p>puntos de regalo al entrar · ${P.perEuro} por cada euro, en la silla y en ${esc(catalog.shop.name)} · +${P.perFriend} por cada amigo</p><div class="pts-league">${leagueArt(catalog.leagues[0])}<span>Empiezas en <b>${esc(catalog.leagues[0].name)} III</b> y subes hasta <b>${esc(topLeague().name)}</b></span></div></section>` +
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
        <p>${P.perEuro} puntos por cada euro, en la silla y en ${esc(catalog.shop.name)} · +${P.perFriend} por cada amigo</p>
        <div class="pts-league">${leagueArt(L.league)}<span>Liga <b>${esc(L.label)}</b> · ${nf(m.earned)} puntos ganados</span></div>
      </section>` +
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
              .map((x) => `<div class="mv"><span>${esc(x.text)}${x.when ? `<small>${esc(shortDay(x.when.slice(0, 10)))}</small>` : ""}</span><b class="${x.pts > 0 ? "plus" : "minus"}">${x.pts > 0 ? "+" : ""}${nf(x.pts)}</b></div>`)
              .join("")}</div>`
          : "") +
        `<a class="btn wide secondary" style="margin-top:18px" href="#profile">Ver mi perfil y medallas</a>`,
    );
    celebrate(m, L);
    $$("[data-redeem]").forEach(
      (b) =>
        (b.onclick = () => {
          const r = catalog.rewards.find((x) => x.id === b.dataset.redeem);
          const sh = sheet(
            `<p class="eyebrow">Canjear premio</p><h2>${esc(r.name)}</h2><p>${esc(r.desc)}. Se descuentan <b>${nf(r.cost)} puntos</b> de tu saldo (te quedarán ${nf(m.balance - r.cost)}). Tu liga no baja.</p><div class="form-actions"><button type="button" class="btn secondary" id="no">Ahora no</button><button type="button" class="btn" id="yes">Canjear</button></div>`,
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

  async formacion() {
    await trainingPage();
  },

  async equipo(args = []) {
    if (!staff) return staffLogin();
    try {
      if (staff.caja) return await staffCobros();
      await ({ cobrar: staffCobros, caja: staffCaja, faltas: staffFaltas, formacion: staffTraining, productos: staffProducts, ajustes: staffTeam, web: staffWeb, clientes: staffClients }[args[0]] || staffAgenda)();
    } catch (e) {
      if (e.status !== 401) throw e;
      staff = null;
      render();
    }
  },
};
for (const [k, [title, body]] of Object.entries(LEGAL))
  pages[k] = async () => show(back("home", "Volver") + heading(title, catalog.business.name) + `<article class="legal-page">${body()}</article>` + legalLinks());

// ── Calendario (reservar y cambiar de hora) ────────────────────────────────
async function calendar({ backTo, backLabel }) {
  const s = svcById(draft.service),
    p = provById(draft.provider);
  if (!s || !p) return go("home");
  if (!calMonth) calMonth = monthKey(new Date());
  const thisMonth = monthKey(new Date());
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
    todayIso = isoDay(new Date()),
    times = avail[selectedDate] || [],
    morning = times.filter((t) => t < "14:00"),
    afternoon = times.filter((t) => t >= "14:00"),
    pill = (t) => `<button type="button" class="time-pill" data-time="${t}">${t}</button>`,
    monthName = cap(new Date(cy, cm - 1, 1).toLocaleDateString("es-ES", { month: "long" })) + " " + cy;
  // Punto de disponibilidad: verde = mucha, naranja = media, rojo = pocas.
  // Se compara con el día más libre del mes (un día sin reservas).
  const fullDay = Math.max(1, ...Object.values(avail).map((a) => a.length)),
    level = (n) => (n <= 2 || n / fullDay <= 0.25 ? ["low", ", quedan pocas horas"] : n / fullDay <= 0.6 ? ["mid", ", disponibilidad media"] : ["", ""]);
  let cells = "";
  for (let i = 0; i < lead; i++) cells += `<span class="cal-cell blank" aria-hidden="true"></span>`;
  for (let d = 1; d <= total; d++) {
    const iso = `${calMonth}-${pad(d)}`,
      n = (avail[iso] || []).length,
      open = n > 0,
      [lv, lvLabel] = open ? level(n) : ["", ""];
    cells += `<button type="button" class="cal-cell${open ? " open" : ""}${lv ? " lvl-" + lv : ""}${iso === selectedDate ? " selected" : ""}${iso === todayIso ? " today" : ""}" data-day="${iso}" ${open ? "" : "disabled"} aria-pressed="${iso === selectedDate}" aria-label="${esc(longDay(iso))}${open ? lvLabel : ", sin horas"}">${d}</button>`;
  }
  const maxMonth = shiftMonth(thisMonth, Math.ceil(catalog.rules.daysAhead / 30));
  show(
    back(backTo, backLabel) +
      heading(draft.moving ? "Elige la nueva hora" : "Día y hora") +
      `<div class="pick-summary">${face(p)}<div><strong>${esc(s.name)}</strong><span>${esc(p.name)} · ${s.duration} min · ${euro(s.price)}</span></div></div>` +
      `<div class="cal-card"><div class="cal-head"><button type="button" class="cal-nav" id="prev-month" aria-label="Mes anterior" ${calMonth <= thisMonth ? "disabled" : ""}>‹</button><strong>${monthName}</strong><button type="button" class="cal-nav" id="next-month" aria-label="Mes siguiente" ${calMonth >= maxMonth ? "disabled" : ""}>›</button></div><div class="cal-week"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div><div class="cal-grid">${cells}</div></div>` +
      (selectedDate
        ? `<div class="times"><h2 class="times-title">${esc(longDay(selectedDate))}</h2>${morning.length ? `<p class="times-label">Mañana</p><div class="time-grid">${morning.map(pill).join("")}</div>` : ""}${afternoon.length ? `<p class="times-label">Tarde</p><div class="time-grid">${afternoon.map(pill).join("")}</div>` : ""}</div>`
        : '<p class="empty">No quedan horas libres este mes. Prueba el mes siguiente.</p>') +
      `<div style="height:90px"></div>`,
  );
  $("#prev-month").onclick = () => ((calMonth = shiftMonth(calMonth, -1)), (dayPicked = false), render());
  $("#next-month").onclick = () => ((calMonth = shiftMonth(calMonth, 1)), (dayPicked = false), render());
  $$(".cal-cell[data-day]:not([disabled])").forEach((b) => (b.onclick = () => ((selectedDate = b.dataset.day), (dayPicked = true), render())));

  // Elegir hora solo la marca; se avanza con «Continuar» por si se equivoca.
  const bar = document.createElement("div");
  bar.className = "continue-bar";
  bar.innerHTML = `<div class="continue-info"><span>${draft.moving ? "Nueva hora" : "Tu cita"}</span><strong id="continue-when"></strong></div><button type="button" class="btn" id="continue-btn">${draft.moving ? "Cambiar" : "Continuar"}</button>`;
  bar.hidden = true;
  $("#app").append(bar);
  const pick = (b) => {
    $$(".time-pill.selected").forEach((x) => (x.classList.remove("selected"), x.setAttribute("aria-pressed", "false")));
    b.classList.add("selected");
    b.setAttribute("aria-pressed", "true");
    draft.date = selectedDate;
    draft.start = b.dataset.time;
    saveDraft();
    $("#continue-when").textContent = `${shortDay(selectedDate)} · ${b.dataset.time}`;
    bar.hidden = false;
    requestAnimationFrame(() => bar.classList.add("visible"));
  };
  $$("[data-time]").forEach((b) => {
    b.setAttribute("aria-pressed", "false");
    b.onclick = () => pick(b);
    if (draft.date === selectedDate && draft.start === b.dataset.time) pick(b);
  });
  $("#continue-btn").onclick = async (e) => {
    if (draft.date !== selectedDate || !draft.start) return;
    if (!draft.moving) return go("details");
    e.currentTarget.disabled = true;
    try {
      await api(`bookings/${draft.moving}/move`, { date: draft.date, start: draft.start });
      availCache.clear();
      const id = draft.moving;
      draft = {};
      saveDraft();
      toast("Cita cambiada.");
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
const nf = (n) => Number(n || 0).toLocaleString("es-ES");
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
const monthYear = (stamp) => (stamp ? new Date(String(stamp).slice(0, 10) + "T12:00:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" }) : "hoy");
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
        user && i === index + 1 ? `<span class="lg-left">Te faltan ${nf(left)} puntos · ${cutsFor(left) === 1 ? "con un corte" : `unos ${cutsFor(left)} cortes`}</span>` : ""
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
// «Falta 1 corte», «Faltan 2 meses»… o la descripción si no se cuenta en unidades.
function medalLeft(md, st) {
  const left = md.goal - st.progress,
    unit = MEDAL_UNIT[md.metric];
  return unit && md.goal > 1 ? `Falta${left === 1 ? "" : "n"} ${left} ${left === 1 ? unit[0] : unit[1]}` : md.desc || `Falta${left === 1 ? "" : "n"} ${left}`;
}
function medalCard(md, st) {
  const sub = st.got ? "✓ Conseguida" : medalLeft(md, st),
    bar = !st.got && md.goal > 1 ? `<div class="md-bar" title="${st.progress}/${md.goal}"><i style="width:${Math.max(4, Math.round((st.progress / md.goal) * 100))}%"></i></div>` : "";
  return `<div class="md${st.got ? " got" : ""}" title="${esc(md.desc || md.name)}"><div class="md-art">${medalArt(md, st.got)}${st.got ? "" : `<span class="md-lock">${svg(ICONS.lock)}</span>`}</div><strong>${esc(md.name)}</strong><span class="md-sub">${esc(sub)}</span>${bar}<span class="md-chip">${svg(ICONS.gift)}+${nf(md.bonus)} pts</span></div>`;
}
function medalsBlock(m) {
  const all = catalog.medals.map((md, i) => [md, m.medals[i]]),
    got = m.medals.filter((x) => x.got).length;
  return (
    `<div id="medallas"><p class="section-label">Medallas · ${got}/${all.length}</p>` +
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
      ? `<div class="nx nx-league" style="${leagueVars(target)}">${leagueArt(target)}<div><strong>${esc(L.nextLabel)}</strong><span>Te faltan ${nf(L.toNext)} puntos · ${cutsFor(L.toNext) === 1 ? "con un corte" : `unos ${cutsFor(L.toNext)} cortes`}</span><div class="md-bar"><i style="width:${L.pct}%"></i></div></div></div>`
      : "") +
    near
      .map(
        ([md, s]) =>
          `<div class="nx"><span class="nx-art">${medalArt(md, false)}</span><div><strong>${esc(md.name)}</strong><span>${esc(medalLeft(md, s))}${md.desc && MEDAL_UNIT[md.metric] && md.goal > 1 ? ` · ${esc(md.desc)}` : ""}</span>${
            md.goal > 1 ? `<div class="md-bar"><i style="width:${Math.max(4, Math.round((s.progress / md.goal) * 100))}%"></i></div>` : ""
          }</div><b>+${nf(md.bonus)}</b></div>`,
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
        ? `<div class="cel-medals"><p class="eyebrow">${fresh.length === 1 ? "Medalla nueva" : `${fresh.length} medallas nuevas`}</p>${fresh
            .slice(0, 4)
            .map((md) => `<div class="nx"><span class="nx-art">${medalArt(md, true)}</span><div><strong>${esc(md.name)}</strong><span>${esc(md.desc || "Conseguida")}</span></div><b>+${nf(md.bonus)}</b></div>`)
            .join("")}${fresh.length > 4 ? `<p class="muted" style="text-align:center;margin:4px 0 0">y ${fresh.length - 4} más en tu perfil</p>` : ""}</div>`
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
    <figure class="sp-photo"><img src="${pic("supply")}" alt="Camisetas de ${esc(S.name)}" loading="lazy" width="760" height="1350"></figure>
    <div class="sp-txt">
      <span class="club-tag">${esc(S.name.toUpperCase())}</span>
      <h2>La ropa de <em class="serif">la casa.</em></h2>
      <p>Cada euro en ropa también suma: <b>${catalog.points.perEuro} puntos por euro</b>. Di tu código del Club al pagar en el estudio.</p>
      ${disc ? `<p class="sp-disc" style="${leagueVars(L.league)}">${leagueArt(L.league)}<span>Tu liga ${esc(L.league.name)}: <b>${esc(disc)}</b></span></p>` : `<p class="sp-disc sp-soon">Desde ${esc(catalog.leagues.find((lg) => lg.perks.some((p) => /%.*Supply/.test(p)))?.name || "")}, descuento en cada prenda.</p>`}
      <a class="btn wide club-btn" href="${esc(S.url)}" target="_blank" rel="noopener">Ver la tienda · ${esc(S.label)} ↗</a>
    </div>
  </section>`;
}
function inviteBlock(m) {
  return `<section class="invite" id="amigos">
    <span class="club-tag">INVITA Y SUMA</span>
    <h2>+${catalog.points.perFriend} puntos por cada amigo</h2>
    <p>Pásale tu código para que lo ponga al reservar. Los puntos son tuyos en cuanto venga a su primera cita.</p>
    <div class="inv-code"><strong id="my-code">${esc(user.ref || "—")}</strong><button type="button" id="copy-code" aria-label="Copiar código">${svg(ICONS.copy)}</button></div>
    <button type="button" class="btn wide club-btn" id="share-code">${svg(ICONS.share)} Compartir mi código</button>
    ${
      m.friends.length
        ? `<div class="inv-friends">${m.friends.map((f) => `<span class="${f.counted ? "ok" : ""}">${esc(f.name)}${f.counted ? " ✓" : " · aún no ha venido"}</span>`).join("")}</div>`
        : ""
    }
  </section>`;
}
function bindInvite() {
  const code = user?.ref;
  if (!code) return;
  const url = `${location.origin}/?ref=${encodeURIComponent(code)}`,
    text = `Reserva en NOVA Studio con mi código ${code} 💈`;
  $("#copy-code").onclick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast("Código copiado.");
    } catch {
      toast(code);
    }
  };
  $("#share-code").onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "NOVA Studio", text, url });
      } catch {}
    } else window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank", "noopener");
  };
}
function rewardRow(r, balance) {
  const can = user && balance >= r.cost;
  return `<div class="rw${can ? " can" : ""}"><span class="rw-ic">${svg(ICONS[r.icon] || ICONS.gift)}</span><div><strong>${esc(r.name)}</strong><span>${esc(r.desc)}</span>${
    user && !can ? `<div class="md-bar"><i style="width:${Math.max(4, Math.round((balance / r.cost) * 100))}%"></i></div>` : ""
  }</div>${can ? `<button type="button" class="rw-btn" data-redeem="${esc(r.id)}">Canjear<small>${nf(r.cost)} pts</small></button>` : `<span class="rw-cost">${nf(r.cost)}<small>pts</small></span>`}</div>`;
}
// Recorta la foto en cuadrado y la deja en ~20 KB.
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
    return c.toDataURL("image/jpeg", 0.82);
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

// ── Equipo ─────────────────────────────────────────────────────────────────
const canManage = (providerId) => !!staff && (staff.owner || staff.id === providerId);
const monthLabel = (key) => cap(dayDate(key + "-01").toLocaleDateString("es-ES", { month: "long", year: "numeric" }));
const shortDate = (iso) => fmtDay(iso, { day: "numeric", month: "short" });

function staffLogin() {
  let last = staffHint?.id || "";
  try {
    last = staffHint?.id || localStorage.getItem("nova_staff_who") || "";
  } catch {}
  show(
    back("home", "Inicio") +
      heading("Acceso equipo", staffHint ? `Hola, ${esc(first(staffHint.name))}. Pon tu clave una vez: este móvil se queda con la sesión iniciada.` : "Elige quién eres y pon tu clave. Solo hace falta la primera vez en cada móvil.") +
      `<form id="staff"><div class="who" role="radiogroup" aria-label="Quién eres">${catalog.providers
        .map(
          (p) =>
            `<label class="who-item"><input type="radio" name="provider" value="${esc(p.id)}" ${p.id === last ? "checked" : ""}>${face(p, "who-face")}<span>${esc(first(p.name))}</span></label>`,
        )
        .join("")}<label class="who-item who-caja"><input type="radio" name="provider" value="caja" ${last === "caja" ? "checked" : ""}><span class="who-face" aria-hidden="true">${svg(ICONS.till)}</span><span><strong>Caja</strong><small>La tablet del mostrador: solo para cobrar. Entra con la clave de cualquiera del equipo.</small></span></label></div>
      <label for="s-pin" id="s-pin-l">${last === "caja" ? "Clave de cualquiera del equipo" : "Tu clave"}</label><input id="s-pin" name="pin" type="password" inputmode="numeric" required autocomplete="current-password">
      <button class="btn wide" style="margin-top:16px" type="submit">Entrar</button></form>`,
  );
  $$("#staff [name=provider]").forEach((i) => (i.onchange = () => ($("#s-pin-l").textContent = i.value === "caja" ? "Clave de cualquiera del equipo" : "Tu clave")));
  onForm("staff", async (d) => {
    if (!d.provider) throw Error("Elige quién eres.");
    await api("staff/login", { provider: d.provider, pin: d.pin });
    try {
      localStorage.setItem("nova_staff_who", d.provider);
    } catch {}
    await refreshMe();
    nav();
    render();
  });
}

function staffTop(tab) {
  if (staff.caja)
    return `<div class="staff-top"><span class="who-face" aria-hidden="true">${svg(ICONS.till)}</span><div><p class="eyebrow">NOVA Studio</p><h1>Caja</h1></div></div>`;
  return (
    `<div class="staff-top">${face(provById(staff.id), "who-face")}<div><p class="eyebrow">${staff.owner ? "Propietario" : "Panel de barbero"}</p><h1>Hola, ${esc(first(staff.name))}</h1></div></div>` +
    `<div class="tabs" role="navigation" aria-label="Panel"><a href="#equipo" class="${tab === "agenda" ? "active" : ""}" ${tab === "agenda" ? 'aria-current="page"' : ""}>Agenda</a><a href="#equipo/cobrar" class="${tab === "cobrar" ? "active" : ""}" ${tab === "cobrar" ? 'aria-current="page"' : ""}>Cobrar</a><a href="#equipo/caja" class="${tab === "caja" ? "active" : ""}" ${tab === "caja" ? 'aria-current="page"' : ""}>${staff.owner ? "Caja y comisiones" : "Mi caja"}</a><a href="#equipo/faltas" class="${tab === "faltas" ? "active" : ""}" ${tab === "faltas" ? 'aria-current="page"' : ""}>Faltas</a>${
      staff.owner
        ? `<a href="#equipo/formacion" class="${tab === "formacion" ? "active" : ""}" ${tab === "formacion" ? 'aria-current="page"' : ""}>Formación</a><a href="#equipo/productos" class="${tab === "productos" ? "active" : ""}" ${tab === "productos" ? 'aria-current="page"' : ""}>Productos</a><a href="#equipo/ajustes" class="${tab === "ajustes" ? "active" : ""}" ${tab === "ajustes" ? 'aria-current="page"' : ""}>Equipo y normas</a><a href="#equipo/web" class="${tab === "web" ? "active" : ""}" ${tab === "web" ? 'aria-current="page"' : ""}>Web</a><a href="#equipo/clientes" class="${tab === "clientes" ? "active" : ""}" ${tab === "clientes" ? 'aria-current="page"' : ""}>Clientes</a>`
        : ""
    }</div>`
  );
}

async function staffAgenda() {
  if (!staffDay) staffDay = isoDay(new Date());
  const [r, rd] = await Promise.all([api("staff/day?date=" + staffDay), api("staff/redemptions").catch(() => ({ pending: [] }))]);
  const canjes = rd.pending.length
    ? `<section class="ag-col"><div class="ag-head"><h2>Premios por entregar</h2><span>${rd.pending.length}</span></div>${rd.pending
        .map(
          (x) => `<div class="ag-item rd-item"><time>${esc(x.id)}</time><div><strong>${esc(x.reward.name)}</strong><span>${esc(x.name || x.email)} · ${nf(x.reward.cost)} pts</span></div><span class="seg"><button type="button" class="small" data-rd="${esc(x.id)}" data-st="done">Entregado</button></span></div>`,
        )
        .join("")}</section>`
    : "";
  const today = new Date();
  let strip = "";
  for (let i = -3; i < 21; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i),
      iso = isoDay(d);
    strip += `<button type="button" class="day-chip${iso === staffDay ? " active" : ""}" data-day="${iso}"><small>${esc(fmtDay(iso, { weekday: "short" }))}</small>${d.getDate()}</button>`;
  }
  // Primero la columna propia. Un barbero ve las de los demás solo si lo pide,
  // y sin importes.
  const providers = [...r.providers].sort((a, b) => (b.id === staff.id) - (a.id === staff.id));
  const shown = staff.owner || staffAll ? providers : providers.filter((p) => p.id === staff.id);
  const cols = shown
    .map((p) => {
      const list = r.bookings.filter((b) => b.provider.id === p.id);
      const live = list.filter((b) => b.status === "confirmed" && b.kind === "booking");
      const total = live.reduce((a, b) => a + (b.service.price || 0), 0);
      const mine = canManage(p.id);
      return `<section class="ag-col${mine ? "" : " ag-other"}"><div class="ag-head"><h2>${p.id === staff.id ? "Tu agenda" : esc(p.name)}</h2><span>${p.hours.length ? p.hours.map((h) => h.join("–")).join(" · ") : "No trabaja"} · ${live.length} ${live.length === 1 ? "cita" : "citas"}${mine ? " · " + euro(total) : ""}</span></div>
        ${
          list.length
            ? list
                .map(
                  (b) => `<button type="button" class="ag-item ${b.kind === "block" ? "block" : ""} ${b.status === "canceled" ? "canceled" : ""} ${b.attendance}" data-id="${esc(b.id)}">
                    <time>${esc(b.start)}<small>${esc(b.end)}</small></time>
                    <div><strong>${b.kind === "block" ? "⛔ " + esc(b.service.name) : esc(b.name)}${b.strikes ? ` <em class="strike" title="Ha faltado ${b.strikes} ${b.strikes === 1 ? "vez" : "veces"}">⚠ ${b.strikes}</em>` : ""}</strong><span>${b.kind === "block" ? "Bloqueado" : esc(b.service.name) + (b.phone ? " · " + esc(b.phone) : "")}</span></div>
                    <span>${b.status === "canceled" ? (b.late ? "Cancelada tarde" : "Cancelada") : b.pay ? "✓ Cobrado" : b.attendance === "done" ? "✓ Vino" : b.attendance === "absent" ? "✗ No vino" : b.by === "staff" ? "Equipo" : "App"}</span>
                  </button>`,
                )
                .join("")
            : `<p class="ag-free">Sin citas este día.</p>`
        }</section>`;
    })
    .join("");
  show(
    staffTop("agenda") +
      `<p class="ag-day">${esc(longDay(staffDay))}</p>` +
      `<div class="day-strip" id="strip">${strip}</div>` +
      `<div class="staff-bar"><button type="button" class="btn" id="new-bk">+ Cita</button><button type="button" class="btn secondary" id="new-block">Bloquear hora</button><button type="button" class="btn secondary" id="new-shop">${svg(ICONS.bag)} Venta de ropa</button></div>` +
      canjes +
      cols +
      (staff.owner ? "" : `<button type="button" class="btn wide secondary" style="margin-top:14px" id="see-all">${staffAll ? "Ver solo mi agenda" : "Ver la agenda de todo el salón"}</button>`) +
      `<button type="button" class="btn wide secondary" style="margin-top:28px" id="staff-set">${svg(ICONS.cal)} Avisos y calendario</button>` +
      `<button type="button" class="btn wide secondary" style="margin-top:10px" id="staff-out">Salir del panel</button>`,
  );
  $("#strip .active")?.scrollIntoView({ inline: "center", block: "nearest" });
  $$(".day-chip").forEach((b) => (b.onclick = () => ((staffDay = b.dataset.day), render())));
  $$(".ag-item[data-id]").forEach((el) => (el.onclick = () => staffSheet(r.bookings.find((b) => b.id === el.dataset.id))));
  $$("[data-rd]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await api("staff/redemptions/" + b.dataset.rd, { status: b.dataset.st });
          toast("Premio entregado.");
          render();
        } catch (e) {
          b.disabled = false;
          toast(e.message);
        }
      }),
  );
  $("#new-bk").onclick = () => staffNew(false);
  $("#new-block").onclick = () => staffNew(true);
  $("#new-shop").onclick = () => staffShop("");
  $("#staff-set").onclick = () => staffSettings();
  const all = $("#see-all");
  if (all) all.onclick = () => ((staffAll = !staffAll), render());
  $("#staff-out").onclick = async () => {
    await api("staff/logout", {});
    staff = null;
    nav();
    go("home");
  };
}

// ── Equipo: caja ───────────────────────────────────────────────────────────
function cajaStats(p) {
  const withComm = staff.owner && !p.owner;
  const rows = p.rows
    .map(
      (x) =>
        `<li><time>${esc(shortDate(x.date))}<small>${esc(x.start)}</small></time><span><strong>${esc(x.name)}</strong>${esc(x.service)}${x.pay ? ` · ${esc(methodName(x.method))}` : " · sin cobro apuntado"}</span><b>${euro(x.price)}${withComm ? `<small>${String(x.pct).replace(".", ",")} % · ${euro(x.commission)}</small>` : ""}</b></li>`,
    )
    .join("");
  return (
    `<div class="stat3 money"><div><strong>${p.services}</strong><span>Servicios</span></div><div><strong>${euro(p.billed)}</strong><span>Facturado</span></div><div><strong>${euro(p.average)}</strong><span>Ticket medio</span></div></div>` +
    `<p class="caja-meta">${p.upcoming ? `Quedan ${p.upcoming} ${p.upcoming === 1 ? "cita" : "citas"} este mes (${euro(p.expected)})` : "No quedan citas este mes"} · ${p.absent} no ${p.absent === 1 ? "vino" : "vinieron"} · ${p.canceled} ${p.canceled === 1 ? "cancelada" : "canceladas"}${p.penalties ? ` · ${euro(p.penalties)} cobrados por faltas` : ""}</p>` +
    (p.collected
      ? `<p class="caja-meta">Cobrado en caja: <b>${euro(p.collected)}</b> (${(catalog.payMethods || [])
          .filter((m) => p.methods?.[m.id])
          .map((m) => `${esc(m.name.toLowerCase())} ${euro(p.methods[m.id])}`)
          .join(" · ")})</p>`
      : "") +
    (p.unpaid ? `<p class="caja-meta">${p.unpaid} ${p.unpaid === 1 ? "cita hecha" : "citas hechas"} sin cobro apuntado: cuentan con el precio del servicio.</p>` : "") +
    (p.byService.length
      ? `<div class="card caja-svc"><dl class="detail-list">${p.byService.map((x) => `<div><dt>${esc(x.name)} <small>× ${x.count}</small></dt><dd>${euro(x.total)}</dd></div>`).join("")}</dl></div>`
      : "") +
    (p.rows.length
      ? `<details class="caja-more"><summary>Ver ${p.rows.length === 1 ? "el servicio" : `los ${p.rows.length} servicios`}</summary><ul class="caja-rows">${rows}</ul></details>`
      : `<p class="ag-free">Aún no hay servicios hechos este mes.</p>`)
  );
}

async function staffCaja() {
  const nowKey = monthKey(new Date());
  if (!staffMonth) staffMonth = nowKey;
  const r = await api("staff/summary?month=" + staffMonth);
  const label = monthLabel(r.month);
  const monthNav = `<div class="month-nav"><button type="button" class="cal-nav" data-m="-1" aria-label="Mes anterior">‹</button><strong>${esc(label)}</strong><button type="button" class="cal-nav" data-m="1" aria-label="Mes siguiente" ${staffMonth >= shiftMonth(nowKey, 2) ? "disabled" : ""}>›</button></div>`;
  const me = r.people.find((p) => p.id === staff.id);
  let body;
  if (!r.owner) {
    body = `<p class="section-label">Tu mes</p>` + cajaStats(me);
  } else {
    const t = r.totals;
    const team = r.people.filter((p) => !p.owner);
    body =
      `<div class="club-card caja-hero"><span class="club-tag">TUS INGRESOS · ${esc(label.toUpperCase())}</span><p class="caja-big">${euro(t.income)}</p>
        <ul class="caja-split"><li><span>Tus servicios</span><b>${euro(t.own)}</b></li><li><span>Comisiones del equipo</span><b>${euro(t.commissions)}</b></li><li><span>Facturación de todo el salón</span><b>${euro(t.salon)}</b></li></ul>
        ${t.pendingCommissions ? `<p>Te quedan por cobrar ${euro(t.pendingCommissions)} de comisiones.</p>` : t.commissions ? `<p>Comisiones del mes cobradas.</p>` : ""}</div>` +
      `<p class="section-label">Equipo</p>` +
      team
        .map(
          (p) => `<div class="card worker">
            <div class="worker-head">${face(provById(p.id), "who-face")}<div><strong>${esc(p.name)}</strong><span>${p.services} ${p.services === 1 ? "servicio" : "servicios"} · ${euro(p.billed)} facturado</span></div></div>
            <div class="comm-box"><div><span>Comisión</span><strong>${String(p.pct).replace(".", ",")} %</strong></div><div><span>Te toca</span><strong>${euro(p.commission)}</strong></div><div><span>Le queda</span><strong>${euro(Math.round((p.billed - p.commission) * 100) / 100)}</strong></div></div>
            ${p.expectedCommission ? `<p class="caja-meta">Con las citas que quedan este mes: +${euro(p.expectedCommission)} de comisión.</p>` : ""}
            <div class="seg"><button type="button" class="secondary" data-pct="${esc(p.id)}">Cambiar %</button><button type="button" class="${p.paid ? "paid" : "secondary"}" data-paid="${esc(p.id)}">${p.paid ? "✓ Cobrado" : "Marcar como cobrado"}</button></div>
            ${p.paid ? `<p class="caja-meta">Cobrado el ${esc(shortDate(p.paid.slice(0, 10)))}. Pulsa otra vez para desmarcarlo.</p>` : ""}
            <details class="caja-more"><summary>Ver el detalle de ${esc(first(p.name))}</summary>${cajaStats(p)}</details>
          </div>`,
        )
        .join("") +
      `<p class="section-label">Tus servicios</p>` +
      cajaStats(me);
  }
  show(staffTop("caja") + monthNav + body);
  $$(".month-nav [data-m]").forEach((b) => (b.onclick = () => ((staffMonth = shiftMonth(staffMonth, Number(b.dataset.m))), render())));
  $$("[data-pct]").forEach((b) => (b.onclick = () => pctSheet(r.people.find((p) => p.id === b.dataset.pct), label)));
  $$("[data-paid]").forEach(
    (b) =>
      (b.onclick = async () => {
        const p = r.people.find((x) => x.id === b.dataset.paid);
        b.disabled = true;
        try {
          await api("staff/commission/paid", { provider: p.id, month: r.month, paid: !p.paid });
          toast(p.paid ? "Desmarcado." : `Comisión de ${first(p.name)} cobrada.`);
          render();
        } catch (e) {
          b.disabled = false;
          toast(e.message);
        }
      }),
  );
}

function pctSheet(p, label) {
  const sh = sheet(
    `<p class="eyebrow">Comisión</p><h2>${esc(p.name)}</h2>
    <p class="muted">Lo que te quedas de cada servicio que hace ${esc(first(p.name))}. Se aplica desde ${esc(label.toLowerCase())} en adelante; los meses anteriores no cambian.</p>
    <form id="pct"><label for="pct-in">Porcentaje</label><div class="pct-field"><input id="pct-in" name="pct" type="number" min="0" max="100" step="0.5" inputmode="decimal" required value="${esc(p.pct)}"><span>%</span></div>
    <button class="btn wide" style="margin-top:18px" type="submit">Guardar</button></form>`,
  );
  sh.el.querySelector("#pct").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await api("staff/commission", { provider: p.id, pct: e.target.pct.value, month: staffMonth });
      sh.close();
      toast("Comisión guardada.");
      render();
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
}

// ── Equipo: cobrar en caja ─────────────────────────────────────────────────
// La tablet del mostrador. Se elige quién ha hecho el servicio y el formulario
// se rellena solo con su cliente de ahora (a las 11 se cobra al de las 10:30),
// con su servicio y su precio. Todo se puede cambiar: un extra, otro importe…
const methodName = (id) => (catalog.payMethods || []).find((m) => m.id === id)?.name || id || "";
const byLabel = (by) => (by === "caja" ? "desde la caja" : `por ${esc(first(provById(by)?.name || by))}`);
const cobroSvcs = () => catalog.services.filter((s) => !s.consult);
const minOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const money = (n) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace(".", ",")} €`;

// La cita que toca cobrar: la última que ya ha terminado (o está a punto),
// si no la que está en marcha, y si no la siguiente.
function guessBooking(list, nowStamp) {
  if (!list.length) return null;
  const now = minOf(nowStamp.slice(11, 16));
  const ended = list.filter((b) => minOf(b.end) <= now + 10);
  if (ended.length) return ended[ended.length - 1];
  const started = list.filter((b) => minOf(b.start) <= now);
  return started[started.length - 1] || list[0];
}

function cobroForm(r, x) {
  const team = r.team.length ? r.team : catalog.providers;
  const guess = r.date === r.today ? guessBooking(r.pending, r.now) : null;
  const prov = x?.provider.id || (team.some((p) => p.id === staff.id) ? staff.id : guess?.provider || team[0]?.id);
  return `<form id="cobro" class="cobro" autocomplete="off">
    <p class="cb-label">Quién ha hecho el servicio</p>
    <div class="who cb-who" role="radiogroup" aria-label="Barbero">${team
      .map(
        (p) =>
          `<label class="who-item"><input type="radio" name="provider" value="${esc(p.id)}" ${p.id === prov ? "checked" : ""}>${face(provById(p.id) || p, "who-face")}<span>${esc(first(p.name))}</span></label>`,
      )
      .join("")}</div>
    <p class="cb-label">Cliente</p>
    <div class="cb-chips" id="cb-clients"></div>
    <input name="name" id="cb-name" placeholder="Nombre del cliente" maxlength="60" aria-label="Nombre del cliente">
    <input type="hidden" name="booking">
    <p class="cb-label">Servicio</p>
    <div class="cb-chips" role="radiogroup" aria-label="Servicio">${cobroSvcs()
      .map((s) => `<label class="cb-chip"><input type="radio" name="service" value="${esc(s.id)}"><span>${esc(s.name)}</span><small>${euro(s.price)}</small></label>`)
      .join("")}</div>
    ${
      (catalog.extras || []).length
        ? `<p class="cb-label">Extras</p><div class="cb-chips">${catalog.extras
            .map((e) => `<label class="cb-chip cb-extra"><input type="checkbox" name="extras" value="${esc(e.id)}"><span>+ ${esc(e.name)}</span><small>${euro(e.price)}</small></label>`)
            .join("")}</div>`
        : ""
    }
    <p class="cb-label">Importe</p>
    <div class="cb-amount"><input name="amount" id="cb-amount" inputmode="decimal" aria-label="Importe en euros" required><span>€</span></div>
    <p class="cb-hint" id="cb-hint"></p>
    <p class="cb-label">Forma de pago</p>
    <div class="cb-chips cb-pay" role="radiogroup" aria-label="Forma de pago">${(catalog.payMethods || [])
      .map((m, i) => `<label class="cb-chip"><input type="radio" name="method" value="${esc(m.id)}" ${(x ? x.method === m.id : i === 0) ? "checked" : ""}><span>${esc(m.name)}</span></label>`)
      .join("")}</div>
    <button class="btn wide cb-go" type="submit">Cobrar</button>
  </form>`;
}

function bindCobroForm(root, r, x, done) {
  const f = root.querySelector("#cobro");
  const amount = f.querySelector("#cb-amount"),
    hint = f.querySelector("#cb-hint"),
    go_ = f.querySelector(".cb-go");
  let touched = !!x;
  const nameIn = f.querySelector("[name=name]"),
    bookIn = f.querySelector("[name=booking]");
  const val = (n) => f.querySelector(`[name=${n}]:checked`)?.value || "";
  const parse = (v) => Math.round(Number(String(v).replace(",", ".")) * 100) / 100;
  const base = () => {
    const s = svcById(val("service"));
    const ex = [...f.querySelectorAll("[name=extras]:checked")].map((i) => catalog.extras.find((e) => e.id === i.value)).filter(Boolean);
    return { s, ex, total: (Number(s?.price) || 0) + ex.reduce((a, e) => a + e.price, 0) };
  };
  const refresh = () => {
    const b = base();
    if (!touched) amount.value = b.total ? String(b.total).replace(".", ",") : "";
    const n = parse(amount.value);
    const diff = Math.round((n - b.total) * 100) / 100;
    hint.textContent = !b.s
      ? "Elige el servicio."
      : `${b.s.name} ${euro(b.s.price)}${b.ex.map((e) => ` + ${e.name.toLowerCase()} ${euro(e.price)}`).join("")}` +
        (n && diff ? ` · ${diff > 0 ? "+" : "−"}${money(Math.abs(diff))} a mano` : "") +
        (touched && diff ? "" : " · puedes cambiar el importe a mano");
    go_.textContent = (x ? "Guardar · " : "Cobrar ") + (n > 0 ? money(n) : "");
  };
  // Clientes de ese barbero que quedan por cobrar hoy (y la cita del cobro que se edita).
  const clients = (prov) => {
    const list = r.pending.filter((b) => b.provider === prov);
    if (x?.booking && x.provider.id === prov && !list.some((b) => b.id === x.booking))
      list.unshift({ id: x.booking, provider: prov, name: x.name, start: x.time, end: x.time, service: x.items.find((i) => !i.extra)?.id });
    return list;
  };
  const pick = (b, keepService) => {
    bookIn.value = b?.id || "";
    nameIn.value = b ? b.name : "";
    if (b?.service && !keepService) {
      const radio = f.querySelector(`[name=service][value="${b.service}"]`);
      if (radio) radio.checked = true;
    }
    if (!keepService) f.querySelectorAll("[name=extras]").forEach((i) => (i.checked = false));
    [...root.querySelectorAll("#cb-clients .cb-chip")].forEach((c) => c.classList.toggle("on", c.dataset.id === (b?.id || "")));
    if (!keepService) touched = false;
    refresh();
  };
  const drawClients = () => {
    const prov = val("provider");
    const list = clients(prov);
    // Solo los servicios que hace ese barbero (el corte privado es de Airam).
    f.querySelectorAll("[name=service]").forEach((i) => {
      const s = svcById(i.value);
      i.closest("label").hidden = !!s?.providers?.length && !s.providers.includes(prov);
      if (i.closest("label").hidden && i.checked) i.checked = false;
    });
    root.querySelector("#cb-clients").innerHTML =
      list.map((b) => `<button type="button" class="cb-chip" data-id="${esc(b.id)}"><span>${esc(b.start)}</span><small>${esc(b.name)}</small></button>`).join("") +
      `<button type="button" class="cb-chip" data-id=""><span>Sin cita</span><small>Entra sin reservar</small></button>`;
    [...root.querySelectorAll("#cb-clients .cb-chip")].forEach((c) => (c.onclick = () => pick(list.find((b) => b.id === c.dataset.id) || null)));
    return list;
  };

  if (x) {
    drawClients();
    const main = x.items.find((i) => !i.extra);
    if (main) f.querySelector(`[name=service][value="${main.id}"]`) && (f.querySelector(`[name=service][value="${main.id}"]`).checked = true);
    x.items.filter((i) => i.extra).forEach((i) => {
      const c = f.querySelector(`[name=extras][value="${i.id}"]`);
      if (c) c.checked = true;
    });
    amount.value = String(x.amount).replace(".", ",");
    pick(clients(x.provider.id).find((b) => b.id === x.booking) || null, true);
    nameIn.value = x.name;
  } else {
    const preset = cobroPre && r.pending.find((b) => b.id === cobroPre);
    cobroPre = "";
    if (preset) f.querySelector(`[name=provider][value="${preset.provider}"]`) && (f.querySelector(`[name=provider][value="${preset.provider}"]`).checked = true);
    const list = drawClients();
    pick(preset || (r.date === r.today ? guessBooking(list, r.now) : null));
    if (!val("service")) {
      const first = f.querySelector("[name=service]");
      if (first) first.checked = true;
      refresh();
    }
  }

  f.querySelectorAll("[name=provider]").forEach(
    (i) =>
      (i.onchange = () => {
        const list = drawClients();
        pick(r.date === r.today ? guessBooking(list, r.now) : null);
        if (!val("service")) {
          const s = [...f.querySelectorAll("[name=service]")].find((i) => !i.closest("label").hidden);
          if (s) (s.checked = true), refresh();
        }
      }),
  );
  f.querySelectorAll("[name=service], [name=extras]").forEach((i) => (i.onchange = () => ((touched = false), refresh())));
  amount.oninput = () => ((touched = true), refresh());

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    go_.disabled = true;
    try {
      const body = {
        provider: val("provider"),
        booking: bookIn.value,
        name: nameIn.value,
        service: val("service"),
        extras: [...f.querySelectorAll("[name=extras]:checked")].map((i) => i.value),
        amount: amount.value,
        method: val("method"),
      };
      const out = await api(x ? "staff/cobros/" + x.id : "staff/cobros", body);
      done(out.cobro);
    } catch (err) {
      toast(err.message);
    } finally {
      if (document.body.contains(go_)) go_.disabled = false;
    }
  });
}

async function staffCobros() {
  const today = isoDay(new Date());
  if (!cobroDay) cobroDay = today;
  const r = await api("staff/cobros?date=" + cobroDay);
  const isToday = r.date === r.today;
  const t = r.totals;
  const dayNav = staff.caja
    ? ""
    : `<div class="month-nav"><button type="button" class="cal-nav" data-d="-1" aria-label="Día anterior">‹</button><strong>${esc(isToday ? "Hoy · " + longDay(r.date) : longDay(r.date))}</strong><button type="button" class="cal-nav" data-d="1" aria-label="Día siguiente" ${isToday ? "disabled" : ""}>›</button></div>`;
  const row = (x) => {
    const other = x.provider.id !== staff.id;
    return `<button type="button" class="ag-item cb-row" data-pay="${esc(x.id)}">
      <time>${esc(x.time)}</time>
      <div><strong>${esc(x.name)}</strong><span>${esc(x.items.map((i) => i.name).join(" + "))}${staff.owner || other ? " · " + esc(first(x.provider.name)) : ""}${x.by !== x.provider.id && !staff.caja ? ` · ${byLabel(x.by)}` : ""}</span></div>
      <span class="cb-amt"><b>${money(x.amount)}</b><small>${esc(methodName(x.method))}</small></span>
    </button>`;
  };
  const summary =
    `<div class="stat3 money"><div><strong>${euro(t.total)}</strong><span>${staff.caja ? "En caja hoy" : staff.owner ? "Todo el salón" : "Tus cobros"}</span></div>${t.methods
      .slice(0, 2)
      .map((m) => `<div><strong>${euro(m.total)}</strong><span>${esc(m.name)}</span></div>`)
      .join("")}</div>` +
    `<p class="caja-meta">${t.count} ${t.count === 1 ? "cobro" : "cobros"}${t.methods
      .slice(2)
      .map((m) => ` · ${esc(m.name.toLowerCase())} ${euro(m.total)}`)
      .join("")}</p>` +
    (staff.owner && t.people.length
      ? `<div class="cb-people">${t.people
          .map((p) => `<div class="cb-person">${face(provById(p.id) || p, "who-face")}<div><strong>${esc(first(p.name))}</strong><span>${p.count} ${p.count === 1 ? "servicio" : "servicios"}</span></div><b>${money(p.total)}</b></div>`)
          .join("")}</div>`
      : "");
  show(
    staffTop("cobrar") +
      dayNav +
      (isToday ? `<div class="card cb-card">${cobroForm(r)}</div>` : "") +
      `<p class="section-label">${isToday ? "Cobros de hoy" : "Cobros del día"}</p>` +
      summary +
      (r.cobros.length ? r.cobros.map(row).join("") : `<p class="ag-free">Aún no hay cobros este día.</p>`) +
      (staff.caja ? `<button type="button" class="btn wide secondary" style="margin-top:28px" id="staff-out">Cerrar la caja</button>` : ""),
  );
  const out = $("#staff-out");
  if (out)
    out.onclick = async () => {
      await api("staff/logout", {});
      staff = null;
      nav();
      go("equipo");
    };
  $$(".month-nav [data-d]").forEach(
    (b) =>
      (b.onclick = () => {
        const d = dayDate(cobroDay);
        d.setDate(d.getDate() + Number(b.dataset.d));
        cobroDay = isoDay(d) > today ? today : isoDay(d);
        render();
      }),
  );
  if (isToday)
    bindCobroForm($("#app"), r, null, (c) => {
      toast(`Cobrados ${money(c.amount)} a ${first(c.provider.name)}${c.name ? " · " + c.name : ""}.`);
      render();
    });
  $$("[data-pay]").forEach((el) => (el.onclick = () => cobroSheet(r, r.cobros.find((x) => x.id === el.dataset.pay))));
}

function cobroSheet(r, x) {
  if (!x) return;
  const mayEdit = staff.owner || x.provider.id === staff.id || x.by === staff.id || (staff.caja && x.date === r.today);
  const sh = sheet(
    `<p class="eyebrow">Cobro · ${esc(longDay(x.date))} · ${esc(x.time)}</p><h2>${esc(x.name)} · ${money(x.amount)}</h2>` +
      `<p class="muted">Apuntado ${byLabel(x.by)}${x.edited ? ` · cambiado a las ${esc(x.edited.slice(11, 16))}` : ""}.</p>` +
      (mayEdit
        ? cobroForm(r, x) + `<button type="button" class="btn wide danger" style="margin-top:12px" id="cb-del">Quitar este cobro</button>`
        : `<div class="card"><dl class="detail-list"><div><dt>Servicio</dt><dd>${esc(x.items.map((i) => i.name).join(" + "))}</dd></div><div><dt>Pago</dt><dd>${esc(methodName(x.method))}</dd></div></dl></div>`),
  );
  if (!mayEdit) return;
  bindCobroForm(sh.el, r, x, () => {
    sh.close();
    toast("Cobro cambiado.");
    render();
  });
  const del = sh.el.querySelector("#cb-del");
  del.onclick = async () => {
    if (del.dataset.sure !== "1") {
      del.dataset.sure = "1";
      del.textContent = "Pulsa otra vez para quitarlo";
      return;
    }
    del.disabled = true;
    try {
      await api(`staff/cobros/${x.id}/delete`, {});
      sh.close();
      toast("Cobro quitado.");
      render();
    } catch (e) {
      del.disabled = false;
      toast(e.message);
    }
  };
}

// ── Equipo: hojas ──────────────────────────────────────────────────────────
function staffSheet(b) {
  if (!b) return;
  const block = b.kind === "block",
    mine = canManage(b.provider.id);
  const sh = sheet(
    `<p class="eyebrow">${esc(longDay(b.date))} · ${esc(b.start)}–${esc(b.end)}</p><h2>${block ? esc(b.service.name) : esc(b.name)}</h2>` +
      (block
        ? `<p class="muted">Hora bloqueada para ${esc(b.provider.name)}.</p>`
        : (b.strikes ? `<p class="strike-warn">⚠ Este cliente ha faltado ${b.strikes} ${b.strikes === 1 ? "vez" : "veces"} sin avisar.</p>` : "") +
          `<div class="card"><dl class="detail-list"><div><dt>Servicio</dt><dd>${esc(b.service.name)} · ${euro(b.service.price)}</dd></div><div><dt>Barbero</dt><dd>${esc(b.provider.name)}</dd></div><div><dt>Teléfono</dt><dd>${esc(b.phone || "—")}</dd></div><div><dt>Correo</dt><dd>${esc(b.email || "—")}</dd></div><div><dt>Reservada por</dt><dd>${b.by === "staff" ? "Equipo" : "App"}</dd></div></dl></div>`) +
      (b.status !== "confirmed"
        ? b.late && mine
          ? `<p class="warning">La canceló el cliente con poca antelación${b.canceledAt ? " (" + esc(b.canceledAt.slice(11)) + " del " + esc(shortDate(b.canceledAt.slice(0, 10))) + ")" : ""}.</p>` + staffCharge(b)
          : `<p class="warning">Cancelada${b.late ? " tarde" : ""}.</p>`
        : !mine
          ? `<p class="muted">Es una cita de ${esc(first(b.provider.name))}: solo la pueden cambiar ${esc(first(b.provider.name))} o el dueño.</p>`
          : (block
              ? ""
              : (b.pay
                  ? `<p class="cb-paid">✓ Cobrado en caja: <b>${euro(b.pay.amount)}</b> · ${esc(methodName(b.pay.method))}</p>`
                  : b.attendance !== "absent"
                    ? `<button type="button" class="btn wide sp-staff-btn" id="sh-cobrar" style="margin-bottom:10px">Cobrar en caja</button>`
                    : "") +
                `<div class="seg"><button type="button" class="${b.attendance === "done" ? "" : "secondary"}" data-att="done">✓ Vino</button><button type="button" class="${b.attendance === "absent" ? "" : "secondary"}" data-att="absent">✗ No vino</button></div>` +
                staffCharge(b) +
                (b.email && b.attendance !== "absent" ? `<button type="button" class="btn wide secondary sp-staff-btn" id="sh-shop">${svg(ICONS.bag)} Se lleva ropa de ${esc(catalog.shop.name)}</button>` : "") +
                (b.phone ? `<div class="form-actions"><a class="btn secondary" href="tel:${esc(b.phone.replace(/\s/g, ""))}">Llamar</a><a class="btn wa-btn" target="_blank" rel="noopener" href="https://wa.me/${esc(b.phone.replace(/\D/g, ""))}">WhatsApp</a></div>` : "")) +
            `<button type="button" class="btn wide danger" style="margin-top:12px" id="sh-cancel">${block ? "Quitar bloqueo" : "Cancelar cita"}</button>`),
  );
  sh.el.querySelectorAll("[data-att]").forEach(
    (x) =>
      (x.onclick = async () => {
        const att = b.attendance === x.dataset.att ? "unmarked" : x.dataset.att;
        try {
          await api(`staff/bookings/${b.id}/state`, { attendance: att });
          sh.close();
          await render();
          // Al marcar «No vino», se vuelve a abrir la ficha con la opción de cobrar.
          if (att === "absent" && b.card) staffSheet({ ...b, attendance: "absent" });
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  bindStaffCharge(sh, b);
  const cobrar = sh.el.querySelector("#sh-cobrar");
  if (cobrar) cobrar.onclick = () => (sh.close(), (cobroPre = b.id), (cobroDay = b.date), go("equipo/cobrar"));
  const shop = sh.el.querySelector("#sh-shop");
  if (shop) shop.onclick = () => (sh.close(), staffShop(b.email));
  const c = sh.el.querySelector("#sh-cancel");
  if (c)
    c.onclick = async () => {
      if (c.dataset.sure !== "1") {
        c.dataset.sure = "1";
        c.textContent = "Pulsa otra vez para confirmar";
        return;
      }
      c.disabled = true;
      try {
        await api(`bookings/${b.id}/cancel`, {});
        sh.close();
        render();
      } catch (e) {
        c.disabled = false;
        toast(e.message);
      }
    };
}
// ── Equipo: venta de ropa de NOVA Supply ───────────────────────────────────
// El barbero apunta lo que se lleva el socio y el Club le suma los puntos.
// Se busca al socio por su correo o por su código del Club.
function staffShop(email) {
  const S = catalog.shop,
    P = catalog.points;
  const sh = sheet(`<p class="eyebrow">${esc(S.name)}</p><h2>Venta de ropa</h2><div id="sp-flow"></div>`);
  const flow = sh.el.querySelector("#sp-flow");
  const find = () => {
    flow.innerHTML = `<p class="muted" style="margin-top:0">Pídele su correo o su código del Club (sale en su perfil, en «Invita y suma»).</p>
      <form id="sp-find"><label for="sp-q">Correo o código</label><input id="sp-q" name="q" required autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="cliente@correo.com o CARLOS482"><button class="btn wide" style="margin-top:14px" type="submit">Buscar socio</button></form>`;
    const f = flow.querySelector("#sp-find");
    f.q.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        load((await api("staff/member?q=" + encodeURIComponent(f.q.value.trim()))).member);
      } catch (err) {
        toast(err.message);
      }
    };
  };
  const load = (mb) => {
    const L = leagueOf(mb.earned),
      disc = shopDiscount(L.index);
    flow.innerHTML = `<div class="pick-summary sp-who" style="${leagueVars(L.league)}">${leagueArt(L.league)}<div><strong>${esc(mb.name || mb.email)}</strong><span>Socio Nº ${String(mb.no || 0).padStart(4, "0")} · ${esc(L.label)}${disc ? ` · <b>${esc(disc)}</b>` : ""}</span></div></div>
      <form id="sp-sale"><div class="form-row2"><div><label for="sp-amount">Importe pagado (€)</label><input id="sp-amount" name="amount" required inputmode="decimal" placeholder="47,50" autocomplete="off"></div><div><label for="sp-items">Prendas</label><input id="sp-items" name="items" required type="number" min="1" max="30" value="1"></div></div>
      <p class="sp-preview" id="sp-preview">Suma ${P.perEuro} puntos por cada euro.</p>
      <button class="btn wide" style="margin-top:6px" type="submit">Sumar puntos</button></form>`;
    const f = flow.querySelector("#sp-sale"),
      pv = flow.querySelector("#sp-preview");
    f.amount.focus();
    f.amount.oninput = () => {
      const n = Number(f.amount.value.replace(",", "."));
      pv.innerHTML = n > 0 ? `Le suma <b>+${nf(Math.round(n * P.perEuro))} puntos</b>` : `Suma ${P.perEuro} puntos por cada euro.`;
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = f.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        const { purchase: p } = await api("staff/shop", { email: mb.email, amount: f.amount.value, items: f.items.value });
        flow.innerHTML = `<div class="booked-hero"><span class="booked-check">✓</span><h2>+${nf(p.points)} puntos</h2><p class="sub">Para ${esc(first(mb.name || mb.email))} · ${p.items} ${p.items === 1 ? "prenda" : "prendas"} · ${euro(p.amount)}</p></div>
          <div class="form-actions"><button type="button" class="btn secondary" id="sp-undo">Deshacer</button><button type="button" class="btn" id="sp-ok">Hecho</button></div>`;
        flow.querySelector("#sp-ok").onclick = sh.close;
        flow.querySelector("#sp-undo").onclick = async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            await api(`staff/shop/${p.id}/delete`, {});
            toast("Venta quitada.");
            sh.close();
          } catch (err) {
            toast(err.message);
          }
        };
      } catch (err) {
        btn.disabled = false;
        toast(err.message);
      }
    };
  };
  if (!email) return find();
  api("staff/member?q=" + encodeURIComponent(email))
    .then((r) => load(r.member))
    .catch((err) => (toast(err.message), find()));
}

// ── Equipo: faltas y cobros ────────────────────────────────────────────────
// Dentro de la ficha de una cita marcada «No vino»: cobrar el servicio en la
// tarjeta que el cliente dejó en garantía, y ver cómo ha ido el cobro.
// Lo que se cobra según las normas que puso el dueño (100 % = el servicio entero).
const feeOf = (b) => b.fee ?? Math.round((Number(b.service.price) || 0) * (b.late ? catalog.rules.lateFeePct : catalog.rules.noShowFeePct)) / 100;
function staffCharge(b) {
  const late = b.status === "canceled" && b.late;
  if (b.kind !== "booking" || !(late || (b.status === "confirmed" && b.attendance === "absent"))) return "";
  const c = b.charge,
    price = euro(feeOf(b)),
    why = late ? `Canceló con ${String(b.hoursLeft ?? "menos de " + catalog.rules.cancelHours).replace(".", ",")} h de antelación` : "No vino y no avisó";
  const forgive = `<button type="button" class="btn wide secondary" id="chg-waive">No cobrar (motivo justificado)</button>`;
  if (b.waived) return `<div class="chg"><strong>No se cobra</strong><span>${esc(why)}. Se decidió no cobrar${b.waived.note ? ": " + esc(b.waived.note) : ""}.</span><button type="button" class="btn small secondary" id="chg-unwaive">Deshacer</button></div>`;
  if (!feeOf(b)) return `<div class="chg"><strong>${esc(why)}</strong><span>Con las normas actuales no se cobra nada.</span></div>`;
  if (c?.status === "succeeded")
    return `<div class="chg ok"><strong>✓ Cobrado: ${euro(c.amount)}</strong><span>${esc(cardLabel(c))} · ${esc(shortDate(c.at.slice(0, 10)))}</span>${
      staff.owner ? `<button type="button" class="btn small secondary" id="chg-refund">Devolver el dinero</button>` : ""
    }</div>`;
  if (c?.status === "refunded") return `<div class="chg"><strong>Cobro devuelto</strong><span>Se le devolvieron ${euro(c.amount)}.</span></div>`;
  if (c?.status === "requires_action")
    return `<div class="chg wait"><strong>⏳ Pendiente de que el cliente lo confirme</strong><span>Su banco pide confirmación. Le hemos avisado: lo verá en «Mis citas» al entrar en la app.</span></div>`;
  const past = new Date(`${b.date}T${b.start}:00`) < new Date();
  if (!late && !past) return `<p class="muted chg-hint">Cuando pase la hora de la cita podrás cobrarle la falta.</p>`;
  if (!b.card) return `<div class="chg"><strong>${esc(why)} · sin tarjeta guardada</strong><span>Este cliente no dejó tarjeta (cita apuntada a mano o de antes). Habla con él por WhatsApp.</span>${forgive}</div>`;
  return `<div class="chg${c ? " bad" : ""}">${
    c ? `<strong>✗ No se pudo cobrar</strong><span>${esc(c.error || "El banco rechazó el cobro.")}</span>` : `<strong>${esc(why)}</strong><span>Según las condiciones que aceptó se le pueden cobrar ${price}. Tú decides: si tuvo un motivo justificado, no lo cobres.</span>`
  }<button type="button" class="btn wide" id="chg-go">${c ? "Reintentar" : "Cobrar"} ${price}</button>${forgive}</div>`;
}
function bindStaffCharge(sh, b) {
  const go2 = sh.el.querySelector("#chg-go");
  if (go2)
    go2.onclick = async () => {
      if (go2.dataset.sure !== "1") {
        go2.dataset.sure = "1";
        go2.textContent = `Pulsa otra vez para cobrar ${euro(feeOf(b))}`;
        return;
      }
      go2.disabled = true;
      try {
        const r = await api(`staff/bookings/${b.id}/charge`, {});
        const st = r.charge.status;
        toast(st === "succeeded" ? `Cobrados ${euro(r.charge.amount)}.` : st === "requires_action" ? "Su banco pide confirmación: le hemos avisado." : "El banco ha rechazado el cobro.");
        sh.close();
        await render();
        staffSheet({ ...b, charge: r.charge });
      } catch (e) {
        go2.disabled = false;
        toast(e.message);
      }
    };
  const wv = sh.el.querySelector("#chg-waive"),
    uw = sh.el.querySelector("#chg-unwaive");
  if (wv)
    wv.onclick = async () => {
      wv.disabled = true;
      try {
        await api(`staff/bookings/${b.id}/waive`, {});
        toast("Hecho: no se le cobra.");
        sh.close();
        await render();
        staffSheet({ ...b, waived: { at: "" } });
      } catch (e) {
        wv.disabled = false;
        toast(e.message);
      }
    };
  if (uw)
    uw.onclick = async () => {
      try {
        await api(`staff/bookings/${b.id}/waive`, { undo: true });
        sh.close();
        await render();
        const { waived, ...rest } = b;
        staffSheet(rest);
      } catch (e) {
        toast(e.message);
      }
    };
  const rf = sh.el.querySelector("#chg-refund");
  if (rf)
    rf.onclick = async () => {
      if (rf.dataset.sure !== "1") {
        rf.dataset.sure = "1";
        rf.textContent = `¿Devolver ${euro(b.charge.amount)}? Pulsa otra vez`;
        return;
      }
      rf.disabled = true;
      try {
        await api(`staff/bookings/${b.id}/refund`, {});
        toast("Dinero devuelto.");
        sh.close();
        render();
      } catch (e) {
        rf.disabled = false;
        toast(e.message);
      }
    };
}

// Pestaña «Faltas»: quién no vino este mes y cómo van los cobros.
async function staffFaltas() {
  const nowKey = monthKey(new Date());
  if (!staffMonth) staffMonth = nowKey;
  const r = await api("staff/noshows?month=" + staffMonth);
  const label = monthLabel(r.month);
  const status = (b) =>
    b.waived
      ? ["No se cobra", ""]
      : b.charge?.status === "succeeded"
      ? ["Cobrada", "st-done"]
      : b.charge?.status === "refunded"
        ? ["Devuelta", ""]
        : b.charge?.status === "requires_action"
          ? ["Pendiente", "st-wait"]
          : b.charge
            ? ["Rechazada", "st-cancel"]
            : b.card
              ? ["Sin cobrar", "st-cancel"]
              : ["Sin tarjeta", ""];
  show(
    staffTop("faltas") +
      `<div class="month-nav"><button type="button" class="cal-nav" data-m="-1" aria-label="Mes anterior">‹</button><strong>${esc(label)}</strong><button type="button" class="cal-nav" data-m="1" aria-label="Mes siguiente" ${staffMonth >= nowKey ? "disabled" : ""}>›</button></div>` +
      `<div class="stat3 money"><div><strong>${r.list.length}</strong><span>${r.list.length === 1 ? "Falta" : "Faltas y tardías"}</span></div><div><strong>${euro(r.charged)}</strong><span>Cobrado</span></div><div><strong>${r.uncharged}</strong><span>Sin cobrar</span></div></div>` +
      (r.pending ? `<p class="caja-meta">${euro(r.pending)} pendientes de que el cliente confirme o pague.</p>` : "") +
      (r.list.length
        ? `<div class="faltas">${r.list
            .map((b) => {
              const [t, cls] = status(b);
              return `<button type="button" class="ag-item falta" data-id="${esc(b.id)}"><time>${esc(shortDate(b.date))}<small>${esc(b.start)}</small></time><div><strong>${esc(b.name)}</strong><span>${b.late ? "Canceló tarde · " : "No vino · "}${esc(b.service.name)} · ${euro(b.fee ?? b.service.price)}${staff.owner ? " · " + esc(first(b.provider.name)) : ""}${b.strikes > 1 ? ` · ⚠ ${b.strikes} faltas` : ""}</span></div><span class="appt-state ${cls}">${t}</span></button>`;
            })
            .join("")}</div>`
        : `<p class="ag-free">Nadie ha faltado este mes. 🙌</p>`) +
      `<p class="muted" style="margin-top:18px">Aquí salen quienes no vinieron y quienes cancelaron con menos de ${catalog.rules.cancelHours} h. Tú decides en cada caso si se cobra. Para apuntar que alguien no vino, abre la cita en la Agenda y pulsa «✗ No vino».</p>`,
  );
  $$(".month-nav [data-m]").forEach((b) => (b.onclick = () => ((staffMonth = shiftMonth(staffMonth, Number(b.dataset.m))), render())));
  $$(".falta[data-id]").forEach((el) => (el.onclick = () => staffSheet(r.list.find((b) => b.id === el.dataset.id))));
}

function staffNew(block) {
  const opts = (list, label) => list.map((x) => `<option value="${esc(x.id)}" ${x.id === staff.id ? "selected" : ""}>${esc(label(x))}</option>`).join("");
  const timeOpts = (sel) => {
    let o = "";
    for (let t = 8 * 60; t <= 22 * 60; t += 15) o += `<option ${addMin("00:00", t) === sel ? "selected" : ""}>${addMin("00:00", t)}</option>`;
    return o;
  };
  // Un barbero solo apunta en su agenda, y solo los servicios que hace.
  const services = catalog.services.filter((s) => !s.consult && (staff.owner || !s.providers?.length || s.providers.includes(staff.id)));
  const sh = sheet(
    `<h2>${block ? "Bloquear hora" : "Nueva cita"}</h2><p class="muted">${esc(longDay(staffDay))}${staff.owner ? "" : " · en tu agenda"}</p>
    <form id="sn">
      ${staff.owner ? `<label>Barbero</label><select name="provider">${opts(catalog.providers, (p) => p.name)}</select>` : `<input type="hidden" name="provider" value="${esc(staff.id)}">`}
      ${block ? "" : `<label>Servicio</label><select name="service">${opts(services, (s) => `${s.name} · ${s.duration} min`)}</select>`}
      <div class="form-actions" style="margin-top:0"><div><label>Desde</label><select name="start">${timeOpts("10:00")}</select></div>${block ? `<div><label>Hasta</label><select name="end">${timeOpts("11:00")}</select></div>` : ""}</div>
      ${
        block
          ? `<label>Motivo (opcional)</label><input name="note" maxlength="60" placeholder="Comida, médico…">`
          : `<label>Nombre del cliente</label><input name="name" required maxlength="120"><label>Teléfono</label><input name="phone" type="tel" maxlength="30"><label>Correo (opcional)</label><input name="email" type="email">
             <label>Repetir</label><div class="form-actions" style="margin-top:0"><select name="every"><option value="">No</option><option value="1">Cada semana</option><option value="2">Cada 2 semanas</option><option value="3">Cada 3 semanas</option><option value="4">Cada 4 semanas</option></select><select name="times">${[2, 3, 4, 5, 6, 8, 10, 12].map((n) => `<option value="${n}" ${n === 4 ? "selected" : ""}>${n} citas</option>`).join("")}</select></div>`
      }
      <button class="btn wide" style="margin-top:18px" type="submit">${block ? "Bloquear" : "Apuntar cita"}</button>
    </form>`,
  );
  sh.el.querySelector("#sn").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const r = await api("staff/book", { ...d, date: staffDay, block, repeat: d.every ? { every: Number(d.every), times: Number(d.times) } : null });
      availCache.clear();
      sh.close();
      toast(block ? "Hora bloqueada." : r.series ? `${r.series.made} citas apuntadas${r.series.skipped.length ? ` (ocupado el ${r.series.skipped.map(shortDate).join(", ")})` : ""}.` : "Cita apuntada.");
      render();
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
}

// ── Entrar ─────────────────────────────────────────────────────────────────
function loginScreen(reason, next) {
  try {
    sessionStorage.setItem("nova_next", next);
  } catch {}
  show(
    heading(
      "Entra en tu cuenta",
      reason || (loginCode ? "Sin contraseña: pon el correo con el que reservaste y te enviamos un código de 6 cifras." : "Sin contraseña: pon el correo con el que reservaste."),
    ) +
      (loginCode && !mailOn ? `<p class="warning">Ahora mismo el acceso por correo no está activo. Si necesitas cambiar una cita, escríbenos por WhatsApp.</p>` : "") +
      `<form id="login"><label for="l-email">Correo electrónico</label><input id="l-email" name="email" type="email" required autocomplete="email"><button class="btn wide" style="margin-top:16px" type="submit">${loginCode ? "Recibir código" : "Entrar"}</button></form>` +
      `<p class="muted" style="margin-top:22px">¿Aún no tienes cuenta? Se crea sola con tu primera reserva.</p><a class="btn wide secondary" href="#home">Reservar cita</a>` +
      `<p class="muted" style="margin-top:22px;text-align:center">¿Trabajas en el estudio? <a href="#equipo">Entra en tu panel</a></p>` +
      legalLinks(),
  );
  onForm("login", async (d) => {
    const r = await api("auth/request", { email: d.email });
    if (r.direct) {
      await refreshMe();
      nav();
      toast(`¡Hola${user?.name ? ", " + first(user.name) : ""}!`);
      return go(sessionStorage.getItem("nova_next") || "profile");
    }
    challenge = r.challenge;
    if (r.dev) toast("Modo prueba: el código sale en la consola del servidor.");
    go("code");
  });
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
            <a class="btn wide wa-btn" target="_blank" rel="noopener" href="${wa(`Hola, me interesa ${p.name}${p.brand ? " de " + p.brand : ""}. ¿Lo tenéis?`)}">${svg(ICONS.chat)} Preguntar por WhatsApp</a></div>`,
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
    ${list.length > 4 ? `<div class="home-actions"><a class="btn secondary" href="#productos">Ver los ${list.length} productos</a></div>` : ""}
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

// Panel del dueño: subir, cambiar, ocultar y borrar productos.
async function staffProducts() {
  let list;
  try {
    list = await loadProducts(true);
  } catch (e) {
    throw e;
  }
  if (!staff.owner) return show(staffTop("productos") + `<p class="ag-free">Los productos los lleva el dueño.</p>`);
  show(
    staffTop("productos") +
      `<div class="staff-bar"><button type="button" class="btn" id="pr-new">+ Añadir producto</button></div>` +
      (list.length
        ? `<div class="pr-admin">${list
            .map(
              (p) => `<button type="button" class="ag-item pr-row" data-edit="${esc(p.id)}">${prodImg(p, "pr-thumb")}<div><strong>${esc(p.name)}</strong><span>${p.brand ? esc(p.brand) + " · " : ""}${euro(p.price)}</span></div><span>${
                p.visible === false ? `<span class="appt-state">Oculto</span>` : p.soldOut ? `<span class="appt-state st-cancel">Agotado</span>` : `<span class="appt-state st-ok">Visible</span>`
              }</span></button>`,
            )
            .join("")}</div>`
        : `<p class="ag-free">Aún no hay productos. Pulsa «Añadir producto», hazle una foto con el móvil y ponle nombre y precio.</p>`) +
      `<p class="muted" style="margin-top:18px">Los clientes los ven en la portada y en <a href="#productos">la página de productos</a>.</p>`,
  );
  $("#pr-new").onclick = () => productSheet(null);
  $$("[data-edit]").forEach((el) => (el.onclick = () => productSheet(list.find((p) => p.id === el.dataset.edit))));
}
function productSheet(p) {
  let photo = "";
  const sh = sheet(
    `<p class="eyebrow">Producto</p><h2>${p ? "Cambiar producto" : "Nuevo producto"}</h2>
    <form id="pr-form">
      <label class="pr-photo" id="pr-photo">${p?.img ? prodImg(p) : `<span>${svg(ICONS.camera)}Hacer o elegir foto</span>`}<input type="file" accept="image/*" class="sr-only" id="pr-file"></label>
      <label for="pr-name">Nombre</label><input id="pr-name" name="name" required maxlength="80" value="${esc(p?.name || "")}" placeholder="Cera mate">
      <label for="pr-brand">Marca <small>(opcional)</small></label><input id="pr-brand" name="brand" maxlength="60" value="${esc(p?.brand || "")}">
      <label for="pr-price">Precio</label><div class="pct-field"><input id="pr-price" name="price" required inputmode="decimal" value="${p ? String(p.price).replace(".", ",") : ""}" placeholder="12"><span>€</span></div>
      <label for="pr-desc">Descripción <small>(opcional)</small></label><textarea id="pr-desc" name="desc" rows="3" maxlength="400" placeholder="Para qué sirve, cómo se usa…">${esc(p?.desc || "")}</textarea>
      <label class="check"><input type="checkbox" name="visible" ${p?.visible === false ? "" : "checked"}><span>Visible para los clientes</span></label>
      <label class="check" style="margin-top:10px"><input type="checkbox" name="soldOut" ${p?.soldOut ? "checked" : ""}><span>Agotado ahora mismo</span></label>
      <button class="btn wide" style="margin-top:18px" type="submit">Guardar</button>
      ${p ? `<button type="button" class="btn wide danger" style="margin-top:10px" id="pr-del">Borrar producto</button>` : ""}
    </form>`,
  );
  const f = sh.el.querySelector("#pr-form");
  sh.el.querySelector("#pr-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      photo = await shrinkImage(file, 640);
      const box = sh.el.querySelector("#pr-photo");
      box.querySelector("img, span")?.remove();
      box.insertAdjacentHTML("afterbegin", `<img src="${photo}" alt="">`);
    } catch {
      toast("No se ha podido leer esa foto.");
    }
  };
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(f),
      btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await api("staff/products", { id: p?.id, name: d.get("name"), brand: d.get("brand"), price: d.get("price"), desc: d.get("desc"), visible: d.get("visible") === "on", soldOut: d.get("soldOut") === "on", photo });
      sh.close();
      toast("Producto guardado.");
      render();
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
  const del = sh.el.querySelector("#pr-del");
  if (del)
    del.onclick = async () => {
      if (del.dataset.sure !== "1") {
        del.dataset.sure = "1";
        del.textContent = "Pulsa otra vez para borrar";
        return;
      }
      try {
        await api("staff/products", { id: p.id, delete: true });
        sh.close();
        toast("Producto borrado.");
        render();
      } catch (err) {
        toast(err.message);
      }
    };
}

// ── Equipo y normas (solo el dueño) ────────────────────────────────────────
// Airam pone aquí cuántas horas antes se puede cancelar gratis, cuánto se
// cobra si alguien cancela tarde o no viene, y lleva el equipo: altas,
// cambios, horario, servicios, comisión, clave y bajas.
// ── Tu cita de siempre ─────────────────────────────────────────────────────
// Con lo que suele pedir el cliente (día, hora, barbero, servicio y cada
// cuánto viene) se le propone la próxima cita y se reserva en un toque.
const DAY_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const everyText = (d) => (!d ? "" : d === 1 ? "cada día" : d % 7 === 0 ? (d === 7 ? "cada semana" : `cada ${d / 7} semanas`) : `cada ${d} días`);
async function initHabit(h) {
  const box = $("#habit-card");
  if (!box) return;
  const s = svcById(h.service),
    p = provById(h.provider);
  // Primera fecha posible: cuando «le toca» (o mañana) y en su día de la semana.
  let from = new Date();
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
    <div class="habit-main">${face(p, "habit-face")}<div><strong>${esc(cap(DAY_LONG[h.weekday]))}s${h.start ? " · " + esc(h.start) : ""}</strong><span>${esc(s.name)} con ${esc(first(p.name))}${h.every ? " · " + esc(everyText(h.every)) : ""}</span></div></div>
    ${
      pick
        ? `<button type="button" class="btn wide" id="habit-go">Reservar ${esc(when)}</button>`
        : `<a class="btn wide secondary" href="#time/${esc(p.id)}" id="habit-cal">Ver huecos con ${esc(first(p.name))}</a>`
    }
    <small>${h.due ? `Hace ${h.since} días de tu último corte.` : "Lo calculamos con tus últimas citas."}</small>
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

// ── Clientes (solo el dueño): quién viene, a quién le toca y quién se ha perdido ──
let clientFilter = "perdido";
const STATUS_CL = { perdido: ["Se ha perdido", "st-cancel"], "le-toca": ["Le toca", "st-wait"], "con-cita": ["Tiene cita", "st-ok"], "al-dia": ["Al día", "st-done"], nuevo: ["Nuevo", ""] };
async function staffClients() {
  if (!staff.owner) return show(staffTop("clientes") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const [r, n] = await Promise.all([api("staff/clients"), api("staff/rules")]);
  const list = r.list.filter((c) => clientFilter === "todos" || c.status === clientFilter);
  const habitTxt = (c) =>
    c.habit ? `${cap(DAY_LONG[c.habit.weekday]).slice(0, 3)} ${c.habit.start || ""}${provById(c.habit.provider) ? " · " + first(provById(c.habit.provider).name) : ""}${c.every ? " · " + everyText(c.every) : ""}` : "";
  const msg = (c) => `Hola ${first(c.name) || ""}, soy ${first(staff.name)} de NOVA Studio. ${n.winbackText}${n.winbackOffer ? " " + n.winbackOffer : ""}`;
  show(
    staffTop("clientes") +
      `<div class="stat3 money"><div><strong>${r.stats.lost}</strong><span>Se han perdido</span></div><div><strong>${r.stats.due}</strong><span>Les toca</span></div><div><strong>${r.stats.booked}</strong><span>Con cita</span></div></div>
      <div class="tr-filter">${[["perdido", "Se han perdido", r.stats.lost], ["le-toca", "Les toca", r.stats.due], ["con-cita", "Con cita", r.stats.booked], ["todos", "Todos", r.stats.total]]
        .map(([k, l, c]) => `<button type="button" class="${clientFilter === k ? "on" : ""}" data-cf="${k}">${l} <small>${c}</small></button>`)
        .join("")}</div>
      ${
        list.length
          ? list
              .map((c) => {
                const [st, cls] = STATUS_CL[c.status] || STATUS_CL.nuevo;
                return `<article class="card cl-item">
                  <div class="tr-item-top"><div><strong>${esc(c.name || c.email)}</strong><span>${c.visits} ${c.visits === 1 ? "visita" : "visitas"}${c.last ? ` · última hace ${c.since} días` : ""}${c.next ? ` · cita el ${esc(shortDate(c.next.date))} ${esc(c.next.start)}` : ""}</span></div><span class="appt-state ${cls}">${st}</span></div>
                  ${habitTxt(c) ? `<p class="tr-line">🗓 Suele venir: ${esc(habitTxt(c))}</p>` : ""}
                  ${c.contacted ? `<p class="tr-line muted">Contactado el ${esc(shortDate(c.contacted.at.slice(0, 10)))} por ${c.contacted.channel === "email" ? "correo" : "WhatsApp"}${c.contacted.by === "auto" ? " (automático)" : ""}</p>` : ""}
                  ${c.status !== "con-cita" ? `<div class="form-actions" style="margin-top:10px">${
                    c.phone ? `<a class="btn small wa-btn" target="_blank" rel="noopener" data-wa="${esc(c.email)}" href="https://wa.me/${esc(c.phone.replace(/\D/g, ""))}?text=${encodeURIComponent(msg(c))}">WhatsApp</a>` : ""
                  }${c.email && !c.optout ? `<button type="button" class="btn small secondary" data-mail="${esc(c.email)}" ${r.mail ? "" : "disabled title='El envío de correos aún no está activado'"}>Enviar correo</button>` : c.optout ? `<span class="muted" style="font-size:12px">No quiere correos</span>` : ""}</div>` : ""}
                </article>`;
              })
              .join("")
          : `<p class="ag-free">Nadie en esta lista. 🙌</p>`
      }
      <p class="section-label">Recuperar clientes</p>
      <form id="wb" class="card norms">
        <label for="wb-days" style="margin-top:0">Alguien «se ha perdido» si lleva sin venir más de</label>
        <div class="pct-field"><input id="wb-days" name="lapseDays" inputmode="numeric" value="${n.lapseDays}"><span>días</span></div>
        <p class="muted" style="font-size:12px;margin:6px 0 0">O el doble de lo que suele tardar en volver, si es más.</p>
        <label for="wb-text">Mensaje</label><textarea id="wb-text" name="winbackText" rows="3" maxlength="600">${esc(n.winbackText)}</textarea>
        <label for="wb-offer">Oferta <small>(opcional)</small></label><input id="wb-offer" name="winbackOffer" maxlength="200" value="${esc(n.winbackOffer)}" placeholder="Ej.: 10 % en tu próximo corte esta semana">
        <label class="check"><input type="checkbox" name="winbackAuto" ${n.winbackAuto ? "checked" : ""}><span>Mandárselo por correo automáticamente (como mucho una vez cada 60 días, y con enlace para darse de baja)</span></label>
        ${n.mail ? "" : `<p class="warning">El envío de correos aún no está activado: por ahora usa el botón de WhatsApp.</p>`}
        <button class="btn wide" style="margin-top:14px" type="submit">Guardar</button>
      </form>`,
  );
  $$("[data-cf]").forEach((b) => (b.onclick = () => ((clientFilter = b.dataset.cf), render())));
  $$("[data-wa]").forEach((a) => a.addEventListener("click", () => api("staff/clients/contact", { email: a.dataset.wa, channel: "whatsapp" }).catch(() => {})));
  $$("[data-mail]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await api("staff/clients/contact", { email: b.dataset.mail, channel: "email" });
          toast("Correo enviado.");
          render();
        } catch (e) {
          b.disabled = false;
          toast(e.message);
        }
      }),
  );
  onForm("wb", async (d) => {
    await api("staff/rules", { lapseDays: d.lapseDays, winbackText: d.winbackText, winbackOffer: d.winbackOffer, winbackAuto: d.winbackAuto === "on" });
    toast("Guardado.");
    render();
  });
}

// Estado de las tareas automáticas (recordatorios y correos).
function autoStatus(n) {
  if (!n.mail) return `<p class="warning" style="margin-top:12px">Los correos aún no se envían: falta activar el servicio de correo. Las opciones quedan guardadas y empezarán a funcionar en cuanto se active.</p>`;
  if (!n.cron) return `<p class="warning" style="margin-top:12px">Falta activar la tarea diaria en Vercel (variable CRON_SECRET) para que salgan los recordatorios.</p>`;
  return n.lastCron ? `<p class="muted" style="font-size:12px;margin-top:10px">Última vez: ${esc(n.lastCron.at)} · ${n.lastCron.reminders} recordatorios${n.lastCron.winback ? ` · ${n.lastCron.winback} correos a clientes perdidos` : ""}</p>` : "";
}

// ── Copia de seguridad (solo el dueño) ─────────────────────────────────────
const backupBlock = () => `<p class="section-label">Copia de seguridad</p>
  <div class="card">
    <p class="muted" style="margin-top:0">Descarga todos los datos (clientes, citas, cobros, Club, ajustes) en un archivo y guárdalo en tu ordenador o en Drive. Los lunes también te llega una copia por correo, cuando el correo esté activado.</p>
    <div class="stack"><a class="btn wide" href="/api/staff/backup?part=data" download>Descargar datos</a><a class="btn wide secondary" href="/api/staff/backup?part=photos" download>Descargar fotos</a>
    <label class="btn wide secondary" style="margin:0">Recuperar desde una copia<input type="file" accept="application/json,.json" class="sr-only" id="bk-file"></label></div>
  </div>`;
function bindBackup() {
  const f = $("#bk-file");
  if (!f) return;
  f.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      return toast("Ese archivo no se puede leer.");
    }
    if (backup?.app !== "nova-reservas") return toast("Ese archivo no es una copia de esta app.");
    const sh = sheet(
      `<p class="eyebrow">Copia del ${esc(String(backup.created || "").slice(0, 16))}</p><h2>¿Recuperar esta copia?</h2>
      <p class="muted">Trae ${backup.count} registros (${backup.part === "photos" ? "fotos" : "datos"}). Se escriben encima de lo que haya con el mismo nombre; lo que no venga en la copia se queda como está.</p>
      <form id="rs"><label for="rs-c">Escribe RESTAURAR para confirmar</label><input id="rs-c" name="confirm" autocomplete="off" required>
      <button class="btn wide danger" style="margin-top:14px" type="submit">Recuperar</button></form>`,
    );
    sh.el.querySelector("#rs").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        const r = await api("staff/restore", { confirm: new FormData(ev.target).get("confirm"), backup });
        sh.close();
        toast(`Copia recuperada: ${r.written} registros.`);
        catalog = null;
        await loadCatalog();
        render();
      } catch (err) {
        toast(err.message);
      }
    });
  };
}

// ── Fotos de la web y reseñas (solo el dueño) ──────────────────────────────
// Cada foto de la web tiene un hueco. Si Airam sube otra desde su panel
// (pestaña «Web»), sale la suya; si no, la original.
const PIC_DEFAULT = { hero: "/assets/hero-nova.jpg", "hero-wide": "/assets/hero-nova-wide.jpg", cabina: "/assets/cabina.jpg", acabado: "/assets/acabado.jpg", oficio: "/assets/oficio.jpg", casa: "/assets/casa.jpg", supply: "/assets/supply.jpg", "supply-rosa": "/assets/supply-rosa.jpg", formacion: "/assets/oficio.jpg" };
const pic = (slot) => {
  const v = catalog?.site?.photos?.[slot];
  return v ? `/api/site/${slot}/photo?v=${encodeURIComponent(v)}` : PIC_DEFAULT[slot];
};
// Reduce la foto en el móvil antes de subirla, sin recortarla, hasta que pese poco.
async function shrinkFit(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    for (let i = 0; i < 6; i++) {
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.82, 0.72, 0.62]) {
        const d = c.toDataURL("image/jpeg", q);
        if (d.length < 850000) return d;
      }
      k *= 0.8;
    }
    throw Error("big");
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function staffWeb() {
  if (!staff.owner) return show(staffTop("web") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const r = await api("staff/site");
  const R = r.rating,
    when = R.at ? new Date(R.at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  show(
    staffTop("web") +
      `<p class="section-label">Reseñas de ${esc(catalog.business.rating.source)}</p>
      <div class="card web-rating">
        <div class="wr-now"><strong>★ ${esc(R.shown.score)}</strong><span>${R.shown.count} reseñas<small>${
          R.mode === "manual" ? "Puestas a mano" : R.ok === false ? `No se pudo leer Booksy (${esc(when)}). Se ven las últimas buenas.` : `Se leen solas de Booksy · última vez ${esc(when)}`
        }</small></span></div>
        <div class="form-actions" style="margin-top:12px"><button type="button" class="btn secondary" id="wr-auto">${R.mode === "manual" ? "Volver a leerlas de Booksy" : "Actualizar ahora"}</button><button type="button" class="btn secondary" id="wr-manual">Poner a mano</button></div>
      </div>
      <p class="section-label">Fotos de la web</p>
      <p class="muted" style="margin-top:-4px">Toca una foto para cambiarla. Se ve al momento en la web; puedes volver a la original cuando quieras.</p>
      <div class="web-grid">${r.slots
        .map((x) => {
          const mine = !!r.photos[x.id];
          return `<button type="button" class="web-slot" data-slot="${esc(x.id)}"><span class="ws-pic${x.id === "hero-wide" ? " wide" : ""}"><img src="${mine ? `/api/site/${x.id}/photo?v=${esc(r.photos[x.id])}` : esc(x.def)}" alt="" loading="lazy">${mine ? `<em>Tuya</em>` : ""}</span><strong>${esc(x.label)}</strong><small>${esc(x.where)}</small></button>`;
        })
        .join("")}</div>`,
  );
  const reload = async () => {
    catalog = null;
    await loadCatalog();
    render();
  };
  $("#wr-auto").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const x = await api("staff/site", { rating: { mode: "auto" } });
      toast(x.rating.ok ? `Leídas de Booksy: ★ ${x.rating.shown.score} · ${x.rating.shown.count} reseñas.` : "Booksy no responde ahora. Prueba más tarde o ponlas a mano.");
      reload();
    } catch (err) {
      toast(err.message);
    }
  };
  $("#wr-manual").onclick = () => {
    const sh = sheet(
      `<p class="eyebrow">Reseñas</p><h2>Poner a mano</h2><p class="muted">Úsalo solo si Booksy deja de leerse solo. Mientras esté a mano, no se actualiza.</p>
      <form id="wr-form"><label for="wr-s">Nota (de 1 a 5)</label><input id="wr-s" name="score" inputmode="decimal" required value="${esc(R.shown.score)}">
      <label for="wr-c">Número de reseñas</label><input id="wr-c" name="count" inputmode="numeric" required value="${esc(R.shown.count)}">
      <button class="btn wide" style="margin-top:16px" type="submit">Guardar</button></form>`,
    );
    sh.el.querySelector("#wr-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      try {
        await api("staff/site", { rating: { mode: "manual", score: d.get("score"), count: d.get("count") } });
        sh.close();
        toast("Reseñas guardadas.");
        reload();
      } catch (err) {
        toast(err.message);
      }
    });
  };
  $$("[data-slot]").forEach(
    (el) =>
      (el.onclick = () => {
        const x = r.slots.find((y) => y.id === el.dataset.slot),
          mine = !!r.photos[x.id];
        const sh = sheet(
          `<p class="eyebrow">${esc(x.where)}</p><h2>${esc(x.label)}</h2>
          <span class="ws-pic big${x.id === "hero-wide" ? " wide" : ""}"><img src="${mine ? `/api/site/${x.id}/photo?v=${esc(r.photos[x.id])}` : esc(x.def)}" alt=""></span>
          <div class="stack" style="margin-top:14px"><label class="btn wide" style="margin:0">${svg(ICONS.camera)} Hacer o elegir foto<input type="file" accept="image/*" class="sr-only" id="ws-file"></label>
          ${mine ? `<button type="button" class="btn wide secondary" id="ws-reset">Volver a la original</button>` : ""}</div>
          <p class="muted" style="font-size:13px;margin-top:12px">${x.id === "hero" ? "Mejor una foto en vertical." : x.id === "hero-wide" ? "Mejor una foto en horizontal y ancha." : "Se ajusta sola al hueco; lo importante, en el centro."}</p>`,
        );
        sh.el.querySelector("#ws-file").onchange = async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          try {
            toast("Subiendo foto…");
            await api("staff/site", { slot: x.id, photo: await shrinkFit(f, x.max) });
            sh.close();
            toast("Foto cambiada.");
            reload();
          } catch (err) {
            toast(err.message === "big" ? "Esa foto es demasiado grande. Prueba con otra." : err.message || "No se ha podido leer esa foto.");
          }
        };
        const rs = sh.el.querySelector("#ws-reset");
        if (rs)
          rs.onclick = async () => {
            try {
              await api("staff/site", { slot: x.id, reset: true });
              sh.close();
              toast("Vuelve a estar la original.");
              reload();
            } catch (err) {
              toast(err.message);
            }
          };
      }),
  );
}

const DAYS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
async function staffTeam() {
  if (!staff.owner) return show(staffTop("ajustes") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const [n, t] = await Promise.all([api("staff/rules"), api("staff/team")]);
  const hoursTxt = (p) => {
    const on = WEEK_ORDER.filter((d) => p.hours?.[d]?.length);
    if (!on.length) return "Sin horario";
    return on.map((d) => DAYS_ES[d].slice(0, 3)).join(" ") + " · " + p.hours[on[0]][0].join("–");
  };
  show(
    staffTop("ajustes") +
      `<p class="section-label">Normas de cancelación</p>
      <form id="norms" class="card norms">
        <label for="n-hours" style="margin-top:0">Se puede cancelar gratis hasta</label>
        <div class="pct-field"><input id="n-hours" name="cancelHours" inputmode="numeric" required value="${n.cancelHours}"><span>h antes</span></div>
        <label for="n-late">Si cancela con menos tiempo, se le puede cobrar</label>
        <div class="pct-field"><input id="n-late" name="lateFeePct" inputmode="numeric" required value="${n.lateFeePct}"><span>% del servicio</span></div>
        <label for="n-abs">Si no viene, se le puede cobrar</label>
        <div class="pct-field"><input id="n-abs" name="noShowFeePct" inputmode="numeric" required value="${n.noShowFeePct}"><span>% del servicio</span></div>
        <p class="muted" style="font-size:13px;margin:12px 0 0">Nunca se cobra solo: cada barbero decide en su pestaña «Faltas» si cobra o no, por si hay un motivo justificado. Con 0 % no se cobra nunca.</p>
        <p class="section-label" style="margin-top:22px">Recordatorios y citas que se repiten</p>
        <label class="check" style="margin-top:0"><input type="checkbox" name="reminders" ${n.reminders ? "checked" : ""}><span>Mandar un correo de recordatorio el día antes de cada cita</span></label>
        <label class="check"><input type="checkbox" name="recurring" ${n.recurring ? "checked" : ""}><span>Los clientes pueden reservar citas que se repiten (cada 1, 2, 3 o 4 semanas)</span></label>
        <label for="n-rmax">Como mucho, cuántas citas de una vez</label>
        <div class="pct-field"><input id="n-rmax" name="recurringMax" inputmode="numeric" value="${n.recurringMax}"><span>citas</span></div>
        ${autoStatus(n)}
        <button class="btn wide" style="margin-top:14px" type="submit">Guardar normas</button>
      </form>
      <p class="section-label">Equipo</p>
      <div class="team-admin">${t.team
        .map(
          (p) => `<button type="button" class="ag-item tm-row${p.active === false ? " off" : ""}" data-w="${esc(p.id)}">${face(p, "pr-thumb")}<div><strong>${esc(p.name)}</strong><span>${esc(p.role || "")} · ${esc(hoursTxt(p))}</span></div><span>${
            p.active === false ? `<span class="appt-state">De baja</span>` : p.owner ? `<span class="appt-state st-done">Dueño</span>` : `<span class="appt-state st-ok">${String(p.commission ?? 0).replace(".", ",")} %</span>`
          }</span></button>`,
        )
        .join("")}</div>
      <button type="button" class="btn wide" style="margin-top:12px" id="w-new">+ Añadir trabajador</button>` +
      backupBlock(),
  );
  bindBackup();
  onForm("norms", async (d) => {
    await api("staff/rules", { ...d, reminders: d.reminders === "on", recurring: d.recurring === "on" });
    catalog = null;
    await loadCatalog();
    toast("Normas guardadas.");
    render();
  });
  $("#w-new").onclick = () => workerSheet(null, t.services);
  $$("[data-w]").forEach((el) => (el.onclick = () => workerSheet(t.team.find((p) => p.id === el.dataset.w), t.services)));
}

function workerSheet(p, services) {
  let photo = "";
  const salon = catalog.business.week || {};
  const hours = p?.hours || salon;
  const timeSel = (name, sel) => {
    let o = "";
    for (let m = 7 * 60; m <= 23 * 60; m += 30) {
      const v = addMin("00:00", m);
      o += `<option ${v === sel ? "selected" : ""}>${v}</option>`;
    }
    return `<select name="${name}" aria-label="${name.startsWith("a") ? "Entrada" : "Salida"}">${o}</select>`;
  };
  const owner = !!p?.owner;
  const sh = sheet(
    `<p class="eyebrow">${p ? (owner ? "Dueño" : "Trabajador") : "Nuevo trabajador"}</p><h2>${p ? esc(p.name) : "Añadir al equipo"}</h2>
    <form id="w-form">
      <label class="pr-photo w-photo" id="w-photo">${p?.image ? `<img src="${esc(p.image)}" alt="">` : `<span>${svg(ICONS.camera)}Foto</span>`}<input type="file" accept="image/*" class="sr-only" id="w-file"></label>
      <label for="w-name">Nombre</label><input id="w-name" name="name" required maxlength="60" value="${esc(p?.name || "")}">
      <label for="w-role">Puesto <small>(se ve en su tarjeta)</small></label><input id="w-role" name="role" maxlength="40" value="${esc(p?.role || "Barbero")}">
      <label for="w-email">Su correo <small>(al entrar con él en la app le sale su panel)</small></label><input id="w-email" name="email" type="email" maxlength="120" value="${esc(p?.email || "")}">
      <fieldset class="tr-field"><legend>Horario</legend><div class="w-hours">${WEEK_ORDER.map((d) => {
        const r = hours[d]?.[0];
        return `<div class="w-day"><label class="check"><input type="checkbox" name="on${d}" ${r ? "checked" : ""}><span>${DAYS_ES[d]}</span></label>${timeSel("a" + d, r?.[0] || "10:00")}${timeSel("b" + d, r?.[1] || "20:00")}</div>`;
      }).join("")}</div></fieldset>
      <fieldset class="tr-field"><legend>Servicios que hace</legend><div class="tchips">${services
        .map((x) => {
          const blocked = x.only.length && !x.only.includes(p?.id);
          const on = p ? !p.services?.length || p.services.includes(x.id) : !x.only.length;
          return `<label class="tchip${blocked ? " dis" : ""}"><input type="checkbox" name="svc" value="${esc(x.id)}" ${on && !blocked ? "checked" : ""} ${blocked ? "disabled" : ""}><span>${esc(x.name)}${blocked ? " · solo " + esc(x.only.join(", ")) : ""}</span></label>`;
        })
        .join("")}</div></fieldset>
      ${owner ? "" : `<label for="w-comm">Su comisión para ti</label><div class="pct-field"><input id="w-comm" name="commission" inputmode="decimal" value="${String(p?.commission ?? 40).replace(".", ",")}"><span>%</span></div><p class="muted" style="font-size:12px;margin:6px 0 0">Para cambiarla solo desde un mes en adelante, usa «Cambiar %» en Caja y comisiones.</p>`}
      <label for="w-pin">${p ? "Nueva clave del panel <small>(déjalo vacío para no cambiarla)</small>" : "Clave del panel <small>(4 a 8 números)</small>"}</label><input id="w-pin" name="pin" inputmode="numeric" autocomplete="new-password" maxlength="8" ${p ? "" : "required"} placeholder="${p?.hasPin ? "••••" : ""}">
      ${owner ? "" : `<label class="check" style="margin-top:16px"><input type="checkbox" name="active" ${p?.active === false ? "" : "checked"}><span>En activo (sale para reservar y puede entrar a su panel)</span></label>`}
      <button class="btn wide" style="margin-top:18px" type="submit">${p ? "Guardar cambios" : "Añadir al equipo"}</button>
    </form>`,
  );
  const f = sh.el.querySelector("#w-form");
  sh.el.querySelector("#w-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      photo = await shrinkPortrait(file);
      const box = sh.el.querySelector("#w-photo");
      box.querySelector("img, span")?.remove();
      box.insertAdjacentHTML("afterbegin", `<img src="${photo}" alt="">`);
    } catch {
      toast("No se ha podido leer esa foto.");
    }
  };
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(f),
      btn = f.querySelector("[type=submit]");
    const hrs = {};
    for (const day of WEEK_ORDER) hrs[day] = d.get("on" + day) ? [d.get("a" + day), d.get("b" + day)] : null;
    btn.disabled = true;
    try {
      const r = await api("staff/team", {
        id: p?.id,
        name: d.get("name"),
        role: d.get("role"),
        email: d.get("email"),
        hours: hrs,
        services: d.getAll("svc"),
        commission: d.get("commission") ?? undefined,
        pin: d.get("pin"),
        active: owner ? true : d.get("active") === "on",
        photo,
      });
      sh.close();
      catalog = null;
      await loadCatalog();
      toast(r.pending ? `Guardado. Ojo: le quedan ${r.pending} citas pendientes; muévelas o cancélalas desde la Agenda.` : p ? "Guardado." : `${first(r.worker.name)} ya está en el equipo.`);
      await render();
      // La clave se la da el dueño: se le enseña una vez para que se la pase.
      const pin = String(d.get("pin") || "").trim();
      if (pin) pinHandOver(r.worker, pin, !p);
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
}
function pinHandOver(w, pin, isNew) {
  sheet(
    `<p class="eyebrow">${isNew ? "Nuevo en el equipo" : "Clave cambiada"}</p><h2>Dale su clave a ${esc(first(w.name))}</h2>
    <p class="cb-pin">${esc(pin)}</p>
    <p class="muted">Con ella entra a su panel en <b>Equipo</b>, eligiendo su nombre. También le sirve para abrir la <b>Caja</b> de la tablet.</p>
    <p class="muted">No se vuelve a enseñar: apúntala o pásasela ahora. Si se le olvida, pon una nueva desde aquí.</p>`,
  );
}
// Foto de trabajador en vertical (3:4), como las tarjetas de «Elige a tu barbero».
async function shrinkPortrait(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = 480,
      H = 640,
      r = Math.min(img.naturalWidth / W, img.naturalHeight / H),
      sw = W * r,
      sh = H * r,
      c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.getContext("2d").drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 3, sw, sh, 0, 0, W, H);
    return c.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Avisos y calendario de cada barbero ────────────────────────────────────
// Cada barbero pone el correo donde quiere que le avisen de sus citas y
// conecta su agenda con Google Calendar o con el calendario del móvil.
async function staffSettings() {
  let r;
  try {
    r = await api("staff/settings");
  } catch (e) {
    return toast(e.message);
  }
  const url = () => `${location.origin}/api/cal/${r.feed}.ics`,
    webcal = () => url().replace(/^https?:/, "webcal:");
  const sh = sheet(
    `<p class="eyebrow">${esc(first(staff.name))}</p><h2>Avisos y calendario</h2>
    <p class="section-label" style="margin-top:18px">Avisos por correo</p>
    <form id="st-mail"><label for="st-email" style="margin-top:0">Tu correo</label><input id="st-email" name="email" type="email" autocomplete="email" value="${esc(r.email)}" placeholder="tucorreo@gmail.com">
      <label class="check" style="margin-top:12px"><input type="checkbox" name="notify" ${r.notify ? "checked" : ""}><span>Avisarme de cada cita nueva, cambiada o cancelada</span></label>
      <div class="form-actions" style="margin-top:14px"><button class="btn" type="submit">Guardar</button><button type="button" class="btn secondary" id="st-test">Enviar prueba</button></div>
      ${r.mail ? "" : `<p class="warning">El envío de correos aún no está activado en la app. Tu correo queda guardado y los avisos empezarán a llegar en cuanto se active.</p>`}</form>
    <p class="section-label">Tu agenda en tu calendario</p>
    <p class="muted" style="margin-top:0">Tus citas aparecen en Google Calendar o en el calendario del iPhone, con el nombre del cliente, el servicio y su teléfono. Se actualiza sola.</p>
    <div class="stack"><a class="btn wide" id="st-google" target="_blank" rel="noopener" href="#">${svg(ICONS.cal)} Añadir a Google Calendar</a>
      <a class="btn wide secondary" id="st-apple" href="#">Añadir al calendario del iPhone</a>
      <button type="button" class="btn wide secondary" id="st-copy">${svg(ICONS.copy)} Copiar el enlace</button></div>
    <p class="muted" style="font-size:13px;margin-top:12px">Google tarda unas horas en traer los cambios; el iPhone, unos minutos. Para ver una cita al instante, mira la Agenda de este panel. El enlace es solo tuyo: no lo compartas.</p>
    <button type="button" class="tr-del" id="st-reset">Crear un enlace nuevo (el anterior deja de funcionar)</button>`,
  );
  const q = (s) => sh.el.querySelector(s);
  const links = () => {
    q("#st-google").href = "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal());
    q("#st-apple").href = webcal();
  };
  links();
  const save = (extra = {}) => api("staff/settings", { email: q("#st-email").value, notify: q("[name=notify]").checked, ...extra });
  q("#st-mail").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await save();
      toast("Guardado.");
    } catch (err) {
      toast(err.message);
    }
  });
  q("#st-test").onclick = async () => {
    try {
      await save({ test: true });
      toast("Enviado. Mira tu correo.");
    } catch (err) {
      toast(err.message);
    }
  };
  q("#st-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(url());
      toast("Enlace copiado.");
    } catch {
      toast(url());
    }
  };
  const rs = q("#st-reset");
  rs.onclick = async () => {
    if (rs.dataset.sure !== "1") {
      rs.dataset.sure = "1";
      rs.textContent = "Pulsa otra vez: habrá que volver a añadirlo al calendario";
      return;
    }
    try {
      r.feed = (await save({ resetFeed: true })).feed;
      links();
      rs.dataset.sure = "";
      rs.textContent = "Enlace nuevo creado. Vuelve a añadirlo a tu calendario.";
    } catch (err) {
      toast(err.message);
    }
  };
}

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
const TR_STATUS = { new: ["Nuevo", "st-ok"], contacted: ["Contactado", "st-wait"], enrolled: ["Apuntado", "st-done"], discarded: ["Descartado", "st-cancel"] };

function trainingCard() {
  if (!catalog.training) return "";
  const a = provById(catalog.training.teacher);
  return `<section class="home-block" aria-labelledby="train-title">
    <a class="train-card" href="#formacion">
      <span class="tc-photo"><img src="${pic("formacion")}" alt="" loading="lazy"></span>
      <span class="tc-txt"><small>Formación · ${esc(catalog.training.status)}</small>
        <strong id="train-title">¿Quieres aprender <em class="serif">a cortar?</em></strong>
        <span>${esc(first(a?.name || "Airam"))} prepara clases para empezar desde cero o para afinar tu técnica.</span>
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
    <label for="t-phone">Teléfono <small>(te escribiremos por WhatsApp)</small></label><input id="t-phone" name="phone" type="tel" inputmode="tel" required maxlength="25" autocomplete="tel" value="${esc(user?.phone || "+34 ")}">
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
  `<div class="card tr-done"><span class="tr-check" aria-hidden="true">✓</span><h2>Estás en la lista${s.name ? `, <em class="serif">${esc(first(s.name))}.</em>` : "."}</h2>
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
          <span class="tr-status"><i></i>${esc(T.status)} · lista abierta</span>
          <p class="eyebrow">Formación</p>
          <h1>Aprende el oficio <em>con ${esc(who)}.</em></h1>
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
          <li><strong>${esc(who)} prepara las fechas</strong> según el nivel y los horarios de quienes se apuntan.</li>
          <li><strong>Te escribimos los primeros</strong>, antes de anunciarlo, con fechas, plazas y precio.</li>
        </ol></section>
      <section class="tr-block" id="tr-form">${trainSaved() ? trainDone(trainSaved()) : trainForm(T)}</section>
      <p class="muted tr-wa">¿Dudas? <a href="${wa(`Hola, me interesa la formación de barbería con ${who}.`)}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a>.</p>` +
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

// Panel del dueño: quién quiere aprender y qué pide, para decidir fechas y grupos.
let trainFilter = "all";
async function staffTraining() {
  let r;
  try {
    r = await api("staff/training");
  } catch (e) {
    if (e.status === 403) return show(staffTop("formacion") + `<p class="ag-free">${esc(e.message)}</p>`);
    throw e;
  }
  const T = catalog.training,
    S = r.stats;
  const name = (list, id) => list.find((x) => (x.id || x) === id)?.name || id;
  const bars = (title, counts, list) => {
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return "";
    const max = rows[0][1];
    return `<div class="tr-bars"><p class="section-label">${title}</p>${rows
      .map(([k, n]) => `<div class="tr-bar"><span>${esc(name(list, k))}</span><i style="--w:${Math.round((n / max) * 100)}%"></i><b>${n}</b></div>`)
      .join("")}</div>`;
  };
  const shown = r.list.filter((t) => trainFilter === "all" || t.status === trainFilter);
  const filters = [["all", "Todos", S.total], ["new", "Nuevos", S.fresh], ["contacted", "Contactados"], ["enrolled", "Apuntados", S.enrolled], ["discarded", "Descartados"]];
  const link = location.origin + "/formacion";
  show(
    staffTop("formacion") +
      `<div class="stat3 money"><div><strong>${S.total}</strong><span>Interesados</span></div><div><strong>${S.fresh}</strong><span>Sin contactar</span></div><div><strong>${S.enrolled}</strong><span>Apuntados</span></div></div>` +
      `<div class="card tr-share"><div><strong>Enlace para compartir</strong><span>${esc(link.replace(/^https?:\/\//, ""))}</span></div><button type="button" class="btn small" id="tr-share">Compartir</button></div>` +
      (S.total
        ? `<details class="caja-more" ${S.total >= 3 ? "open" : ""}><summary>Qué piden</summary>${bars("Nivel", S.level, T.levels)}${bars("Formato", S.format, T.formats)}${bars("Les interesa", S.topics, T.topics)}${bars("Cuándo pueden", S.availability, T.availability)}</details>` +
          `<div class="tr-filter" role="tablist">${filters
            .map(([k, l, n]) => `<button type="button" class="${trainFilter === k ? "on" : ""}" data-f="${k}">${l}${n !== undefined ? ` <small>${n}</small>` : ""}</button>`)
            .join("")}</div>` +
          (shown.length
            ? shown
                .map((t) => {
                  const [st, cls] = TR_STATUS[t.status] || TR_STATUS.new;
                  const msg = `Hola ${first(t.name)}, soy ${first(staff.name)} de NOVA Studio. Te escribo por la formación de barbería que pediste en la app.`;
                  return `<article class="card tr-item" data-id="${esc(t.id)}">
                    <div class="tr-item-top"><div><strong>${esc(t.name)}</strong><span>${esc(name(T.levels, t.level))}${t.format ? " · " + esc(name(T.formats, t.format)) : ""}</span></div><span class="appt-state ${cls}">${st}</span></div>
                    ${t.topics.length ? `<p class="tr-tags">${t.topics.map((x) => `<span>${esc(x)}</span>`).join("")}</p>` : ""}
                    ${t.availability.length ? `<p class="tr-line">🕒 ${esc(t.availability.join(" · "))}</p>` : ""}
                    ${t.message ? `<p class="tr-msg">«${esc(t.message)}»</p>` : ""}
                    <p class="tr-line muted">${esc(t.phone)}${t.email ? " · " + esc(t.email) : ""}${t.instagram ? ` · <a href="https://instagram.com/${encodeURIComponent(t.instagram)}" target="_blank" rel="noopener">@${esc(t.instagram)}</a>` : ""} · ${esc(shortDate(t.created.slice(0, 10)))}</p>
                    <div class="form-actions" style="margin-top:10px"><a class="btn small wa-btn" target="_blank" rel="noopener" href="https://wa.me/${esc(t.phone.replace(/\D/g, ""))}?text=${encodeURIComponent(msg)}">WhatsApp</a>
                      <select class="tr-st" aria-label="Estado">${Object.entries(TR_STATUS).map(([k, [l]]) => `<option value="${k}" ${k === t.status ? "selected" : ""}>${l}</option>`).join("")}</select></div>
                    <button type="button" class="tr-del" data-del="${esc(t.id)}">Borrar sus datos</button>
                  </article>`;
                })
                .join("")
            : `<p class="ag-free">Nadie en este filtro.</p>`)
        : `<p class="ag-free">Aún no se ha apuntado nadie. Comparte el enlace en tu Instagram para empezar a llenar la lista.</p>`),
  );
  $("#tr-share").onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Formación de barbería", url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast("Enlace copiado.");
      }
    } catch {}
  };
  $$(".tr-filter [data-f]").forEach((b) => (b.onclick = () => ((trainFilter = b.dataset.f), render())));
  $$(".tr-item .tr-st").forEach(
    (s) =>
      (s.onchange = async () => {
        try {
          await api("staff/training/" + s.closest(".tr-item").dataset.id, { status: s.value });
          toast("Guardado.");
          render();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  $$("[data-del]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (b.dataset.sure !== "1") {
          b.dataset.sure = "1";
          b.textContent = "Pulsa otra vez para borrar";
          return;
        }
        try {
          await api("staff/training/" + b.dataset.del, { delete: true });
          toast("Datos borrados.");
          render();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}

// ── Tarjeta en garantía (Stripe) ───────────────────────────────────────────
// La tarjeta la guarda Stripe; aquí solo se ve la marca y los 4 últimos números.
const cardOn = () => !!catalog?.card?.enabled;
const BRANDS = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", jcb: "JCB", diners: "Diners", unionpay: "UnionPay" };
const cardLabel = (c) => (c ? `${BRANDS[c.brand] || "Tarjeta"} ···· ${c.last4}` : "");
const isPending = (c) => c && ["requires_action", "requires_payment_method"].includes(c.status);

const feePct = (s, kind) => Math.round((Number(s.price) || 0) * (kind === "late" ? catalog.rules.lateFeePct : catalog.rules.noShowFeePct)) / 100;
const pctText = (n) => (Number(n) >= 100 ? "el precio entero" : `el ${n} %`);
function guaranteeBox(s) {
  const fee = euro(Math.max(feePct(s, "noShow"), feePct(s, "late")));
  return user?.card
    ? `<div class="guarantee has"><span class="g-ic">${svg(ICONS.shieldCheck)}</span><div><strong>Cita garantizada con ${esc(cardLabel(user.card))}</strong><span>No se cobra nada ahora. Solo si no vienes o cancelas con menos de ${catalog.rules.cancelHours} h se te pueden cobrar ${fee}.</span></div><button type="button" class="g-link" id="g-change">Cambiar</button></div>`
    : `<div class="guarantee"><span class="g-ic">${svg(ICONS.card)}</span><div><strong>Tarjeta en garantía</strong><span>Para reservar dejas una tarjeta. <b>No se cobra nada ahora</b>: solo si no vienes o cancelas con menos de ${catalog.rules.cancelHours} h se te pueden cobrar ${fee}. Se guarda en tu perfil y no la vuelves a poner.</span></div></div>`;
}

let stripeP = null;
function loadStripe() {
  if (!stripeP)
    stripeP = new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.onload = () => ok(window.Stripe(catalog.card.pk, { locale: "es" }));
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
    <p class="muted fake-help">Acabada en <b>0002</b> la rechaza el banco al cobrar; en <b>3155</b> el banco pide confirmación. Cualquier otra se cobra bien.</p></div>`;

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
    if (b.late) return `<p class="charge-note">La cancelaste con menos de ${catalog.rules.cancelHours} h. Tu barbero revisará si se cobra; si tienes un motivo justificado, <a href="${wa(`Hola, cancelé tarde mi cita del ${longDay(b.date)} (ref. ${b.id}) porque…`)}" target="_blank" rel="noopener">cuéntaselo por WhatsApp</a>.</p>`;
    return "";
  }
  if (c.status === "succeeded") return `<p class="charge-note">Se cobraron ${euro(c.amount)} en tu ${esc(cardLabel(c))} por ${c.kind === "late" ? "cancelar con poca antelación" : "no venir ni cancelar a tiempo"}.</p>`;
  if (c.status === "refunded") return `<p class="charge-note ok">El cobro de ${euro(c.amount)} por esta cita se te ha devuelto.</p>`;
  if (isPending(c))
    return `<div class="warning"><strong>Pago pendiente: ${euro(c.amount)}</strong><br>${c.kind === "late" ? "La cancelaste con poca antelación" : "No viniste y no la cancelaste a tiempo"}, así que según las condiciones se cobra. ${
      c.status === "requires_action" ? "Tu banco pide que lo confirmes." : "Tu tarjeta no se pudo cobrar."
    }</div><button type="button" class="btn wide" id="pay-now">Pagar ${euro(c.amount)}</button>`;
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
  toast(`Tarjeta guardada: ${cardLabel(user.card)}.`);
  return user.card;
}

// Pagar un cargo que el banco no dejó cobrar solo (confirmación o tarjeta rechazada).
async function payPending(b) {
  const r = await api(`bookings/${b.id}/pay`, {});
  if (r.done) return toast("Ya estaba pagado. Gracias.");
  let stripe, elements;
  const ok = await paySheet({
    eyebrow: "Pago pendiente",
    title: `${euro(b.charge.amount)} · cita del ${esc(shortDay(b.date))}`,
    text: r.status === "requires_action" ? "Tu banco pide que confirmes el pago." : "Tu tarjeta no se pudo cobrar. Prueba otra vez o usa otra tarjeta.",
    cta: `Pagar ${euro(b.charge.amount)}`,
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
  const colors = ["#c8cacd", "#dedfe1", "#ffffff", "#0a090c", "#c8cacd", "#ffffff"];
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
  const id = ++renderId,
    route = (location.hash.slice(1) || "home").split("/"),
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
    motion();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", page === "home" ? "#0a090c" : "#f5f4f1");
    lastPage = page;
    hideSplash();
  };
  try {
    await loadCatalog();
    await pages[page](route.slice(1));
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

// Rutas «bonitas» que llevan a una pantalla (por si se comparten).
const entry = { "/acceder": "login", "/mis-citas": "bookings", "/perfil": "profile", "/equipo": "equipo", "/reservar": "home", "/formacion": "formacion", "/productos": "productos" }[location.pathname.replace(/\/$/, "")];
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

// «Reservar» de la cabecera: baja a la lista de servicios (yendo antes al inicio si hace falta).
$("#book-link").addEventListener("click", (e) => {
  e.preventDefault();
  const down = () => document.getElementById("servicios")?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (document.body.dataset.page === "home") return down();
  go("home");
  setTimeout(down, 700);
});
window.addEventListener("hashchange", render);
refreshMe().then(render);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
