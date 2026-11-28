// Una sola función para toda la API: vercel.json manda aquí /api/<lo que sea>.
import crypto from "node:crypto";
import { cmd, pipe, getJSON, setJSON, hgetall, usingMemory, scanKeys, dumpKeys, claim, hit } from "./_lib/store.js";
import { SERVICES, PROVIDERS, RULES, BUSINESS, POINTS, MEDALS, REWARDS, COMMISSION, TRAINING, EXTRAS, PAY_METHODS, SHOP, MEMBERSHIP, publicCatalog } from "./_lib/config.js";
import * as T from "./_lib/time.js";
import { codeMail, send, sendDetailed, shell, bookingLines, mailReady } from "./_lib/mail.js";
import * as Card from "./_lib/stripe.js";
import * as Sup from "./_lib/supply.js";
import * as Shop from "./_lib/shop.js";
import * as Of from "./_lib/oferta.js";
import { accessPolicy, MAIL_NOT_READY } from "./_lib/access.js";
import * as Tokens from "./_lib/assistant.js";
import * as E from "./_lib/earnings.js";
import * as M from "./_lib/membership.js";
import { serveMcp } from "./_lib/mcp.js";
import * as R from "./_lib/reengage.js";

const ON_VERCEL = !!process.env.VERCEL;
// Para entrar hace falta el código de 6 cifras del correo. En Vercel no hay
// forma de saltárselo. El teléfono está preparado en la API (auth/request
// acepta `phone`) pero apagado hasta elegir cómo mandar SMS o WhatsApp.
const authChannels = () => accessPolicy();
const SESSION = "nova_s",
  STAFF = "nova_staff",
  MONTH = 30 * 86400,
  YEAR = 365 * 86400, // la sesión del cliente dura un año y se renueva sola
  CAJA_TTL = 12 * 3600, // la tablet de caja caduca a las 12 h, no al año
  PIN_FAILS = 5,
  PIN_WINDOW = 1800; // 5 claves mal puestas bloquean 30 minutos
const staffTtl = (st) => (st?.caja ? CAJA_TTL : YEAR);
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
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const secure = ON_VERCEL || proto === "https";
  // Expires además de Max-Age: la PWA de iOS a veces ignora Max-Age solo.
  // SameSite=Lax y Secure: es cookie de primera parte, la guarda Safari, la
  // app de la pantalla de inicio (iOS) y Chrome instalada (Android), y el
  // service worker no la intercepta. Cada visita la renueva (/api/me).
  const exp = new Date(Date.now() + Math.max(0, maxAge) * 1000).toUTCString();
  const c = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${exp}${secure ? "; Secure" : ""}`;
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
  // Una clave nueva. No borra las otras de ese correo: entrar en otro móvil,
  // o pedir otro código, no cierra la sesión que ya estaba abierta. Solo
  // «Cerrar sesión» borra la de este dispositivo.
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
    await pipe([
      ["SADD", "users", email],
      ["DEL", "contacts:list"],
    ]);
  } else if ((name && !u.name) || (phone && !u.phone) || !u.ref) {
    u = { ...u, name: u.name || name, phone: u.phone || phone };
    if (!u.ref) u.ref = await makeRefCode(email, u.name);
    await setJSON("user:" + email, u);
  }
  return u;
}
// ── Entrar con el código del correo ──────────────────────────────────────
// Lo mismo para la web y para el asistente de IA (MCP). Entrar o darse de alta
// es lo mismo: se pone el correo, llega un código de 6 cifras y con él se entra.
// La cuenta se crea al acertar el código, nunca antes: así no hay cuentas con
// correos de otros. (El teléfono, ver authChannels.)
// Devuelve { email, direct: true } si se entra sin código (LOGIN_CON_CODIGO=0
// en local o MODO_DEMO=1) o { email, challenge, dev? } con el código ya enviado.
async function codeRequest(rawEmail, from) {
  const email = normEmail(rawEmail);
  if (!EMAIL.test(email)) fail(400, "Revisa tu correo.");
  const policy = accessPolicy();
  // En producción, sin correo configurado, no se abre sesión ni se guarda el código.
  if (policy.code && process.env.VERCEL && !mailReady()) fail(503, MAIL_NOT_READY);
  await limit("auth:" + email, 5, 900);
  await limit("authip:" + from, 20, 900);
  if (policy.direct) return { email, direct: true };
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0"),
    challenge = token();
  await setJSON("code:" + challenge, { email, h: sha(code + challenge), tries: 0 }, "EX", 600);
  if (mailReady()) {
    if (!(await codeMail(email, code))) fail(502, "No hemos podido enviar el correo. Prueba otra vez en un rato.");
    return { email, challenge };
  }
  if (ON_VERCEL) fail(503, "Ahora mismo no podemos enviar el código por correo. Escríbenos por WhatsApp y te ayudamos.");
  console.log(`\n  Código de acceso para ${email}: ${code}\n`);
  return { email, challenge, dev: true };
}
// Comprueba el código (5 intentos). Si es bueno devuelve el correo y `consume`,
// que lo gasta: quien llama decide cuándo (el asistente no lo gasta si aún
// falta el nombre de una cuenta nueva).
async function codeCheck(challenge, code) {
  const key = "code:" + String(challenge || "").slice(0, 64);
  const c = await getJSON(key);
  if (!c) fail(400, "El código ha caducado. Pide otro.");
  if (c.tries >= 5) {
    await cmd("DEL", key);
    fail(400, "Demasiados intentos. Pide otro código.");
  }
  if (!same(c.h, sha(String(code || "").trim() + challenge))) {
    await setJSON(key, { ...c, tries: c.tries + 1 }, "EX", 600);
    fail(400, "Ese código no es correcto.");
  }
  return { email: c.email, consume: () => cmd("DEL", key) };
}
// Abre (o crea) la cuenta de un correo ya comprobado.
async function enterAccount(email, { verified = false } = {}) {
  const fresh = !(await getJSON("user:" + email));
  let u = await ensureUser(email);
  if (verified && !u.verified) {
    u = { ...u, verified: T.nowLocal().stamp };
    await setJSON("user:" + u.email, u);
  }
  await rankTouch(email);
  return { u, fresh };
}
// Nombre (el del ranking), teléfono opcional y código del amigo que te invitó.
async function saveName(u, body) {
  const name = clean(body.name, 60);
  if (name.length < 2) fail(400, "Falta tu nombre.");
  const phone = body.phone === undefined ? u.phone || "" : clean(body.phone, 30);
  if (phone && !PHONE.test(phone)) fail(400, "Revisa tu teléfono.");
  const code = String(body.ref || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  let by = null;
  if (code && !u.referredBy) {
    const referrer = await cmd("GET", "refcode:" + code);
    if (!referrer) fail(400, "Ese código de amigo no existe. Revísalo o bórralo.");
    // Solo cuenta como invitación en una cuenta recién hecha (sin citas aún).
    if (referrer !== u.email && !(await cmd("SMEMBERS", "ubk:" + u.email)).length) by = referrer;
  }
  const first = !u.name;
  u = { ...u, name, phone, ...(by ? { referredBy: by } : {}) };
  // La cuenta se creó sin nombre (código NOVA123): ahora que lo hay, uno con su nombre (CARLOS482).
  const oldRef = first && /^NOVA/.test(u.ref || "") ? u.ref : "";
  if (oldRef) u.ref = await makeRefCode(u.email, name);
  await setJSON("user:" + u.email, u);
  if (oldRef && (await cmd("GET", "refcode:" + oldRef)) === u.email) await cmd("DEL", "refcode:" + oldRef);
  await pipe([...(by ? [["SADD", "refs:" + by, u.email]] : []), ["DEL", "contacts:list"]]);
  await rankTouch(u.email, by);
  return u;
}

// De la tarjeta solo se enseña la marca, los 4 últimos números y la caducidad.
const publicCard = (c) => (c ? { brand: c.brand, last4: c.last4, exp: c.exp } : null);
const publicUser = (u) =>
  u && {
    email: u.email,
    name: u.name,
    phone: u.phone,
    no: u.no,
    photo: u.photo || "",
    ref: u.ref || "",
    since: u.created,
    card: publicCard(u.card),
    rank: !u.rankHidden,
    rankName: u.name ? rankName(u.name) : "",
  };

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
  // Una cita cuenta para el Club (puntos, medallas, rachas) cuando está cobrada
  // en Caja, no al reservar ni al pasar la hora. Si se quita el cobro, se van.
  const done = mine.filter((b) => b.kind === "booking" && b.status === "confirmed" && b.pay && b.attendance !== "absent");
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
    review: (await cmd("GET", "reviewed:" + u.email)) ? 1 : 0,
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
// Puntos de una cita cobrada: lo que se pagó en caja × puntos por euro.
function pointsOf(b) {
  // Una cita incluida en la membresía se cobra a 0 €, pero el socio sigue sumando puntos por el valor del servicio.
  const price = b.membership?.included ? (b.service.price ?? 15) : (b.pay?.amount ?? b.service.price ?? SVCS.find((s) => s.id === b.service.id)?.price ?? 15);
  return Math.round(price * POINTS.perEuro);
}
async function bookingsByIds2(prefix, ids) {
  if (!ids.length) return [];
  const raw = await cmd("MGET", ...ids.map((id) => prefix + id));
  return raw.filter(Boolean).map((x) => JSON.parse(x));
}

// ── Ranking del Club ────────────────────────────────────────────────────────
// Ordena a los socios por puntos GANADOS (canjear premios no te hace bajar),
// de siempre, entre todos o solo entre amigos.
//  · lb:all                   lista ordenada correo → puntos (solo quien sale en el general)
//  · lb:u                     ficha corta de cada socio del ranking: nombre que se enseña, Nº, puntos…
//  · lb:ver                   sube con cada cambio: el móvil pregunta cada pocos segundos si ha cambiado
//  · fr:<correo>              amigos añadidos con su código (en los dos sentidos); frx:<correo>, quitados
// Sale en el ranking quien tiene nombre, ha entrado en la app (código o sesión)
// y no es del equipo. Las cuentas que crea el equipo al apuntar una cita no
// salen hasta que su dueño entra. Sale el nombre o apodo que eligió el socio.
const RANK_TOP = 50;
const RANK_V = 4; // subir si cambia cómo se calcula: el ranking se rehace solo
const rankCfg = () => sha(JSON.stringify([RANK_V, POINTS, MEDALS.map((m) => [m.id, m.metric, m.goal, m.bonus])])).slice(0, 12);
// Tal cual lo escribió el socio (su nombre o un apodo), hasta 20 letras.
// Si pasa de 20, se corta en la última palabra entera.
function rankName(name) {
  const s = clean(name, 60);
  if (s.length <= 20) return s;
  const cut = s.slice(0, 21);
  return cut.includes(" ") ? cut.replace(/\s+\S*$/, "") : s.slice(0, 20);
}
async function teamEmails() {
  const cfgs = TEAM.length ? await cmd("MGET", ...TEAM.map((p) => "staffcfg:" + p.id)) : [];
  return new Set(TEAM.flatMap((p, i) => [p.email, cfgs[i] && JSON.parse(cfgs[i]).email]).filter(Boolean).map((e) => e.toLowerCase()));
}
// Vuelve a calcular a un socio y, si algo ha cambiado, lo apunta y avisa a los
// móviles que miran el ranking (lb:ver). Devuelve su cuenta.
async function syncRank(email, team) {
  const [raw, seen, old] = await pipe([
    ["GET", "user:" + email],
    ["GET", "seen:" + email],
    ["HGET", "lb:u", email],
  ]);
  const u = raw ? JSON.parse(raw) : null;
  team ||= await teamEmails();
  if (!u || !u.name || !(u.verified || seen) || team.has(email)) {
    if (old) await rankDrop(email);
    return u;
  }
  const c = await clubOf(u);
  const e = {
    id: rankEntry(old)?.id || crypto.randomBytes(5).toString("hex"), // lo que ve el móvil en vez del correo
    n: rankName(u.name),
    no: u.no || 0,
    a: c.earned,
    c: dayOf(u.created),
    ...(c.metrics.year ? { y: 1 } : {}),
    ...(u.rankHidden ? { h: 1 } : {}),
    ...(u.photo ? { ph: sha(u.photo).slice(0, 8) } : {}), // cambia con la foto: el móvil la vuelve a pedir
  };
  const s = JSON.stringify(e);
  if (s === old) return u;
  const ops = [
    ["HSET", "lb:u", email, s],
    ["HSET", "lb:id", e.id, email], // para dar la foto sin enseñar el correo
    ["INCR", "lb:ver"],
  ];
  ops.push(e.h ? ["ZREM", "lb:all", email] : ["ZADD", "lb:all", e.a, email]);
  await pipe(ops);
  return u;
}
async function rankDrop(email) {
  const id = rankEntry(await cmd("HGET", "lb:u", email))?.id;
  await pipe([["HDEL", "lb:u", email], ["ZREM", "lb:all", email], ...(id ? [["HDEL", "lb:id", id]] : []), ["INCR", "lb:ver"]]);
}
// Tras algo que cambia puntos (un cobro, una compra, «Vino»…): se recalcula al
// socio y a quien le invitó (sus puntos por amigo dependen de esa primera cita).
// Si falla, se apunta y lo arregla la pasada de cada hora; nunca rompe lo demás.
async function rankTouch(...emails) {
  for (const email of new Set(emails.filter(Boolean))) {
    try {
      const u = await syncRank(email);
      if (u?.referredBy) await syncRank(u.referredBy);
    } catch (e) {
      console.error("ranking", e);
      await cmd("SADD", "lb:dirty", email).catch(() => {});
    }
  }
}
// Rehace el ranking entero (la primera vez, o si cambian los puntos del Club),
// por tandas: sigue donde lo dejó hasta acabar.
async function rankRebuild(budgetMs) {
  if ((await cmd("SET", "lock:lbrb", "1", "NX", "EX", 120)) !== "OK") return { busy: true };
  try {
    const emails = (await allEmails()).sort(),
      team = await teamEmails(),
      t0 = Date.now();
    let i = Number(await cmd("GET", "lb:rb")) || 0;
    for (; i < emails.length && Date.now() - t0 < budgetMs; i++)
      await syncRank(emails[i], team).catch((e) => console.error("ranking", emails[i], e));
    if (i < emails.length) {
      await cmd("SET", "lb:rb", String(i), "EX", 7 * 86400);
      return { done: false, at: i, of: emails.length };
    }
    await pipe([
      ["SET", "lb:cfg", rankCfg()],
      ["DEL", "lb:rb"],
      ["INCR", "lb:ver"],
    ]);
    return { done: true, of: emails.length };
  } finally {
    await cmd("DEL", "lock:lbrb");
  }
}
// La pasada de cada hora: acaba de rehacer si hace falta, arregla lo que falló
// y, una vez al día, da la medalla del año a quien cumple un año en el Club.
async function rankMaintain(now) {
  const out = {};
  // Tandas cortas: la pasada hace más cosas y la función no debe pasarse de tiempo; lo que falte, a la siguiente.
  if ((await cmd("GET", "lb:cfg")) !== rankCfg()) out.rebuild = await rankRebuild(8000);
  const dirty = await cmd("SPOP", "lb:dirty", 50);
  if (dirty?.length) await rankTouch(...dirty);
  if ((await cmd("SET", "lbday:" + now.date, "1", "NX", "EX", 2 * 86400)) === "OK") {
    const line = T.addDays(now.date, -365);
    const due = Object.entries(hgetall(await cmd("HGETALL", "lb:u")))
      .filter(([, raw]) => {
        const e = JSON.parse(raw);
        return !e.y && e.c && e.c <= line;
      })
      .map(([email]) => email);
    for (const email of due.slice(0, 200)) await rankTouch(email);
    out.year = due.length;
  }
  return out;
}
// Amigos: los añadidos con su código y los de las invitaciones (a quien
// invitaste y quien te invitó), menos los que has quitado.
async function friendsOf(u) {
  const [fr, refs, gone] = await pipe([
    ["SMEMBERS", "fr:" + u.email],
    ["SMEMBERS", "refs:" + u.email],
    ["SMEMBERS", "frx:" + u.email],
  ]);
  const out = new Set([...fr, ...refs, u.referredBy].filter((e) => e && e !== u.email));
  for (const e of gone) out.delete(e);
  return [...out];
}
const rankEntry = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
// Puesto con empates: 1, 2, 2, 4…
function withRanks(rows) {
  let prev = null,
    r = 0;
  rows.forEach((x, i) => {
    if (x.p !== prev) r = i + 1;
    prev = x.p;
    x.r = r;
  });
  return rows;
}

// ── Fotos de la web y reseñas (editables por el dueño) ────────────────────
// Cada hueco de foto tiene una por defecto (en /assets). Si el dueño sube otra,
// se guarda en `siteimg:<hueco>` y la web la pide a /api/site/<hueco>/photo.
// Trabajos recientes (galería de la portada): hasta 6 huecos, sin foto por defecto.
const GALLERY = ["trabajo1", "trabajo2", "trabajo3", "trabajo4", "trabajo5", "trabajo6"];
const SITE_SLOTS = [
  { id: "logo", label: "Logo", where: "Cabecera y billete de la reserva", def: "/assets/logo.png", max: 600, logo: true },
  ...GALLERY.map((id, i) => ({ id, label: `Trabajo reciente ${i + 1}`, where: "Galería «Trabajos recientes» de la portada", def: "", max: 1200 })),
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
// Nota, número y últimas reseñas que enseña la web. Salen de la ficha de Google
// (Places API) cuando hay clave (GOOGLE_PLACES_KEY) y el dueño ha elegido su
// ficha en la pestaña Web; si no, de la página de Booksy, como antes. Se leen
// como mucho cada 12 h; si falla, se queda el último valor bueno, con la fuente
// que tenía (nunca se enseña una nota de Booksy con el nombre de Google). El
// dueño también puede fijar nota y número a mano.
async function siteInfo() {
  const site = (await getJSON("site")) || {};
  let r = site.rating || {};
  const want = ratingWant(site);
  const stale = !r.at || Date.now() - r.at > 12 * 3600 * 1000 || r.want !== want;
  if (r.mode !== "manual" && stale && (await cmd("SET", "lock:rating", "1", "NX", "EX", 600)) === "OK") {
    r = await refreshRating(r, site);
    await setJSON("site", { ...site, rating: r });
  }
  return { photos: site.photos || {}, rating: r, google: site.google || null, theme: themeOf(site), contact: site.contact || {}, notice: site.notice || null };
}
const ratingWant = (site) => (site.google?.placeId && googleOn() ? "google" : "booksy");
// Vuelve a leer la fuente que toca. Lo que no se pudo leer se queda como estaba.
async function refreshRating(r, site) {
  const want = ratingWant(site),
    base = { ...r, mode: "auto", at: Date.now(), want };
  if (want === "booksy") {
    const got = await readBooksy();
    return got ? { ...base, ...got, source: "booksy", reviews: [], ok: true, err: "" } : { ...base, ok: false, err: "Booksy no responde ahora." };
  }
  try {
    const got = await readGoogle(site.google.placeId);
    if (got.empty) return { ...base, ok: false, write: got.write, err: "Tu ficha de Google aún no tiene reseñas. Mientras, la web sigue enseñando las de Booksy." };
    return { ...base, ...got, ok: true, err: "" };
  } catch (e) {
    return { ...base, ok: false, err: e.message };
  }
}

// ── Google (Places API, la versión nueva) ──
// Una lectura de la ficha cada 12 h son ~60 al mes, y Google da 1.000 gratis
// al mes de este tipo. Aun así, aquí hay un tope propio (G_MONTH_MAX): si algo
// se tuerce y empieza a pedir sin parar, se corta antes de que cueste dinero.
// En local, sin clave, sale una ficha de prueba para poder ver cómo queda.
const GKEY = process.env.GOOGLE_PLACES_KEY || "";
const GFAKE = !GKEY && !ON_VERCEL;
const googleOn = () => !!(GKEY || GFAKE);
const G_MONTH_MAX = 300;
const G_ID = /^[A-Za-z0-9_-]{10,300}$/;
const gMapsLink = (id) => `https://www.google.com/maps/search/?api=1&query=NOVA+Studio&query_place_id=${encodeURIComponent(id)}`;
const gWriteLink = (id) => `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`;
async function gfetch(path, { body, mask }) {
  const k = "gplaces:" + T.nowLocal().date.slice(0, 7);
  const n = Number(await cmd("INCR", k));
  if (n === 1) await cmd("EXPIRE", k, 40 * 86400);
  if (n > G_MONTH_MAX) throw new Error("Este mes ya se ha consultado Google muchas veces. Se vuelve a leer el mes que viene (así nunca cuesta dinero).");
  let res;
  try {
    res = await fetch("https://places.googleapis.com/v1/" + path, {
      method: body ? "POST" : "GET",
      signal: AbortSignal.timeout(6000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GKEY, "X-Goog-FieldMask": mask },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("Google no responde ahora. Prueba más tarde.");
  }
  const j = await res.json().catch(() => ({}));
  if (res.ok) return j;
  console.error("Google Places", res.status, j?.error?.status, j?.error?.message);
  if (res.status === 403 || res.status === 401) throw new Error("Google no acepta la clave. Revisa que «Places API (New)» esté activada en Google Cloud y que la clave (GOOGLE_PLACES_KEY) esté bien copiada en Vercel.");
  if (res.status === 404 || (res.status === 400 && /place/i.test(j?.error?.message || ""))) throw new Error("Google no encuentra esa ficha. Vuelve a buscarla.");
  if (res.status === 429) throw new Error("Google pide esperar un poco. Prueba en unos minutos.");
  throw new Error(`Google no ha contestado bien (${res.status}). Prueba más tarde.`);
}
// Nota, número, enlaces y hasta 5 reseñas (las que Google considera más útiles,
// sin filtrar: también salen las que no son de 5 estrellas).
async function readGoogle(id) {
  const j = GFAKE ? fakeGoogle() : await gfetch(`places/${encodeURIComponent(id)}?languageCode=es&regionCode=ES`, { mask: "rating,userRatingCount,googleMapsUri,googleMapsLinks,reviews" });
  const links = j.googleMapsLinks || {},
    write = links.writeAReviewUri || gWriteLink(id);
  const sc = Number(j.rating),
    ct = Math.round(Number(j.userRatingCount)) || 0;
  if (!(sc > 0 && sc <= 5 && ct > 0)) return { empty: true, write };
  return {
    source: "google",
    score: Math.round(sc * 10) / 10,
    count: ct,
    url: links.reviewsUri || links.placeUri || j.googleMapsUri || gMapsLink(id),
    write,
    reviews: (Array.isArray(j.reviews) ? j.reviews : []).map(gReview).filter(Boolean).slice(0, 5),
  };
}
// Google exige enseñar el nombre de quien escribe cada reseña (con enlace a su
// perfil). La foto no se guarda: cargarla mandaría la IP del cliente a Google.
function gReview(x) {
  const text = String(x?.originalText?.text || x?.text?.text || "").replace(/\s+/g, " ").trim().slice(0, 700);
  const author = clean(x?.authorAttribution?.displayName, 60);
  const rating = Math.round(Number(x?.rating));
  if (!text || !author || !(rating >= 1 && rating <= 5)) return null;
  const uri = String(x?.authorAttribution?.uri || "");
  const at = String(x?.publishTime || "").slice(0, 10);
  return { author, uri: /^https:\/\/(www\.)?google\.[a-z.]+\//i.test(uri) ? uri : "", rating, text, at: T.isDate(at) ? at : "" };
}
// Buscar la ficha por nombre y zona, para que el dueño elija la suya.
async function searchGoogle(text) {
  const j = GFAKE
    ? { places: [fakeGoogle()] }
    : await gfetch("places:searchText", {
        body: { textQuery: text, languageCode: "es", regionCode: "ES", pageSize: 5 },
        mask: "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount",
      });
  return (j.places || [])
    .filter((p) => G_ID.test(p.id || ""))
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: clean(p.displayName?.text, 100), address: clean(p.formattedAddress, 160), score: Number(p.rating) || null, count: Number(p.userRatingCount) || 0 }));
}
// Solo en local y sin clave: una ficha de prueba, con reseñas que dicen que lo son.
function fakeGoogle() {
  const day = (n) => T.addDays(T.nowLocal().date, -n) + "T10:00:00Z";
  const rv = (i, rating, days, text) => ({ rating, publishTime: day(days), originalText: { text }, authorAttribution: { displayName: "Cliente de prueba " + i, uri: "https://www.google.com/maps/contrib/0" } });
  return {
    id: "ChIJ_prueba_NOVA_local",
    displayName: { text: "NOVA Studio (ficha de prueba)" },
    formattedAddress: "Av. del Atlántico 317, 35110 Vecindario, Las Palmas",
    rating: 4.9,
    userRatingCount: 37,
    googleMapsUri: "https://maps.google.com/?q=NOVA+Studio+Vecindario",
    reviews: [
      rv(1, 5, 4, "Reseña de prueba: así se verá en la web una reseña de Google. Trato de diez y el degradado perfecto."),
      rv(2, 5, 19, "Reseña de prueba más larga, para ver cómo se corta el texto cuando alguien escribe mucho. Llegué sin saber qué quería y Airam me recomendó un corte que me queda genial. El sitio es muy cuidado, te ofrecen café y la música está bien. Volveré seguro, y ya he reservado la próxima desde la app."),
      rv(3, 4, 60, "Reseña de prueba con cuatro estrellas."),
    ],
  };
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
// Lo que ve el cliente. Sin nada guardado aún, los valores de config.js (Booksy).
const ratingOut = (r) => {
  const g = r.source === "google" && r.score;
  return {
    ...BUSINESS.rating,
    ...(g ? { source: "Google", url: r.url } : {}),
    ...(r.score ? { score: r.score.toFixed(1).replace(".", ","), count: r.count } : {}),
    reviews: g ? r.reviews || [] : [],
  };
};


// ── Contacto y aviso temporal (editables por el dueño) ────────────────────
// Lo que se guarda en «site.contact» pisa lo de config.js. El mapa de la
// portada es una imagen fija (assets/mapa.jpg): si el estudio se muda, hay que
// rehacerla.
function contactOut(c = {}) {
  const street = c.street || BUSINESS.street,
    city = c.city || BUSINESS.city;
  return {
    street,
    city,
    maps: c.maps || BUSINESS.maps,
    whatsapp: c.whatsapp || BUSINESS.whatsapp,
    instagram: c.instagram || BUSINESS.instagram,
  };
}
// El aviso se ve si está encendido y no ha pasado su fecha de fin.
function noticeOut(n) {
  if (!n?.on || !n.text) return null;
  if (n.until && n.until < T.nowLocal().date) return null;
  return { text: n.text, tone: n.tone === "alerta" ? "alerta" : "info" };
}
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
  dormantWeeks: R.WEEKS.def, // semanas sin venir (y sin cita) para ser «cliente dormido»
  winbackAuto: false, // avisar solo a los dormidos por correo (uno cada `dormantWeeks` semanas como mucho)
  reviewGapDays: R.REVIEW_GAP.def, // como mucho una petición de reseña a cada cliente cada tantos días
  winbackText: "Hace tiempo que no te vemos por el estudio. Tu hueco te está esperando: reserva en un minuto desde la app.",
  winbackOffer: "",
  remindSoon: true, // otro correo unas 2 horas antes de la cita
  reviews: false, // pedir reseña por correo después de un corte (hace falta enlace: reviewUrl, GOOGLE_REVIEW_URL o ficha de Google)
  reviewUrl: "",
  dailyClose: true, // cada mañana, el resumen de caja de ayer al dueño
  waitlist: true, // «avísame si se libera» en los días completos
  openFrom: "", // paso desde Booksy: los clientes reservan en la app solo desde este día (vacío = sin límite)
};
const WEEK = [0, 1, 2, 3, 4, 5, 6];
const NORMS0 = NORMS;
async function loadTeam() {
  // Equipo y normas en un solo viaje a la base de datos.
  const [rawTeam, rawNorms, rawSvcs, rawPlans] = await cmd("MGET", "team", "norms", "services", "memplans");
  // Servicios: los edita el dueño (pestaña «Servicios»); la primera vez, los de config.js.
  let sv = rawSvcs ? JSON.parse(rawSvcs) : null;
  if (!Array.isArray(sv) || !sv.length) {
    sv = SERVICES.map((x) => ({ ...x, active: true }));
    await setJSON("services", sv);
  }
  SVCS = sv;
  // Planes de Socio NOVA+: los que guarda el dueño; si no hay, los de config.js.
  const pl = rawPlans ? JSON.parse(rawPlans) : null;
  PLANS = Array.isArray(pl) ? pl : MEMBERSHIP.plans;
  let t = rawTeam ? JSON.parse(rawTeam) : null;
  if (!Array.isArray(t) || !t.length) {
    t = PROVIDERS.map((p) => ({ ...p, active: true, commission: p.owner ? 0 : (COMMISSION[p.id] ?? 40) }));
    await setJSON("team", t);
  }
  TEAM = t;
  const savedNorms = rawNorms ? JSON.parse(rawNorms) : {};
  // Normas de antes: «días sin venir» pasa a semanas.
  if (savedNorms.lapseDays && savedNorms.dormantWeeks === undefined) savedNorms.dormantWeeks = R.weeksFromDays(savedNorms.lapseDays);
  delete savedNorms.lapseDays;
  NORMS = { ...NORMS0, ...savedNorms };
}
const activeTeam = () => TEAM.filter((p) => p.active !== false);
let SVCS = SERVICES;
let PLANS = MEMBERSHIP.plans;
// La suscripción de un cliente (Socio NOVA+), con los periodos de demo ya avanzados.
const memberOf = async (email) => {
  const sub = email ? await M.getSub(email) : null;
  return sub ? M.advanceDemo(sub, T.nowLocal().date) : null;
};
// Hasta cuántos días vista puede reservar ese cliente: los normales, o más si es socio con ese plan.
const horizonOf = (sub) => Math.max(RULES.daysAhead, M.isLive(sub, T.nowLocal().date) ? sub.plan?.daysAhead || 0 : 0);
const activePlans = () => PLANS.filter((p) => p.active !== false);
const activeSvcs = () => SVCS.filter((x) => x.active !== false);
// Vacaciones o días libres de un barbero: [{ from, to, note }] con fechas AAAA-MM-DD.
const isOff = (p, date) => (p.off || []).some((r) => date >= r.from && date <= r.to);
// Lo que el catálogo enseña de cada barbero: ni su clave, ni su correo, ni su comisión, ni el motivo de sus días libres.
// Quién sale en la agenda: el equipo en activo y quien ya no está pero tiene citas.
const agendaTeam = (list) => TEAM.filter((p) => p.active !== false || list.some((b) => b.provider.id === p.id));
// Lo que ve la caja de una cita: quién, qué y a qué hora; nada de contacto.
const forCaja = ({ phone, email, note, charge, user, ...b }) => b;
// Colores de la agenda (como en Google Calendar, uno por barbero).
const AGENDA_COLORS = ["azul", "rojo", "verde", "morado", "naranja", "rosa", "turquesa", "grafito"];
const publicProvider = ({ hours, pinHash, commission, email, off, ...p }) => ({ ...p, off: (off || []).map(({ from, to }) => ({ from, to })) });
// Lo que se cobra si no viene o si cancela con menos de `cancelHours` horas.
const feeFor = (b, kind) => cents(((Number(b.service.price) || 0) * (kind === "late" ? NORMS.lateFeePct : NORMS.noShowFeePct)) / 100);
const lateCancel = (b) => T.minutesUntil(b.date, b.start) < NORMS.cancelHours * 60;

