// Una sola función para toda la API: vercel.json manda aquí /api/<lo que sea>.
import crypto from "node:crypto";
import { cmd, pipe, getJSON, setJSON, hgetall, usingMemory, scanKeys, dumpKeys, claim, hit } from "./_lib/store.js";
import { SERVICES, PROVIDERS, RULES, BUSINESS, POINTS, MEDALS, REWARDS, COMMISSION, TRAINING, EXTRAS, PAY_METHODS, publicCatalog } from "./_lib/config.js";
import * as T from "./_lib/time.js";
import { codeMail, send, bookingLines, mailReady } from "./_lib/mail.js";
import * as Card from "./_lib/stripe.js";

const ON_VERCEL = !!process.env.VERCEL;
// Mientras se prueba, se entra solo con el correo. Para producción hay que
// poner LOGIN_CON_CODIGO=1 (y RESEND_API_KEY): entonces se manda un código de
// 6 cifras al correo y sin él no se entra. Sin código, cualquiera que sepa un
// correo puede ver las citas de esa persona.
const LOGIN_CON_CODIGO = process.env.LOGIN_CON_CODIGO === "1";
const SESSION = "nova_s",
  STAFF = "nova_staff",
  MONTH = 30 * 86400,
  YEAR = 365 * 86400; // la sesión dura un año y se renueva sola cada vez que se abre la app
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s().-]{7,22}$/;

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}
const fail = (status, message, extra) => {
  throw new HttpError(status, message, extra);
};

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const token = () => crypto.randomBytes(24).toString("base64url");
const newId = () => "N" + crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 7);
const normEmail = (s) => String(s || "").trim().toLowerCase();
const clean = (s, max = 120) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const same = (a, b) => {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ── Peticiones y cookies ───────────────────────────────────────────────────
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(res, req, name, value, maxAge) {
  const secure = ON_VERCEL || req.headers["x-forwarded-proto"] === "https";
  const c = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [].concat(prev, c) : c);
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4000000) fail(413, "Demasiados datos.");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    fail(400, "Petición mal formada.");
  }
}
const ip = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();

async function limit(key, max, seconds, msg = "Demasiados intentos. Espera unos minutos.") {
  if ((await hit("rl:" + key, seconds)) > max) fail(429, msg);
}

// ── Sesiones ───────────────────────────────────────────────────────────────
async function currentUser(req) {
  const t = cookies(req)[SESSION];
  if (!t) return null;
  const email = await cmd("GET", "sess:" + sha(t));
  return email ? getJSON("user:" + email) : null;
}
// La sesión del equipo guarda quién es (airam, ehedey, noa). Las sesiones de
// la clave única de antes guardaban "1" y ya no valen: hay que volver a entrar.
// La tablet del mostrador entra como «caja» (con la clave de cualquiera del
// equipo) y solo puede cobrar: el resto del panel no la reconoce.
async function staffOf(req, allowCaja = false) {
  const t = cookies(req)[STAFF];
  return staffById(t && (await cmd("GET", "staffsess:" + sha(t))), allowCaja);
}
function staffById(id, allowCaja) {
  if (id === "caja") return allowCaja ? { id: "caja", name: "Caja", owner: false, caja: true } : null;
  const p = id && TEAM.find((x) => x.id === id && x.active !== false);
  return p ? { id: p.id, name: p.name, owner: !!p.owner } : null;
}
async function needCaja(req) {
  const me = await staffOf(req, true);
  if (!me) fail(401, "Solo para el equipo.", { staff: true });
  return me;
}
async function needStaff(req) {
  const me = await staffOf(req);
  if (!me) fail(401, "Solo para el equipo.", { staff: true });
  return me;
}
// Un socio por su correo o por su código del Club (el de invitar amigos).
async function findMember(q) {
  const s = String(q || "").trim();
  if (!s) return null;
  if (s.includes("@")) return getJSON("user:" + s.toLowerCase());
  const code = s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const email = code && (await cmd("GET", "refcode:" + code));
  return email ? getJSON("user:" + email) : null;
}
// Cada barbero lleva su agenda; el dueño, la de todos.
const canManage = (me, providerId) => !!me && (me.owner || me.id === providerId);
const pinOf = (p) =>
  process.env["STAFF_PIN_" + p.id.toUpperCase()] || (p.owner ? process.env.STAFF_PIN : "") || (ON_VERCEL ? "" : "1234");
// La clave que pone el dueño en el panel se guarda resumida (nunca tal cual) y
// manda sobre la de Vercel.
const pinHash = (id, pin) => sha("pin:" + id + ":" + pin);
const pinOk = (p, pin) => (p.pinHash ? same(pinHash(p.id, pin), p.pinHash) : !!pinOf(p) && same(pin, pinOf(p)));
async function startSession(req, res, email) {
  const t = token();
  await cmd("SET", "sess:" + sha(t), email, "EX", YEAR);
  cookie(res, req, SESSION, t, YEAR);
}
// Código para invitar amigos: el nombre en mayúsculas y tres cifras (CARLOS482).
async function makeRefCode(email, name) {
  const base =
    String(name || "")
      .split(" ")[0]
      .normalize("NFD")
      .replace(/[^a-zA-Z]/g, "")
      .toUpperCase()
      .slice(0, 8) || "NOVA";
  for (let i = 0; i < 20; i++) {
    const code = base + crypto.randomInt(100, 1000);
    if ((await cmd("SET", "refcode:" + code, email, "NX")) === "OK") return code;
  }
  const code = "NOVA" + crypto.randomBytes(3).toString("hex").toUpperCase();
  await cmd("SET", "refcode:" + code, email);
  return code;
}
async function ensureUser(email, name, phone, extra = {}) {
  let u = await getJSON("user:" + email);
  if (!u) {
    const no = await cmd("INCR", "seq:member");
    u = { email, name: name || "", phone: phone || "", no, created: T.nowLocal().stamp, ...extra };
    u.ref = await makeRefCode(email, name);
    await setJSON("user:" + email, u);
    await cmd("SADD", "users", email);
  } else if ((name && !u.name) || (phone && !u.phone) || !u.ref) {
    u = { ...u, name: u.name || name, phone: u.phone || phone };
    if (!u.ref) u.ref = await makeRefCode(email, u.name);
    await setJSON("user:" + email, u);
  }
  return u;
}
// De la tarjeta solo se enseña la marca, los 4 últimos números y la caducidad.
const publicCard = (c) => (c ? { brand: c.brand, last4: c.last4, exp: c.exp } : null);
const publicUser = (u) =>
  u && { email: u.email, name: u.name, phone: u.phone, no: u.no, photo: u.photo || "", ref: u.ref || "", since: u.created, card: publicCard(u.card) };

