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
  staffAll = false;
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
    (staff ? item("equipo", "Agenda", svg(ICONS.agenda)) : "");
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
      <picture><source media="(orientation: landscape)" srcset="/assets/hero-nova-wide.jpg"><img class="hero-photo" src="/assets/hero-nova.jpg" alt="Herramientas de barbería de NOVA Studio con el logo" fetchpriority="high"></picture>
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
    <figure><img src="/assets/cabina.jpg" alt="Barbero trabajando con un cliente" loading="lazy"><figcaption>En cabina</figcaption></figure>
    <figure><img src="/assets/acabado.jpg" alt="Detalle del acabado de un corte" loading="lazy"><figcaption>El acabado</figcaption></figure>
    <figure><img src="/assets/oficio.jpg" alt="Herramientas de barbería" loading="lazy"><figcaption>El oficio</figcaption></figure>
    <figure><img src="/assets/casa.jpg" alt="Espejo dorado del estudio" loading="lazy"><figcaption>La casa</figcaption></figure>
  </div>
  <p>Un espacio donde la barbería se encuentra con la creatividad, la moda y la cultura urbana. Hacemos <strong>corte de pelo</strong>, degradados, <strong>corte y barba</strong> y <strong>corte privado</strong> en ${esc(B.street)}, Vecindario. Reserva en segundos, sin llamar y sin descargar nada.</p>
  <ul class="about-tags" aria-label="Servicios"><li>Corte de pelo</li><li>Degradado</li><li>Corte y barba</li><li>Corte privado</li><li>Fuera de horario</li><li>VIP a domicilio</li></ul>
