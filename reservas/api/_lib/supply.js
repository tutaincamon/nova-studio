// ─────────────────────────────────────────────────────────────────────────────
// NOVA Supply: la ropa, compartida entre el estudio (esta app) y la tienda
// (novasupply.es). Las dos webs usan la misma base, y estas claves van SIN el
// prefijo de la app de reservas para que la tienda las lea igual:
//
//   supply:catalogo    JSON con las prendas (nombre, color, precio, tallas…)
//   supply:stock       hash «prenda|talla» → unidades en el estudio.
//                      Si una talla no está en el hash, NO se cuentan unidades
//                      (se puede vender/reservar sin límite, como antes).
//   supply:apartadas   hash «prenda|talla» → unidades reservadas en la web y
//                      aún sin recoger. Libres = stock − apartadas.
//   supply:ventas      lista de ventas (la más nueva primero), del estudio y de
//                      la web, con su canal.
//   preventa:pedidos   las reservas de la web (las escribe la tienda).
//
// Una camiseta vendida en el estudio baja el stock y sale en las ventas de las
// dos partes; una reserva de la web aparta la unidad hasta que se recoge.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { sharedPipe } from "./store.js";

export const K = { cat: "supply:catalogo", stock: "supply:stock", apart: "supply:apartadas", ventas: "supply:ventas", pedidos: "preventa:pedidos" };
export const ESTADOS = ["disponible", "proximamente", "agotado", "oculto"];

// Lo que había en prendas.js de la tienda el día que se conectaron las dos
// partes. Sirve solo para arrancar: a partir de ahí manda la base.
const SEED = [
  { id: "camiseta", nombre: "Camiseta", variante: "Gris", color: "gris", precio: 47.5, estado: "agotado", tallas: ["L", "XL", "XXL"], foto: "gris-delante.jpg" },
  { id: "camiseta-rosa", nombre: "Camiseta", variante: "Rosa", color: "rosa", precio: 47.5, estado: "disponible", tallas: ["L", "XL", "XXL"], foto: "rosa-delante.jpg" },
  { id: "sudadera", nombre: "Sudadera", variante: "", color: "", precio: null, estado: "proximamente", tallas: [], foto: "sud-delante.jpg" },
  { id: "p-camisa", nombre: "Camisa", variante: "", color: "", precio: null, estado: "proximamente", tallas: [], foto: "d2-camisa-delante.jpg" },
  { id: "p-tirantes", nombre: "Tirantes", variante: "", color: "", precio: null, estado: "proximamente", tallas: [], foto: "d2-tirantes-delante.jpg" },
  { id: "p-vaqueros", nombre: "Vaqueros", variante: "", color: "", precio: null, estado: "proximamente", tallas: [], foto: "d2-vaqueros-delante.jpg" },
  { id: "p-short", nombre: "Short", variante: "", color: "", precio: null, estado: "proximamente", tallas: [], foto: "d2-short-delante.jpg" },
];
export const TALLAS = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

