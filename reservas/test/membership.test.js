// Socio NOVA+ (membresía mensual): alta y baja en demo, cortes incluidos, días vista,
// webhook de Stripe con firma, panel de socios solo para el dueño y suma en ganancias.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import handler from "../api/handler.js";
import { cmd, getJSON, pipe, setJSON } from "../api/_lib/store.js";
import * as M from "../api/_lib/membership.js";
import * as T from "../api/_lib/time.js";
import * as E from "../api/_lib/earnings.js";

function http(method, route, { body, raw, cookie, headers = {}, ip = "198.51.100.40" } = {}) {
  const hdrs = new Map();
  let status = 200,
    out = "";
  const req = { method, url: "/api/handler?route=" + route, headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "nova.test", ...(cookie ? { cookie } : {}), ...headers }, body: raw !== undefined ? raw : body };
  const res = { setHeader: (k, v) => hdrs.set(String(k).toLowerCase(), v), getHeader: (k) => hdrs.get(String(k).toLowerCase()), end: (b) => (out = b == null ? "" : String(b)) };
  Object.defineProperty(res, "statusCode", { get: () => status, set: (v) => (status = v) });
  return handler(req, res).then(() => {
    let json = null;
    try {
      json = out ? JSON.parse(out) : null;
    } catch {}
    return { status, json, cookies: [].concat(hdrs.get("set-cookie") || []) };
  });
}
let ipn = 0;
const nextIp = () => "198.51.101." + (++ipn % 250);