</section>
<footer class="home-footer">
  ${novaLogo("hf-logo inv")}
  <p class="hf-tag">Barbería · Vecindario, Gran Canaria</p>
  <span class="hf-rule" aria-hidden="true"></span>
  <div class="hf-cols">
    <div><small>Dirección</small><a href="${esc(B.maps)}" ${ext}>${esc(B.street)}<br>${esc(B.city)}</a></div>
    <div><small>Horario</small>${B.hoursText.map(([d, h]) => `<span>${esc(d)} · ${esc(h)}</span>`).join("")}<span class="hf-muted">${esc(B.closedText)}</span></div>
    <div><small>Contacto</small><a href="${wa("Hola NOVA Studio 👋")}" ${ext}>WhatsApp</a><a href="${esc(B.instagram)}" ${ext}>Instagram</a></div>
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
    <p><b>Qué datos tratamos.</b> Los que nos das al reservar: nombre, correo y teléfono, el historial de tus citas (servicio, barbero, fecha y si viniste) y lo del Club NOVA: puntos, liga, medallas, premios canjeados, tu código de amigo, quién te invitó y, si la subes, tu foto de perfil. ${
      catalog.card?.enabled
        ? "Si dejas una tarjeta en garantía, sus datos los guarda Stripe Payments Europe; nosotros solo vemos la marca, los 4 últimos números y la caducidad, y si se ha cobrado alguna falta."
        : "No guardamos datos de tarjeta: se paga en el local."
    }</p>
    <p><b>Para qué.</b> Para gestionar tus citas (crearlas, cambiarlas, cancelarlas y avisarte), darte acceso a tu cuenta con un código por correo y llevar tu Club NOVA. No te enviaremos publicidad sin tu permiso.</p>
    <p><b>Con quién.</b> Solo con los proveedores necesarios para que la app funcione: el alojamiento y la base de datos, el servicio que envía los correos${catalog.card?.enabled ? " y Stripe, que guarda tu tarjeta y hace los cobros por faltas" : ""}. No vendemos tus datos.</p>
    <p><b>Cuánto tiempo.</b> Mientras tengas cuenta o sigas viniendo y, después, lo que exija la ley.</p>
    <p><b>Tus derechos.</b> Puedes pedir ver, corregir o borrar tus datos escribiendo a <a href="mailto:${esc(catalog.business.email)}">${esc(catalog.business.email)}</a>. Si no te respondemos bien, puedes reclamar ante la AEPD.</p>
    <p><b>Cookies.</b> Solo una cookie técnica para mantener tu sesión iniciada (30 días). Nada de analítica ni publicidad. El mapa de Google puede poner las suyas al verlo.</p>`,
  ],
  condiciones: [
    "Condiciones de reserva",
    () => `<p><b>1. Reservas.</b> Eliges servicio, barbero, día y hora entre los huecos libres. La cita queda confirmada al terminar y la ves en «Mis citas».</p>
    <p><b>2. Precio y pago.</b> Los precios incluyen impuestos. Se paga en el local, en efectivo o con tarjeta.</p>
    <p><b>3. Cambios y cancelaciones.</b> Desde la app, hasta ${catalog.rules.cancelHours} horas antes. Con menos tiempo, escríbenos por WhatsApp.</p>
    <p><b>4. Puntualidad.</b> Si llegas tarde puede que haya que acortar el servicio para no retrasar al siguiente. Si faltas varias veces sin avisar, podremos limitar tus reservas online.</p>
    ${
      catalog.card?.enabled
        ? `<p><b>4 bis. Tarjeta en garantía y faltas.</b> Para reservar online dejas una tarjeta en garantía. Al guardarla no se cobra nada. Queda guardada en tu perfil (la custodia Stripe, nuestro proveedor de pagos) para tus próximas citas, y puedes cambiarla o quitarla cuando quieras desde tu perfil, salvo que tengas citas pendientes garantizadas con ella. <b>Si no vienes a la cita y no la has cancelado al menos ${catalog.rules.cancelHours} horas antes, autorizas a ${esc(catalog.business.name)} a cobrar en esa tarjeta el precio del servicio reservado</b>, sin necesidad de que estés presente. Antes de cobrar, tu barbero marca la cita como «No vino». Si tu banco pide confirmación o rechaza el cobro, te avisaremos y podrás pagarlo desde «Mis citas». Si crees que el cobro es un error, escríbenos y lo revisamos; si procede, te devolvemos el dinero.</p>`
        : ""
    }
    <p><b>5. Club NOVA.</b> Es gratis. Los niveles y premios no tienen valor en dinero, no se pueden pasar a otra persona y pueden cambiar.</p>`,
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
    if (user) {
      try {
        const r = await api("bookings");
        if (r.upcoming[0]) parts.push(nextApptCard(r.upcoming[0]));
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
    const saved = String(draft.phone || user?.phone || "");
    const m = saved.match(/^(\+\d{1,3})\s*(.*)$/);
    const savedCc = m && cc.some(([, c]) => c === m[1]) ? m[1] : "+34",
      savedNum = m ? m[2] : saved;
    show(
      back(`time/${draft.provider}`, "Cambiar hora") +
        heading("Tus datos", "Solo lo necesario para guardar tu cita.") +
        `<div class="pick-summary">${face(p)}<div><strong>${esc(s.name)} · ${euro(s.price)}</strong><span>${esc(p.name)} · ${esc(longDay(draft.date))} · ${esc(draft.start)}</span></div></div>` +
        `<form id="details" novalidate>
          <label for="f-name">Nombre</label><input id="f-name" name="name" required maxlength="120" autocomplete="name" value="${esc(draft.name || user?.name || "")}">
          <label for="f-email">Correo</label><input id="f-email" name="email" type="email" required autocomplete="email" ${user ? "readonly" : ""} value="${esc(user?.email || draft.email || "")}">
          <label for="f-phone">Teléfono</label>
          <div class="phone-field"><select name="cc" aria-label="Prefijo del país">${cc.map(([f, c]) => `<option value="${c}" ${c === savedCc ? "selected" : ""}>${f} ${c}</option>`).join("")}</select><input id="f-phone" name="phone" type="tel" inputmode="tel" required maxlength="20" autocomplete="tel-national" placeholder="600 000 000" value="${esc(savedNum)}"></div>
          ${
            user
              ? `<div class="club-joined"><span class="club-check">✓</span><div><strong>Eres del Club NOVA</strong><span>Esta cita suma a tu historial y a tu nivel.</span></div></div>`
              : `<div class="club-card"><span class="club-tag">CLUB</span><h2>Entras en el Club al reservar</h2><p>Con estos mismos datos. Sin contraseñas.</p><ul class="club-perks"><li>${catalog.points.perCut} punto por cada corte</li><li>Ligas de Bronce a Leyenda, con premios</li><li>Medallas y +${catalog.points.perFriend} puntos por cada amigo</li></ul>
                  <div class="ref-box${refCode() ? " open" : ""}" id="ref-box"><button type="button" class="ref-toggle" id="ref-toggle"><span aria-hidden="true">🎁</span>¿Te ha invitado un amigo?<b>Pon su código</b></button>
                  <div class="ref-field"><label class="sr-only" for="ref-input">Código de amigo</label><input id="ref-input" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="16" placeholder="Ej.: CARLOS482" value="${esc(refCode())}"><p class="ref-state" id="ref-state" aria-live="polite"></p></div></div></div>`
          }
          ${cardOn() ? guaranteeBox(s) : ""}
          <label class="check"><input type="checkbox" name="terms" required ${draft.terms ? "checked" : ""}><span>Acepto reservar la cita indicada. Se puede cambiar desde la app hasta ${catalog.rules.cancelHours} h antes.${
            cardOn() ? ` <b>Si no vengo y no la cancelo a tiempo, autorizo a ${esc(catalog.business.name)} a cobrar ${euro(s.price)} en mi tarjeta.</b>` : ""
          } He leído las <a href="#condiciones" target="_blank">condiciones</a> y la <a href="#privacidad" target="_blank">política de privacidad</a>.</span></label>
          <button class="btn wide book-btn" type="submit">${cardOn() && !user?.card ? "Añadir tarjeta y reservar" : cardOn() ? "Reservar" : "Reservar y pagar en el local"}</button>
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
        refState.innerHTML = `✓ Te invita <b>${esc(r.name)}</b>. Cuando vengas a tu primer corte, ${esc(r.name)} suma ${r.points} puntos.`;
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
      const data = { name: d.name.trim(), email: (user?.email || d.email).trim(), phone: `${d.cc} ${d.phone.trim()}` };
      Object.assign(draft, data, { terms: true });
      saveDraft();
      // Tarjeta en garantía: se guarda una vez y queda en el perfil para las próximas citas.
      if (cardOn() && !user?.card) {
        const card = await addCard({ ...data, ref: refOk || "" });
        if (!card) return toast("Sin tarjeta en garantía no podemos guardar la cita.");
      }
      const book = () => api("book", { ...data, ref: refOk || "", service: draft.service, provider: draft.provider, date: draft.date, start: draft.start, terms: true });
      let r;
      try {
        r = await book();
      } catch (err) {
        if (err.status !== 402) throw err;
        if (!(await addCard(data))) return toast("Sin tarjeta en garantía no podemos guardar la cita.");
        r = await book();
      }
      availCache.clear();
      lastBooked = { id: r.id, existing: r.existing, service: s, provider: p, date: draft.date, start: draft.start };
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
      pts = b.service.points || catalog.points.perCut;
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
        `<a class="btn wide secondary" href="${gcalLink({ ...b, end: addMin(b.start, b.service.duration) })}" target="_blank" rel="noopener">${svg(ICONS.cal)} Añadir a mi calendario</a>` +
        (b.existing
          ? `<p class="warning">Ya tenías cuenta con este correo. Entra con tu correo para ver y cambiar todas tus citas.</p><a class="btn wide" href="#login">Entrar a mis citas</a>`
          : `<a class="btn wide" style="margin-top:10px" href="#booking/${esc(b.id)}">Ver mi cita</a>`),
    );
    confetti();
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
          <div><dt>Estado</dt><dd>${b.status === "canceled" ? "Cancelada" : b.attendance === "absent" ? "No vino" : r.past ? "Realizada" : "Confirmada"}</dd></div>
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
                  : `<p class="warning">Quedan menos de ${catalog.rules.cancelHours} horas: para cambiarla o cancelarla, escríbenos.</p><a class="btn wide wa-btn" href="${wa(`Hola, tengo cita el ${longDay(b.date)} a las ${b.start} (ref. ${b.id}) y necesito cambiarla.`)}" target="_blank" rel="noopener">${svg(ICONS.chat)} WhatsApp</a>`
              }
            </div>`
          : `<a class="btn wide" href="#barber/${esc(b.service.id)}">Reservar otra igual</a>`),
    );
    $("#pay-now")?.addEventListener("click", () => payPending(b).catch((e) => toast(e.message)));
    $("#cancel")?.addEventListener("click", () => {
      const sh = sheet(
        `<h2>¿Cancelar la cita?</h2><p>${esc(b.service.name)} con ${esc(first(b.provider.name))}, ${esc(longDay(b.date))} a las ${esc(b.start)}. La hora quedará libre para otra persona.</p><div class="form-actions"><button type="button" class="btn secondary" id="no">No</button><button type="button" class="btn danger" id="yes">Sí, cancelar</button></div>`,
      );
      sh.el.querySelector("#no").onclick = sh.close;
      sh.el.querySelector("#yes").onclick = async (e) => {
        e.currentTarget.disabled = true;
        try {
          await api(`bookings/${b.id}/cancel`, {});
          availCache.clear();
          sh.close();
          toast("Cita cancelada.");
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
    const m = await api("member");
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
        <div class="ph-count"><strong>${m.metrics.cuts}</strong><span>${m.metrics.cuts === 1 ? "corte" : "cortes"}<br>con nosotros</span></div>
        <div class="ph-bar"><i style="width:${L.pct}%"></i></div>
        <div class="ph-next">${L.toNext ? `${L.toNext} ${L.toNext === 1 ? "punto" : "puntos"} para <b>◆ ${esc(L.nextLabel)}</b>` : "Has llegado a lo más alto: <b>Leyenda</b>"}</div>
      </section>
      <div class="stat3">
        <a href="#rewards"><strong>${m.balance}</strong><span>Puntos</span></a>
        <button type="button" data-scroll="medallas"><strong>${got}</strong><span>Medallas</span></button>
        <button type="button" data-scroll="amigos"><strong>${m.metrics.friends}</strong><span>Amigos</span></button>
      </div>
      ${leagueStrip(L.index)}
      ${medalsBlock(m)}
      ${inviteBlock(m)}
      ${
        cardOn()
          ? `<p class="section-label">Tu tarjeta</p>
        <div class="card my-card">${
          user.card
            ? `<div class="mc-row"><span class="mc-chip">${esc((BRANDS[user.card.brand] || "Tarjeta").toUpperCase())}</span><div><strong>···· ${esc(user.card.last4)}</strong><span>Caduca ${esc(user.card.exp || "")}</span></div></div>
               <p class="muted">Garantiza tus citas. Solo se usa si no vienes y no cancelas con ${catalog.rules.cancelHours} h: entonces se cobra el precio del servicio.</p>
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
        `<section class="pts"><span class="pts-tag">EL CLUB</span><strong class="pts-num">${P.perCut}</strong><p>punto por cada corte · +${P.perFriend} por cada amigo que invites</p><div class="pts-league">${leagueArt(catalog.leagues[0])}<span>Empiezas en <b>Bronce III</b> y subes hasta <b>Leyenda</b></span></div></section>` +
          `<a class="btn wide" href="#home">Reservar mi primer corte</a><a class="btn wide secondary" style="margin-top:10px" href="#login">Ya soy del Club · Entrar</a>` +
          `<p class="section-label">Premios del Club</p><div class="rw-list">${catalog.rewards.map((r) => rewardRow(r, 0)).join("")}</div>` +
          `<p class="section-label">Ligas</p>${leagueList(-1)}`,
      );
      return;
    }
    const m = await api("member"),
      L = leagueOf(m.earned),
      open = m.redemptions.filter((r) => r.status === "pending");
    show(
      `<section class="pts" style="${leagueVars(L.league)}">
        <span class="pts-tag">TUS PUNTOS</span>
        <strong class="pts-num">${m.balance}</strong>
        <p>${P.perCut} punto por cada corte · +${P.perFriend} por cada amigo que invites</p>
        <div class="pts-league">${leagueArt(L.league)}<span>Liga <b>${esc(L.label)}</b> · ${m.earned} puntos ganados</span></div>
      </section>` +
        (open.length
          ? `<p class="section-label">Para recoger en el local</p><div class="rw-list">${open
              .map((r) => `<div class="rw ticket"><span class="rw-ic">${svg(ICONS.gift)}</span><div><strong>${esc(r.reward.name)}</strong><span>Enséñale este código a tu barbero</span></div><b class="tk-code">${esc(r.id)}</b></div>`)
              .join("")}</div>`
          : "") +
        `<p class="section-label">Premios del Club</p><div class="rw-list">${catalog.rewards.map((r) => rewardRow(r, m.balance)).join("")}</div>` +
        `<p class="section-label">Ligas</p>${leagueList(L.index)}` +
        (m.moves.length
          ? `<p class="section-label">Movimientos</p><div class="card mv-list">${m.moves
              .slice(0, 12)
              .map((x) => `<div class="mv"><span>${esc(x.text)}${x.when ? `<small>${esc(shortDay(x.when.slice(0, 10)))}</small>` : ""}</span><b class="${x.pts > 0 ? "plus" : "minus"}">${x.pts > 0 ? "+" : ""}${x.pts}</b></div>`)
              .join("")}</div>`
          : "") +
        `<a class="btn wide secondary" style="margin-top:18px" href="#profile">Ver mi perfil y medallas</a>`,
    );
    $$("[data-redeem]").forEach(
      (b) =>
        (b.onclick = () => {
          const r = catalog.rewards.find((x) => x.id === b.dataset.redeem);
          const sh = sheet(
            `<p class="eyebrow">Canjear premio</p><h2>${esc(r.name)}</h2><p>${esc(r.desc)}. Se descuentan <b>${r.cost} puntos</b> de tu saldo (te quedarán ${m.balance - r.cost}). Tu liga no baja.</p><div class="form-actions"><button type="button" class="btn secondary" id="no">Ahora no</button><button type="button" class="btn" id="yes">Canjear</button></div>`,
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
  async equipo(args = []) {
    if (!staff) return staffLogin();
    try {
      await (args[0] === "caja" ? staffCaja() : args[0] === "faltas" ? staffFaltas() : staffAgenda());
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
  let cells = "";
  for (let i = 0; i < lead; i++) cells += `<span class="cal-cell blank" aria-hidden="true"></span>`;
  for (let d = 1; d <= total; d++) {
    const iso = `${calMonth}-${pad(d)}`,
      open = (avail[iso] || []).length > 0;
    cells += `<button type="button" class="cal-cell${open ? " open" : ""}${iso === selectedDate ? " selected" : ""}${iso === todayIso ? " today" : ""}" data-day="${iso}" ${open ? "" : "disabled"} aria-pressed="${iso === selectedDate}" aria-label="${esc(longDay(iso))}${open ? "" : ", sin horas"}">${d}</button>`;
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
// Liga y división como en un ranking: cada liga (menos Leyenda) tiene III, II y I.
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
    nextLabel = k < 2 ? `${lg.name} ${DIV[k + 1]}` : next === Ls[Ls.length - 1] ? next.name : `${next.name} III`;
  return { league: lg, index: i, label: `${lg.name} ${DIV[k]}`, pct: Math.max(4, Math.round(((pts - from) / (to - from)) * 100)), toNext: to - pts, nextLabel };
}
const leagueVars = (lg) => `--c1:${lg.c1};--c2:${lg.c2}`;
const monthYear = (stamp) => (stamp ? new Date(String(stamp).slice(0, 10) + "T12:00:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" }) : "hoy");

// Insignia de cada liga: escudo con degradado y un símbolo que crece con la liga.
const LEAGUE_GLYPH = [
  '<path d="M23 30l9 6 9-6"/>',
  '<path d="M23 26l9 6 9-6M23 34l9 6 9-6"/>',
  '<path d="M32 22l2.9 6 6.6.8-4.9 4.5 1.3 6.5L32 36.6l-5.9 3.2 1.3-6.5-4.9-4.5 6.6-.8z"/>',
  '<path d="M32 21l9 11-9 11-9-11z"/><path d="M32 27l4 5-4 5-4-5z"/>',
  '<path d="M25 24h14l4 6-11 13-11-13z"/><path d="M21 30h22M32 43l-4-13 4-6 4 6z"/>',
  '<path d="M32 19c1 8 4 11 12 12-8 1-11 4-12 12-1-8-4-11-12-12 8-1 11-4 12-12z"/>',
  '<path d="M21 38l-1-13 7 6 5-9 5 9 7-6-1 13z"/><path d="M22 42h20"/>',
  '<path d="M21 37l-1-12 7 5 5-9 5 9 7-5-1 12z"/><path d="M18 41c4 2 9 3 14 3s10-1 14-3M32 13v3"/>',
];
function leagueArt(lg, locked = false) {
  const i = catalog.leagues.indexOf(lg),
    id = `lg-${lg.id}${locked ? "-x" : ""}`,
    c1 = locked ? "#f1f0eb" : lg.c1,
    c2 = locked ? "#c9c7bf" : lg.c2;
  return `<svg viewBox="0 0 64 64" class="lg-art" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <path d="M32 4 54 13v17c0 14-9 24-22 30C19 54 10 44 10 30V13z" fill="url(#${id})"/>
    <path d="M32 10.5 48.5 17.2V30c0 10.5-6.6 18-16.5 22.6C22.1 48 15.5 40.5 15.5 30V17.2z" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.3"/>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="${c2}" stroke-width="5" opacity=".55">${LEAGUE_GLYPH[i]}</g><g stroke="#fff" stroke-width="2.4">${LEAGUE_GLYPH[i]}</g></g></svg>`;
}
function leagueStrip(index) {
  return `<div class="lg-strip" role="list">${catalog.leagues
    .map((lg, i) => `<div role="listitem" class="lg-step${i === index ? " on" : ""}${i < index ? " past" : ""}" style="${leagueVars(lg)}">${leagueArt(lg, i > index)}<span>${esc(lg.name)}</span></div>`)
    .join("")}</div>`;
}
function leagueList(index) {
  return `<div class="lg-list">${catalog.leagues
    .map((lg, i) => {
      const state = i === index ? "Tu liga" : i < index ? "✓ Superada" : `${lg.min} pts`;
      return `<div class="lg-row${i === index ? " on" : ""}${i > index ? " locked" : ""}" style="${leagueVars(lg)}">${leagueArt(lg, i > index)}<div><strong>${esc(lg.name)}</strong><span>${svg(ICONS.gift)}${esc(lg.perk)}</span></div><em>${state}</em></div>`;
    })
    .join("")}</div>`;
}