// ── Agenda ─────────────────────────────────────────────────────────────────
const service = (id) => SVCS.find((s) => s.id === id);
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

// `staff`: lo pide alguien del equipo (cambiar una cita desde la agenda), que
// puede usar los días de antes de `openFrom`; los clientes, no.
function freeTimes(p, s, date, busy, now, horizon = RULES.daysAhead, staff = false) {
  const last = T.addDays(now.date, horizon);
  if (date < now.date || date > last) return [];
  if (!staff && NORMS.openFrom && date < NORMS.openFrom) return [];
  if (isOff(p, date)) return [];
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

// Quién puede hacer el servicio `s`: un barbero concreto o, con "any", todo el
// equipo en activo que lo hace.
const teamFor = (s, pid) =>
  !s ? [] : pid === "any" ? activeTeam().filter((p) => canDo(s, p)) : [provider(pid)].filter((p) => p && p.active !== false && canDo(s, p));

// Horas libres de unos días seguidos, con quién está libre a cada hora. Mismas
// reglas que el calendario de la web (freeTimes): antelación, días vista,
// vacaciones, apertura y citas ya puestas. Lo usa el asistente de IA (MCP).
async function freeSlots(s, team, from, days) {
  const now = T.nowLocal(),
    memo = {},
    out = [];
  for (let i = 0; i < days; i++) {
    const date = T.addDays(from, i),
      at = {};
    for (const p of team) {
      const busy = (memo[p.id + monthOf(date)] ||= await busyOf(p.id, monthOf(date)));
      for (const t of freeTimes(p, s, date, busy, now)) (at[t] ||= []).push({ id: p.id, name: p.name });
    }
    out.push({ date, slots: Object.keys(at).sort().map((time) => ({ time, barbers: at[time] })) });
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
       <p style="margin:0">${htmlEsc(b.name)}${b.phone ? " · " + htmlEsc(b.phone) : ""}${b.email ? " · " + htmlEsc(b.email) : ""}</p>` +
      (b.note ? `<p style="margin:8px 0 0">Nota del cliente: ${htmlEsc(b.note)}</p>` : "") +
      (b.via === "asistente" ? `<p style="margin:8px 0 0;color:#64645e;font-size:13px">Reservada por su asistente de IA.</p>` : ""),
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
  return bookFor(await currentUser(req), body, { from: ip(req) });
}
// La reserva de verdad, la misma para la web y para el asistente de IA (MCP):
// `user` es la cuenta ya comprobada (sesión o token de asistente) y `from`, la
// clave del límite de reservas (la IP en la web; el token en el asistente).
// `via` apunta de dónde vino la cita; `body.note`, una nota opcional del cliente.
async function bookFor(user, body, { from, via } = {}) {
  const s = service(body.service);
  if (!s || s.consult || s.active === false) fail(400, "Ese servicio no se reserva por aquí.");
  const anyone = body.provider === "any",
    fixed = anyone ? null : provider(body.provider);
  if (!anyone && (!fixed || fixed.active === false || !canDo(s, fixed))) fail(400, "Ese barbero no hace este servicio.");
  if (!T.isDate(body.date) || !T.isTime(body.start)) fail(400, "Elige día y hora.");
  // Para reservar hay que haber entrado con el código: la cita queda a nombre de
  // una cuenta comprobada, y se usan su nombre y su teléfono (si lo tiene).
  if (!user) fail(401, "Entra con tu correo para reservar. Te mandamos un código.");
  const email = user.email,
    name = clean(user.name),
    phone = clean(user.phone, 30);
  if (!name) fail(400, "Falta tu nombre.");
  if (body.terms !== true) fail(400, "Tienes que aceptar las condiciones.");
  // Con Stripe activado, toda cita online queda garantizada con una tarjeta.
  if (Card.cardEnabled() && !user?.card) fail(402, "Añade una tarjeta para garantizar la cita.", { card: true });
  await limit("book:" + from, 12, 3600);
  const note = clean(body.note, 200);
  // Una reserva a la vez por persona: dos pestañas pulsando a la vez no se saltan el máximo de citas.
  if ((await cmd("SET", "booking:" + email, "1", "NX", "EX", 20)) !== "OK") fail(429, "Ya estamos guardando otra reserva tuya. Un momento…");
  try {
    const now = T.nowLocal();
    const mine = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + email));
    if (mine.filter((b) => isActive(b, now) && !b.series).length >= RULES.maxActive)
      fail(400, `Ya tienes ${RULES.maxActive} citas pendientes. Cuando pase alguna podrás reservar otra.`);

    // Socio NOVA+: más días vista y, si el servicio está cubierto y le quedan cortes de ese periodo, la cita sale incluida.
    const sub = await memberOf(email);
    const horizon = Math.max(RULES.daysAhead, M.isLive(sub, now.date) ? sub.plan?.daysAhead || 0 : 0);
    const cover = M.coverage(sub, s.id, body.date, mine, now.date);
    const cands = [];
    for (const p of anyone ? shuffle(activeTeam().filter((p) => canDo(s, p))) : [fixed]) {
      const busy = await busyOf(p.id, monthOf(body.date));
      if (freeTimes(p, s, body.date, busy, now, horizon).includes(body.start)) cands.push({ p, load: (busy[body.date] || []).reduce((a, [x, y]) => a + y - x, 0) });
    }
    cands.sort((a, b) => a.load - b.load);
    const extra = {
      email,
      name,
      phone,
      by: "client",
      ...(via ? { via } : {}),
      ...(note ? { note } : {}),
      ...(anyone ? { anyBarber: true } : {}),
      ...(cover.included ? { membership: { included: true, plan: sub.plan.id, planName: sub.plan.name, from: cover.window.start, to: cover.window.end } } : {}),
      ...(user?.card ? { guarantee: { brand: user.card.brand, last4: user.card.last4, at: now.stamp } } : {}),
    };
    // «Añade algo para recoger en el local»: se aparta antes de guardar la cita (si no hay unidades, no se reserva nada).
    let merch = await merchForBooking(user, body.merch);
    let b = null;
    try {
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
    } catch (e) {
      if (merch) await Shop.cancel(merch.id, { by: "auto", reason: "No se pudo guardar la cita." }).catch(() => {});
      throw e;
    }
    if (!b) {
      if (merch) await Shop.cancel(merch.id, { by: "auto", reason: "No se pudo guardar la cita." }).catch(() => {});
      fail(409, "Esa hora ya no está libre. Mira estas otras:", { alternatives: await alternativesFor(s, fixed, body.date, body.start) });
    }
    if (merch) merch = await Shop.attachBooking(merch, b.id).catch(() => merch);
    const p = provider(b.provider.id);
    // Cita que se repite (si el dueño lo permite): cada 1-4 semanas, hasta recurringMax veces.
    let series = null;
    if (body.repeat && NORMS.recurring) series = await makeSeries(b, s, p, body.repeat, NORMS.recurringMax, { email, name, phone, by: "client", ...(b.guarantee ? { guarantee: b.guarantee } : {}) });

    await cmd("HDEL", "wl:" + b.date, email); // ya tiene hora ese día: fuera de la lista de espera

    await Promise.all([
      send(
        email,
        `Cita reservada · ${T.niceDate(b.date)} ${b.start}`,
        "Tu cita está reservada",
        bookingLines(b, T.niceDate(b.date)) +
          (b.membership ? `<p style="margin:14px 0 0;font-size:14px"><b>Incluida en tu membresía ${htmlEsc(b.membership.planName)}</b>: no pagas nada en el local.</p>` : "") +
          (merch ? `<p style="margin:14px 0 0;font-size:14px"><b>NOVA Supply:</b> te lo guardamos para que lo recojas en la cita (${merch.items.map((l) => `${htmlEsc(l.nombre)} · ${htmlEsc(l.talla)}${l.cantidad > 1 ? " × " + l.cantidad : ""}`).join(", ")}). Total ${merch.total.toFixed(2).replace(".", ",")} € a pagar en el local.</p>` : "") +
          `<p style="margin:14px 0 0;color:#64645e;font-size:13px">Puedes cambiarla o cancelarla desde la app hasta ${NORMS.cancelHours} h antes. Referencia ${b.id}.</p>`,
      ),
      notifySalon(b, "Nueva cita"),
    ]);
    return { out: { id: b.id, series, provider: { id: b.provider.id, name: b.provider.name }, ...(merch ? { merch: Shop.viewFor(merch) } : {}), ...(b.membership ? { membership: { included: true, plan: b.membership.planName, left: cover.left - 1 } } : {}) }, booking: b };
  } finally {
    await cmd("DEL", "booking:" + email);
  }
}

// Cancelar una cita ya comprobada (es del cliente o la lleva ese barbero). La
// misma regla para la web y para el asistente de IA: el cliente no cancela una
// cita que ya ha pasado y, con menos de `cancelHours` horas, cancela igual pero
// queda como tardía (su barbero decide si se cobra).
async function cancelFor(b, { staff = false, series = false, host = "" } = {}) {
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
  // Lo que había pedido para recoger en esa cita (y no se ha cobrado) vuelve a estar libre.
  for (const o of await Shop.ofBooking(b.id)) if (o.estado === "pendiente") await Shop.cancel(o.id, { by: staff ? "equipo" : "cliente", reason: "La cita se canceló." }).catch(() => {});
  if (b.pay) await rankTouch(b.email); // una cita cobrada que se anula deja de sumar
  // «Cancelar también las siguientes» de una cita que se repite.
  let more = 0;
  const freed = new Set([b.date]);
  if (series && b.series) {
    const ids = await cmd("SMEMBERS", "series:" + b.series);
    for (const x of await bookingsByIds(ids)) {
      if (x.id === b.id || x.status !== "confirmed" || x.date + x.start <= b.date + b.start) continue;
      await unplace(x, { ...x, status: "canceled", canceledBy: staff ? "staff" : "client", canceledAt: T.nowLocal().stamp, seriesCancel: true });
      freed.add(x.date);
      more++;
    }
  }
  if (!staff && b.kind === "booking") await notifySalon(b, late ? "Cancelación tardía" : more ? `Cita cancelada (y ${more} más de la serie)` : "Cita cancelada");
  for (const d of freed) await waitlistPing(d, host);
  // Cita incluida en la membresía: a tiempo, el corte se devuelve; tarde, se gasta.
  return { ok: true, late, fee: late ? feeFor(b, "late") : 0, ...(b.membership?.included ? { cutReturned: !late } : {}) };
}

// Las citas de un cliente: las próximas (de la más cercana a la más lejana) y las pasadas.
async function bookingsOf(email) {
  const now = T.nowLocal();
  const list = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + email));
  const key = (b) => b.date + " " + b.start;
  const upcoming = list.filter((b) => isActive(b, now)).sort((a, b) => key(a).localeCompare(key(b)));
  const past = list.filter((b) => !isActive(b, now)).sort((a, b) => key(b).localeCompare(key(a)));
  return { upcoming, past, list, now };
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
  // Si pidió un día de antes de la apertura (paso desde Booksy), se busca desde la apertura.
  const from = NORMS.openFrom && date < NORMS.openFrom ? NORMS.openFrom : date;
  for (let i = 0; i < 8 && out.length < 4; i++) {
    const d = T.addDays(from, i),
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
// tiene cita. «Perdido» (= cliente dormido) = sin cita y dormantWeeks semanas
// o más sin venir (regla en _lib/reengage.js, la misma para el cron, el panel
// y «Cuánto gana Nova»).
// Los correos de todos los socios (el índice `users`). La primera vez se
// completa con los socios de antes de existir el índice.
async function allEmails() {
  const [emails, done] = await pipe([
    ["SMEMBERS", "users"],
    ["GET", "usersidx"],
  ]);
  if (done) return emails;
  const old = (await scanKeys("user:*")).map((k) => k.slice(5));
  if (old.length) await cmd("SADD", "users", ...old);
  await cmd("SET", "usersidx", "1");
  return [...new Set([...emails, ...old])];
}
async function allClients() {
  const emails = await allEmails();
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
      const status = !h ? "nuevo" : next ? "con-cita" : h.since >= NORMS.dormantWeeks * 7 ? "perdido" : h.due ? "le-toca" : "al-dia";
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
  // En Vercel el secreto es obligatorio; en local, solo si CRON_SECRET está puesto.
  if ((ON_VERCEL || secret) && (!secret || !same(String(req.headers.authorization || ""), "Bearer " + secret))) fail(401, "No.");
  if ((await cmd("SET", "lock:cron", "1", "NX", "EX", 900)) !== "OK") return { skipped: "ya en marcha" };
  const now = T.nowLocal(),
    host = hostOf(req);
  const out = { at: now.stamp, soon: 0, reviews: 0, rebook: 0, reminders: 0, winback: 0, simulated: 0, close: false, backup: false, mail: mailReady() };
  const once = async (key, seconds) => (await cmd("SET", key, "1", "NX", "EX", seconds)) === "OK";
  const changeLink = (b) =>
    host ? `<a href="https://${host}/#booking/${b.id}">Cámbiala o cancélala desde la app</a>` : "Cámbiala o cancélala desde la app";
  try {
    // El ranking del Club: acabar de rehacerlo, arreglar fallos y medallas del año.
    try {
      out.ranking = await rankMaintain(now);
    } catch (e) {
      out.ranking = { error: String(e.message || e) };
    }
    // Socio NOVA+ en demo: no hay Stripe que renueve, así que se avanzan los periodos vencidos.
    try {
      let n = 0;
      for (const x of await M.allSubs()) if (x.demo && (await M.advanceDemo(x, now.date)) !== x) n++;
      if (n) out.membership = { demoRenewed: n };
    } catch (e) {
      out.membership = { error: String(e.message || e) };
    }
    // Pedidos de NOVA Supply: soltar lo que nadie va a recoger o pagar, y dar los puntos de los cobrados por Stripe.
    try {
      const m = await Shop.maintain({ bookingState, club: shopClub });
      const pts = await Shop.grantClubs(shopClub);
      if (m.released || m.paid || pts) out.shop = { ...m, points: pts };
    } catch (e) {
      out.shop = { error: String(e.message || e) };
    }
    // Sin correo (o en demo) los avisos de dormidos y reseñas no salen: se anotan como «simulado».
    // Lo demás que necesita correo se salta; lo que no, se hace igual (p. ej. borrar cuentas sin uso).
    const noMail = !mailReady();
    const daytime = now.min >= 9 * 60 && now.min < 21 * 60;
    const todays = daytime ? await bookingsByIds(await cmd("SMEMBERS", "day:" + now.date)) : [];
    const live = (b) => b.kind === "booking" && b.status === "confirmed" && b.email;

    // 1) Hoy, de 1 a 3 horas antes. No a quien reservó hace menos de 6 horas.
    if (!noMail && NORMS.remindSoon)
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

    // 2) Después del corte (marcado «Vino» o cobrado en caja, acabado hace más
    //    de una hora). A quien nunca ha pulsado «Dejar mi reseña» se le pide,
    //    como mucho una vez cada 6 meses. A quien ya la dejó no se le vuelve a
    //    pedir: se le pregunta cuándo vuelve, si no tiene ya otra cita.
    if (daytime && NORMS.reviews) {
      const yesterday = await bookingsByIds(await cmd("SMEMBERS", "day:" + T.addDays(now.date, -1)));
      for (const b of [...yesterday, ...todays]) {
        if (!live(b) || b.attendance !== "done" || T.minutesUntil(b.date, b.end) > -60) continue;
        if (await cmd("GET", "nomkt:" + b.email)) continue;
        const first = b.name ? String(b.name).split(" ")[0] : "";
        const barber = b.provider.name.split(" ")[0];
        if (await cmd("GET", "reviewed:" + b.email)) {
          if (!host || noMail) continue;
          const mine = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + b.email));
          if (mine.some((x) => x.id !== b.id && x.kind === "booking" && isActive(x, now))) continue;
          if (!(await once("revask:" + b.id, 7 * 86400)) || !(await once("backmail:" + b.email, 14 * 86400))) continue;
          const h = habitOf(mine, now);
          const every = h?.every && h.every >= 7 && h.every <= 70 ? h.every : 0;
          const hint = every
            ? `Sueles volver cada ${every % 7 ? every + " días" : every / 7 === 1 ? "semana" : every / 7 + " semanas"}: te tocaría hacia el ${htmlEsc(T.niceDate(T.addDays(b.date, every)))}.`
            : `Los buenos cortes se mantienen mejor si vuelves en 3 o 4 semanas.`;
          const ok = await send(
            b.email,
            `Publi · ¿Ya sabes cuándo vuelves${first ? ", " + first : ""}?`,
            `Gracias por venir${first ? ", " + first : ""}`,
            `<p style="margin:0 0 12px">Esperamos que ${htmlEsc(barber)} te haya dejado como querías.</p>
             <p style="margin:0 0 14px">${hint} Si lo dejas reservado ya, te aseguras tu hueco.</p>
             <p style="margin:0 0 12px"><a href="https://${host}/#time/${encodeURIComponent(b.provider.id)}" style="display:inline-block;background:#171717;color:#fff;padding:12px 18px;text-decoration:none">Ver huecos con ${htmlEsc(barber)}</a></p>
             <p style="margin:0;color:#64645e;font-size:13px">Y si algo no fue bien, responde a este correo: lo lee el equipo.</p>` + (await unsubFoot(b.email, host)),
            await ownerMail(),
          );
          if (ok) out.rebook++;
          continue;
        }
        const st = await reviewRequest(b, host);
        if (st === "enviado") out.reviews++;
        else if (st === "simulado") out.simulated++;
      }
    }

    // 3) Una vez al día, desde las 9:00.
    if (now.min >= 9 * 60 && (await once("cronday:" + now.date, 2 * 86400))) {
      // a) Recordatorio de las citas de mañana.
      if (!noMail && NORMS.reminders) {
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
      if (!noMail && NORMS.dailyClose) {
        const date = T.addDays(now.date, -1),
          html = await closeOf(date);
        if (html) out.close = await send(await ownerMail(), `Caja de ayer · ${T.niceDate(date)}`, "Resumen de ayer", html);
      }
      // c) Clientes que se han perdido (como mucho 15 correos al día, y 1 cada 60 días por persona).
      if (NORMS.winbackAuto) {
        let sentToday = 0;
        for (const c of (await allClients()).filter((x) => R.dormantDue(x, NORMS.dormantWeeks, now.date))) {
          if (sentToday >= 15) break; // como mucho 15 avisos al día
          sentToday++;
          const st = await winbackMail(c, host);
          if (st === "enviado") out.winback++;
          else if (st === "simulado") out.simulated++;
        }
      }
      // d) Los lunes, copia de seguridad (sin fotos) al correo del dueño.
      if (!noMail && T.weekday(now.date) === 1) {
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
      // e) Cuentas sin uso: aviso un mes antes y borrado a los 3 años (política de privacidad).
      out.purge = await purgeInactive(now, host);
      out.records = await purgeRecords(now);
      await setJSON("crondaily", { at: now.stamp, reminders: out.reminders, winback: out.winback, simulated: out.simulated, close: out.close, backup: out.backup, purge: out.purge, records: out.records });
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

// ── Cuentas sin uso ─────────────────────────────────────────────────────────
// La política de privacidad promete borrar la cuenta tras 3 años «sin citas ni
// uso». Uso = abrir la app con la sesión iniciada (`seen:`), cualquier cita
// (aunque se cancelara), compras de ropa del Club y premios canjeados.
// Un mes antes se avisa por correo; si vuelve a entrar, no se borra.
// Nunca se borra a quien tiene una cita pendiente o un cobro por falta sin
// cerrar, ni a nadie del equipo. Como mucho PURGE_MAX cuentas al día.
const PURGE_DAYS = 3 * 365 + 1,
  PURGE_WARN_DAYS = 30,
  PURGE_MAX = 25;
const dayOf = (stamp) => String(stamp || "").slice(0, 10);

// Cuentas que llevan sin uso al menos (3 años − 30 días), con todo lo necesario para avisar o borrar.
async function staleAccounts(now) {
  const warnLine = T.addDays(now.date, -(PURGE_DAYS - PURGE_WARN_DAYS));
  const emails = await allEmails();
  if (!emails.length) return [];
  const reads = [];
  for (let i = 0; i < emails.length; i += 300) reads.push(["MGET", ...emails.slice(i, i + 300).map((e) => "user:" + e)]);
  // Solo se mira a fondo a quien se dio de alta antes de esa fecha: el resto no puede llevar tanto sin uso.
  const old = (await pipe(reads))
    .flat()
    .map((raw) => (raw ? JSON.parse(raw) : null))
    .filter((u) => u?.email && dayOf(u.created) < warnLine);
  if (!old.length) return [];
  const per = await pipe(
    old.flatMap((u) => [
      ["SMEMBERS", "ubk:" + u.email],
      ["SMEMBERS", "ush:" + u.email],
      ["SMEMBERS", "urd:" + u.email],
      ["GET", "seen:" + u.email],
      ["GET", "purgewarn:" + u.email],
    ]),
  );
  const books = await bookingsByIds([...new Set(old.flatMap((_, i) => per[i * 5]))]);
  const byId = new Map(books.map((b) => [b.id, b]));
  const [shops, rds] = await Promise.all([bookingsByIds2("sh:", [...new Set(old.flatMap((_, i) => per[i * 5 + 1]))]), bookingsByIds2("rd:", [...new Set(old.flatMap((_, i) => per[i * 5 + 2]))])]);
  const shopBy = new Map(shops.map((x) => [x.id, x])),
    rdBy = new Map(rds.map((x) => [x.id, x]));
  const out = [];
  old.forEach((u, i) => {
    const bookings = per[i * 5].map((id) => byId.get(id)).filter(Boolean);
    const shopIds = per[i * 5 + 1],
      rdIds = per[i * 5 + 2];
    const dates = [
      dayOf(u.created),
      dayOf(per[i * 5 + 3]),
      ...bookings.flatMap((b) => [b.date, dayOf(b.created), dayOf(b.canceledAt)]),
      ...shopIds.map((id) => dayOf(shopBy.get(id)?.created)),
      ...rdIds.map((id) => dayOf(rdBy.get(id)?.created)),
    ].filter(T.isDate);
    const last = dates.sort().at(-1) || "";
    if (last >= warnLine) return;
    out.push({
      u,
      last,
      warned: per[i * 5 + 4] || "",
      bookings,
      shopIds,
      rdIds,
      active: bookings.some((b) => isActive(b, now)),
      owes: bookings.some((b) => ["requires_action", "requires_payment_method"].includes(b.charge?.status)),
    });
  });
  return out;
}

// Borra una cuenta. Las citas se quedan para las cuentas del salón, pero sin
// nombre, correo ni teléfono. Las que tienen un cobro por falta y los cobros de
// caja (`pay:`) no se tocan: la ley obliga a guardarlos 6 años.
async function eraseAccount(a, now) {
  const u = a.u,
    email = u.email;
  const ops = [];
  for (const b of a.bookings) {
    if (b.charge) continue;
    ops.push(["SET", "bk:" + b.id, JSON.stringify(anonymous(b, now))]);
  }
  for (const id of a.shopIds) ops.push(["DEL", "sh:" + id]);
  for (const id of a.rdIds) ops.push(["DEL", "rd:" + id], ["SREM", "rdpending", id]);
  // A quien invitó, se le quita la referencia a este correo.
  const friends = await cmd("SMEMBERS", "refs:" + email);
  if (friends.length) {
    const raws = await cmd("MGET", ...friends.map((f) => "user:" + f));
    raws.forEach((raw) => {
      const f = raw && JSON.parse(raw);
      if (f?.referredBy === email) ops.push(["SET", "user:" + f.email, JSON.stringify({ ...f, referredBy: null })]);
    });
  }
  if (u.ref && (await cmd("GET", "refcode:" + u.ref)) === email) ops.push(["DEL", "refcode:" + u.ref]);
  // Fuera de las listas de amigos de los demás y del ranking.
  const [fr, frx] = await pipe([
    ["SMEMBERS", "fr:" + email],
    ["SMEMBERS", "frx:" + email],
  ]);
  for (const f of new Set([...fr, ...frx])) ops.push(["SREM", "fr:" + f, email], ["SREM", "frx:" + f, email]);
  for (const k of ["user:", "ubk:", "ush:", "urd:", "refs:", "seen:", "purgewarn:", "winback:", "nomkt:", "reviewed:", "revmail:", "backmail:", "fr:", "frx:"]) ops.push(["DEL", k + email]);
  ops.push(["SREM", "users", email], ["DEL", "contacts:list"]);
  await pipe(ops);
  // Fuera también del registro de avisos (dormidos y reseñas).
  const nlog = await getJSON("avisos:log");
  if (Array.isArray(nlog) && nlog.some((e) => e.email === email)) await setJSON("avisos:log", nlog.filter((e) => e.email !== email));
  await rankDrop(email);
  await Tokens.revokeAll(email); // los tokens de asistente de IA dejan de valer
  if (u.card?.pm) await Card.removeCard(u.card.pm).catch(() => {});
  // Membresía: si tenía una de pago en Stripe, se deja de cobrar ya; los ingresos ya cobrados se conservan en la contabilidad.
  const sub = await M.getSub(email);
  if (sub) {
    if (!sub.demo && sub.stripeSub && ["active", "past_due"].includes(sub.status)) await Card.membershipCancel(sub.stripeSub, true).catch((e) => console.error("Baja de membresía al borrar la cuenta:", e.message));
    await M.dropSub(email);
  }
}

// La pasada diaria: avisa a quien le falta un mes y borra a quien ya pasó el plazo.
async function purgeInactive(now, host) {
  const res = { warned: 0, erased: 0, kept: 0 };
  const list = await staleAccounts(now);
  if (!list.length) return res;
  const team = await teamEmails();
  const deadline = T.addDays(now.date, -PURGE_DAYS);
  for (const a of list) {
    if (a.active || a.owes || team.has(a.u.email)) {
      res.kept++;
      continue;
    }
    const warnedLongAgo = a.warned && daysBetween(a.warned, now.date) >= PURGE_WARN_DAYS;
    // Se borra si pasó el plazo y se avisó hace al menos un mes (o si no hay
    // forma de avisar porque el correo de la app no está activo).
    if (a.last < deadline && (warnedLongAgo || !mailReady())) {
      if (res.erased >= PURGE_MAX) continue;
      await eraseAccount(a, now);
      res.erased++;
      continue;
    }
    if (a.warned || !mailReady()) continue;
    const when = T.addDays(a.last, PURGE_DAYS) > T.addDays(now.date, PURGE_WARN_DAYS) ? T.addDays(a.last, PURGE_DAYS) : T.addDays(now.date, PURGE_WARN_DAYS);
    const first = String(a.u.name || "").split(" ")[0];
    const ok = await send(
      a.u.email,
      `Tu cuenta de ${BUSINESS.short} se borrará el ${T.niceDate(when).toLowerCase()}`,
      `Hace mucho que no te vemos${first ? ", " + first : ""}`,
      `<p style="margin:0 0 12px">Tu cuenta del Club ${htmlEsc(BUSINESS.short)} lleva casi 3 años sin uso. Como dice nuestra política de privacidad, el <b>${htmlEsc(T.niceDate(when))}</b> la borraremos, y con ella tus puntos y medallas.</p>
       <p style="margin:0 0 14px">Si quieres conservarla, basta con que entres en la app antes de esa fecha.</p>
       ${host ? `<p style="margin:0 0 12px"><a href="https://${host}/#profile" style="display:inline-block;background:#171717;color:#fff;padding:12px 18px;text-decoration:none">Entrar y conservar mi cuenta</a></p>` : ""}
       <p style="margin:0;color:#64645e;font-size:13px">Si prefieres que se borre, no hace falta que hagas nada.</p>`,
    );
    if (ok) {
      await cmd("SET", "purgewarn:" + a.u.email, now.date, "EX", 150 * 86400);
      res.warned++;
    }
  }
  if (res.erased) await cmd("INCRBY", "purged:" + now.date.slice(0, 7), res.erased);
  return res;
}

// Una cuenta con todo lo que cuelga de ella (para borrarla a petición del cliente).
async function accountFor(email, now) {
  const u = await getJSON("user:" + email);
  if (!u) return null;
  const [ubk, ush, urd] = await pipe([
    ["SMEMBERS", "ubk:" + email],
    ["SMEMBERS", "ush:" + email],
    ["SMEMBERS", "urd:" + email],
  ]);
  const bookings = await bookingsByIds(ubk);
  return {
    u,
    bookings,
    shopIds: ush,
    rdIds: urd,
    active: bookings.some((b) => isActive(b, now)),
    owes: bookings.some((b) => ["requires_action", "requires_payment_method"].includes(b.charge?.status)),
  };
}
// Citas sin cuenta (apuntadas por el equipo con nombre y teléfono) de un teléfono.
// No hay índice por teléfono: se recorren los días desde hace 6 años. Es raro
// (solo cuando alguien pide que borremos sus datos), así que no importa que tarde un poco.
async function bookingsByPhone(digits, now) {
  const dates = Array.from({ length: 6 * 365 + RULES.daysAhead + 1 }, (_, i) => T.addDays(now.date, RULES.daysAhead - i));
  const ids = new Set();
  for (let i = 0; i < dates.length; i += 400) for (const set of await pipe(dates.slice(i, i + 400).map((d) => ["SMEMBERS", "day:" + d]))) set.forEach((id) => ids.add(id));
  return (await bookingsByIds([...ids])).filter((b) => b.kind === "booking" && !b.email && String(b.phone || "").replace(/\D/g, "").endsWith(digits.slice(-9)));
}
const anonymous = (b, now) => {
  const { guarantee, ...rest } = b;
  return { ...rest, name: "Cliente borrado", email: "", phone: "", erased: now.date };
};

// ── Formación y cobros: lo que la política promete borrar con el tiempo ──
// Formación: 2 años desde el último contacto (alta, cuando vuelve a apuntarse o
// cuando el dueño cambia su estado o su nota).
// Cobros: 6 años completos tras cerrar el año (los de 2026 se borran en 2033),
// como el Código de Comercio. Con ellos se quitan los datos personales de las
// citas con cobro por falta de ese año cuya cuenta ya no existe.
async function purgeRecords(now) {
  const res = { training: 0, payYears: 0 };
  const ids = await cmd("SMEMBERS", "trall");
  if (ids.length) {
    const line = T.addDays(now.date, -730),
      ops = [];
    for (const t of await bookingsByIds2("tr:", ids)) {
      const last = [t.created, t.updated, t.touched].map(dayOf).filter(T.isDate).sort().at(-1);
      if (!last || last >= line) continue;
      ops.push(["DEL", "tr:" + t.id], ["SREM", "trall", t.id]);
      if (t.phone && (await cmd("GET", "trphone:" + t.phone.replace(/\D/g, ""))) === t.id) ops.push(["DEL", "trphone:" + t.phone.replace(/\D/g, "")]);
      res.training++;
    }
    if (ops.length) await pipe(ops);
  }
  const lastYear = Number(now.date.slice(0, 4)) - 7; // los años hasta este ya cumplieron sus 6 años
  for (let y = Number((await cmd("GET", "paypurged")) || 2025) + 1; y <= lastYear; y++) {
    for (let m = 1; m <= 12; m++) {
      const month = `${y}-${String(m).padStart(2, "0")}`;
      const pays = await cmd("SMEMBERS", "paymonth:" + month);
      const days = Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
      const books = await bookingsByIds([...new Set((await pipe(days.map((d) => ["SMEMBERS", "day:" + d]))).flat())]);
      const charged = books.filter((b) => b.charge && b.email);
      const owners = charged.length ? await cmd("MGET", ...charged.map((b) => "user:" + b.email)) : [];
      await pipe([
        ...pays.map((id) => ["DEL", "pay:" + id]),
        ...days.map((d) => ["DEL", "payday:" + d]),
        ["DEL", "paymonth:" + month],
        ...charged.filter((_, i) => !owners[i]).map((b) => ["SET", "bk:" + b.id, JSON.stringify(anonymous(b, now))]),
      ]);
    }
    await cmd("SET", "paypurged", String(y));
    res.payYears++;
  }
  return res;
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
// Enlace personal de «Dejar mi reseña»: al pulsarlo se apunta la medalla
// (sin puntos) y ya no se le vuelve a pedir reseña.
const reviewToken = async (email) => (await unsubToken("rev:" + email));
async function markReviewed(email) {
  if (!email || !EMAIL.test(email)) return;
  if ((await cmd("SET", "reviewed:" + email, T.nowLocal().stamp, "NX")) === "OK") await rankTouch(email); // bonus de la medalla
}
// Enlace donde se deja la reseña. Prevalece lo que pone el dueño en el panel;
// si no, GOOGLE_REVIEW_URL; si no, la ficha de Google elegida en la pestaña Web.
async function reviewLink(norms = NORMS) {
  if (norms.reviewUrl) return { url: norms.reviewUrl, source: "panel" };
  const env = String(process.env.GOOGLE_REVIEW_URL || "").trim();
  if (/^https:\/\/[^\s"<>]+$/.test(env)) return { url: env, source: "env" };
  const pid = ((await getJSON("site")) || {}).google?.placeId;
  if (pid && G_ID.test(pid)) return { url: gWriteLink(pid), source: "google" };
  return { url: "", source: "" };
}
const goReview = async () => {
  const { url } = await reviewLink();
  return url
    ? { redirect: url }
    : { raw: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:Arial;padding:40px 20px;text-align:center"><h1 style="font-size:22px">¡Gracias!</h1><p>El enlace de reseñas no está disponible ahora mismo. Prueba más tarde.</p></body>`, type: "text/html; charset=utf-8" };
};
// Pie de baja para los correos comerciales (art. 21 LSSI: en cada uno hay que
// poder darse de baja de forma sencilla y gratuita).
async function unsubFoot(email, host) {
  const t = await unsubToken(email);
  return `<p style="margin:12px 0 0;color:#64645e;font-size:12px">¿No quieres más correos así? ${host ? `<a href="https://${host}/api/unsub/${encodeURIComponent(email)}/${t}">Darte de baja</a>` : "Respóndenos y te quitamos."}</p>`;
}
// ¿Se manda de verdad? En MODO_DEMO o sin RESEND_API_KEY no: el aviso se registra como «simulado».
const TEST_MAX = 10; // pruebas de «Enviarme una prueba» por hora
const simMail = () => !mailReady() || process.env.MODO_DEMO === "1";
// Registro de avisos (dormidos y reseñas) para el panel del dueño.
async function logNotice(e) {
  const now = T.nowLocal();
  const entry = { id: newId(), at: now.stamp, ...e };
  await setJSON("avisos:log", R.pushLog(await getJSON("avisos:log"), entry));
  return entry;
}
// Plantilla del aviso a un cliente dormido: la usan el envío real y «Enviarme una prueba».
function winbackContent(c, host, foot, test = false) {
  const base = host ? `https://${host}` : "";
  const off = NORMS.winbackOffer ? `<p style="margin:0 0 12px;padding:12px;border:1px solid #dcdad3;background:#f5f4f0"><b>${htmlEsc(NORMS.winbackOffer)}</b></p>` : "";
  const link = R.bookLink(host, c.habit, { service: (id) => !!service(id) && service(id).active !== false, provider: (id) => !!provider(id) && provider(id).active !== false });
  return {
    subject: `${test ? "[Prueba] " : ""}Publi · ${c.name ? c.name.split(" ")[0] + ", t" : "T"}e echamos de menos en ${BUSINESS.short}`,
    title: "Te echamos de menos",
    html: `<p style="margin:0 0 12px">${c.name ? "Hola " + htmlEsc(c.name.split(" ")[0]) + ": " : ""}${htmlEsc(NORMS.winbackText)}</p>${off}
       ${base ? `<p style="margin:0 0 12px"><a href="${htmlEsc(link)}" style="display:inline-block;background:#171717;color:#fff;padding:12px 18px;text-decoration:none">Reservar cita</a></p>` : ""}` + foot,
  };
}
// Plantilla de la petición de reseña (`href` = a dónde lleva el botón).
function reviewContent(b, href, foot, test = false) {
  const first = b.name ? String(b.name).split(" ")[0] : "";
  return {
    subject: `${test ? "[Prueba] " : ""}¿Qué tal tu ${b.service.name.toLowerCase()}?`,
    title: `Gracias por venir${first ? ", " + first : ""}`,
    html: `<p style="margin:0 0 12px">Esperamos que ${htmlEsc(b.provider.name.split(" ")[0])} te haya dejado como querías.</p>
       <p style="margin:0 0 14px">Si te ha gustado, nos ayudas muchísimo contándolo. Es un minuto:</p>
       <p style="margin:0 0 12px"><a href="${htmlEsc(href)}" style="display:inline-block;background:#171717;color:#fff;padding:12px 18px;text-decoration:none">Dejar mi reseña</a></p>
       <p style="margin:0;color:#64645e;font-size:13px">Y si algo no fue bien, responde a este correo: lo lee el equipo.</p>` + foot,
  };
}
// Aviso a un cliente dormido, con enlace de reserva directa (su barbero y servicio de siempre).
// Devuelve "enviado" | "simulado" | "fallido". Anota el aviso en `winback:` (que es lo que
// evita repetirlo) y en el registro.
async function winbackMail(c, host, by = "auto") {
  if (c.optout || !c.email) return "fallido";
  const sim = simMail();
  let status = "simulado";
  if (!sim) {
    const m = winbackContent(c, host, await unsubFoot(c.email, host));
    const ok = await send(c.email, m.subject, m.title, m.html);
    status = ok ? "enviado" : "fallido";
  }
  await logNotice({ type: "dormido", email: c.email, name: c.name || "", status, by });
  if (status !== "fallido") await setJSON("winback:" + c.email, { at: T.nowLocal().stamp, by, channel: "email", ...(sim ? { simulated: true } : {}) });
  return status;
}
// Petición de reseña de una cita hecha. Una sola por cita (`revreq:`) y, por cliente,
// no más de una cada reviewGapDays (`revmail:`). `force` = reenvío manual del dueño.
async function reviewRequest(b, host, { by = "auto", force = false } = {}) {
  const link = (await reviewLink()).url;
  if (!link || !b.email) return "sin-enlace";
  const sim = simMail();
  if (!sim && !host) return "sin-enlace";
  if (!force) {
    const [asked, rawLast] = await cmd("MGET", "revreq:" + b.id, "revmail:" + b.email);
    let lastAsk = null;
    if (rawLast) {
      try {
        const v = JSON.parse(rawLast);
        lastAsk = v && v.at ? v : { at: T.nowLocal().date }; // marca antigua: cuenta como pedida hoy
      } catch {
        lastAsk = { at: T.nowLocal().date };
      }
    }
    if (!R.reviewDue({ booking: b, askedBooking: !!asked, lastAsk, gapDays: NORMS.reviewGapDays, today: T.nowLocal().date })) return "repetida";
    if ((await cmd("SET", "revreq:" + b.id, "1", "NX", "EX", 400 * 86400)) !== "OK") return "repetida";
  } else await cmd("SET", "revreq:" + b.id, "1", "EX", 400 * 86400);
  await cmd("SET", "revmail:" + b.email, JSON.stringify({ at: T.nowLocal().stamp, booking: b.id }), "EX", Math.max(NORMS.reviewGapDays, 1) * 86400);
  let status = "simulado";
  if (!sim) {
    const href = `https://${host}/api/resena/${encodeURIComponent(b.email)}/${await reviewToken(b.email)}`;
    const m = reviewContent(b, href, await unsubFoot(b.email, host));
    const ok = await send(b.email, m.subject, m.title, m.html, await ownerMail());
    status = ok ? "enviado" : "fallido";
  }
  await logNotice({ type: "resena", email: b.email, name: b.name || "", status, by, bookingId: b.id, service: b.service.name, date: b.date });
  return status;
}

// ── Copias de seguridad ────────────────────────────────────────────────────
// Todo lo que hay en la base de esta app, en un JSON que se puede guardar y
// volver a cargar. Se dejan fuera sesiones, códigos y cerrojos (caducan solos
// y no hacen falta). Las fotos van en un archivo aparte porque pesan mucho.
// El ranking (lb:*) tampoco: se rehace solo a partir de las citas y compras.
const SKIP = /^(sess:|staffsess:|rl:|code:|lock:|chargelock:|rdlock:|secret:|idem:|booking:|soon:|reminded:|revask:|wlsent:|cronday:|contacts:|lb:|lbday:)/;
const PHOTOKEY = /^(siteimg:|prodimg:|teamimg:)/;
async function backup(part) {
  const keys = (await scanKeys("*")).filter((k) => !SKIP.test(k) && (part === "photos" ? PHOTOKEY.test(k) : !PHOTOKEY.test(k)));
  const data = await dumpKeys(keys.sort());
  return { app: "nova-reservas", part, version: 1, created: T.nowLocal().stamp, count: data.length, data };
}

// Puntos del Club por una compra de ropa (la misma ficha que lee clubOf).
async function clubPurchase(u, amount, items, by) {
  const now = T.nowLocal();
  const p = { id: "S" + crypto.randomBytes(3).toString("hex").toUpperCase(), email: u.email, name: u.name, amount, items, points: Math.round(amount * POINTS.perEuro), date: now.date, created: now.stamp, by };
  await pipe([
    ["SET", "sh:" + p.id, JSON.stringify(p)],
    ["SADD", "ush:" + u.email, p.id],
  ]);
  await rankTouch(u.email);
  return p;
}

// Quita los puntos de una compra de ropa (deshacer una venta o cancelar un pedido cobrado).
async function dropClubPurchase(id) {
  const sp = await getJSON("sh:" + id);
  if (!sp) return;
  await pipe([
    ["DEL", "sh:" + sp.id],
    ["SREM", "ush:" + sp.email, sp.id],
  ]);
  await rankTouch(sp.email);
}

// ── Pedidos de NOVA Supply (ver _lib/shop.js) ──────────────────────────────
// Los puntos del Club de un pedido cobrado: la misma ficha que una venta de caja.
async function shopClub(o) {
  const u = o.email && (await getJSON("user:" + o.email));
  const units = o.items.reduce((a, l) => a + l.cantidad, 0);
  return u && o.total > 0 ? clubPurchase(u, o.total, units, o.paidBy || "app") : null;
}
// Precio de una reserva de la web: el que guardó la web en la reserva (si lo trae) o, si no, el de hoy (con la promo si aplica).
function pedidoPrecio(ped, p, ctx) {
  const guardado = Of.numero(ped.precioNum ?? ped.precio ?? ped.importe);
  if (guardado != null && guardado >= 0) return guardado;
  return p?.precio == null ? null : Shop.priceOf(p, 0, ctx).unit;
}
// Estado de la promo para el panel (de dónde sale y cuándo se leyó).
function ofertaInfo(ctx) {
  const l = ctx.lectura || {};
  return { ...(Of.publica(ctx.oferta, ctx.now) || {}), hay: !!ctx.oferta, fuente: l.fuente || "ninguna", leida: l.leida || null, error: l.error || "", url: Of.desactivada() ? "" : Of.oferUrl() };
}
const shopHooks = { club: shopClub, dropClub: dropClubPurchase };
// Pago online: Stripe si hay clave; sin clave, simulado solo en demo/local; si no, no hay.
const shopOnlineMode = () => (Card.shopOnline() ? "stripe" : process.env.MODO_DEMO === "1" || !ON_VERCEL ? "demo" : null);
const shopErr = (e) => {
  if (e instanceof Shop.ShopError) fail(e.status, e.message);
  throw e;
};
// Descuento de socio NOVA+ en la ropa (el que el plan define para «el resto de servicios y la ropa»).
async function shopDiscount(email) {
  const sub = email ? await memberOf(email) : null;
  return M.isLive(sub, T.nowLocal().date) ? sub.plan?.discountPct || 0 : 0;
}
// La promo de novasupply.es (única fuente, ver _lib/oferta.js) para fijar precios ahora mismo.
async function shopCtx() {
  const r = await Of.leerOferta().catch(() => ({ oferta: null }));
  return { oferta: r.oferta, now: new Date(), lectura: r };
}
// Pedido que se hace al reservar la cita: se paga en el local, en la cita.
async function merchForBooking(user, raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  try {
    const r = await Sup.leer({ ventas: 1 });
    const pre = Shop.prepare(r.prendas, raw, await shopDiscount(user.email), await shopCtx());
    return await Shop.create({ user, ...pre, pay: "local" });
  } catch (e) {
    return shopErr(e);
  }
}
const bookingState = async (id) => {
  const b = await getJSON("bk:" + id);
  return b ? { canceled: b.status === "canceled", date: b.date } : null;
};

// ── Asistente de IA (MCP) ──────────────────────────────────────────────────
// Un asistente (Claude, ChatGPT, Grok…) reserva por orden del cliente en
// /api/mcp. El protocolo está en _lib/mcp.js y los tokens en _lib/assistant.js;
// aquí solo se enchufan las herramientas a las MISMAS funciones que usa la web
// (freeSlots/freeTimes, codeRequest/codeCheck, bookFor, bookingsOf, cancelFor):
// ni una regla de la agenda está repetida.
const DEFAULT_HOST = "nova.appflu.es";
const publicBase = (req) => {
  const h = hostOf(req) || DEFAULT_HOST;
  return (/^(localhost|127\.|\[::1\])/.test(h) ? "http://" : "https://") + h;
};
// ── Socio NOVA+ (membresía de pago) ────────────────────────────────────────
// Lo que ve el cliente de su membresía: estado, cortes usados y restantes, ventajas.
async function memberView(email) {
  const sub = await memberOf(email);
  if (!sub) return null;
  return M.viewOf(sub, await bookingsByIds(await cmd("SMEMBERS", "ubk:" + email)), T.nowLocal().date);
}
const memberOut = () => ({ name: MEMBERSHIP.name, enabled: true, demo: Card.membershipDemo(), plans: activePlans().map(M.planOut) });
// Pone al día la suscripción con lo que dice Stripe (al volver de Checkout, por si el webhook aún no ha llegado).
async function syncMember(sub) {
  if (Card.membershipDemo() || !sub?.stripeCustomer) return sub;
  const s = await Card.latestSubscription(sub.stripeCustomer).catch(() => null);
  if (!s) return sub;
  const evId = "sync-" + s.id + "-" + s.status + "-" + (s.current_period_end ?? s.items?.data?.[0]?.current_period_end) + "-" + !!s.cancel_at_period_end;
  await M.applyEvent({ id: evId, type: "customer.subscription.updated", data: { object: s } });
  return M.getSub(sub.email);
}

// Navegadores: solo la propia web y los orígenes de MCP_ALLOWED_ORIGINS (separados por comas).
function mcpOriginOk(origin, req) {
  let o;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  const extra = String(process.env.MCP_ALLOWED_ORIGINS || "").split(",").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean);
  if (extra.includes("*") || extra.includes(o.origin)) return true;
  const own = String(process.env.PUBLIC_HOST || req.headers.host || "").toLowerCase();
  return !!own && o.host.toLowerCase() === own;
}
const euros = (n) => (n == null ? "precio a consultar" : `${n} €`);
const svcOut = (s) => ({ id: s.id, name: s.name, duration_min: s.duration ?? null, price_eur: s.price ?? null });
const bookingOut = (b) => {
  const late = lateCancel(b);
  return {
    id: b.id,
    service: svcOut(b.service),
    barber: { id: b.provider.id, name: b.provider.name },
    date: b.date,
    day: T.niceDate(b.date),
    start: b.start,
    end: b.end,
    status: b.status,
    pay: b.membership?.included ? `Incluida en tu membresía ${b.membership.planName}` : "En el local",
    free_cancellation: !late,
    late_cancel_fee_eur: late ? feeFor(b, "late") : 0,
    ...(b.note ? { note: b.note } : {}),
    ...(b.guarantee ? { guarantee: `Tarjeta ${b.guarantee.brand || ""} ···· ${b.guarantee.last4}`.replace(/\s+/g, " ") } : {}),
  };
};
const S_DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Fecha en formato AAAA-MM-DD (hora de Canarias).", examples: ["2026-12-03"] };
const S_TIME = { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "Hora de inicio HH:MM tal como la devuelve get_availability.", examples: ["17:30"] };
const S_SERVICE = { type: "string", minLength: 1, maxLength: 40, description: "Id del servicio (de list_services), p. ej. «corte»." };
const S_BARBER = { type: "string", minLength: 1, maxLength: 40, description: "Id del barbero (de list_barbers) o «any» para el primero que esté libre. Por defecto, «any»." };
const S_TOKEN = { type: "string", maxLength: 100, description: "Solo si tu cliente MCP no permite enviar la cabecera «Authorization: Bearer …»: el token de asistente (nova_ast_…)." };
const S_EMAIL = { type: "string", minLength: 5, maxLength: 120, description: "Correo del cliente." };