// Alta de un cliente nuevo desde el móvil: crea la cuenta (con el amigo que le
// invitó, si viene con código) y le deja la sesión abierta.
async function registerNew(req, res, { email, name, phone, ref }) {
  const code = String(ref || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const referrer = code ? await cmd("GET", "refcode:" + code) : null;
  const by = referrer && referrer !== email ? referrer : null;
  const u = await ensureUser(email, name, phone, by ? { referredBy: by } : {});
  if (by) await cmd("SADD", "refs:" + by, email);
  await startSession(req, res, email);
  return u;
}

// ── Club: puntos, liga y medallas ──────────────────────────────────────────
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function longestMonthRun(months) {
  const nums = [...new Set(months)].map((m) => {
    const [y, mo] = m.split("-").map(Number);
    return y * 12 + mo;
  });
  nums.sort((a, b) => a - b);
  let best = 0,
    run = 0;
  nums.forEach((n, i) => {
    run = i && n === nums[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

async function clubOf(u) {
  const now = T.nowLocal();
  const mine = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + u.email));
  const done = mine.filter((b) => b.kind === "booking" && b.status === "confirmed" && isPast(b, now) && b.attendance !== "absent");
  const absences = mine.filter((b) => b.attendance === "absent").length;

  // Amigos: el código se apunta al registrarse, pero los puntos solo llegan
  // cuando el barbero marca su primera cita como «Vino». Pasar la fecha no basta.
  const friendEmails = await cmd("SMEMBERS", "refs:" + u.email);
  const friends = [];
  if (friendEmails.length) {
    const lists = await pipe(friendEmails.map((e) => ["SMEMBERS", "ubk:" + e]));
    const users = await cmd("MGET", ...friendEmails.map((e) => "user:" + e));
    for (let i = 0; i < friendEmails.length; i++) {
      const theirs = await bookingsByIds(lists[i] || []);
      const firstCut = theirs
        .filter((b) => b.kind === "booking" && b.status === "confirmed" && b.attendance === "done")
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
      const fu = users[i] ? JSON.parse(users[i]) : {};
      friends.push({ name: String(fu.name || "Amigo").split(" ")[0], date: firstCut?.date || "", counted: !!firstCut });
    }
  }
  const counted = friends.filter((f) => f.counted);

  // Compras en NOVA Supply que el equipo ha apuntado a su cuenta.
  const purchases = (await bookingsByIds2("sh:", await cmd("SMEMBERS", "ush:" + u.email))).sort((a, b) => b.created.localeCompare(a.created));
  const cutDays = new Set(done.map((b) => b.date));
  const days = [...cutDays].sort();
  const fresh = days.filter((d, i) => i && T.absMin(d, "00:00") - T.absMin(days[i - 1], "00:00") <= 28 * 1440).length;

  const since = String(u.created || now.date).slice(0, 10);
  const metrics = {
    cuts: done.length,
    friends: counted.length,
    early: done.filter((b) => b.start < "11:00").length,
    late: done.filter((b) => b.start >= "19:00").length,
    saturday: done.filter((b) => T.weekday(b.date) === 6).length,
    privado: done.filter((b) => b.service.id === "privado").length,
    perfect: absences ? 0 : done.length,
    streak: longestMonthRun(done.map((b) => b.date.slice(0, 7))),
    fresh,
    barbers: new Set(done.map((b) => b.provider.id)).size,
    items: purchases.reduce((a, p) => a + (p.items || 0), 0),
    look: new Set(purchases.filter((p) => cutDays.has(p.date)).map((p) => p.date)).size,
    profile: u.photo && u.phone ? 1 : 0,
    year: T.absMin(now.date, "00:00") - T.absMin(since, "00:00") >= 365 * 1440 ? 1 : 0,
  };
  const medals = MEDALS.map((m) => ({ id: m.id, progress: Math.min(metrics[m.metric] || 0, m.goal), got: (metrics[m.metric] || 0) >= m.goal }));

  const redemptions = (await bookingsByIds2("rd:", await cmd("SMEMBERS", "urd:" + u.email))).sort((a, b) => b.created.localeCompare(a.created));

  // Movimientos de puntos, del más reciente al más antiguo.
  const moves = [
    ...done.map((b) => ({ when: b.date + " " + b.start, text: b.service.name, pts: pointsOf(b) })),
    ...purchases.map((p) => ({ when: p.created, text: `NOVA Supply · ${p.items} ${p.items === 1 ? "prenda" : "prendas"}`, pts: p.points })),
    ...counted.map((f) => ({ when: f.date + " 23:59", text: `Amigo: ${f.name}`, pts: POINTS.perFriend })),
    ...redemptions.filter((r) => r.status !== "canceled").map((r) => ({ when: r.created, text: `Canje: ${r.reward.name}`, pts: -r.reward.cost })),
    { when: String(u.created || ""), text: "Bienvenida al Club", pts: POINTS.welcome },
  ].sort((a, b) => b.when.localeCompare(a.when));
  const medalBonus = MEDALS.filter((m, i) => medals[i].got).reduce((a, m) => a + m.bonus, 0);
  if (medalBonus) moves.unshift({ when: "", text: "Bonus de medallas", pts: medalBonus });

  const earned =
    POINTS.welcome +
    done.reduce((a, b) => a + pointsOf(b), 0) +
    purchases.reduce((a, p) => a + p.points, 0) +
    counted.length * POINTS.perFriend +
    medalBonus;
  const spent = redemptions.filter((r) => r.status !== "canceled").reduce((a, r) => a + r.reward.cost, 0);
  return { metrics, medals, friends, earned, spent, balance: earned - spent, redemptions, moves: moves.slice(0, 40) };
}
// Puntos de una cita: lo que se cobró en caja (o el precio del servicio) × puntos por euro.
function pointsOf(b) {
  const price = b.pay?.amount ?? b.service.price ?? SERVICES.find((s) => s.id === b.service.id)?.price ?? 15;
  return Math.round(price * POINTS.perEuro);
}
async function bookingsByIds2(prefix, ids) {
  if (!ids.length) return [];
  const raw = await cmd("MGET", ...ids.map((id) => prefix + id));
  return raw.filter(Boolean).map((x) => JSON.parse(x));
}

// ── Fotos de la web y reseñas (editables por el dueño) ────────────────────
// Cada hueco de foto tiene una por defecto (en /assets). Si el dueño sube otra,
// se guarda en `siteimg:<hueco>` y la web la pide a /api/site/<hueco>/photo.
const SITE_SLOTS = [
  { id: "hero", label: "Portada (móvil, en vertical)", where: "Lo primero que se ve en el móvil", def: "/assets/hero-plata.jpg", defRosa: "/assets/hero-rosa.jpg", max: 1400 },
  { id: "hero-wide", label: "Portada (ordenador, en horizontal)", where: "Lo primero que se ve en el ordenador", def: "/assets/hero-plata-wide.jpg", defRosa: "/assets/hero-rosa-wide.jpg", max: 1800 },
  { id: "cabina", label: "En cabina", where: "Galería «Imagen y estilo»", def: "/assets/cabina.jpg", max: 1000 },
  { id: "acabado", label: "El acabado", where: "Galería «Imagen y estilo»", def: "/assets/acabado.jpg", max: 1000 },
  { id: "oficio", label: "El oficio", where: "Galería «Imagen y estilo»", def: "/assets/oficio.jpg", max: 1000 },
  { id: "casa", label: "La casa", where: "Galería «Imagen y estilo»", def: "/assets/casa.jpg", max: 1000 },
  { id: "supply", label: "Ropa: foto grande", where: "Bloque de NOVA Supply y Club", def: "/assets/supply.jpg", max: 1200 },
  { id: "supply-rosa", label: "Ropa: prenda", where: "Bloque de NOVA Supply", def: "/assets/supply-rosa.jpg", max: 1200 },
  { id: "formacion", label: "Formación", where: "Tarjeta «¿Quieres aprender a cortar?»", def: "/assets/oficio.jpg", max: 1000 },
];
// Tema de la web que elige el dueño: «plata» (gris, logo plateado) o «rosa».
const THEMES = ["plata", "rosa"];
const themeOf = (site) => (THEMES.includes(site?.theme) ? site.theme : "plata");
const slotsFor = (theme) => SITE_SLOTS.map(({ defRosa, ...x }) => ({ ...x, def: theme === "rosa" && defRosa ? defRosa : x.def }));
const SITE_PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
// Nota y número de reseñas: se leen de la página de Booksy como mucho cada
// 12 h (Booksy los publica en un bloque de datos estándar). Si algún día falla,
// se queda el último valor bueno; y el dueño puede fijarlos a mano.
async function siteInfo() {
  const site = (await getJSON("site")) || {};
  let r = site.rating || {};
  const stale = !r.at || Date.now() - r.at > 12 * 3600 * 1000;
  if (r.mode !== "manual" && stale && (await cmd("SET", "lock:booksy", "1", "NX", "EX", 600)) === "OK") {
    const got = await readBooksy();
    r = got ? { ...r, ...got, at: Date.now(), ok: true } : { ...r, at: Date.now(), ok: false };
    await setJSON("site", { ...site, rating: r });
  }
  return { photos: site.photos || {}, rating: r, theme: themeOf(site) };
}
async function readBooksy() {
  try {
    const ctl = AbortSignal.timeout(4000);
    const res = await fetch(BUSINESS.rating.url, { signal: ctl, headers: { "User-Agent": "Mozilla/5.0 (compatible; NOVA-reservas)" } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = /"aggregateRating"\s*:\s*\{[^}]*?"ratingValue"\s*:\s*"?([\d.,]+)"?[^}]*?"reviewCount"\s*:\s*"?(\d+)/.exec(html) || /"aggregateRating"\s*:\s*\{[^}]*?"reviewCount"\s*:\s*"?(\d+)"?[^}]*?"ratingValue"\s*:\s*"?([\d.,]+)/.exec(html);
    if (!m) return null;
    const [score, count] = m[0].indexOf("ratingValue") < m[0].indexOf("reviewCount") ? [m[1], m[2]] : [m[2], m[1]];
    const sc = Number(String(score).replace(",", ".")),
      ct = Number(count);
    if (!(sc > 0 && sc <= 5 && ct > 0)) return null;
    return { score: sc, count: ct };
  } catch {
    return null;
  }
}
const ratingOut = (r) => ({
  ...BUSINESS.rating,
  ...(r.score ? { score: r.score.toFixed(1).replace(".", ","), count: r.count } : {}),
});

// ── Equipo y normas (editables por el dueño desde su panel) ───────────────
// El equipo vive en la base de datos. La primera vez se copia el de config.js.
// Se carga al principio de cada petición (ver `handler`), así que provider()
// y TEAM se pueden usar sin await en todo el archivo.
let TEAM = PROVIDERS;
let NORMS = {
  cancelHours: RULES.cancelHours,
  lateFeePct: 100,
  noShowFeePct: 100,
  reminders: true, // correo el día antes de cada cita
  recurring: false, // los clientes pueden reservar citas que se repiten
  recurringMax: 6, // como mucho, cuántas citas de una vez
  lapseDays: 45, // a partir de cuántos días sin venir alguien «se ha perdido»
  winbackAuto: false, // mandarles un correo solo (una vez cada 60 días como mucho)
  winbackText: "Hace tiempo que no te vemos por el estudio. Tu hueco te está esperando: reserva en un minuto desde la app.",
  winbackOffer: "",
  remindSoon: true, // otro correo unas 2 horas antes de la cita
  reviews: false, // pedir reseña por correo después de un corte (hace falta reviewUrl)
  reviewUrl: "",
  dailyClose: true, // cada mañana, el resumen de caja de ayer al dueño
  waitlist: true, // «avísame si se libera» en los días completos
};
const WEEK = [0, 1, 2, 3, 4, 5, 6];
const NORMS0 = NORMS;
async function loadTeam() {
  // Equipo y normas en un solo viaje a la base de datos.
  const [rawTeam, rawNorms] = await cmd("MGET", "team", "norms");
  let t = rawTeam ? JSON.parse(rawTeam) : null;
  if (!Array.isArray(t) || !t.length) {
    t = PROVIDERS.map((p) => ({ ...p, active: true, commission: p.owner ? 0 : (COMMISSION[p.id] ?? 40) }));
    await setJSON("team", t);
  }
  TEAM = t;
  NORMS = { ...NORMS0, ...(rawNorms ? JSON.parse(rawNorms) : {}) };
}
const activeTeam = () => TEAM.filter((p) => p.active !== false);
const publicProvider = ({ hours, pinHash, commission, ...p }) => p;
// Lo que se cobra si no viene o si cancela con menos de `cancelHours` horas.
const feeFor = (b, kind) => cents(((Number(b.service.price) || 0) * (kind === "late" ? NORMS.lateFeePct : NORMS.noShowFeePct)) / 100);
const lateCancel = (b) => T.minutesUntil(b.date, b.start) < NORMS.cancelHours * 60;

// ── Agenda ─────────────────────────────────────────────────────────────────
const service = (id) => SERVICES.find((s) => s.id === id);
const provider = (id) => TEAM.find((p) => p.id === id);
const canDo = (s, p) => (!s.providers?.length || s.providers.includes(p.id)) && (!p.services?.length || p.services.includes(s.id));
const monthOf = (date) => date.slice(0, 7);
// Los cerrojos van siempre por tramos de 15 min, aunque al cliente se le ofrezcan
// horas cada media hora: así siguen chocando las citas que el equipo apunta a y cuarto.
const LOCK_MIN = 15;
const units = (date, startMin, endMin) => {
  const out = [];
  for (let t = startMin; t < endMin; t += LOCK_MIN) out.push(`lock:${date}:${T.toHHMM(t).replace(":", "")}`);
  return out;
};
const lockKeys = (b) => units(b.date, T.toMin(b.start), T.toMin(b.end)).map((k) => k.replace("lock:", `lock:${b.provider.id}:`));

// Ocupación de un barbero en un mes: { fecha: [[desde, hasta], …] } en minutos.
async function busyOf(providerId, month, exceptId) {
  const raw = hgetall(await cmd("HGETALL", `occ:${providerId}:${month}`));
  const busy = {};
  for (const [id, v] of Object.entries(raw)) {
    if (id === exceptId) continue;
    const [date, a, b] = v.split("|");
    (busy[date] ||= []).push([T.toMin(a), T.toMin(b)]);
  }
  return busy;
}

function freeTimes(p, s, date, busy, now, horizon = RULES.daysAhead) {
  const last = T.addDays(now.date, horizon);
  if (date < now.date || date > last) return [];
  const out = [];
  for (const [a, b] of p.hours[T.weekday(date)] || []) {
    for (let t = T.toMin(a); t + s.duration <= T.toMin(b); t += RULES.step) {
      if (date === now.date && t < now.min + RULES.leadMinutes) continue;
      if ((busy[date] || []).some(([x, y]) => t < y && t + s.duration > x)) continue;
      out.push(T.toHHMM(t));
    }
  }
  return out;
}

// ── Apartar, mover y soltar horas ───────────────────────────────────────────
// Cada tramo de 15 min de la cita tiene un cerrojo `lock:<barbero>:<día>:<hora>`
// con el id de la cita. `claim` (store.js) comprueba los tramos, los aparta y
// guarda la cita y sus índices en un solo paso: si dos personas pulsan a la vez
// la misma hora, solo una se la lleva, y si la función se corta no queda nada
// a medias. El cerrojo dura hasta una semana después de la cita.
const lockTtl = (b) => Math.max(86400, T.minutesUntil(b.date, b.end) * 60 + 7 * 86400);
const indexWrites = (b) => [
  ["SET", "bk:" + b.id, JSON.stringify(b)],
  ["HSET", `occ:${b.provider.id}:${monthOf(b.date)}`, b.id, `${b.date}|${b.start}|${b.end}`],
  ["SADD", "day:" + b.date, b.id],
  ...(b.email ? [["SADD", "ubk:" + b.email, b.id]] : []),
];
async function place(b, { before = [], release = [] } = {}) {
  const keys = lockKeys(b);
  for (let round = 0; round < 3; round++) {
    const r = await claim(keys, b.id, lockTtl(b), [...before, ...indexWrites(b)], release);
    if (r === true) return;
    // El tramo es de otra cita. Si esa cita ya no lo ocupa (restos de un fallo
    // de antes de existir `claim`), se suelta y se vuelve a intentar.
    const o = await getJSON("bk:" + r);
    if (o && o.status === "confirmed" && lockKeys(o).some((k) => keys.includes(k))) break;
    await claim([], r, 1, [], keys);
  }
  fail(409, "Esa hora se acaba de ocupar. Elige otra, por favor.", { taken: true });
}
// Cambia una cita de hora (y de día) de una vez: aparta lo nuevo y suelta lo viejo.
async function moveTo(b, moved) {
  const fresh = lockKeys(moved);
  const before = [];
  if (b.date !== moved.date) before.push(["SREM", "day:" + b.date, b.id]);
  if (monthOf(b.date) !== monthOf(moved.date) || b.provider.id !== moved.provider.id) before.push(["HDEL", `occ:${b.provider.id}:${monthOf(b.date)}`, b.id]);
  await place(moved, { before, release: lockKeys(b).filter((k) => !fresh.includes(k)) });
}
// Guarda la cita ya cancelada y suelta su hora, de una vez.
const unplace = (b, done) =>
  claim([], b.id, 1, [
    ["SET", "bk:" + b.id, JSON.stringify(done)],
    ["HDEL", `occ:${b.provider.id}:${monthOf(b.date)}`, b.id],
  ], lockKeys(b));

// Muchas citas a la vez: bloques de 300 y hasta 10 bloques por viaje.
async function bookingsByIds(ids) {
  const out = [],
    chunks = [];
  for (let i = 0; i < ids.length; i += 300) chunks.push(["MGET", ...ids.slice(i, i + 300).map((id) => "bk:" + id)]);
  for (let i = 0; i < chunks.length; i += 10)
    for (const raw of await pipe(chunks.slice(i, i + 10))) out.push(...raw.filter(Boolean).map((x) => JSON.parse(x)));
  return out;
}
const isPast = (b, now) => b.date + " " + b.start < now.stamp;
const isActive = (b, now) => b.status === "confirmed" && !isPast(b, now);

function makeBooking(s, p, date, start, extra) {
  return {
    id: newId(),
    kind: "booking",
    service: { id: s.id, name: s.name, price: s.price, duration: s.duration },
    provider: { id: p.id, name: p.name },
    date,
    start,
    end: T.toHHMM(T.toMin(start) + s.duration),
    status: "confirmed",
    attendance: "unmarked",
    created: T.nowLocal().stamp,
    ...extra,
  };
}

// Para meter texto escrito por clientes dentro del HTML de un correo.
const htmlEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Ajustes de cada barbero: correo de avisos y enlace de su calendario.
const staffCfg = async (id) => (await getJSON("staffcfg:" + id)) || {};
async function notifySalon(b, title) {
  const salon = process.env.AVISO_CORREO || BUSINESS.email;
  const cfg = b.provider?.id ? await staffCfg(b.provider.id) : {};
  const list = [...new Set([salon, cfg.notify !== false && cfg.email].filter(Boolean).map((x) => x.toLowerCase()))];
  await Promise.all(list.map((to) => notifyOne(to, b, title)));
}
async function notifyOne(to, b, title) {
  await send(
    to,
    `${title}: ${b.service.name} · ${T.niceDate(b.date)} ${b.start}`,
    title,
    bookingLines(b, T.niceDate(b.date)) +
      `<hr style="border:0;border-top:1px solid #dcdad3;margin:14px 0">
       <p style="margin:0">${htmlEsc(b.name)}${b.phone ? " · " + htmlEsc(b.phone) : ""}${b.email ? " · " + htmlEsc(b.email) : ""}</p>`,
    b.email || undefined,
  );
}

const hostOf = (req) => process.env.PUBLIC_HOST || req.headers.host || "";
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ── Reservar (cliente) ─────────────────────────────────────────────────────
// Con barbero elegido o «sin preferencia» (provider = "any"): entonces se le da
// al que tenga esa hora libre y menos trabajo ese día.
async function bookNow(req, res, body) {
  const s = service(body.service);
  if (!s || s.consult) fail(400, "Ese servicio no se reserva por aquí.");
  const anyone = body.provider === "any",
    fixed = anyone ? null : provider(body.provider);
  if (!anyone && (!fixed || fixed.active === false || !canDo(s, fixed))) fail(400, "Ese barbero no hace este servicio.");
  if (!T.isDate(body.date) || !T.isTime(body.start)) fail(400, "Elige día y hora.");
  const user = await currentUser(req);
  const email = user ? user.email : normEmail(body.email);
  // Con la sesión iniciada no hace falta mandar nada: se usan los datos del perfil.
  // El teléfono es opcional (se pide después, para completar el perfil).
  const name = clean(body.name) || clean(user?.name),
    phone = clean(body.phone, 30) || clean(user?.phone, 30);
  if (!name) fail(400, "Falta tu nombre.");
  if (!EMAIL.test(email)) fail(400, "Revisa tu correo.");
  if (phone && !PHONE.test(phone)) fail(400, "Revisa tu teléfono.");
  if (body.terms !== true) fail(400, "Tienes que aceptar las condiciones.");
  // Con Stripe activado, toda cita online queda garantizada con una tarjeta.
  if (Card.cardEnabled() && !user?.card) fail(402, "Añade una tarjeta para garantizar la cita.", { card: true });
  await limit("book:" + ip(req), 12, 3600);
  // Una reserva a la vez por persona: dos pestañas pulsando a la vez no se saltan el máximo de citas.
  if ((await cmd("SET", "booking:" + email, "1", "NX", "EX", 20)) !== "OK") fail(429, "Ya estamos guardando otra reserva tuya. Un momento…");
  try {
    const now = T.nowLocal();
    const mine = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + email));
    if (mine.filter((b) => isActive(b, now) && !b.series).length >= RULES.maxActive)
      fail(400, `Ya tienes ${RULES.maxActive} citas pendientes. Cuando pase alguna podrás reservar otra.`);

    const cands = [];
    for (const p of anyone ? shuffle(activeTeam().filter((p) => canDo(s, p))) : [fixed]) {
      const busy = await busyOf(p.id, monthOf(body.date));
      if (freeTimes(p, s, body.date, busy, now).includes(body.start)) cands.push({ p, load: (busy[body.date] || []).reduce((a, [x, y]) => a + y - x, 0) });
    }
    cands.sort((a, b) => a.load - b.load);
    const extra = {
      email,
      name,
      phone,
      by: "client",
      ...(anyone ? { anyBarber: true } : {}),
      ...(user?.card ? { guarantee: { brand: user.card.brand, last4: user.card.last4, at: now.stamp } } : {}),
    };
    let b = null;
    for (const { p } of cands) {
      const x = makeBooking(s, p, body.date, body.start, extra);
      try {
        await place(x);
        b = x;
        break;
      } catch (e) {
        if (e.status !== 409) throw e;
      }
    }
    if (!b) fail(409, "Esa hora ya no está libre. Mira estas otras:", { alternatives: await alternativesFor(s, fixed, body.date, body.start) });
    const p = provider(b.provider.id);
    // Cita que se repite (si el dueño lo permite): cada 1-4 semanas, hasta recurringMax veces.
    let series = null;
    if (body.repeat && NORMS.recurring) series = await makeSeries(b, s, p, body.repeat, NORMS.recurringMax, { email, name, phone, by: "client", ...(b.guarantee ? { guarantee: b.guarantee } : {}) });

    // Cuenta: si el correo es nuevo, se crea y se queda dentro en este móvil.
    // Si ya existía, la cita se guarda igual pero para verla hay que entrar con código.
    let session = !!user,
      existing = false,
      fresh = null;
    if (user) await ensureUser(email, name, phone);
    else if (await getJSON("user:" + email)) existing = true;
    else {
      await registerNew(req, res, { email, name, phone, ref: body.ref }); // ¿viene invitado? lo apunta
      session = true;
      fresh = email;
    }
    await cmd("HDEL", "wl:" + b.date, email); // ya tiene hora ese día: fuera de la lista de espera

    await Promise.all([
      send(
        email,
        `Cita reservada · ${T.niceDate(b.date)} ${b.start}`,
        "Tu cita está reservada",
        bookingLines(b, T.niceDate(b.date)) +
          `<p style="margin:14px 0 0;color:#64645e;font-size:13px">Puedes cambiarla o cancelarla desde la app hasta ${NORMS.cancelHours} h antes. Referencia ${b.id}.</p>`,
      ),
      notifySalon(b, "Nueva cita"),
    ]);
    return { out: { id: b.id, session, existing, series, provider: { id: b.provider.id, name: b.provider.name } }, session: fresh };
  } finally {
    await cmd("DEL", "booking:" + email);
  }
}

// Cuando la hora elegida ya no está: la misma hora con otro barbero y las horas
// más cercanas con el mismo (ese día primero y luego los siguientes).
async function alternativesFor(s, fixed, date, start) {
  const now = T.nowLocal(),
    want = T.toMin(start),
    team = activeTeam().filter((p) => canDo(s, p)),
    memo = {},
    out = [];
  const busyFor = async (p, d) => (memo[p.id + monthOf(d)] ||= await busyOf(p.id, monthOf(d)));
  const who = (p) => ({ id: p.id, name: p.name });
  if (fixed)
    for (const p of team)
      if (p.id !== fixed.id && freeTimes(p, s, date, await busyFor(p, date), now).includes(start)) out.push({ provider: who(p), date, start });
  const pool = fixed ? [fixed] : team;
  for (let i = 0; i < 8 && out.length < 4; i++) {
    const d = T.addDays(date, i),
      seen = new Set();
    for (const p of pool) for (const t of freeTimes(p, s, d, await busyFor(p, d), now)) seen.add(t);
    const times = [...seen].sort((a, b) => (i ? a.localeCompare(b) : Math.abs(T.toMin(a) - want) - Math.abs(T.toMin(b) - want)));
    for (const t of times.slice(0, 4 - out.length)) out.push({ provider: fixed ? who(fixed) : null, date: d, start: t });
  }
  return out;
}

// Alguien ha dejado una hora libre: se avisa por correo a quien pidió aviso para
// ese día, si ahora cabe su servicio. Como mucho un correo cada 3 h por persona y
// día; se la lleva quien reserve primero.
async function waitlistPing(date, host) {
  if (!NORMS.waitlist || !mailReady()) return;
  try {
    const entries = Object.entries(hgetall(await cmd("HGETALL", "wl:" + date)));
    if (!entries.length) return;
    const now = T.nowLocal(),
      memo = {};
    for (const [email, v] of entries) {
      const w = JSON.parse(v),
        s = service(w.service);
      if (!s) continue;
      const times = new Set();
      for (const p of activeTeam().filter((p) => canDo(s, p) && (w.provider === "any" || p.id === w.provider)))
        for (const t of freeTimes(p, s, date, (memo[p.id] ||= await busyOf(p.id, monthOf(date))), now)) times.add(t);
      if (!times.size || (await cmd("SET", `wlsent:${date}:${email}`, "1", "NX", "EX", 3 * 3600)) !== "OK") continue;
      const link = host ? `https://${host}/#hueco/${s.id}/${w.provider}/${date}` : "";
      await send(
        email,
        `Se ha liberado una hora · ${T.niceDate(date)}`,
        "Se ha liberado una hora",
        `<p style="margin:0 0 10px">Pediste que te avisáramos si quedaba un hueco para <b>${htmlEsc(s.name)}</b> el <b>${htmlEsc(T.niceDate(date))}</b>.</p>
         <p style="margin:0 0 14px">Ahora hay: <b>${[...times].sort().slice(0, 6).join(" · ")}</b></p>
         ${link ? `<p style="margin:0 0 12px"><a href="${link}" style="display:inline-block;background:#171717;color:#fff;padding:12px 18px;text-decoration:none">Reservar ahora</a></p>` : ""}
         <p style="margin:0;color:#64645e;font-size:13px">Se la lleva quien reserve primero.</p>`,
      );
    }
  } catch (e) {
    console.error("Lista de espera", e);
  }
}

// ── Citas que se repiten ───────────────────────────────────────────────────
// A partir de una cita ya guardada, reserva las siguientes cada `every` semanas
// a la misma hora y con el mismo barbero. Las fechas que no estén libres se
// saltan y se avisa. Todas comparten `series` para poder cancelarlas juntas.
async function makeSeries(first, s, p, repeat, maxTimes, extra, staffMade = false) {
  const every = Math.round(Number(repeat?.every)),
    times = Math.round(Number(repeat?.times));
  if (!(every >= 1 && every <= 4) || !(times >= 2)) return null;
  const n = Math.min(times, maxTimes);
  const id = "S" + crypto.randomBytes(4).toString("hex").toUpperCase();
  const now = T.nowLocal();
  const made = [first.id],
    skipped = [];
  await setJSON("bk:" + first.id, { ...first, series: id });
  for (let i = 1; i < n; i++) {
    const date = T.addDays(first.date, 7 * every * i);
    const busy = await busyOf(p.id, monthOf(date));
    let ok;
    if (staffMade) {
      const [x, y] = [T.toMin(first.start), T.toMin(first.start) + s.duration];
      ok = (p.hours?.[T.weekday(date)] || []).length > 0 && !(busy[date] || []).some(([a, b]) => x < b && y > a);
    } else ok = freeTimes(p, s, date, busy, now, 7 * every * n + 7).includes(first.start);
    if (!ok) {
      skipped.push(date);
      continue;
    }
    const b = makeBooking(s, p, date, first.start, { ...extra, series: id });
    try {
      await place(b);
      made.push(b.id);
    } catch {
      skipped.push(date);
    }
  }
  await cmd("SADD", "series:" + id, ...made);
  const dates = (await bookingsByIds(made)).map((b) => b.date).sort();
  return { id, every, made: made.length, dates, skipped };
}

// ── Lo que suele pedir cada cliente ─────────────────────────────────────────
// Sin IA: se miran sus últimos cortes hechos y se saca el día de la semana,
// la hora, el barbero y el servicio que más repite, y cada cuánto viene.
const mode = (arr) => {
  const c = {};
  let best = null;
  for (const x of arr) if ((c[x] = (c[x] || 0) + 1) > (c[best] || 0)) best = x;
  return best;
};
const daysBetween = (a, b) => Math.round((Date.UTC(...b.split("-").map((n, i) => (i === 1 ? n - 1 : +n))) - Date.UTC(...a.split("-").map((n, i) => (i === 1 ? n - 1 : +n)))) / 86400000);
function habitOf(list, now) {
  const done = list
    .filter((b) => b.kind === "booking" && b.status === "confirmed" && b.attendance !== "absent" && isPast(b, now))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  if (!done.length) return null;
  const last = done[done.length - 1];
  const recent = done.slice(-8);
  const weekday = Number(mode(recent.map((b) => T.weekday(b.date))));
  const sameDay = recent.filter((b) => T.weekday(b.date) === weekday);
  const gaps = [];
  for (let i = 1; i < done.length; i++) gaps.push(daysBetween(done[i - 1].date, done[i].date));
  const g = gaps.slice(-6).sort((a, b) => a - b);
  let every = g.length ? g[Math.floor(g.length / 2)] : null;
  if (every && Math.abs(every - Math.round(every / 7) * 7) <= 2 && every >= 5) every = Math.round(every / 7) * 7; // «cada 2 semanas»
  const since = daysBetween(last.date, now.date);
  return {
    visits: done.length,
    weekday,
    sameDay: sameDay.length,
    start: mode(sameDay.map((b) => b.start)),
    provider: mode(recent.map((b) => b.provider.id)),
    service: mode(recent.map((b) => b.service.id)),
    every, // días entre cortes (null si solo ha venido una vez)
    last: last.date,
    since,
    due: every ? since >= every : false,
  };
}

// ── Clientes que han dejado de venir ───────────────────────────────────────
// Para cada socio: cuándo vino por última vez, cada cuánto suele venir y si
// tiene cita. «Perdido» = sin cita y más días sin venir que lapseDays (o que
// el doble de lo que suele tardar, si es más).
async function allClients() {
  let emails = await cmd("SMEMBERS", "users");
  if (!(await cmd("GET", "usersidx"))) {
    // Una vez: los socios de antes de existir el índice.
    const old = (await scanKeys("user:*")).map((k) => k.slice(5));
    if (old.length) await cmd("SADD", "users", ...old);
    await cmd("SET", "usersidx", "1");
    emails = [...new Set([...emails, ...old])];
  }
  if (!emails.length) return [];
  const now = T.nowLocal();
  const [users, sets, contacts, optout] = await Promise.all([
    cmd("MGET", ...emails.map((e) => "user:" + e)),
    pipe(emails.map((e) => ["SMEMBERS", "ubk:" + e])),
    cmd("MGET", ...emails.map((e) => "winback:" + e)),
    cmd("MGET", ...emails.map((e) => "nomkt:" + e)),
  ]);
  const all = await bookingsByIds([...new Set(sets.flat())]);
  const byEmail = {};
  for (const b of all) (byEmail[b.email] ||= []).push(b);
  return emails
    .map((e, i) => {
      const u = users[i] ? JSON.parse(users[i]) : { email: e };
      const list = byEmail[e] || [];
      const h = habitOf(list, now);
      const next = list.filter((b) => isActive(b, now)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
      const limit = Math.max(NORMS.lapseDays, h?.every ? h.every * 2 : 0);
      const status = !h ? "nuevo" : next ? "con-cita" : h.since > limit ? "perdido" : h.due ? "le-toca" : "al-dia";
      return {
        email: e,
        name: u.name || "",
        phone: u.phone || "",
        visits: h?.visits || 0,
        last: h?.last || "",
        since: h?.since ?? null,
        every: h?.every || null,
        habit: h && { weekday: h.weekday, start: h.start, provider: h.provider, service: h.service },
        next: next ? { date: next.date, start: next.start } : null,
        status,
        contacted: contacts[i] ? JSON.parse(contacts[i]) : null,
        optout: !!optout[i],
      };
    })
    .filter((c) => c.visits || c.next);
}
// ── Tareas automáticas ─────────────────────────────────────────────────────
// Cada hora (de 9:00 a 21:00 en Canarias): recordatorio de las citas de dentro
// de 1 a 3 horas y petición de reseña de los cortes acabados hace más de una
// hora. Una vez al día, en la primera pasada desde las 9:00: recordatorio de
// mañana, resumen de caja de ayer al dueño, clientes perdidos y, los lunes,
// copia de seguridad. Cada correo se marca con SET NX ANTES de mandarlo y la
// cita no se reescribe: si un cliente cancela mientras tanto, su cancelación
// no se pisa, y aunque dos pasadas coincidan nadie recibe dos correos.
const ownerMail = async () => {
  const owner = TEAM.find((p) => p.owner);
  return owner?.email || (owner && (await staffCfg(owner.id)).email) || BUSINESS.email;
};
async function cronTick(req) {
  const secret = process.env.CRON_SECRET;
  if (ON_VERCEL && (!secret || !same(String(req.headers.authorization || ""), "Bearer " + secret))) fail(401, "No.");
  if ((await cmd("SET", "lock:cron", "1", "NX", "EX", 900)) !== "OK") return { skipped: "ya en marcha" };
  const now = T.nowLocal(),
    host = hostOf(req);
  const out = { at: now.stamp, soon: 0, reviews: 0, reminders: 0, winback: 0, close: false, backup: false, mail: mailReady() };
  const once = async (key, seconds) => (await cmd("SET", key, "1", "NX", "EX", seconds)) === "OK";
  const changeLink = (b) =>
    host ? `<a href="https://${host}/#booking/${b.id}">Cámbiala o cancélala desde la app</a>` : "Cámbiala o cancélala desde la app";
  try {
    if (!mailReady()) return out;
    const daytime = now.min >= 9 * 60 && now.min < 21 * 60;
    const todays = daytime ? await bookingsByIds(await cmd("SMEMBERS", "day:" + now.date)) : [];
    const live = (b) => b.kind === "booking" && b.status === "confirmed" && b.email;

    // 1) Hoy, de 1 a 3 horas antes. No a quien reservó hace menos de 6 horas.
    if (NORMS.remindSoon)
      for (const b of todays) {
        const left = T.minutesUntil(b.date, b.start);
        if (!live(b) || left < 60 || left > 180) continue;
        const [cd, ct] = String(b.created || "").split(" ");
        if (T.isDate(cd) && T.isTime(ct) && T.minutesUntil(cd, ct) > -360) continue;
        if (!(await once("soon:" + b.id, 2 * 86400))) continue;
        const ok = await send(
          b.email,
          `Hoy a las ${b.start} con ${b.provider.name.split(" ")[0]}`,
          "Te esperamos hoy",
          bookingLines(b, "Hoy") +
            `<p style="margin:14px 0 0">${htmlEsc(BUSINESS.street)} · ${htmlEsc(BUSINESS.city)}</p>
             <p style="margin:14px 0 0;color:#64645e;font-size:13px">¿Te ha surgido algo? ${changeLink(b)} cuanto antes, para que otro pueda aprovechar el hueco.</p>`,
        );
        if (ok) out.soon++;
      }

    // 2) Reseña: cortes hechos (marcados «Vino» o cobrados en caja) que acabaron
    //    hace más de una hora. Una petición cada 6 meses por persona como mucho.
    if (NORMS.reviews && NORMS.reviewUrl && daytime) {
      const yesterday = await bookingsByIds(await cmd("SMEMBERS", "day:" + T.addDays(now.date, -1)));
      for (const b of [...yesterday, ...todays]) {
        if (!live(b) || b.attendance !== "done" || T.minutesUntil(b.date, b.end) > -60) continue;
        if (await cmd("GET", "nomkt:" + b.email)) continue;
        if (!(await once("revask:" + b.id, 7 * 86400)) || !(await once("revmail:" + b.email, 180 * 86400))) continue;
        const ok = await send(
          b.email,
          `¿Qué tal tu ${b.service.name.toLowerCase()}?`,
          `Gracias por venir${b.name ? ", " + String(b.name).split(" ")[0] : ""}`,
          `<p style="margin:0 0 12px">Esperamos que ${htmlEsc(b.provider.name.split(" ")[0])} te haya dejado como querías.</p>
           <p style="margin:0 0 14px">Si te ha gustado, nos ayudas muchísimo contándolo. Es un minuto:</p>
           <p style="margin:0 0 12px"><a href="${htmlEsc(NORMS.reviewUrl)}" style="display:inline-block;background:#171717;color:#fff;padding:12px 18px;text-decoration:none">Dejar mi reseña</a></p>
           <p style="margin:0;color:#64645e;font-size:13px">Y si algo no fue bien, responde a este correo: lo lee el equipo.</p>`,
          await ownerMail(),
        );
        if (ok) out.reviews++;
      }
    }

    // 3) Una vez al día, desde las 9:00.
    if (now.min >= 9 * 60 && (await once("cronday:" + now.date, 2 * 86400))) {
      // a) Recordatorio de las citas de mañana.
      if (NORMS.reminders) {
        const tomorrow = T.addDays(now.date, 1);
        for (const b of await bookingsByIds(await cmd("SMEMBERS", "day:" + tomorrow))) {
          if (b.date !== tomorrow || !live(b) || b.reminded || !(await once("reminded:" + b.id, 3 * 86400))) continue;
          const ok = await send(
            b.email,
            `Mañana tienes cita · ${b.start} con ${b.provider.name.split(" ")[0]}`,
            "Te esperamos mañana",
            bookingLines(b, T.niceDate(b.date)) +
              `<p style="margin:14px 0 0">${htmlEsc(BUSINESS.street)} · ${htmlEsc(BUSINESS.city)}</p>
               <p style="margin:14px 0 0;color:#64645e;font-size:13px">¿No puedes venir? ${changeLink(b)} y deja el hueco libre para otro.</p>`,
          );
          if (ok) out.reminders++;
        }
      }
      // b) Resumen de caja de ayer al dueño.
      if (NORMS.dailyClose) {
        const date = T.addDays(now.date, -1),
          html = await closeOf(date);
        if (html) out.close = await send(await ownerMail(), `Caja de ayer · ${T.niceDate(date)}`, "Resumen de ayer", html);
      }
      // c) Clientes que se han perdido (como mucho 15 correos al día, y 1 cada 60 días por persona).
      if (NORMS.winbackAuto) {
        for (const c of (await allClients()).filter((x) => x.status === "perdido" && !x.optout)) {
          if (out.winback >= 15) break;
          if (c.contacted && daysBetween(c.contacted.at.slice(0, 10), now.date) < 60) continue;
          if (await winbackMail(c, host)) {
            await setJSON("winback:" + c.email, { at: now.stamp, by: "auto", channel: "email" });
            out.winback++;
          }
        }
      }
      // d) Los lunes, copia de seguridad (sin fotos) al correo del dueño.
      if (T.weekday(now.date) === 1) {
        const data = await backup("data");
        out.backup = await send(
          await ownerMail(),
          `Copia de seguridad · ${now.date}`,
          "Copia de seguridad semanal",
          `<p style="margin:0">Adjunta va la copia de los datos de la app (${data.count} registros). Guárdala: con ella se puede recuperar todo desde el panel, en «Equipo y normas».</p>`,
          undefined,
          [{ filename: `nova-copia-${now.date}.json`, content: Buffer.from(JSON.stringify(data)).toString("base64") }],
        );
      }
    }
    return out;
  } catch (e) {
    out.error = String(e.message || e);
    throw e;
  } finally {
    await setJSON("cronlast", out).catch(() => {});
    await cmd("DEL", "lock:cron").catch(() => {});
  }
}

// Lo que el dueño tiene que saber al abrir la agenda: si los correos no salen
// o si las tareas automáticas llevan horas sin pasar.
async function ownerAlerts() {
  const out = [];
  if (!mailReady()) out.push("Los correos no salen: falta RESEND_API_KEY en Vercel. No se mandan recordatorios, avisos ni resúmenes.");
  if (ON_VERCEL && !process.env.CRON_SECRET) out.push("Falta CRON_SECRET en Vercel: las tareas automáticas (recordatorios, reseñas, caja) no se ejecutan.");
  else if (ON_VERCEL) {
    const last = await getJSON("cronlast");
    const [d, t] = String(last?.at || "").split(" ");
    if (!last || !T.isDate(d) || T.minutesUntil(d, t) < -180) out.push(`Las tareas automáticas no pasan desde ${last?.at || "nunca"}. Revisa los Cron Jobs del proyecto en Vercel.`);
    else if (last.error) out.push("La última pasada automática falló: " + last.error);
  }
  return out;
}

// Resumen de un día para el dueño: lo cobrado (total, por forma de pago y por
// barbero) y lo que hay que revisar: citas sin cobrar, faltas y cancelaciones.
async function closeOf(date) {
  const [payIds, bookIds] = await pipe([
    ["SMEMBERS", "payday:" + date],
    ["SMEMBERS", "day:" + date],
  ]);
  const [pays, books] = await Promise.all([bookingsByIds2("pay:", payIds), bookingsByIds(bookIds)]);
  const bk = books.filter((b) => b.date === date && b.kind === "booking");
  if (!pays.length && !bk.length) return null;
  const sum = (l) => cents(l.reduce((a, x) => a + x.amount, 0));
  const eur = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const conf = bk.filter((b) => b.status === "confirmed");
  const unpaid = conf.filter((b) => b.attendance !== "absent" && !b.pay);
  const absent = conf.filter((b) => b.attendance === "absent");
  const row = (a, b) => `<tr><td style="padding:4px 0">${a}</td><td style="padding:4px 0;text-align:right">${b}</td></tr>`;
  const methods = PAY_METHODS.map((m) => [m.name || m.label || m.id, sum(pays.filter((x) => x.method === m.id))]).filter(([, t]) => t);
  const people = TEAM.map((p) => {
    const l = pays.filter((x) => x.provider.id === p.id),
      c = conf.filter((b) => b.provider.id === p.id);
    return { name: p.name, total: sum(l), n: l.length, citas: c.length };
  }).filter((p) => p.n || p.citas);
  return `<p style="margin:0 0 4px;font-size:13px;color:#64645e">${htmlEsc(T.niceDate(date))}</p>
    <p style="margin:0 0 14px;font-size:28px;font-weight:700">${eur(sum(pays))}<span style="font-size:14px;font-weight:400;color:#64645e"> · ${pays.length} cobros</span></p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${methods.map(([n, t]) => row(htmlEsc(n), eur(t))).join("")}</table>
    <hr style="border:0;border-top:1px solid #dcdad3;margin:14px 0">
    <table style="width:100%;border-collapse:collapse;font-size:14px">${people.map((p) => row(`${htmlEsc(p.name)} <span style="color:#64645e">(${p.citas} citas)</span>`, eur(p.total))).join("")}</table>
    <hr style="border:0;border-top:1px solid #dcdad3;margin:14px 0">
    <p style="margin:0 0 6px"><b>${unpaid.length ? `${unpaid.length} citas sin cobro apuntado` : "Todas las citas tienen su cobro"}</b></p>
    ${unpaid.length ? `<p style="margin:0 0 10px;font-size:13px;color:#64645e">${unpaid.map((b) => `${b.start} ${htmlEsc(b.name || "")} (${htmlEsc(b.provider.name.split(" ")[0])})`).join(" · ")}</p>` : ""}
    <p style="margin:0;font-size:13px;color:#64645e">No vinieron: ${absent.length} · Canceladas: ${bk.length - conf.length} (${bk.filter((b) => b.late).length} tarde)</p>`;
}

// Enlace para darse de baja de los correos de «te echamos de menos».
async function unsubToken(email) {
  let k = await cmd("GET", "secret:unsub");
  if (!k) {
    await cmd("SET", "secret:unsub", token(), "NX");
    k = await cmd("GET", "secret:unsub");
  }
  return sha(k + ":" + email).slice(0, 24);
}
async function winbackMail(c, host) {
  if (c.optout || !c.email) return false;
  const t = await unsubToken(c.email);
  const base = host ? `https://${host}` : "";
  const off = NORMS.winbackOffer ? `<p style="margin:0 0 12px;padding:12px;border:1px solid #dcdad3;background:#f5f4f0"><b>${htmlEsc(NORMS.winbackOffer)}</b></p>` : "";
  return send(
    c.email,
    `${c.name ? c.name.split(" ")[0] + ", t" : "T"}e echamos de menos en ${BUSINESS.short}`,
    "Te echamos de menos",
    `<p style="margin:0 0 12px">${c.name ? "Hola " + htmlEsc(c.name.split(" ")[0]) + ": " : ""}${htmlEsc(NORMS.winbackText)}</p>${off}
     ${base ? `<p style="margin:0 0 12px"><a href="${base}/#home" style="display:inline-block;background:#171717;color:#fff;padding:12px 18px;text-decoration:none">Reservar cita</a></p>` : ""}
     <p style="margin:12px 0 0;color:#64645e;font-size:12px">¿No quieres más correos así? ${base ? `<a href="${base}/api/unsub/${encodeURIComponent(c.email)}/${t}">Darte de baja</a>` : "Respóndenos y te quitamos."}</p>`,
  );
}

// ── Copias de seguridad ────────────────────────────────────────────────────
// Todo lo que hay en la base de esta app, en un JSON que se puede guardar y
// volver a cargar. Se dejan fuera sesiones, códigos y cerrojos (caducan solos
// y no hacen falta). Las fotos van en un archivo aparte porque pesan mucho.
const SKIP = /^(sess:|staffsess:|rl:|code:|lock:|chargelock:|rdlock:|secret:|idem:|booking:|soon:|reminded:|revask:|wlsent:|cronday:)/;
const PHOTOKEY = /^(siteimg:|prodimg:|teamimg:)/;
async function backup(part) {
  const keys = (await scanKeys("*")).filter((k) => !SKIP.test(k) && (part === "photos" ? PHOTOKEY.test(k) : !PHOTOKEY.test(k)));
  const data = await dumpKeys(keys.sort());
  return { app: "nova-reservas", part, version: 1, created: T.nowLocal().stamp, count: data.length, data };
}

// ── Rutas ──────────────────────────────────────────────────────────────────
const routes = {
  "GET catalog": async ({ res }) => {
    // Es igual para todos: el CDN de Vercel lo guarda 30 s y lo sirve sin
    // despertar la función (y sin tocar la base de datos). El panel, tras
    // cambiar algo, lo pide con ?t=… para saltarse esa copia.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=300");
    const c = publicCatalog();
    const site = await siteInfo();
    return {
      ...c,
      business: { ...c.business, rating: ratingOut(site.rating) },
      site: { photos: site.photos, theme: site.theme },
      providers: activeTeam().map(publicProvider),
      rules: { ...c.rules, cancelHours: NORMS.cancelHours, lateFeePct: NORMS.lateFeePct, noShowFeePct: NORMS.noShowFeePct, recurring: NORMS.recurring, recurringMax: NORMS.recurringMax },
      card: Card.cardPublic(),
    };
  },

  // Se pide cada vez que se abre la app: va en tres viajes a la base de datos
  // (sesiones, cuenta y renovar), no en ocho.
  "GET me": async ({ req, res }) => {
    const ck = cookies(req);
    const [email, staffId] = await cmd("MGET", "sess:" + sha(ck[SESSION] || "-"), "staffsess:" + sha(ck[STAFF] || "-"));
    const st = staffById(staffId, true);
    const team = activeTeam();
    const [rawUser, ...cfgs] = await cmd("MGET", email ? "user:" + email : "-", ...team.map((p) => "staffcfg:" + p.id));
    let u = rawUser ? JSON.parse(rawUser) : null;
    if (u && !u.ref) u = await ensureUser(u.email);
    // Cada vez que se abre la app, la sesión vuelve a valer un año: quien viene
    // una vez al mes no tiene que volver a entrar nunca en ese móvil.
    const renew = [];
    if (u) {
      renew.push(["EXPIRE", "sess:" + sha(ck[SESSION]), YEAR]);
      cookie(res, req, SESSION, ck[SESSION], YEAR);
    }
    if (st) {
      renew.push(["EXPIRE", "staffsess:" + sha(ck[STAFF]), YEAR]);
      cookie(res, req, STAFF, ck[STAFF], YEAR);
    }
    if (renew.length) await pipe(renew);
    // Si el correo de esta cuenta es el de alguien del equipo, se le ofrece su panel
    // (la clave se pide una vez y luego la sesión dura un año).
    let staffHint = null;
    if (u && !st) {
      const found = team.find((p, i) => (p.email && p.email === u.email) || (cfgs[i] && JSON.parse(cfgs[i]).email === u.email));
      if (found) staffHint = { id: found.id, name: found.name };
    }
    return { user: publicUser(u), staff: st, staffHint, mail: mailReady(), loginCode: LOGIN_CON_CODIGO };
  },

  "GET referral/:code": async ({ params }) => {
    const code = String(params.code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const email = code && (await cmd("GET", "refcode:" + code));
    if (!email) fail(404, "Ese código no existe.");
    const u = await getJSON("user:" + email);
    return { name: String(u?.name || "un socio").split(" ")[0], points: POINTS.perFriend };
  },

  // Horas libres de un mes. Con provider = "any", las de todo el equipo juntas.
  // `full`: días de trabajo sin horas libres, donde se puede pedir aviso.
  "GET avail": async ({ q }) => {
    const s = service(q.get("service")),
      pid = q.get("provider"),
      month = q.get("month") || "";
    const team = !s ? [] : pid === "any" ? activeTeam().filter((p) => canDo(s, p)) : [provider(pid)].filter((p) => p && p.active !== false && canDo(s, p));
    if (!s || s.consult || !team.length || !/^\d{4}-\d{2}$/.test(month)) fail(400, "Petición incorrecta.");
    const now = T.nowLocal(),
      busies = await Promise.all(team.map((p) => busyOf(p.id, month))),
      [y, m] = month.split("-").map(Number),
      total = new Date(Date.UTC(y, m, 0)).getUTCDate(),
      days = {},
      full = [];
    for (let d = 1; d <= total; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      days[date] = [...new Set(team.flatMap((p, i) => freeTimes(p, s, date, busies[i], now)))].sort();
      if (!days[date].length && NORMS.waitlist && team.some((p) => freeTimes(p, s, date, {}, now).length)) full.push(date);
    }
    return { days, full };
  },

  // El móvil manda una clave nueva con cada intento de reserva. Si se corta la
  // conexión y vuelve a mandar lo mismo, se le contesta con la cita que ya se
  // guardó, en vez de «esa hora ya no está libre» (la había ocupado él mismo).
  "POST book": async ({ req, res, body }) => {
    const idem = /^[A-Za-z0-9_-]{16,64}$/.test(String(body.key || "")) ? "idem:" + body.key : null;
    if (idem) {
      const prev = await getJSON(idem);
      if (prev?.out) {
        if (prev.session) await startSession(req, res, prev.session);
        return prev.out;
      }
      if (prev || (await cmd("SET", idem, "{}", "NX", "EX", 60)) !== "OK") fail(409, "Tu reserva se está guardando…", { pending: true });
    }
    try {
      const r = await bookNow(req, res, body);
      if (idem) await setJSON(idem, r, "EX", 86400);
      return r.out;
    } catch (e) {
      if (idem) await cmd("DEL", idem);
      throw e;
    }
  },

  // Aviso por correo si se libera una hora en un día que está completo.
  "POST waitlist": async ({ req, body }) => {
    if (!NORMS.waitlist) fail(400, "Ahora mismo no se apuntan avisos.");
    const s = service(body.service),
      pid = body.provider === "any" ? "any" : provider(body.provider)?.id;
    if (!s || s.consult || !pid) fail(400, "Elige servicio y barbero.");
    const now = T.nowLocal();
    if (!T.isDate(body.date) || body.date < now.date || body.date > T.addDays(now.date, RULES.daysAhead)) fail(400, "Elige uno de los próximos días.");
    const u = await currentUser(req);
    const email = u ? u.email : normEmail(body.email);
    if (!EMAIL.test(email)) fail(400, "Pon tu correo para poder avisarte.");
    await limit("wl:" + ip(req), 10, 3600);
    const key = "wl:" + body.date;
    await pipe([
      ["HSET", key, email, JSON.stringify({ service: s.id, provider: pid, name: clean(u?.name || body.name, 60), at: now.stamp })],
      ["EXPIRE", key, Math.max(3600, T.minutesUntil(body.date, "23:59") * 60 + 3600)],
    ]);
    return { ok: true, mail: mailReady() };
  },

  // La cita para el calendario del móvil (iPhone, Android, Outlook). Sin datos
  // personales: solo servicio, barbero, sitio y hora, con aviso una hora antes.
  "GET bookings/:id/ics": async ({ params }) => {
    const b = await getJSON("bk:" + String(params.id).replace(/[^A-Za-z0-9]/g, ""));
    if (!b || b.kind !== "booking") fail(404, "No encontramos esa cita.");
    const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const esc = (x) => String(x ?? "").replace(/\\/g, "\\\\").replace(/[,;]/g, "\\$&").replace(/\r?\n/g, "\\n");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NOVA Studio//Reservas//ES",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${b.id}@nova-reservas`,
      `DTSTAMP:${z(Date.now())}`,
      `DTSTART:${z(T.epochOf(b.date, b.start))}`,
      `DTEND:${z(T.epochOf(b.date, b.end))}`,
      `SUMMARY:${esc(`${b.service.name} · ${BUSINESS.name}`)}`,
      `DESCRIPTION:${esc(`Con ${b.provider.name}. Referencia ${b.id}.`)}`,
      `LOCATION:${esc(BUSINESS.street + ", " + BUSINESS.city)}`,
      ...(b.status === "canceled" ? ["STATUS:CANCELLED"] : ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc("Cita en " + BUSINESS.name)}`, "TRIGGER:-PT1H", "END:VALARM"]),
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    return { raw: lines.join("\r\n") + "\r\n", type: "text/calendar; charset=utf-8", cache: "no-store" };
  },

  "GET bookings": async ({ req }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra para ver tus citas.");
    const now = T.nowLocal();
    const list = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + u.email));
    const key = (b) => b.date + " " + b.start;
    const upcoming = list.filter((b) => isActive(b, now)).sort((a, b) => key(a).localeCompare(key(b)));
    const past = list.filter((b) => !isActive(b, now)).sort((a, b) => key(b).localeCompare(key(a)));
    return { upcoming, past, now: now.stamp, habit: habitOf(list, now) };
  },

  "GET bookings/:id": async ({ req, params }) => {
    const b = await getJSON("bk:" + params.id);
    const u = await currentUser(req);
    if (!b || !((u && u.email === b.email) || (await staffOf(req)))) fail(404, "No encontramos esa cita.");
    const mins = T.minutesUntil(b.date, b.start);
    const open = b.status === "confirmed" && mins > 0;
    return {
      booking: b,
      canChange: open && mins >= NORMS.cancelHours * 60,
      canCancel: open,
      late: open && mins < NORMS.cancelHours * 60,
      lateFee: feeFor(b, "late"),
      past: mins < 0,
    };
  },

  "POST bookings/:id/cancel": async ({ req, params, body }) => {
    const b = await getJSON("bk:" + params.id);
    const u = await currentUser(req),
      staff = canManage(await staffOf(req), b?.provider.id);
    if (!b || !((u && u.email === b.email) || staff)) fail(404, "No encontramos esa cita.");
    if (b.status !== "confirmed") return { ok: true };
    if (!staff && T.minutesUntil(b.date, b.start) <= 0) fail(400, "La hora de la cita ya ha pasado.");
    // Con menos de X horas el cliente puede cancelar igual (la hora queda libre
    // para otro), pero se marca como tardía y su barbero decide si se cobra.
    const late = !staff && b.kind === "booking" && lateCancel(b);
    const done = {
      ...b,
      status: "canceled",
      canceledBy: staff ? "staff" : "client",
      canceledAt: T.nowLocal().stamp,
      ...(late ? { late: true, hoursLeft: Math.max(0, Math.round(T.minutesUntil(b.date, b.start) / 6) / 10) } : {}),
    };
    await unplace(b, done);
    // «Cancelar también las siguientes» de una cita que se repite.
    let more = 0;
    const freed = new Set([b.date]);
    if (body?.series === true && b.series) {
      const ids = await cmd("SMEMBERS", "series:" + b.series);
      for (const x of await bookingsByIds(ids)) {
        if (x.id === b.id || x.status !== "confirmed" || x.date + x.start <= b.date + b.start) continue;
        await unplace(x, { ...x, status: "canceled", canceledBy: staff ? "staff" : "client", canceledAt: T.nowLocal().stamp, seriesCancel: true });
        freed.add(x.date);
        more++;
      }
    }
    if (!staff && b.kind === "booking") await notifySalon(b, late ? "Cancelación tardía" : more ? `Cita cancelada (y ${more} más de la serie)` : "Cita cancelada");
    for (const d of freed) await waitlistPing(d, hostOf(req));
    return { ok: true, late, fee: late ? feeFor(b, "late") : 0 };
  },

  "POST bookings/:id/move": async ({ req, params, body }) => {
    const b = await getJSON("bk:" + params.id);
    const u = await currentUser(req),
      staff = canManage(await staffOf(req), b?.provider.id);
    if (!b || !((u && u.email === b.email) || staff)) fail(404, "No encontramos esa cita.");
    if (b.status !== "confirmed") fail(400, "Esta cita ya no está activa.");
    if (!staff && lateCancel(b))
      fail(400, `Quedan menos de ${NORMS.cancelHours} horas: para cambiarla, escríbenos por WhatsApp.`);
    const s = service(b.service.id),
      p = provider(b.provider.id);
    if (!T.isDate(body.date) || !T.isTime(body.start)) fail(400, "Elige día y hora.");
    const busy = await busyOf(p.id, monthOf(body.date), b.id);
    if (!freeTimes(p, s, body.date, busy, T.nowLocal()).includes(body.start))
      fail(409, "Esa hora ya no está libre. Elige otra, por favor.");
    const moved = { ...b, date: body.date, start: body.start, end: T.toHHMM(T.toMin(body.start) + b.service.duration) };
    await moveTo(b, moved);
    if (!staff) await notifySalon(moved, "Cita cambiada");
    await waitlistPing(b.date, hostOf(req));
    return { ok: true };
  },

  "GET member": async ({ req }) => {
    let u = await currentUser(req);
    if (!u) fail(401, "Entra para ver tu Club.");
    if (!u.ref) u = await ensureUser(u.email);
    return { user: publicUser(u), ...(await clubOf(u)) };
  },

  "POST profile/photo": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    const data = String(body.photo || "");
    if (data && (!PHOTO.test(data) || data.length > 250000)) fail(400, "Esa foto no vale. Prueba con otra.");
    await setJSON("user:" + u.email, { ...u, photo: data });
    return { ok: true };
  },

  // Canjear un premio: se descuentan los puntos y queda pendiente hasta que
  // el equipo lo entrega en el local.
  "POST rewards/redeem": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    const reward = REWARDS.find((r) => r.id === body.reward);
    if (!reward) fail(400, "Ese premio no existe.");
    if ((await cmd("SET", "rdlock:" + u.email, "1", "NX", "EX", 10)) !== "OK") fail(429, "Un momento…");
    try {
      const club = await clubOf(u);
      if (club.balance < reward.cost) fail(400, `Te faltan ${reward.cost - club.balance} puntos.`);
      const r = {
        id: "C" + crypto.randomBytes(3).toString("hex").toUpperCase(),
        email: u.email,
        name: u.name,
        reward: { id: reward.id, name: reward.name, cost: reward.cost },
        status: "pending",
        created: T.nowLocal().stamp,
      };
      await pipe([
        ["SET", "rd:" + r.id, JSON.stringify(r)],
        ["SADD", "urd:" + u.email, r.id],
        ["SADD", "rdpending", r.id],
      ]);
      return { redemption: r, balance: club.balance - reward.cost };
    } finally {
      await cmd("DEL", "rdlock:" + u.email);
    }
  },

  "POST profile": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    const name = clean(body.name),
      phone = clean(body.phone, 30);
    if (!name) fail(400, "Falta tu nombre.");
    if (phone && !PHONE.test(phone)) fail(400, "Revisa tu teléfono.");
    await setJSON("user:" + u.email, { ...u, name, phone });
    return { ok: true };
  },

  // ── Tarjeta en garantía ─────────────────────────────────────────────────
  // Paso 1: prepara el formulario de Stripe. Un cliente nuevo se da de alta
  // aquí mismo (con sus datos de la reserva) para que la tarjeta quede en su perfil.
  "POST card/setup": async ({ req, res, body }) => {
    if (!Card.cardEnabled()) fail(400, "Ahora mismo no hace falta tarjeta.");
    await limit("cardsetup:" + ip(req), 10, 3600);
    let u = await currentUser(req);
    if (!u) {
      const email = normEmail(body.email),
        name = clean(body.name),
        phone = clean(body.phone, 30);
      if (!name) fail(400, "Falta tu nombre.");
      if (!EMAIL.test(email)) fail(400, "Revisa tu correo.");
      if (phone && !PHONE.test(phone)) fail(400, "Revisa tu teléfono.");
      if (await getJSON("user:" + email)) fail(409, "Ya tienes cuenta con este correo. Entra con él y sigue con tu reserva.");
      u = await registerNew(req, res, { email, name, phone, ref: body.ref });
    }
    if (!u.stripe) {
      u = { ...u, stripe: await Card.ensureCustomer(u) };
      await setJSON("user:" + u.email, u);
    }
    const si = await Card.createSetup(u.stripe);
    return { ...si, fake: Card.FAKE };
  },

  // Paso 2: Stripe ya la ha guardado; la apuntamos en el perfil (y soltamos la anterior).
  "POST card/confirm": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u?.stripe) fail(401, "Entra en tu cuenta.");
    let card;
    try {
      card = await Card.finishSetup(String(body.id || ""), u.stripe, body.number);
    } catch (e) {
      fail(400, e.message);
    }
    const old = u.card?.pm;
    await setJSON("user:" + u.email, { ...u, card: { ...card, saved: T.nowLocal().stamp } });
    if (old && old !== card.pm) await Card.removeCard(old);
    return { card: publicCard(card) };
  },

  "POST card/remove": async ({ req }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    if (!u.card) return { ok: true };
    const now = T.nowLocal();
    const mine = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + u.email));
    if (mine.some((b) => isActive(b, now) && b.guarantee))
      fail(400, "Tienes citas pendientes garantizadas con esta tarjeta. Cámbiala por otra o cancela esas citas antes de quitarla.");
    if (mine.some((b) => ["requires_action", "requires_payment_method"].includes(b.charge?.status)))
      fail(400, "Tienes un pago pendiente. Págalo antes de quitar la tarjeta.");
    await Card.removeCard(u.card.pm);
    const { card, ...rest } = u;
    await setJSON("user:" + u.email, rest);
    return { ok: true };
  },

  // Cargo por no presentarse que el banco no dejó cobrar solo: el cliente lo
  // confirma (o paga con otra tarjeta) desde la app.
  "POST bookings/:id/pay": async ({ req, params }) => {
    const b = await getJSON("bk:" + params.id);
    const u = await currentUser(req);
    if (!b || !u || u.email !== b.email) fail(404, "No encontramos esa cita.");
    if (!b.charge || b.charge.status === "succeeded") fail(400, "No hay nada pendiente de pago.");
    const pi = await Card.readIntent(b.charge.pi);
    if (!pi) fail(400, "Ese pago ya no existe. Escríbenos por WhatsApp.");
    if (pi.status === "succeeded") {
      await setJSON("bk:" + b.id, { ...b, charge: { ...b.charge, status: "succeeded", error: "", paidAt: T.nowLocal().stamp } });
      return { done: true };
    }
    return { clientSecret: pi.clientSecret, status: pi.status, fake: Card.FAKE };
  },

  "POST bookings/:id/pay/check": async ({ req, params }) => {
    const b = await getJSON("bk:" + params.id);
    const u = await currentUser(req);
    if (!b || !u || u.email !== b.email || !b.charge) fail(404, "No encontramos esa cita.");
    if (Card.FAKE) Card.fakeComplete(b.charge.pi);
    const pi = await Card.readIntent(b.charge.pi);
    const charge = { ...b.charge, status: pi.status, error: pi.status === "succeeded" ? "" : pi.error, ...(pi.status === "succeeded" ? { paidAt: T.nowLocal().stamp } : {}) };
    await setJSON("bk:" + b.id, { ...b, charge });
    return { status: charge.status };
  },

  "POST auth/request": async ({ req, res, body }) => {
    const email = normEmail(body.email);
    if (!EMAIL.test(email)) fail(400, "Revisa tu correo.");
    await limit("auth:" + email, 5, 900);
    await limit("authip:" + ip(req), 20, 900);
    if (!LOGIN_CON_CODIGO) {
      await ensureUser(email);
      await startSession(req, res, email);
      return { direct: true };
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0"),
      challenge = token();
    await setJSON("code:" + challenge, { email, h: sha(code + challenge), tries: 0 }, "EX", 600);
    if (mailReady()) {
      if (!(await codeMail(email, code))) fail(502, "No hemos podido enviar el correo. Prueba otra vez en un rato.");
      return { challenge };
    }
    if (ON_VERCEL)
      fail(503, "Ahora mismo no podemos enviar el código por correo. Escríbenos por WhatsApp y te ayudamos.");
    console.log(`\n  Código de acceso para ${email}: ${code}\n`);
    return { challenge, dev: true };
  },

  "POST auth/verify": async ({ req, res, body }) => {
    const key = "code:" + String(body.challenge || "").slice(0, 64);
    const c = await getJSON(key);
    if (!c) fail(400, "El código ha caducado. Pide otro.");
    if (c.tries >= 5) {
      await cmd("DEL", key);
      fail(400, "Demasiados intentos. Pide otro código.");
    }
    if (!same(c.h, sha(String(body.code || "").trim() + body.challenge))) {
      await setJSON(key, { ...c, tries: c.tries + 1 }, "EX", 600);
      fail(400, "Ese código no es correcto.");
    }
    await cmd("DEL", key);
    await ensureUser(c.email);
    await startSession(req, res, c.email);
    return { ok: true };
  },

  "POST auth/logout": async ({ req, res }) => {
    const t = cookies(req)[SESSION];
    if (t) await cmd("DEL", "sess:" + sha(t));
    cookie(res, req, SESSION, "", 0);
    return { ok: true };
  },

  // ── Equipo ──────────────────────────────────────────────────────────────
  "POST staff/login": async ({ req, res, body }) => {
    await limit("staff:" + ip(req), 8, 900);
    // Además del límite por conexión, uno por cuenta que solo cuenta los fallos:
    // cambiar de red no sirve para ir probando claves de 4 cifras.
    const who = String(body.provider || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 30);
    const failKey = "rl:pinfail:" + who;
    if ((Number(await cmd("GET", failKey)) || 0) >= 10) fail(429, "Demasiadas claves incorrectas. Espera 15 minutos.");
    const wrong = async (msg) => {
      await hit(failKey, 900);
      fail(400, msg);
    };
    if (body.provider === "caja") {
      const pin = String(body.pin || "");
      if (!pin || !activeTeam().some((x) => pinOk(x, pin))) await wrong("Clave incorrecta. Vale la de cualquiera del equipo.");
      const t = token();
      await cmd("SET", "staffsess:" + sha(t), "caja", "EX", YEAR);
      cookie(res, req, STAFF, t, YEAR);
      return { ok: true };
    }
    const p = provider(body.provider);
    if (!p || p.active === false) fail(400, "Elige quién eres.");
    if (!p.pinHash && !pinOf(p)) fail(400, `La clave de ${p.name.split(" ")[0]} aún no está puesta. Pídesela al dueño.`);
    if (!pinOk(p, String(body.pin || ""))) await wrong("Clave incorrecta.");
    const t = token();
    await cmd("SET", "staffsess:" + sha(t), p.id, "EX", YEAR);
    cookie(res, req, STAFF, t, YEAR);
    return { ok: true };
  },

  "POST staff/logout": async ({ req, res }) => {
    const t = cookies(req)[STAFF];
    if (t) await cmd("DEL", "staffsess:" + sha(t));
    cookie(res, req, STAFF, "", 0);
    return { ok: true };
  },

  "GET staff/day": async ({ req, q }) => {
    const me = await needStaff(req);
    const date = q.get("date");
    if (!T.isDate(date)) fail(400, "Fecha incorrecta.");
    const list = (await bookingsByIds(await cmd("SMEMBERS", "day:" + date)))
      .filter((b) => b.date === date)
      .sort((a, b) => a.start.localeCompare(b.start));
    const info = await strikesAndCards(list.map((b) => b.email));
    return {
      date,
      providers: TEAM.filter((p) => p.active !== false || list.some((b) => b.provider.id === p.id)).map((p) => ({ id: p.id, name: p.name, hours: p.hours?.[T.weekday(date)] || [] })),
      bookings: list.map((b) => (b.email ? { ...b, strikes: info.strikes[b.email] || 0, card: !!info.card[b.email] } : b)),
      cardEnabled: Card.cardEnabled(),
      now: T.nowLocal().stamp,
      alerts: me.owner ? await ownerAlerts() : [],
    };
  },

  // NOVA Supply: el barbero apunta una compra de ropa a la cuenta de un socio
  // (por su correo o su código del Club) y le suma los puntos.
  "GET staff/member": async ({ req, q }) => {
    await needStaff(req);
    const u = await findMember(q.get("q"));
    if (!u) fail(404, "No encontramos a ese socio. Prueba con su correo o su código del Club.");
    const c = await clubOf(u);
    return { member: { email: u.email, name: u.name, no: u.no, earned: c.earned, balance: c.balance } };
  },

  "POST staff/shop": async ({ req, body }) => {
    const me = await needStaff(req);
    const u = await findMember(body.email);
    if (!u) fail(404, "No encontramos a ese socio.");
    const amount = Math.round(Number(String(body.amount || "").replace(",", ".")) * 100) / 100;
    const items = Math.round(Number(body.items));
    if (!(amount > 0 && amount <= 2000)) fail(400, "Pon el importe de la compra, en euros.");
    if (!(items >= 1 && items <= 30)) fail(400, "¿Cuántas prendas se lleva?");
    const now = T.nowLocal();
    const p = {
      id: "S" + crypto.randomBytes(3).toString("hex").toUpperCase(),
      email: u.email,
      name: u.name,
      amount,
      items,
      points: Math.round(amount * POINTS.perEuro),
      date: now.date,
      created: now.stamp,
      by: me.id,
    };
    await pipe([
      ["SET", "sh:" + p.id, JSON.stringify(p)],
      ["SADD", "ush:" + u.email, p.id],
    ]);
    return { purchase: p };
  },

  // Deshacer una compra apuntada por error: quien la apuntó, o el dueño.
  "POST staff/shop/:id/delete": async ({ req, params }) => {
    const me = await needStaff(req);
    const p = await getJSON("sh:" + params.id);
    if (!p) fail(404, "No existe esa compra.");
    if (p.by !== me.id && !me.owner) fail(403, "Solo la puede quitar quien la apuntó o el dueño.");
    await pipe([
      ["DEL", "sh:" + p.id],
      ["SREM", "ush:" + p.email, p.id],
    ]);
    return { ok: true };
  },

  "GET staff/redemptions": async ({ req }) => {
    await needStaff(req);
    const list = await bookingsByIds2("rd:", await cmd("SMEMBERS", "rdpending"));
    return { pending: list.filter((r) => r.status === "pending").sort((a, b) => a.created.localeCompare(b.created)) };
  },

  "POST staff/redemptions/:id": async ({ req, params, body }) => {
    await needStaff(req);
    const r = await getJSON("rd:" + params.id);
    if (!r) fail(404, "No existe ese canje.");
    if (!["done", "canceled"].includes(body.status)) fail(400, "Estado incorrecto.");
    await setJSON("rd:" + r.id, { ...r, status: body.status, closed: T.nowLocal().stamp });
    await cmd("SREM", "rdpending", r.id);
    return { ok: true };
  },

  "POST staff/bookings/:id/state": async ({ req, params, body }) => {
    const me = await needStaff(req);
    const b = await getJSON("bk:" + params.id);
    if (!b) fail(404, "No existe esa cita.");
    if (!canManage(me, b.provider.id)) fail(403, "Esa cita es de otro barbero.");
    if (!["done", "absent", "unmarked"].includes(body.attendance)) fail(400, "Estado incorrecto.");
    if (b.pay && body.attendance !== "done") fail(400, "Esta cita ya está cobrada en caja. Quita antes el cobro.");
    if (b.charge && ["succeeded", "requires_action"].includes(b.charge.status) && body.attendance !== "absent")
      fail(400, "Ya se le ha cobrado la falta. Si fue un error, el dueño puede devolver el dinero.");
    await setJSON("bk:" + b.id, { ...b, attendance: body.attendance });
    return { ok: true };
  },

  // El cliente no vino: se le cobra el servicio en la tarjeta que dejó en garantía.
  "POST staff/bookings/:id/charge": async ({ req, params }) => {
    const me = await needStaff(req);
    const b = await getJSON("bk:" + params.id);
    if (!b || b.kind !== "booking") fail(404, "No existe esa cita.");
    if (!canManage(me, b.provider.id)) fail(403, "Esa cita es de otro barbero.");
    const kind = b.status === "canceled" && b.late ? "late" : "absent";
    if (kind === "absent" && (b.status !== "confirmed" || b.attendance !== "absent")) fail(400, "Primero márcala como «No vino».");
    if (kind === "absent" && !isPast(b, T.nowLocal())) fail(400, "Aún no ha llegado la hora de la cita.");
    if (b.waived) fail(400, "Ya se decidió no cobrarla.");
    if (b.charge && b.charge.status !== "requires_payment_method") fail(400, "Esta falta ya está cobrada o pendiente de que el cliente la confirme.");
    const u = b.email && (await getJSON("user:" + b.email));
    if (!u?.card || !u.stripe) fail(400, "Este cliente no tiene tarjeta guardada. Habla con él por WhatsApp.");
    const amount = Math.round(feeFor(b, kind) * 100);
    if (amount < 50) fail(400, kind === "late" ? "Con las normas actuales, cancelar tarde no se cobra." : "Este servicio no tiene precio para cobrar.");
    if ((await cmd("SET", "chargelock:" + b.id, me.id, "NX", "EX", 60)) !== "OK") fail(429, "Ya se está cobrando…");
    try {
      const tries = (b.charge?.tries || 0) + 1;
      const r = await Card.chargeOffSession({
        customer: u.stripe,
        pm: u.card.pm,
        amount,
        description: `NOVA Studio · ${kind === "late" ? "Cancelación tardía" : "No presentado"} · ${b.service.name} ${b.date} ${b.start}`,
        metadata: { booking: b.id, barber: b.provider.id, by: me.id },
        idem: `noshow-${b.id}-${tries}`,
      });
      const charge = { ...r, kind, amount: amount / 100, brand: u.card.brand, last4: u.card.last4, tries, at: T.nowLocal().stamp, by: me.id };
      await setJSON("bk:" + b.id, { ...b, charge });
      if (r.status !== "succeeded") {
        const host = req.headers.host ? `https://${req.headers.host}` : "";
        await send(
          b.email,
          `Pago pendiente · cita del ${T.niceDate(b.date)}`,
          "Tienes un pago pendiente",
          `<p style="margin:0 0 12px">${kind === "late" ? `Cancelaste tu cita de ${htmlEsc(b.service.name)} del ${T.niceDate(b.date)} a las ${b.start} con menos de ${NORMS.cancelHours} horas` : `No viniste a tu cita de ${htmlEsc(b.service.name)} del ${T.niceDate(b.date)} a las ${b.start} y no la cancelaste a tiempo`}, así que según las condiciones que aceptaste se cobran ${amount / 100} €.</p>
           <p style="margin:0 0 12px">Tu banco no ha dejado hacer el cobro automático. Puedes completarlo desde la app${host ? `: <a href="${host}/#booking/${b.id}">${host}/#booking/${b.id}</a>` : "."}</p>`,
        ).catch(() => {});
      }
      return { charge };
    } finally {
      await cmd("DEL", "chargelock:" + b.id);
    }
  },

  // El barbero decide no cobrar (había un motivo justificado). Se puede deshacer.
  "POST staff/bookings/:id/waive": async ({ req, params, body }) => {
    const me = await needStaff(req);
    const b = await getJSON("bk:" + params.id);
    if (!b || b.kind !== "booking") fail(404, "No existe esa cita.");
    if (!canManage(me, b.provider.id)) fail(403, "Esa cita es de otro barbero.");
    if (!(b.late || b.attendance === "absent")) fail(400, "No hay nada que perdonar.");
    if (b.charge && b.charge.status !== "requires_payment_method") fail(400, "Ya se ha cobrado. El dueño puede devolver el dinero.");
    const { waived, ...rest } = b;
    await setJSON("bk:" + b.id, body.undo === true ? rest : { ...b, waived: { by: me.id, at: T.nowLocal().stamp, note: clean(body.note, 200) } });
    return { ok: true };
  },

  // Solo el dueño puede devolver un cobro (por si se marcó una falta por error).
  "POST staff/bookings/:id/refund": async ({ req, params }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Solo el dueño puede devolver dinero.");
    const b = await getJSON("bk:" + params.id);
    if (!b?.charge || b.charge.status !== "succeeded") fail(400, "No hay ningún cobro que devolver.");
    try {
      await Card.refund(b.charge.pi);
    } catch (e) {
      fail(400, e.message);
    }
    await setJSON("bk:" + b.id, { ...b, charge: { ...b.charge, status: "refunded", refundedAt: T.nowLocal().stamp, refundedBy: me.id } });
    return { ok: true };
  },

  // Faltas del mes: cada barbero ve las suyas; el dueño, las de todos.
  "GET staff/noshows": async ({ req, q }) => {
    const me = await needStaff(req);
    const month = q.get("month") || T.nowLocal().date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) fail(400, "Mes incorrecto.");
    const list = (await monthBookings(month))
      .filter((b) => ((b.status === "confirmed" && b.attendance === "absent") || (b.status === "canceled" && b.late)) && canManage(me, b.provider.id))
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
    const cards = await strikesAndCards(list.map((b) => b.email));
    return {
      month,
      list: list.map((b) => ({ ...b, card: !!cards.card[b.email], strikes: cards.strikes[b.email] || 0, fee: feeFor(b, b.late ? "late" : "absent") })),
      charged: cents(list.reduce((a, b) => a + (b.charge?.status === "succeeded" ? b.charge.amount : 0), 0)),
      pending: cents(list.reduce((a, b) => a + (b.charge && b.charge.status !== "succeeded" && b.charge.status !== "refunded" ? b.charge.amount : 0), 0)),
      uncharged: list.filter((b) => !b.charge && !b.waived).length,
    };
  },

  // ── Productos del estudio ───────────────────────────────────────────────
  // Lo que se vende en el local (ceras, polvos, aceites…). El dueño los sube
  // desde su panel; en la app se enseñan y se compran en el estudio.
  "GET products": async ({ req }) => {
    const all = (await bookingsByIds2("prod:", await cmd("SMEMBERS", "prodall"))).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created.localeCompare(b.created));
    const me = await staffOf(req);
    return { products: me?.owner ? all : all.filter((p) => p.visible !== false) };
  },

  "GET products/:id/photo": async ({ params }) => {
    const data = await cmd("GET", "prodimg:" + String(params.id).replace(/[^A-Za-z0-9]/g, ""));
    const m = data && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
    if (!m) fail(404, "Sin foto.");
    return { raw: Buffer.from(m[2], "base64"), type: m[1], cache: "public, max-age=31536000, immutable" };
  },

  "POST staff/products": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Los productos los lleva el dueño.");
    const prev = body.id ? await getJSON("prod:" + String(body.id).replace(/[^A-Za-z0-9]/g, "")) : null;
    if (body.id && !prev) fail(404, "Ese producto ya no existe.");
    if (body.delete === true) {
      if (!prev) fail(400, "Falta el producto.");
      await pipe([
        ["DEL", "prod:" + prev.id],
        ["DEL", "prodimg:" + prev.id],
        ["SREM", "prodall", prev.id],
      ]);
      return { ok: true };
    }
    const name = clean(body.name, 80);
    if (!name) fail(400, "Ponle un nombre.");
    const price = Math.round(Number(String(body.price ?? "").replace(",", ".")) * 100) / 100;
    if (!(price >= 0) || price > 9999) fail(400, "Revisa el precio.");
    const photo = String(body.photo || "");
    if (photo && (!PHOTO.test(photo) || photo.length > 280000)) fail(400, "Esa foto no vale. Prueba con otra.");
    const now = T.nowLocal().stamp;
    const pr = {
      id: prev?.id || "P" + crypto.randomBytes(4).toString("hex").toUpperCase(),
      name,
      brand: clean(body.brand, 60),
      desc: clean(body.desc, 400),
      price,
      visible: body.visible !== false,
      soldOut: body.soldOut === true,
      order: prev?.order ?? Date.now(),
      created: prev?.created || now,
      img: photo ? String(Date.now()) : prev?.img || "", // cambia al cambiar la foto, para que se recargue
    };
    await pipe([
      ["SET", "prod:" + pr.id, JSON.stringify(pr)],
      ["SADD", "prodall", pr.id],
      ...(photo ? [["SET", "prodimg:" + pr.id, photo]] : []),
    ]);
    return { product: pr };
  },

  // ── Avisos y calendario de cada barbero ─────────────────────────────────
  "GET staff/settings": async ({ req }) => {
    const me = await needStaff(req);
    let cfg = await staffCfg(me.id);
    if (!cfg.feed) {
      cfg = { ...cfg, feed: token() };
      await pipe([
        ["SET", "staffcfg:" + me.id, JSON.stringify(cfg)],
        ["SET", "calfeed:" + cfg.feed, me.id],
      ]);
    }
    return { email: cfg.email || "", notify: cfg.notify !== false, feed: cfg.feed, mail: mailReady() };
  },

  "POST staff/settings": async ({ req, body }) => {
    const me = await needStaff(req);
    let cfg = await staffCfg(me.id);
    if (body.email !== undefined) {
      const email = normEmail(body.email);
      if (email && !EMAIL.test(email)) fail(400, "Revisa el correo.");
      cfg = { ...cfg, email };
    }
    if (body.notify !== undefined) cfg = { ...cfg, notify: body.notify !== false };
    // Enlace nuevo: el anterior deja de funcionar (por si se ha compartido sin querer).
    if (body.resetFeed === true) {
      if (cfg.feed) await cmd("DEL", "calfeed:" + cfg.feed);
      cfg = { ...cfg, feed: token() };
      await cmd("SET", "calfeed:" + cfg.feed, me.id);
    }
    await setJSON("staffcfg:" + me.id, cfg);
    if (body.test === true) {
      if (!cfg.email) fail(400, "Pon primero tu correo.");
      if (!mailReady()) fail(400, "El envío de correos aún no está configurado.");
      const ok = await send(cfg.email, "Prueba de avisos", "Los avisos funcionan", `<p style="margin:0">Hola ${htmlEsc(me.name.split(" ")[0])}: aquí te llegará cada cita nueva, cambiada o cancelada.</p>`);
      if (!ok) fail(502, "No se ha podido enviar. Revisa el correo.");
    }
    return { ok: true, feed: cfg.feed };
  },

  // Calendario del barbero en formato iCalendar: Google Calendar, el iPhone u
  // Outlook se suscriben a esta dirección y enseñan sus citas. La dirección
  // lleva una clave larga; quien no la tenga no ve nada.
  "GET cal/:token": async ({ params }) => {
    const tk = String(params.token).replace(/\.ics$/i, "").replace(/[^A-Za-z0-9_-]/g, "");
    const id = tk && (await cmd("GET", "calfeed:" + tk));
    const p = id && provider(id);
    if (!p) fail(404, "Ese calendario no existe.");
    const today = T.nowLocal().date;
    const dates = Array.from({ length: 30 + 1 + RULES.daysAhead + 7 }, (_, i) => T.addDays(today, i - 30));
    const sets = await pipe(dates.map((d) => ["SMEMBERS", "day:" + d]));
    const list = (await bookingsByIds([...new Set(sets.flat())])).filter((b) => b.provider.id === p.id && b.status === "confirmed");
    const ics = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/[,;]/g, "\\$&").replace(/\r?\n/g, "\\n");
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS.tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    // Hora de Canarias → UTC (en verano va una hora por delante).
    const utc = (date, hhmm) => {
      const [y, m, d] = date.split("-").map(Number),
        [h, mi] = hhmm.split(":").map(Number);
      const guess = Date.UTC(y, m - 1, d, h, mi);
      const o = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
      return z(guess - (Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute) - guess));
    };
    const stamp = z(Date.now());
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NOVA Studio//Reservas//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${ics(BUSINESS.short + " · " + p.name.split(" ")[0])}`, `X-WR-TIMEZONE:${BUSINESS.tz}`, "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
    for (const b of list) {
      const block = b.kind === "block";
      const desc = block
        ? "Hora bloqueada"
        : [b.service.name + (b.service.price ? ` · ${b.service.price} €` : ""), b.phone && "Tel. " + b.phone, b.email, b.attendance === "absent" && "NO VINO", "Ref. " + b.id].filter(Boolean).join("\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${b.id}@nova-reservas`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${utc(b.date, b.start)}`,
        `DTEND:${utc(b.date, b.end)}`,
        `SUMMARY:${ics(block ? "Bloqueado · " + b.service.name : `${b.name} · ${b.service.name}`)}`,
        `DESCRIPTION:${ics(desc)}`,
        `LOCATION:${ics(BUSINESS.street + ", " + BUSINESS.city)}`,
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");
    return { raw: lines.join("\r\n") + "\r\n", type: "text/calendar; charset=utf-8", cache: "no-store" };
  },

  // ── Formación (fase 1: lista de interesados) ────────────────────────────
  // Cualquiera puede apuntarse; si repite con el mismo teléfono se actualiza
  // su ficha en vez de duplicarla. Solo el dueño ve la lista.
  "POST training/interest": async ({ req, body }) => {
    const name = clean(body.name),
      phone = clean(body.phone, 30),
      email = normEmail(body.email),
      insta = clean(body.instagram, 40).replace(/^@/, "");
    if (!name) fail(400, "Falta tu nombre.");
    if (!PHONE.test(phone)) fail(400, "Revisa tu teléfono.");
    if (email && !EMAIL.test(email)) fail(400, "Revisa tu correo.");
    if (body.consent !== true) fail(400, "Tienes que aceptar que te contactemos.");
    const pick = (v, list) => (list.some((x) => (x.id || x) === v) ? v : "");
    const many = (v, list) => [...new Set([].concat(v || []).filter((x) => list.includes(x)))];
    const level = pick(body.level, TRAINING.levels),
      format = pick(body.format, TRAINING.formats);
    if (!level) fail(400, "Dinos tu nivel.");
    await limit("train:" + ip(req), 6, 3600);
    const key = "trphone:" + phone.replace(/\D/g, "");
    const prevId = await cmd("GET", key);
    const prev = prevId && (await getJSON("tr:" + prevId));
    const now = T.nowLocal().stamp;
    const t = {
      id: prev?.id || "F" + crypto.randomBytes(4).toString("hex").toUpperCase(),
      name,
      phone,
      email,
      instagram: insta,
      level,
      format,
      topics: many(body.topics, TRAINING.topics),
      availability: many(body.availability, TRAINING.availability),
      message: clean(body.message, 600),
      created: prev?.created || now,
      updated: prev ? now : undefined,
      status: prev?.status || "new",
      note: prev?.note || "",
    };
    await pipe([
      ["SET", "tr:" + t.id, JSON.stringify(t)],
      ["SET", key, t.id],
      ["SADD", "trall", t.id],
    ]);
    if (!prev) {
      const H = htmlEsc;
      const lv = TRAINING.levels.find((x) => x.id === level)?.name || level;
      await send(
        process.env.AVISO_CORREO || BUSINESS.email,
        `Nuevo interesado en la formación: ${name}`,
        "Alguien quiere aprender",
        `<p style="margin:0 0 8px"><b>${H(name)}</b> · ${H(phone)}${email ? " · " + H(email) : ""}</p><p style="margin:0">${H(lv)}${t.topics.length ? " · " + H(t.topics.join(", ")) : ""}</p>${t.message ? `<p style="margin:10px 0 0">«${H(t.message)}»</p>` : ""}`,
      ).catch(() => {});
    }
    return { ok: true, updated: !!prev };
  },

  "GET staff/training": async ({ req }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "La lista de formación solo la ve el dueño.");
    const list = (await bookingsByIds2("tr:", await cmd("SMEMBERS", "trall"))).sort((a, b) => b.created.localeCompare(a.created));
    const count = (fn) => list.reduce((o, t) => ([].concat(fn(t)).forEach((k) => k && (o[k] = (o[k] || 0) + 1)), o), {});
    return {
      list,
      stats: {
        total: list.length,
        fresh: list.filter((t) => t.status === "new").length,
        enrolled: list.filter((t) => t.status === "enrolled").length,
        level: count((t) => t.level),
        format: count((t) => t.format),
        topics: count((t) => t.topics),
        availability: count((t) => t.availability),
      },
    };
  },

  "POST staff/training/:id": async ({ req, params, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "La lista de formación solo la ve el dueño.");
    const t = await getJSON("tr:" + params.id);
    if (!t) fail(404, "No existe esa ficha.");
    if (body.delete === true) {
      await pipe([
        ["DEL", "tr:" + t.id],
        ["DEL", "trphone:" + t.phone.replace(/\D/g, "")],
        ["SREM", "trall", t.id],
      ]);
      return { ok: true };
    }
    const status = ["new", "contacted", "enrolled", "discarded"].includes(body.status) ? body.status : t.status;
    await setJSON("tr:" + t.id, { ...t, status, note: body.note !== undefined ? clean(body.note, 400) : t.note });
    return { ok: true };
  },

  // Cita apuntada por el equipo (llamada, WhatsApp, alguien que entra) o bloqueo de horas.
  "POST staff/book": async ({ req, body }) => {
    const me = await needStaff(req);
    const p = provider(body.provider);
    if (!p) fail(400, "Elige barbero.");
    if (!canManage(me, p.id)) fail(403, "Solo puedes apuntar en tu agenda.");
    if (!T.isDate(body.date) || !T.isTime(body.start)) fail(400, "Elige día y hora.");
    let b;
    if (body.block) {
      if (!T.isTime(body.end) || body.end <= body.start) fail(400, "La hora de fin tiene que ser después del inicio.");
      const duration = T.toMin(body.end) - T.toMin(body.start);
      b = makeBooking({ id: "bloqueo", name: clean(body.note, 60) || "Hora bloqueada", price: 0, duration }, p, body.date, body.start, {
        kind: "block",
        by: "staff",
        byStaff: me.id,
      });
    } else {
      const s = service(body.service);
      if (!s || s.consult) fail(400, "Elige servicio.");
      if (!canDo(s, p)) fail(400, `${p.name.split(" ")[0]} no hace ${s.name.toLowerCase()}.`);
      const name = clean(body.name);
      if (!name) fail(400, "Falta el nombre del cliente.");
      const email = normEmail(body.email);
      if (email && !EMAIL.test(email)) fail(400, "Revisa el correo.");
      b = makeBooking(s, p, body.date, body.start, { name, phone: clean(body.phone, 30), email, by: "staff", byStaff: me.id });
    }
    // El equipo puede apuntar a y cuarto (alguien que entra, un descanso); el cliente, cada media hora.
    if (T.toMin(b.start) % LOCK_MIN || T.toMin(b.end) % LOCK_MIN) fail(400, `Las horas van de ${LOCK_MIN} en ${LOCK_MIN} minutos.`);
    const busy = await busyOf(p.id, monthOf(b.date));
    const [x, y] = [T.toMin(b.start), T.toMin(b.end)];
    if ((busy[b.date] || []).some(([s0, e0]) => x < e0 && y > s0)) fail(409, "Choca con otra cita de ese barbero.");
    await place(b);
    if (b.email) await ensureUser(b.email, b.name, b.phone);
    let series = null;
    if (!body.block && body.repeat) series = await makeSeries(b, service(b.service.id), p, body.repeat, 12, { name: b.name, phone: b.phone, email: b.email, by: "staff", byStaff: me.id }, true);
    return { id: b.id, series };
  },

  // Caja del mes. Cada barbero ve solo lo suyo y sin comisiones; el dueño ve
  // a todo el equipo, el % de cada uno y lo que le toca cobrar.
  "GET staff/summary": async ({ req, q }) => {
    const me = await needStaff(req);
    const month = q.get("month") || T.nowLocal().date.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400, "Mes incorrecto.");
    const now = T.nowLocal();
    const [all, pays] = await Promise.all([monthBookings(month), monthPays(month)]);
    // Una cita cobrada en caja cuenta por lo cobrado (y para quien la cobró), no por su precio.
    const cobradas = new Set(pays.map((x) => x.booking).filter(Boolean));
    const used = (id) => all.some((b) => b.provider.id === id) || pays.some((x) => x.provider.id === id);
    const team = TEAM.filter((p) => (me.owner || p.id === me.id) && (p.active !== false || used(p.id)));
    const people = team.map((p) => ({
      id: p.id,
      name: p.name,
      owner: !!p.owner,
      ...statsOf(
        all.filter((b) => b.provider.id === p.id && !cobradas.has(b.id)),
        now,
        pays.filter((x) => x.provider.id === p.id),
      ),
    }));
    const lean = () => people.forEach((x) => delete x.upcomingRows);
    if (!me.owner) return lean(), { month, owner: false, people };

    const workers = team.filter((p) => !p.owner);
    const [hist, paid] = await Promise.all([commissionHistory(workers), cmd("MGET", ...workers.map((p) => `commpaid:${p.id}:${month}`))]);
    for (const person of people) {
      if (person.owner) continue;
      const h = hist[person.id];
      let commission = 0;
      for (const r of person.rows) {
        r.pct = rateAt(person.id, h, r.date);
        r.commission = cents((r.price * r.pct) / 100);
        commission += r.commission;
      }
      Object.assign(person, {
        pct: rateAt(person.id, h, month + "-31"),
        commission: cents(commission),
        expectedCommission: cents(person.upcomingRows.reduce((a, r) => a + (r.price * rateAt(person.id, h, r.date)) / 100, 0)),
        paid: paid[workers.findIndex((w) => w.id === person.id)] || "",
      });
    }
    lean();
    const own = people.filter((p) => p.owner).reduce((a, p) => a + p.billed, 0);
    const commissions = cents(people.reduce((a, p) => a + (p.commission || 0), 0));
    return {
      month,
      owner: true,
      people,
      totals: {
        salon: cents(people.reduce((a, p) => a + p.billed, 0)),
        own: cents(own),
        commissions,
        pendingCommissions: cents(people.filter((p) => !p.owner && !p.paid).reduce((a, p) => a + p.commission, 0)),
        income: cents(own + commissions),
      },
    };
  },

  // ── Cobros en caja ──────────────────────────────────────────────────────
  // La tablet del local: cualquiera del equipo apunta un cobro a nombre de
  // quien hizo el servicio. Cada barbero ve solo los suyos (y los que ha
  // apuntado él hoy, para poder corregirlos); el dueño los ve todos.
  "GET staff/cobros": async ({ req, q }) => {
    const me = await needCaja(req);
    const now = T.nowLocal();
    // La caja solo ve el día de hoy (para cuadrar y corregir), sin totales por barbero.
    const date = me.caja ? now.date : q.get("date") || now.date;
    if (!T.isDate(date)) fail(400, "Fecha incorrecta.");
    const [ids, bids] = await Promise.all([cmd("SMEMBERS", "payday:" + date), cmd("SMEMBERS", "day:" + date)]);
    const [pays, books] = await Promise.all([bookingsByIds2("pay:", ids), bookingsByIds(bids)]);
    const seen = pays
      .filter((x) => me.owner || me.caja || x.provider.id === me.id || (x.by === me.id && x.date === now.date))
      .sort((a, b) => b.created.localeCompare(a.created));
    // Citas del día sin cobrar, de todo el equipo: con ellas se rellena el formulario.
    const pending = books
      .filter((b) => b.date === date && b.kind === "booking" && b.status === "confirmed" && b.attendance !== "absent" && !b.pay)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((b) => ({ id: b.id, provider: b.provider.id, name: b.name, start: b.start, end: b.end, service: b.service.id }));
    const mine = seen.filter((x) => me.owner || me.caja || x.provider.id === me.id);
    const sum = (list) => cents(list.reduce((a, x) => a + x.amount, 0));
    return {
      date,
      today: now.date,
      now: now.stamp,
      team: activeTeam().map((p) => ({ id: p.id, name: p.name })),
      cobros: seen,
      pending,
      totals: {
        total: sum(mine),
        count: mine.length,
        methods: PAY_METHODS.map((m) => ({ ...m, total: sum(mine.filter((x) => x.method === m.id)) })),
        people: me.owner
          ? TEAM.map((p) => {
              const l = mine.filter((x) => x.provider.id === p.id);
              return { id: p.id, name: p.name, total: sum(l), count: l.length, active: p.active !== false };
            }).filter((p) => p.count || p.active)
          : [],
      },
    };
  },

  "POST staff/cobros": async ({ req, body }) => {
    const me = await needCaja(req);
    const now = T.nowLocal();
    const x = { id: "C" + crypto.randomBytes(4).toString("hex").toUpperCase(), ...readPay(body), date: now.date, time: now.stamp.slice(11, 16), created: now.stamp, by: me.id };
    await linkPay(x, x.booking);
    await pipe([
      ["SET", "pay:" + x.id, JSON.stringify(x)],
      ["SADD", "payday:" + x.date, x.id],
      ["SADD", "paymonth:" + monthOf(x.date), x.id],
    ]);
    return { cobro: x };
  },

  "POST staff/cobros/:id": async ({ req, params, body }) => {
    const me = await needCaja(req);
    const prev = await getJSON("pay:" + params.id);
    if (!prev) fail(404, "No existe ese cobro.");
    if (!canTouchPay(me, prev)) fail(403, "Ese cobro solo lo puede cambiar quien lo hizo o el dueño.");
    const x = { ...prev, ...readPay(body), edited: T.nowLocal().stamp, editedBy: me.id };
    await linkPay(x, x.booking);
    if (x.booking !== prev.booking) await unlinkPay(prev);
    await setJSON("pay:" + x.id, x);
    return { cobro: x };
  },

  "POST staff/cobros/:id/delete": async ({ req, params }) => {
    const me = await needCaja(req);
    const x = await getJSON("pay:" + params.id);
    if (!x) fail(404, "No existe ese cobro.");
    if (!canTouchPay(me, x)) fail(403, "Ese cobro solo lo puede quitar quien lo hizo o el dueño.");
    await unlinkPay(x);
    await pipe([
      ["DEL", "pay:" + x.id],
      ["SREM", "payday:" + x.date, x.id],
      ["SREM", "paymonth:" + monthOf(x.date), x.id],
    ]);
    return { ok: true };
  },

  // ── Fotos de la web y reseñas (solo el dueño) ─────────────────────────
  "GET site/:slot/photo": async ({ params }) => {
    const slot = SITE_SLOTS.find((x) => x.id === params.slot);
    const data = slot && (await cmd("GET", "siteimg:" + slot.id));
    const m = data && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
    if (!m) fail(404, "Sin foto.");
    return { raw: Buffer.from(m[2], "base64"), type: m[1], cache: "public, max-age=31536000, immutable" };
  },
  "GET staff/site": async ({ req }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "La web la lleva el dueño.");
    const site = await siteInfo();
    return { slots: slotsFor(site.theme), theme: site.theme, photos: site.photos, rating: { ...site.rating, shown: ratingOut(site.rating), url: BUSINESS.rating.url } };
  },
  "POST staff/site": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "La web la lleva el dueño.");
    const site = (await getJSON("site")) || {};
    // Tema (plata o rosa): se guarda junto al resto de ajustes de la web.
    if (body.theme !== undefined) {
      if (!THEMES.includes(body.theme)) fail(400, "Ese tema no existe.");
      await setJSON("site", { ...site, theme: body.theme });
      return { ok: true, theme: body.theme, slots: slotsFor(body.theme) };
    }
    // Reseñas: automáticas desde Booksy o fijadas a mano.
    if (body.rating) {
      let r = site.rating || {};
      if (body.rating.mode === "manual") {
        const sc = Number(String(body.rating.score ?? "").replace(",", ".")),
          ct = Math.round(Number(body.rating.count));
        if (!(sc >= 1 && sc <= 5)) fail(400, "La nota va de 1 a 5.");
        if (!(ct >= 0 && ct < 100000)) fail(400, "Revisa el número de reseñas.");
        r = { mode: "manual", score: Math.round(sc * 10) / 10, count: ct, at: Date.now(), ok: true };
      } else {
        const got = await readBooksy();
        r = got ? { mode: "auto", ...got, at: Date.now(), ok: true } : { ...r, mode: "auto", at: Date.now(), ok: false };
      }
      await setJSON("site", { ...site, rating: r });
      return { ok: true, rating: { ...r, shown: ratingOut(r) } };
    }
    const slot = SITE_SLOTS.find((x) => x.id === body.slot);
    if (!slot) fail(400, "Ese hueco de foto no existe.");
    const photos = { ...(site.photos || {}) };
    if (body.reset === true) {
      delete photos[slot.id];
      await cmd("DEL", "siteimg:" + slot.id);
    } else {
      const photo = String(body.photo || "");
      if (!SITE_PHOTO.test(photo) || photo.length > 900000) fail(400, "Esa foto no vale o es demasiado grande. Prueba con otra.");
      photos[slot.id] = String(Date.now());
      await cmd("SET", "siteimg:" + slot.id, photo);
    }
    await setJSON("site", { ...site, photos });
    return { ok: true, photos };
  },

  // ── Tareas automáticas (Vercel Cron, cada hora) ────────────────────────
  // /api/cron/daily sigue valiendo por si queda alguna llamada antigua.
  "GET cron/tick": async ({ req }) => cronTick(req),
  "GET cron/daily": async ({ req }) => cronTick(req),

  "GET unsub/:email/:t": async ({ params }) => {
    const email = normEmail(decodeURIComponent(params.email));
    if (!EMAIL.test(email) || !same(String(params.t), await unsubToken(email))) fail(400, "Enlace no válido.");
    await cmd("SET", "nomkt:" + email, T.nowLocal().stamp);
    return { raw: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:Arial;padding:40px 20px;text-align:center"><h1 style="font-size:22px">Hecho</h1><p>No te mandaremos más correos de este tipo. Los avisos de tus citas sí te seguirán llegando.</p></body>`, type: "text/html; charset=utf-8" };
  },

  // ── Clientes (solo el dueño) ────────────────────────────────────────────
  "GET staff/clients": async ({ req }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Los clientes los lleva el dueño.");
    const list = (await allClients()).sort((a, b) => (b.since ?? -1) - (a.since ?? -1));
    const count = (st) => list.filter((c) => c.status === st).length;
    return { list, stats: { total: list.length, lost: count("perdido"), due: count("le-toca"), booked: count("con-cita") }, mail: mailReady() };
  },
  "POST staff/clients/contact": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Los clientes los lleva el dueño.");
    const email = normEmail(body.email);
    const c = (await allClients()).find((x) => x.email === email);
    if (!c) fail(404, "No encontramos a ese cliente.");
    if (body.channel === "email") {
      if (!mailReady()) fail(400, "El envío de correos aún no está activado.");
      if (c.optout) fail(400, "Este cliente pidió no recibir estos correos.");
      if (!(await winbackMail(c, req.headers.host))) fail(502, "No se ha podido enviar.");
    }
    await setJSON("winback:" + email, { at: T.nowLocal().stamp, by: me.id, channel: body.channel === "email" ? "email" : "whatsapp" });
    return { ok: true };
  },

  // ── Copias de seguridad (solo el dueño) ─────────────────────────────────
  "GET staff/backup": async ({ req, q }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Solo el dueño.");
    const part = q.get("part") === "photos" ? "photos" : "data";
    const data = await backup(part);
    return { raw: JSON.stringify(data), type: "application/json; charset=utf-8", filename: `nova-${part === "photos" ? "fotos" : "datos"}-${T.nowLocal().date}.json` };
  },
  // Cargar una copia: escribe lo que trae (no borra lo que no viene en ella).
  "POST staff/restore": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Solo el dueño.");
    if (body.confirm !== "RESTAURAR") fail(400, "Escribe RESTAURAR para confirmar.");
    const b = body.backup;
    if (!b || b.app !== "nova-reservas" || !Array.isArray(b.data)) fail(400, "Ese archivo no es una copia de esta app.");
    const ops = [];
    for (const e of b.data) {
      if (!e || typeof e.k !== "string" || SKIP.test(e.k)) continue;
      if (e.t === "string" && typeof e.v === "string") ops.push(["SET", e.k, e.v]);
      else if (e.t === "set" && Array.isArray(e.v) && e.v.length) ops.push(["DEL", e.k], ["SADD", e.k, ...e.v.map(String)]);
      else if (e.t === "hash" && e.v && typeof e.v === "object") {
        const flat = Object.entries(e.v).flat().map(String);
        if (flat.length) ops.push(["DEL", e.k], ["HSET", e.k, ...flat]);
      }
    }
    for (let i = 0; i < ops.length; i += 300) await pipe(ops.slice(i, i + 300));
    return { ok: true, written: b.data.length };
  },

  // ── Normas de cancelación (solo el dueño) ───────────────────────────────
  "GET staff/rules": async ({ req }) => {
    await needStaff(req);
    return { ...NORMS, mail: mailReady(), cron: !ON_VERCEL || !!process.env.CRON_SECRET, lastCron: (await getJSON("cronlast")) || null };
  },
  "POST staff/rules": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Las normas las pone el dueño.");
    const num = (v, min, max, msg) => {
      const n = Math.round(Number(String(v ?? "").replace(",", ".")));
      if (!Number.isFinite(n) || n < min || n > max) fail(400, msg);
      return n;
    };
    // Se guarda solo lo que llega: cada pantalla del panel cambia su parte.
    const has = (k) => body[k] !== undefined;
    const norms = { ...((await getJSON("norms")) || {}) };
    if (has("cancelHours")) norms.cancelHours = num(body.cancelHours, 0, 168, "Pon entre 0 y 168 horas.");
    if (has("lateFeePct")) norms.lateFeePct = num(body.lateFeePct, 0, 100, "El cobro por cancelar tarde va de 0 a 100 %.");
    if (has("noShowFeePct")) norms.noShowFeePct = num(body.noShowFeePct, 0, 100, "El cobro por no venir va de 0 a 100 %.");
    if (has("recurringMax")) norms.recurringMax = num(body.recurringMax, 2, 12, "Las citas seguidas van de 2 a 12.");
    if (has("lapseDays")) norms.lapseDays = num(body.lapseDays, 14, 365, "Pon entre 14 y 365 días.");
    for (const k of ["reminders", "recurring", "winbackAuto", "remindSoon", "reviews", "dailyClose", "waitlist"]) if (has(k)) norms[k] = body[k] === true;
    if (has("reviewUrl")) {
      const u = clean(body.reviewUrl, 400);
      if (u && !/^https:\/\/[^\s"<>]+$/.test(u)) fail(400, "El enlace de reseñas tiene que empezar por https://");
      norms.reviewUrl = u;
    }
    if (norms.reviews && !(norms.reviewUrl ?? NORMS.reviewUrl)) fail(400, "Para pedir reseñas pega antes el enlace donde se dejan.");
    if (has("winbackText")) norms.winbackText = clean(body.winbackText, 600) || NORMS.winbackText;
    if (has("winbackOffer")) norms.winbackOffer = clean(body.winbackOffer, 200);
    await setJSON("norms", norms);
    return { ok: true, ...NORMS, ...norms };
  },

  // ── Equipo (solo el dueño) ──────────────────────────────────────────────
  "GET staff/team": async ({ req }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "El equipo lo lleva el dueño.");
    return {
      team: TEAM.map(({ pinHash, ...p }) => ({ ...p, hasPin: !!pinHash || !!pinOf(p), pinFrom: pinHash ? "panel" : pinOf(p) ? "vercel" : "" })),
      services: SERVICES.filter((s) => !s.consult).map((s) => ({ id: s.id, name: s.name, only: s.providers || [] })),
    };
  },
  "GET team/:id/photo": async ({ params }) => {
    const data = await cmd("GET", "teamimg:" + String(params.id).replace(/[^a-z0-9-]/g, ""));
    const m = data && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
    if (!m) fail(404, "Sin foto.");
    return { raw: Buffer.from(m[2], "base64"), type: m[1], cache: "public, max-age=31536000, immutable" };
  },
  "POST staff/team": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "El equipo lo lleva el dueño.");
    const prev = body.id ? TEAM.find((p) => p.id === body.id) : null;
    if (body.id && !prev) fail(404, "Ese trabajador ya no existe.");
    const name = clean(body.name, 60);
    if (!name) fail(400, "Ponle un nombre.");
    // Horario: por cada día de la semana, un tramo [desde, hasta] o nada (no trabaja).
    const hours = {};
    for (const d of WEEK) {
      const r = body.hours?.[d];
      if (!r) {
        hours[d] = [];
        continue;
      }
      const [a, b] = r;
      if (!T.isTime(a) || !T.isTime(b) || T.toMin(a) % 15 || T.toMin(b) % 15 || T.toMin(b) <= T.toMin(a)) fail(400, "Revisa el horario: la hora de salida tiene que ser después de la de entrada.");
      hours[d] = [[a, b]];
    }
    if (!WEEK.some((d) => hours[d].length)) fail(400, "Marca al menos un día de trabajo.");
    const bookable = SERVICES.filter((s) => !s.consult).map((s) => s.id);
    const services = [...new Set([].concat(body.services || []).filter((x) => bookable.includes(x)))];
    if (!services.length) fail(400, "Marca al menos un servicio.");
    const commission = prev?.owner ? 0 : Math.round(Number(String(body.commission ?? (prev?.commission ?? 40)).replace(",", ".")) * 10) / 10;
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) fail(400, "La comisión va de 0 a 100 %.");
    const pin = String(body.pin || "").trim();
    if (pin && !/^\d{4,8}$/.test(pin)) fail(400, "La clave son de 4 a 8 números.");
    if (!prev && !pin) fail(400, "Ponle una clave: es la que le darás para que entre a su panel.");
    if (pin && TEAM.some((x) => x.id !== prev?.id && x.active !== false && pinOk(x, pin))) fail(400, "Esa clave ya la usa otra persona del equipo. Pon otra.");
    const photo = String(body.photo || "");
    if (photo && (!PHOTO.test(photo) || photo.length > 280000)) fail(400, "Esa foto no vale. Prueba con otra.");
    let id = prev?.id;
    if (!id) {
      const base = name.split(" ")[0].normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, 16) || "barbero";
      id = base;
      for (let i = 2; TEAM.some((p) => p.id === id); i++) id = base + "-" + i;
    }
    const active = prev?.owner ? true : body.active !== false;
    const wEmail = body.email !== undefined ? normEmail(body.email) : prev?.email || "";
    if (wEmail && !EMAIL.test(wEmail)) fail(400, "Revisa el correo.");
    const item = {
      ...(prev || {}),
      id,
      name,
      role: clean(body.role, 40) || (prev?.owner ? "Barbero · Fundador" : "Barbero"),
      hours,
      services,
      commission,
      active,
      email: wEmail,
      ...(photo ? { image: `/api/team/${id}/photo?v=${Date.now()}` } : {}),
      ...(pin ? { pinHash: pinHash(id, pin) } : {}),
    };
    // Si se da de baja, se cierran sus sesiones del panel en el próximo acceso (staffOf ya no le deja).
    const team = prev ? TEAM.map((p) => (p.id === id ? item : p)) : [...TEAM, item];
    await pipe([["SET", "team", JSON.stringify(team)], ...(photo ? [["SET", "teamimg:" + id, photo]] : [])]);
    if (!prev) await setJSON("comm:" + id, []);
    TEAM = team;
    // Avisar si al darle de baja deja citas pendientes.
    let pending = 0;
    if (prev && !active) {
      const today = T.nowLocal().date;
      const sets = await pipe(Array.from({ length: RULES.daysAhead + 1 }, (_, i) => ["SMEMBERS", "day:" + T.addDays(today, i)]));
      pending = (await bookingsByIds([...new Set(sets.flat())])).filter((b) => b.provider.id === id && b.kind === "booking" && b.status === "confirmed" && !isPast(b, T.nowLocal())).length;
    }
    const { pinHash: _h, ...pub } = item;
    return { ok: true, worker: pub, pending };
  },

  // El dueño cambia el % de alguien desde un mes en adelante. Los meses de
  // antes se quedan con el % que tenían.
  "POST staff/commission": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Solo para el dueño.");
    const p = provider(body.provider);
    if (!p || p.owner) fail(400, "Elige un barbero del equipo.");
    const pct = Math.round(Number(body.pct) * 10) / 10;
    if (body.pct === "" || !Number.isFinite(pct) || pct < 0 || pct > 100) fail(400, "Pon un porcentaje entre 0 y 100.");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month || "")) fail(400, "Mes incorrecto.");
    const from = body.month + "-01";
    const list = ((await getJSON("comm:" + p.id)) || []).filter((e) => e.from < from);
    list.push({ from, pct, set: T.nowLocal().stamp });
    await setJSON("comm:" + p.id, list);
    return { ok: true };
  },

  "POST staff/commission/paid": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Solo para el dueño.");
    const p = provider(body.provider);
    if (!p || p.owner) fail(400, "Elige un barbero del equipo.");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month || "")) fail(400, "Mes incorrecto.");
    if (body.paid) await cmd("SET", `commpaid:${p.id}:${body.month}`, T.nowLocal().stamp);
    else await cmd("DEL", `commpaid:${p.id}:${body.month}`);
    return { ok: true };
  },
};

