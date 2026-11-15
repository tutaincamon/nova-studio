// Una sola función para toda la API: vercel.json manda aquí /api/<lo que sea>.
import crypto from "node:crypto";
import { cmd, pipe, getJSON, setJSON, hgetall, usingMemory, scanKeys, dumpKeys, claim, hit } from "./_lib/store.js";
import { SERVICES, PROVIDERS, RULES, BUSINESS, POINTS, MEDALS, REWARDS, COMMISSION, TRAINING, EXTRAS, PAY_METHODS, SHOP, publicCatalog } from "./_lib/config.js";
import * as T from "./_lib/time.js";
import { codeMail, send, bookingLines, mailReady } from "./_lib/mail.js";
import * as Card from "./_lib/stripe.js";
import * as Sup from "./_lib/supply.js";

const ON_VERCEL = !!process.env.VERCEL;
// Para entrar (y para darse de alta) siempre hace falta el código de 6 cifras
// que se manda al correo: así cada cuenta es de verdad de quien la usa. En
// Vercel eso necesita RESEND_API_KEY (+ MAIL_FROM con un dominio verificado);
// en el ordenador el código sale por la consola.
// Por qué medios se puede recibir el código. El teléfono está preparado en la
// API (auth/request acepta `phone`) pero apagado hasta elegir cómo mandar SMS
// o WhatsApp: el día que se encienda, la cuenta de teléfono se guardaría con la
// clave `tel:+34…` en lugar del correo, y habría que revisar lo que manda
// correos a `u.email` (recordatorios, avisos) y lo que lo enseña en el panel.
// Interruptor del código: mientras LOGIN_CON_CODIGO no sea "1" (decisión del
// dueño, 2026-11-13: el correo aún no está montado), se entra y se da de alta
// solo con el correo, sin código. El día que haya RESEND_API_KEY + MAIL_FROM
// con dominio verificado, se pone LOGIN_CON_CODIGO=1 en Vercel y vuelve el
// código sin tocar nada más. OJO: sin código, quien sepa un correo puede entrar
// en esa cuenta.
const LOGIN_CON_CODIGO = process.env.LOGIN_CON_CODIGO === "1";
const authChannels = () => ({ email: !LOGIN_CON_CODIGO || mailReady() || !ON_VERCEL, phone: false, code: LOGIN_CON_CODIGO });
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
  const price = b.pay?.amount ?? b.service.price ?? SVCS.find((s) => s.id === b.service.id)?.price ?? 15;
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
const RANK_V = 3; // subir si cambia cómo se calcula: el ranking se rehace solo
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
  };
  const s = JSON.stringify(e);
  if (s === old) return u;
  const ops = [
    ["HSET", "lb:u", email, s],
    ["INCR", "lb:ver"],
  ];
  ops.push(e.h ? ["ZREM", "lb:all", email] : ["ZADD", "lb:all", e.a, email]);
  await pipe(ops);
  return u;
}
async function rankDrop(email) {
  await pipe([["HDEL", "lb:u", email], ["ZREM", "lb:all", email], ["INCR", "lb:ver"]]);
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
  lapseDays: 45, // a partir de cuántos días sin venir alguien «se ha perdido»
  winbackAuto: false, // mandarles un correo solo (una vez cada 60 días como mucho)
  winbackText: "Hace tiempo que no te vemos por el estudio. Tu hueco te está esperando: reserva en un minuto desde la app.",
  winbackOffer: "",
  remindSoon: true, // otro correo unas 2 horas antes de la cita
  reviews: false, // pedir reseña por correo después de un corte (hace falta reviewUrl)
  reviewUrl: "",
  dailyClose: true, // cada mañana, el resumen de caja de ayer al dueño
  waitlist: true, // «avísame si se libera» en los días completos
  openFrom: "", // paso desde Booksy: los clientes reservan en la app solo desde este día (vacío = sin límite)
};
const WEEK = [0, 1, 2, 3, 4, 5, 6];
const NORMS0 = NORMS;
async function loadTeam() {
  // Equipo y normas en un solo viaje a la base de datos.
  const [rawTeam, rawNorms, rawSvcs] = await cmd("MGET", "team", "norms", "services");
  // Servicios: los edita el dueño (pestaña «Servicios»); la primera vez, los de config.js.
  let sv = rawSvcs ? JSON.parse(rawSvcs) : null;
  if (!Array.isArray(sv) || !sv.length) {
    sv = SERVICES.map((x) => ({ ...x, active: true }));
    await setJSON("services", sv);
  }
  SVCS = sv;
  let t = rawTeam ? JSON.parse(rawTeam) : null;
  if (!Array.isArray(t) || !t.length) {
    t = PROVIDERS.map((p) => ({ ...p, active: true, commission: p.owner ? 0 : (COMMISSION[p.id] ?? 40) }));
    await setJSON("team", t);
  }
  TEAM = t;
  NORMS = { ...NORMS0, ...(rawNorms ? JSON.parse(rawNorms) : {}) };
}
const activeTeam = () => TEAM.filter((p) => p.active !== false);
let SVCS = SERVICES;
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
  if (!s || s.consult || s.active === false) fail(400, "Ese servicio no se reserva por aquí.");
  const anyone = body.provider === "any",
    fixed = anyone ? null : provider(body.provider);
  if (!anyone && (!fixed || fixed.active === false || !canDo(s, fixed))) fail(400, "Ese barbero no hace este servicio.");
  if (!T.isDate(body.date) || !T.isTime(body.start)) fail(400, "Elige día y hora.");
  // Para reservar hay que haber entrado con el código: la cita queda a nombre de
  // una cuenta comprobada, y se usan su nombre y su teléfono (si lo tiene).
  const user = await currentUser(req);
  if (!user) fail(401, "Entra con tu correo para reservar. Te mandamos un código.");
  const email = user.email,
    name = clean(user.name),
    phone = clean(user.phone, 30);
  if (!name) fail(400, "Falta tu nombre.");
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
    return { out: { id: b.id, series, provider: { id: b.provider.id, name: b.provider.name } } };
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
// tiene cita. «Perdido» = sin cita y más días sin venir que lapseDays (o que
// el doble de lo que suele tardar, si es más).
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
  const out = { at: now.stamp, soon: 0, reviews: 0, rebook: 0, reminders: 0, winback: 0, close: false, backup: false, mail: mailReady() };
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
    // Sin correo no se manda nada, pero lo que no envía nada se hace igual:
    // borrar las cuentas que pasaron 3 años sin uso (lo promete la política).
    if (!mailReady()) {
      if (now.min >= 9 * 60 && (await once("cronday:" + now.date, 2 * 86400))) {
        out.purge = await purgeInactive(now, host);
        out.records = await purgeRecords(now);
        await setJSON("crondaily", { at: now.stamp, reminders: 0, winback: 0, close: false, backup: false, purge: out.purge, records: out.records });
      }
      return out;
    }
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
          if (!host) continue;
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
        if (!NORMS.reviewUrl || !host) continue;
        if (!(await once("revask:" + b.id, 7 * 86400)) || !(await once("revmail:" + b.email, 180 * 86400))) continue;
        const link = `https://${host}/api/resena/${encodeURIComponent(b.email)}/${await reviewToken(b.email)}`;
        const ok = await send(
          b.email,
          `¿Qué tal tu ${b.service.name.toLowerCase()}?`,
          `Gracias por venir${first ? ", " + first : ""}`,
          `<p style="margin:0 0 12px">Esperamos que ${htmlEsc(barber)} te haya dejado como querías.</p>
           <p style="margin:0 0 14px">Si te ha gustado, nos ayudas muchísimo contándolo. Es un minuto:</p>
           <p style="margin:0 0 12px"><a href="${htmlEsc(link)}" style="display:inline-block;background:#171717;color:#fff;padding:12px 18px;text-decoration:none">Dejar mi reseña</a></p>
           <p style="margin:0;color:#64645e;font-size:13px">Y si algo no fue bien, responde a este correo: lo lee el equipo.</p>` + (await unsubFoot(b.email, host)),
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
      // e) Cuentas sin uso: aviso un mes antes y borrado a los 3 años (política de privacidad).
      out.purge = await purgeInactive(now, host);
      out.records = await purgeRecords(now);
      await setJSON("crondaily", { at: now.stamp, reminders: out.reminders, winback: out.winback, close: out.close, backup: out.backup, purge: out.purge, records: out.records });
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
  await rankDrop(email);
  if (u.card?.pm) await Card.removeCard(u.card.pm).catch(() => {});
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
const goReview = () =>
  NORMS.reviewUrl
    ? { redirect: NORMS.reviewUrl }
    : { raw: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:Arial;padding:40px 20px;text-align:center"><h1 style="font-size:22px">¡Gracias!</h1><p>El enlace de reseñas no está disponible ahora mismo. Prueba más tarde.</p></body>`, type: "text/html; charset=utf-8" };
// Pie de baja para los correos comerciales (art. 21 LSSI: en cada uno hay que
// poder darse de baja de forma sencilla y gratuita).
async function unsubFoot(email, host) {
  const t = await unsubToken(email);
  return `<p style="margin:12px 0 0;color:#64645e;font-size:12px">¿No quieres más correos así? ${host ? `<a href="https://${host}/api/unsub/${encodeURIComponent(email)}/${t}">Darte de baja</a>` : "Respóndenos y te quitamos."}</p>`;
}
async function winbackMail(c, host) {
  if (c.optout || !c.email) return false;
  const t = await unsubToken(c.email);
  const base = host ? `https://${host}` : "";
  const off = NORMS.winbackOffer ? `<p style="margin:0 0 12px;padding:12px;border:1px solid #dcdad3;background:#f5f4f0"><b>${htmlEsc(NORMS.winbackOffer)}</b></p>` : "";
  return send(
    c.email,
    `Publi · ${c.name ? c.name.split(" ")[0] + ", t" : "T"}e echamos de menos en ${BUSINESS.short}`,
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
      reviews: !!NORMS.reviewUrl,
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
      renew.push(["EXPIRE", "sess:" + sha(ck[SESSION]), YEAR], ["SET", "seen:" + u.email, T.nowLocal().date]);
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
    return { user: publicUser(u), staff: st, staffHint, mail: mailReady(), auth: authChannels() };
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
    const team = !s ? [] : pid === "any" ? activeTeam().filter((p) => canDo(s, p)) : [provider(pid)].filter((p) => p && p.active !== false && canDo(s, p));
    if (!s || s.consult || s.active === false || !team.length || !/^\d{4}-\d{2}$/.test(month)) fail(400, "Petición incorrecta.");
    const now = T.nowLocal(),
      busies = await Promise.all(team.map((p) => busyOf(p.id, month))),
      [y, m] = month.split("-").map(Number),
      total = new Date(Date.UTC(y, m, 0)).getUTCDate(),
      days = {},
      full = [];
    for (let d = 1; d <= total; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      days[date] = [...new Set(team.flatMap((p, i) => freeTimes(p, s, date, busies[i], now, undefined, staff)))].sort();
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
    if (b.pay) await rankTouch(b.email); // una cita cobrada que se anula deja de sumar
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
    if (!freeTimes(p, s, body.date, busy, T.nowLocal(), undefined, !!staff).includes(body.start))
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

  // El ranking. El móvil lo pide cada pocos segundos con la versión que tiene
  // (`v`): si nada ha cambiado se contesta con una sola lectura y sin datos.
  // scope = global | friends. Siempre por los puntos ganados desde siempre.
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
          return e && { k: e.id, n: e.n, p: e.a, a: e.a, ...(email === u.email ? { me: 1 } : {}) };
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
          return e && { k: e.id, n: e.n, p, a: e.a, ...(email === u.email ? { me: 1 } : {}) };
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
      if (!rows.some((x) => x.me) && mine) rows.push({ k: mine.id, n: mine.n, p, a: mine.a, me: 1, r: me.r, out: 1 });
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
    const email = normEmail(body.email);
    if (!EMAIL.test(email)) fail(400, "Revisa tu correo.");
    await limit("auth:" + email, 5, 900);
    await limit("authip:" + ip(req), 20, 900);
    // Sin código (ver LOGIN_CON_CODIGO): se entra ya, y si falta el nombre la app lo pide.
    // La cuenta no queda marcada como `verified`: nadie ha comprobado que el correo sea suyo.
    if (!LOGIN_CON_CODIGO) {
      const fresh = !(await getJSON("user:" + email));
      const u = await ensureUser(email);
      await startSession(req, res, email);
      await rankTouch(email);
      return { direct: true, fresh, needName: !u.name };
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0"),
      challenge = token();
    await setJSON("code:" + challenge, { email, h: sha(code + challenge), tries: 0 }, "EX", 600);
    if (mailReady()) {
      if (!(await codeMail(email, code))) fail(502, "No hemos podido enviar el correo. Prueba otra vez en un rato.");
      return { challenge };
    }
    if (ON_VERCEL) fail(503, "Ahora mismo no podemos enviar el código por correo. Escríbenos por WhatsApp y te ayudamos.");
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
    const fresh = !(await getJSON("user:" + c.email));
    let u = await ensureUser(c.email);
    if (!u.verified) {
      u = { ...u, verified: T.nowLocal().stamp };
      await setJSON("user:" + u.email, u);
    }
    await startSession(req, res, c.email);
    await rankTouch(c.email);
    // Falta el nombre (cuenta nueva o de antes): la app lo pide en el paso siguiente.
    return { ok: true, fresh, needName: !u.name };
  },

  // Último paso del alta: el nombre (el que sale en el ranking) y, si la cuenta
  // es nueva, el código del amigo que te invitó.
  "POST auth/name": async ({ req, body }) => {
    let u = await currentUser(req);
    if (!u) fail(401, "Entra en tu cuenta.");
    const name = clean(body.name, 60);
    if (name.length < 2) fail(400, "Falta tu nombre.");
    const code = String(body.ref || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    let by = null;
    if (code && !u.referredBy) {
      const referrer = await cmd("GET", "refcode:" + code);
      if (!referrer) fail(400, "Ese código de amigo no existe. Revísalo o bórralo.");
      // Solo cuenta como invitación en una cuenta recién hecha (sin citas aún).
      if (referrer !== u.email && !(await cmd("SMEMBERS", "ubk:" + u.email)).length) by = referrer;
    }
    const first = !u.name;
    u = { ...u, name, ...(by ? { referredBy: by } : {}) };
    // La cuenta se creó sin nombre (código NOVA123): ahora que lo hay, uno con su nombre (CARLOS482).
    const oldRef = first && /^NOVA/.test(u.ref || "") ? u.ref : "";
    if (oldRef) u.ref = await makeRefCode(u.email, name);
    await setJSON("user:" + u.email, u);
    if (oldRef && (await cmd("GET", "refcode:" + oldRef)) === u.email) await cmd("DEL", "refcode:" + oldRef);
    await pipe([...(by ? [["SADD", "refs:" + by, u.email]] : []), ["DEL", "contacts:list"]]);
    await rankTouch(u.email, by);
    return { user: publicUser(u) };
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
    const pendientes = r.pedidos
      .filter((x) => !x.estado || x.estado === "pendiente")
      .map(({ _raw, _i, ...x }) => {
        const p = Sup.prendaDePedido(r.prendas, x);
        return { ...x, prendaId: p?.id || "", prendaNombre: p ? p.nombre + (p.variante ? " · " + p.variante : "") : x.color, precio: p?.precio ?? null };
      });
    const mes = T.nowLocal().date.slice(0, 7);
    const delMes = r.ventas.filter((v) => String(v.fecha || "").startsWith(mes));
    return {
      owner: !!me.owner,
      tienda: SHOP.url,
      prendas: r.prendas,
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
    const item = await Sup.guardarPrenda(
      { id: prev?.id, nombre, variante: clean(body.variante, 30), color: clean(body.color, 20).toLowerCase(), precio, estado: body.estado, tallas, foto: prev?.foto || clean(body.foto, 80), stock },
      r.prendas,
    );
    return { ok: true, prenda: item };
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
    const importe = body.importe === undefined || body.importe === "" ? (p?.precio ?? 0) : Math.round(Number(String(body.importe).replace(",", ".")) * 100) / 100;
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
    if (!me.owner && v.por !== me.id && !(me.caja && String(v.fecha).startsWith(T.nowLocal().date))) fail(403, "Solo la puede deshacer quien la apuntó o el dueño.");
    await Sup.quitarVenta(v.id);
    if (v.prenda) await Sup.subirStock(v.prenda, v.talla, v.cantidad || 1);
    if (v.club) {
      const sp = await getJSON("sh:" + v.club);
      if (sp) {
        await pipe([
          ["DEL", "sh:" + sp.id],
          ["SREM", "ush:" + sp.email, sp.id],
        ]);
        await rankTouch(sp.email);
      }
    }
    return { ok: true };
  },

  "GET staff/member": async ({ req, q }) => {
    await needCaja(req); // también la tablet del mostrador, que es donde se vende la ropa
    const u = await findMember(q.get("q"));
    if (!u) fail(404, "No encontramos a ese socio. Prueba con su correo o su código del Club.");
    const c = await clubOf(u);
    return { member: { email: u.email, name: u.name, no: u.no, earned: c.earned, balance: c.balance } };
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
    return goReview();
  },
  // Desde el Club, con la sesión abierta.
  "GET resena": async ({ req }) => {
    const u = await currentUser(req);
    if (u) await markReviewed(u.email);
    return goReview();
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
    return { list, stats: { total: list.length, lost: count("perdido"), due: count("le-toca"), booked: count("con-cita") }, mail: mailReady() };
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
    return { ...NORMS, mail: mailReady(), cron: !ON_VERCEL || !!process.env.CRON_SECRET, lastCron: last ? JSON.parse(last) : null, lastDaily: daily ? JSON.parse(daily) : null };
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
  const P = (id) => (people[id] ||= { billed: 0, services: 0, clients: 0, booked: 0, cap: 0, heat: {}, _who: new Set(), _days: {} });
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
    p.billed += Number(b.service.price) || 0;
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
    p.clients = p._who.size;
    delete p._who;
    delete p._days;
    if (!p.services && !p.cap) delete people[id];
  }
  return { people };
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
