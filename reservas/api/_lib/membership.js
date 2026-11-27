// ─────────────────────────────────────────────────────────────────────────────
// Socio NOVA+: membresía mensual de pago (Stripe Subscriptions).
//
// NO es el Club de puntos (ese es gratis y sigue igual): es una capa aparte.
// Aquí vive la parte que no depende del resto de la app: planes, estado de la
// suscripción en Redis, cuenta de cortes por periodo, ingresos y webhook.
//
// Claves (con el prefijo de la base):
//   msub:<correo>        la suscripción de ese cliente (una sola)
//   msubs                conjunto de correos con alguna suscripción
//   mcus:<cus_…>         id de cliente de Stripe → correo
//   msubid:<sub_…>       id de suscripción de Stripe → correo
//   memrev:<id>          un ingreso (cuota cobrada): { id, email, amount, month… }
//   memrevm:<AAAA-MM>    conjunto de ids de ingresos de ese mes
//   stripeevt:<evt_…>    eventos del webhook ya procesados (7 días)
//
// Los cortes usados NO se guardan en un contador: se cuentan sobre las citas
// del cliente (`b.membership.included`). Así devolver un corte al cancelar a
// tiempo es solo cancelar la cita, y un «No vino» o una cancelación tardía lo
// gastan, sin que nada se desajuste.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { cmd, pipe, getJSON, setJSON } from "./store.js";
import { BUSINESS } from "./config.js";

export const STATUSES = ["active", "past_due", "canceled", "incomplete"];
const r2 = (n) => Math.round(n * 100) / 100;
export const localDate = (sec) => new Date(sec * 1000).toLocaleDateString("en-CA", { timeZone: BUSINESS.tz });

// ── Planes ──────────────────────────────────────────────────────────────────
export const MAX_PLANS = 6;
const slug = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);

// Valida lo que manda el dueño. `svcIds` = ids de servicios que existen. Lanza RangeError con un texto para el dueño.
export function cleanPlans(list, svcIds, maxDays = 365) {
  if (!Array.isArray(list)) throw new RangeError("Faltan los planes.");
  if (list.length > MAX_PLANS) throw new RangeError(`Como mucho ${MAX_PLANS} planes.`);
  const seen = new Set();
  const out = list.map((p) => {
    const name = String(p?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name) throw new RangeError("Cada plan necesita un nombre.");
    let id = slug(p.id) || slug(name) || "plan";
    for (let i = 2; seen.has(id); i++) id = `${slug(p.id) || slug(name) || "plan"}-${i}`;
    seen.add(id);
    const price = Number(String(p.price ?? "").replace(",", "."));
    if (!Number.isFinite(price) || price < 1 || price > 1000) throw new RangeError(`«${name}»: el precio va de 1 a 1.000 € al mes.`);
    const cuts = Number(p.cuts ?? 0);
    if (!Number.isInteger(cuts) || cuts < 0 || cuts > 31) throw new RangeError(`«${name}»: los cortes al mes van de 0 a 31.`);
    const services = [...new Set([].concat(p.services || []).map(String))].filter((s) => svcIds.includes(s));
    if (cuts > 0 && !services.length) throw new RangeError(`«${name}»: elige qué servicios cubre.`);
    const daysAhead = Number(p.daysAhead ?? 0);
    if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > maxDays) throw new RangeError(`«${name}»: los días vista van de 0 a ${maxDays} (0 = los normales).`);
    const discountPct = Number(String(p.discountPct ?? 0).replace(",", "."));
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 50) throw new RangeError(`«${name}»: el descuento va de 0 a 50 %.`);
    return {
      id,
      name,
      price: r2(price),
      cuts,
      services,
      daysAhead,
      discountPct: Math.round(discountPct * 10) / 10,
      active: p.active !== false,
      desc: String(p.desc ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
    };
  });
  return out;
}

// Lo que ve el cliente de un plan (todo es público: no hay nada que ocultar).
export const planOut = (p) => ({ id: p.id, name: p.name, price: p.price, cuts: p.cuts, services: p.services, daysAhead: p.daysAhead, discountPct: p.discountPct, desc: p.desc || "" });
// Foto del plan que se guarda con cada alta: lo que se contrata es lo que se mantiene.
export const planSnapshot = planOut;