// ── Caja ───────────────────────────────────────────────────────────────────
const cents = (n) => Math.round(n * 100) / 100;

async function monthBookings(month) {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates = Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const sets = await pipe(dates.map((d) => ["SMEMBERS", "day:" + d]));
  const ids = [...new Set(sets.flat())];
  return (await bookingsByIds(ids)).filter((b) => b.kind === "booking" && b.date.startsWith(month));
}

// Cobros de caja: `pay:<id>`, con índices por día (`payday:`) y por mes (`paymonth:`).
async function monthPays(month) {
  return bookingsByIds2("pay:", await cmd("SMEMBERS", "paymonth:" + month));
}
const payLabel = (x) => x.items.map((it) => it.name).join(" + ") || "Cobro";

// Lo que llega del formulario de cobrar: barbero, servicio, extras, importe y forma de pago.
function readPay(body) {
  const p = provider(body.provider);
  if (!p) fail(400, "Elige quién ha hecho el servicio.");
  const items = [];
  if (body.service) {
    const s = service(body.service);
    if (!s || s.consult) fail(400, "Ese servicio no existe.");
    items.push({ id: s.id, name: s.name, price: Number(s.price) || 0 });
  }
  for (const id of [...new Set([].concat(body.extras || []))]) {
    const e = EXTRAS.find((x) => x.id === id);
    if (e) items.push({ id: e.id, name: e.name, price: e.price, extra: true });
  }
  if (!items.length) fail(400, "Elige el servicio que se ha hecho.");
  const amount = Math.round(Number(String(body.amount ?? "").replace(",", ".")) * 100) / 100;
  if (!(amount > 0 && amount <= 1000)) fail(400, "Pon el importe cobrado, en euros.");
  if (!PAY_METHODS.some((m) => m.id === body.method)) fail(400, "Elige cómo ha pagado.");
  return { provider: { id: p.id, name: p.name }, items, amount, method: body.method, name: clean(body.name, 60) || "Cliente sin cita", booking: clean(body.booking, 20) };
}
// Engancha el cobro a su cita: así la agenda la enseña como cobrada y el Club
// da los puntos por lo que se pagó de verdad.
async function linkPay(x, bookingId) {
  if (!bookingId) return;
  const b = await getJSON("bk:" + bookingId);
  if (!b || b.kind !== "booking") fail(404, "No existe esa cita.");
  if (b.status !== "confirmed") fail(400, "Esa cita está cancelada.");
  if (b.attendance === "absent") fail(400, "Esa cita está marcada como «No vino». Cámbialo antes en la agenda.");
  if (b.pay && b.pay.id !== x.id) fail(409, "Esa cita ya está cobrada.");
  await setJSON("bk:" + b.id, { ...b, attendance: "done", pay: { id: x.id, amount: x.amount, method: x.method } });
}
async function unlinkPay(x) {
  if (!x.booking) return;
  const b = await getJSON("bk:" + x.booking);
  if (b?.pay?.id !== x.id) return;
  const { pay, ...rest } = b;
  await setJSON("bk:" + b.id, rest);
}
// Quién puede tocar un cobro: el dueño, el barbero del cobro, quien lo apuntó
// o la caja (solo los de hoy, para corregir un error al momento).
const canTouchPay = (me, x) => me.owner || x.provider.id === me.id || x.by === me.id || (me.caja && x.date === T.nowLocal().date);

