// «Cuánto gana Nova»: ingresos, ticket, ocupación, gastos heredados, beneficio neto y acceso solo del dueño.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import handler from "../api/handler.js";
import { pipe } from "../api/_lib/store.js";
import * as Sup from "../api/_lib/supply.js";
import * as T from "../api/_lib/time.js";
import { PROVIDERS } from "../api/_lib/config.js";
import * as E from "../api/_lib/earnings.js";

function http(method, route, { body, cookie, ip = "198.51.100.77" } = {}) {
  const hdrs = new Map();
  let status = 200,
    out = "";
  const req = { method, url: "/api/handler?route=" + route, headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "nova.test", ...(cookie ? { cookie } : {}) }, body };
  const res = { setHeader: (k, v) => hdrs.set(String(k).toLowerCase(), v), getHeader: (k) => hdrs.get(String(k).toLowerCase()), end: (b) => (out = b == null ? "" : String(b)) };
  Object.defineProperty(res, "statusCode", { get: () => status, set: (v) => (status = v) });
  return handler(req, res).then(() => ({ status, json: out ? JSON.parse(out) : null, cookies: [].concat(hdrs.get("set-cookie") || []) }));
}
async function login(provider) {
  const r = await http("POST", "staff/login", { body: { provider, pin: "1234" }, ip: "198.51.100." + (10 + Math.floor(Math.random() * 200)) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.cookies.find((c) => c.startsWith("nova_staff=")).split(";")[0];
}

const ENV = ["MODO_DEMO", "VERCEL", "STAFF_PIN", "STAFF_PIN_EHEDEY"];
const saved = {};
before(() => {
  for (const k of ENV) (saved[k] = process.env[k]), delete process.env[k];
  process.env.MODO_DEMO = "1";
});
after(() => {
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});

const cur = T.nowLocal().date.slice(0, 7);
const M = E.shiftMonth(cur, -1); // mes de prueba (cerrado)
const M0 = E.shiftMonth(M, -1); // el anterior
const workdays = (month) => {
  const out = [];
  for (let d = month + "-01"; d.startsWith(month); d = T.addDays(d, 1)) if ([2, 3, 4, 5].includes(T.weekday(d))) out.push(d);
  return out;
};
const days = workdays(M);
let n = 0;
async function seed(email, date, start, provider, svc, price, extra = {}) {
  const id = "E" + String(++n).padStart(5, "0");
  const b = {
    id, kind: "booking", service: { id: svc, name: svc, price, duration: 30 }, provider: { id: provider, name: provider }, date, start, end: T.toHHMM(T.toMin(start) + 30),
    status: "confirmed", attendance: "done", created: date + " 09:00", email, name: email.split("@")[0], by: "client", ...extra,
  };
  await pipe([["SET", "bk:" + id, JSON.stringify(b)], ["SADD", "ubk:" + email, id], ["SADD", "day:" + date, id]]);
  return b;
}
async function pay(b, amount) {
  const x = { id: "C" + b.id, provider: b.provider, items: [{ id: b.service.id, name: b.service.name, price: b.service.price }], amount, method: "efectivo", name: b.name, booking: b.id, date: b.date, time: b.end, by: b.provider.id };
  await pipe([["SET", "pay:" + x.id, JSON.stringify(x)], ["SADD", "payday:" + x.date, x.id], ["SADD", "paymonth:" + x.date.slice(0, 7), x.id]]);
}

describe("cuánto gana Nova", { concurrency: 1 }, () => {
  let owner, barber, caja;
  before(async () => {
    owner = await login("airam");
    barber = await login("ehedey");
    caja = await login("caja");
    // Un cliente que ya vino antes del mes de prueba (recurrente) y dos nuevos.
    const old = workdays(M0)[0];
    await seed("vieja@x.test", old, "10:00", "airam", "corte", 15);
    await seed("vieja@x.test", days[0], "10:00", "airam", "corte", 15);
    await seed("nuevo@x.test", days[1], "11:00", "airam", "corte", 15);
    const c = await seed("cobrada@x.test", days[2], "12:00", "ehedey", "corte-barba", 19);
    await pay(c, 25); // cobrada en caja con propina: cuenta 25, no 19
    await seed("falta@x.test", days[3], "13:00", "noa", "corte", 15, { attendance: "absent" });
    await Sup.apuntarVenta({ fecha: days[4] + " 12:00", canal: "estudio", prenda: "x", nombre: "Camiseta", talla: "M", cantidad: 2, importe: 40, por: "airam" });
  });

  test("ingresos, ticket, ocupación, clientes y otros ingresos del mes", async () => {
    const r = await http("GET", "staff/earnings&month=" + M, { cookie: owner });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const c = r.json.current;
    assert.equal(c.income.services, 55); // 15 + 15 + 25 (cobrada), sin el «No vino»
    assert.equal(c.services, 3);
    assert.equal(c.ticket, 18.33);
    assert.deepEqual(c.income.other.map((x) => [x.id, x.amount, x.count]), [["ropa", 40, 2]]);
    assert.equal(c.income.total, 95);
    assert.equal(c.bookedMin, 90);
    let cap = 0; // minutos de horario de cada barbero en el mes
    for (let d = M + "-01"; d.startsWith(M); d = T.addDays(d, 1)) for (const p of PROVIDERS) for (const [a, b] of p.hours[T.weekday(d)] || []) cap += T.toMin(b) - T.toMin(a);
    assert.equal(c.capMin, cap);
    assert.equal(c.occupancy, Math.round((90 / c.capMin) * 1000) / 10);
    const by = Object.fromEntries(c.byBarber.map((x) => [x.id, x.billed]));
    assert.equal(by.airam, 30);
    assert.equal(by.ehedey, 25);
    assert.deepEqual([c.clients.new, c.clients.returning], [2, 1]);
    assert.ok(Array.isArray(c.dormant.list));
    // El mes siguiente (el actual) se compara con este: sin ingresos, baja del todo.
    const next = await http("GET", "staff/earnings&month=" + cur, { cookie: owner });
    assert.equal(next.json.previous.income, 95);
    assert.equal(next.json.compare.income.pct, -100);
  });

  test("el mes sin gastos propios hereda los del anterior y guardar los hace propios", async () => {
    const g = (extra = {}) => ({ month: M0, fixed: { alquiler: "20", luz: "5,5" }, salaries: { ehedey: 10 }, extras: [{ name: "Limpieza", amount: 5 }], ...extra });
    const save = await http("POST", "staff/expenses", { cookie: owner, body: g() });
    assert.equal(save.status, 200, JSON.stringify(save.json));
    assert.equal(save.json.expenses.fixed.luz, 5.5);
    const inh = await http("GET", "staff/earnings&month=" + M, { cookie: owner });
    assert.equal(inh.json.inherited, true);
    assert.equal(inh.json.inheritedFrom, M0);
    assert.equal(inh.json.expenses.fixed.alquiler, 20);
    assert.equal(inh.json.expenses.extras[0].name, "Limpieza");
    // Guardar el propio mes: ya no hereda.
    await http("POST", "staff/expenses", { cookie: owner, body: g({ month: M, fixed: { alquiler: 20, luz: 5 }, pct: { ehedey: 40 } }) });
    const own = await http("GET", "staff/earnings&month=" + M, { cookie: owner });
    assert.equal(own.json.inherited, false);
    assert.equal(own.json.expenses.fixed.luz, 5);
  });

  test("beneficio neto = ingresos − gastos fijos − comisiones, y margen", async () => {
    const r = await http("GET", "staff/earnings&month=" + M, { cookie: owner });
    const net = r.json.net;
    assert.equal(net.costs, 40); // 25 fijos + 10 sueldo + 5 concepto libre
    assert.equal(net.commission, 10); // Ehedey: 25 facturados × 40 %
    assert.equal(net.net, 45); // 95 − 40 − 10
    assert.equal(net.margin, 47.4);
    // Otro % de comisión solo para este mes.
    await http("POST", "staff/expenses", { cookie: owner, body: { month: M, fixed: { alquiler: 20, luz: 5 }, salaries: { ehedey: 10 }, extras: [{ name: "Limpieza", amount: 5 }], pct: { ehedey: 50 } } });
    const r2 = await http("GET", "staff/earnings&month=" + M, { cookie: owner });
    assert.equal(r2.json.net.commission, 12.5);
    assert.equal(r2.json.net.net, 42.5);
  });

  test("la validación del servidor rechaza importes y conceptos incorrectos", async () => {
    const bad = async (body) => (await http("POST", "staff/expenses", { cookie: owner, body: { month: M, ...body } })).status;
    assert.equal(await bad({ fixed: { alquiler: -1 } }), 400);
    assert.equal(await bad({ fixed: { luz: "abc" } }), 400);
    assert.equal(await bad({ fixed: { luz: 1e9 } }), 400);
    assert.equal(await bad({ pct: { ehedey: 150 } }), 400);
    assert.equal(await bad({ extras: [{ name: "", amount: 3 }] }), 400);
    assert.equal(await bad({ extras: [{ name: "X", amount: -3 }] }), 400);
    assert.equal(await bad({ extras: Array.from({ length: 31 }, () => ({ name: "X", amount: 1 })) }), 400);
    assert.equal((await http("POST", "staff/expenses", { cookie: owner, body: { month: "2026-13" } })).status, 400);
    assert.equal((await http("GET", "staff/earnings&month=abc", { cookie: owner })).status, 400);
  });

  test("solo el dueño: barbero y caja reciben 403, sin sesión 401", async () => {
    for (const cookie of [barber]) {
      assert.equal((await http("GET", "staff/earnings", { cookie })).status, 403);
      assert.equal((await http("POST", "staff/expenses", { cookie, body: { month: M } })).status, 403);
    }
    // La caja no tiene sesión de panel: la API no la reconoce (401 o 403, nunca datos).
    const g = await http("GET", "staff/earnings", { cookie: caja });
    assert.ok([401, 403].includes(g.status));
    assert.equal(g.json?.current, undefined);
    assert.ok([401, 403].includes((await http("POST", "staff/expenses", { cookie: caja, body: { month: M } })).status));
    assert.equal((await http("GET", "staff/earnings")).status, 401);
  });

  test("el cálculo puro: diferencias y márgenes", () => {
    assert.deepEqual(E.diff(110, 100), { diff: 10, pct: 10 });
    assert.deepEqual(E.diff(5, 0), { diff: 5, pct: null });
    assert.equal(E.netOf({ total: 0, byBarber: {} }, E.emptyExpenses(), [], () => 0).margin, null);
  });
});