async function staffCookie(provider) {
  const r = await http("POST", "staff/login", { body: { provider, pin: "1234" }, ip: nextIp() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.cookies.find((c) => c.startsWith("nova_staff=")).split(";")[0];
}
// Cliente en modo demo, con nombre y tarjeta de prueba (la reserva la pide).
async function client(email) {
  const ip = nextIp();
  const r = await http("POST", "auth/request", { body: { email }, ip });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cookie = r.cookies.find((c) => c.startsWith("nova_s=")).split(";")[0];
  assert.equal((await http("POST", "auth/name", { body: { name: "Socio " + email.split("@")[0] }, cookie, ip })).status, 200);
  const u = await getJSON("user:" + email);
  await setJSON("user:" + email, { ...u, card: { brand: "visa", last4: "4242", exp: "12/30", pm: "pm_test" } });
  return { cookie, ip, email };
}
const ENV = ["MODO_DEMO", "VERCEL", "STAFF_PIN", "STAFF_PIN_EHEDEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY"];
const saved = {};
before(() => {
  for (const k of ENV) (saved[k] = process.env[k]), delete process.env[k];
  process.env.MODO_DEMO = "1";
});
after(() => {
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});

const today = () => T.nowLocal().date;
// Un día de martes a viernes, al menos `ahead` días después de hoy.
function workday(ahead) {
  for (let i = ahead; i < ahead + 14; i++) {
    const d = T.addDays(today(), i);
    if ([2, 3, 4, 5].includes(T.weekday(d))) return d;
  }
}
const book = (c, date, start, service = "corte", provider = "airam") =>
  http("POST", "book", { body: { service, provider, date, start, terms: true }, cookie: c.cookie, ip: c.ip });

describe("Socio NOVA+ en demo", { concurrency: 1 }, () => {
  test("el catálogo ofrece el plan por defecto «Club NOVA»", async () => {
    const r = await http("GET", "catalog");
    assert.equal(r.status, 200);
    const p = r.json.membership.plans[0];
    assert.equal(p.id, "club-nova");
    assert.equal(p.name, "Club NOVA");
    assert.equal(p.cuts, 2);
    assert.equal(r.json.membership.demo, true);
  });

  test("hay que entrar para hacerse socio", async () => {
    assert.equal((await http("POST", "membership/join", { body: { plan: "club-nova" } })).status, 401);
    assert.equal((await http("GET", "membership")).status, 401);
  });

  test("alta y baja inmediatas, marcadas como demo y sin Stripe", async () => {
    const c = await client("alta@example.com");
    const j = await http("POST", "membership/join", { body: { plan: "club-nova" }, ...c });
    assert.equal(j.status, 200, JSON.stringify(j.json));
    assert.equal(j.json.demo, true);
    assert.equal(j.json.mine.live, true);
    assert.equal(j.json.mine.demo, true);
    assert.equal(j.json.mine.left, 2);
    assert.equal(j.json.mine.renews, M.addMonths(today(), 1));
    // El perfil la ve en /api/me
    assert.equal((await http("GET", "me", c)).json.membership.status, "active");
    // No se puede dar de alta dos veces
    assert.equal((await http("POST", "membership/join", { body: { plan: "club-nova" }, ...c })).status, 409);
    assert.equal((await http("POST", "membership/join", { body: { plan: "no-existe" }, ...(await client("alta2@example.com")) })).status, 400);
    const x = await http("POST", "membership/cancel", { body: {}, ...c });
    assert.equal(x.status, 200);
    assert.equal(x.json.mine.status, "canceled");
    assert.equal(x.json.mine.live, false);
    assert.equal((await http("POST", "membership/cancel", { body: {}, ...c })).status, 400);
    // Puede volver a darse de alta
    assert.equal((await http("POST", "membership/join", { body: { plan: "club-nova" }, ...c })).json.mine.live, true);
  });

  test("consume un corte por cita incluida, no cubre otros servicios y se acaba", async () => {
    const c = await client("cortes@example.com");
    await http("POST", "membership/join", { body: { plan: "club-nova" }, ...c });
    const d = workday(2);
    const a = await book(c, d, "10:00");
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.membership.included, true);
    assert.equal(a.json.membership.left, 1);
    const bk = await getJSON("bk:" + a.json.id);
    assert.equal(bk.membership.included, true);
    const b2 = await book(c, d, "10:30", "corte-barba");
    assert.equal(b2.json.membership.left, 0);
    // Tercera cita del mismo periodo: se paga en el local, ya no sale incluida
    const b3 = await book(c, d, "11:00");
    assert.equal(b3.status, 200, JSON.stringify(b3.json));
    assert.equal(b3.json.membership, undefined);
    assert.equal((await getJSON("bk:" + b3.json.id)).membership, undefined);
    assert.equal((await http("GET", "membership", c)).json.mine.left, 0);
    // Un servicio que no cubre el plan (corte privado) tampoco sale incluido
    const c2 = await client("privado@example.com");
    await http("POST", "membership/join", { body: { plan: "club-nova" }, ...c2 });
    const p = await book(c2, workday(3), "12:00", "privado");
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.membership, undefined);
  });

  test("cancelar a tiempo devuelve el corte; cancelar tarde o no venir lo gasta", async () => {
    const c = await client("devuelve@example.com");
    await http("POST", "membership/join", { body: { plan: "club-nova" }, ...c });
    const d = workday(3);
    const a = await book(c, d, "10:00", "corte", "ehedey");
    await book(c, d, "10:30", "corte", "ehedey");
    assert.equal((await http("GET", "membership", c)).json.mine.left, 0);
    const x = await http("POST", `bookings/${a.json.id}/cancel`, { body: {}, ...c });
    assert.equal(x.status, 200);
    assert.equal(x.json.late, false);
    assert.equal(x.json.cutReturned, true);
    assert.equal((await http("GET", "membership", c)).json.mine.left, 1);
    // La hora vuelve a ser libre y el corte, a estar disponible
    const again = await book(c, d, "10:00", "corte", "ehedey");
    assert.equal(again.json.membership.included, true);

    // Reglas puras: tarde y «No vino» gastan; cancelada a tiempo no.
    const sub = await M.getSub("devuelve@example.com");
    const mk = (extra) => ({ id: "X" + Math.random(), kind: "booking", date: d, membership: { included: true }, ...extra });
    const cov = (list) => M.coverage(sub, "corte", d, list, today());
    assert.equal(cov([mk({ status: "canceled" })]).used, 0);
    assert.equal(cov([mk({ status: "canceled", late: true })]).used, 1);
    assert.equal(cov([mk({ status: "confirmed", attendance: "absent" })]).used, 1);
    assert.equal(cov([mk({ status: "confirmed" }), mk({ status: "confirmed" })]).included, false);
  });

  test("prioridad: el socio reserva con más días vista que el resto", async () => {
    const far = workday(75); // más allá de los 60 días normales, dentro de los 90 del plan
    const socio = await client("lejos@example.com");
    const normal = await client("normal@example.com");
    await http("POST", "membership/join", { body: { plan: "club-nova" }, ...socio });
    const month = far.slice(0, 7);
    const av = (c) => http("GET", `avail&service=corte&provider=airam&month=${month}`, c);
    assert.ok(((await av(socio)).json.days[far] || []).length > 0, "el socio ve huecos a 75 días");
    assert.equal(((await av(normal)).json.days[far] || []).length, 0, "el resto no");
    assert.equal((await book(normal, far, "10:00")).status, 409);
    const ok = await book(socio, far, "10:00");
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    // Ese día cae en un periodo futuro: solo sale incluido si la membresía se renueva
    assert.equal(ok.json.membership?.included, true);
  });

  test("renovación demo: al vencer el periodo, vuelve a tener cortes y se apunta otra cuota", async () => {
    const c = await client("renueva@example.com");
    await http("POST", "membership/join", { body: { plan: "club-nova" }, ...c });
    const sub = await M.getSub("renueva@example.com");
    await M.saveSub({ ...sub, periodStart: M.addMonths(today(), -1), periodEnd: today() });
    const r = await http("GET", "membership", c);
    assert.equal(r.json.mine.periodStart, today());
    assert.equal(r.json.mine.renews, M.addMonths(today(), 1));
    const rev = await M.revenueOf(today().slice(0, 7));
    assert.ok(rev.list.some((x) => x.email === "renueva@example.com" && x.id.endsWith(today())), "cuota de la renovación");
  });
});

