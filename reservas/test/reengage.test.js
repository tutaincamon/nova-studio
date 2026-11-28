// Clientes dormidos y peticiones de reseña: detección con N semanas, sin repetir avisos,
// registro «simulado» en demo, una petición por cita, cron con y sin CRON_SECRET y panel solo del dueño.
import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";
import * as R from "../api/_lib/reengage.js";

const ENV = ["MODO_DEMO", "VERCEL", "CRON_SECRET", "RESEND_API_KEY", "GOOGLE_REVIEW_URL", "STAFF_PIN", "STAFF_PIN_EHEDEY"];
const saved = {};
let handler, store, T;

function http(method, route, { body, cookie, headers = {}, ip = "198.51.100.90" } = {}) {
  const hdrs = new Map();
  let status = 200,
    out = "";
  const req = { method, url: "/api/handler?route=" + route, headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "nova.test", ...(cookie ? { cookie } : {}), ...headers }, body };
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
const nextIp = () => "198.51.102." + (++ipn % 250);
async function login(provider) {
  const r = await http("POST", "staff/login", { body: { provider, pin: "1234" }, ip: nextIp() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.cookies.find((c) => c.startsWith("nova_staff=")).split(";")[0];
}

before(async () => {
  for (const k of ENV) (saved[k] = process.env[k]), delete process.env[k];
  process.env.MODO_DEMO = "1";
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 27, 14, 0) }); // 27-nov-2026, 14:00 en Canarias
  handler = (await import("../api/handler.js")).default;
  store = await import("../api/_lib/store.js");
  T = await import("../api/_lib/time.js");
});
after(() => {
  mock.timers.reset();
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});

const TODAY = "2026-11-27";
let n = 0;
async function client(email, name, lastVisitDaysAgo, { future = false, optout = false } = {}) {
  const ops = [["SET", "user:" + email, JSON.stringify({ email, name })], ["SADD", "users", email]];
  const mk = (date, start, extra) => {
    const id = "D" + String(++n).padStart(5, "0");
    const b = { id, kind: "booking", service: { id: "corte", name: "Corte", price: 15, duration: 30 }, provider: { id: "airam", name: "Airam" }, date, start, end: T.toHHMM(T.toMin(start) + 30), status: "confirmed", created: date + " 09:00", email, name, by: "client", ...extra };
    ops.push(["SET", "bk:" + id, JSON.stringify(b)], ["SADD", "ubk:" + email, id], ["SADD", "day:" + date, id]);
    return b;
  };
  const past = mk(T.addDays(TODAY, -lastVisitDaysAgo), "10:00", { attendance: "done" });
  if (future) mk(T.addDays(TODAY, 5), "10:00", {});
  if (optout) ops.push(["SET", "nomkt:" + email, "1"]);
  await store.pipe(ops);
  return past;
}

describe("reglas puras", () => {
  const c = (o) => ({ email: "a@x.es", visits: 3, since: 50, next: null, optout: false, contacted: null, ...o });
  test("dormido según N semanas", () => {
    assert.equal(R.isDormant(c({ since: 41 }), 6), false);
    assert.equal(R.isDormant(c({ since: 42 }), 6), true);
    assert.equal(R.isDormant(c({ since: 30 }), 4), true);
    assert.equal(R.isDormant(c({ since: 30 }), 8), false);
    assert.equal(R.isDormant(c({ next: { date: "2026-12-01" } }), 6), false);
    assert.equal(R.isDormant(c({ visits: 0 }), 6), false);
  });
  test("no se repite el aviso dentro de N semanas, ni a quien se dio de baja", () => {
    assert.equal(R.dormantDue(c({}), 6, TODAY), true);
    assert.equal(R.dormantDue(c({ contacted: { at: "2026-11-01 10:00" } }), 6, TODAY), false);
    assert.equal(R.dormantDue(c({ contacted: { at: "2026-09-01 10:00" } }), 6, TODAY), true);
    assert.equal(R.dormantDue(c({ optout: true }), 6, TODAY), false);
  });
  test("petición de reseña: una por cita y una cada X días por cliente", () => {
    const b = { id: "x" };
    assert.equal(R.reviewDue({ booking: b, gapDays: 30, today: TODAY }), true);
    assert.equal(R.reviewDue({ booking: b, askedBooking: true, gapDays: 30, today: TODAY }), false);
    assert.equal(R.reviewDue({ booking: b, lastAsk: { at: "2026-11-10 10:00" }, gapDays: 30, today: TODAY }), false);
    assert.equal(R.reviewDue({ booking: b, lastAsk: { at: "2026-10-10 10:00" }, gapDays: 30, today: TODAY }), true);
  });
  test("enlace de reserva directa con barbero y servicio habituales", () => {
    assert.equal(R.bookLink("n.test", { service: "corte", provider: "airam" }), "https://n.test/#reservar/corte/airam");
    assert.equal(R.bookLink("n.test", { service: "corte", provider: "x" }, { service: () => true, provider: () => false }), "https://n.test/#reservar");
  });
  test("semanas válidas", () => {
    assert.equal(R.weeksOf("6"), 6);
    assert.throws(() => R.weeksOf(1), RangeError);
    assert.throws(() => R.weeksOf(99), RangeError);
    assert.equal(R.weeksFromDays(45), 6);
  });
});

