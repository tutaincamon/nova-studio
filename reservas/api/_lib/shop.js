// ─────────────────────────────────────────────────────────────────────────────
// Pedidos de NOVA Supply hechos desde la app («recoger en el local»).
//
// NO hay un segundo inventario: se usa el de supply.js (catálogo, stock y ventas
// compartidos con la tienda web). Un pedido:
//   · al hacerlo APARTA las unidades (supply:apartadas, igual que las reservas
//     de la web): libres = stock − apartadas, así nadie las vende dos veces;
//   · al cobrarse (en el local, con Stripe o simulado en demo) baja el stock,
//     deja de estar apartado y apunta una venta en supply:ventas con `pedido`
//     (canal «app»): es la MISMA lista de ventas de la caja, por eso las
//     ganancias no cuentan nada dos veces (ver INCOME_SOURCES en handler.js);
//   · si se cancela o caduca el pago, las unidades vuelven a estar libres.
//
// Claves de esta app (con prefijo): sord:<id> (pedido), sordall (todos),
// usord:<correo> (los de un cliente), sordbk:<cita> (los de una cita).
//
// Estados: pendiente (sin cobrar) → pagado → listo (para recoger) → entregado,
// y cancelado (desde pendiente; desde pagado/listo lo hace el dueño y se
// deshace la venta). Entregado ya no se toca.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { cmd, pipe, getJSON, setJSON, sharedPipe } from "./store.js";
import * as Sup from "./supply.js";
import * as Card from "./stripe.js";
import * as T from "./time.js";
import * as Of from "./oferta.js";

export const ESTADOS = ["pendiente", "pagado", "listo", "entregado", "cancelado"];
export const ABIERTOS = ["pendiente", "pagado", "listo"];
export const MAX_QTY = 10; // unidades por línea
export const MAX_LINES = 8;
export const STRIPE_MINUTES = 35; // Stripe exige al menos 30 minutos de vida a la sesión
export const LOCAL_DAYS = 7; // un pedido «pagar en el local» sin cita se libera pasados estos días

export class ShopError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (status, msg) => {
  throw new ShopError(status, msg);
};
const r2 = (n) => Math.round(n * 100) / 100;
const key = (id) => "sord:" + id;

// ── Precio ──────────────────────────────────────────────────────────────────
// UNA SOLA FUENTE: el precio base es el de supply:catalogo (el mismo que lee la
// web) y la promo es la de novasupply.es (oferta.js, ver oferta.js). El descuento
// de socio NOVA+ NO se acumula con la promo: se aplica el MEJOR de los dos.
// `ctx` = { oferta, now } (la oferta ya leída; sin ella, no hay promo).
// Precio de una unidad con el descuento de socio NOVA+ (si lo tiene).
export const unitPrice = (precio, discountPct = 0) => r2(Number(precio) * (1 - (Number(discountPct) || 0) / 100));

// → { base, promo, socio, unit, aplicado: "promo" | "socio" | "" }
export function priceOf(p, discountPct = 0, ctx = {}) {
  const base = Number(p.precio);
  const promo = Of.aplica(ctx.oferta, p.id, ctx.now) ? Of.rebajado(ctx.oferta, base) : null;
  const socio = discountPct ? unitPrice(base, discountPct) : null;
  let unit = base,
    aplicado = "";
  if (promo != null && promo < unit) (unit = promo), (aplicado = "promo");
  if (socio != null && socio < unit) (unit = socio), (aplicado = "socio");
  return { base, promo, socio, unit, aplicado };
}

// Lo que se enseña de una prenda a los clientes (sin stock exacto: solo cuántas pueden pedir).
export function publicItem(p, discountPct = 0, ctx = {}) {
  const x = priceOf(p, discountPct, ctx);
  return {
    id: p.id,
    nombre: p.nombre,
    variante: p.variante || "",
    descripcion: p.descripcion || "",
    precio: p.precio,
    precioOferta: x.promo,
    precioSocio: x.socio,
    precioFinal: x.unit,
    aplicado: x.aplicado,
    img: p.img || Sup.fotoSegura(p.foto),
    tallas: p.tallas.map((t) => ({ talla: t.talla, max: t.libres === null ? MAX_QTY : Math.min(MAX_QTY, t.libres) })),
  };
}
// La promo tal como la ve el cliente (null si no hay ninguna oferta leída).
export const publicOferta = (ctx = {}) => Of.publica(ctx.oferta, ctx.now);
// Prendas que se pueden pedir: a la venta, con precio y alguna talla libre.
export const orderable = (prendas) => prendas.filter((p) => p.efectivo === "disponible" && p.precio != null && Number(p.precio) >= 0 && p.tallas.length);