const MCP_TOOLS = [
  {
    name: "list_services",
    title: "Servicios y precios",
    description: "Lista los servicios de NOVA Studio con su id, nombre, duración en minutos y precio en euros. Los que tienen bookable=false no se reservan online (se piden por WhatsApp). No necesita token.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async () => {
      const list = activeSvcs().map((s) => ({
        ...svcOut(s),
        description: s.desc || "",
        bookable: !s.consult,
        ...(s.consult ? { how_to_book: `Por WhatsApp: https://wa.me/${BUSINESS.whatsapp}` } : { barbers: teamFor(s, "any").map((p) => p.id) }),
      }));
      const text =
        "Servicios de NOVA Studio (se paga en el local):\n" +
        list.map((s) => `- ${s.name} (id «${s.id}»): ${euros(s.price_eur)}${s.duration_min ? ` · ${s.duration_min} min` : ""}${s.bookable ? "" : " · no se reserva online, por WhatsApp"}`).join("\n");
      return { text, data: { currency: "EUR", services: list } };
    },
  },
  {
    name: "list_barbers",
    title: "Equipo",
    description: "Lista los barberos de NOVA Studio con su id, nombre, puesto, los servicios que hacen y sus próximos días libres. No necesita token.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async () => {
      const today = T.nowLocal().date;
      const list = activeTeam().map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role || "",
        services: activeSvcs().filter((s) => !s.consult && canDo(s, p)).map((s) => s.id),
        days_off: (p.off || []).filter((r) => r.to >= today).map(({ from, to }) => ({ from, to })),
      }));
      return { text: "Equipo de NOVA Studio:\n" + list.map((p) => `- ${p.name} (id «${p.id}»)${p.role ? ", " + p.role : ""}: ${p.services.join(", ")}`).join("\n"), data: { barbers: list } };
    },
  },
  {
    name: "get_availability",
    title: "Huecos libres",
    description: `Devuelve las horas libres (hora de Canarias) para un servicio desde una fecha y durante «days» días (1-14), con qué barberos están libres a cada hora. Respeta la antelación mínima (${RULES.leadMinutes} min), los días vista (${RULES.daysAhead}), las vacaciones y las citas ya puestas. No necesita token.`,
    inputSchema: {
      type: "object",
      properties: {
        service_id: S_SERVICE,
        date: { ...S_DATE, description: "Primer día a consultar (AAAA-MM-DD, hora de Canarias)." },
        days: { type: "integer", minimum: 1, maximum: 14, description: "Cuántos días seguidos mirar desde «date» (1-14). Por defecto, 1." },
        barber_id: S_BARBER,
      },
      required: ["service_id", "date"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a) => {
      const s = service(a.service_id);
      if (!s || s.active === false) fail(400, `No existe el servicio «${a.service_id}». Usa list_services para ver los ids.`);
      if (s.consult) fail(400, `«${s.name}» no se reserva online: se pide por WhatsApp (https://wa.me/${BUSINESS.whatsapp}).`);
      const pid = a.barber_id || "any",
        team = teamFor(s, pid);
      if (!team.length) fail(400, pid === "any" ? "Ahora mismo nadie del equipo hace este servicio." : `El barbero «${pid}» no existe o no hace «${s.name}». Usa list_barbers.`);
      if (!T.isDate(a.date)) fail(400, "Esa fecha no es válida. Usa AAAA-MM-DD.");
      const now = T.nowLocal(),
        last = T.addDays(now.date, RULES.daysAhead);
      if (a.date < now.date) fail(400, `Esa fecha ya ha pasado. Hoy es ${now.date} (hora de Canarias).`);
      if (a.date > last) fail(400, `Solo se reserva hasta ${RULES.daysAhead} días vista (hasta el ${last}).`);
      const days = (await freeSlots(s, team, a.date, a.days || 1)).map((d) => ({ date: d.date, day: T.niceDate(d.date), slots: d.slots }));
      const text =
        `Huecos libres para ${s.name} (${euros(s.price)}, ${s.duration} min) con ${pid === "any" ? "cualquier barbero" : team[0].name}:\n` +
        days.map((d) => `- ${d.day} (${d.date}): ${d.slots.length ? d.slots.map((x) => x.time).join(", ") : "sin huecos"}`).join("\n") +
        (NORMS.openFrom && a.date < NORMS.openFrom ? `\nAquí se reserva a partir del ${NORMS.openFrom}. Para antes: ${BUSINESS.booksy}` : "") +
        `\n(${BUSINESS.closedText}.)`;
      return {
        text,
        data: { timezone: BUSINESS.tz, today: now.date, bookable_until: last, service: svcOut(s), barber: pid, days },
      };
    },
  },
  {
    name: "request_login_code",
    title: "Pedir código de acceso",
    description: "Primer paso para conseguir el token de asistente: envía un código de 6 cifras al correo del cliente (caduca en 10 minutos). Después pide al cliente el código y llama a verify_login_code. Si ya tienes token, no hace falta.",
    inputSchema: { type: "object", properties: { email: S_EMAIL }, required: ["email"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: async (a, ctx) => {
      const email = normEmail(a.email);
      await limit("mcpcode:" + email, 5, 900);
      await limit("mcpcodeip:" + ctx.ip, 10, 900);
      const r = await codeRequest(email, ctx.ip);
      if (r.direct) {
        const demo = accessPolicy().demo;
        return {
          text: `${demo ? "Modo demo" : "Entorno de pruebas"}: no se envía ningún correo y se entra solo con el correo, igual que en la web. Llama ya a verify_login_code con este correo y cualquier código de 6 cifras (por ejemplo 000000).`,
          data: { sent: false, demo, next: "verify_login_code" },
        };
      }
      await cmd("SET", "mcpch:" + sha(r.email), r.challenge, "EX", 600);
      if (r.dev) return { text: "Entorno local sin correo: el código de 6 cifras sale en la consola del servidor. Llama después a verify_login_code.", data: { sent: false, dev: true, expires_in_minutes: 10, next: "verify_login_code" } };
      return {
        text: `Hemos enviado un código de 6 cifras a ${r.email}. Caduca en 10 minutos. Pídeselo al cliente y llama a verify_login_code con el correo y el código (y su nombre si es su primera vez).`,
        data: { sent: true, expires_in_minutes: 10, next: "verify_login_code" },
      };
    },
  },
  {
    name: "verify_login_code",
    title: "Confirmar código y obtener token",
    description: "Segundo paso: comprueba el código que le ha llegado al cliente y, si es correcto, crea un token de asistente y lo devuelve UNA sola vez. «name» es obligatorio si el cliente es nuevo (es el nombre que sale en la reserva y en el ranking del Club). Guarda el token y envíalo después en la cabecera «Authorization: Bearer <token>».",
    inputSchema: {
      type: "object",
      properties: {
        email: S_EMAIL,
        code: { type: "string", pattern: "^\\d{6}$", description: "Código de 6 cifras recibido por correo.", examples: ["123456"] },
        name: { type: "string", minLength: 2, maxLength: 60, description: "Nombre o apodo del cliente. Obligatorio si es su primera vez." },
        phone: { type: "string", maxLength: 30, description: "Teléfono del cliente (opcional)." },
        client_name: { type: "string", maxLength: 60, description: "Nombre de tu asistente o app (p. ej. «Claude»), para que el cliente reconozca el token en su perfil." },
      },
      required: ["email", "code"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      const email = normEmail(a.email);
      if (!EMAIL.test(email)) fail(400, "Revisa tu correo.");
      await limit("mcpverify:" + email, 10, 900);
      await limit("mcpverifyip:" + ctx.ip, 30, 900);
      const name = clean(a.name, 60),
        phone = clean(a.phone, 30);
      if (a.name !== undefined && name.length < 2) fail(400, "Falta tu nombre.");
      if (phone && !PHONE.test(phone)) fail(400, "Revisa tu teléfono.");
      const policy = accessPolicy();
      let check = null;
      if (!policy.direct) {
        const challenge = await cmd("GET", "mcpch:" + sha(email));
        if (!challenge) fail(400, "No hay ningún código pendiente para ese correo, o ha caducado. Pide uno con request_login_code.");
        check = await codeCheck(challenge, a.code);
      }
      // El código es bueno; si la cuenta es nueva y falta el nombre, no se gasta: se puede repetir con «name».
      const before = await getJSON("user:" + email);
      if (!before?.name && !name) fail(400, "Es la primera vez de este cliente: falta su nombre (el que sale en la reserva y en el ranking). Vuelve a llamar a verify_login_code con el mismo código y «name».", { needName: true });
      if (check) await Promise.all([check.consume(), cmd("DEL", "mcpch:" + sha(email))]);
      let { u, fresh } = await enterAccount(email, { verified: !policy.direct });
      if (!u.name) u = await saveName(u, { name, ...(phone ? { phone } : {}) });
      else if (phone && !u.phone) {
        u = { ...u, phone };
        await setJSON("user:" + email, u);
      }
      const t = await Tokens.createToken(email, { label: clean(a.client_name, 60) || "Asistente de IA", via: "asistente" });
      const base = publicBase(ctx.req);
      return {
        text:
          `Listo, ${u.name}. Este es tu token de asistente. Guárdalo ahora: no se volverá a mostrar.\n\n${t.token}\n\n` +
          `Envíalo en cada petición a este servidor MCP con la cabecera «Authorization: Bearer ${t.token}» (configúrala en tu cliente MCP). ` +
          `Si tu cliente no permite cabeceras, pásalo en el argumento «assistant_token» de create_booking, list_my_bookings, cancel_booking y revoke_assistant_token. ` +
          `Caduca a los ${Tokens.TOKEN_DAYS} días sin uso (cada uso lo renueva) y se puede revocar en ${base}/perfil o con revoke_assistant_token.`,
        data: { token: t.token, token_type: "Bearer", token_id: t.id, expires_at: t.exp, mcp_url: base + "/api/mcp", account: { name: u.name, email, new: fresh } },
      };
    },
  },
  {
    name: "create_booking",
    title: "Reservar cita",
    description: `Reserva una cita a nombre del cliente del token, con las mismas reglas que la web (huecos libres, antelación, máximo ${RULES.maxActive} citas pendientes, tarjeta en garantía si el estudio la pide). Confirma antes con el cliente servicio, barbero, día y hora, y que acepta las condiciones. Necesita token.`,
    inputSchema: {
      type: "object",
      properties: {
        service_id: S_SERVICE,
        barber_id: S_BARBER,
        date: S_DATE,
        time: S_TIME,
        accept_terms: { type: "boolean", description: "true solo si el cliente ha aceptado las condiciones de reserva y cancelación (enlace en la respuesta de error o en /condiciones)." },
        note: { type: "string", maxLength: 200, description: "Nota opcional para el barbero." },
        assistant_token: S_TOKEN,
      },
      required: ["service_id", "date", "time", "accept_terms"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    auth: true,
    run: async (a, ctx) => {
      const base = publicBase(ctx.req);
      if (a.accept_terms !== true)
        fail(400, `Antes de reservar, el cliente tiene que aceptar las condiciones (${base}/condiciones): cambio o cancelación gratis hasta ${NORMS.cancelHours} h antes; después, o si no viene, se puede cobrar según esas condiciones. Cuando las acepte, vuelve a llamar con accept_terms: true.`);
      await limit("mcpbook:" + ctx.account.id, 10, 3600);
      const user = await getJSON("user:" + ctx.account.email);
      if (!user) fail(401, "Esa cuenta ya no existe.");
      const r = await bookFor(
        user,
        { service: a.service_id, provider: a.barber_id || "any", date: a.date, start: a.time, terms: true, note: a.note },
        { from: "ast:" + ctx.account.id, via: "asistente" },
      );
      const b = bookingOut(r.booking);
      return {
        text: `Cita reservada: ${b.service.name} con ${b.barber.name}, ${b.day} a las ${b.start} (hasta las ${b.end}). ${r.out.membership ? `Incluida en su membresía ${r.out.membership.plan} (sin coste en el local; le quedan ${r.out.membership.left} cortes este periodo)` : `${euros(b.service.price_eur)}, se paga en el local`}. Referencia ${b.id}. Cambio o cancelación gratis hasta ${NORMS.cancelHours} h antes (con cancel_booking o en ${base}/mis-citas). Le llega la confirmación por correo.`,
        data: { booking: b, manage_url: base + "/mis-citas" },
      };
    },
  },
  {
    name: "list_my_bookings",
    title: "Mis próximas citas",
    description: "Lista las próximas citas del cliente del token (de la más cercana a la más lejana), con su id para cancelarlas. Necesita token.",
    inputSchema: { type: "object", properties: { assistant_token: S_TOKEN }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    auth: true,
    run: async (a, ctx) => {
      const u = await getJSON("user:" + ctx.account.email);
      if (!u) fail(401, "Esa cuenta ya no existe.");
      const list = (await bookingsOf(u.email)).upcoming.map(bookingOut);
      return {
        text: list.length ? `Próximas citas de ${u.name || u.email}:\n` + list.map((b) => `- ${b.day} ${b.start}: ${b.service.name} con ${b.barber.name} (ref. ${b.id})`).join("\n") : `${u.name || u.email} no tiene citas pendientes.`,
        data: { account: { name: u.name || "", email: u.email }, cancel_hours: NORMS.cancelHours, upcoming: list },
      };
    },
  },
  {
    name: "cancel_booking",
    title: "Cancelar cita",
    description: `Cancela una cita propia del cliente del token. Gratis hasta ${RULES.cancelHours} h antes (o lo que marque el estudio); con menos tiempo se puede cancelar igual, pero puede haber cargo según las condiciones: entonces hay que repetir con accept_late_fee: true tras avisar al cliente. Necesita token.`,
    inputSchema: {
      type: "object",
      properties: {
        booking_id: { type: "string", pattern: "^[A-Za-z0-9]{1,20}$", description: "Id (referencia) de la cita, de list_my_bookings." },
        accept_late_fee: { type: "boolean", description: "true si el cliente acepta que la cancelación tardía puede tener cargo." },
        assistant_token: S_TOKEN,
      },
      required: ["booking_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    auth: true,
    run: async (a, ctx) => {
      await limit("mcpcancel:" + ctx.account.id, 10, 3600);
      const b = await getJSON("bk:" + a.booking_id);
      if (!b || b.kind !== "booking" || b.email !== ctx.account.email) fail(404, "No encontramos esa cita entre las del cliente. Usa list_my_bookings para ver los ids.");
      if (b.status !== "confirmed") return { text: `La cita ${b.id} ya no estaba activa.`, data: { ok: true, id: b.id, already: true } };
      const fee = feeFor(b, "late");
      if (T.minutesUntil(b.date, b.start) > 0 && lateCancel(b) && fee > 0 && a.accept_late_fee !== true)
        fail(400, `Quedan menos de ${NORMS.cancelHours} h para la cita. Se puede cancelar, pero según las condiciones se le pueden cobrar ${euros(fee)} (lo decide su barbero; si hay un motivo justificado, que escriba por WhatsApp). Si el cliente lo acepta, vuelve a llamar con accept_late_fee: true.`, { late: true, fee_eur: fee });
      const r = await cancelFor(b, { staff: false, host: hostOf(ctx.req) });
      return {
        text: `Cita ${b.id} cancelada (${b.service.name}, ${T.niceDate(b.date)} a las ${b.start}). ${r.late ? `Ha sido una cancelación tardía: su barbero revisará si se cobran ${euros(r.fee)}.` : "Sin coste."} La hora queda libre para otra persona.`,
        data: { ok: true, id: b.id, late: !!r.late, fee_eur: r.fee || 0 },
      };
    },
  },
  {
    name: "revoke_assistant_token",
    title: "Revocar este token",
    description: "Revoca el token de asistente con el que se hace la llamada. Después ya no sirve para reservar ni ver citas. Necesita token.",
    inputSchema: { type: "object", properties: { assistant_token: S_TOKEN }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    auth: true,
    run: async (a, ctx) => {
      await Tokens.revokeToken(ctx.account.email, ctx.account.id);
      return { text: "Token revocado. Este asistente ya no puede reservar ni ver citas en nombre del cliente. Para volver a conectarlo hay que pedir otro token.", data: { ok: true, revoked: ctx.account.id } };
    },
  },
];

const MCP_OPTS = {
  serverInfo: { name: "nova-studio-reservas", title: "NOVA Studio · Reservas", version: "1.0.0" },
  instructions:
    "Reservas de NOVA Studio, barbería en Vecindario (Gran Canaria). Las fechas y horas son de Canarias (Atlantic/Canary). " +
    "Flujo: list_services y list_barbers → get_availability → si no tienes token, request_login_code y verify_login_code → create_booking. " +
    "No inventes huecos: usa siempre get_availability. Antes de reservar o cancelar, confirma con el cliente servicio, barbero, día y hora. " +
    "El token va en la cabecera «Authorization: Bearer nova_ast_…».",
  tools: MCP_TOOLS,
  ip,
  originOk: mcpOriginOk,
  resolveToken: async (t) => {
    const rec = await Tokens.verifyToken(t);
    return rec && (await cmd("GET", "user:" + rec.email)) ? rec : null;
  },
  before: async (ctx) => {
    await limit("mcp:" + ctx.ip, 240, 60, "Demasiadas peticiones. Espera un minuto.");
    await loadTeam();
  },
  needAuthText: (ctx) =>
    `Esta acción necesita el token de asistente del cliente. Pídele su correo y usa request_login_code y después verify_login_code con el código que le llega; o que lo genere en su perfil (${publicBase(ctx.req)}/perfil → «Conectar mi asistente de IA»). Después envíalo en la cabecera «Authorization: Bearer <token>».`,
  errorText: (e, ctx) => {
    if (!(e instanceof HttpError)) return null;
    if (e.card)
      return {
        text: `Para reservar online, NOVA Studio pide una tarjeta en garantía (no se cobra nada al reservar; solo si el cliente falta o cancela tarde). Eso no se puede hacer desde el asistente: el cliente tiene que añadirla una vez en ${publicBase(ctx.req)}/perfil («Tu tarjeta») y después puedes volver a pedir la cita.`,
        data: { need_card: true, url: publicBase(ctx.req) + "/perfil" },
      };
    if (e.alternatives) return { text: e.message + " " + e.alternatives.map((x) => `${x.date} ${x.start}${x.provider ? " con " + x.provider.name : ""}`).join(" · "), data: { alternatives: e.alternatives } };
    const { status, message, stack, ...extra } = e;
    return { text: message, ...(Object.keys(extra).length ? { data: extra } : {}) };
  },
};

async function mcpHttp(req, res) {
  try {
    await serveMcp(req, res, MCP_OPTS);
  } catch (e) {
    console.error("MCP", e);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Error interno del servidor." } }));
  }
}

// llms.txt (llmstxt.org): qué es NOVA, precios, horario y cómo reservar, para
// asistentes de IA. Sale de los mismos datos que la app (los servicios y el
// equipo que edita el dueño en su panel), así que nunca se queda desfasado.
async function llmsTxt(req) {
  const base = publicBase(req),
    site = await siteInfo(),
    c = contactOut(site.contact),
    svcs = activeSvcs(),
    team = activeTeam();
  const bookable = svcs.filter((s) => !s.consult);
  const lines = [
    `# ${BUSINESS.name}`,
    "",
    `> ${BUSINESS.tagline} (Gran Canaria, España): ${bookable.map((s) => s.name.toLowerCase()).join(", ")}. Se reserva online en ${base}/ o pidiéndoselo a un asistente de IA con nuestro servidor MCP, sin llamar.`,
    "",
    `- Dirección: ${c.street}, ${c.city}`,
    `- Mapa: ${c.maps}`,
    `- Teléfono: ${BUSINESS.phone} · WhatsApp: https://wa.me/${c.whatsapp}`,
    `- Correo: ${BUSINESS.email}`,
    `- Instagram: ${c.instagram}`,
    `- Zona horaria: ${BUSINESS.tz} (hora de Canarias)`,
    "",
    "## Servicios y precios",
    "",
    ...svcs.map((s) => `- ${s.name} (id \`${s.id}\`): ${euros(s.price)}${s.duration ? ` · ${s.duration} min` : ""}${s.consult ? " · no se reserva online, se pide por WhatsApp" : ""}. ${s.desc || ""}`.trim()),
    "",
    `${BUSINESS.drink} Se paga en el local.`,
    "",
    "## Equipo",
    "",
    ...team.map((p) => `- ${p.name} (id \`${p.id}\`)${p.role ? ", " + p.role : ""}: ${svcs.filter((s) => !s.consult && canDo(s, p)).map((s) => s.name).join(", ")}`),
    "",
    "## Horario",
    "",
    ...BUSINESS.hoursText.map(([d, h]) => `- ${d}: ${h.replace(/\s*—\s*/, "–")}`),
    `- ${BUSINESS.closedText}`,
    "",
    "## Normas de reserva",
    "",
    `- Antelación mínima: ${RULES.leadMinutes} minutos. Se reserva hasta ${RULES.daysAhead} días vista.`,
    `- Como mucho ${RULES.maxActive} citas pendientes por cliente.`,
    `- Cambio o cancelación gratis hasta ${NORMS.cancelHours} h antes. Después se puede cancelar igual, pero se puede cobrar según las condiciones (${base}/condiciones).`,
    ...(Card.cardEnabled() ? ["- Para reservar online hace falta una tarjeta en garantía guardada en el perfil (no se cobra nada al reservar). Se añade en la web, no desde el asistente."] : []),
    ...(NORMS.openFrom > T.nowLocal().date ? [`- Aquí se reserva a partir del ${NORMS.openFrom}. Para antes: ${BUSINESS.booksy}`] : []),
    "",
    "## Cómo reservar",
    "",
    `1. En la web: ${base}/reservar. Eliges servicio, barbero y hora, y entras con tu correo (te llega un código de 6 cifras${accessPolicy().demo ? "; ahora mismo la web está en modo demo y basta con el correo" : ""}).`,
    "2. Con tu asistente de IA (Claude, ChatGPT, Grok…), conectándolo a nuestro servidor MCP. Ejemplo: «Pídeme cita con Airam el jueves por la tarde».",
    "",
    "## Reservar con un asistente de IA (MCP)",
    "",
    `- Servidor MCP (Streamable HTTP, JSON-RPC 2.0 por POST, respuestas JSON): ${base}/api/mcp`,
    "- Sin token: `list_services`, `list_barbers`, `get_availability`.",
    "- Con token: `create_booking`, `list_my_bookings`, `cancel_booking`, `revoke_assistant_token`.",
    `- Token: \`request_login_code\` (manda un código al correo del cliente) y \`verify_login_code\` (lo devuelve una sola vez), o desde el perfil en ${base}/perfil → «Conectar mi asistente de IA».`,
    "- Envía el token en la cabecera `Authorization: Bearer nova_ast_…` (o en el argumento `assistant_token` si tu cliente no permite cabeceras).",
    `- Caduca a los ${Tokens.TOKEN_DAYS} días sin uso y el cliente lo puede revocar cuando quiera.`,
    `- Descriptor: ${base}/.well-known/mcp.json`,
    "",
    "## Enlaces",
    "",
    `- [Reservar cita](${base}/reservar): servicios, barberos y horas libres`,
    `- [Mis citas](${base}/mis-citas): cambiar o cancelar`,
    `- [Condiciones](${base}/condiciones): reserva, cancelación y Club`,
    `- [Privacidad](${base}/privacidad)`,
    "",
    "## Optional",
    "",
    `- [Productos](${base}/productos)`,
    `- [Formación](${base}/formacion)`,
    `- [${SHOP.name}](${SHOP.url}): la tienda de ropa de la casa`,
    "",
  ];
  return lines.join("\n");
}

// ── Rutas ──────────────────────────────────────────────────────────────────
const routes = {
  // Piezas del mapa de la portada (OpenStreetMap), servidas desde aquí: así el
  // móvil del cliente solo habla con nuestro servidor. Solo la zona del estudio
  // y zooms 13-18, y con caché larga (las piezas apenas cambian), como pide la
  // política de uso de OpenStreetMap.
  "GET tile/:z/:x/:y": async ({ params }) => {
    const z = Number(params.z),
      x = Number(params.x),
      y = Number(String(params.y).replace(/\.png$/, ""));
    if (![z, x, y].every(Number.isInteger) || z < 13 || z > 18) fail(404, "No.");
    const n = 2 ** z,
      { lat, lng } = BUSINESS.geo;
    const cx = ((lng + 180) / 360) * n,
      cy = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    const r = 3 * 2 ** (z - 13) + 2; // unos 15 km alrededor a zoom 13, menos al acercarse
    if (Math.abs(x - cx) > r || Math.abs(y - cy) > r) fail(404, "Fuera de la zona.");
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { "User-Agent": "NOVA-reservas/1.0 (+https://nova.appflu.es)", Referer: "https://nova.appflu.es/" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) fail(502, "Mapa no disponible.");
    return { raw: Buffer.from(await res.arrayBuffer()), type: "image/png", cache: "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800" };
  },

  "GET catalog": async ({ res }) => {
    // Es igual para todos: el CDN de Vercel lo guarda 30 s y lo sirve sin
    // despertar la función (y sin tocar la base de datos). El panel, tras
    // cambiar algo, lo pide con ?t=… para saltarse esa copia.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=300");
    const c = publicCatalog();
    const site = await siteInfo();
    return {
      ...c,
      services: activeSvcs(),
      business: { ...c.business, ...contactOut(site.contact), rating: ratingOut(site.rating) },
      site: { photos: site.photos, theme: site.theme, notice: noticeOut(site.notice), gallery: GALLERY.filter((g) => site.photos[g]) },
      providers: activeTeam().map(publicProvider),
      rules: {
        ...c.rules,
        cancelHours: NORMS.cancelHours,
        lateFeePct: NORMS.lateFeePct,
        noShowFeePct: NORMS.noShowFeePct,
        recurring: NORMS.recurring,
        recurringMax: NORMS.recurringMax,
        // Mientras dure el paso desde Booksy: desde qué día se reserva aquí y adónde ir para antes.
        ...(NORMS.openFrom > T.nowLocal().date ? { openFrom: NORMS.openFrom, openBefore: BUSINESS.booksy } : {}),
      },
      reviews: !!(await reviewLink()).url,
      card: Card.cardPublic(),
      membership: memberOut(),
    };
  },

  // Para asistentes de IA: /llms.txt y /.well-known/mcp.json (vercel.json los manda aquí).
  "GET llms.txt": async ({ req }) => ({ raw: await llmsTxt(req), type: "text/plain; charset=utf-8", cache: "public, max-age=0, s-maxage=300, stale-while-revalidate=3600" }),
  "GET well-known/mcp.json": async ({ req }) => {
    const base = publicBase(req);
    return {
      raw: JSON.stringify(
        {
          name: MCP_OPTS.serverInfo.name,
          title: MCP_OPTS.serverInfo.title,
          version: MCP_OPTS.serverInfo.version,
          description: `Reservas de ${BUSINESS.name} (${BUSINESS.tagline}) para asistentes de IA.`,
          transport: { type: "streamable-http", url: base + "/api/mcp" },
          protocolVersions: ["2025-06-18", "2025-03-26"],
          authentication: {
            type: "bearer",
            required: false,
            description: "Las herramientas de consulta no necesitan token. Para reservar: request_login_code + verify_login_code, o el token generado en el perfil. Cabecera Authorization: Bearer nova_ast_…",
          },
          tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, requiresToken: !!t.auth })),
          documentation: base + "/llms.txt",
        },
        null,
        2,
      ),
      type: "application/json; charset=utf-8",
      cache: "public, max-age=0, s-maxage=300",
    };
  },

  // ── Conectar mi asistente de IA (perfil) ─────────────────────────────────
  // Con la sesión de la web: crear un token (se enseña una sola vez), ver los
  // activos (sin el token) y revocarlos.
  "GET assistant/tokens": async ({ req }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    return { tokens: await Tokens.listTokens(u.email), mcp: publicBase(req) + "/api/mcp", max: Tokens.MAX_TOKENS, days: Tokens.TOKEN_DAYS };
  },
  "POST assistant/tokens": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    await limit("asttok:" + u.email, 10, 3600);
    const t = await Tokens.createToken(u.email, { label: clean(body.label, 60) || "Asistente de IA", via: "perfil" });
    return { ...t, mcp: publicBase(req) + "/api/mcp" };
  },
  "POST assistant/tokens/:id/revoke": async ({ req, params }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    if (!(await Tokens.revokeToken(u.email, params.id))) fail(404, "Ese token ya no existe.");
    return { ok: true };
  },

  // Aviso legal: nombre y NIF del titular. No van en /api/catalog.
  "GET legal": async () => ({ holder: BUSINESS.holder, nif: BUSINESS.nif }),

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
      renew.push(["EXPIRE", "sess:" + sha(ck[SESSION]), YEAR], ["SET", "seen:" + u.email, T.nowLocal().date]);
      cookie(res, req, SESSION, ck[SESSION], YEAR);
    }
    if (st) {
      const ttl = staffTtl(st);
      renew.push(["EXPIRE", "staffsess:" + sha(ck[STAFF]), ttl]);
      cookie(res, req, STAFF, ck[STAFF], ttl);
    }
    if (renew.length) await pipe(renew);
    // Si el correo de esta cuenta es el de alguien del equipo, se le ofrece su panel
    // (la clave se pide una vez y luego la sesión dura un año).
    let staffHint = null;
    if (u && !st) {
      const found = team.find((p, i) => (p.email && p.email === u.email) || (cfgs[i] && JSON.parse(cfgs[i]).email === u.email));
      if (found) staffHint = { id: found.id, name: found.name };
    }
    return { user: publicUser(u), staff: st, staffHint, mail: mailReady(), auth: authChannels(), ...(u ? { membership: await memberView(u.email) } : {}) };
  },

  "GET referral/:code": async ({ params }) => {
    const code = String(params.code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const email = code && (await cmd("GET", "refcode:" + code));
    if (!email) fail(404, "Ese código no existe.");
    const u = await getJSON("user:" + email);
    return { name: String(u?.name || "un socio").split(" ")[0], points: POINTS.perFriend };
  },

  // El «próximo hueco libre» de la portada: la primera hora de cualquiera del
  // equipo para un servicio. Es igual para todos, así que el CDN lo guarda 30 s
  // y casi todas las visitas lo reciben sin despertar la función. Todo el
  // equipo y los dos meses se leen en un solo viaje a la base de datos.
  "GET next": async ({ res, q }) => {
    const s = service(q.get("service")) || activeSvcs().find((x) => !x.consult);
    if (!s || s.consult || s.active === false) fail(400, "Petición incorrecta.");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=120");
    const now = T.nowLocal(),
      team = activeTeam().filter((p) => canDo(s, p)),
      months = [monthOf(now.date), monthOf(T.addDays(monthOf(now.date) + "-01", 32))]; // este mes y el siguiente
    const pairs = team.flatMap((p) => months.map((m) => [p, m]));
    const raws = await pipe(pairs.map(([p, m]) => ["HGETALL", `occ:${p.id}:${m}`]));
    const busy = {};
    pairs.forEach(([p], i) => {
      const b = (busy[p.id] ||= {});
      for (const v of Object.values(hgetall(raws[i]))) {
        const [date, a, z] = v.split("|");
        (b[date] ||= []).push([T.toMin(a), T.toMin(z)]);
      }
    });
    for (let i = 0; i <= RULES.daysAhead; i++) {
      const date = T.addDays(now.date, i);
      if (!months.includes(monthOf(date))) break;
      let best = null;
      for (const p of team) {
        const t = freeTimes(p, s, date, busy[p.id] || {}, now)[0];
        const load = (busy[p.id]?.[date] || []).reduce((a, [x, y]) => a + y - x, 0);
        if (t && (!best || t < best.start || (t === best.start && load < best.load))) best = { provider: p.id, start: t, load };
      }
      if (best) return { service: s.id, provider: best.provider, date, start: best.start };
    }
    return { service: s.id, none: true };
  },

  // Horas libres de un mes. Con provider = "any", las de todo el equipo juntas.
  // `full`: días de trabajo sin horas libres, donde se puede pedir aviso.
  "GET avail": async ({ req, q }) => {
    const staff = q.get("staff") === "1" && !!(await staffOf(req));
    const s = service(q.get("service")),
      pid = q.get("provider"),
      month = q.get("month") || "";
    const team = teamFor(s, pid);
    if (!s || s.consult || s.active === false || !team.length || !/^\d{4}-\d{2}$/.test(month)) fail(400, "Petición incorrecta.");
    const now = T.nowLocal(),
      horizon = horizonOf(await memberOf((await currentUser(req))?.email)),
      busies = await Promise.all(team.map((p) => busyOf(p.id, month))),
      [y, m] = month.split("-").map(Number),
      total = new Date(Date.UTC(y, m, 0)).getUTCDate(),
      days = {},
      full = [];
    for (let d = 1; d <= total; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      days[date] = [...new Set(team.flatMap((p, i) => freeTimes(p, s, date, busies[i], now, horizon, staff)))].sort();
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
      if (prev?.out) return prev.out;
      if (prev || (await cmd("SET", idem, "{}", "NX", "EX", 60)) !== "OK") fail(409, "Tu reserva se está guardando…", { pending: true });
    }
    try {
      const r = await bookNow(req, res, body);
      if (idem) await setJSON(idem, { out: r.out }, "EX", 86400);
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
    if (!s || s.consult || s.active === false || !pid) fail(400, "Elige servicio y barbero.");
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
    const { upcoming, past, list, now } = await bookingsOf(u.email);
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
    return cancelFor(b, { staff, series: body?.series === true, host: hostOf(req) });
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
    const sub = await memberOf(b.email);
    if (!freeTimes(p, s, body.date, busy, T.nowLocal(), horizonOf(sub), !!staff).includes(body.start))
      fail(409, "Esa hora ya no está libre. Elige otra, por favor.");
    // Una cita incluida en la membresía solo se mueve a un día donde siga cubierta (mismo periodo con cortes libres).
    if (b.membership?.included && !staff) {
      const mine = await bookingsByIds(await cmd("SMEMBERS", "ubk:" + b.email));
      if (!M.coverage(sub, s.id, body.date, mine, T.nowLocal().date, b.id).included)
        fail(400, "Ese día queda fuera de tu periodo de membresía o sin cortes libres. Elige un día dentro de tu mes o cancela esta cita.");
    }
    const moved = { ...b, date: body.date, start: body.start, end: T.toHHMM(T.toMin(body.start) + b.service.duration) };
    if (b.membership?.included) {
      const w = M.windowFor(sub, body.date);
      if (w) moved.membership = { ...b.membership, from: w.start, to: w.end };
    }
    await moveTo(b, moved);
    if (!staff) await notifySalon(moved, "Cita cambiada");
    await waitlistPing(b.date, hostOf(req));
    return { ok: true };
  },

  // ── Socio NOVA+ ─────────────────────────────────────────────────────────
  // Membresía mensual de pago. Sin STRIPE_SECRET_KEY va en modo demo: alta y
  // baja al momento, sin cobro y marcadas como demo.
  "GET membership": async ({ req, q }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    let sub = await memberOf(u.email);
    if (q.get("sync") === "1" && sub && sub.status !== "active") sub = await syncMember(sub);
    return { ...memberOut(), mine: sub ? M.viewOf(sub, await bookingsByIds(await cmd("SMEMBERS", "ubk:" + u.email)), T.nowLocal().date) : null };
  },

  "POST membership/join": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    await limit("memjoin:" + u.email, 10, 3600);
    if (!clean(u.name)) fail(400, "Falta tu nombre.");
    const plan = activePlans().find((p) => p.id === body.plan);
    if (!plan) fail(400, "Ese plan no existe.");
    const prev = await memberOf(u.email);
    if (prev && ["active", "past_due"].includes(prev.status)) fail(409, prev.status === "past_due" ? "Tu cuota está impagada. Actualiza el pago desde «Gestionar»." : "Ya eres socio.");
    const today = T.nowLocal().date;
    const base = { email: u.email, name: u.name, plan: M.planSnapshot(plan), created: today };
    if (Card.membershipDemo()) {
      const sub = await M.saveSub({ ...base, status: "active", demo: true, since: today, periodStart: today, periodEnd: M.addMonths(today, 1), cancelAtPeriodEnd: false });
      await M.recordRevenue({ id: `demo-${u.email}-${today}`, email: u.email, amount: plan.price, plan: plan.id, planName: plan.name, at: today, demo: true });
      return { demo: true, mine: M.viewOf(sub, await bookingsByIds(await cmd("SMEMBERS", "ubk:" + u.email)), today) };
    }
    let stripe = u.stripe;
    if (!stripe) {
      stripe = await Card.ensureCustomer(u);
      await setJSON("user:" + u.email, { ...u, stripe });
    }
    const price = await Card.ensureMembershipPrice(plan, PLANS.findIndex((p) => p.id === plan.id) === 0);
    // Se apunta antes de ir a pagar: el webhook sabe a quién activar y con qué plan.
    await M.saveSub({ ...base, status: "incomplete", demo: false, stripeCustomer: stripe, since: "", cancelAtPeriodEnd: false });
    const s = await Card.membershipCheckout({ customer: stripe, price, email: u.email, plan: plan.id, base: publicBase(req) });
    return { url: s.url };
  },

  // Baja. En demo es inmediata; con Stripe se deja de cobrar al acabar el periodo ya pagado.
  "POST membership/cancel": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    const sub = await memberOf(u.email);
    if (!sub || !["active", "past_due"].includes(sub.status)) fail(400, "No tienes ninguna membresía activa.");
    const undo = body?.resume === true;
    const today = T.nowLocal().date;
    let next;
    if (sub.demo) {
      next = undo ? { ...sub, cancelAtPeriodEnd: false } : { ...sub, status: "canceled", cancelAtPeriodEnd: false, canceledAt: today };
    } else {
      if (!sub.stripeSub) fail(400, "Tu alta aún se está confirmando. Espera un momento.");
      await Card.membershipCancel(sub.stripeSub, !undo);
      next = { ...sub, cancelAtPeriodEnd: !undo };
    }
    await M.saveSub(next);
    return { mine: M.viewOf(next, await bookingsByIds(await cmd("SMEMBERS", "ubk:" + u.email)), today) };
  },

  // Portal de Stripe: cambiar la tarjeta de la cuota y ver las facturas.
  "POST membership/portal": async ({ req }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    const sub = await M.getSub(u.email);
    if (!sub || sub.demo || !sub.stripeCustomer) fail(400, Card.membershipDemo() ? "En modo demo no hay portal de pago." : "No tienes ninguna membresía.");
    return { url: await Card.membershipPortal(sub.stripeCustomer, publicBase(req)) };
  },

  // El panel del dueño: planes, socios y MRR.
  "GET staff/membership": async ({ req }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Esto lo ve solo el dueño.");
    const today = T.nowLocal().date;
    const subs = await Promise.all((await M.allSubs()).map((x) => M.advanceDemo(x, today)));
    const ids = [...new Set((await pipe(subs.map((x) => ["SMEMBERS", "ubk:" + x.email]))).flat())];
    const all = await bookingsByIds(ids);
    const members = subs
      .map((x) => ({ email: x.email, name: x.name || "", ...M.viewOf(x, all.filter((b) => b.email === x.email), today) }))
      .sort((a, b) => Number(b.live) - Number(a.live) || (b.since || "").localeCompare(a.since || ""));
    const live = members.filter((m) => m.live);
    const month = today.slice(0, 7);
    return {
      name: MEMBERSHIP.name,
      demo: Card.membershipDemo(),
      plans: PLANS,
      services: SVCS.filter((x) => !x.consult).map((x) => ({ id: x.id, name: x.name, price: x.price })),
      members,
      mrr: cents(live.reduce((a, m) => a + (m.plan?.price || 0), 0)),
      counts: { active: live.length, churning: live.filter((m) => m.cancelAtPeriodEnd).length, pastDue: members.filter((m) => m.status === "past_due").length, canceled: members.filter((m) => m.status === "canceled").length },
      month: { id: month, revenue: (await M.revenueOf(month)).amount },
      maxDays: 365,
    };
  },

  "POST staff/membership/plans": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Esto lo ve solo el dueño.");
    let plans;
    try {
      plans = M.cleanPlans(body.plans, SVCS.filter((x) => !x.consult).map((x) => x.id));
    } catch (e) {
      if (e instanceof RangeError) fail(400, e.message);
      throw e;
    }
    // No se puede quitar un plan con socios activos (sí desactivarlo, para que nadie nuevo lo contrate).
    const used = new Set((await M.allSubs()).filter((x) => ["active", "past_due"].includes(x.status)).map((x) => x.plan?.id));
    const lost = [...used].filter((id) => id && !plans.some((p) => p.id === id));
    if (lost.length) fail(400, "Hay socios con un plan que quieres quitar. Desactívalo en vez de borrarlo.");
    await setJSON("memplans", plans);
    return { ok: true, plans };
  },

  "GET member": async ({ req }) => {
    let u = await currentUser(req);
    if (!u) fail(401, "Entra para ver tu Club.");
    if (!u.ref) u = await ensureUser(u.email);
    return { user: publicUser(u), ...(await clubOf(u)) };
  },

  // El ranking. El móvil lo pide cada pocos segundos con la versión que tiene
  // (`v`): si nada ha cambiado se contesta con una sola lectura y sin datos.
  // scope = global | friends. Siempre por los puntos ganados desde siempre.
  // La foto de perfil de un socio del ranking, por su id del ranking (nunca
  // por su correo). Solo para quien ha entrado, como el ranking.
  "GET ranking/photo/:id": async ({ req, params }) => {
    if (!(await currentUser(req))) fail(401, "Entra para ver el ranking.");
    const email = await cmd("HGET", "lb:id", String(params.id).replace(/[^a-f0-9]/g, "").slice(0, 20));
    const u = email && (await getJSON("user:" + email));
    const m = u?.photo && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(u.photo);
    if (!m) fail(404, "Sin foto.");
    return { raw: Buffer.from(m[2], "base64"), type: m[1], cache: "private, max-age=31536000, immutable" };
  },

  "GET ranking": async ({ req, q }) => {
    const [ver, cfg] = await cmd("MGET", "lb:ver", "lb:cfg");
    const ready = cfg === rankCfg();
    if (ready && q.get("v") && q.get("v") === String(ver || 0)) return { same: true };
    const u = await currentUser(req);
    if (!u) fail(401, "Entra para ver el ranking.");
    let building = false;
    if (!ready) building = !(await rankRebuild(2500)).done;
    const scope = q.get("scope") === "friends" ? "friends" : "global";
    const mine = rankEntry(await cmd("HGET", "lb:u", u.email));
    const out = { v: String((await cmd("GET", "lb:ver")) || 0), scope, building, hidden: !!u.rankHidden, listed: !!mine, code: u.ref || "" };
    if (scope === "friends") {
      const friends = await friendsOf(u);
      const all = [u.email, ...friends];
      const raws = await cmd("HMGET", "lb:u", ...all);
      const rows = all
        .map((email, i) => {
          const e = rankEntry(raws[i]);
          return e && { k: e.id, n: e.n, p: e.a, a: e.a, ...(e.ph ? { ph: e.ph } : {}), ...(email === u.email ? { me: 1 } : {}) };
        })
        .filter(Boolean)
        .sort((x, y) => y.p - x.p || (x.me ? -1 : y.me ? 1 : x.n.localeCompare(y.n)));
      withRanks(rows);
      const i = rows.findIndex((x) => x.me);
      // A quién tienes justo delante (el primero con más puntos que tú).
      const ahead = i > 0 ? [...rows.slice(0, i)].reverse().find((x) => x.p > rows[i].p) : null;
      return { ...out, rows, total: rows.length, friends: friends.length, me: i >= 0 ? { r: rows[i].r, p: rows[i].p, ahead: ahead && { n: ahead.n, gap: ahead.p - rows[i].p } } : null };
    }
    const key = "lb:all";
    // `mini`: solo tu puesto (la tarjeta de «Puntos y premios»), sin la lista.
    const mini = q.get("mini") === "1";
    const [listed, total, myScore] = await pipe([
      mini ? ["ZCARD", key] : ["ZREVRANGE", key, 0, RANK_TOP - 1, "WITHSCORES"],
      ["ZCARD", key],
      ["ZSCORE", key, u.email],
    ]);
    const top = mini ? [] : listed;
    const emails = [];
    for (let i = 0; i < top.length; i += 2) emails.push([top[i], Number(top[i + 1])]);
    const raws = emails.length ? await cmd("HMGET", "lb:u", ...emails.map(([e]) => e)) : [];
    const rows = withRanks(
      emails
        .map(([email, p], i) => {
          const e = rankEntry(raws[i]);
          return e && { k: e.id, n: e.n, p, a: e.a, ...(e.ph ? { ph: e.ph } : {}), ...(email === u.email ? { me: 1 } : {}) };
        })
        .filter(Boolean),
    );
    let me = null;
    if (myScore !== null && myScore !== undefined) {
      const p = Number(myScore);
      const [above, next] = await pipe([
        ["ZCOUNT", key, "(" + p, "+inf"],
        ["ZRANGEBYSCORE", key, "(" + p, "+inf", "WITHSCORES", "LIMIT", 0, 1],
      ]);
      const aheadE = next?.length ? rankEntry(await cmd("HGET", "lb:u", next[0])) : null;
      me = { r: Number(above) + 1, p, ahead: aheadE && { n: aheadE.n, gap: Number(next[1]) - p } };
      // Si estás fuera de la lista, tu fila va al final, con tu puesto.
      if (!rows.some((x) => x.me) && mine) rows.push({ k: mine.id, n: mine.n, p, a: mine.a, ...(mine.ph ? { ph: mine.ph } : {}), me: 1, r: me.r, out: 1 });
    }
    return { ...out, rows, total: Number(total) || 0, me };
  },

  // Añadir un amigo con su código del Club (el mismo de invitar). Queda en los
  // dos sentidos: los dos os veis en «Amigos».
  "POST ranking/friends": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    await limit("fradd:" + u.email, 20, 3600);
    const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    const other = code.length >= 4 ? await cmd("GET", "refcode:" + code) : null;
    if (!other) fail(404, "Ese código no existe. Revísalo.");
    if (other === u.email) fail(400, "Ese es tu propio código.");
    if ((await friendsOf(u)).length >= 200) fail(400, "Ya tienes 200 amigos en el ranking, que es el máximo.");
    const f = await getJSON("user:" + other);
    if (!f) fail(404, "Ese código no existe. Revísalo.");
    await pipe([
      ["SADD", "fr:" + u.email, other],
      ["SADD", "fr:" + other, u.email],
      ["SREM", "frx:" + u.email, other],
      ["SREM", "frx:" + other, u.email],
      ["INCR", "lb:ver"],
    ]);
    return { ok: true, name: rankName(f.name) || "Tu amigo" };
  },

  // Quitar a un amigo (por el identificador del ranking, que es lo que ve el móvil).
  "POST ranking/friends/remove": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    const id = String(body.id || "");
    const friends = await friendsOf(u);
    const raws = friends.length ? await cmd("HMGET", "lb:u", ...friends) : [];
    const other = id && friends.find((_, i) => rankEntry(raws[i])?.id === id);
    if (!other) fail(404, "No encontramos a ese amigo.");
    await pipe([
      ["SREM", "fr:" + u.email, other],
      ["SREM", "fr:" + other, u.email],
      ["SADD", "frx:" + u.email, other],
      ["SADD", "frx:" + other, u.email],
      ["INCR", "lb:ver"],
    ]);
    return { ok: true };
  },

  // Salir (o volver a salir) en el ranking general. Los amigos te siguen viendo.
  "POST profile/rank": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    const { rankHidden, ...rest } = u;
    await setJSON("user:" + u.email, body.show === false ? { ...rest, rankHidden: true } : rest);
    await rankTouch(u.email);
    return { ok: true, rank: body.show !== false };
  },

  "POST profile/photo": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    const data = String(body.photo || "");
    if (data && (!PHOTO.test(data) || data.length > 250000)) fail(400, "Esa foto no vale. Prueba con otra.");
    await setJSON("user:" + u.email, { ...u, photo: data });
    await rankTouch(u.email); // la medalla de perfil completo
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
    await rankTouch(u.email); // el nombre del ranking y la medalla de perfil completo
    return { ok: true };
  },

  // ── Tarjeta en garantía ─────────────────────────────────────────────────
  // Paso 1: prepara el formulario de Stripe. Se guarda en el perfil de la
  // cuenta (para reservar ya hay que haber entrado con el código).
  "POST card/setup": async ({ req }) => {
    if (!Card.cardEnabled()) fail(400, "Ahora mismo no hace falta tarjeta.");
    await limit("cardsetup:" + ip(req), 10, 3600);
    let u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
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

  // Entrar o darse de alta, que es lo mismo: se pone el correo, llega un código
  // de 6 cifras y con él se entra. La cuenta se crea al acertar el código, nunca
  // antes: así no hay cuentas con correos de otros. (El teléfono, ver authChannels.)
  "POST auth/request": async ({ req, res, body }) => {
    if (body.phone !== undefined && body.email === undefined) {
      if (!authChannels().phone) fail(400, "Por ahora solo se puede entrar con el correo.");
    }
    const r = await codeRequest(body.email, ip(req));
    // LOGIN_CON_CODIGO=0 solo en local (o MODO_DEMO=1): se entra ya, sin comprobar el correo.
    if (r.direct) {
      const { u, fresh } = await enterAccount(r.email);
      await startSession(req, res, r.email);
      return { direct: true, fresh, needName: !u.name };
    }
    return r.dev ? { challenge: r.challenge, dev: true } : { challenge: r.challenge };
  },

  "POST auth/verify": async ({ req, res, body }) => {
    const c = await codeCheck(body.challenge, body.code);
    await c.consume();
    const { u, fresh } = await enterAccount(c.email, { verified: true });
    await startSession(req, res, c.email);
    // Falta el nombre (cuenta nueva o de antes): la app lo pide en el paso siguiente.
    return { ok: true, fresh, needName: !u.name };
  },

  // Último paso del alta: el nombre (el que sale en el ranking) y, si la cuenta
  // es nueva, el código del amigo que te invitó.
  "POST auth/name": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    return { user: publicUser(await saveName(u, body)) };
  },

  "POST auth/logout": async ({ req, res }) => {
    const t = cookies(req)[SESSION];
    if (t) await cmd("DEL", "sess:" + sha(t));
    cookie(res, req, SESSION, "", 0);
    return { ok: true };
  },

  // ── Equipo ──────────────────────────────────────────────────────────────
  "POST staff/login": async ({ req, res, body }) => {
    await limit("staff:" + ip(req), PIN_FAILS, PIN_WINDOW);
    // Además del límite por conexión, uno por cuenta que solo cuenta los fallos:
    // cambiar de red no sirve para ir probando claves de 4 cifras.
    const who = String(body.provider || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 30);
    const failKey = "rl:pinfail:" + who;
    if ((Number(await cmd("GET", failKey)) || 0) >= PIN_FAILS) fail(429, "Demasiadas claves incorrectas. Espera 30 minutos.");
    const wrong = async (msg) => {
      await hit(failKey, PIN_WINDOW);
      fail(400, msg);
    };
    if (body.provider === "caja") {
      const pin = String(body.pin || "");
      if (!pin || !activeTeam().some((x) => pinOk(x, pin))) await wrong("Clave incorrecta. Vale la de cualquiera del equipo.");
      const t = token();
      await cmd("SET", "staffsess:" + sha(t), "caja", "EX", CAJA_TTL);
      cookie(res, req, STAFF, t, CAJA_TTL);
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

  // La agenda de un día. También la ve la caja del mostrador (para saber quién
  // viene y cobrarle), pero sin teléfonos, correos ni faltas de los clientes.
  "GET staff/day": async ({ req, q }) => {
    const me = await needCaja(req);
    const date = q.get("date");
    if (!T.isDate(date)) fail(400, "Fecha incorrecta.");
    const list = (await bookingsByIds(await cmd("SMEMBERS", "day:" + date)))
      .filter((b) => b.date === date)
      .sort((a, b) => a.start.localeCompare(b.start));
    const info = me.caja ? { strikes: {}, card: {} } : await strikesAndCards(list.map((b) => b.email));
    return {
      date,
      providers: agendaTeam(list).map((p) => ({ id: p.id, name: p.name, color: p.color || "", hours: isOff(p, date) ? [] : p.hours?.[T.weekday(date)] || [], off: isOff(p, date) ? (p.off || []).find((r) => date >= r.from && date <= r.to) : null })),
      bookings: list.map((b) => (me.caja ? forCaja(b) : b.email ? { ...b, strikes: info.strikes[b.email] || 0, card: !!info.card[b.email] } : b)),
      cardEnabled: Card.cardEnabled(),
      now: T.nowLocal().stamp,
      alerts: me.owner ? await ownerAlerts() : [],
    };
  },

  // Semana o mes de la agenda (vista de calendario): de `from` a `to`, como
  // mucho 42 días (las 6 semanas que caben en un mes). Sin las canceladas.
  "GET staff/range": async ({ req, q }) => {
    const me = await needCaja(req);
    const from = q.get("from"),
      to = q.get("to");
    if (!T.isDate(from) || !T.isDate(to) || to < from) fail(400, "Fechas incorrectas.");
    const dates = [];
    for (let d = from; d <= to && dates.length < 42; d = T.addDays(d, 1)) dates.push(d);
    const sets = await pipe(dates.map((d) => ["SMEMBERS", "day:" + d]));
    const list = (await bookingsByIds([...new Set(sets.flat())]))
      .filter((b) => b.date >= from && b.date <= dates[dates.length - 1] && b.status === "confirmed")
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    // Las faltas y la tarjeta solo hacen falta en la semana (se abre la ficha de la cita).
    const info = me.caja || dates.length > 7 ? { strikes: {}, card: {} } : await strikesAndCards(list.map((b) => b.email));
    return {
      from,
      to: dates[dates.length - 1],
      providers: agendaTeam(list).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color || "",
        days: Object.fromEntries(dates.map((d) => [d, isOff(p, d) ? { off: (p.off || []).find((r) => d >= r.from && d <= r.to)?.note || true, hours: [] } : { hours: p.hours?.[T.weekday(d)] || [] }])),
      })),
      bookings: list.map((b) => (me.caja ? forCaja(b) : b.email ? { ...b, strikes: info.strikes[b.email] || 0, card: !!info.card[b.email] } : b)),
      cardEnabled: Card.cardEnabled(),
      now: T.nowLocal().stamp,
    };
  },

  // NOVA Supply: el barbero apunta una compra de ropa a la cuenta de un socio
  // (por su correo o su código del Club) y le suma los puntos.
  // ── Ropa (NOVA Supply): stock, ventas y reservas de la web ──────────────
  // Lo ve todo el equipo y la caja del mostrador (para vender y entregar);
  // cambiar prendas y unidades, solo el dueño.
  "GET staff/ropa": async ({ req }) => {
    const me = await needCaja(req);
    const r = await Sup.leer({ ventas: 80 });
    const ctx = await shopCtx();
    const conOferta = (p) => (p ? Shop.priceOf(p, 0, ctx).promo : null);
    const pendientes = r.pedidos
      .filter((x) => !x.estado || x.estado === "pendiente")
      .map(({ _raw, _i, ...x }) => {
        const p = Sup.prendaDePedido(r.prendas, x);
        return { ...x, prendaId: p?.id || "", prendaNombre: p ? p.nombre + (p.variante ? " · " + p.variante : "") : x.color, precio: pedidoPrecio(x, p, ctx) };
      });
    const mes = T.nowLocal().date.slice(0, 7);
    const delMes = r.ventas.filter((v) => String(v.fecha || "").startsWith(mes));
    return {
      owner: !!me.owner,
      tienda: SHOP.url,
      prendas: r.prendas.map((p) => ({ ...p, precioOferta: conOferta(p) })),
      oferta: ofertaInfo(ctx),
      pendientes,
      ventas: r.ventas.slice(0, 40),
      mes: { unidades: delMes.reduce((a, v) => a + (v.cantidad || 1), 0), importe: cents(delMes.reduce((a, v) => a + (Number(v.importe) || 0), 0)), estudio: delMes.filter((v) => v.canal === "estudio").length, web: delMes.filter((v) => v.canal === "web").length },
    };
  },

  "POST staff/ropa/prenda": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Las prendas las lleva el dueño.");
    const r = await Sup.leer({ ventas: 1 });
    const prev = body.id ? r.prendas.find((p) => p.id === body.id) : null;
    if (body.id && !prev) fail(404, "Esa prenda ya no existe.");
    const nombre = clean(body.nombre, 40);
    if (!nombre) fail(400, "Ponle un nombre.");
    if (!Sup.ESTADOS.includes(body.estado)) fail(400, "Elige si está a la venta, próximamente, agotada u oculta.");
    const tallas = Sup.TALLAS.filter((t) => [].concat(body.tallas || []).includes(t));
    if (body.estado === "disponible" && !tallas.length) fail(400, "Marca al menos una talla.");
    const precio = body.precio === "" || body.precio == null ? null : Math.round(Number(String(body.precio).replace(",", ".")) * 100) / 100;
    if (precio !== null && !(precio >= 0 && precio < 10000)) fail(400, "Revisa el precio.");
    const stock = {};
    for (const t of tallas) {
      const v = body.stock?.[t];
      if (v === "" || v === null || v === undefined) stock[t] = "";
      else {
        const n = Math.round(Number(v));
        if (!(n >= 0 && n < 10000)) fail(400, `Revisa las unidades de la ${t}.`);
        stock[t] = n;
      }
    }
    // Foto propia de la app (la misma mecánica que los productos del estudio): se guarda en `prodimg:sup-<id>`.
    const photo = String(body.photo || "");
    if (photo && (!PHOTO.test(photo) || photo.length > 280000)) fail(400, "Esa foto no vale. Prueba con otra.");
    const descripcion = String(body.descripcion ?? prev?.descripcion ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const item = await Sup.guardarPrenda(
      {
        id: prev?.id,
        nombre,
        variante: clean(body.variante, 30),
        color: clean(body.color, 20).toLowerCase(),
        precio,
        estado: body.estado,
        tallas,
        foto: prev?.foto || clean(body.foto, 80),
        descripcion,
        ...(photo ? { img: String(Date.now()) } : body.quitarFoto === true ? { img: "" } : {}),
        stock,
      },
      r.prendas,
    );
    if (photo) await cmd("SET", "prodimg:sup-" + item.id, photo);
    else if (body.quitarFoto === true) await cmd("DEL", "prodimg:sup-" + item.id);
    return { ok: true, prenda: item };
  },

  // Borrar una prenda del catálogo (solo el dueño, y solo si ningún pedido abierto la tiene apartada).
  "POST staff/ropa/prenda/borrar": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Las prendas las lleva el dueño.");
    const r = await Sup.leer({ ventas: 1 });
    const id = String(body.id || "");
    if (!r.prendas.some((p) => p.id === id)) fail(404, "Esa prenda ya no existe.");
    if ((await Shop.all()).some((o) => Shop.ABIERTOS.includes(o.estado) && o.items.some((l) => l.prenda === id))) fail(409, "Hay pedidos abiertos con esa prenda. Entrégalos o cancélalos antes, o mejor ponla como «Oculta».");
    await Sup.borrarPrenda(id, r.prendas);
    await cmd("DEL", "prodimg:sup-" + id);
    return { ok: true };
  },

  // ── Tienda NOVA Supply en la app (clientes) ─────────────────────────────
  // Catálogo con lo que se puede pedir ahora, sin números de stock (solo cuántas unidades por talla).
  "GET shop": async ({ req }) => {
    const u = await currentUser(req);
    const disc = u ? await shopDiscount(u.email) : 0;
    const r = await Sup.leer({ ventas: 1 });
    const ctx = await shopCtx();
    return { name: SHOP.name, prendas: Shop.orderable(r.prendas).map((p) => Shop.publicItem(p, disc, ctx)), oferta: Shop.publicOferta(ctx), discountPct: disc, online: shopOnlineMode(), perEuro: POINTS.perEuro, demo: shopOnlineMode() === "demo" };
  },
  "GET supply/:id/photo": async ({ params }) => {
    const data = await cmd("GET", "prodimg:sup-" + String(params.id).replace(/[^a-z0-9-]/g, ""));
    const m = data && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
    if (!m) fail(404, "Sin foto.");
    return { raw: Buffer.from(m[2], "base64"), type: m[1], cache: "public, max-age=31536000, immutable" };
  },
  "GET shop/orders": async ({ req }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra para ver tus pedidos.");
    return { orders: (await Shop.ofUser(u.email)).slice(0, 30).map(Shop.viewFor) };
  },
  "POST shop/orders": async ({ req, body }) => {
    const u = await currentUser(req);
    if (!u) fail(401, "Entra con tu correo para hacer un pedido. Te mandamos un código.");
    if (!clean(u.name)) fail(400, "Falta tu nombre.");
    await limit("shop:" + ip(req), 20, 3600);
    const pay = body.pay === "online" ? shopOnlineMode() : "local";
    if (!pay) fail(400, "El pago online no está activado. Puedes pagar en el local.");
    const open = (await Shop.ofUser(u.email)).filter((o) => o.estado === "pendiente" && o.pay === "stripe");
    if (open.length >= 3) fail(429, "Tienes varios pagos sin terminar. Complétalos o cancélalos antes de hacer otro pedido.");
    const disc = await shopDiscount(u.email);
    let o;
    try {
      const r = await Sup.leer({ ventas: 1 });
      const pre = Shop.prepare(r.prendas, body.items, disc, await shopCtx());
      o = await Shop.create({ user: u, ...pre, pay: pay === "stripe" ? "stripe" : "local", note: clean(body.note, 200) });
      if (pay === "stripe") {
        try {
          o = await Shop.startCheckout(o, { base: publicBase(req) });
        } catch (e) {
          await Shop.cancel(o.id, { by: "auto", reason: "No se pudo abrir el pago." }).catch(() => {});
          console.error("Checkout de pedido:", e.message);
          fail(502, "No hemos podido abrir el pago online. Prueba otra vez o paga en el local.");
        }
      } else if (pay === "demo") {
        // Pago simulado (demo, sin Stripe): se cobra al momento, sin dinero real.
        o = (await Shop.markPaid(o.id, { method: "demo", by: "demo", club: shopClub })) || o;
      }
    } catch (e) {
      return shopErr(e);
    }
    return { order: Shop.viewFor(o), ...(o.stripe?.url && o.estado === "pendiente" ? { url: o.stripe.url } : {}), demo: o.pay === "demo" };
  },
  // Al volver de Stripe (el webhook puede tardar): se pregunta a Stripe y se pone al día el pedido.
  "GET shop/orders/:id": async ({ req, params, q }) => {
    const u = await currentUser(req);
    let o = await Shop.get(params.id);
    if (!u || !o || o.email !== u.email) fail(404, "No encontramos ese pedido.");
    if (q.get("sync") === "1") o = await Shop.syncStripe(o, { club: shopClub });
    return { order: Shop.viewFor(o) };
  },
  "POST shop/orders/:id/cancel": async ({ req, params }) => {
    const u = await currentUser(req);
    const o = await Shop.get(params.id);
    if (!u || !o || o.email !== u.email) fail(404, "No encontramos ese pedido.");
    if (o.estado !== "pendiente") fail(400, o.estado === "cancelado" ? "Ese pedido ya está cancelado." : "Ese pedido ya está cobrado. Habla con el estudio para cambiarlo.");
    const done = await Shop.cancel(o.id, { by: "cliente" });
    return { order: Shop.viewFor(done) };
  },

  // ── Pedidos de NOVA Supply (equipo) ─────────────────────────────────────
  "GET staff/shop": async ({ req }) => {
    const me = await needCaja(req);
    await Shop.grantClubs(shopClub).catch(() => {});
    const list = await Shop.all();
    const mes = T.nowLocal().date.slice(0, 7);
    const paid = list.filter((o) => (o.paidAt || "").startsWith(mes) && o.estado !== "cancelado");
    return {
      owner: !!me.owner,
      orders: list.slice(0, 200).map(({ stripe, history, ...o }) => ({ ...o, online: !!stripe })),
      open: list.filter((o) => Shop.ABIERTOS.includes(o.estado)).length,
      mes: { pedidos: paid.length, importe: cents(paid.reduce((a, o) => a + o.total, 0)) },
    };
  },
  "POST staff/shop/:id/estado": async ({ req, params, body }) => {
    const me = await needCaja(req);
    const o = await Shop.get(params.id);
    if (!o) fail(404, "No encontramos ese pedido.");
    let done;
    try {
      done = await Shop.setEstado(o, String(body.estado || ""), { by: me.id, owner: !!me.owner, ...shopHooks });
    } catch (e) {
      shopErr(e);
    }
    return { order: done };
  },
  // «Cobrado en el local»: entra en la caja como venta de ropa y suma los puntos del Club.
  "POST staff/shop/:id/cobrar": async ({ req, params, body }) => {
    const me = await needCaja(req);
    const o = await Shop.get(params.id);
    if (!o) fail(404, "No encontramos ese pedido.");
    let importe;
    if (body.importe !== undefined && body.importe !== "" && body.importe !== null) {
      importe = Math.round(Number(String(body.importe).replace(",", ".")) * 100) / 100;
      if (!(importe >= 0 && importe <= 5000)) fail(400, "Revisa el importe.");
    }
    let done;
    try {
      done = await Shop.cobrarLocal(o, { by: me.id, importe, club: shopClub });
    } catch (e) {
      shopErr(e);
    }
    return { order: done, puntos: done.puntos || 0 };
  },

  // Venta en el estudio: baja el stock, queda apuntada para las dos webs y, si
  // es socio, le suma los puntos del Club.
  "POST staff/ropa/venta": async ({ req, body }) => {
    const me = await needCaja(req);
    const r = await Sup.leer({ ventas: 1 });
    const p = r.prendas.find((x) => x.id === body.prenda);
    if (!p) fail(400, "Elige la prenda.");
    const t = p.tallas.find((x) => x.talla === body.talla);
    if (!t) fail(400, "Elige la talla.");
    const n = Math.round(Number(body.cantidad || 1));
    if (!(n >= 1 && n <= 20)) fail(400, "Revisa cuántas se lleva.");
    const importe = Math.round(Number(String(body.importe ?? "").replace(",", ".")) * 100) / 100;
    if (!(importe >= 0 && importe <= 5000)) fail(400, "Pon el importe cobrado.");
    let socio = null;
    if (String(body.socio || "").trim()) {
      socio = await findMember(body.socio);
      if (!socio) fail(404, "No encontramos a ese socio. Prueba con su correo o su código del Club.");
    }
    if (!(await Sup.bajarStock(p.id, t.talla, n)))
      fail(409, `No quedan ${n > 1 ? n + " unidades libres" : "unidades libres"} de la ${t.talla}${t.apartadas ? ` (hay ${t.apartadas} apartada${t.apartadas > 1 ? "s" : ""} por reservas de la web)` : ""}.`);
    const now = T.nowLocal();
    const club = socio && importe > 0 ? await clubPurchase(socio, importe, n, me.id) : null;
    const venta = await Sup.apuntarVenta({
      fecha: now.stamp,
      canal: "estudio",
      prenda: p.id,
      nombre: p.nombre + (p.variante ? " · " + p.variante : ""),
      talla: t.talla,
      cantidad: n,
      importe,
      cliente: socio?.name || clean(body.cliente, 60),
      email: socio?.email || "",
      por: me.id,
      club: club?.id || "",
    });
    return { ok: true, venta, puntos: club?.points || 0 };
  },

  // Recogida de una reserva de la web: se entrega, se cobra y cuenta como venta.
  "POST staff/ropa/recogida": async ({ req, body }) => {
    const me = await needCaja(req);
    const ref = clean(body.ref, 20).toUpperCase();
    const r = await Sup.leer({ ventas: 1 });
    const ped0 = r.pedidos.find((x) => x.ref === ref);
    if (!ped0) fail(404, "No encontramos esa reserva.");
    const p = Sup.prendaDePedido(r.prendas, ped0);
    const importe = body.importe === undefined || body.importe === "" ? (pedidoPrecio(ped0, p, await shopCtx()) ?? 0) : Math.round(Number(String(body.importe).replace(",", ".")) * 100) / 100;
    if (!(importe >= 0 && importe <= 5000)) fail(400, "Revisa el importe.");
    const now = T.nowLocal();
    const ped = await Sup.marcarPedido(ref, { estado: "recogida", recogida: now.stamp, por: me.id });
    if (!ped) fail(404, "No encontramos esa reserva.");
    if (ped.yaCerrada) fail(400, `Esa reserva ya está ${ped.estado}.`);
    if (p) await Sup.bajarStock(p.id, ped.talla, 1, { force: true });
    const u = ped.correo ? await getJSON("user:" + normEmail(ped.correo)) : null;
    const club = u && importe > 0 ? await clubPurchase(u, importe, 1, me.id) : null;
    const venta = await Sup.apuntarVenta({
      fecha: now.stamp,
      canal: "web",
      prenda: p?.id || "",
      nombre: p ? p.nombre + (p.variante ? " · " + p.variante : "") : "Prenda",
      talla: ped.talla,
      cantidad: 1,
      importe,
      cliente: ped.nombre || "",
      email: ped.correo || "",
      ref,
      por: me.id,
      club: club?.id || "",
    });
    return { ok: true, venta, puntos: club?.points || 0 };
  },

  "POST staff/ropa/anular": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Solo el dueño anula reservas.");
    const ped = await Sup.marcarPedido(clean(body.ref, 20).toUpperCase(), { estado: "anulada", anulada: T.nowLocal().stamp, por: me.id });
    if (!ped) fail(404, "No encontramos esa reserva.");
    if (ped.yaCerrada) fail(400, `Esa reserva ya está ${ped.estado}.`);
    return { ok: true };
  },

  // Deshacer una venta apuntada por error: vuelve la unidad al stock y se
  // quitan los puntos. La caja solo deshace las de hoy.
  "POST staff/ropa/venta/:id/deshacer": async ({ req, params }) => {
    const me = await needCaja(req);
    const r = await Sup.leer({ ventas: 400 });
    const v = r.ventas.find((x) => x.id === params.id);
    if (!v) fail(404, "No encontramos esa venta.");
    if (v.canal === "web") fail(400, "Las recogidas de la web no se deshacen aquí: habla con el dueño.");
    if (v.pedido) fail(400, "Es de un pedido de la app: cancélalo desde «Pedidos».");
    if (!me.owner && v.por !== me.id && !(me.caja && String(v.fecha).startsWith(T.nowLocal().date))) fail(403, "Solo la puede deshacer quien la apuntó o el dueño.");
    await Sup.quitarVenta(v.id);
    if (v.prenda) await Sup.subirStock(v.prenda, v.talla, v.cantidad || 1);
    if (v.club) await dropClubPurchase(v.club);
    return { ok: true };
  },

  "GET staff/member": async ({ req, q }) => {
    await needCaja(req); // también la tablet del mostrador, que es donde se vende la ropa
    const u = await findMember(q.get("q"));
    if (!u) fail(404, "No encontramos a ese socio. Prueba con su correo o su código del Club.");
    const c = await clubOf(u);
    const sub = await memberOf(u.email);
    return { member: { email: u.email, name: u.name, no: u.no, earned: c.earned, balance: c.balance, ...(M.isLive(sub, T.nowLocal().date) && sub.plan?.discountPct ? { socio: { plan: sub.plan.name, discountPct: sub.plan.discountPct } } : {}) } };
  },

  "POST staff/shop": async ({ req, body }) => {
    // (Antigua: solo puntos, sin prenda. La venta de ropa nueva usa staff/ropa/venta.)
    const me = await needCaja(req);
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
    await rankTouch(u.email);
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
    await rankTouch(p.email);
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
    await rankTouch(b.email); // «Vino» da los puntos de amigo a quien le invitó; «No vino» quita la medalla sin faltas
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
    if (phone && !PHONE.test(phone)) fail(400, "Revisa tu teléfono.");
    if (email && !EMAIL.test(email)) fail(400, "Revisa tu correo.");
    if (body.consent !== true) fail(400, "Tienes que aceptar que te contactemos.");
    const pick = (v, list) => (list.some((x) => (x.id || x) === v) ? v : "");
    const many = (v, list) => [...new Set([].concat(v || []).filter((x) => list.includes(x)))];
    const level = pick(body.level, TRAINING.levels),
      format = pick(body.format, TRAINING.formats);
    if (!level) fail(400, "Dinos tu nivel.");
    await limit("train:" + ip(req), 6, 3600);
    const digits = phone.replace(/\D/g, "");
    const key = digits ? "trphone:" + digits : "";
    const prevId = key && (await cmd("GET", key));
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
    await pipe([["SET", "tr:" + t.id, JSON.stringify(t)], ...(key ? [["SET", key, t.id]] : []), ["SADD", "trall", t.id]]);
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
    await setJSON("tr:" + t.id, { ...t, status, note: body.note !== undefined ? clean(body.note, 400) : t.note, touched: T.nowLocal().stamp });
    return { ok: true };
  },

  // Clientes que ya han venido, para autocompletar al apuntar una cita: los
  // socios y quien fue apuntado sin correo en los últimos 4 meses. Se calcula
  // como mucho cada 15 minutos, y de nuevo en cuanto se apunta a alguien nuevo.
  "GET staff/contacts": async ({ req }) => {
    await needStaff(req);
    const saved = await cmd("GET", "contacts:list");
    if (saved) return { raw: saved, type: "application/json; charset=utf-8" };
    const now = T.nowLocal(),
      emails = await allEmails(),
      reads = [];
    for (let i = 0; i < emails.length; i += 300) reads.push(["MGET", ...emails.slice(i, i + 300).map((e) => "user:" + e)]);
    const dates = Array.from({ length: 121 + RULES.daysAhead }, (_, i) => T.addDays(now.date, i - 120));
    const [users, sets] = await Promise.all([pipe(reads), pipe(dates.map((d) => ["SMEMBERS", "day:" + d]))]);
    const digits = (p) => String(p || "").replace(/D/g, "");
    const out = new Map(),
      phones = new Set();
    for (const raw of users.flat()) {
      const u = raw && JSON.parse(raw);
      if (!u?.name) continue;
      out.set(u.email, { n: u.name, p: u.phone || "", e: u.email });
      if (u.phone) phones.add(digits(u.phone));
    }
    for (const b of await bookingsByIds([...new Set(sets.flat())])) {
      if (b.kind !== "booking" || b.email || !b.name) continue;
      const k = digits(b.phone) || "n:" + b.name.toLowerCase();
      if (out.has(k) || (b.phone && phones.has(digits(b.phone)))) continue;
      out.set(k, { n: b.name, p: b.phone || "", e: "" });
    }
    const json = JSON.stringify({ contacts: [...out.values()].sort((a, b) => a.n.localeCompare(b.n, "es")) });
    await cmd("SET", "contacts:list", json, "EX", 900);
    return { raw: json, type: "application/json; charset=utf-8" };
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
    if (!body.block) await cmd("DEL", "contacts:list");
    if (b.email) await ensureUser(b.email, b.name, b.phone);
    let series = null;
    if (!body.block && body.repeat) series = await makeSeries(b, service(b.service.id), p, body.repeat, 12, { name: b.name, phone: b.phone, email: b.email, by: "staff", byStaff: me.id }, true);
    return { id: b.id, series };
  },

  // Caja de un periodo: un mes (`month`) o de `from` a `to` (los dos días
  // incluidos, hasta dos años). Cada barbero ve solo lo suyo y sin comisiones;
  // el dueño ve a todo el equipo, el % de cada uno y lo que le toca cobrar.
  // «Marcar como cobrado» va por meses: solo sale cuando se mira un mes entero.
  "GET staff/summary": async ({ req, q }) => {
    const me = await needStaff(req);
    const now = T.nowLocal();
    let from, to, month;
    if (q.get("from")) {
      from = q.get("from");
      to = q.get("to") || from;
      if (!T.isDate(from) || !T.isDate(to) || to < from) fail(400, "Fechas incorrectas.");
      if (to >= T.addDays(from, 732)) fail(400, "Elige como mucho dos años.");
      month = from.endsWith("-01") && to === lastOfMonth(from.slice(0, 7)) ? from.slice(0, 7) : "";
    } else {
      month = q.get("month") || now.date.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400, "Mes incorrecto.");
      [from, to] = [month + "-01", lastOfMonth(month)];
    }
    const [all, pays] = await rangeData(from, to);
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
    if (!me.owner) return lean(), { month, from, to, owner: false, people };

    const workers = team.filter((p) => !p.owner);
    const [hist, paid] = await Promise.all([commissionHistory(workers), month && workers.length ? cmd("MGET", ...workers.map((p) => `commpaid:${p.id}:${month}`)) : []]);
    for (const person of people) {
      if (person.owner) continue;
      const h = hist[person.id];
      let commission = 0,
        includedCuts = 0,
        includedCommission = 0;
      for (const r of person.rows) {
        r.pct = rateAt(person.id, h, r.date);
        r.commission = cents((r.base * r.pct) / 100);
        commission += r.commission;
        if (r.included) {
          includedCuts++;
          includedCommission += r.commission;
        }
      }
      Object.assign(person, {
        pct: rateAt(person.id, h, to),
        commission: cents(commission),
        includedCuts,
        includedCommission: cents(includedCommission),
        expectedCommission: cents(person.upcomingRows.reduce((a, r) => a + (r.base * rateAt(person.id, h, r.date)) / 100, 0)),
        paid: (month && paid[workers.findIndex((w) => w.id === person.id)]) || "",
      });
    }
    lean();
    const own = people.filter((p) => p.owner).reduce((a, p) => a + p.billed, 0);
    const commissions = cents(people.reduce((a, p) => a + (p.commission || 0), 0));
    return {
      month,
      from,
      to,
      owner: true,
      people,
      totals: {
        salon: cents(people.reduce((a, p) => a + p.billed, 0)),
        own: cents(own),
        commissions,
        includedCuts: people.reduce((a, p) => a + (p.includedCuts || 0), 0),
        includedCommission: cents(people.reduce((a, p) => a + (p.includedCommission || 0), 0)),
        pendingCommissions: month ? cents(people.filter((p) => !p.owner && !p.paid).reduce((a, p) => a + p.commission, 0)) : 0,
        income: cents(own + commissions),
      },
    };
  },

  // Progreso: ganancias y ocupación mes a mes. Cada barbero ve solo lo suyo;
  // el dueño ve a todo el equipo y el total del salón.
  "GET staff/progress": async ({ req, q }) => {
    const me = await needStaff(req);
    const n = [6, 12].includes(Number(q.get("months"))) ? Number(q.get("months")) : 12;
    const now = T.nowLocal();
    const cur = now.date.slice(0, 7);
    const months = Array.from({ length: n }, (_, i) => shiftMonth(cur, i - n + 1));
    const prev = shiftMonth(cur, -1);
    const next = shiftMonth(cur, 1);
    const start = (m) => m + "-01 00:00";
    const until = (m) => (m === cur ? now.stamp : start(shiftMonth(m, 1)));

    // Meses cerrados: se guardan unas horas para no releerlo todo cada vez.
    const past = [...new Set([...months, shiftMonth(cur, -2)])].filter((m) => m < prev);
    const cached = past.length ? await cmd("MGET", ...past.map((m) => "progm:" + m)) : [];
    const agg = {};
    past.forEach((m, i) => cached[i] && (agg[m] = JSON.parse(cached[i])));
    const need = [...new Set([...past.filter((m) => !agg[m]), prev, cur, next])];
    const docs = Object.fromEntries(await Promise.all(need.map(async (m) => [m, await monthData(m)])));
    for (const m of [...past, prev, cur]) {
      if (agg[m]) continue;
      agg[m] = progressOf(docs[m], start(m), until(m));
      if (m < prev) await setJSON("progm:" + m, agg[m], "EX", 6 * 3600);
    }
    // El mes pasado hasta el mismo día y hora que hoy, para comparar justo.
    const [y, mo] = prev.split("-").map(Number);
    const sameDay = Math.min(Number(now.date.slice(8, 10)), new Date(Date.UTC(y, mo, 0)).getUTCDate());
    const prevToDate = progressOf(docs[prev], start(prev), `${prev}-${String(sameDay).padStart(2, "0")} ${now.time}`);
    // Lo que ya está reservado: el resto del mes y los próximos 14 días.
    const both = { list: [...docs[cur].list, ...docs[next].list], pays: [] };
    const restOfMonth = progressOf(both, now.stamp, start(next));
    const ahead = progressOf(both, now.stamp, T.addDays(now.date, 15) + " 00:00");
    // Mapa de horas: los dos meses anteriores y lo que va de este.
    const heat = {};
    for (const m of [shiftMonth(cur, -2), prev, cur])
      for (const [pid, x] of Object.entries(agg[m].people)) {
        const h = (heat[pid] ||= {});
        for (const [k, [b, c]] of Object.entries(x.heat)) (h[k] ||= [0, 0]), (h[k][0] += b), (h[k][1] += c);
      }

    // Al dueño se le suman las comisiones de cada uno (`comm`), con el % de ese mes.
    if (me.owner) {
      const boss = TEAM.find((p) => p.owner);
      const hist = await commissionHistory(TEAM.filter((p) => !p.owner));
      const addComm = (a, m) => {
        if (!boss) return;
        let comm = 0;
        for (const [pid, x] of Object.entries(a.people)) if (pid !== boss.id && hist[pid]) comm += ((x.billed + (x.inclBase || 0)) * rateAt(pid, hist[pid], m + "-01")) / 100;
        const o = (a.people[boss.id] ||= { billed: 0, services: 0, clients: 0, booked: 0, cap: 0, heat: {} });
        o.comm = cents(comm);
      };
      for (const m of months) agg[m] = { people: Object.fromEntries(Object.entries(agg[m].people).map(([k, v]) => [k, { ...v }])) };
      months.forEach((m) => addComm(agg[m], m));
      addComm(prevToDate, prev);
      addComm(restOfMonth, cur);
      addComm(ahead, cur);
    }
    const ok = (pid) => me.owner || pid === me.id;
    const pick = (a) => Object.fromEntries(Object.entries(a.people).filter(([pid]) => ok(pid)).map(([pid, { heat, ...x }]) => [pid, x]));
    const seen = new Set(months.flatMap((m) => Object.keys(agg[m].people)));
    return {
      owner: !!me.owner,
      today: now.date,
      people: TEAM.filter((p) => ok(p.id) && (p.active !== false || seen.has(p.id))).map((p) => ({ id: p.id, name: p.name, owner: !!p.owner })),
      months: months.map((m) => ({ month: m, partial: m === cur, people: pick(agg[m]) })),
      prevToDate: pick(prevToDate),
      restOfMonth: pick(restOfMonth),
      ahead: pick(ahead),
      heat: Object.fromEntries(Object.entries(heat).filter(([pid]) => ok(pid))),
    };
  },

  // ── Cuánto gana Nova (solo el dueño) ────────────────────────────────────
  // Ingresos del mes (la misma lógica de «cobrada» que la caja y el progreso),
  // comparativa con el mes anterior, gastos editables y beneficio neto.
  "GET staff/earnings": async ({ req, q }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Esto lo ve solo el dueño.");
    const now = T.nowLocal();
    const cur = now.date.slice(0, 7);
    const month = q.get("month") || cur;
    if (!E.MONTH_RE.test(month) || month < "2020-01" || month > E.shiftMonth(cur, 12)) fail(400, "Mes incorrecto.");
    const prev = E.shiftMonth(month, -1);
    const [a, b, dormant, ex, exPrev] = await Promise.all([monthEarnings(month, now, true), monthEarnings(prev, now, false), dormantClients(), expensesFor(month), expensesFor(prev)]);
    const [workers, workersPrev] = await Promise.all([earningsWorkers(month, a.people), earningsWorkers(prev, b.people)]);
    const netA = E.netOf(a.forNet, ex.exp, workers.list, workers.pct);
    const netB = E.netOf(b.forNet, exPrev.exp, workersPrev.list, workersPrev.pct);
    return {
      month,
      prevMonth: prev,
      current: { ...a.view, dormant },
      previous: { income: b.view.income.total, services: b.view.services, ticket: b.view.ticket, occupancy: b.view.occupancy, net: netB.net, margin: netB.margin },
      compare: { income: E.diff(a.view.income.total, b.view.income.total), net: E.diff(netA.net, netB.net) },
      expenses: ex.exp,
      inherited: ex.inherited,
      inheritedFrom: ex.from,
      fixedLabels: E.FIXED,
      workers: workers.list.map((w) => ({ ...w, defaultPct: workers.pct(w.id), billed: a.forNet.byBarber[w.id] || 0, inclBase: a.forNet.inclBase[w.id] || 0 })),
      net: netA,
      // Cortes incluidos en la membresía: ingreso 0 € (va en la cuota), pero el barbero cobra comisión por su precio normal.
      included: { cuts: a.inclCuts, base: cents(Object.values(a.forNet.inclBase).reduce((x, y) => x + y, 0)), commission: netA.includedCommission },
    };
  },

  // Guarda los gastos de un mes (los meses siguientes sin gastos propios los heredan).
  "POST staff/expenses": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Esto lo ve solo el dueño.");
    const month = String(body.month || "");
    const cur = T.nowLocal().date.slice(0, 7);
    if (!E.MONTH_RE.test(month) || month < "2020-01" || month > E.shiftMonth(cur, 12)) fail(400, "Mes incorrecto.");
    const { list, pct } = await earningsWorkers(month);
    let exp;
    try {
      exp = E.cleanExpenses(body, list, pct);
    } catch (e) {
      if (e instanceof RangeError) fail(400, e.message);
      throw e;
    }
    await setJSON("gastos:" + month, { ...exp, saved: T.nowLocal().stamp, by: me.id });
    return { ok: true, expenses: exp };
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
    const open = books.filter((b) => b.date === date && b.kind === "booking" && b.status === "confirmed" && b.attendance !== "absent" && !b.pay).sort((a, b) => a.start.localeCompare(b.start));
    // Socios NOVA+: la cita incluida va a 0 €; a los demás socios se les ofrece su descuento.
    const subs = new Map();
    for (const e of new Set(open.filter((b) => b.email && !b.membership?.included).map((b) => b.email))) subs.set(e, await memberOf(e));
    const pending = open.map((b) => ({
      id: b.id,
      provider: b.provider.id,
      name: b.name,
      start: b.start,
      end: b.end,
      service: b.service.id,
      ...(b.membership?.included ? { incl: true } : {}),
      ...(M.isLive(subs.get(b.email), date) && subs.get(b.email).plan?.discountPct ? { disc: subs.get(b.email).plan.discountPct } : {}),
    }));
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
    const x = { id: "C" + crypto.randomBytes(4).toString("hex").toUpperCase(), ...readPay(body, !!(await includedOf(body.booking))), date: now.date, time: now.stamp.slice(11, 16), created: now.stamp, by: me.id };
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
    const { included: _i, ...before } = prev;
    const x = { ...before, ...readPay(body, !!(await includedOf(body.booking))), edited: T.nowLocal().stamp, editedBy: me.id };
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
    return {
      slots: slotsFor(site.theme),
      theme: site.theme,
      photos: site.photos,
      rating: { ...site.rating, shown: ratingOut(site.rating), want: ratingWant({ google: site.google }) },
      google: { ready: googleOn(), test: GFAKE, ...(site.google || {}) },
      contact: contactOut(site.contact),
      notice: site.notice || { on: false, text: "", until: "", tone: "info" },
    };
  },
  "POST staff/site": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "La web la lleva el dueño.");
    const site = (await getJSON("site")) || {};
    // Contacto: dirección, mapa, WhatsApp e Instagram.
    if (body.contact) {
      const c = body.contact,
        out = {};
      const url = (v, re, msg) => {
        const x = clean(v, 300);
        if (x && !re.test(x)) fail(400, msg);
        return x;
      };
      out.street = clean(c.street, 80);
      out.city = clean(c.city, 80);
      out.maps = url(c.maps, /^https:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)\//i, "El enlace del mapa tiene que ser de Google Maps (https://maps.app.goo.gl/… o https://www.google.com/maps/…).");
      const wa = String(c.whatsapp || "").replace(/\D/g, "");
      if (wa && (wa.length < 9 || wa.length > 15)) fail(400, "Revisa el WhatsApp: el número con el prefijo, por ejemplo 34658356428.");
      out.whatsapp = wa.length === 9 ? "34" + wa : wa;
      let ig = clean(c.instagram, 120).replace(/^@/, "");
      if (ig && !/^https?:\/\//i.test(ig)) ig = "https://www.instagram.com/" + ig.replace(/[^a-zA-Z0-9._]/g, "") + "/";
      out.instagram = url(ig, /^https:\/\/(www\.)?instagram\.com\//i, "El Instagram tiene que ser tu usuario o un enlace de instagram.com.");
      await setJSON("site", { ...site, contact: out });
      return { ok: true, contact: contactOut(out) };
    }
    // Aviso temporal (el banner de arriba): encendido o apagado, con fecha de fin opcional.
    if (body.notice) {
      const n = body.notice;
      const text = clean(n.text, 160);
      if (n.on === true && !text) fail(400, "Escribe el aviso.");
      if (n.until && !T.isDate(n.until)) fail(400, "Revisa la fecha de fin.");
      const notice = { on: n.on === true, text, until: n.until || "", tone: n.tone === "alerta" ? "alerta" : "info" };
      await setJSON("site", { ...site, notice });
      return { ok: true, notice };
    }
    // Tema (plata o rosa): se guarda junto al resto de ajustes de la web.
    if (body.theme !== undefined) {
      if (!THEMES.includes(body.theme)) fail(400, "Ese tema no existe.");
      await setJSON("site", { ...site, theme: body.theme });
      return { ok: true, theme: body.theme, slots: slotsFor(body.theme) };
    }
    // Ficha de Google: buscarla por nombre, elegirla (o pegar su ID) o quitarla.
    if (body.google) {
      const g = body.google;
      if (g.search !== undefined) {
        if (!googleOn()) fail(400, "Falta la clave de Google (GOOGLE_PLACES_KEY) en Vercel.");
        const q = clean(g.search, 120);
        if (G_ID.test(q) && /^(ChIJ|GhIJ|Ei)/.test(q)) return { places: [{ id: q, name: "Ficha con ese ID", address: "", score: null, count: 0 }] };
        if (q.length < 3) fail(400, "Escribe el nombre de la barbería y el pueblo.");
        try {
          return { places: await searchGoogle(q) };
        } catch (e) {
          fail(502, e.message);
        }
      }
      if (g.placeId === "") {
        const { google: _old, ...rest } = site;
        let r = (site.rating || {}).mode === "manual" ? { ...site.rating, source: "booksy", url: undefined, reviews: [] } : await refreshRating(site.rating || {}, rest);
        // Si Booksy no contesta, mejor los valores de config.js que una nota de Google con el nombre de Booksy.
        if (r.source === "google") r = { mode: "auto", at: r.at, want: "booksy", ok: false, err: r.err };
        await setJSON("site", { ...rest, rating: r });
        return { ok: true, rating: { ...r, shown: ratingOut(r) } };
      }
      const id = String(g.placeId || "").trim();
      if (!G_ID.test(id)) fail(400, "Ese ID de ficha no vale.");
      if (!googleOn()) fail(400, "Falta la clave de Google (GOOGLE_PLACES_KEY) en Vercel.");
      let got;
      try {
        got = await readGoogle(id);
      } catch (e) {
        fail(502, e.message);
      }
      const google = { placeId: id, name: clean(g.name, 100), address: clean(g.address, 160) };
      const r = got.empty
        ? { ...(site.rating || {}), mode: "auto", at: Date.now(), want: "google", ok: false, write: got.write, err: "Tu ficha de Google aún no tiene reseñas. Mientras, la web sigue enseñando las de Booksy." }
        : { ...got, mode: "auto", at: Date.now(), want: "google", ok: true, err: "" };
      await setJSON("site", { ...site, google, rating: r });
      // El correo «Dejar mi reseña» lleva a Google: si no había enlace, si era el
      // de Booksy o si era el de otra ficha de Google puesto solo desde aquí.
      const norms = { ...((await getJSON("norms")) || {}) };
      const cur = norms.reviewUrl ?? NORMS.reviewUrl;
      let reviewUrl = "";
      if (!cur || /booksy\./i.test(cur) || cur === site.rating?.write || cur.startsWith("https://search.google.com/local/writereview")) {
        norms.reviewUrl = reviewUrl = got.write;
        await setJSON("norms", norms);
      }
      return { ok: true, google, rating: { ...r, shown: ratingOut(r) }, reviewUrl };
    }
    // Reseñas: automáticas (de Google o Booksy) o fijadas a mano.
    if (body.rating) {
      let r = site.rating || {};
      if (body.rating.mode === "manual") {
        const sc = Number(String(body.rating.score ?? "").replace(",", ".")),
          ct = Math.round(Number(body.rating.count));
        if (!(sc >= 1 && sc <= 5)) fail(400, "La nota va de 1 a 5.");
        if (!(ct >= 0 && ct < 100000)) fail(400, "Revisa el número de reseñas.");
        // A mano se apunta a la fuente que toca ahora; si es Google, se guardan sus reseñas leídas.
        const gid = ratingWant(site) === "google" && site.google.placeId;
        const keep = gid && r.source === "google";
        r = { mode: "manual", source: gid ? "google" : "booksy", url: gid ? (keep && r.url) || gMapsLink(gid) : undefined, reviews: keep ? r.reviews || [] : [], score: Math.round(sc * 10) / 10, count: ct, at: Date.now(), ok: true };
      } else {
        r = await refreshRating(r, site);
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
      // La app la deja en webp de 200 KB como mucho antes de subirla (≈ 275 000 letras en base64).
      if (!SITE_PHOTO.test(photo) || photo.length > 300000) fail(400, "Esa foto no vale o es demasiado grande. Prueba con otra.");
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

  // Desde el correo: enlace firmado, vale sin haber entrado en la app.
  "GET resena/:email/:t": async ({ params }) => {
    const email = normEmail(decodeURIComponent(params.email));
    if (EMAIL.test(email) && same(String(params.t), await reviewToken(email))) await markReviewed(email);
    return await goReview();
  },
  // Desde el Club, con la sesión abierta.
  "GET resena": async ({ req }) => {
    const u = await currentUser(req);
    if (u) await markReviewed(u.email);
    return await goReview();
  },

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
    return { list, stats: { total: list.length, lost: count("perdido"), due: count("le-toca"), booked: count("con-cita") }, mail: mailReady(), sim: simMail() };
  },
  // Avisos automáticos (solo el dueño): dormidos, peticiones de reseña y registro de envíos.
  "GET staff/avisos": async ({ req }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Los avisos los lleva el dueño.");
    const today = T.nowLocal().date;
    const [clients, log, link] = await Promise.all([allClients(), getJSON("avisos:log"), reviewLink()]);
    const entries = Array.isArray(log) ? log : [];
    const reviews = [];
    const seen = new Set();
    for (const e of entries) {
      if (e.type !== "resena" || e.test || seen.has(e.bookingId)) continue;
      seen.add(e.bookingId);
      reviews.push(e);
      if (reviews.length >= 20) break;
    }
    const done = reviews.length ? await cmd("MGET", ...reviews.map((e) => "reviewed:" + e.email)) : [];
    return {
      config: { dormantWeeks: NORMS.dormantWeeks, auto: !!NORMS.winbackAuto, reviews: !!NORMS.reviews, reviewGapDays: NORMS.reviewGapDays, reviewUrl: NORMS.reviewUrl || "", reviewSource: link.source },
      dormant: R.dormantList(clients, NORMS.dormantWeeks, today),
      reviews: reviews.map((e, i) => ({ ...e, reviewed: !!done[i] })),
      log: entries.slice(0, 100),
      mail: mailReady(),
      sim: simMail(),
      testEmail: await ownerMail(),
      testLimit: TEST_MAX,
    };
  },
  // «Enviarme una prueba»: los mismos correos con datos de ejemplo, solo al correo escrito.
  // No toca a ningún cliente ni la deduplicación (winback:, revreq:, revmail:); queda en el historial como prueba.
  "POST staff/avisos/prueba": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Los avisos los lleva el dueño.");
    const email = normEmail(body.email);
    if (!EMAIL.test(email) || email.length > 120) fail(400, "Escribe un correo válido para la prueba.");
    const kind = String(body.kind || "ambos");
    if (!["dormido", "resena", "ambos"].includes(kind)) fail(400, "Elige qué quieres probar.");
    const host = hostOf(req);
    const link = (await reviewLink()).url;
    if (kind !== "dormido" && !link) fail(400, "Falta el enlace de reseñas: ponlo en «Avisos y reseñas» o define GOOGLE_REVIEW_URL.");
    await limit("avisotest:" + me.id, TEST_MAX, 3600, `Has mandado ${TEST_MAX} pruebas en la última hora. Espera un rato.`);
    // Servicio y barbero reales del catálogo (los primeros activos).
    const svc = SVCS.find((x) => x.active !== false) || SVCS[0];
    const pro = TEAM.find((x) => x.active !== false && !x.owner) || TEAM.find((x) => x.active !== false) || TEAM[0];
    const name = "Carlos (ejemplo)";
    const now = T.nowLocal();
    const foot = `<p style="margin:12px 0 0;color:#64645e;font-size:12px">¿No quieres más correos así? <u>Darte de baja</u> <i>(en los envíos reales, aquí va el enlace de baja)</i></p>`;
    const sim = simMail();
    const out = [];
    for (const k of kind === "ambos" ? ["dormido", "resena"] : [kind]) {
      const m =
        k === "dormido"
          ? winbackContent({ email, name, habit: { service: svc.id, provider: pro.id } }, host, foot, true)
          : reviewContent({ name, service: { name: svc.name }, provider: { name: pro.name } }, link, foot, true);
      let status = "simulado",
        error = "";
      if (!sim) {
        const r = await sendDetailed(email, m.subject, m.title, m.html, k === "resena" ? await ownerMail() : undefined);
        status = r.ok ? "enviado" : "fallido";
        error = r.error || "";
      }
      await logNotice({ type: k, email, name, status, by: me.id, test: true });
      out.push({ kind: k, status, error, subject: m.subject, title: m.title, html: shell(m.title, m.html), link: k === "dormido" ? R.bookLink(host, { service: svc.id, provider: pro.id }) : link });
    }
    return {
      ok: out.every((x) => x.status !== "fallido"),
      sim,
      mail: mailReady(),
      example: { name, lastVisit: T.addDays(now.date, -49), weeks: 7, service: svc.name, provider: pro.name },
      sent: out,
    };
  },
  // Reenviar la petición de reseña de una cita (aunque ya se pidiera).
  "POST staff/avisos/resena": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Los avisos los lleva el dueño.");
    const b = (await bookingsByIds([String(body.bookingId || "")]))[0];
    if (!b || b.kind !== "booking" || b.status !== "confirmed" || b.attendance !== "done" || !b.email) fail(404, "Esa cita no se puede reseñar.");
    if (await cmd("GET", "nomkt:" + b.email)) fail(400, "Este cliente pidió no recibir estos correos.");
    const st = await reviewRequest(b, hostOf(req), { by: me.id, force: true });
    if (st === "sin-enlace") fail(400, "Falta el enlace de reseñas: ponlo en «Equipo y normas» o define GOOGLE_REVIEW_URL.");
    if (st === "fallido") fail(502, "No se ha podido enviar.");
    return { ok: true, status: st };
  },
  // Un cliente pide que borremos sus datos (derecho de supresión). Solo el dueño.
  // Se busca por correo, código del Club o teléfono (los apuntados por el equipo
  // sin cuenta). Con `dry` solo enseña lo que se va a borrar; para borrar hay que
  // escribir BORRAR. Borra lo mismo que el borrado por inactividad: la cuenta y el
  // Club; las citas se quedan sin nombre, correo ni teléfono; los cobros, no se tocan.
  "POST staff/clients/erase": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Solo el dueño puede borrar los datos de un cliente.");
    const q = clean(body.q, 120),
      digits = q.replace(/\D/g, ""),
      now = T.nowLocal();
    if (!q) fail(400, "Escribe su correo, su código del Club o su teléfono.");
    let u = await findMember(q);
    if (!u && digits.length >= 7) {
      // Por teléfono: primero, ¿hay un socio con ese teléfono?
      const emails = await allEmails();
      const raws = emails.length ? (await pipe(Array.from({ length: Math.ceil(emails.length / 300) }, (_, i) => ["MGET", ...emails.slice(i * 300, i * 300 + 300).map((e) => "user:" + e)]))).flat() : [];
      u = raws.map((x) => x && JSON.parse(x)).find((x) => x?.phone && x.phone.replace(/\D/g, "").endsWith(digits.slice(-9)));
    }
    const a = u && (await accountFor(u.email, now));
    const loose = digits.length >= 7 ? await bookingsByPhone(digits, now) : [];
    if (!a && !loose.length) fail(404, "No encontramos a nadie con ese dato. Prueba con su correo, su código del Club o su teléfono.");
    const active = (a?.active || false) || loose.some((b) => isActive(b, now)),
      owes = a?.owes || false;
    const summary = {
      name: a?.u.name || loose[0]?.name || "",
      email: a?.u.email || "",
      phone: a?.u.phone || loose[0]?.phone || "",
      account: !!a,
      bookings: (a?.bookings.length || 0) + loose.length,
      points: a ? (await clubOf(a.u)).balance : 0,
      active,
      owes,
    };
    if (body.dry === true) return { preview: summary };
    if (String(body.confirm || "").trim().toUpperCase() !== "BORRAR") fail(400, "Escribe BORRAR para confirmar.");
    if (active) fail(400, "Tiene citas pendientes. Cancélalas antes de borrar sus datos.");
    if (owes) fail(400, "Tiene un cobro por falta sin cerrar. Decide antes en «Faltas» si se cobra o no.");
    if (a) await eraseAccount(a, now);
    const ops = loose.filter((b) => !b.charge).map((b) => ["SET", "bk:" + b.id, JSON.stringify(anonymous(b, now))]);
    ops.push(["DEL", "contacts:list"], ["INCRBY", "erasedreq:" + now.date.slice(0, 7), 1]);
    await pipe(ops);
    // Se le confirma por correo (si lo hay y el correo de la app está activo).
    if (summary.email && mailReady())
      await send(
        summary.email,
        `Hemos borrado tus datos de ${BUSINESS.short}`,
        "Tus datos están borrados",
        `<p style="margin:0 0 12px">Como nos pediste, hemos borrado tu cuenta, tus puntos del Club y tus datos de contacto.</p>
         <p style="margin:0;color:#64645e;font-size:13px">Solo guardamos, bloqueados, los cobros que la ley nos obliga a conservar 6 años. Si algún día vuelves, puedes reservar como nuevo cliente.</p>`,
      );
    return { ok: true, name: summary.name };
  },

  "POST staff/clients/contact": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Los clientes los lleva el dueño.");
    const email = normEmail(body.email);
    const c = (await allClients()).find((x) => x.email === email);
    if (!c) fail(404, "No encontramos a ese cliente.");
    if (body.channel === "email") {
      if (c.optout) fail(400, "Este cliente pidió no recibir estos correos.");
      const status = await winbackMail(c, hostOf(req), me.id);
      if (status === "fallido") fail(502, "No se ha podido enviar.");
      return { ok: true, status };
    }
    await setJSON("winback:" + email, { at: T.nowLocal().stamp, by: me.id, channel: "whatsapp" });
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
    await cmd("DEL", "lb:cfg", "lb:rb"); // el ranking se rehace con los datos recuperados
    return { ok: true, written: b.data.length };
  },

  // ── Servicios (solo el dueño) ───────────────────────────────────────────
  "GET staff/services": async ({ req }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Los servicios los lleva el dueño.");
    return { services: SVCS, team: TEAM.map((p) => ({ id: p.id, name: p.name })) };
  },
  "POST staff/services": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Los servicios los lleva el dueño.");
    const prev = body.id ? SVCS.find((x) => x.id === body.id) : null;
    if (body.id && !prev) fail(404, "Ese servicio ya no existe.");
    if (body.delete === true) {
      if (activeSvcs().filter((x) => !x.consult && x.id !== prev.id).length === 0) fail(400, "Tiene que quedar al menos un servicio para reservar.");
      await setJSON("services", SVCS.filter((x) => x.id !== prev.id));
      return { ok: true };
    }
    const name = clean(body.name, 50);
    if (!name) fail(400, "Ponle un nombre.");
    const desc = clean(body.desc, 200);
    if (desc.length > 80) fail(400, "La descripción, como mucho 80 letras.");
    const consult = body.consult === true;
    const duration = Math.round(Number(body.duration));
    if (!consult && !(duration >= 15 && duration <= 240 && duration % 15 === 0)) fail(400, "La duración va de 15 en 15 minutos (de 15 a 240).");
    const price = body.price === "" || body.price == null ? null : Math.round(Number(String(body.price).replace(",", ".")) * 100) / 100;
    if (price !== null && !(price >= 0 && price < 10000)) fail(400, "Revisa el precio.");
    if (!consult && price === null) fail(400, "Pon el precio.");
    const icons = ["scissors", "beard", "star", "moon", "crown", "drop", "gem", "bolt"];
    const providers = [].concat(body.providers || []).filter((id) => TEAM.some((p) => p.id === id));
    let id = prev?.id;
    if (!id) {
      const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 24) || "servicio";
      id = base;
      for (let i = 2; SVCS.some((x) => x.id === id); i++) id = base + "-" + i;
    }
    const color = AGENDA_COLORS.includes(body.color) ? body.color : prev?.color || "";
    const item = {
      ...(prev || {}),
      id,
      name,
      color,
      desc,
      price,
      duration: consult ? prev?.duration || null : duration,
      consult,
      icon: icons.includes(body.icon) ? body.icon : prev?.icon || "scissors",
      active: body.active !== false,
      ...(providers.length ? { providers } : {}),
    };
    if (!providers.length) delete item.providers;
    if (!item.active && !consult && activeSvcs().filter((x) => !x.consult && x.id !== id).length === 0) fail(400, "Tiene que quedar al menos un servicio activo para reservar.");
    // Si un servicio se pone «solo con alguien», los demás dejan de ofrecerlo.
    const list = prev ? SVCS.map((x) => (x.id === id ? item : x)) : [...SVCS, item];
    if (body.move === "up" || body.move === "down") {
      const i = list.findIndex((x) => x.id === id),
        j = body.move === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    }
    await setJSON("services", list);
    return { ok: true, service: item };
  },

  // ── Vacaciones y días libres ───────────────────────────────────────────
  // El dueño para cualquiera; cada barbero, para él mismo.
  "POST staff/off": async ({ req, body }) => {
    const me = await needStaff(req);
    const p = provider(body.provider || me.id);
    if (!p) fail(400, "Elige barbero.");
    if (!canManage(me, p.id)) fail(403, "Solo puedes poner tus propias vacaciones.");
    const from = String(body.from || ""),
      to = String(body.to || body.from || "");
    if (body.delete === true) {
      const off = (p.off || []).filter((r) => !(r.from === from && r.to === to));
      TEAM = TEAM.map((x) => (x.id === p.id ? { ...x, off } : x));
      await setJSON("team", TEAM);
      return { ok: true, off };
    }
    if (!T.isDate(from) || !T.isDate(to) || to < from) fail(400, "Revisa las fechas: la de vuelta tiene que ser igual o después de la de salida.");
    if (T.addDays(from, 120) < to) fail(400, "Como mucho 120 días seguidos.");
    const today = T.nowLocal().date;
    if (to < today) fail(400, "Esas fechas ya han pasado.");
    const off = [...(p.off || []).filter((r) => r.to >= today), { from, to, note: clean(body.note, 60) }].sort((a, b) => a.from.localeCompare(b.from));
    TEAM = TEAM.map((x) => (x.id === p.id ? { ...x, off } : x));
    await setJSON("team", TEAM);
    // Citas que ya tenía esos días: se avisan para moverlas a mano.
    const days = [];
    for (let d = from; d <= to; d = T.addDays(d, 1)) days.push(d);
    const sets = await pipe(days.map((d) => ["SMEMBERS", "day:" + d]));
    const clash = (await bookingsByIds([...new Set(sets.flat())])).filter((b) => b.provider.id === p.id && b.kind === "booking" && b.status === "confirmed");
    return { ok: true, off, clash: clash.map((b) => ({ id: b.id, date: b.date, start: b.start, name: b.name })) };
  },

  // ── Normas de cancelación (solo el dueño) ───────────────────────────────
  "GET staff/rules": async ({ req }) => {
    await needStaff(req);
    const [last, daily] = await cmd("MGET", "cronlast", "crondaily");
    return { ...NORMS, mail: mailReady(), sim: simMail(), reviewSource: (await reviewLink()).source, cron: !ON_VERCEL || !!process.env.CRON_SECRET, lastCron: last ? JSON.parse(last) : null, lastDaily: daily ? JSON.parse(daily) : null };
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
    try {
      if (has("dormantWeeks")) norms.dormantWeeks = R.weeksOf(body.dormantWeeks);
      else if (has("lapseDays")) norms.dormantWeeks = R.weeksFromDays(body.lapseDays);
      if (has("reviewGapDays")) norms.reviewGapDays = R.gapOf(body.reviewGapDays);
    } catch (e) {
      fail(400, e.message);
    }
    delete norms.lapseDays;
    for (const k of ["reminders", "recurring", "winbackAuto", "remindSoon", "reviews", "dailyClose", "waitlist"]) if (has(k)) norms[k] = body[k] === true;
    if (has("reviewUrl")) {
      const u = clean(body.reviewUrl, 400);
      if (u && !/^https:\/\/[^\s"<>]+$/.test(u)) fail(400, "El enlace de reseñas tiene que empezar por https://");
      norms.reviewUrl = u;
    }
    if (norms.reviews && !(await reviewLink({ ...NORMS, ...norms })).url) fail(400, "Para pedir reseñas pega antes el enlace donde se dejan (o pon GOOGLE_REVIEW_URL en Vercel).");
    if (has("winbackText")) norms.winbackText = clean(body.winbackText, 600) || NORMS.winbackText;
    if (has("winbackOffer")) norms.winbackOffer = clean(body.winbackOffer, 200);
    if (has("openFrom")) {
      const d = String(body.openFrom || "");
      if (d && !T.isDate(d)) fail(400, "Revisa la fecha desde la que se reserva en la app.");
      norms.openFrom = d;
    }
    await setJSON("norms", norms);
    return { ok: true, ...NORMS, ...norms };
  },

  // ── Equipo (solo el dueño) ──────────────────────────────────────────────
  "GET staff/team": async ({ req }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "El equipo lo lleva el dueño.");
    return {
      team: TEAM.map(({ pinHash, ...p }) => ({ ...p, hasPin: !!pinHash || !!pinOf(p), pinFrom: pinHash ? "panel" : pinOf(p) ? "vercel" : "" })),
      services: activeSvcs().filter((s) => !s.consult).map((s) => ({ id: s.id, name: s.name, only: s.providers || [] })),
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
    const bookable = SVCS.filter((s) => !s.consult).map((s) => s.id);
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
    const color = AGENDA_COLORS.includes(body.color) ? body.color : prev?.color || "";
    const item = {
      ...(prev || {}),
      id,
      name,
      color,
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

  // Datos de prueba (solo el dueño): clientes, citas, cobros y ranking
  // ficticios para enseñar la app. Se borran de una vez con «clear».
  "GET staff/demo": async ({ req }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Solo para el dueño.");
    return await demoStatus();
  },
  "POST staff/demo": async ({ req, body }) => {
    const me = await needStaff(req);
    if (!me.owner) fail(403, "Solo para el dueño.");
    if (body.action === "load") return await demoLoad();
    if (body.action === "clear") return await demoClear();
    fail(400, "¿Cargar o borrar?");
  },
};

// ── Caja ───────────────────────────────────────────────────────────────────
const cents = (n) => Math.round(n * 100) / 100;
// Lo que vale una cita para la caja y las ganancias: una incluida en la membresía no suma
// (su dinero ya entró con la cuota mensual, que sale como línea propia).
const svcPrice = (b) => (b.membership?.included ? 0 : Number(b.service.price) || 0);
// Base de la comisión del barbero: el precio NORMAL del servicio, aunque el socio pague 0 € (corte incluido en la membresía).
const commBase = (b) => (b.membership?.included ? Number(b.service.price) || 0 : svcPrice(b));
// Lo mismo para un cobro de caja de una cita incluida: lo que valían sus servicios (guardado en `normal`; si falta, el precio del catálogo).
const payNormal = (x) => cents(x.normal ?? x.items.reduce((a, it) => a + (Number(service(it.id)?.price ?? EXTRAS.find((e) => e.id === it.id)?.price) || 0), 0));

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
// ── Progreso: ganancias y ocupación ────────────────────────────────────────
function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// Todo lo de un mes: citas, horas bloqueadas y cobros de caja.
async function monthData(month) {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates = Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const sets = await pipe(dates.map((d) => ["SMEMBERS", "day:" + d]));
  const [list, pays] = await Promise.all([bookingsByIds([...new Set(sets.flat())]), monthPays(month)]);
  return { list: list.filter((b) => b.date.startsWith(month) && b.status === "confirmed"), pays };
}

// Ganancias y ocupación de cada barbero entre dos momentos («2026-11-01 00:00»).
// Ocupación = tramos de 15 min de su horario (sin contar lo bloqueado) que
// tenían una cita, o un cobro sin cita (se pone justo antes de la hora del
// cobro, con lo que dura el servicio). Las citas «No vino» no cuentan.
// Ganancias = lo cobrado en caja, o el precio del servicio si no se apuntó cobro.
function progressOf({ list, pays }, from, to) {
  const inside = (stamp) => stamp >= from && stamp < to;
  const cobradas = new Set(pays.map((x) => x.booking).filter(Boolean));
  const people = {};
  const P = (id) => (people[id] ||= { billed: 0, inclCuts: 0, inclBase: 0, services: 0, clients: 0, booked: 0, cap: 0, heat: {}, _who: new Set(), _days: {} });
  const day = (id, date) => (P(id)._days[date] ||= { busy: new Set(), off: new Set() });
  const mark = (set, a, b) => {
    for (let t = Math.floor(a / LOCK_MIN) * LOCK_MIN; t < b; t += LOCK_MIN) set.add(t);
  };
  const who = (x) => (x.email || x.name || "").toLowerCase();

  for (const b of list) {
    const [a, e] = [T.toMin(b.start), T.toMin(b.end)];
    if (b.kind === "block") mark(day(b.provider.id, b.date).off, a, e);
    if (b.kind !== "booking" || b.attendance === "absent") continue;
    mark(day(b.provider.id, b.date).busy, a, e);
    if (!inside(b.date + " " + b.start) || cobradas.has(b.id)) continue;
    const p = P(b.provider.id);
    p.billed += svcPrice(b);
    if (b.membership?.included) {
      p.inclCuts++;
      p.inclBase += commBase(b);
    }
    p.services++;
    p._who.add(who(b));
  }
  for (const x of pays) {
    if (!x.booking) {
      const s = x.items.map((it) => service(it.id)).find(Boolean);
      const end = T.toMin(x.time);
      mark(day(x.provider.id, x.date).busy, end - (s?.duration || 30), end);
    }
    if (!inside(x.date + " " + x.time)) continue;
    const p = P(x.provider.id);
    p.billed += x.amount;
    if (x.included) {
      p.inclCuts++;
      p.inclBase += payNormal(x);
    }
    p.services++;
    p._who.add(who(x));
  }

  // El horario de cada uno, día a día. Quien ya no está en activo solo cuenta
  // si tuvo algo en ese intervalo.
  const [d0, d1] = [from.slice(0, 10), to.slice(0, 10)];
  for (const pr of TEAM) {
    if (pr.active === false && !people[pr.id]) continue;
    const p = P(pr.id);
    for (let date = d0; date <= d1; date = T.addDays(date, 1)) {
      const wd = T.weekday(date);
      const d = p._days[date];
      for (const [a, b] of pr.hours?.[wd] || []) {
        for (let t = T.toMin(a); t + LOCK_MIN <= T.toMin(b); t += LOCK_MIN) {
          if (!inside(date + " " + T.toHHMM(t)) || d?.off.has(t)) continue;
          const busy = d?.busy.has(t) ? LOCK_MIN : 0;
          const h = (p.heat[wd + "-" + Math.floor(t / 60)] ||= [0, 0]);
          p.cap += LOCK_MIN;
          p.booked += busy;
          h[0] += busy;
          h[1] += LOCK_MIN;
        }
      }
    }
  }
  for (const [id, p] of Object.entries(people)) {
    p.billed = cents(p.billed);
    p.inclBase = cents(p.inclBase);
    p.clients = p._who.size;
    delete p._who;
    delete p._days;
    if (!p.services && !p.cap) delete people[id];
  }
  return { people };
}

const payLabel = (x) => x.items.map((it) => it.name).join(" + ") || "Cobro";

// Lo que llega del formulario de cobrar: barbero, servicio, extras, importe y forma de pago.
// Una cita incluida en la membresía: se «cobra» a 0 € con la forma de pago «membresía».
async function includedOf(bookingId) {
  const b = bookingId ? await getJSON("bk:" + clean(bookingId, 20)) : null;
  return b?.kind === "booking" && b.status === "confirmed" && b.membership?.included ? b : null;
}
function readPay(body, included = false) {
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
  const normal = cents(items.reduce((a, it) => a + it.price, 0));
  if (included) items.forEach((it) => (it.price = 0));
  const amount = included ? 0 : Math.round(Number(String(body.amount ?? "").replace(",", ".")) * 100) / 100;
  if (!included && !(amount > 0 && amount <= 1000)) fail(400, "Pon el importe cobrado, en euros.");
  if (!included && !PAY_METHODS.some((m) => m.id === body.method)) fail(400, "Elige cómo ha pagado.");
  return { provider: { id: p.id, name: p.name }, items, amount, method: included ? "membresia" : body.method, ...(included ? { included: true, normal } : {}), name: clean(body.name, 60) || "Cliente sin cita", booking: clean(body.booking, 20) };
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
  await rankTouch(b.email); // los puntos llegan al cobrar: el ranking se mueve en el momento
}
async function unlinkPay(x) {
  if (!x.booking) return;
  const b = await getJSON("bk:" + x.booking);
  if (b?.pay?.id !== x.id) return;
  const { pay, ...rest } = b;
  await setJSON("bk:" + b.id, rest);
  await rankTouch(b.email);
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
  const row = (b) => ({ id: b.id, date: b.date, start: b.start, name: b.name, service: b.service.name, price: svcPrice(b), base: commBase(b), ...(b.membership?.included ? { included: true } : {}), marked: b.attendance === "done", unpaid: true });
  const payRow = (x) => ({ id: x.id, date: x.date, start: x.time, name: x.name, service: payLabel(x), price: x.amount, base: x.included ? payNormal(x) : x.amount, ...(x.included ? { included: true } : {}), method: x.method, pay: true });
  const byService = {};
  const add = (name, n, total) => {
    const x = (byService[name] ||= { name, count: 0, total: 0 });
    x.count += n;
    x.total = cents(x.total + total);
  };
  for (const b of done) add(b.service.name, 1, svcPrice(b));
  for (const x of pays) {
    for (const it of x.items) add(it.name, 1, it.price);
    const rest = cents(x.amount - x.items.reduce((a, it) => a + it.price, 0));
    if (rest) add(rest > 0 ? "Suplementos y propinas" : "Descuentos", 1, rest);
  }
  const methods = Object.fromEntries(PAY_METHODS.map((m) => [m.id, 0]));
  for (const x of pays) methods[x.method] = cents((methods[x.method] || 0) + x.amount);
  const billed = cents(done.reduce((a, b) => a + svcPrice(b), 0) + pays.reduce((a, x) => a + x.amount, 0));
  const services = done.length + pays.length;
  return {
    services,
    billed,
    average: services ? cents(billed / services) : 0,
    collected: cents(pays.reduce((a, x) => a + x.amount, 0)),
    methods,
    unpaid: done.length,
    upcoming: upcoming.length,
    expected: cents(upcoming.reduce((a, b) => a + svcPrice(b), 0)),
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


// ── Cuánto gana Nova: datos del mes ────────────────────────────────────────
// Otras fuentes de ingresos, cada una con { id, label, get(month) → { amount, count } }.
// Para añadir una línea nueva (productos del mostrador, cursos…) basta con
// sumarla a esta lista: sale en el panel como «otros ingresos» y cuenta en el
// beneficio. Los cobros de caja NO van aquí: ya están en lo facturado por cada
// barbero (una cita cobrada cuenta por lo cobrado, igual que en Caja).
const INCOME_SOURCES = [
  {
    id: "membresias",
    label: "Socio NOVA+ (cuotas)",
    async get(month) {
      const r = await M.revenueOf(month);
      return { amount: r.amount, count: r.count, ...(r.demo ? { demo: r.demo } : {}) };
    },
  },
  {
    id: "ropa",
    label: "Ropa (NOVA Supply)",
    async get(month) {
      const r = await Sup.leer({ ventas: 5000 });
      // Sin los pedidos de la app: esos van en su propia línea (abajo), así nada se cuenta dos veces.
      const v = r.ventas.filter((x) => String(x.fecha || "").startsWith(month) && !x.pedido);
      return { amount: cents(v.reduce((a, x) => a + (Number(x.importe) || 0), 0)), count: v.reduce((a, x) => a + (Number(x.cantidad) || 1), 0) };
    },
  },
  {
    // Pedidos de NOVA Supply hechos en la app y ya cobrados (en el local, online o simulados).
    // Cada uno ya está apuntado UNA vez en las ventas de ropa con su `pedido`; aquí se separan
    // de las ventas de caja para verlos aparte. Un pedido cancelado deshace su venta y deja de contar.
    id: "merch",
    label: "Merch NOVA Supply",
    async get(month) {
      const r = await Sup.leer({ ventas: 5000 });
      const v = r.ventas.filter((x) => String(x.fecha || "").startsWith(month) && x.pedido);
      return { amount: cents(v.reduce((a, x) => a + (Number(x.importe) || 0), 0)), count: v.reduce((a, x) => a + (Number(x.cantidad) || 1), 0) };
    },
  },
];

const pct1 = (n) => Math.round(n * 1000) / 10;

async function monthEarnings(month, now, withClients) {
  const data = await monthData(month);
  const start = month + "-01 00:00";
  const end = [E.shiftMonth(month, 1) + "-01 00:00", now.stamp].sort()[0];
  const { people } = progressOf(data, start, end);
  const rows = Object.entries(people).map(([id, x]) => ({ id, name: TEAM.find((p) => p.id === id)?.name || id, billed: cents(x.billed), services: x.services, booked: x.booked, cap: x.cap, occupancy: x.cap ? pct1(x.booked / x.cap) : null }));
  const billed = cents(rows.reduce((a, x) => a + x.billed, 0));
  const services = rows.reduce((a, x) => a + x.services, 0);
  const booked = rows.reduce((a, x) => a + x.booked, 0),
    cap = rows.reduce((a, x) => a + x.cap, 0);
  const other = [];
  for (const src of INCOME_SOURCES) {
    const r = await src.get(month);
    if (r.amount || r.count) other.push({ id: src.id, label: src.label, amount: r.amount, count: r.count, ...(r.demo ? { demo: r.demo } : {}) });
  }
  const otherTotal = cents(other.reduce((a, x) => a + x.amount, 0));
  const income = { services: billed, other, otherTotal, total: cents(billed + otherTotal) };
  const view = { income, services, ticket: services ? cents(billed / services) : 0, occupancy: cap ? pct1(booked / cap) : null, bookedMin: booked, capMin: cap, byBarber: rows.sort((x, y) => y.billed - x.billed) };
  if (withClients) view.clients = await newVsReturning(data, start, end);
  const inclBase = Object.fromEntries(Object.entries(people).filter(([, x]) => x.inclBase).map(([id, x]) => [id, x.inclBase]));
  return { view, people, forNet: { total: income.total, byBarber: Object.fromEntries(rows.map((x) => [x.id, x.billed])), inclBase }, inclCuts: Object.values(people).reduce((a, x) => a + x.inclCuts, 0) };
}

// Clientes del mes: nuevos (sin ningún servicio hecho antes del mes) y recurrentes.
async function newVsReturning(data, start, end) {
  const byBooking = new Map(data.list.map((b) => [b.id, b]));
  const emails = new Set();
  let unknown = 0;
  const seen = (x) => {
    const e = normEmail(x.email);
    if (e) emails.add(e);
    else unknown++;
  };
  const cobradas = new Set(data.pays.map((x) => x.booking).filter(Boolean));
  for (const b of data.list) if (b.kind === "booking" && b.attendance !== "absent" && !cobradas.has(b.id) && b.date + " " + b.start >= start && b.date + " " + b.start < end) seen(b);
  for (const x of data.pays) if (x.date + " " + x.time >= start && x.date + " " + x.time < end) seen(x.email ? x : byBooking.get(x.booking) || {});
  const list = [...emails];
  if (!list.length) return { new: 0, returning: 0, unknown };
  const sets = await pipe(list.map((e) => ["SMEMBERS", "ubk:" + e]));
  const prior = await bookingsByIds([...new Set(sets.flat())]);
  const before = new Set(prior.filter((b) => b.kind === "booking" && b.status === "confirmed" && b.attendance !== "absent" && b.date + " " + b.start < start).map((b) => normEmail(b.email)));
  const returning = list.filter((e) => before.has(e)).length;
  return { new: list.length - returning, returning, unknown };
}

// Clientes dormidos (los mismos que en «Clientes»): misma función que usa el cron.
async function dormantClients() {
  const list = R.dormantList(await allClients(), NORMS.dormantWeeks, T.nowLocal().date).reverse();
  return { count: list.length, weeks: NORMS.dormantWeeks, list: list.slice(0, 20).map((c) => ({ name: c.name, since: c.since, last: c.last })) };
}

// Gastos de un mes. Si el mes no tiene, hereda los del último mes anterior que sí (hasta dos años atrás).
async function expensesFor(month) {
  const months = Array.from({ length: 24 }, (_, i) => E.shiftMonth(month, -i));
  const raw = await cmd("MGET", ...months.map((m) => "gastos:" + m));
  const i = raw.findIndex(Boolean);
  if (i < 0) return { exp: E.emptyExpenses(), inherited: false, from: "" };
  const { saved, by, ...doc } = JSON.parse(raw[i]);
  const base = E.emptyExpenses();
  return { exp: { ...base, ...doc, fixed: { ...base.fixed, ...doc.fixed } }, inherited: i > 0, from: months[i] };
}

// Los barberos del mes (sin el dueño): en activo o con ingresos ese mes, y su % de comisión del equipo.
async function earningsWorkers(month, people = {}) {
  const workers = TEAM.filter((p) => !p.owner && (p.active !== false || people[p.id]));
  const hist = await commissionHistory(workers);
  const ref = [lastOfMonth(month), T.nowLocal().date].sort()[0];
  return { list: workers.map((p) => ({ id: p.id, name: p.name })), pct: (id) => rateAt(id, hist[id] || [], ref) };
}

// ── Caja de un periodo ─────────────────────────────────────────────────────
const lastOfMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
// Citas y cobros de caja entre dos días (los dos incluidos).
async function rangeData(from, to) {
  const dates = [];
  for (let d = from; d <= to; d = T.addDays(d, 1)) dates.push(d);
  const sets = [];
  for (let i = 0; i < dates.length; i += 250)
    sets.push(...(await pipe(dates.slice(i, i + 250).flatMap((d) => [["SMEMBERS", "day:" + d], ["SMEMBERS", "payday:" + d]]))));
  const bids = new Set(),
    pids = new Set();
  sets.forEach((ids, i) => ids.forEach((id) => (i % 2 ? pids : bids).add(id)));
  const pays = [];
  const pl = [...pids];
  for (let i = 0; i < pl.length; i += 300) pays.push(...(await bookingsByIds2("pay:", pl.slice(i, i + 300))));
  const list = (await bookingsByIds([...bids])).filter((b) => b.kind === "booking" && b.date >= from && b.date <= to);
  return [list, pays.filter((x) => x.date >= from && x.date <= to)];
}

// ── Datos de prueba ────────────────────────────────────────────────────────
// Clientes ficticios (correos @demo.invalid, a los que nunca se escribe), con
// casi un año de citas y cobros con cada barbero, citas para los próximos días
// y puntos del Club, para ver la agenda, la caja, el progreso y el ranking con
// vida. Todo lo que se crea se apunta en `demo:*` y se borra de una vez.
const DEMO_DOMAIN = "@demo.invalid";
const DEMO_NAMES = [
  "Jonay Suárez", "Yeray Vega", "Kevin Santana", "Adrián Melián", "Iván Rodríguez", "Carlos Pérez", "Aythami Díaz", "Tana Hernández",
  "Dani Cabrera", "Mr Fade", "ElTigre", "Saúl Trujillo", "Raúl Ojeda", "Nauzet Quintana", "Pablo Medina", "Moisés León",
  "Gara Sosa", "Cristian Afonso", "Jorge Falcón", "Rayco Mendoza", "Néstor Batista", "Alberto Cruz", "KingDavid", "Chachi",
  "Óscar Monzón", "Héctor Bordón", "Samuel Ramírez", "Abián Guedes", "Fran Rivero", "Manu del Pino", "Toni Navarro", "Luis Ventura",
  "Yone Pérez", "Elías Castellano", "Rubén Marrero", "Joel Santana",
];
const isDemoEmail = (e) => String(e || "").endsWith(DEMO_DOMAIN);

async function demoStatus() {
  const [users, bks, pays, at] = await pipe([["SCARD", "demo:users"], ["SCARD", "demo:bk"], ["SCARD", "demo:pay"], ["GET", "demo:at"]]);
  return { loaded: users > 0 || bks > 0, users, bookings: bks, pays, at: at || "" };
}

async function demoLoad() {
  if ((await cmd("SET", "lock:demo", "1", "NX", "EX", 300)) !== "OK") fail(409, "Ya se están cargando.");
  try {
    if ((await demoStatus()).loaded) fail(409, "Los datos de prueba ya están cargados. Bórralos antes para volver a cargarlos.");
    const now = T.nowLocal();
    let seed = 20261115;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pickW = (list, w) => {
      let r = rnd() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < list.length; i++) if ((r -= w[i]) < 0) return list[i];
      return list.at(-1);
    };
    const team = TEAM.filter((p) => p.active !== false && Object.values(p.hours || {}).some((x) => x?.length));
    const svcs = activeSvcs().filter((x) => !x.consult && x.duration > 0);
    if (!team.length || !svcs.length) fail(400, "Faltan barberos con horario o servicios.");
    const svcW = svcs.map((_, i) => Math.max(1, 6 - i * 1.5));
    const DAYS = 330;

    // Los clientes: cada uno con su barbero, desde cuándo viene y si ha dejado de venir.
    const people = DEMO_NAMES.map((name, i) => {
      const join = -DAYS + Math.floor(rnd() * (DAYS - 30));
      return {
        email: `cliente${i + 1}${DEMO_DOMAIN}`,
        name,
        barber: team[i % team.length].id,
        join,
        leave: i % 9 === 4 ? Math.min(-75, join + 60 + Math.floor(rnd() * 120)) : 99,
        every: 14 + Math.floor(rnd() * 30), // cada cuántos días suele venir
        due: join,
      };
    });
    // El resto de citas son de clientes sin cuenta (apuntados por el equipo).
    const WALK = ["Javi", "Sergio", "Marcos", "Alejandro", "Diego", "Hugo", "Mario", "Álvaro", "Lucas", "Bruno", "Nico", "Eric", "Aarón", "Gabriel", "Izan", "Leo", "Thiago", "Unai", "Marco", "Iker"];
    const SUR = ["G.", "M.", "S.", "R.", "H.", "D.", "P.", "C.", "V.", "Q."];
    const ops = [],
      future = [];
    const flush = async (force) => {
      while (ops.length >= (force ? 1 : 400)) await pipe(ops.splice(0, 400));
    };
    let nb = 0,
      np = 0;
    for (let d = -DAYS; d <= 7; d++) {
      const date = T.addDays(now.date, d);
      const wd = T.weekday(date);
      const grow = (d + DAYS) / DAYS;
      for (const p of team) {
        if ((p.off || []).some((o) => o.from <= date && date <= o.to)) continue;
        for (const [a, b] of p.hours?.[wd] || []) {
          const end = T.toMin(b);
          let t = T.toMin(a);
          while (t + 30 <= end) {
            let fill = (0.18 + 0.4 * Math.min(1, grow)) * (wd === 6 ? 1.3 : wd === 2 ? 0.75 : 1);
            if (d > 0) fill *= 0.6;
            const s = pickW(svcs, svcW);
            if (rnd() > fill || t + s.duration > end) {
              t += 30;
              continue;
            }
            const start = T.toHHMM(t);
            // Le toca a un socio que ya debía venir (mejor con su barbero); si no, uno sin cuenta.
            const due = people.filter((c) => c.join <= d && d <= c.leave && c.due <= d && !c.busy?.[date]);
            const c = due.find((x) => x.barber === p.id) || (rnd() < 0.3 ? due[0] : null);
            const who = c || { email: "", name: WALK[Math.floor(rnd() * WALK.length)] + " " + SUR[Math.floor(rnd() * SUR.length)] };
            if (c) {
              c.used = true;
              c.due = d + c.every - 3 + Math.floor(rnd() * 7);
              (c.busy ||= {})[date] = 1;
            }
            const past = date + " " + start < now.stamp;
            const bk = {
              ...makeBooking(s, p, date, start, { email: who.email, name: who.name, phone: "", by: c ? "client" : "staff", demo: true }),
              id: "D" + crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 7),
              created: T.addDays(date, -1 - Math.floor(rnd() * 10)) + " 1" + Math.floor(rnd() * 10) + ":00",
            };
            const r = rnd();
            if (past && r < 0.03) {
              bk.status = "canceled";
              bk.canceled = bk.created;
            } else if (past && r < 0.08) bk.attendance = "absent";
            else if (past) {
              bk.attendance = "done";
              const tip = rnd() < 0.12 ? 2 : 0;
              const x = {
                id: "CD" + crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 7),
                provider: { id: p.id, name: p.name },
                items: [{ id: s.id, name: s.name, price: Number(s.price) || 0 }],
                amount: cents((Number(s.price) || 0) + tip),
                method: pickW(PAY_METHODS.map((m) => m.id), [4, 5, 2]),
                name: who.name,
                booking: bk.id,
                date,
                time: bk.end,
                created: date + " " + bk.end,
                by: p.id,
                demo: true,
              };
              bk.pay = { id: x.id, amount: x.amount, method: x.method };
              ops.push(["SET", "pay:" + x.id, JSON.stringify(x)], ["SADD", "payday:" + date, x.id], ["SADD", "paymonth:" + monthOf(date), x.id], ["SADD", "demo:pay", x.id + "|" + date]);
              np++;
            }
            ops.push(["SADD", "demo:bk", bk.id + "|" + date + "|" + p.id]);
            if (past || bk.status !== "confirmed") {
              ops.push(...indexWrites(bk));
              if (bk.status !== "confirmed") ops.push(["HDEL", `occ:${p.id}:${monthOf(date)}`, bk.id]);
            } else future.push(bk);
            nb++;
            t += Math.ceil(s.duration / 30) * 30;
            await flush();
          }
        }
      }
    }
    await flush(true);
    // Las citas que vienen apartan su hora como cualquier otra (si alguien
    // real ya la tiene, esa se salta).
    let skipped = 0;
    for (const bk of future) {
      try {
        await place(bk);
      } catch {
        skipped++;
        ops.push(["SREM", "demo:bk", bk.id + "|" + bk.date + "|" + bk.provider.id]);
      }
    }
    // Las cuentas: todas «han entrado en la app» para salir en el ranking;
    // algunas invitadas por otras y unas cuantas amistades.
    const used = people.filter((c) => c.used);
    used.forEach((c, i) => {
      const ref = "DEMO" + String(i + 1).padStart(3, "0");
      const inviter = i % 5 === 3 ? used[i - 1] : null;
      const u = { email: c.email, name: c.name, phone: "", no: 0, created: T.addDays(now.date, c.join - 3) + " 10:00", ref, verified: T.addDays(now.date, c.join) + " 10:00", demo: true, ...(inviter ? { referredBy: inviter.email } : {}) };
      ops.push(["SET", "user:" + c.email, JSON.stringify(u)], ["SET", "refcode:" + ref, c.email], ["SADD", "users", c.email], ["SADD", "demo:users", c.email], ["SET", "seen:" + c.email, T.addDays(now.date, Math.min(0, c.leave))]);
      if (inviter) ops.push(["SADD", "refs:" + inviter.email, c.email]);
      if (i % 4 === 1 && used[i + 1]) ops.push(["SADD", "fr:" + c.email, used[i + 1].email], ["SADD", "fr:" + used[i + 1].email, c.email]);
    });
    ops.push(["SET", "demo:at", now.stamp], ["DEL", "contacts:list"], ...Array.from({ length: 13 }, (_, i) => ["DEL", "progm:" + shiftMonth(now.date.slice(0, 7), -i)]));
    await flush(true);
    const tm = await teamEmails();
    for (const c of used) await syncRank(c.email, tm).catch((e) => console.error("demo ranking", e));
    await cmd("INCR", "lb:ver");
    return { ok: true, users: used.length, bookings: nb - skipped, pays: np };
  } finally {
    await cmd("DEL", "lock:demo");
  }
}

async function demoClear() {
  if ((await cmd("SET", "lock:demo", "1", "NX", "EX", 300)) !== "OK") fail(409, "Ya se está haciendo.");
  try {
    const [listed, bks, pys] = await pipe([["SMEMBERS", "demo:users"], ["SMEMBERS", "demo:bk"], ["SMEMBERS", "demo:pay"]]);
    // También los correos de prueba que no llegaron a apuntarse (si la carga se cortó).
    const emails = [...new Set([...listed, ...DEMO_NAMES.map((_, i) => `cliente${i + 1}${DEMO_DOMAIN}`)])];
    // Además de lo apuntado, todo lo que se haya hecho después con esas cuentas
    // (citas nuevas, cobros apuntados en caja).
    const own = emails.length ? await pipe(emails.map((e) => ["SMEMBERS", "ubk:" + e])) : [];
    const ids = new Set([...bks.map((x) => x.split("|")[0]), ...own.flat()]);
    const books = await bookingsByIds([...ids]);
    const payIds = new Set([...pys.map((x) => x.split("|")[0]), ...books.map((b) => b.pay?.id).filter(Boolean)]);
    const pays = [];
    const pl = [...payIds];
    for (let i = 0; i < pl.length; i += 300) pays.push(...(await bookingsByIds2("pay:", pl.slice(i, i + 300))));
    const ops = [];
    for (const b of books) {
      if (!isDemoEmail(b.email) && !b.demo) continue;
      ops.push(["DEL", "bk:" + b.id], ["SREM", "day:" + b.date, b.id], ["HDEL", `occ:${b.provider.id}:${monthOf(b.date)}`, b.id]);
      if (b.status === "confirmed" && b.date >= T.nowLocal().date) for (const k of lockKeys(b)) ops.push(["DEL", k]);
    }
    for (const x of pays) ops.push(["DEL", "pay:" + x.id], ["SREM", "payday:" + x.date, x.id], ["SREM", "paymonth:" + monthOf(x.date), x.id]);
    // Quien de verdad añadió de amigo a una cuenta de prueba, la pierde.
    const frs = emails.length ? await pipe(emails.map((e) => ["SMEMBERS", "fr:" + e])) : [];
    emails.forEach((e, i) => frs[i].forEach((f) => ops.push(["SREM", "fr:" + f, e], ["SREM", "frx:" + f, e])));
    for (const e of emails) {
      for (const k of ["user:", "ubk:", "ush:", "urd:", "refs:", "seen:", "purgewarn:", "winback:", "nomkt:", "reviewed:", "revmail:", "backmail:", "fr:", "frx:"]) ops.push(["DEL", k + e]);
      ops.push(["SREM", "users", e], ["HDEL", "lb:u", e], ["ZREM", "lb:all", e]);
    }
    for (let i = 1; i <= DEMO_NAMES.length; i++) ops.push(["DEL", "refcode:DEMO" + String(i).padStart(3, "0")]);
    const now = T.nowLocal();
    ops.push(["DEL", "demo:users"], ["DEL", "demo:bk"], ["DEL", "demo:pay"], ["DEL", "demo:at"], ["DEL", "contacts:list"], ["INCR", "lb:ver"]);
    ops.push(...Array.from({ length: 13 }, (_, i) => ["DEL", "progm:" + shiftMonth(now.date.slice(0, 7), -i)]));
    while (ops.length) await pipe(ops.splice(0, 400));
    return { ok: true, users: listed.length, bookings: books.length, pays: pays.length };
  } finally {
    await cmd("DEL", "lock:demo");
  }
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
  const url = new URL(req.url, "http://local");
  const path = url.searchParams.get("route") ?? url.pathname.replace(/^\/api\/?/, "");
  url.searchParams.delete("route");
  // El servidor MCP habla JSON-RPC, con sus propios códigos y cabeceras.
  if (path === "mcp") return mcpHttp(req, res);
  // El webhook de Stripe necesita el cuerpo tal cual llegó (para la firma): lo lee él mismo.
  if (path === "stripe/webhook") return M.webhookHttp(req, res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const hit = match(req.method, path);
    if (!hit) fail(404, "No existe.");
    if (req.method === "POST" && !String(req.headers["content-type"] || "").includes("application/json"))
      fail(415, "Petición incorrecta.");
    // Sin correo en producción no se toca la base ni se abre sesión.
    if (path === "auth/request" && req.method === "POST" && accessPolicy().code && process.env.VERCEL && !mailReady())
      fail(503, MAIL_NOT_READY);
    const body = req.method === "POST" ? await readBody(req) : {};
    await loadTeam();
    const out = await hit.fn({ req, res, body, q: url.searchParams, params: hit.params });
    res.statusCode = 200;
    if (out?.redirect) {
      res.statusCode = 302;
      res.setHeader("Location", out.redirect);
      return res.end();
    }
    if (out?.raw !== undefined) {
      res.setHeader("Content-Type", out.type);
      res.setHeader("Cache-Control", out.cache || "no-store");
      if (out.filename) res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
      return res.end(out.raw);
    }
    res.end(JSON.stringify(out ?? {}));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && status !== 503) console.error(e);
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