const parse = (v) => {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const toObj = (arr) => {
  if (!arr) return {};
  if (!Array.isArray(arr)) return arr;
  const o = {};
  for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};
export const precioTxt = (n) => (n == null || n === "" ? "" : Number(n).toFixed(2).replace(".", ",").replace(",00", "") + " €");

// Todo lo de la ropa de una vez: catálogo con unidades por talla, reservas
// pendientes de la web y últimas ventas.
export async function leer({ ventas = 60 } = {}) {
  let [cat, stock, apart, vts, peds] = await sharedPipe([
    ["GET", K.cat],
    ["HGETALL", K.stock],
    ["HGETALL", K.apart],
    ["LRANGE", K.ventas, "0", String(ventas - 1)],
    ["LRANGE", K.pedidos, "0", "-1"],
  ]);
  let prendas = parse(cat);
  if (!Array.isArray(prendas)) {
    prendas = SEED;
    await sharedPipe([["SET", K.cat, JSON.stringify(SEED), "NX"]]);
  }
  stock = toObj(stock);
  apart = toObj(apart);
  const conTallas = prendas.map((p) => {
    const tallas = (p.tallas || []).map((t) => {
      const k = p.id + "|" + t,
        s = stock[k] === undefined ? null : Number(stock[k]),
        a = Math.max(0, Number(apart[k] || 0));
      return { talla: t, stock: s, apartadas: a, libres: s === null ? null : Math.max(0, s - a) };
    });
    return { ...p, tallas, efectivo: estadoEfectivo(p, tallas) };
  });
  const pedidos = (peds || []).map((raw, i) => ({ ...(parse(raw) || {}), _i: i, _raw: raw })).filter((x) => x.ref);
  return { prendas: conTallas, ventas: (vts || []).map(parse).filter(Boolean), pedidos };
}
// «Disponible» pero sin ninguna talla libre = agotada, sin que nadie lo cambie a mano.
export function estadoEfectivo(p, tallas) {
  if (p.estado !== "disponible") return p.estado;
  const abiertas = tallas.filter((t) => t.libres === null || t.libres > 0);
  return abiertas.length ? "disponible" : "agotado";
}
// La reserva de la web que corresponde a una prenda: por su id, o por el color (las antiguas).
export const prendaDePedido = (prendas, ped) => prendas.find((p) => p.id === ped.prenda) || prendas.find((p) => p.color && p.color === ped.color);

const slug = (x) =>
  String(x || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 30) || "prenda";
export async function guardarPrenda(datos, prendas) {
  const base = prendas.map(({ efectivo, tallas, ...p }) => ({ ...p, tallas: tallas.map((t) => t.talla || t) }));
  let id = datos.id;
  if (!id) {
    const s0 = slug(datos.nombre + " " + (datos.variante || ""));
    id = s0;
    for (let i = 2; base.some((p) => p.id === id); i++) id = s0 + "-" + i;
  }
  const prev = base.find((p) => p.id === id);
  const { stock, ...meta } = datos;
  const item = { ...(prev || {}), ...meta, id };
  const lista = prev ? base.map((p) => (p.id === id ? item : p)) : [...base, item];
  const ops = [["SET", K.cat, JSON.stringify(lista)]];
  // Unidades: número = se cuentan; vacío = sin contar.
  for (const [t, v] of Object.entries(stock || {})) {
    const k = id + "|" + t;
    if (v === null || v === "") ops.push(["HDEL", K.stock, k]);
    else ops.push(["HSET", K.stock, k, String(Math.max(0, Math.round(Number(v))))]);
  }
  // Tallas quitadas: dejan de contarse.
  for (const t of (prev?.tallas || []).filter((t) => !item.tallas.includes(t))) ops.push(["HDEL", K.stock, id + "|" + t]);
  await sharedPipe(ops);
  return item;
}

// Quita unidades del stock. Devuelve false si no quedan libres (sin contar las
// apartadas por reservas de la web). Si la talla no se cuenta, siempre se puede.
// `force`: al recoger una reserva la unidad ya estaba apartada para esa persona.
export async function bajarStock(prenda, talla, n, { force = false } = {}) {
  const k = prenda + "|" + talla;
  const [s, a] = await sharedPipe([
    ["HGET", K.stock, k],
    ["HGET", K.apart, k],
  ]);
  if (s === null || s === undefined) return true;
  const after = (await sharedPipe([["HINCRBY", K.stock, k, String(-n)]]))[0];
  if (!force && after < Number(a || 0)) {
    await sharedPipe([["HINCRBY", K.stock, k, String(n)]]);
    return false;
  }
  if (after < 0) await sharedPipe([["HSET", K.stock, k, "0"]]);
  return true;
}
export async function subirStock(prenda, talla, n) {
  const k = prenda + "|" + talla;
  const [s] = await sharedPipe([["HGET", K.stock, k]]);
  if (s === null || s === undefined) return;
  await sharedPipe([["HINCRBY", K.stock, k, String(n)]]);
}

export async function apuntarVenta(v) {
  const venta = { id: "V" + crypto.randomBytes(4).toString("hex").toUpperCase(), ...v };
  await sharedPipe([
    ["LPUSH", K.ventas, JSON.stringify(venta)],
    ["LTRIM", K.ventas, "0", "4999"],
  ]);
  return venta;
}
export async function quitarVenta(id) {
  const list = await sharedPipe([["LRANGE", K.ventas, "0", "-1"]]);
  const raw = (list[0] || []).find((r) => parse(r)?.id === id);
  if (!raw) return null;
  await sharedPipe([["LREM", K.ventas, "1", raw]]);
  return parse(raw);
}

// Cambia una reserva de la web (recogida o anulada) en su sitio de la lista,
// comprobando que nadie la ha movido entre medias.
export async function marcarPedido(ref, cambios) {
  for (let intento = 0; intento < 3; intento++) {
    const [list] = await sharedPipe([["LRANGE", K.pedidos, "0", "-1"]]);
    const i = (list || []).findIndex((r) => parse(r)?.ref === ref);
    if (i < 0) return null;
    const raw = list[i],
      ped = parse(raw);
    if (ped.estado && ped.estado !== "pendiente") return { ...ped, yaCerrada: true };
    const nuevo = { ...ped, ...cambios };
    const [now] = await sharedPipe([["LINDEX", K.pedidos, String(i)]]);
    if (now !== raw) continue; // ha entrado otra reserva arriba: se vuelve a buscar
    await sharedPipe([["LSET", K.pedidos, String(i), JSON.stringify(nuevo)]]);
    // Si estaba apartada, deja de estarlo (se ha recogido o anulado).
    if (ped.apartada && ped.prenda) await sharedPipe([["HINCRBY", K.apart, ped.prenda + "|" + ped.talla, "-1"]]);
    return { ...nuevo, _antes: ped };
  }
  throw Error("La lista de reservas está cambiando. Prueba otra vez.");
}