// ── Validar lo que pide el cliente ──────────────────────────────────────────
// Devuelve las líneas con su precio (juntando las repetidas). Lanza ShopError.
export function prepare(prendas, raw, discountPct = 0, ctx = {}) {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) bad(400, "Elige al menos una prenda.");
  const lines = new Map();
  for (const x of list) {
    const p = prendas.find((q) => q.id === String(x?.prenda || ""));
    if (!p || p.efectivo !== "disponible" || p.precio == null) bad(400, "Alguna de esas prendas ya no está a la venta.");
    const t = p.tallas.find((q) => q.talla === String(x?.talla || ""));
    if (!t) bad(400, `Elige la talla de ${p.nombre}.`);
    const n = Number(x?.cantidad ?? 1);
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) bad(400, `Puedes pedir de 1 a ${MAX_QTY} unidades de cada talla.`);
    const k = p.id + "|" + t.talla;
    const prev = lines.get(k);
    // El precio se fija aquí y se guarda en el pedido (como hace la web con la reserva).
    const pr = priceOf(p, discountPct, ctx);
    lines.set(k, { prenda: p.id, nombre: p.nombre + (p.variante ? " · " + p.variante : ""), talla: t.talla, cantidad: (prev?.cantidad || 0) + n, base: pr.base, unit: pr.unit, aplicado: pr.aplicado, ...(pr.aplicado === "promo" ? { oferta: ctx.oferta.nombre } : {}) });
  }
  if (lines.size > MAX_LINES) bad(400, `Como mucho ${MAX_LINES} prendas distintas por pedido.`);
  const items = [...lines.values()].map((l) => {
    if (l.cantidad > MAX_QTY) bad(400, `Puedes pedir de 1 a ${MAX_QTY} unidades de cada talla.`);
    return { ...l, importe: r2(l.unit * l.cantidad) };
  });
  const subtotal = r2(items.reduce((a, l) => a + l.base * l.cantidad, 0));
  const total = r2(items.reduce((a, l) => a + l.importe, 0));
  // Solo cuenta como «descuento de socio» si de verdad se ha aplicado en alguna línea.
  const socio = items.some((l) => l.aplicado === "socio");
  const promo = items.find((l) => l.aplicado === "promo");
  return { items, subtotal, total, discountPct: socio ? Number(discountPct) || 0 : 0, ...(promo ? { oferta: { nombre: ctx.oferta.nombre, fechas: ctx.oferta.fechas, descuento: ctx.oferta.descuento } } : {}) };
}

// ── Apartar y soltar unidades (supply:apartadas) ────────────────────────────
// Si la talla no lleva cuenta (sin fila en supply:stock) se puede pedir sin límite.
export async function reserve(items) {
  const done = [];
  try {
    for (const l of items) {
      const k = l.prenda + "|" + l.talla;
      const [after] = await sharedPipe([["HINCRBY", Sup.K.apart, k, String(l.cantidad)]]);
      done.push(l);
      const [s] = await sharedPipe([["HGET", Sup.K.stock, k]]);
      if (s !== null && s !== undefined && Number(s) - Number(after) < 0) {
        const libres = Math.max(0, Number(s) - (Number(after) - l.cantidad));
        bad(409, libres ? `De ${l.nombre} (talla ${l.talla}) solo quedan ${libres}.` : `${l.nombre} en talla ${l.talla} se ha agotado.`);
      }
    }
  } catch (e) {
    await release(done);
    throw e;
  }
}
export async function release(items) {
  if (!items.length) return;
  await sharedPipe(items.map((l) => ["HINCRBY", Sup.K.apart, l.prenda + "|" + l.talla, String(-l.cantidad)]));
}

// ── Guardar y leer ──────────────────────────────────────────────────────────
export async function get(id) {
  return getJSON(key(String(id || "").replace(/[^A-Za-z0-9]/g, "")));
}
const many = async (ids) => {
  if (!ids.length) return [];
  const raw = await pipe(ids.map((id) => ["GET", key(id)]));
  return raw.map((r) => (r ? JSON.parse(r) : null)).filter(Boolean);
};
export const all = async () => (await many(await cmd("SMEMBERS", "sordall"))).sort((a, b) => String(b.created).localeCompare(String(a.created)));
export const ofUser = async (email) => (await many(await cmd("SMEMBERS", "usord:" + email))).sort((a, b) => String(b.created).localeCompare(String(a.created)));
export const ofBooking = async (bookingId) => (await many(await cmd("SMEMBERS", "sordbk:" + bookingId))).filter((o) => o.booking === bookingId);
const save = (o) => setJSON(key(o.id), o);