describe("webhook de Stripe", { concurrency: 1 }, () => {
  const SECRET = "whsec_test_" + "x".repeat(16);
  const email = "stripe@example.com";
  const post = (ev, { sig, raw } = {}) => {
    const text = raw ?? JSON.stringify(ev);
    return http("POST", "stripe/webhook", { raw: text, headers: { "stripe-signature": sig === undefined ? M.signPayload(text, SECRET) : sig }, ip: nextIp() });
  };
  const evt = (type, object) => ({ id: "evt_" + Math.random().toString(36).slice(2), type, data: { object } });
  const now = Math.floor(Date.now() / 1000);

  before(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    // Alta a medias: la dejó apuntada «membership/join» antes de ir a Checkout.
    await M.saveSub({ email, name: "Stripe", plan: { id: "club-nova", name: "Club NOVA", price: 30, cuts: 2, services: ["corte"], daysAhead: 90, discountPct: 10 }, status: "incomplete", demo: false, stripeCustomer: "cus_T1", created: today() });
  });

  test("firma inválida, ausente, caducada o con otro secreto: 400 y no cambia nada", async () => {
    const ev = evt("checkout.session.completed", { mode: "subscription", customer: "cus_T1", subscription: "sub_T1", payment_status: "paid" });
    assert.equal((await post(ev, { sig: "t=1,v1=00" })).status, 400);
    assert.equal((await post(ev, { sig: "" })).status, 400);
    assert.equal((await post(ev, { sig: M.signPayload(JSON.stringify(ev), "otro_secreto") })).status, 400);
    assert.equal((await post(ev, { sig: M.signPayload(JSON.stringify(ev), SECRET, now - 4000) })).status, 400);
    // Firmado el cuerpo A pero enviado el B
    const body = JSON.stringify(ev);
    assert.equal((await post(ev, { sig: M.signPayload(body, SECRET), raw: body.replace("cus_T1", "cus_T2") })).status, 400);
    assert.equal((await M.getSub(email)).status, "incomplete");
  });

  test("sin STRIPE_WEBHOOK_SECRET el webhook no acepta nada (503); con el cuerpo ya convertido, tampoco", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal((await post(evt("x", {}))).status, 503);
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const r = await http("POST", "stripe/webhook", { body: { id: "evt_1", type: "x", data: { object: {} } }, headers: { "stripe-signature": "t=1,v1=aa" }, ip: nextIp() });
    assert.equal(r.status, 400);
  });

  test("firma válida: alta, cuota, cambio de periodo, impago, baja programada y baja", async () => {
    let r = await post(evt("checkout.session.completed", { mode: "subscription", customer: "cus_T1", subscription: "sub_T1", payment_status: "paid", client_reference_id: email }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    let s = await M.getSub(email);
    assert.equal(s.status, "active");
    assert.equal(s.stripeSub, "sub_T1");
    assert.equal(s.demo, false);
    assert.equal(await cmd("GET", "msubid:sub_T1"), email);

    const inv = { id: "in_T1", customer: "cus_T1", subscription: "sub_T1", amount_paid: 3000, created: now, number: "A-0001" };
    r = await post(evt("invoice.paid", inv));
    assert.equal(r.json.did, "cuota");
    // El mismo cobro por otro evento (Stripe reenvía) no se suma dos veces
    assert.equal((await post(evt("invoice.paid", inv))).json.did, "cuota-repetida");
    const rev = await M.revenueOf(M.localDate(now).slice(0, 7));
    assert.equal(rev.list.filter((x) => x.id === "in_T1").length, 1);
    assert.equal(rev.list.find((x) => x.id === "in_T1").amount, 30);

    // El mismo evento reenviado (mismo id) se ignora
    const same = evt("customer.subscription.updated", { id: "sub_T1", customer: "cus_T1", status: "active", cancel_at_period_end: false, current_period_start: now, current_period_end: now + 30 * 86400 });
    assert.equal((await post(same)).json.did, "suscripcion:active");
    assert.equal((await post(same)).json.did, "repetido");
    s = await M.getSub(email);
    assert.equal(s.periodStart, M.localDate(now));
    assert.equal(s.periodEnd, M.localDate(now + 30 * 86400));

    assert.equal((await post(evt("invoice.payment_failed", { id: "in_T2", customer: "cus_T1", subscription: "sub_T1" }))).json.did, "impago");
    s = await M.getSub(email);
    assert.equal(s.status, "past_due");
    assert.equal(M.isLive(s, today()), false, "impagada: sin ventajas");

    // Paga después: vuelve a estar activa
    await post(evt("invoice.paid", { id: "in_T3", customer: "cus_T1", subscription: "sub_T1", amount_paid: 3000, created: now, lines: { data: [{ period: { start: now, end: now + 30 * 86400 } }] } }));
    assert.equal((await M.getSub(email)).status, "active");

    await post(evt("customer.subscription.updated", { id: "sub_T1", customer: "cus_T1", status: "active", cancel_at_period_end: true, current_period_start: now, current_period_end: now + 30 * 86400 }));
    s = await M.getSub(email);
    assert.equal(s.cancelAtPeriodEnd, true);
    assert.equal(M.isLive(s, today()), true, "sigue activa hasta el final del periodo");

    await post(evt("customer.subscription.deleted", { id: "sub_T1", customer: "cus_T1", status: "canceled", ended_at: now }));
    s = await M.getSub(email);
    assert.equal(s.status, "canceled");
    assert.equal(M.isLive(s, today()), false);
    // Eventos de clientes que no conocemos o de otros tipos no rompen nada
    assert.equal((await post(evt("customer.subscription.updated", { id: "sub_X", customer: "cus_X", status: "active" }))).json.did, "sin-cliente");
    assert.equal((await post(evt("charge.refunded", { id: "ch_1", customer: "cus_T1" }))).json.did, "ignorado");
  });

  test("verifySignature: acepta varias firmas v1 y compara en tiempo constante", () => {
    const raw = '{"a":1}';
    const good = M.signPayload(raw, SECRET).split("v1=")[1];
    const t = Math.floor(Date.now() / 1000);
    assert.equal(M.verifySignature(raw, `t=${t},v1=${"0".repeat(64)},v1=${good}`.replace(/t=\d+/, `t=${t}`), SECRET), M.verifySignature(raw, M.signPayload(raw, SECRET, t), SECRET) && true);
    assert.equal(M.verifySignature(raw, "basura", SECRET), false);
    assert.equal(M.verifySignature(raw, M.signPayload(raw, SECRET), ""), false);
  });
});

