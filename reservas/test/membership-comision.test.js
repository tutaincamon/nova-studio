// Socio NOVA+: el barbero cobra comisión por cada corte incluido (sobre el PRECIO NORMAL
// del servicio, aunque el cliente pague 0 €) y el socio sigue sumando puntos del Club.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import handler from "../api/handler.js";
import { getJSON, pipe, setJSON } from "../api/_lib/store.js";
import * as T from "../api/_lib/time.js";
import * as E from "../api/_lib/earnings.js";
import { POINTS } from "../api/_lib/config.js";

function http(method, route, { body, cookie, ip = "198.51.100.60" } = {}) {
  const hdrs = new Map();
  let status = 200,
    out = "";
  const req = { method, url: "/api/handler?route=" + route, headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "nova.test", ...(cookie ? { cookie } : {}) }, body };
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
const staffCookie = async (provider) => {
  const r = await http("POST", "staff/login", { body: { provider, pin: "1234" }, ip: nextIp() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.cookies.find((c) => c.startsWith("nova_staff=")).split(";")[0];
};
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
const r2 = (n) => Math.round(n * 100) / 100;

// Un mes pasado con una cita en un día laborable.
const month = E.shiftMonth(today().slice(0, 7), -3);
const wd = (() => {
  for (let d = month + "-01"; d.startsWith(month); d = T.addDays(d, 1)) if ([2, 3, 4, 5].includes(T.weekday(d))) return d;
})();
async function seed(id, start, extra = {}, price = 15) {
  const mins = T.toMin(start);
  const b = { id, kind: "booking", service: { id: "corte", name: "Corte de pelo", price, duration: 30 }, provider: { id: "noa", name: "Noa" }, date: wd, start, end: T.toHHMM(mins + 30), status: "confirmed", attendance: "done", created: wd + " 09:00", email: id.toLowerCase() + "@example.com", name: id, by: "client", ...extra };
  await pipe([["SET", "bk:" + id, JSON.stringify(b)], ["SADD", "ubk:" + b.email, id], ["SADD", "day:" + wd, id]]);
  return b;
}
const INCL = { membership: { included: true, plan: "club-nova", planName: "Club NOVA" } };

describe("comisión en cortes incluidos en la membresía", { concurrency: 1 }, () => {
  test("Caja: el barbero cobra comisión sobre el precio normal aunque el cliente pague 0 €", async () => {
    const duenio = await staffCookie("airam");
    const get = async () => (await http("GET", "staff/summary&month=" + month, { cookie: duenio })).json.people.find((p) => p.id === "noa");
    const before = await get();
    await seed("COMI1", "10:00", INCL); // incluida, sin cobro apuntado
    await seed("COMI2", "11:00", {}); // normal
    const after = await get();
    const pct = after.pct;
    assert.ok(pct > 0, "noa tiene comisión");
    assert.equal(r2(after.billed - before.billed), 15, "solo factura la cita normal");
    assert.equal(r2(after.commission - before.commission), r2((30 * pct) / 100), "comisión de las dos: 15 € + 15 € de precio normal");
    assert.equal((after.includedCuts || 0) - (before.includedCuts || 0), 1);
    assert.equal(r2((after.includedCommission || 0) - (before.includedCommission || 0)), r2((15 * pct) / 100));
    const row = after.rows.find((x) => x.id === "COMI1");
    assert.equal(row.price, 0);
    assert.equal(row.base, 15);
    assert.equal(row.included, true);
    assert.equal(row.commission, r2((15 * pct) / 100));
    // Lo del dueño: el total de comisiones y de cortes incluidos
    const t = (await http("GET", "staff/summary&month=" + month, { cookie: duenio })).json.totals;
    assert.ok(t.includedCuts >= 1);
    assert.ok(t.includedCommission >= r2((15 * pct) / 100));
    // El barbero ve su resumen sin comisiones (como siempre)
    const noa = await staffCookie("noa");
    const mine = (await http("GET", "staff/summary&month=" + month, { cookie: noa })).json;
    assert.equal(mine.owner, false);
    assert.equal(mine.people[0].commission, undefined);
  });

  test("Caja: una cita incluida ya cobrada a 0 € también lleva comisión (cobro con `normal`)", async () => {
    const duenio = await staffCookie("airam");
    const get = async () => (await http("GET", "staff/summary&month=" + month, { cookie: duenio })).json.people.find((p) => p.id === "noa");
    const before = await get();
    const b = await seed("COMI3", "12:00", INCL);
    const pay = { id: "CCOMI3", provider: { id: "noa", name: "Noa" }, items: [{ id: "corte", name: "Corte de pelo", price: 0 }], amount: 0, method: "membresia", included: true, normal: 15, name: b.name, booking: b.id, date: wd, time: "12:30", created: wd + " 12:30", by: "airam" };
    await pipe([["SET", "pay:" + pay.id, JSON.stringify(pay)], ["SADD", "payday:" + wd, pay.id], ["SADD", "paymonth:" + month, pay.id]]);
    await setJSON("bk:" + b.id, { ...b, pay: { id: pay.id, amount: 0, method: "membresia" } });
    const after = await get();
    assert.equal(r2(after.commission - before.commission), r2((15 * after.pct) / 100));
    assert.equal(after.includedCuts - (before.includedCuts || 0), 1);
    assert.equal(after.billed, before.billed);
  });


  test("«Cuánto gana Nova»: el coste de comisión cuenta con ingreso 0 € y se muestran los cortes y su comisión", async () => {
    const duenio = await staffCookie("airam");
    const get = async () => (await http("GET", "staff/earnings&month=" + month, { cookie: duenio })).json;
    const r = await get();
    assert.ok(r.included.cuts >= 2, "COMI1 y COMI3");
    assert.ok(r.included.base >= 30);
    const noa = r.net.commissions.find((c) => c.id === "noa");
    assert.ok(noa.included > 0);
    assert.equal(r.included.commission, r.net.includedCommission);
    // La comisión total = (facturado + precio normal de incluidos) × %
    const w = r.workers.find((x) => x.id === "noa");
    assert.equal(noa.amount, r2(((w.billed + w.inclBase) * noa.pct) / 100));
    assert.equal(noa.included, r2((w.inclBase * noa.pct) / 100));
    // Sin doble conteo del ingreso: lo incluido no suma en servicios
    assert.equal(r.current.income.total, r2(r.current.income.services + r.current.income.otherTotal));
    assert.equal(r.net.net, r2(r.current.income.total - r.net.costs - r.net.commission));
  });

  test("netOf: comisión sobre lo facturado más el precio normal de lo incluido", () => {
    const w = [{ id: "a", name: "A" }];
    const n = E.netOf({ total: 100, byBarber: { a: 100 }, inclBase: { a: 50 } }, E.emptyExpenses(), w, () => 40);
    assert.equal(n.commission, 60);
    assert.equal(n.includedCommission, 20);
    assert.equal(n.net, 40);
    const sin = E.netOf({ total: 100, byBarber: { a: 100 } }, E.emptyExpenses(), w, () => 40);
    assert.equal(sin.commission, 40);
    assert.equal(sin.includedCommission, 0);
  });
});

describe("puntos del Club en cortes incluidos", { concurrency: 1 }, () => {
  test("el socio suma puntos por el valor normal del corte aunque pague 0 €", async () => {
    const email = "puntos-socio@example.com";
    const ip = nextIp();
    const rq = await http("POST", "auth/request", { body: { email }, ip });
    const cookie = rq.cookies.find((c) => c.startsWith("nova_s=")).split(";")[0];
    await http("POST", "auth/name", { body: { name: "Socio Puntos" }, cookie, ip });
    const u = await getJSON("user:" + email);
    await setJSON("user:" + email, { ...u, card: { brand: "visa", last4: "4242", exp: "12/30", pm: "pm_test" } });
    assert.equal((await http("POST", "membership/join", { body: { plan: "club-nova" }, cookie, ip })).status, 200);
    const base = (await http("GET", "member", { cookie, ip })).json.balance;
    let d = today();
    for (let i = 2; i < 16; i++) {
      d = T.addDays(today(), i);
      if ([2, 3, 4, 5].includes(T.weekday(d))) break;
    }
    const bk = await http("POST", "book", { body: { service: "corte", provider: "noa", date: d, start: "16:00", terms: true }, cookie, ip });
    assert.equal(bk.status, 200, JSON.stringify(bk.json));
    assert.equal(bk.json.membership.included, true);
    // Sin cobro apuntado todavía no hay puntos
    assert.equal((await http("GET", "member", { cookie, ip })).json.balance, base);
    const duenio = await staffCookie("airam");
    const p = await http("POST", "staff/cobros", { body: { provider: "noa", booking: bk.json.id, service: "corte", amount: "0", method: "efectivo", name: "Socio Puntos" }, cookie: duenio });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.cobro.amount, 0);
    const price = (await getJSON("bk:" + bk.json.id)).service.price;
    assert.ok(price > 0);
    const me = (await http("GET", "member", { cookie, ip })).json;
    const pts = Math.round(price * POINTS.perEuro);
    // El saldo sube lo del corte más, si toca, el bonus de la primera medalla (aparece como movimiento aparte).
    const bonus = me.moves.filter((m) => m.text === "Bonus de medallas").reduce((x, m) => x + m.pts, 0);
    assert.equal(me.balance - base, pts + bonus, "puntos por el precio normal, no por 0 €");
    assert.ok(me.moves.some((m) => m.pts === pts), "el corte aparece en los movimientos con sus puntos");
  });
});