const stampOf = () => T.nowLocal().stamp;
const log = (o, estado, by) => ({ ...o, estado, history: [...(o.history || []), { estado, at: stampOf(), by: by || "" }].slice(-20) });

// Crea el pedido: aparta las unidades y lo guarda. `pay`: «local» | «stripe» | «demo».
export async function create({ user, items, subtotal, total, discountPct = 0, oferta = null, pay = "local", booking = "", note = "" }) {
  await reserve(items);
  const now = T.nowLocal();
  const o = {
    id: "PD" + crypto.randomBytes(4).toString("hex").toUpperCase(),
    created: now.stamp,
    email: user.email,
    name: user.name || "",
    phone: user.phone || "",
    items,
    subtotal,
    discountPct,
    ...(oferta ? { oferta } : {}),
    total,
    pay,
    entrega: booking ? "cita" : "local",
    booking,
    note: String(note || "").slice(0, 200),
    estado: "pendiente",
    history: [{ estado: "pendiente", at: now.stamp, by: "cliente" }],
  };
  try {
    await pipe([
      ["SET", key(o.id), JSON.stringify(o)],
      ["SADD", "sordall", o.id],
      ["SADD", "usord:" + o.email, o.id],
      ...(booking ? [["SADD", "sordbk:" + booking, o.id]] : []),
    ]);
  } catch (e) {
    await release(items);
    throw e;
  }
  return o;
}
export async function attachBooking(o, bookingId) {
  const next = { ...o, booking: bookingId, entrega: "cita" };
  await pipe([
    ["SET", key(o.id), JSON.stringify(next)],
    ["SADD", "sordbk:" + bookingId, o.id],
  ]);
  return next;
}

// ── Cobrar ──────────────────────────────────────────────────────────────────
// Una vez por pedido (aunque el webhook, el cliente y el dueño lo intenten a la
// vez): baja el stock, suelta lo apartado y apunta las ventas. `club` (opcional)
// es la función que suma los puntos del Club; sin ella los puntos se dan luego
// (ver `club` en handler.js).
async function locked(id, fn) {
  if ((await cmd("SET", "sordlock:" + id, "1", "NX", "EX", 30)) !== "OK") return { busy: true };
  try {
    return await fn();
  } finally {
    await cmd("DEL", "sordlock:" + id);
  }
}
export async function markPaid(id, { method, by = "", importe, club } = {}) {
  const r = await locked(id, async () => {
    const o = await get(id);
    if (!o) return null;
    if (o.estado !== "pendiente") return o; // ya cobrado, entregado o cancelado: nada que hacer
    const total = importe == null ? o.total : r2(Number(importe));
    // Si el dueño cobra un importe distinto, se reparte en las líneas para que las ventas sumen lo cobrado.
    const items = total === o.total ? o.items : splitTotal(o.items, total);
    const fecha = stampOf();
    for (const l of items) await Sup.bajarStock(l.prenda, l.talla, l.cantidad, { force: true });
    await release(items);
    const ventas = [];
    for (const l of items) {
      const v = await Sup.apuntarVenta({ fecha, canal: "app", pedido: o.id, prenda: l.prenda, nombre: l.nombre, talla: l.talla, cantidad: l.cantidad, importe: l.importe, cliente: o.name, email: o.email, por: by || "cliente" });
      ventas.push(v.id);
    }
    let next = log({ ...o, items, total, pay: method || o.pay, paidAt: fecha, paidBy: by || "cliente", ventas }, "pagado", by || (method === "stripe" ? "stripe" : "cliente"));
    await save(next);
    if (club) {
      const c = await club(next).catch((e) => (console.error("Puntos del pedido", e.message), null));
      if (c?.id) {
        next = { ...next, club: c.id, puntos: c.points || 0 };
        await save(next);
      }
    }
    return next;
  });
  return r;
}
function splitTotal(items, total) {
  const base = items.reduce((a, l) => a + l.importe, 0) || 1;
  let left = total;
  return items.map((l, i) => {
    const importe = i === items.length - 1 ? r2(left) : r2((total * l.importe) / base);
    left -= importe;
    return { ...l, importe };
  });
}

