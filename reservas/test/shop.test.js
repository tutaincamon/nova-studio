// Tienda NOVA Supply en la app: catálogo gestionado por el dueño, pedidos con stock
// apartado, pedido al reservar, pago en el local y simulado en demo, estados,
// descuento de socio, webhook de Stripe y suma en «Cuánto gana Nova» sin doble conteo.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import handler from "../api/handler.js";
import { cmd, getJSON, setJSON } from "../api/_lib/store.js";
import * as M from "../api/_lib/membership.js";
import * as Sup from "../api/_lib/supply.js";
import * as Shop from "../api/_lib/shop.js";
import * as T from "../api/_lib/time.js";
import * as Of from "../api/_lib/oferta.js";

function http(method, route, { body, raw, cookie, headers = {}, ip = "198.51.100.60" } = {}) {
  const hdrs = new Map();
  let status = 200,
    out = "";
  const req = { method, url: "/api/handler?route=" + route, headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "nova.test", ...(cookie ? { cookie } : {}), ...headers }, body: raw !== undefined ? raw : body ?? (method === "POST" ? {} : undefined) };
  const res = { setHeader: (k, v) => hdrs.set(String(k).toLowerCase(), v), getHeader: (k) => hdrs.get(String(k).toLowerCase()), end: (b) => (out = b == null ? "" : String(b)) };
  Object.defineProperty(res, "statusCode", { get: () => status, set: (v) => (status = v) });
  return handler(req, res).then(() => {
    let json = null;
    try {
      json = out ? JSON.parse(out) : null;
    } catch {}
    return { status, json, cookies: [].concat(hdrs.get("set-cookie") || []), headers: hdrs };
  });
}
let ipn = 0;
const nextIp = () => "198.51.102." + (++ipn % 250);