describe("panel de socios y ganancias", { concurrency: 1 }, () => {
  test("solo el dueño ve la lista de socios y edita los planes", async () => {
    const duenio = await staffCookie("airam");
    const barbero = await staffCookie("ehedey");
    assert.equal((await http("GET", "staff/membership")).status, 401);
    assert.equal((await http("GET", "staff/membership", { cookie: barbero })).status, 403);
    assert.equal((await http("POST", "staff/membership/plans", { body: { plans: [] }, cookie: barbero })).status, 403);
    const caja = await http("POST", "staff/login", { body: { provider: "caja", pin: "1234" }, ip: nextIp() });
    const cajaCookie = caja.cookies.find((c) => c.startsWith("nova_staff=")).split(";")[0];
    assert.equal((await http("GET", "staff/membership", { cookie: cajaCookie })).status, 401);
    // Un cliente normal tampoco
    const c = await client("curioso@example.com");
    assert.equal((await http("GET", "staff/membership", c)).status, 401);

    const r = await http("GET", "staff/membership", { cookie: duenio });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(Array.isArray(r.json.members) && typeof r.json.mrr === "number");
    const live = r.json.members.filter((m) => m.live);
    assert.equal(r.json.counts.active, live.length);
    assert.equal(r.json.mrr, Math.round(live.reduce((a, m) => a + m.plan.price, 0) * 100) / 100);
    const m = live.find((x) => x.email === "cortes@example.com");
    assert.ok(m, "aparece un socio de las pruebas anteriores");
    assert.equal(m.plan.name, "Club NOVA");
    assert.equal(m.cuts, 2);
    assert.equal(m.used, 2);
    assert.equal(m.left, 0);
    assert.ok(m.since && m.renews);
  });

  test("el dueño edita los planes: se validan y no se puede quitar uno con socios", async () => {
    const duenio = await staffCookie("airam");
    const base = { id: "club-nova", name: "Club NOVA", price: 28, cuts: 3, services: ["corte"], daysAhead: 90, discountPct: 10, active: true };
    const bad = async (patch) => (await http("POST", "staff/membership/plans", { body: { plans: [{ ...base, ...patch }] }, cookie: duenio })).status;
    assert.equal(await bad({ price: 0 }), 400);
    assert.equal(await bad({ cuts: 2.5 }), 400);
    assert.equal(await bad({ services: [] }), 400);
    assert.equal(await bad({ discountPct: 80 }), 400);
    assert.equal(await bad({ name: " " }), 400);
    assert.equal((await http("POST", "staff/membership/plans", { body: { plans: [{ ...base, id: "otro" }] }, cookie: duenio })).status, 400, "quitar un plan con socios");
    const ok = await http("POST", "staff/membership/plans", { body: { plans: [{ ...base, price: "28,50" }, { name: "Solo ventajas", price: 9, cuts: 0, services: [], daysAhead: 120, discountPct: 15 }] }, cookie: duenio });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.plans[0].price, 28.5);
    assert.equal(ok.json.plans[1].id, "solo-ventajas");
    const cat = await http("GET", "catalog");
    assert.equal(cat.json.membership.plans.length, 2);
    // Los socios que ya estaban conservan lo que contrataron (3 cortes es solo para altas nuevas)
    assert.equal((await M.getSub("cortes@example.com")).plan.cuts, 2);
    const nuevo = await client("nuevo@example.com");
    assert.equal((await http("POST", "membership/join", { body: { plan: "club-nova" }, ...nuevo })).json.mine.cuts, 3);
    // Un plan desactivado no se puede contratar
    await http("POST", "staff/membership/plans", { body: { plans: [{ ...base, active: true }, { name: "Solo ventajas", price: 9, cuts: 0, services: [], daysAhead: 120, discountPct: 15, active: false }] }, cookie: duenio });
    assert.equal((await http("POST", "membership/join", { body: { plan: "solo-ventajas" }, ...(await client("inactivo@example.com")) })).status, 400);
  });

  test("las cuotas suman como línea propia en «Cuánto gana Nova» y los cortes incluidos no cuentan doble", async () => {
    const duenio = await staffCookie("airam");
    const month = E.shiftMonth(today().slice(0, 7), -1);
    const first = month + "-01";
    await M.recordRevenue({ id: "t-rev-1", email: "a@example.com", amount: 30, plan: "club-nova", planName: "Club NOVA", at: first, demo: true });
    await M.recordRevenue({ id: "t-rev-2", email: "b@example.com", amount: 28.5, plan: "club-nova", planName: "Club NOVA", at: month + "-02", demo: false });
    const wd = (() => {
      for (let d = first; d.startsWith(month); d = T.addDays(d, 1)) if ([2, 3, 4, 5].includes(T.weekday(d))) return d;
    })();
    const seed = async (id, price, extra) => {
      const b = { id, kind: "booking", service: { id: "corte", name: "Corte de pelo", price, duration: 30 }, provider: { id: "airam", name: "Airam" }, date: wd, start: id.endsWith("1") ? "10:00" : "11:00", end: id.endsWith("1") ? "10:30" : "11:30", status: "confirmed", attendance: "done", created: wd + " 09:00", email: id + "@example.com", name: id, by: "client", ...extra };
      await pipe([["SET", "bk:" + id, JSON.stringify(b)], ["SADD", "ubk:" + b.email, id], ["SADD", "day:" + wd, id]]);
    };
    const get = async () => (await http("GET", "staff/earnings&month=" + month, { cookie: duenio })).json;
    const before = await get();
    await seed("MEMB1", 15, { membership: { included: true, plan: "club-nova", planName: "Club NOVA" } }); // incluida: 0 €
    await seed("MEMB2", 15, {}); // normal: 15 €
    const after = await get();
    const line = after.current.income.other.find((o) => o.id === "membresias");
    assert.ok(line, "línea propia de membresías");
    assert.equal(line.amount, 58.5);
    assert.equal(line.count, 2);
    assert.equal(line.demo, 1);
    assert.equal(after.current.income.services - before.current.income.services, 15, "la cita incluida no suma como servicio");
    assert.equal(after.current.services - before.current.services, 2, "pero sí cuenta como servicio hecho (ocupación)");
    assert.equal(after.current.income.total, Math.round((after.current.income.services + after.current.income.otherTotal) * 100) / 100);
    assert.equal(after.current.income.otherTotal - before.current.income.otherTotal, 0, "cuotas ya estaban antes de las citas");
    assert.ok(after.current.income.total >= 58.5 + 15);
  });

  test("caja: la cita incluida se cobra a 0 € con «membresía», sin sumar importe ni puntos de menos", async () => {
    const duenio = await staffCookie("airam");
    const c = await client("caja@example.com");
    await http("POST", "membership/join", { body: { plan: "club-nova" }, ...c });
    const a = await book(c, workday(2), "15:00", "corte", "noa");
    assert.equal(a.json.membership.included, true);
    const bk = await getJSON("bk:" + a.json.id);
    // El importe que mande la tablet da igual: una cita incluida va a 0
    const p = await http("POST", "staff/cobros", { body: { provider: "airam", booking: bk.id, service: "corte", amount: "15", method: "efectivo", name: bk.name }, cookie: duenio });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.cobro.amount, 0);
    assert.equal(p.json.cobro.method, "membresia");
    assert.equal(p.json.cobro.items[0].price, 0);
    const done = await getJSON("bk:" + bk.id);
    assert.equal(done.attendance, "done");
    assert.equal(done.pay.amount, 0);
    // En el listado de caja, la cita pendiente de otra persona sale marcada si es incluida
    // Su corte ya cobrado a 0 € sigue gastando uno de los suyos
    const mine = (await http("GET", "membership", c)).json.mine;
    assert.equal(mine.left, mine.cuts - 1);
  });
});