// ── Cambiar de estado ───────────────────────────────────────────────────────
// `dropClub(id)`: quita los puntos de una compra (misma ficha que la venta de caja).
// Cancelar un pedido ya cobrado deshace la venta; el dinero de un pago con
// Stripe se devuelve a mano desde Stripe (o con el reembolso de la app, si lo hay).
export async function cancel(id, { by = "", dropClub, reason = "" } = {}) {
  return locked(id, async () => {
    const o = await get(id);
    if (!o) return null;
    if (o.estado === "cancelado") return o;
    if (o.estado === "entregado") bad(400, "Un pedido entregado ya no se cancela.");
    if (o.estado === "pendiente") await release(o.items);
    else {
      for (const vid of o.ventas || []) await Sup.quitarVenta(vid);
      for (const l of o.items) await Sup.subirStock(l.prenda, l.talla, l.cantidad);
      if (o.club && dropClub) await dropClub(o.club);
    }
    if (o.stripe?.session && o.estado === "pendiente") await Card.expireCheckout(o.stripe.session).catch(() => {});
    const next = { ...log(o, "cancelado", by), canceladoAntes: o.estado, ...(reason ? { motivo: reason } : {}), ...(o.estado !== "pendiente" && o.pay === "stripe" ? { reembolsar: true } : {}) };
    await save(next);
    return next;
  });
}

// Cambios de estado que hace el equipo. Devuelve el pedido nuevo.
export async function setEstado(o, estado, { by, owner, club, dropClub } = {}) {
  if (!ESTADOS.includes(estado)) bad(400, "Estado desconocido.");
  if (estado === o.estado) return o;
  if (o.estado === "cancelado") bad(400, "Ese pedido está cancelado.");
  if (o.estado === "entregado") bad(400, "Ese pedido ya está entregado.");
  if (estado === "cancelado") {
    if (o.estado !== "pendiente" && !owner) bad(403, "Un pedido ya cobrado solo lo cancela el dueño.");
    return cancel(o.id, { by, dropClub });
  }
  let cur = o;
  if (cur.estado === "pendiente") {
    if (cur.pay === "stripe") bad(400, "Está pendiente del pago online. Si ha pagado en el local, usa «Cobrado en el local».");
    if (estado === "pagado" || estado === "listo" || estado === "entregado") {
      cur = await markPaid(o.id, { method: "local", by, club });
      if (!cur || cur.busy) bad(409, "Ese pedido se está cobrando. Prueba otra vez.");
    }
  }
  if (estado === "pagado") return cur;
  const next = log(cur, estado, by);
  await save(next);
  return next;
}

// «Cobrado en el local» (con el importe real, por si se ha hecho un descuento a mano).
export async function cobrarLocal(o, { by, importe, club }) {
  if (o.estado !== "pendiente") bad(400, o.estado === "cancelado" ? "Ese pedido está cancelado." : "Ese pedido ya está cobrado.");
  const r = await markPaid(o.id, { method: "local", by, importe, club });
  if (!r || r.busy) bad(409, "Ese pedido se está cobrando. Prueba otra vez.");
  return r;
}

// ── Stripe (Checkout en modo payment) ───────────────────────────────────────
export async function startCheckout(o, { base }) {
  const s = await Card.shopCheckout({
    order: o.id,
    email: o.email,
    base,
    minutes: STRIPE_MINUTES,
    lines: o.items.map((l) => ({ name: `${l.nombre} · ${l.talla}`, cents: Math.round(l.unit * 100), qty: l.cantidad })),
  });
  const next = { ...o, pay: "stripe", stripe: { session: s.id, url: s.url, until: new Date(Date.now() + STRIPE_MINUTES * 60000).toISOString() } };
  await save(next);
  return next;
}
// Pago confirmado por Stripe (webhook o al volver de Checkout). Comprueba el importe.
export async function stripePaid(session, { club } = {}) {
  const id = session?.metadata?.supply_order || session?.client_reference_id;
  const o = id && (await get(id));
  if (!o) return "pedido-desconocido";
  if (session.payment_status !== "paid") return "sin-pagar";
  if (o.stripe?.session && session.id && o.stripe.session !== session.id) return "sesion-distinta";
  if (typeof session.amount_total === "number" && session.amount_total !== Math.round(o.total * 100)) {
    await save({ ...o, aviso: "El importe de Stripe no coincide con el pedido. Revísalo." });
    return "importe-distinto";
  }
  if (o.estado === "cancelado") {
    // Pagó cuando ya había caducado: si aún hay unidades se recupera; si no, queda marcado para devolverle el dinero.
    try {
      await reserve(o.items);
    } catch {
      await save({ ...o, reembolsar: true, aviso: "Pagó después de caducar y ya no quedan unidades: devuélvele el dinero." });
      return "pagado-sin-stock";
    }
    await save(log({ ...o, motivo: "" }, "pendiente", "stripe"));
  }
  const r = await markPaid(o.id, { method: "stripe", by: "stripe", club });
  if (r && !r.busy && session.payment_intent) await save({ ...r, stripe: { ...(r.stripe || {}), pi: String(session.payment_intent) } });
  return "pagado";
}
export async function stripeExpired(session) {
  const id = session?.metadata?.supply_order || session?.client_reference_id;
  const o = id && (await get(id));
  if (!o || o.estado !== "pendiente" || o.pay !== "stripe") return "ignorado";
  await cancel(o.id, { by: "stripe", reason: "El pago online caducó." });
  return "caducado";
}
// Al volver de Checkout (por si el webhook aún no ha llegado): pregunta a Stripe.
export async function syncStripe(o, { club } = {}) {
  if (o.pay !== "stripe" || o.estado !== "pendiente" || !o.stripe?.session || !Card.shopOnline()) return o;
  const s = await Card.readCheckout(o.stripe.session).catch(() => null);
  if (!s) return o;
  if (s.paid) await stripePaid({ id: o.stripe.session, metadata: { supply_order: o.id }, payment_status: "paid", amount_total: s.amount, payment_intent: s.pi }, { club });
  else if (s.expired) await stripeExpired({ metadata: { supply_order: o.id } });
  return get(o.id);
}