async function staffCookie(provider) {
  const r = await http("POST", "staff/login", { body: { provider, pin: "1234" }, ip: nextIp() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.cookies.find((c) => c.startsWith("nova_staff=")).split(";")[0];
}
async function client(email) {
  const ip = nextIp();
  const r = await http("POST", "auth/request", { body: { email }, ip });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cookie = r.cookies.find((c) => c.startsWith("nova_s=")).split(";")[0];
  assert.equal((await http("POST", "auth/name", { body: { name: "Cliente " + email.split("@")[0] }, cookie, ip })).status, 200);
  const u = await getJSON("user:" + email);
  await setJSON("user:" + email, { ...u, card: { brand: "visa", last4: "4242", exp: "12/30", pm: "pm_test" } });
  return { cookie, ip, email };
}
// La web (oferta.js) simulada: sin red y sin promo salvo que un test ponga `webOferta`.
let webOferta = null;
Of.usarFetch(async () => (webOferta === null ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, text: async () => webOferta }));
const ofertaTxt = (o = {}) => {
  const d = (ms) => new Date(Date.now() + ms).toISOString();
  const x = { nombre: "Black Friday", desde: d(-86400000), hasta: d(86400000), fechas: "Del 23 al 30 de noviembre", descuento: 30, prendas: ["camiseta", "camiseta-rosa"], destacada: "camiseta-rosa", ...o };
  return `/* oferta */\n(function (raiz) {\n  var OFERTA = {\n    nombre: '${x.nombre}', // x\n    desde: '${x.desde}',\n    hasta: '${x.hasta}',\n    fechas: '${x.fechas}',\n    descuento: ${x.descuento},\n    prendas: [${x.prendas.map((i) => `'${i}'`).join(", ")}],\n    destacada: '${x.destacada}'\n  };\n})(this);`;
};
const ponOferta = async (t) => ((webOferta = t), await Of.borrarCache());
const ENV = ["MODO_DEMO", "SUPPLY_OFERTA_URL", "VERCEL", "STAFF_PIN", "STAFF_PIN_EHEDEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY"];
const saved = {};
let owner, barber, caja;
before(async () => {
  for (const k of ENV) (saved[k] = process.env[k]), delete process.env[k];
  process.env.MODO_DEMO = "1";
  owner = await staffCookie("airam");
  barber = await staffCookie("ehedey");
  const r = await http("POST", "staff/login", { body: { provider: "caja", pin: "1234" }, ip: nextIp() });
  caja = r.cookies.find((c) => c.startsWith("nova_staff=")).split(";")[0];
});
after(() => {
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});

const today = () => T.nowLocal().date;
function workday(ahead) {
  for (let i = ahead; i < ahead + 14; i++) {
    const d = T.addDays(today(), i);
    if ([2, 3, 4, 5].includes(T.weekday(d))) return d;
  }
}
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const prenda = (body, cookie = owner) => http("POST", "staff/ropa/prenda", { body, cookie });
const shop = (c) => http("GET", "shop", { cookie: c?.cookie });
const order = (c, items, extra = {}) => http("POST", "shop/orders", { body: { items, ...extra }, cookie: c?.cookie, ip: c?.ip });
const libres = async (id, talla) => (await Sup.leer({ ventas: 1 })).prendas.find((p) => p.id === id).tallas.find((t) => t.talla === talla);
const estadoOf = async (id) => (await Shop.get(id)).estado;
const month = () => today().slice(0, 7);
const earnings = async () => (await http("GET", "staff/earnings&month=" + month(), { cookie: owner })).json.current.income;

describe("catálogo de NOVA Supply (solo el dueño)", { concurrency: 1 }, () => {
  test("sin dueño no se crea, edita ni borra nada", async () => {
    const body = { nombre: "Gorra", precio: "25", estado: "disponible", tallas: ["M"], stock: { M: 3 } };
    assert.equal((await prenda(body, "")).status, 401);
    assert.equal((await prenda(body, barber)).status, 403);
    assert.equal((await prenda(body, caja)).status, 401);
    assert.equal((await http("POST", "staff/ropa/prenda/borrar", { body: { id: "camiseta-rosa" }, cookie: barber })).status, 403);
    assert.equal((await http("POST", "staff/ropa/prenda/borrar", { body: { id: "camiseta-rosa" } })).status, 401);
  });

  test("el catálogo de partida lleva el precio de la web (47,50 €), no uno inventado por la app", async () => {
    assert.ok(Sup.SEED.filter((p) => p.color).every((p) => p.precio === 47.5));
    const r = await shop();
    assert.equal(r.status, 200);
    const c = r.json.prendas.find((p) => p.id === "camiseta-rosa");
    assert.equal(c.precio, 47.5);
    assert.equal(c.precioOferta, null);
    assert.equal(r.json.oferta, null);
    assert.equal(r.json.demo, true);
    assert.equal(r.json.online, "demo");
  });

  test("el dueño crea, edita (foto, descripción, stock) y la tienda lo enseña", async () => {
    const c = await prenda({ nombre: "Gorra", variante: "Negra", descripcion: "Gorra de algodón con el emblema.", precio: "25,50", estado: "disponible", tallas: ["M", "L"], stock: { M: "3", L: "" }, photo: PNG });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const id = c.json.prenda.id;
    assert.equal(id, "gorra-negra");
    const list = (await shop()).json.prendas.find((p) => p.id === id);
    assert.equal(list.precio, 25.5);
    assert.equal(list.descripcion, "Gorra de algodón con el emblema.");
    assert.deepEqual(list.tallas, [{ talla: "M", max: 3 }, { talla: "L", max: Shop.MAX_QTY }]);
    assert.ok(list.img);
    const pic = await http("GET", `supply/${id}/photo`);
    assert.equal(pic.status, 200);
    // Editar: otro precio; la foto y la descripción se conservan.
    const e = await prenda({ id, nombre: "Gorra", variante: "Negra", precio: "30", estado: "disponible", tallas: ["M"], stock: { M: "5" } });
    assert.equal(e.status, 200);
    const again = (await shop()).json.prendas.find((p) => p.id === id);
    assert.equal(again.precio, 30);
    assert.equal(again.descripcion, "Gorra de algodón con el emblema.");
    assert.ok(again.img);
    assert.deepEqual(again.tallas, [{ talla: "M", max: 5 }]);
  });

  test("activo/inactivo: oculta la prenda a los clientes y borrar la quita del todo", async () => {
    const id = "gorra-negra";
    const hide = await prenda({ id, nombre: "Gorra", variante: "Negra", precio: "30", estado: "oculto", tallas: ["M"], stock: { M: "5" } });
    assert.equal(hide.status, 200);
    assert.ok(!(await shop()).json.prendas.some((p) => p.id === id));
    const bad = await prenda({ nombre: "", estado: "disponible", tallas: ["M"] });
    assert.equal(bad.status, 400);
    assert.equal((await prenda({ nombre: "X", precio: "-4", estado: "disponible", tallas: ["M"] })).status, 400);
    const del = await http("POST", "staff/ropa/prenda/borrar", { body: { id }, cookie: owner });
    assert.equal(del.status, 200);
    const r = await Sup.leer({ ventas: 1 });
    assert.ok(!r.prendas.some((p) => p.id === id));
    assert.equal((await http("GET", `supply/${id}/photo`)).status, 404);
    assert.equal((await http("POST", "staff/ropa/prenda/borrar", { body: { id }, cookie: owner })).status, 404);
  });
});

describe("pedidos y stock", { concurrency: 1 }, () => {
  let ana;
  before(async () => {
    ana = await client("ana-shop@example.com");
    // Camiseta rosa: 2 unidades en L, 1 en XL, XXL sin cuenta.
    const r = await prenda({ id: "camiseta-rosa", nombre: "Camiseta", variante: "Rosa", color: "rosa", precio: "40", estado: "disponible", tallas: ["L", "XL", "XXL"], stock: { L: "2", XL: "1", XXL: "" } });
    assert.equal(r.status, 200);
  });

  test("hay que entrar para pedir", async () => {
    assert.equal((await order(null, [{ prenda: "camiseta-rosa", talla: "L", cantidad: 1 }])).status, 401);
    assert.equal((await http("GET", "shop/orders")).status, 401);
  });

  test("con stock suficiente: el pedido aparta las unidades", async () => {
    const r = await order(ana, [{ prenda: "camiseta-rosa", talla: "L", cantidad: 2 }]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.order.estado, "pendiente");
    assert.equal(r.json.order.total, 80);
    assert.equal(r.json.order.pay, "local");
    const t = await libres("camiseta-rosa", "L");
    assert.equal(t.stock, 2, "el stock no baja hasta cobrar");
    assert.equal(t.apartadas, 2);
    assert.equal(t.libres, 0);
    assert.equal((await shop(ana)).json.prendas.find((p) => p.id === "camiseta-rosa").tallas.find((x) => x.talla === "L").max, 0);
  });

  test("con stock insuficiente: 409 y no queda nada apartado", async () => {
    const r = await order(ana, [{ prenda: "camiseta-rosa", talla: "XL", cantidad: 1 }, { prenda: "camiseta-rosa", talla: "L", cantidad: 1 }]);
    assert.equal(r.status, 409);
    assert.match(r.json.error, /agotado|quedan/);
    assert.equal((await libres("camiseta-rosa", "XL")).apartadas, 0, "la talla que sí había se suelta");
    assert.equal((await libres("camiseta-rosa", "L")).apartadas, 2);
    assert.equal((await order(ana, [{ prenda: "camiseta-rosa", talla: "XL", cantidad: 2 }])).status, 409);
  });

  test("datos mal puestos: talla, cantidad y prenda inexistente", async () => {
    assert.equal((await order(ana, [])).status, 400);
    assert.equal((await order(ana, [{ prenda: "nada", talla: "L", cantidad: 1 }])).status, 400);
    assert.equal((await order(ana, [{ prenda: "camiseta-rosa", talla: "S", cantidad: 1 }])).status, 400);
    assert.equal((await order(ana, [{ prenda: "camiseta-rosa", talla: "XXL", cantidad: 0 }])).status, 400);
    assert.equal((await order(ana, [{ prenda: "camiseta-rosa", talla: "XXL", cantidad: 99 }])).status, 400);
    // Sin cuenta de unidades se puede pedir sin límite (hasta el tope por línea).
    const ok = await order(ana, [{ prenda: "camiseta-rosa", talla: "XXL", cantidad: 5 }]);
    assert.equal(ok.status, 200);
    await http("POST", `shop/orders/${ok.json.order.id}/cancel`, { cookie: ana.cookie, ip: ana.ip });
  });

  test("cancelar el pedido libera las unidades; otro cliente no puede tocarlo", async () => {
    const mine = (await http("GET", "shop/orders", { cookie: ana.cookie, ip: ana.ip })).json.orders;
    const first = mine.find((o) => o.estado === "pendiente" && o.items[0].talla === "L");
    const other = await client("otro-shop@example.com");
    assert.equal((await http("POST", `shop/orders/${first.id}/cancel`, { cookie: other.cookie, ip: other.ip })).status, 404);
    const c = await http("POST", `shop/orders/${first.id}/cancel`, { cookie: ana.cookie, ip: ana.ip });
    assert.equal(c.status, 200);
    assert.equal(c.json.order.estado, "cancelado");
    const t = await libres("camiseta-rosa", "L");
    assert.equal(t.apartadas, 0);
    assert.equal(t.libres, 2);
    assert.equal((await http("POST", `shop/orders/${first.id}/cancel`, { cookie: ana.cookie, ip: ana.ip })).status, 400);
  });

  test("dos pedidos a la vez por la última unidad: solo uno la consigue", async () => {
    const [a, b] = await Promise.all([order(ana, [{ prenda: "camiseta-rosa", talla: "XL", cantidad: 1 }]), order(ana, [{ prenda: "camiseta-rosa", talla: "XL", cantidad: 1 }])]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const t = await libres("camiseta-rosa", "XL");
    assert.equal(t.apartadas, 1);
    const won = [a, b].find((x) => x.status === 200);
    await http("POST", `shop/orders/${won.json.order.id}/cancel`, { cookie: ana.cookie, ip: ana.ip });
  });
});

describe("pedido al reservar la cita", { concurrency: 1 }, () => {
  test("«Añade algo para recoger»: queda ligado a la cita y se suelta si la cita se cancela", async () => {
    const c = await client("cita-shop@example.com");
    const date = workday(3);
    const before = (await libres("camiseta-rosa", "L")).apartadas;
    const r = await http("POST", "book", { body: { service: "corte", provider: "airam", date, start: "10:00", terms: true, merch: [{ prenda: "camiseta-rosa", talla: "L", cantidad: 1 }] }, cookie: c.cookie, ip: c.ip });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.merch.estado, "pendiente");
    assert.equal(r.json.merch.entrega, "cita");
    assert.equal(r.json.merch.booking, r.json.id);
    assert.equal((await libres("camiseta-rosa", "L")).apartadas, before + 1);
    const mine = (await http("GET", "shop/orders", { cookie: c.cookie, ip: c.ip })).json.orders;
    assert.equal(mine[0].booking, r.json.id);
    const cancel = await http("POST", `bookings/${r.json.id}/cancel`, { body: {}, cookie: c.cookie, ip: c.ip });
    assert.equal(cancel.status, 200);
    assert.equal(await estadoOf(r.json.merch.id), "cancelado");
    assert.equal((await libres("camiseta-rosa", "L")).apartadas, before);
  });

  test("si no hay unidades, la cita NO se reserva y no queda nada apartado", async () => {
    const c = await client("cita-shop2@example.com");
    const date = workday(4);
    const r = await http("POST", "book", { body: { service: "corte", provider: "airam", date, start: "11:00", terms: true, merch: [{ prenda: "camiseta-rosa", talla: "L", cantidad: 9 }] }, cookie: c.cookie, ip: c.ip });
    assert.equal(r.status, 409);
    const list = (await http("GET", "bookings", { cookie: c.cookie, ip: c.ip })).json;
    assert.equal(list.upcoming.length, 0);
    // y sin merch, la reserva de siempre sigue igual
    const plain = await http("POST", "book", { body: { service: "corte", provider: "airam", date, start: "11:00", terms: true }, cookie: c.cookie, ip: c.ip });
    assert.equal(plain.status, 200);
    assert.equal(plain.json.merch, undefined);
  });
});

describe("cobro, estados y ganancias", { concurrency: 1 }, () => {
  let bea, o1;
  before(async () => {
    bea = await client("bea-shop@example.com");
    await prenda({ id: "camiseta-rosa", nombre: "Camiseta", variante: "Rosa", color: "rosa", precio: "40", estado: "disponible", tallas: ["L", "XL", "XXL"], stock: { L: "5", XL: "5", XXL: "" } });
  });
  const sh = (id, estado, cookie) => http("POST", `staff/shop/${id}/estado`, { body: { estado }, cookie });
  const club = async (email) => (await http("GET", "staff/member&q=" + encodeURIComponent(email), { cookie: owner })).json.member;

  test("pago en el local: pendiente → cobrado en el local entra en la caja y suma puntos", async () => {
    const inc0 = await earnings();
    const ropa0 = inc0.other.find((x) => x.id === "ropa")?.amount || 0;
    const merch0 = inc0.other.find((x) => x.id === "merch")?.amount || 0;
    const pts0 = (await club(bea.email)).earned;
    const r = await order(bea, [{ prenda: "camiseta-rosa", talla: "L", cantidad: 2 }]);
    assert.equal(r.status, 200);
    o1 = r.json.order.id;
    // Antes de cobrar no suma nada.
    assert.equal((await earnings()).total, inc0.total);
    // El panel lo ve (caja incluida); un cliente no.
    const list = await http("GET", "staff/shop", { cookie: caja });
    assert.equal(list.status, 200);
    assert.ok(list.json.orders.some((o) => o.id === o1 && o.estado === "pendiente"));
    assert.equal((await http("GET", "staff/shop", { cookie: bea.cookie })).status, 401);
    const c = await http("POST", `staff/shop/${o1}/cobrar`, { body: {}, cookie: caja });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(c.json.order.estado, "pagado");
    assert.equal(c.json.puntos, 80 * 1 * (await http("GET", "catalog")).json.points.perEuro);
    // Stock: baja de verdad y ya no está apartado.
    const t = await libres("camiseta-rosa", "L");
    assert.equal(t.stock, 3);
    assert.equal(t.apartadas, 0);
    // Misma lista de ventas que la caja, con el pedido.
    const ropa = await http("GET", "staff/ropa", { cookie: owner });
    const v = ropa.json.ventas.find((x) => x.pedido === o1);
    assert.ok(v);
    assert.equal(v.canal, "app");
    assert.equal(v.importe, 80);
    assert.ok((await club(bea.email)).earned - pts0 >= c.json.puntos, "los puntos de la compra (y medallas, si tocan) llegan al Club");
    // Ganancias: línea «Merch NOVA Supply» +80 y la de ropa de caja, igual.
    const inc = await earnings();
    assert.equal(inc.other.find((x) => x.id === "merch").label, "Merch NOVA Supply");
    assert.equal(Math.round((inc.other.find((x) => x.id === "merch").amount - merch0) * 100) / 100, 80);
    assert.equal(inc.other.find((x) => x.id === "ropa")?.amount || 0, ropa0, "no se cuenta también como ropa de caja");
    assert.equal(Math.round((inc.total - inc0.total) * 100) / 100, 80, "el total sube lo cobrado, una sola vez");
    // Cobrar otra vez no duplica nada.
    assert.equal((await http("POST", `staff/shop/${o1}/cobrar`, { body: {}, cookie: caja })).status, 400);
    assert.equal(Math.round(((await earnings()).total - inc0.total) * 100) / 100, 80);
  });

  test("una venta de caja normal sigue en «ropa» y no en «merch»", async () => {
    const before = await earnings();
    const v = await http("POST", "staff/ropa/venta", { body: { prenda: "camiseta-rosa", talla: "XL", cantidad: 1, importe: "40" }, cookie: caja });
    assert.equal(v.status, 200, JSON.stringify(v.json));
    const after = await earnings();
    const d = (id) => Math.round(((after.other.find((x) => x.id === id)?.amount || 0) - (before.other.find((x) => x.id === id)?.amount || 0)) * 100) / 100;
    assert.equal(d("ropa"), 40);
    assert.equal(d("merch"), 0);
    // La venta de un pedido no se deshace desde la lista de ventas.
    const ropa = (await http("GET", "staff/ropa", { cookie: owner })).json;
    const pedidoVenta = ropa.ventas.find((x) => x.pedido === o1);
    assert.equal((await http("POST", `staff/ropa/venta/${pedidoVenta.id}/deshacer`, { body: {}, cookie: owner })).status, 400);
    await http("POST", `staff/ropa/venta/${v.json.venta.id}/deshacer`, { body: {}, cookie: owner });
  });

  test("estados: pagado → listo → entregado; nadie salta ni vuelve atrás", async () => {
    assert.equal((await sh(o1, "listo", caja)).json.order.estado, "listo");
    assert.equal((await sh(o1, "entregado", caja)).json.order.estado, "entregado");
    assert.equal((await sh(o1, "cancelado", owner)).status, 400, "un pedido entregado no se cancela");
    assert.equal((await sh(o1, "listo", owner)).status, 400);
    assert.equal((await sh(o1, "inventado", owner)).status, 400);
    assert.equal((await http("POST", `staff/shop/${o1}/estado`, { body: { estado: "listo" } })).status, 401);
    // Entregado sigue contando una sola vez.
    const merch = (await earnings()).other.find((x) => x.id === "merch");
    assert.ok(merch.amount >= 80);
  });

  test("entregar un pedido sin cobrar en el local lo cobra a la vez (una venta)", async () => {
    const r = await order(bea, [{ prenda: "camiseta-rosa", talla: "XL", cantidad: 1 }]);
    const id = r.json.order.id;
    const before = await earnings();
    const d = await sh(id, "entregado", barber);
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.equal(d.json.order.estado, "entregado");
    assert.equal(d.json.order.ventas.length, 1);
    assert.equal(Math.round(((await earnings()).total - before.total) * 100) / 100, 40);
  });

  test("cancelar un pedido cobrado: solo el dueño; deshace venta, stock, puntos y ganancias", async () => {
    const r = await order(bea, [{ prenda: "camiseta-rosa", talla: "L", cantidad: 1 }]);
    const id = r.json.order.id;
    const before = await earnings();
    const stock0 = (await libres("camiseta-rosa", "L")).stock;
    const pts0 = (await club(bea.email)).earned;
    await http("POST", `staff/shop/${id}/cobrar`, { body: { importe: "35" }, cookie: caja });
    assert.equal((await libres("camiseta-rosa", "L")).stock, stock0 - 1);
    assert.equal(Math.round(((await earnings()).total - before.total) * 100) / 100, 35, "se cuenta lo realmente cobrado");
    assert.equal((await sh(id, "cancelado", barber)).status, 403);
    const c = await sh(id, "cancelado", owner);
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(c.json.order.estado, "cancelado");
    assert.equal((await libres("camiseta-rosa", "L")).stock, stock0);
    assert.equal((await club(bea.email)).earned, pts0);
    assert.equal(Math.round(((await earnings()).total - before.total) * 100) / 100, 0);
  });

  test("pago online simulado en demo (sin Stripe): se cobra al momento, sin dinero real", async () => {
    const before = await earnings();
    const r = await order(bea, [{ prenda: "camiseta-rosa", talla: "XXL", cantidad: 1 }], { pay: "online" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.demo, true);
    assert.equal(r.json.order.estado, "pagado");
    assert.equal(r.json.url, undefined);
    assert.equal(Math.round(((await earnings()).total - before.total) * 100) / 100, 40);
  });
});

describe("descuento de socio NOVA+", { concurrency: 1 }, () => {
  test("el socio paga el precio con su descuento (ropa)", async () => {
    const c = await client("socio-shop@example.com");
    const j = await http("POST", "membership/join", { body: { plan: "club-nova" }, cookie: c.cookie, ip: c.ip });
    assert.equal(j.status, 200, JSON.stringify(j.json));
    const pct = (await http("GET", "membership", { cookie: c.cookie, ip: c.ip })).json.mine.plan.discountPct;
    assert.ok(pct > 0);
    const list = (await shop(c)).json;
    assert.equal(list.discountPct, pct);
    const item = list.prendas.find((p) => p.id === "camiseta-rosa");
    assert.equal(item.precioSocio, Math.round(40 * (1 - pct / 100) * 100) / 100);
    const r = await order(c, [{ prenda: "camiseta-rosa", talla: "XXL", cantidad: 2 }]);
    assert.equal(r.json.order.total, Math.round(2 * 40 * (1 - pct / 100) * 100) / 100);
    assert.equal(r.json.order.subtotal, 80);
    assert.equal(r.json.order.discountPct, pct);
    await http("POST", `shop/orders/${r.json.order.id}/cancel`, { cookie: c.cookie, ip: c.ip });
  });
});

describe("pago online con Stripe (webhook)", { concurrency: 1 }, () => {
  const SECRET = "whsec_test_" + "y".repeat(16);
  const post = (ev) => {
    const text = JSON.stringify(ev);
    return http("POST", "stripe/webhook", { raw: text, headers: { "stripe-signature": M.signPayload(text, SECRET) }, ip: nextIp() });
  };
  const evt = (type, object) => ({ id: "evt_" + Math.random().toString(36).slice(2), type, data: { object } });
  let u;
  before(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    u = await client("stripe-shop@example.com");
  });
  // Un pedido a pagar con Stripe, sin llamar a Stripe de verdad.
  async function pending(talla = "XXL", cantidad = 1) {
    const r = await Sup.leer({ ventas: 1 });
    const pre = Shop.prepare(r.prendas, [{ prenda: "camiseta-rosa", talla, cantidad }], 0);
    const o = await Shop.create({ user: await getJSON("user:" + u.email), ...pre, pay: "stripe" });
    return Shop.attachBooking({ ...o, stripe: { session: "cs_test_" + o.id, url: "https://checkout.stripe.test/x", until: new Date(Date.now() + 1800000).toISOString() } }, "").then(async (x) => {
      await setJSON("sord:" + o.id, { ...x, booking: "", entrega: "local" });
      return Shop.get(o.id);
    });
  }
  const session = (o, extra = {}) => ({ id: o.stripe.session, mode: "payment", payment_status: "paid", amount_total: Math.round(o.total * 100), payment_intent: "pi_test_1", client_reference_id: o.id, metadata: { supply_order: o.id }, ...extra });

  test("sin firma o con importe distinto no se cobra nada", async () => {
    const o = await pending();
    const bad = await http("POST", "stripe/webhook", { raw: JSON.stringify(evt("checkout.session.completed", session(o))), headers: { "stripe-signature": "t=1,v1=aa" }, ip: nextIp() });
    assert.equal(bad.status, 400);
    const wrong = await post(evt("checkout.session.completed", session(o, { amount_total: 100 })));
    assert.equal(wrong.json.did, "pedido:importe-distinto");
    assert.equal(await estadoOf(o.id), "pendiente");
    await Shop.cancel(o.id);
  });

  test("pago completado: pedido pagado, una sola venta aunque el evento se repita", async () => {
    const o = await pending();
    const before = await earnings();
    const e = evt("checkout.session.completed", session(o));
    assert.equal((await post(e)).json.did, "pedido:pagado");
    assert.equal(await estadoOf(o.id), "pagado");
    assert.equal((await post(e)).json.did, "repetido");
    // Otro evento para el mismo pedido (reintento con otro id): tampoco duplica.
    await post(evt("checkout.session.completed", session(o)));
    assert.equal((await Shop.get(o.id)).ventas.length, 1);
    assert.equal(Math.round(((await earnings()).total - before.total) * 100) / 100, 40);
    // Los puntos del Club llegan al abrir el panel (el webhook no tiene al socio a mano).
    await http("GET", "staff/shop", { cookie: owner });
    assert.ok((await Shop.get(o.id)).club);
  });

  test("pago caducado: se cancela y las unidades vuelven a estar libres", async () => {
    const o = await pending("L", 2);
    const apart = (await libres("camiseta-rosa", "L")).apartadas;
    assert.ok(apart >= 2);
    assert.equal((await post(evt("checkout.session.expired", { id: o.stripe.session, metadata: { supply_order: o.id } }))).json.did, "pedido:caducado");
    assert.equal(await estadoOf(o.id), "cancelado");
    assert.equal((await libres("camiseta-rosa", "L")).apartadas, apart - 2);
  });

  test("un pedido de Stripe no se cobra «en el local» por error al cambiar de estado", async () => {
    const o = await pending();
    assert.equal((await http("POST", `staff/shop/${o.id}/estado`, { body: { estado: "entregado" }, cookie: caja })).status, 400);
    assert.equal(await estadoOf(o.id), "pendiente");
    // El dueño sí puede cobrarlo en el local explícitamente (el cliente pagó en mostrador).
    assert.equal((await http("POST", `staff/shop/${o.id}/cobrar`, { body: {}, cookie: owner })).status, 200);
    await Shop.cancel(o.id, { dropClub: async () => {} });
  });

  test("el cron suelta los pedidos de pago sin completar y los de una cita cancelada", async () => {
    const old = await pending();
    await setJSON("sord:" + old.id, { ...old, stripe: { ...old.stripe, until: new Date(Date.now() - 3600000).toISOString() } });
    const r = await Shop.maintain({ bookingState: async () => null, club: async () => null });
    assert.ok(r.released >= 1);
    assert.equal(await estadoOf(old.id), "cancelado");
  });
});

describe("precios enlazados a novasupply.es (promo de la web)", { concurrency: 1 }, () => {
  before(async () => {
    await prenda({ id: "camiseta-rosa", nombre: "Camiseta", variante: "Rosa", color: "rosa", precio: "47,50", estado: "disponible", tallas: ["L", "XL", "XXL"], stock: { L: 20, XL: 20, XXL: 20 } });
    await prenda({ id: "camiseta", nombre: "Camiseta", variante: "Gris", color: "gris", precio: "47,50", estado: "disponible", tallas: ["L"], stock: { L: 5 } });
    await prenda({ nombre: "Gorra", variante: "Azul", precio: "20", estado: "disponible", tallas: ["M"], stock: { M: 9 } });
  });
  after(() => ponOferta(null));
  const rosa = async (c) => (await shop(c)).json.prendas.find((p) => p.id === "camiseta-rosa");

  test("sin promo: precio base del catálogo compartido", async () => {
    await ponOferta(null);
    const j = (await shop()).json;
    assert.equal(j.oferta, null);
    const p = await rosa();
    assert.deepEqual([p.precio, p.precioOferta, p.precioFinal, p.aplicado], [47.5, null, 47.5, ""]);
  });

  test("con la promo activa: base tachado + rebajado + nombre y fechas, solo en las prendas de la oferta", async () => {
    await ponOferta(ofertaTxt());
    const j = (await shop()).json;
    assert.deepEqual({ ...j.oferta, desde: "", hasta: "" }, { nombre: "Black Friday", fechas: "Del 23 al 30 de noviembre", desde: "", hasta: "", descuento: 30, activa: true, prendas: ["camiseta", "camiseta-rosa"] });
    const p = j.prendas.find((x) => x.id === "camiseta-rosa");
    assert.deepEqual([p.precio, p.precioOferta, p.precioFinal, p.aplicado], [47.5, 33.25, 33.25, "promo"]);
    const g = j.prendas.find((x) => x.id === "gorra-azul");
    assert.deepEqual([g.precio, g.precioOferta, g.precioFinal], [20, null, 20]);
  });

  test("el pedido guarda el precio rebajado y no cambia si la promo termina después", async () => {
    await ponOferta(ofertaTxt());
    const c = await client("promo-1@example.com");
    const r = await order(c, [{ prenda: "camiseta-rosa", talla: "XL", cantidad: 2 }, { prenda: "gorra-azul", talla: "M", cantidad: 1 }]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const o = r.json.order;
    assert.equal(o.subtotal, 115);
    assert.equal(o.total, 86.5); // 2 × 33,25 + 20
    assert.deepEqual(o.items.map((l) => [l.unit, l.aplicado]), [[33.25, "promo"], [20, ""]]);
    assert.equal(o.oferta.nombre, "Black Friday");
    assert.equal(o.discountPct, 0);
    await ponOferta(ofertaTxt({ desde: "2020-01-01T00:00:00Z", hasta: "2020-02-01T00:00:00Z" })); // ya terminada
    assert.equal((await Shop.get(o.id)).total, 86.5);
    assert.equal((await rosa()).precioFinal, 47.5);
    await http("POST", `shop/orders/${o.id}/cancel`, { cookie: c.cookie, ip: c.ip });
  });

  test("sin promo: el pedido es a precio normal", async () => {
    await ponOferta(null);
    const c = await client("promo-2@example.com");
    const r = await order(c, [{ prenda: "camiseta-rosa", talla: "L", cantidad: 1 }]);
    assert.equal(r.json.order.total, 47.5);
    assert.equal(r.json.order.oferta, undefined);
    await http("POST", `shop/orders/${r.json.order.id}/cancel`, { cookie: c.cookie, ip: c.ip });
  });

  test("socio NOVA+ y promo NO se acumulan: se aplica el mejor de los dos", async () => {
    const c = await client("promo-socio@example.com");
    assert.equal((await http("POST", "membership/join", { body: { plan: "club-nova" }, cookie: c.cookie, ip: c.ip })).status, 200);
    const pct = (await http("GET", "membership", { cookie: c.cookie, ip: c.ip })).json.mine.plan.discountPct;
    // Promo mejor que el socio (pct + 20 %): paga solo la promo.
    const mejor = Math.min(90, pct + 20);
    await ponOferta(ofertaTxt({ descuento: mejor }));
    let p = await rosa(c);
    assert.equal(p.aplicado, "promo");
    assert.equal(p.precioFinal, Math.round(47.5 * (100 - mejor)) / 100);
    let r = await order(c, [{ prenda: "camiseta-rosa", talla: "L", cantidad: 1 }]);
    assert.equal(r.json.order.total, p.precioFinal);
    assert.equal(r.json.order.discountPct, 0);
    await http("POST", `shop/orders/${r.json.order.id}/cancel`, { cookie: c.cookie, ip: c.ip });
    // Socio mejor que la promo (5 %): paga el del socio, nunca los dos juntos.
    await ponOferta(ofertaTxt({ descuento: 5 }));
    p = await rosa(c);
    assert.equal(p.aplicado, "socio");
    assert.equal(p.precioFinal, Math.round(47.5 * (1 - pct / 100) * 100) / 100);
    r = await order(c, [{ prenda: "camiseta-rosa", talla: "L", cantidad: 1 }]);
    assert.equal(r.json.order.total, p.precioFinal);
    assert.equal(r.json.order.discountPct, pct);
    assert.equal(r.json.order.oferta, undefined);
    await http("POST", `shop/orders/${r.json.order.id}/cancel`, { cookie: c.cookie, ip: c.ip });
  });

  test("si la web no responde se usa la última promo buena; sin ninguna, precio normal", async () => {
    await ponOferta(ofertaTxt());
    assert.equal((await rosa()).aplicado, "promo");
    webOferta = null; // la web «se cae» (404)
    await cmd("DEL", "supply:oferta:cache"); // caduca la caché de 10 minutos
    const caida = await Of.leerOferta({ forzar: true });
    assert.equal(caida.fuente, "respaldo");
    assert.equal((await rosa()).aplicado, "promo");
    await Of.borrarCache(); // y sin respaldo
    assert.equal((await rosa()).aplicado, "");
  });

  test("el panel enseña de dónde sale el precio y la promo (solo lectura)", async () => {
    await ponOferta(ofertaTxt());
    const r = await http("GET", "staff/ropa", { cookie: caja });
    assert.equal(r.status, 200);
    assert.equal(r.json.oferta.hay, true);
    assert.equal(r.json.oferta.activa, true);
    assert.equal(r.json.oferta.fuente, "web");
    assert.ok(r.json.oferta.leida);
    assert.equal(r.json.prendas.find((p) => p.id === "camiseta-rosa").precioOferta, 33.25);
    // La promo no se edita desde la app.
    for (const route of ["staff/oferta", "staff/ropa/oferta"]) assert.notEqual((await http("POST", route, { body: { descuento: 1 }, cookie: owner })).status, 200);
    assert.equal((await rosa()).precioOferta, 33.25);
  });
});