// ── Fechas del periodo ──────────────────────────────────────────────────────
export function addMonths(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

// Periodo (mes de membresía) al que pertenece un día: el actual o los que
// vendrían si se renueva. `k` = cuántos periodos después del actual.
export function windowFor(sub, date) {
  if (!sub?.periodStart || !sub.periodEnd || date < sub.periodStart) return null;
  let start = sub.periodStart,
    end = sub.periodEnd,
    k = 0;
  while (date >= end) {
    start = end;
    end = addMonths(end, 1);
    if (++k > 8) return null;
  }
  return { start, end, k };
}

// ¿Tiene ventajas ahora? Solo con la cuota al día (activa) y, en demo o real,
// dentro de su periodo. Impagada o cancelada: nada.
export const isLive = (sub, today) => !!sub && sub.status === "active" && (!sub.periodEnd || sub.periodEnd > today);

// Cortes del cliente en el periodo de `date`. `list` = todas sus citas.
// Gastan corte: las confirmadas (incluidas las «No vino») y las canceladas
// tarde. Las canceladas a tiempo, o por el salón, lo devuelven.
export const spends = (b) => b.membership?.included && (b.status === "confirmed" || (b.status === "canceled" && b.late));
export function coverage(sub, serviceId, date, list, today, exceptId) {
  if (!isLive(sub, today)) return { included: false, reason: "no-member" };
  const w = windowFor(sub, date);
  if (!w) return { included: false, reason: "out-of-period" };
  if (w.k > 0 && sub.cancelAtPeriodEnd) return { included: false, reason: "ends", window: w };
  const plan = sub.plan || {};
  if (!(plan.cuts > 0) || !(plan.services || []).includes(serviceId)) return { included: false, reason: "not-covered", window: w };
  const used = list.filter((b) => b.id !== exceptId && b.kind === "booking" && spends(b) && b.date >= w.start && b.date < w.end).length;
  return { included: used < plan.cuts, reason: used < plan.cuts ? "" : "no-cuts-left", used, left: Math.max(0, plan.cuts - used), window: w };
}

// Resumen para el cliente y para el panel: cortes usados y restantes del periodo actual.
export function viewOf(sub, list, today) {
  if (!sub) return null;
  const live = isLive(sub, today);
  const w = live ? windowFor(sub, today) : null;
  const cuts = sub.plan?.cuts || 0;
  const used = w ? list.filter((b) => b.kind === "booking" && spends(b) && b.date >= w.start && b.date < w.end).length : 0;
  return {
    status: sub.status,
    live,
    demo: !!sub.demo,
    plan: sub.plan,
    since: sub.since || "",
    periodStart: sub.periodStart || "",
    renews: sub.periodEnd || "",
    cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
    canceledAt: sub.canceledAt || "",
    cuts,
    used: Math.min(used, cuts),
    left: live ? Math.max(0, cuts - used) : 0,
    daysAhead: live ? sub.plan?.daysAhead || 0 : 0,
    discountPct: live ? sub.plan?.discountPct || 0 : 0,
  };
}

// ── Estado en la base ───────────────────────────────────────────────────────
export const getSub = (email) => getJSON("msub:" + email);
export async function saveSub(sub) {
  const ops = [
    ["SET", "msub:" + sub.email, JSON.stringify(sub)],
    ["SADD", "msubs", sub.email],
  ];
  if (sub.stripeCustomer) ops.push(["SET", "mcus:" + sub.stripeCustomer, sub.email]);
  if (sub.stripeSub) ops.push(["SET", "msubid:" + sub.stripeSub, sub.email]);
  await pipe(ops);
  return sub;
}
export async function dropSub(email) {
  const sub = await getSub(email);
  const ops = [["DEL", "msub:" + email], ["SREM", "msubs", email]];
  if (sub?.stripeCustomer) ops.push(["DEL", "mcus:" + sub.stripeCustomer]);
  if (sub?.stripeSub) ops.push(["DEL", "msubid:" + sub.stripeSub]);
  await pipe(ops);
}
export const allSubs = async () => {
  const emails = await cmd("SMEMBERS", "msubs");
  if (!emails.length) return [];
  return (await cmd("MGET", ...emails.map((e) => "msub:" + e))).filter(Boolean).map((x) => JSON.parse(x));
};

// Ingresos: una cuota cobrada. Idempotente por `id` (el de la factura en Stripe).
export async function recordRevenue({ id, email, amount, plan, planName, at, demo, invoice }) {
  const day = at || new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.tz });
  const x = { id, email, amount: r2(amount), plan, planName, date: day, month: day.slice(0, 7), demo: !!demo, invoice: invoice || "" };
  if ((await cmd("SET", "memrev:" + id, JSON.stringify(x), "NX")) !== "OK") return false;
  await cmd("SADD", "memrevm:" + x.month, id);
  return true;
}
// { amount, count, demo } de un mes (para «Cuánto gana Nova»).
export async function revenueOf(month) {
  const ids = await cmd("SMEMBERS", "memrevm:" + month);
  if (!ids.length) return { amount: 0, count: 0, demo: 0, list: [] };
  const list = (await cmd("MGET", ...ids.map((i) => "memrev:" + i))).filter(Boolean).map((x) => JSON.parse(x));
  return { amount: r2(list.reduce((a, x) => a + x.amount, 0)), count: list.length, demo: list.filter((x) => x.demo).length, list };
}