// ── Mantenimiento (cada hora, en el cron) ───────────────────────────────────
// Suelta lo que nadie va a recoger: pagos online sin completar, pedidos de una
// cita cancelada o ya pasada y pedidos «en el local» que llevan días sin cobrarse.
// `bookingState(id)` → { canceled, date } de la cita (null si ya no existe).
export async function maintain({ bookingState, club } = {}) {
  const out = { released: 0, paid: 0 };
  const today = T.nowLocal().date;
  for (const o of (await all()).filter((x) => x.estado === "pendiente")) {
    let why = "";
    if (o.pay === "stripe") {
      const fresh = await syncStripe(o, { club });
      if (fresh.estado === "pagado") {
        out.paid++;
        continue;
      }
      if (fresh.estado === "cancelado") continue;
      if (o.stripe?.until && Date.parse(o.stripe.until) + 10 * 60000 < Date.now()) why = "El pago online no se completó.";
    } else if (o.booking && bookingState) {
      const b = await bookingState(o.booking);
      if (!b || b.canceled) why = "La cita se canceló.";
      else if (b.date < T.addDays(today, -2)) why = "No pasó a recogerlo.";
    } else if (o.created.slice(0, 10) < T.addDays(today, -LOCAL_DAYS)) why = "No pasó a recogerlo.";
    if (why) {
      await cancel(o.id, { by: "auto", reason: why });
      out.released++;
    }
  }
  return out;
}
// Pedidos cobrados sin los puntos del Club (p. ej. los que cobró el webhook de Stripe).
export async function grantClubs(club) {
  let n = 0;
  for (const o of (await all()).filter((x) => ["pagado", "listo", "entregado"].includes(x.estado) && !x.club && !x.sinClub && o_total(x) > 0)) {
    const u = await getJSON("user:" + o.email);
    if (!u) {
      await save({ ...o, sinClub: true });
      continue;
    }
    const c = await club({ ...o }).catch(() => null);
    if (c?.id) {
      await save({ ...o, club: c.id, puntos: c.points || 0 });
      n++;
    }
  }
  return n;
}
const o_total = (o) => Number(o.total) || 0;

// Vista del pedido para el cliente (sin datos internos).
export const viewFor = (o) => ({
  id: o.id,
  created: o.created,
  estado: o.estado,
  items: o.items.map((l) => ({ prenda: l.prenda, nombre: l.nombre, talla: l.talla, cantidad: l.cantidad, unit: l.unit, base: l.base, aplicado: l.aplicado || "", importe: l.importe })),
  subtotal: o.subtotal,
  discountPct: o.discountPct || 0,
  ...(o.oferta ? { oferta: o.oferta } : {}),
  total: o.total,
  pay: o.pay,
  entrega: o.entrega,
  booking: o.booking || "",
  ...(o.estado === "pendiente" && o.pay === "stripe" && o.stripe?.url ? { url: o.stripe.url } : {}),
  ...(o.puntos ? { puntos: o.puntos } : {}),
});