// Medallas: rueda dentada (cortes), escudo (amigos) y hexágono (especiales).
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
const MEDAL_SHAPE = {
  cortes: GEAR,
  amigos: "M32 3 55 11v19c0 15-10 25-23 31C19 55 9 45 9 30V11z",
  especiales: "M32 3l25 14.5v29L32 61 7 46.5v-29z",
};
const MEDAL_TINT = {
  cortes: ["#fff3cc", "#f3cf8a", "#a8701c", "#5c3d0c"],
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
function medalCard(md, st) {
  const left = md.goal - st.progress,
    unit = md.metric === "cuts" ? ["corte", "cortes"] : md.metric === "friends" ? ["amigo", "amigos"] : null,
    sub = st.got ? "✓ Conseguida" : unit ? `Falta${left === 1 ? "" : "n"} ${left} ${left === 1 ? unit[0] : unit[1]}` : md.desc,
    bar = !st.got && md.goal > 1 ? `<div class="md-bar" title="${st.progress}/${md.goal}"><i style="width:${Math.max(4, Math.round((st.progress / md.goal) * 100))}%"></i></div>` : "";
  return `<div class="md${st.got ? " got" : ""}"><div class="md-art">${medalArt(md, st.got)}${st.got ? "" : `<span class="md-lock">${svg(ICONS.lock)}</span>`}</div><strong>${esc(md.name)}</strong><span class="md-sub">${esc(sub)}</span>${bar}<span class="md-chip">${svg(ICONS.gift)}+${md.bonus} ${md.bonus === 1 ? "punto" : "puntos"}</span></div>`;
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
function inviteBlock(m) {
  return `<section class="invite" id="amigos">
    <span class="club-tag">INVITA Y SUMA</span>
    <h2>+${catalog.points.perFriend} puntos por cada amigo</h2>
    <p>Pásale tu código. Cuando venga a su primer corte, los puntos son tuyos.</p>
    <div class="inv-code"><strong id="my-code">${esc(user.ref || "—")}</strong><button type="button" id="copy-code" aria-label="Copiar código">${svg(ICONS.copy)}</button></div>
    <button type="button" class="btn wide club-btn" id="share-code">${svg(ICONS.share)} Compartir mi código</button>
    ${
      m.friends.length
        ? `<div class="inv-friends">${m.friends.map((f) => `<span class="${f.counted ? "ok" : ""}">${esc(f.name)}${f.counted ? " ✓" : " · pendiente"}</span>`).join("")}</div>`
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
  }</div>${can ? `<button type="button" class="rw-btn" data-redeem="${esc(r.id)}">Canjear<small>${r.cost} pts</small></button>` : `<span class="rw-cost">${r.cost}<small>pts</small></span>`}</div>`;
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
  let last = "";
  try {
    last = localStorage.getItem("nova_staff_who") || "";
  } catch {}
  show(
    back("home", "Inicio") +
      heading("Acceso equipo", "Elige quién eres y pon tu clave.") +
      `<form id="staff"><div class="who" role="radiogroup" aria-label="Quién eres">${catalog.providers
        .map(
          (p) =>
            `<label class="who-item"><input type="radio" name="provider" value="${esc(p.id)}" ${p.id === last ? "checked" : ""}>${face(p, "who-face")}<span>${esc(first(p.name))}</span></label>`,
        )
        .join("")}</div>
      <label for="s-pin">Tu clave</label><input id="s-pin" name="pin" type="password" inputmode="numeric" required autocomplete="current-password">
      <button class="btn wide" style="margin-top:16px" type="submit">Entrar</button></form>`,
  );
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
  return (
    `<div class="staff-top">${face(provById(staff.id), "who-face")}<div><p class="eyebrow">${staff.owner ? "Propietario" : "Panel de barbero"}</p><h1>Hola, ${esc(first(staff.name))}</h1></div></div>` +
    `<div class="tabs" role="navigation" aria-label="Panel"><a href="#equipo" class="${tab === "agenda" ? "active" : ""}" ${tab === "agenda" ? 'aria-current="page"' : ""}>Agenda</a><a href="#equipo/caja" class="${tab === "caja" ? "active" : ""}" ${tab === "caja" ? 'aria-current="page"' : ""}>${staff.owner ? "Caja y comisiones" : "Mi caja"}</a><a href="#equipo/faltas" class="${tab === "faltas" ? "active" : ""}" ${tab === "faltas" ? 'aria-current="page"' : ""}>Faltas</a></div>`
  );
}

async function staffAgenda() {
  if (!staffDay) staffDay = isoDay(new Date());
  const [r, rd] = await Promise.all([api("staff/day?date=" + staffDay), api("staff/redemptions").catch(() => ({ pending: [] }))]);
  const canjes = rd.pending.length
    ? `<section class="ag-col"><div class="ag-head"><h2>Premios por entregar</h2><span>${rd.pending.length}</span></div>${rd.pending
        .map(
          (x) => `<div class="ag-item rd-item"><time>${esc(x.id)}</time><div><strong>${esc(x.reward.name)}</strong><span>${esc(x.name || x.email)} · ${x.reward.cost} pts</span></div><span class="seg"><button type="button" class="small" data-rd="${esc(x.id)}" data-st="done">Entregado</button></span></div>`,
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
                    <span>${b.status === "canceled" ? "Cancelada" : b.attendance === "done" ? "✓ Vino" : b.attendance === "absent" ? "✗ No vino" : b.by === "staff" ? "Equipo" : "App"}</span>
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
      `<div class="staff-bar"><button type="button" class="btn" id="new-bk">+ Cita</button><button type="button" class="btn secondary" id="new-block">Bloquear hora</button></div>` +
      canjes +
      cols +
      (staff.owner ? "" : `<button type="button" class="btn wide secondary" style="margin-top:14px" id="see-all">${staffAll ? "Ver solo mi agenda" : "Ver la agenda de todo el salón"}</button>`) +
      `<button type="button" class="btn wide secondary" style="margin-top:28px" id="staff-out">Salir del panel</button>`,
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
        `<li><time>${esc(shortDate(x.date))}<small>${esc(x.start)}</small></time><span><strong>${esc(x.name)}</strong>${esc(x.service)}</span><b>${euro(x.price)}${withComm ? `<small>${String(x.pct).replace(".", ",")} % · ${euro(x.commission)}</small>` : ""}</b></li>`,
    )
    .join("");
  return (
    `<div class="stat3 money"><div><strong>${p.services}</strong><span>Servicios</span></div><div><strong>${euro(p.billed)}</strong><span>Facturado</span></div><div><strong>${euro(p.average)}</strong><span>Ticket medio</span></div></div>` +
    `<p class="caja-meta">${p.upcoming ? `Quedan ${p.upcoming} ${p.upcoming === 1 ? "cita" : "citas"} este mes (${euro(p.expected)})` : "No quedan citas este mes"} · ${p.absent} no ${p.absent === 1 ? "vino" : "vinieron"} · ${p.canceled} ${p.canceled === 1 ? "cancelada" : "canceladas"}${p.penalties ? ` · ${euro(p.penalties)} cobrados por faltas` : ""}</p>` +
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
        ? `<p class="warning">Cancelada.</p>`
        : !mine
          ? `<p class="muted">Es una cita de ${esc(first(b.provider.name))}: solo la pueden cambiar ${esc(first(b.provider.name))} o el dueño.</p>`
          : (block
              ? ""
              : `<div class="seg"><button type="button" class="${b.attendance === "done" ? "" : "secondary"}" data-att="done">✓ Vino</button><button type="button" class="${b.attendance === "absent" ? "" : "secondary"}" data-att="absent">✗ No vino</button></div>` +
                staffCharge(b) +
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
// ── Equipo: faltas y cobros ────────────────────────────────────────────────
// Dentro de la ficha de una cita marcada «No vino»: cobrar el servicio en la
// tarjeta que el cliente dejó en garantía, y ver cómo ha ido el cobro.
function staffCharge(b) {
  if (b.kind !== "booking" || b.attendance !== "absent") return "";
  const c = b.charge,
    price = euro(b.service.price);
  if (c?.status === "succeeded")
    return `<div class="chg ok"><strong>✓ Falta cobrada: ${euro(c.amount)}</strong><span>${esc(cardLabel(c))} · ${esc(shortDate(c.at.slice(0, 10)))}</span>${
      staff.owner ? `<button type="button" class="btn small secondary" id="chg-refund">Devolver el dinero</button>` : ""
    }</div>`;
  if (c?.status === "refunded") return `<div class="chg"><strong>Cobro devuelto</strong><span>Se le devolvieron ${euro(c.amount)}.</span></div>`;
  if (c?.status === "requires_action")
    return `<div class="chg wait"><strong>⏳ Pendiente de que el cliente lo confirme</strong><span>Su banco pide confirmación. Le hemos avisado: lo verá en «Mis citas» al entrar en la app.</span></div>`;
  const past = new Date(`${b.date}T${b.start}:00`) < new Date();
  if (!past) return `<p class="muted chg-hint">Cuando pase la hora de la cita podrás cobrarle la falta.</p>`;
  if (!b.card) return `<div class="chg"><strong>Sin tarjeta guardada</strong><span>Este cliente no dejó tarjeta (cita apuntada a mano o de antes). Habla con él por WhatsApp.</span></div>`;
  return `<div class="chg${c ? " bad" : ""}">${
    c ? `<strong>✗ No se pudo cobrar</strong><span>${esc(c.error || "El banco rechazó el cobro.")}</span>` : `<strong>No vino y no avisó</strong><span>Según las condiciones que aceptó, se le cobra el servicio.</span>`
  }<button type="button" class="btn wide" id="chg-go">${c ? "Reintentar" : "Cobrar"} ${price} por no venir</button></div>`;
}
function bindStaffCharge(sh, b) {
  const go2 = sh.el.querySelector("#chg-go");
  if (go2)
    go2.onclick = async () => {
      if (go2.dataset.sure !== "1") {
        go2.dataset.sure = "1";
        go2.textContent = `Pulsa otra vez para cobrar ${euro(b.service.price)}`;
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
    b.charge?.status === "succeeded"
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
      `<div class="stat3 money"><div><strong>${r.list.length}</strong><span>${r.list.length === 1 ? "Falta" : "Faltas"}</span></div><div><strong>${euro(r.charged)}</strong><span>Cobrado</span></div><div><strong>${r.uncharged}</strong><span>Sin cobrar</span></div></div>` +
      (r.pending ? `<p class="caja-meta">${euro(r.pending)} pendientes de que el cliente confirme o pague.</p>` : "") +
      (r.list.length
        ? `<div class="faltas">${r.list
            .map((b) => {
              const [t, cls] = status(b);
              return `<button type="button" class="ag-item falta" data-id="${esc(b.id)}"><time>${esc(shortDate(b.date))}<small>${esc(b.start)}</small></time><div><strong>${esc(b.name)}</strong><span>${esc(b.service.name)} · ${euro(b.service.price)}${staff.owner ? " · " + esc(first(b.provider.name)) : ""}${b.strikes > 1 ? ` · ⚠ ${b.strikes} faltas` : ""}</span></div><span class="appt-state ${cls}">${t}</span></button>`;
            })
            .join("")}</div>`
        : `<p class="ag-free">Nadie ha faltado este mes. 🙌</p>`) +
      `<p class="muted" style="margin-top:18px">Para apuntar una falta, abre la cita en la Agenda y pulsa «✗ No vino».</p>`,
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
          : `<label>Nombre del cliente</label><input name="name" required maxlength="120"><label>Teléfono</label><input name="phone" type="tel" maxlength="30"><label>Correo (opcional)</label><input name="email" type="email">`
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
      await api("staff/book", { ...d, date: staffDay, block });
      availCache.clear();
      sh.close();
      toast(block ? "Hora bloqueada." : "Cita apuntada.");
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

// ── Tarjeta en garantía (Stripe) ───────────────────────────────────────────
// La tarjeta la guarda Stripe; aquí solo se ve la marca y los 4 últimos números.
const cardOn = () => !!catalog?.card?.enabled;
const BRANDS = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", jcb: "JCB", diners: "Diners", unionpay: "UnionPay" };
const cardLabel = (c) => (c ? `${BRANDS[c.brand] || "Tarjeta"} ···· ${c.last4}` : "");
const isPending = (c) => c && ["requires_action", "requires_payment_method"].includes(c.status);

function guaranteeBox(s) {
  const fee = euro(s.price);
  return user?.card
    ? `<div class="guarantee has"><span class="g-ic">${svg(ICONS.shieldCheck)}</span><div><strong>Cita garantizada con ${esc(cardLabel(user.card))}</strong><span>No se cobra nada ahora. Solo si no vienes y no cancelas con ${catalog.rules.cancelHours} h se cobran ${fee}.</span></div><button type="button" class="g-link" id="g-change">Cambiar</button></div>`
    : `<div class="guarantee"><span class="g-ic">${svg(ICONS.card)}</span><div><strong>Tarjeta en garantía</strong><span>Para reservar dejas una tarjeta. <b>No se cobra nada ahora</b>: solo si no vienes y no cancelas con ${catalog.rules.cancelHours} h se cobra el servicio (${fee}). Se guarda en tu perfil y no la vuelves a poner.</span></div></div>`;
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
  variables: { colorPrimary: "#171717", colorText: "#171717", colorBackground: "#ffffff", colorDanger: "#a62a29", borderRadius: "12px", fontFamily: "Inter Tight, Arial, sans-serif", fontSizeBase: "16px" },
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
  if (!c) return "";
  if (c.status === "succeeded") return `<p class="charge-note">Se cobraron ${euro(c.amount)} en tu ${esc(cardLabel(c))} por no venir ni cancelar a tiempo.</p>`;
  if (c.status === "refunded") return `<p class="charge-note ok">El cobro de ${euro(c.amount)} por esta cita se te ha devuelto.</p>`;
  if (isPending(c))
    return `<div class="warning"><strong>Pago pendiente: ${euro(c.amount)}</strong><br>No viniste y no la cancelaste a tiempo, así que según las condiciones se cobra el servicio. ${
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
  const colors = ["#f3cf8a", "#e6b25c", "#fff3d6", "#171717", "#f4c2c9", "#ffffff"];
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
const teamFor = (s) => catalog.providers.filter((p) => !s.providers?.length || s.providers.includes(p.id));
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", page === "home" ? "#0b0b0b" : "#f5f4f0");
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
const entry = { "/acceder": "login", "/mis-citas": "bookings", "/perfil": "profile", "/equipo": "equipo", "/reservar": "home" }[location.pathname.replace(/\/$/, "")];
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

window.addEventListener("hashchange", render);
refreshMe().then(render);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