// Con STRIPE_SECRET_KEY (de mentira) y fetch simulado: no sale nada a la red.
describe("Stripe Subscriptions (llamadas simuladas)", { concurrency: 1 }, () => {
  test("crea producto y precio con lookup_key si no existen, y los reutiliza", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_" + "0".repeat(12);
    const real = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      const path = String(url).replace("https://api.stripe.com/v1/", "");
      calls.push({ method: init.method, path, body: String(init.body || "") });
      const json = (x) => ({ ok: true, json: async () => x });
      if (path.startsWith("prices?")) return json({ data: calls.filter((c) => c.method === "POST" && c.path === "prices").length ? [{ id: "price_1" }] : [] });
      if (path === "products") return json({ id: "prod_1" });
      if (path === "prices") return json({ id: "price_1" });
      if (path === "checkout/sessions") return json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
      if (path.startsWith("subscriptions/")) return json({ id: "sub_1", cancel_at_period_end: true });
      throw new Error("llamada inesperada " + path);
    };
    try {
      const S = await import("../api/_lib/stripe.js?con-clave");
      assert.equal(S.membershipDemo(), false);
      const plan = { id: "club-nova", name: "Club NOVA", price: 30 };
      assert.equal(await S.ensureMembershipPrice(plan, true), "price_1");
      const post = calls.find((c) => c.method === "POST" && c.path === "prices");
      const q = new URLSearchParams(post.body);
      assert.equal(q.get("unit_amount"), "3000");
      assert.equal(q.get("currency"), "eur");
      assert.equal(q.get("recurring[interval]"), "month");
      assert.equal(q.get("lookup_key"), "nova_socio_club-nova_3000");
      // Segunda vez: ya existe, no crea nada
      const n = calls.length;
      assert.equal(await S.ensureMembershipPrice(plan, true), "price_1");
      assert.equal(calls.slice(n).filter((c) => c.method === "POST").length, 0);
      // ID de precio propio por variable de entorno
      process.env.STRIPE_MEMBERSHIP_PRICE_ID = "price_propio";
      assert.equal(await S.ensureMembershipPrice(plan, true), "price_propio");
      delete process.env.STRIPE_MEMBERSHIP_PRICE_ID;
      const s = await S.membershipCheckout({ customer: "cus_1", price: "price_1", email: "a@b.es", plan: "club-nova", base: "https://nova.test" });
      assert.match(s.url, /^https:\/\/checkout\.stripe\.com\//);
      const c = new URLSearchParams(calls.at(-1).body);
      assert.equal(c.get("mode"), "subscription");
      assert.equal(c.get("line_items[0][price]"), "price_1");
      assert.equal(c.get("success_url"), "https://nova.test/perfil?socio=ok");
      assert.equal(c.get("subscription_data[metadata][email]"), "a@b.es");
      await S.membershipCancel("sub_1", true);
      assert.equal(new URLSearchParams(calls.at(-1).body).get("cancel_at_period_end"), "true");
    } finally {
      globalThis.fetch = real;
      delete process.env.STRIPE_SECRET_KEY;
    }
  });
});