// Para el panel: cuántas veces ha faltado cada cliente y si tiene tarjeta guardada.
async function strikesAndCards(emails) {
  const list = [...new Set(emails.filter(Boolean))];
  const strikes = {},
    card = {};
  if (!list.length) return { strikes, card };
  const [sets, users] = await Promise.all([pipe(list.map((e) => ["SMEMBERS", "ubk:" + e])), cmd("MGET", ...list.map((e) => "user:" + e))]);
  const all = await bookingsByIds([...new Set(sets.flat())]);
  for (const b of all) if (b.status === "confirmed" && b.attendance === "absent") strikes[b.email] = (strikes[b.email] || 0) + 1;
  list.forEach((e, i) => (card[e] = !!(users[i] && JSON.parse(users[i]).card)));
  return { strikes, card };
}

// Un servicio cuenta como hecho cuando ya ha pasado su hora y nadie lo ha
// marcado como «No vino» (igual que los puntos del Club).
// Los cobros apuntados en caja cuentan por su importe real; las citas pasadas
// sin cobro apuntado, por el precio del servicio (y se avisa de cuántas son).
function statsOf(list, now, pays = []) {
  const live = list.filter((b) => b.status === "confirmed");
  const done = live.filter((b) => isPast(b, now) && b.attendance !== "absent");
  const upcoming = live.filter((b) => !isPast(b, now));
  const row = (b) => ({ id: b.id, date: b.date, start: b.start, name: b.name, service: b.service.name, price: Number(b.service.price) || 0, marked: b.attendance === "done", unpaid: true });
  const payRow = (x) => ({ id: x.id, date: x.date, start: x.time, name: x.name, service: payLabel(x), price: x.amount, method: x.method, pay: true });
  const byService = {};
  const add = (name, n, total) => {
    const x = (byService[name] ||= { name, count: 0, total: 0 });
    x.count += n;
    x.total = cents(x.total + total);
  };
  for (const b of done) add(b.service.name, 1, Number(b.service.price) || 0);
  for (const x of pays) {
    for (const it of x.items) add(it.name, 1, it.price);
    const rest = cents(x.amount - x.items.reduce((a, it) => a + it.price, 0));
    if (rest) add(rest > 0 ? "Suplementos y propinas" : "Descuentos", 1, rest);
  }
  const methods = Object.fromEntries(PAY_METHODS.map((m) => [m.id, 0]));
  for (const x of pays) methods[x.method] = cents((methods[x.method] || 0) + x.amount);
  const billed = cents(done.reduce((a, b) => a + (Number(b.service.price) || 0), 0) + pays.reduce((a, x) => a + x.amount, 0));
  const services = done.length + pays.length;
  return {
    services,
    billed,
    average: services ? cents(billed / services) : 0,
    collected: cents(pays.reduce((a, x) => a + x.amount, 0)),
    methods,
    unpaid: done.length,
    upcoming: upcoming.length,
    expected: cents(upcoming.reduce((a, b) => a + (Number(b.service.price) || 0), 0)),
    absent: live.filter((b) => b.attendance === "absent").length,
    // Lo cobrado a clientes que no vinieron (va aparte de lo facturado y no lleva comisión).
    penalties: cents(list.reduce((a, b) => a + ((b.attendance === "absent" || b.late) && b.charge?.status === "succeeded" ? b.charge.amount : 0), 0)),
    canceled: list.filter((b) => b.status === "canceled").length,
    byService: Object.values(byService).sort((a, b) => b.total - a.total),
    rows: [...done.map(row), ...pays.map(payRow)].sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)),
    upcomingRows: upcoming.map(row),
  };
}

