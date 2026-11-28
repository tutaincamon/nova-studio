// La oferta de NOVA Supply viene de novasupply.es (oferta.js): lectura segura (sin ejecutar
// nada remoto), mismas reglas que la web (fechas y redondeo), caché y respaldo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import * as Of from "../api/_lib/oferta.js";

// El archivo tal cual está publicado en la web (formato real).
const WEB = `/* ═══ LA OFERTA DEL MOMENTO · un solo sitio ═══ */
(function (raiz) {
    var OFERTA = {
        nombre:    'Black Friday',
        desde:     '2026-11-23T00:00:00Z',   // el 23/11 a primera hora
        hasta:     '2026-12-01T00:00:00Z',   // hasta el 30/11 a medianoche
        fechas:    'Del 23 al 30 de noviembre',
        descuento: 30,                       // %
        prendas:   ['camiseta', 'camiseta-rosa'],
        destacada: 'camiseta-rosa'           // la que enseña la ventana de entrada
    };
    function activa(ahora) { return true; }
})(typeof window !== 'undefined' ? window : this);`;
const BF = { nombre: "Black Friday", desde: "2026-11-23T00:00:00Z", hasta: "2026-12-01T00:00:00Z", fechas: "Del 23 al 30 de noviembre", descuento: 30, prendas: ["camiseta", "camiseta-rosa"], destacada: "camiseta-rosa" };

describe("lectura segura de oferta.js", () => {
  test("lee el archivo real de la web (comentarios, comillas simples, claves sin comillas)", () => {
    assert.deepEqual(Of.parseOferta(WEB), BF);
  });
  test("admite comillas dobles, claves entre comillas y coma final", () => {
    const o = Of.parseOferta(`const OFERTA = { "nombre": "Navidad", "desde": "2026-12-20T00:00:00Z", "hasta": "2026-12-27T00:00:00Z", "fechas": "20-26 dic", "descuento": 15.5, "prendas": ["camiseta",], };`);
    assert.equal(o.nombre, "Navidad");
    assert.equal(o.descuento, 15.5);
    assert.deepEqual(o.prendas, ["camiseta"]);
    assert.equal(o.destacada, "");
  });
  test("NO ejecuta nada del contenido remoto: llamadas, variables u operadores → sin oferta", () => {
    globalThis.__pwned = 0;
    const malos = [
      `var OFERTA = { nombre: (globalThis.__pwned = 1), desde: 'a', hasta: 'b', fechas: 'x', descuento: 30, prendas: [] };`,
      `var OFERTA = { nombre: 'x', desde: '2026-11-23T00:00:00Z', hasta: '2026-12-01T00:00:00Z', fechas: 'x', descuento: 10 + 20, prendas: [] };`,
      `var OFERTA = { nombre: 'x', desde: '2026-11-23T00:00:00Z', hasta: '2026-12-01T00:00:00Z', fechas: 'x', descuento: 30, prendas: [process.exit(1)] };`,
      `var OFERTA = { nombre: 'x', desde: '2026-11-23T00:00:00Z', hasta: '2026-12-01T00:00:00Z', fechas: 'x', descuento: 30, prendas: [], f: function(){ globalThis.__pwned = 2 } };`,
      `var OFERTA = { nombre: \`\${globalThis.__pwned = 3}\`, desde: 'a', hasta: 'b', fechas: 'x', descuento: 30, prendas: [] };`,
      `var OFERTA = require('fs');`,
      `var OFERTA = { nombre: 'x', ...otra };`,
    ];
    for (const m of malos) assert.equal(Of.parseOferta(m), null, m);
    assert.equal(globalThis.__pwned, 0);
    delete globalThis.__pwned;
  });
  test("contenido roto, vacío, enorme o sin la variable → sin oferta", () => {
    for (const t of ["", "   ", null, undefined, 42, "<html>404</html>", "var OFERTA = {", "var OFERTA = { nombre: 'x", "var OFERTA = [1,2]", "var OTRA = {};", "x".repeat(Of.MAX_BYTES + 1)]) assert.equal(Of.parseOferta(t), null);
    assert.equal(Of.parseOferta("var OFERTA = " + "[".repeat(200) + "]".repeat(200)), null); // anidado sin fin
    assert.equal(Of.parseOferta("var OFERTA = { a: 1, __proto__: { x: 1 } };"), null);
  });
  test("valida campos y tipos", () => {
    const t = (o) => Of.parseOferta("var OFERTA = " + JSON.stringify({ ...BF, ...o }));
    assert.ok(t({}));
    for (const o of [{ nombre: "" }, { nombre: 5 }, { descuento: "30" }, { descuento: 0 }, { descuento: 100 }, { descuento: -5 }, { desde: "ayer" }, { hasta: "2020-01-01T00:00:00Z" }, { prendas: "camiseta" }, { prendas: [1] }, { prendas: ["a b!"] }, { fechas: 7 }, { destacada: 3 }]) assert.equal(t(o), null, JSON.stringify(o));
  });
});

