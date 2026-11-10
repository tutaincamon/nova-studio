// Una sola función para toda la API: vercel.json manda aquí /api/<lo que sea>.
import crypto from "node:crypto";
import { cmd, pipe, getJSON, setJSON, hgetall, usingMemory } from "./_lib/store.js";
import { SERVICES, PROVIDERS, RULES, BUSINESS, POINTS, MEDALS, REWARDS, COMMISSION, TRAINING, publicCatalog } from "./_lib/config.js";
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
    if (raw.length > 300000) fail(413, "Demasiados datos.");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    fail(400, "Petición mal formada.");
  }
}
const ip = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();

async function limit(key, max, seconds) {
  const n = await cmd("INCR", "rl:" + key);
  if (n === 1) await cmd("EXPIRE", "rl:" + key, seconds);
  if (n > max) fail(429, "Demasiados intentos. Espera unos minutos.");
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
async function staffOf(req) {
  const t = cookies(req)[STAFF];
  const id = t && (await cmd("GET", "staffsess:" + sha(t)));
  const p = id && PROVIDERS.find((x) => x.id === id);
  return p ? { id: p.id, name: p.name, owner: !!p.owner } : null;
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

  // Amigos: cuentan cuando han venido a su primer corte.
  const friendEmails = await cmd("SMEMBERS", "refs:" + u.email);
  const friends = [];
  if (friendEmails.length) {
    const lists = await pipe(friendEmails.map((e) => ["SMEMBERS", "ubk:" + e]));
    const users = await cmd("MGET", ...friendEmails.map((e) => "user:" + e));
    for (let i = 0; i < friendEmails.length; i++) {
      const theirs = await bookingsByIds(lists[i] || []);
      const firstCut = theirs
        .filter((b) => b.status === "confirmed" && isPast(b, now) && b.attendance !== "absent")
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
// Puntos de una cita: lo que costó el servicio × puntos por euro.
function pointsOf(b) {
  const price = b.service.price ?? SERVICES.find((s) => s.id === b.service.id)?.price ?? 15;
  return Math.round(price * POINTS.perEuro);
}
async function bookingsByIds2(prefix, ids) {
  if (!ids.length) return [];
  const raw = await cmd("MGET", ...ids.map((id) => prefix + id));
  return raw.filter(Boolean).map((x) => JSON.parse(x));
}

// ── Agenda ─────────────────────────────────────────────────────────────────
const service = (id) => SERVICES.find((s) => s.id === id);
const provider = (id) => PROVIDERS.find((p) => p.id === id);
const canDo = (s, p) => !s.providers?.length || s.providers.includes(p.id);
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

function freeTimes(p, s, date, busy, now) {
  const last = T.addDays(now.date, RULES.daysAhead);
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

// Cada tramo de 15 min de la cita se aparta con SET NX: si dos personas pulsan
// a la vez la misma hora, solo una se la lleva. Los tramos que ya son de esta
// misma cita (al cambiarla de hora) cuentan como suyos.
async function holdSlot(b) {
  const keys = lockKeys(b);
  const got = await pipe(keys.map((k) => ["SET", k, b.id, "NX", "EX", 120 * 86400]));
  const missing = keys.filter((_, i) => got[i] !== "OK");
  if (!missing.length) return;
  const owners = await cmd("MGET", ...missing);
  if (owners.every((o) => o === b.id)) return;
  const mine = keys.filter((_, i) => got[i] === "OK");
  if (mine.length) await cmd("DEL", ...mine);
  fail(409, "Esa hora se acaba de ocupar. Elige otra, por favor.");
}
async function releaseSlot(b, keep = []) {
  const keys = lockKeys(b).filter((k) => !keep.includes(k));
  const owners = keys.length ? await cmd("MGET", ...keys) : [];
  const mine = keys.filter((_, i) => owners[i] === b.id);
  const ops = [["HDEL", `occ:${b.provider.id}:${monthOf(b.date)}`, b.id]];
  if (mine.length) ops.push(["DEL", ...mine]);
  await pipe(ops);
}
async function saveNew(b) {
  await pipe([
    ["SET", "bk:" + b.id, JSON.stringify(b)],
    ["HSET", `occ:${b.provider.id}:${monthOf(b.date)}`, b.id, `${b.date}|${b.start}|${b.end}`],
    ["SADD", "day:" + b.date, b.id],
    ...(b.email ? [["SADD", "ubk:" + b.email, b.id]] : []),
  ]);
}

async function bookingsByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 300) {
    const raw = await cmd("MGET", ...ids.slice(i, i + 300).map((id) => "bk:" + id));
    out.push(...raw.filter(Boolean).map((x) => JSON.parse(x)));
  }
  return out;
}
const isPast = (b, now) => b.date + " " + b.start < now.stamp;
const isActive = (b, now) => b.status === "confirmed" && !isPast(b, now);

function validSlotInput(body) {
  const s = service(body.service),
    p = provider(body.provider);
  if (!s || s.consult) fail(400, "Ese servicio no se reserva por aquí.");
  if (!p || !canDo(s, p)) fail(400, "Ese barbero no hace este servicio.");
  if (!T.isDate(body.date) || !T.isTime(body.start)) fail(400, "Elige día y hora.");
  return { s, p };
}
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

// ── Rutas ──────────────────────────────────────────────────────────────────
const routes = {
  "GET catalog": async () => ({ ...publicCatalog(), card: Card.cardPublic() }),

  "GET me": async ({ req, res }) => {
    let u = await currentUser(req);
    if (u && !u.ref) u = await ensureUser(u.email);
    // Cada vez que se abre la app, la sesión vuelve a valer un año: quien viene
    // una vez al mes no tiene que volver a entrar nunca en ese móvil.
    const ck = cookies(req);
    if (u && ck[SESSION]) {
      await cmd("EXPIRE", "sess:" + sha(ck[SESSION]), YEAR);
      cookie(res, req, SESSION, ck[SESSION], YEAR);
    }
    if (ck[STAFF] && (await staffOf(req))) {
      await cmd("EXPIRE", "staffsess:" + sha(ck[STAFF]), YEAR);
      cookie(res, req, STAFF, ck[STAFF], YEAR);
    }
    return { user: publicUser(u), staff: await staffOf(req), mail: mailReady(), loginCode: LOGIN_CON_CODIGO };
  },

  "GET referral/:code": async ({ params }) => {
    const code = String(params.code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const email = code && (await cmd("GET", "refcode:" + code));
    if (!email) fail(404, "Ese código no existe.");
    const u = await getJSON("user:" + email);
    return { name: String(u?.name || "un socio").split(" ")[0], points: POINTS.perFriend };
  },

  "GET avail": async ({ q }) => {
    const s = service(q.get("service")),
      p = provider(q.get("provider")),
      month = q.get("month") || "";
    if (!s || s.consult || !p || !canDo(s, p) || !/^\d{4}-\d{2}$/.test(month)) fail(400, "Petición incorrecta.");
    const now = T.nowLocal(),
      busy = await busyOf(p.id, month),
      [y, m] = month.split("-").map(Number),
      total = new Date(Date.UTC(y, m, 0)).getUTCDate(),
      days = {};
    for (let d = 1; d <= total; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      days[date] = freeTimes(p, s, date, busy, now);
    }
    return { days };
  },

  "POST book": async ({ req, res, body }) => {
    const { s, p } = validSlotInput(body);
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

    const now = T.nowLocal();
    const mine = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + email));
    if (mine.filter((b) => isActive(b, now)).length >= RULES.maxActive)
      fail(400, `Ya tienes ${RULES.maxActive} citas pendientes. Cuando pase alguna podrás reservar otra.`);

    const busy = await busyOf(p.id, monthOf(body.date));
    if (!freeTimes(p, s, body.date, busy, now).includes(body.start))
      fail(409, "Esa hora ya no está libre. Elige otra, por favor.");

    const b = makeBooking(s, p, body.date, body.start, {
      email,
      name,
      phone,
      by: "client",
      ...(user?.card ? { guarantee: { brand: user.card.brand, last4: user.card.last4, at: now.stamp } } : {}),
    });
    await holdSlot(b);
    await saveNew(b);

    // Cuenta: si el correo es nuevo, se crea y se queda dentro en este móvil.
    // Si ya existía, la cita se guarda igual pero para verla hay que entrar con código.
    let session = !!user,
      existing = false;
    if (user) await ensureUser(email, name, phone);
    else if (await getJSON("user:" + email)) existing = true;
    else {
      await registerNew(req, res, { email, name, phone, ref: body.ref }); // ¿viene invitado? lo apunta
      session = true;
    }

    await Promise.all([
      send(
        email,
        `Cita reservada · ${T.niceDate(b.date)} ${b.start}`,
        "Tu cita está reservada",
        bookingLines(b, T.niceDate(b.date)) +
          `<p style="margin:14px 0 0;color:#64645e;font-size:13px">Puedes cambiarla o cancelarla desde la app hasta ${RULES.cancelHours} h antes. Referencia ${b.id}.</p>`,
      ),
      notifySalon(b, "Nueva cita"),
    ]);
    return { id: b.id, session, existing };
  },

  "GET bookings": async ({ req }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra para ver tus citas.");
    const now = T.nowLocal();
    const list = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + u.email));
    const key = (b) => b.date + " " + b.start;
    const upcoming = list.filter((b) => isActive(b, now)).sort((a, b) => key(a).localeCompare(key(b)));
    const past = list.filter((b) => !isActive(b, now)).sort((a, b) => key(b).localeCompare(key(a)));
    return { upcoming, past, now: now.stamp };
  },

  "GET bookings/:id": async ({ req, params }) => {
    const b = await getJSON("bk:" + params.id);
    const u = await currentUser(req);
    if (!b || !((u && u.email === b.email) || (await staffOf(req)))) fail(404, "No encontramos esa cita.");
    const mins = T.minutesUntil(b.date, b.start);
    return { booking: b, canChange: b.status === "confirmed" && mins >= RULES.cancelHours * 60, past: mins < 0 };
  },

  "POST bookings/:id/cancel": async ({ req, params }) => {
    const b = await getJSON("bk:" + params.id);
    const u = await currentUser(req),
      staff = canManage(await staffOf(req), b?.provider.id);
    if (!b || !((u && u.email === b.email) || staff)) fail(404, "No encontramos esa cita.");
    if (b.status !== "confirmed") return { ok: true };
    if (!staff && T.minutesUntil(b.date, b.start) < RULES.cancelHours * 60)
      fail(400, `Quedan menos de ${RULES.cancelHours} horas. Escríbenos por WhatsApp y lo vemos.`);
    await releaseSlot(b);
    const done = { ...b, status: "canceled", canceledBy: staff ? "staff" : "client", canceledAt: T.nowLocal().stamp };
    await setJSON("bk:" + b.id, done);
    if (!staff && b.kind === "booking") await notifySalon(b, "Cita cancelada");
    return { ok: true };
  },

  "POST bookings/:id/move": async ({ req, params, body }) => {
    const b = await getJSON("bk:" + params.id);
    const u = await currentUser(req),
      staff = canManage(await staffOf(req), b?.provider.id);
    if (!b || !((u && u.email === b.email) || staff)) fail(404, "No encontramos esa cita.");
    if (b.status !== "confirmed") fail(400, "Esta cita ya no está activa.");
    if (!staff && T.minutesUntil(b.date, b.start) < RULES.cancelHours * 60)
      fail(400, `Quedan menos de ${RULES.cancelHours} horas. Escríbenos por WhatsApp y lo vemos.`);
    const s = service(b.service.id),
      p = provider(b.provider.id);
    if (!T.isDate(body.date) || !T.isTime(body.start)) fail(400, "Elige día y hora.");
    const busy = await busyOf(p.id, monthOf(body.date), b.id);
    if (!freeTimes(p, s, body.date, busy, T.nowLocal()).includes(body.start))
      fail(409, "Esa hora ya no está libre. Elige otra, por favor.");
    const moved = { ...b, date: body.date, start: body.start, end: T.toHHMM(T.toMin(body.start) + b.service.duration) };
    await holdSlot(moved);
    await releaseSlot(b, lockKeys(moved));
    await pipe([
      ["SET", "bk:" + b.id, JSON.stringify(moved)],
      ["HSET", `occ:${p.id}:${monthOf(moved.date)}`, b.id, `${moved.date}|${moved.start}|${moved.end}`],
      ["SREM", "day:" + b.date, b.id],
      ["SADD", "day:" + moved.date, b.id],
    ]);
    if (!staff) await notifySalon(moved, "Cita cambiada");
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
    const p = provider(body.provider);
    if (!p) fail(400, "Elige quién eres.");
    const pin = pinOf(p);
    if (!pin) fail(400, `La clave de ${p.name.split(" ")[0]} aún no está puesta.`);
    if (!same(String(body.pin || ""), pin)) fail(400, "Clave incorrecta.");
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
    await needStaff(req);
    const date = q.get("date");
    if (!T.isDate(date)) fail(400, "Fecha incorrecta.");
    const list = (await bookingsByIds(await cmd("SMEMBERS", "day:" + date)))
      .filter((b) => b.date === date)
      .sort((a, b) => a.start.localeCompare(b.start));
    const info = await strikesAndCards(list.map((b) => b.email));
    return {
      date,
      providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, hours: p.hours[T.weekday(date)] || [] })),
      bookings: list.map((b) => (b.email ? { ...b, strikes: info.strikes[b.email] || 0, card: !!info.card[b.email] } : b)),
      cardEnabled: Card.cardEnabled(),
      now: T.nowLocal().stamp,
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
    if (b.status !== "confirmed" || b.attendance !== "absent") fail(400, "Primero márcala como «No vino».");
    if (!isPast(b, T.nowLocal())) fail(400, "Aún no ha llegado la hora de la cita.");
    if (b.charge && b.charge.status !== "requires_payment_method") fail(400, "Esta falta ya está cobrada o pendiente de que el cliente la confirme.");
    const u = b.email && (await getJSON("user:" + b.email));
    if (!u?.card || !u.stripe) fail(400, "Este cliente no tiene tarjeta guardada. Habla con él por WhatsApp.");
    const amount = Math.round((Number(b.service.price) || 0) * 100);
    if (amount < 50) fail(400, "Este servicio no tiene precio para cobrar.");
    if ((await cmd("SET", "chargelock:" + b.id, me.id, "NX", "EX", 60)) !== "OK") fail(429, "Ya se está cobrando…");
    try {
      const tries = (b.charge?.tries || 0) + 1;
      const r = await Card.chargeOffSession({
        customer: u.stripe,
        pm: u.card.pm,
        amount,
        description: `NOVA Studio · No presentado · ${b.service.name} ${b.date} ${b.start}`,
        metadata: { booking: b.id, barber: b.provider.id, by: me.id },
        idem: `noshow-${b.id}-${tries}`,
      });
      const charge = { ...r, amount: amount / 100, brand: u.card.brand, last4: u.card.last4, tries, at: T.nowLocal().stamp, by: me.id };
      await setJSON("bk:" + b.id, { ...b, charge });
      if (r.status !== "succeeded") {
        const host = req.headers.host ? `https://${req.headers.host}` : "";
        await send(
          b.email,
          `Pago pendiente · cita del ${T.niceDate(b.date)}`,
          "Tienes un pago pendiente",
          `<p style="margin:0 0 12px">No viniste a tu cita de ${b.service.name} del ${T.niceDate(b.date)} a las ${b.start} y no la cancelaste a tiempo, así que según las condiciones que aceptaste se cobra el servicio (${amount / 100} €).</p>
           <p style="margin:0 0 12px">Tu banco no ha dejado hacer el cobro automático. Puedes completarlo desde la app${host ? `: <a href="${host}/#booking/${b.id}">${host}/#booking/${b.id}</a>` : "."}</p>`,
        ).catch(() => {});
      }
      return { charge };
    } finally {
      await cmd("DEL", "chargelock:" + b.id);
    }
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
      .filter((b) => b.status === "confirmed" && b.attendance === "absent" && canManage(me, b.provider.id))
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
    const cards = await strikesAndCards(list.map((b) => b.email));
    return {
      month,
      list: list.map((b) => ({ ...b, card: !!cards.card[b.email], strikes: cards.strikes[b.email] || 0 })),
      charged: cents(list.reduce((a, b) => a + (b.charge?.status === "succeeded" ? b.charge.amount : 0), 0)),
      pending: cents(list.reduce((a, b) => a + (b.charge && b.charge.status !== "succeeded" && b.charge.status !== "refunded" ? b.charge.amount : 0), 0)),
      uncharged: list.filter((b) => !b.charge).length,
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
    await holdSlot(b);
    await saveNew(b);
    if (b.email) await ensureUser(b.email, b.name, b.phone);
    return { id: b.id };
  },

  // Caja del mes. Cada barbero ve solo lo suyo y sin comisiones; el dueño ve
  // a todo el equipo, el % de cada uno y lo que le toca cobrar.
  "GET staff/summary": async ({ req, q }) => {
    const me = await needStaff(req);
    const month = q.get("month") || T.nowLocal().date.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400, "Mes incorrecto.");
    const now = T.nowLocal();
    const all = await monthBookings(month);
    const team = PROVIDERS.filter((p) => me.owner || p.id === me.id);
    const people = team.map((p) => ({ id: p.id, name: p.name, owner: !!p.owner, ...statsOf(all.filter((b) => b.provider.id === p.id), now) }));
    const lean = () => people.forEach((x) => delete x.upcomingRows);
    if (!me.owner) return lean(), { month, owner: false, people };

    const workers = PROVIDERS.filter((p) => !p.owner);
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
function statsOf(list, now) {
  const live = list.filter((b) => b.status === "confirmed");
  const done = live.filter((b) => isPast(b, now) && b.attendance !== "absent");
  const upcoming = live.filter((b) => !isPast(b, now));
  const row = (b) => ({ id: b.id, date: b.date, start: b.start, name: b.name, service: b.service.name, price: Number(b.service.price) || 0, marked: b.attendance === "done" });
  const byService = {};
  for (const b of done) {
    const x = (byService[b.service.name] ||= { name: b.service.name, count: 0, total: 0 });
    x.count++;
    x.total = cents(x.total + (Number(b.service.price) || 0));
  }
  const billed = cents(done.reduce((a, b) => a + (Number(b.service.price) || 0), 0));
  return {
    services: done.length,
    billed,
    average: done.length ? cents(billed / done.length) : 0,
    upcoming: upcoming.length,
    expected: cents(upcoming.reduce((a, b) => a + (Number(b.service.price) || 0), 0)),
    absent: live.filter((b) => b.attendance === "absent").length,
    // Lo cobrado a clientes que no vinieron (va aparte de lo facturado y no lleva comisión).
    penalties: cents(live.reduce((a, b) => a + (b.attendance === "absent" && b.charge?.status === "succeeded" ? b.charge.amount : 0), 0)),
    canceled: list.filter((b) => b.status === "canceled").length,
    byService: Object.values(byService).sort((a, b) => b.total - a.total),
    rows: done.map(row).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)),
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
  let pct = COMMISSION[id] ?? 0;
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
    const out = await hit.fn({ req, res, body, q: url.searchParams, params: hit.params });
    res.statusCode = 200;
    if (out?.raw !== undefined) {
      res.setHeader("Content-Type", out.type);
      res.setHeader("Cache-Control", out.cache || "no-store");
      return res.end(out.raw);
    }
    res.end(JSON.stringify(out ?? {}));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.statusCode = status;
    res.end(
      JSON.stringify({
        error: status >= 500 && !e.status ? "Algo ha fallado. Prueba otra vez." : e.message,
        ...(usingMemory() && status >= 500 ? { detail: String(e.message) } : {}),
      }),
    );
  }
}