describe("avisos en demo (se registran, no se envían)", { concurrency: 1 }, () => {
  let owner;
  const tick = (headers) => http("GET", "cron/tick", { headers, ip: nextIp() });
  before(async () => {
    owner = await login("airam");
    await client("viejo@demo.test", "Viejo Cliente", 60); // dormido con 6 semanas
    await client("medio@demo.test", "Medio Cliente", 33); // dormido solo si N=4
    await client("reciente@demo.test", "Reciente", 10);
    await client("conCita@demo.test", "Con Cita", 90, { future: true });
    await client("baja@demo.test", "De Baja", 90, { optout: true });
    await client("hoy@demo.test", "Corte De Hoy", 0).then(async (b) => {
      // acabado hace más de una hora (hoy a las 10:00, ahora son las 14:00)
      assert.ok(b);
    });
    await client("ayer@demo.test", "Corte De Ayer", 1);
  });

  test("solo el dueño ve el panel de avisos", async () => {
    assert.equal((await http("GET", "staff/avisos", { ip: nextIp() })).status, 401);
    const barber = await login("ehedey");
    assert.equal((await http("GET", "staff/avisos", { cookie: barber, ip: nextIp() })).status, 403);
    assert.equal((await http("POST", "staff/avisos/resena", { cookie: barber, body: { bookingId: "x" }, ip: nextIp() })).status, 403);
    const r = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    assert.equal(r.status, 200);
    assert.equal(r.json.config.dormantWeeks, 6);
    assert.equal(r.json.sim, true);
    const emails = r.json.dormant.map((d) => d.email);
    assert.ok(emails.includes("viejo@demo.test") && emails.includes("baja@demo.test"));
    assert.ok(!emails.includes("medio@demo.test") && !emails.includes("conCita@demo.test") && !emails.includes("reciente@demo.test"));
    assert.equal(r.json.dormant.find((d) => d.email === "baja@demo.test").due, false);
  });

  test("configuración: semanas validadas y solo el dueño la cambia", async () => {
    const barber = await login("ehedey");
    assert.equal((await http("POST", "staff/rules", { cookie: barber, body: { dormantWeeks: 4 }, ip: nextIp() })).status, 403);
    assert.equal((await http("POST", "staff/rules", { cookie: owner, body: { dormantWeeks: 1 }, ip: nextIp() })).status, 400);
    assert.equal((await http("POST", "staff/rules", { cookie: owner, body: { reviews: true }, ip: nextIp() })).status, 400, "sin enlace no se activan las reseñas");
    const ok = await http("POST", "staff/rules", { cookie: owner, body: { dormantWeeks: 4, winbackAuto: true, reviews: true, reviewUrl: "https://g.page/r/panel/review", reviewGapDays: 30 }, ip: nextIp() });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const r = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    assert.ok(r.json.dormant.some((d) => d.email === "medio@demo.test"), "con 4 semanas, «medio» ya está dormido");
    assert.equal(r.json.config.reviewSource, "panel");
  });

  test("el enlace del panel prevalece sobre GOOGLE_REVIEW_URL", async () => {
    process.env.GOOGLE_REVIEW_URL = "https://g.page/r/entorno/review";
    let r = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    assert.equal(r.json.config.reviewSource, "panel");
    await http("POST", "staff/rules", { cookie: owner, body: { reviewUrl: "" }, ip: nextIp() });
    r = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    assert.equal(r.json.config.reviewSource, "env");
    delete process.env.GOOGLE_REVIEW_URL;
    await http("POST", "staff/rules", { cookie: owner, body: { reviewUrl: "https://g.page/r/panel/review" }, ip: nextIp() });
  });

  test("cron: registra «simulado», no repite y pide una sola reseña por cita", async () => {
    const t1 = await tick();
    assert.equal(t1.status, 200, JSON.stringify(t1.json));
    assert.equal(t1.json.mail, false);
    assert.ok(t1.json.simulated >= 4, "dormidos (viejo, medio) y reseñas (hoy, ayer): " + JSON.stringify(t1.json));
    const r1 = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    const log = r1.json.log;
    assert.ok(log.every((e) => e.status === "simulado"));
    const dorm = log.filter((e) => e.type === "dormido").map((e) => e.email).sort();
    assert.deepEqual(dorm, ["medio@demo.test", "viejo@demo.test"], "no a quien tiene cita, se dio de baja o vino hace poco");
    const rev = log.filter((e) => e.type === "resena").map((e) => e.email).sort();
    assert.deepEqual(rev, ["ayer@demo.test", "hoy@demo.test"]);
    assert.ok(r1.json.dormant.find((d) => d.email === "viejo@demo.test").lastNotice.simulated);
    // Segunda pasada: nada nuevo.
    store.cmd("DEL", "lock:cron");
    const t2 = await tick();
    assert.equal(t2.json.simulated, 0);
    assert.equal(t2.json.reviews, 0);
    const r2 = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    assert.equal(r2.json.log.length, log.length);
  });

  test("reenviar reseña y aviso manual quedan en el historial", async () => {
    const r = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    const first = r.json.reviews[0];
    const again = await http("POST", "staff/avisos/resena", { cookie: owner, body: { bookingId: first.bookingId }, ip: nextIp() });
    assert.equal(again.status, 200);
    assert.equal(again.json.status, "simulado");
    const man = await http("POST", "staff/clients/contact", { cookie: owner, body: { email: "viejo@demo.test", channel: "email" }, ip: nextIp() });
    assert.equal(man.json.status, "simulado");
    const baja = await http("POST", "staff/clients/contact", { cookie: owner, body: { email: "baja@demo.test", channel: "email" }, ip: nextIp() });
    assert.equal(baja.status, 400);
    const after = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    assert.equal(after.json.log.length, r.json.log.length + 2);
  });

  test("«Cuánto gana Nova» usa la misma función de dormidos", async () => {
    const r = await http("GET", "staff/earnings", { cookie: owner, ip: nextIp() });
    assert.equal(r.status, 200);
    assert.equal(r.json.current.dormant.weeks, 4);
    const a = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    assert.equal(r.json.current.dormant.count, a.json.dormant.length);
  });

  test("cron con CRON_SECRET: sin él o con otro, 401; con el bueno, pasa", async () => {
    process.env.CRON_SECRET = "secreto-de-prueba";
    try {
      assert.equal((await tick()).status, 401);
      assert.equal((await tick({ authorization: "Bearer otro" })).status, 401);
      store.cmd("DEL", "lock:cron");
      assert.equal((await tick({ authorization: "Bearer secreto-de-prueba" })).status, 200);
    } finally {
      delete process.env.CRON_SECRET;
      store.cmd("DEL", "lock:cron");
    }
    assert.equal((await tick()).status, 200, "en local y sin CRON_SECRET sigue abierto");
  });

  test("el aviso lleva el barbero y el servicio de siempre en el enlace", async () => {
    const all = await http("GET", "staff/clients", { cookie: owner, ip: nextIp() });
    const v = all.json.list.find((c) => c.email === "viejo@demo.test");
    assert.deepEqual([v.habit.service, v.habit.provider], ["corte", "airam"]);
    assert.equal(all.json.sim, true);
  });
});