describe("mismas reglas que la web: fechas y redondeo", () => {
  const of = Of.validar(BF);
  const at = (s) => new Date(s);
  test("activa: desde incluido, hasta excluido", () => {
    assert.equal(Of.activa(of, at("2026-11-22T23:59:59Z")), false);
    assert.equal(Of.activa(of, at("2026-11-23T00:00:00Z")), true);
    assert.equal(Of.activa(of, at("2026-11-30T23:59:59Z")), true);
    assert.equal(Of.activa(of, at("2026-12-01T00:00:00Z")), false);
    assert.equal(Of.activa(null, at("2026-11-25T00:00:00Z")), false);
  });
  test("aplica: solo las prendas de la oferta y solo dentro de fechas", () => {
    assert.equal(Of.aplica(of, "camiseta", at("2026-11-28T10:00:00Z")), true);
    assert.equal(Of.aplica(of, "camiseta-rosa", at("2026-11-28T10:00:00Z")), true);
    assert.equal(Of.aplica(of, "sudadera", at("2026-11-28T10:00:00Z")), false);
    assert.equal(Of.aplica(of, "camiseta", at("2027-01-01T00:00:00Z")), false);
  });
  test("rebajado: Math.round(n·(100−d))/100 como la web, también con «47,50 €»", () => {
    assert.equal(Of.rebajado(of, 47.5), 33.25);
    assert.equal(Of.rebajado(of, "47,50 €"), 33.25);
    assert.equal(Of.rebajado({ ...of, descuento: 33 }, 19.99), Math.round(19.99 * 67) / 100);
    assert.equal(Of.rebajado({ ...of, descuento: 15 }, 10.1), Math.round(10.1 * 85) / 100);
    assert.equal(Of.rebajado(of, null), null);
    assert.equal(Of.rebajado(of, ""), null);
  });
});

describe("leer la oferta de la web con caché y respaldo", () => {
  let body, calls, fail;
  const mock = async (url, opts) => {
    calls.push(url);
    assert.ok(opts.signal, "con tiempo máximo de espera");
    if (fail) throw new Error("sin red");
    return { ok: true, status: 200, text: async () => body };
  };
  const saved = process.env.SUPPLY_OFERTA_URL;
  before(() => Of.usarFetch(mock));
  after(() => {
    Of.usarFetch(null);
    saved === undefined ? delete process.env.SUPPLY_OFERTA_URL : (process.env.SUPPLY_OFERTA_URL = saved);
  });
  const reset = async () => {
    body = WEB;
    calls = [];
    fail = false;
    delete process.env.SUPPLY_OFERTA_URL;
    await Of.borrarCache();
  };

  test("por defecto lee https://www.novasupply.es/oferta.js y guarda 10 minutos", async () => {
    await reset();
    const a = await Of.leerOferta();
    assert.equal(a.fuente, "web");
    assert.deepEqual(a.oferta, BF);
    assert.ok(a.leida);
    const b = await Of.leerOferta();
    assert.equal(b.fuente, "cache");
    assert.deepEqual(calls, ["https://www.novasupply.es/oferta.js"]);
    assert.equal((await Of.leerOferta({ forzar: true })).fuente, "web");
    assert.equal(calls.length, 2);
  });
  test("SUPPLY_OFERTA_URL cambia la dirección y «off» la apaga", async () => {
    await reset();
    process.env.SUPPLY_OFERTA_URL = "http://127.0.0.1:9/oferta.js";
    await Of.leerOferta();
    assert.deepEqual(calls, ["http://127.0.0.1:9/oferta.js"]);
    process.env.SUPPLY_OFERTA_URL = "off";
    const r = await Of.leerOferta();
    assert.equal(r.fuente, "desactivada");
    assert.equal(r.oferta, null);
    assert.equal(calls.length, 1);
  });
  test("la web no responde: última lectura buena como respaldo; sin ella, sin oferta", async () => {
    await reset();
    fail = true;
    const n = await Of.leerOferta();
    assert.equal(n.oferta, null);
    assert.equal(n.fuente, "ninguna");
    await Of.borrarCache();
    fail = false;
    await Of.leerOferta();
    fail = true;
    const r = await Of.leerOferta({ forzar: true });
    assert.equal(r.fuente, "respaldo");
    assert.deepEqual(r.oferta, BF);
    assert.ok(r.error);
    // El fallo se recuerda un minuto: no se espera al tiempo máximo en cada petición.
    const before = calls.length;
    assert.equal((await Of.leerOferta()).fuente, "respaldo");
    assert.equal(calls.length, before);
  });
  test("archivo roto o malicioso: no se usa y vale el respaldo", async () => {
    await reset();
    await Of.leerOferta();
    body = "var OFERTA = { nombre: (process.exit(1)) };";
    const r = await Of.leerOferta({ forzar: true });
    assert.equal(r.fuente, "respaldo");
    assert.deepEqual(r.oferta, BF);
  });
  test("la respuesta HTTP de error se trata como fallo", async () => {
    await reset();
    Of.usarFetch(async () => ({ ok: false, status: 500, text: async () => "" }));
    assert.equal((await Of.leerOferta()).fuente, "ninguna");
    Of.usarFetch(mock);
  });
});

describe("el código no ejecuta contenido remoto", () => {
  test("oferta.js no usa eval, new Function ni vm", () => {
    const src = readFileSync(new URL("../api/_lib/oferta.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /\beval\s*\(|new\s+Function|node:vm|\brequire\(\s*["']vm/);
  });
});