// Demo: sin Stripe no hay quien renueve, así que se simula. Al abrir la
// suscripción (o con el cron) se avanzan los periodos vencidos y se apunta
// la cuota de cada uno; si estaba de baja, se cierra.
export async function advanceDemo(sub, today) {
  if (!sub?.demo || sub.status !== "active" || !sub.periodEnd || sub.periodEnd > today) return sub;
  let s = { ...sub };
  while (s.periodEnd <= today) {
    if (s.cancelAtPeriodEnd) {
      s = { ...s, status: "canceled", canceledAt: s.periodEnd };
      break;
    }
    s = { ...s, periodStart: s.periodEnd, periodEnd: addMonths(s.periodEnd, 1) };
    await recordRevenue({ id: `demo-${s.email}-${s.periodStart}`, email: s.email, amount: s.plan.price, plan: s.plan.id, planName: s.plan.name, at: s.periodStart, demo: true });
  }
  await saveSub(s);
  return s;
}

// ── Webhook de Stripe ───────────────────────────────────────────────────────
// Firma: cabecera `Stripe-Signature: t=<epoch>,v1=<hmac>[,v1=…]`; el HMAC-SHA256
// (en hex) es de `<t>.<cuerpo tal cual llegó>` con el secreto STRIPE_WEBHOOK_SECRET.
export function signPayload(raw, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
}
export function verifySignature(raw, header, secret, tolerance = 300, now = Date.now() / 1000) {
  if (!secret || !header || typeof raw !== "string") return false;
  const parts = String(header).split(",").map((x) => x.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k, v]) => k === "v1" && v).map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(now - t) > tolerance) return false;
  const want = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  });
}

const STRIPE_STATUS = { active: "active", trialing: "active", past_due: "past_due", unpaid: "past_due", canceled: "canceled", incomplete: "incomplete", incomplete_expired: "canceled", paused: "past_due" };
const dateOf = (sec) => (sec ? localDate(sec) : "");

async function emailFor(obj) {
  const subId = obj.subscription || (String(obj.id || "").startsWith("sub_") ? obj.id : "");
  const [a, b] = await Promise.all([subId ? cmd("GET", "msubid:" + subId) : null, obj.customer ? cmd("GET", "mcus:" + obj.customer) : null]);
  return a || b || String(obj.metadata?.email || obj.client_reference_id || "").toLowerCase() || "";
}

