// ─────────────────────────────────────────────────────────────────────────────
// La oferta de NOVA Supply: UNA SOLA FUENTE DE VERDAD, la web (novasupply.es).
//
// La promo (p. ej. Black Friday) vive en https://www.novasupply.es/oferta.js, un
// archivo de la web que define `var OFERTA = { … }`. La app NO tiene su propia
// promo: la lee de ahí desde el SERVIDOR (el navegador nunca carga nada de
// novasupply.es, así la CSP no cambia) y aplica las mismas reglas que la web.
//
// SEGURIDAD: el contenido remoto jamás se ejecuta (nada de eval, new Function ni
// vm). Se busca el literal `OFERTA = { … }` y se lee con un parser propio que
// solo entiende datos (objetos, listas, textos, números, true/false/null y
// comentarios). Cualquier otra cosa (llamadas, variables, operadores…) hace que
// se descarte: sin oferta es siempre el resultado seguro.
//
// Caché (Redis de la app): 10 minutos, y la última lectura buena se guarda como
// respaldo por si la web no responde. Sin ninguna lectura buena, no hay oferta.
//
// Variable de entorno (opcional): SUPPLY_OFERTA_URL (por defecto la de arriba;
// «off» la desactiva).
// ─────────────────────────────────────────────────────────────────────────────
import { cmd, getJSON, setJSON } from "./store.js";

export const URL_POR_DEFECTO = "https://www.novasupply.es/oferta.js";
export const CACHE_SEG = 600; // 10 minutos
export const TIMEOUT_MS = 3000;
export const MAX_BYTES = 40000;
export const K = { cache: "supply:oferta:cache", ultima: "supply:oferta:ultima" };


// ── Parser de literales (solo datos) ────────────────────────────────────────
class ParseError extends Error {}
const MAX_DEPTH = 6;
const MAX_ITEMS = 50;

function parseLiteral(src, start) {
  let i = start;
  const fail = (m) => {
    throw new ParseError(m + " @" + i);
  };
  const blank = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith("//", i)) {
        while (i < src.length && src[i] !== "\n") i++;
      } else if (src.startsWith("/*", i)) {
        const e = src.indexOf("*/", i + 2);
        if (e < 0) fail("comentario sin cerrar");
        i = e + 2;
      } else return;
    }
  };
  const str = () => {
    const q = src[i++];
    let out = "";
    while (i < src.length && src[i] !== q) {
      let c = src[i++];
      if (c === "\n") fail("texto sin cerrar");
      if (c === "\\") {
        const n = src[i++];
        if (n === "n") c = "\n";
        else if (n === "t") c = "\t";
        else if (n === "u") {
          const h = src.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail("escape \\u");
          c = String.fromCharCode(parseInt(h, 16));
          i += 4;
        } else if (n === "x") {
          const h = src.slice(i, i + 2);
          if (!/^[0-9a-fA-F]{2}$/.test(h)) fail("escape \\x");
          c = String.fromCharCode(parseInt(h, 16));
          i += 2;
        } else if (n === undefined || n === "\n") fail("escape");
        else c = n; // \' \" \\ \/ …
      }
      out += c;
      if (out.length > 500) fail("texto demasiado largo");
    }
    if (src[i] !== q) fail("texto sin cerrar");
    i++;
    return out;
  };
  const value = (depth) => {
    if (depth > MAX_DEPTH) fail("demasiado anidado");
    blank();
    const c = src[i];
    if (c === "'" || c === '"') return str();
    if (c === "{") {
      i++;
      const o = Object.create(null);
      for (let n = 0; ; n++) {
        blank();
        if (src[i] === "}") {
          i++;
          return o;
        }
        if (n >= MAX_ITEMS) fail("demasiados campos");
        let k;
        if (src[i] === "'" || src[i] === '"') k = str();
        else {
          const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 80));
          if (!m) fail("clave");
          k = m[0];
          i += k.length;
        }
        blank();
        if (src[i++] !== ":") fail("se esperaba «:»");
        const v = value(depth + 1);
        if (k !== "__proto__") o[k] = v;
        blank();
        if (src[i] === ",") i++;
        else if (src[i] !== "}") fail("se esperaba «,» o «}»");
      }
    }
    if (c === "[") {
      i++;
      const a = [];
      for (let n = 0; ; n++) {
        blank();
        if (src[i] === "]") {
          i++;
          return a;
        }
        if (n >= MAX_ITEMS) fail("demasiados elementos");
        a.push(value(depth + 1));
        blank();
        if (src[i] === ",") i++;
        else if (src[i] !== "]") fail("se esperaba «,» o «]»");
      }
    }
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)(?![\w$])/.exec(src.slice(i, i + 40));
    if (!m) fail("valor no permitido");
    i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : m[0] === "null" ? null : Number(m[0]);
  };
  const v = value(0);
  return v;
}