async function commissionHistory(workers) {
  if (!workers.length) return {};
  const raw = await cmd("MGET", ...workers.map((p) => "comm:" + p.id));
  return Object.fromEntries(workers.map((p, i) => [p.id, raw[i] ? JSON.parse(raw[i]) : []]));
}
// El % que valía el día del servicio: el último cambio hecho antes de esa fecha.
function rateAt(id, history, date) {
  let pct = TEAM.find((p) => p.id === id)?.commission ?? COMMISSION[id] ?? 0;
  for (const e of [...history].sort((a, b) => a.from.localeCompare(b.from))) if (e.from <= date) pct = e.pct;
  return pct;
}

// Convierte "bookings/N12AB/cancel" en la ruta "bookings/:id/cancel".
function match(method, path) {
  const parts = path.split("/").filter(Boolean);
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(" ");
    if (m !== method) continue;
    const pp = pattern.split("/");
    if (pp.length !== parts.length) continue;
    const params = {};
    if (pp.every((x, i) => (x.startsWith(":") ? ((params[x.slice(1)] = parts[i]), true) : x === parts[i])))
      return { fn: routes[key], params };
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const url = new URL(req.url, "http://local");
  const path = url.searchParams.get("route") ?? url.pathname.replace(/^\/api\/?/, "");
  url.searchParams.delete("route");
  try {
    const hit = match(req.method, path);
    if (!hit) fail(404, "No existe.");
    if (req.method === "POST" && !String(req.headers["content-type"] || "").includes("application/json"))
      fail(415, "Petición incorrecta.");
    const body = req.method === "POST" ? await readBody(req) : {};
    await loadTeam();
    const out = await hit.fn({ req, res, body, q: url.searchParams, params: hit.params });
    res.statusCode = 200;
    if (out?.raw !== undefined) {
      res.setHeader("Content-Type", out.type);
      res.setHeader("Cache-Control", out.cache || "no-store");
      if (out.filename) res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
      return res.end(out.raw);
    }
    res.end(JSON.stringify(out ?? {}));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.setHeader("Cache-Control", "no-store"); // un error nunca se queda guardado en el CDN
    res.statusCode = status;
    res.end(
      JSON.stringify({
        // Los datos que acompañan al error (alternativas, «hace falta tarjeta»…) también llegan al móvil.
        ...(e instanceof HttpError ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== "status")) : {}),
        error: status >= 500 && !e.status ? "Algo ha fallado. Prueba otra vez." : e.message,
        ...(usingMemory() && status >= 500 ? { detail: String(e.message) } : {}),
      }),
    );
  }
}