// Aplica un evento ya verificado. Devuelve un texto corto de lo que hizo (para el registro y las pruebas).
export async function applyEvent(ev) {
  const o = ev?.data?.object;
  if (!ev?.id || !o) return "ignorado";
  if ((await cmd("SET", "stripeevt:" + ev.id, "1", "NX", "EX", 7 * 86400)) !== "OK") return "repetido";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.tz });
  const email = await emailFor(o);
  if (!email) return "sin-cliente";
  const sub = await getSub(email);
  if (!sub) return "sin-membresia";

  switch (ev.type) {
    case "checkout.session.completed": {
      if (o.mode !== "subscription") return "ignorado";
      const paid = o.payment_status === "paid" || o.payment_status === "no_payment_required";
      const next = { ...sub, stripeCustomer: o.customer || sub.stripeCustomer, stripeSub: o.subscription || sub.stripeSub, demo: false };
      if (paid && sub.status !== "active") Object.assign(next, { status: "active", since: sub.since || today, periodStart: today, periodEnd: addMonths(today, 1) });
      await saveSub(next);
      return paid ? "alta" : "pendiente";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const item = o.items?.data?.[0] || {};
      const start = o.current_period_start ?? item.current_period_start,
        end = o.current_period_end ?? item.current_period_end;
      const status = ev.type.endsWith(".deleted") ? "canceled" : STRIPE_STATUS[o.status] || sub.status;
      const next = {
        ...sub,
        stripeCustomer: o.customer || sub.stripeCustomer,
        stripeSub: o.id,
        status,
        demo: false,
        cancelAtPeriodEnd: status === "canceled" ? false : !!o.cancel_at_period_end,
        ...(start ? { periodStart: dateOf(start) } : {}),
        ...(end ? { periodEnd: dateOf(end) } : {}),
        ...(status === "canceled" ? { canceledAt: dateOf(o.ended_at || o.canceled_at) || today } : { canceledAt: "" }),
        ...(status === "active" && !sub.since ? { since: today } : {}),
      };
      await saveSub(next);
      return "suscripcion:" + status;
    }
    case "invoice.paid": {
      const amount = (o.amount_paid ?? 0) / 100;
      let counted = false;
      if (amount > 0) counted = await recordRevenue({ id: o.id, email, amount, plan: sub.plan?.id, planName: sub.plan?.name, at: dateOf(o.status_transitions?.paid_at || o.created), demo: false, invoice: o.number || o.id });
      // Si estaba impagada, el pago la reactiva (el periodo lo trae customer.subscription.updated).
      const line = o.lines?.data?.[0]?.period;
      const period = line?.end && (sub.status !== "active" || !sub.periodEnd) ? { periodStart: dateOf(line.start), periodEnd: dateOf(line.end) } : !sub.periodEnd ? { periodStart: today, periodEnd: addMonths(today, 1) } : {};
      await saveSub({ ...sub, status: sub.status === "canceled" ? "canceled" : "active", lastFailure: "", ...period, since: sub.since || today });
      return counted ? "cuota" : "cuota-repetida";
    }
    case "invoice.payment_failed": {
      await saveSub({ ...sub, status: sub.status === "canceled" ? "canceled" : "past_due", lastFailure: today });
      return "impago";
    }
    default:
      return "ignorado";
  }
}

// Función HTTP del webhook (también la usa api/stripe-webhook.js). Hace falta el
// cuerpo EXACTO que mandó Stripe: si la plataforma ya lo convirtió en objeto, no
// se puede comprobar la firma y se rechaza (nunca se fía de un cuerpo sin firma).
export async function readRaw(req) {
  if (typeof req.rawBody === "string" || Buffer.isBuffer(req.rawBody)) return String(req.rawBody);
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return null;
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > 1_000_000) throw Object.assign(new Error("Demasiados datos."), { status: 413 });
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function webhookHttp(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST") return send(405, { error: "Solo POST." });
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret) return send(503, { error: "Webhook sin configurar." });
  let raw;
  try {
    raw = await readRaw(req);
  } catch (e) {
    return send(e.status || 400, { error: e.message });
  }
  if (raw == null) {
    console.error("Webhook de Stripe: llegó el cuerpo ya convertido; hace falta el cuerpo en bruto para comprobar la firma.");
    return send(400, { error: "Cuerpo sin procesar no disponible." });
  }
  if (!verifySignature(raw, req.headers["stripe-signature"], secret)) return send(400, { error: "Firma no válida." });
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    return send(400, { error: "Cuerpo mal formado." });
  }
  try {
    const did = await applyEvent(ev);
    return send(200, { received: true, did });
  } catch (e) {
    console.error("Webhook de Stripe:", ev?.type, e.message);
    await cmd("DEL", "stripeevt:" + ev.id).catch(() => {}); // para que Stripe pueda reintentar
    return send(500, { error: "No se pudo procesar." });
  }
}