// Valida y normaliza. Devuelve el objeto de oferta o null.
export function validar(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const txt = (v, max = 80) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
  const nombre = txt(raw.nombre, 60);
  const fechas = txt(raw.fechas, 120);
  const desde = typeof raw.desde === "string" ? Date.parse(raw.desde) : NaN;
  const hasta = typeof raw.hasta === "string" ? Date.parse(raw.hasta) : NaN;
  const d = raw.descuento;
  if (!nombre || !fechas || !Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde) return null;
  if (typeof d !== "number" || !Number.isFinite(d) || d <= 0 || d >= 100) return null;
  if (!Array.isArray(raw.prendas) || raw.prendas.length > 40 || !raw.prendas.every((x) => typeof x === "string" && /^[\w-]{1,40}$/.test(x))) return null;
  const destacada = raw.destacada == null ? "" : typeof raw.destacada === "string" && /^[\w-]{1,40}$/.test(raw.destacada) ? raw.destacada : null;
  if (destacada === null) return null;
  return { nombre, desde: raw.desde, hasta: raw.hasta, fechas, descuento: d, prendas: [...raw.prendas], destacada };
}

// Texto del oferta.js → oferta validada, o null si no hay nada fiable. Nunca ejecuta el texto.
export function parseOferta(text) {
  try {
    if (typeof text !== "string" || !text || text.length > MAX_BYTES) return null;
    const m = /\b(?:var|let|const)\s+OFERTA\s*=\s*(?=\{)/.exec(text);
    if (!m) return null;
    return validar(parseLiteral(text, m.index + m[0].length));
  } catch {
    return null;
  }
}

// ── Las mismas reglas que la web (oferta.js: activa, aplica, numero, rebajado) ─
export function activa(of, ahora) {
  if (!of) return false;
  const t = (ahora || new Date()).getTime();
  return t >= Date.parse(of.desde) && t < Date.parse(of.hasta);
}
export const aplica = (of, id, ahora) => !!of && activa(of, ahora) && of.prendas.indexOf(id) >= 0;
export function numero(precio) {
  if (typeof precio === "number") return precio;
  const n = parseFloat(String(precio || "").replace(/[^\d,.-]/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}
export function rebajado(of, precio) {
  const n = numero(precio);
  return n == null || !of ? null : Math.round(n * (100 - of.descuento)) / 100;
}

// Lo que se enseña de la oferta (sin la lista interna de prendas).
export const publica = (of, ahora) => (of ? { nombre: of.nombre, fechas: of.fechas, desde: of.desde, hasta: of.hasta, descuento: of.descuento, activa: activa(of, ahora), prendas: of.prendas } : null);

// ── Leer de la web, con caché y respaldo ────────────────────────────────────
let fetcher = null; // para tests y desarrollo sin red: (url, {signal}) → { ok, status, text() }
export const usarFetch = (fn) => {
  fetcher = fn || null;
};
export const oferUrl = () => {
  const u = (process.env.SUPPLY_OFERTA_URL ?? "").trim();
  return u === "" ? URL_POR_DEFECTO : u;
};
export const desactivada = () => /^(off|0|no|none)$/i.test(oferUrl());

async function descargar(url) {
  const f = fetcher || globalThis.fetch;
  const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/javascript, text/plain, */*" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const txt = await res.text();
  if (txt.length > MAX_BYTES) throw new Error("respuesta demasiado grande");
  return txt;
}

// → { oferta, fuente: "cache" | "web" | "respaldo" | "ninguna" | "desactivada", leida, error? }
//   `leida`: ISO de la última lectura buena. `forzar`: ignora la caché de 10 minutos.
export async function leerOferta({ forzar = false } = {}) {
  if (desactivada()) return { oferta: null, fuente: "desactivada", leida: null };
  const url = oferUrl();
  if (!forzar) {
    const c = await getJSON(K.cache).catch(() => null);
    if (c && c.url === url) {
      const of = validar(c.oferta);
      return { oferta: of, fuente: c.fallo ? (of ? "respaldo" : "ninguna") : "cache", leida: c.leida || null, ...(c.fallo ? { error: "La web no responde; se reintenta en un minuto" } : {}) };
    }
  }
  let error = "";
  try {
    const txt = await descargar(url);
    const of = parseOferta(txt);
    if (of) {
      const reg = { url, leida: new Date().toISOString(), oferta: of };
      await Promise.all([setJSON(K.cache, reg, "EX", CACHE_SEG), setJSON(K.ultima, reg)]).catch(() => {});
      return { oferta: of, fuente: "web", leida: reg.leida };
    }
    error = "Sin oferta legible en el archivo"; // roto o cambiado: se trata como fallo
  } catch (e) {
    error = String(e?.message || e).slice(0, 120);
  }
  // Fallo: la última buena (aunque sea antigua; las fechas de la oferta mandan, así que caduca sola).
  const u = await getJSON(K.ultima).catch(() => null);
  const of = u && u.url === url ? validar(u.oferta) : null;
  // Se cachea un rato el fallo para no esperar el tiempo de espera en cada petición.
  await setJSON(K.cache, { url, leida: u?.leida || null, oferta: of, fallo: true }, "EX", 60).catch(() => {});
  return of ? { oferta: of, fuente: "respaldo", leida: u.leida, error } : { oferta: null, fuente: "ninguna", leida: null, error };
}
export const borrarCache = () => Promise.all([cmd("DEL", K.cache), cmd("DEL", K.ultima)]).catch(() => {});
