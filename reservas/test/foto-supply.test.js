// Foto de las prendas de catálogo (campo `foto`): se sirve desde nuestro origen.
import assert from "node:assert/strict";
import { test } from "node:test";
import handler from "../api/handler.js";
import { setJSON } from "../api/_lib/store.js";
import * as Sup from "../api/_lib/supply.js";
import * as Shop from "../api/_lib/shop.js";

function get(route) {
  const hdrs = new Map();
  let status = 200,
    body = null;
  const req = { method: "GET", url: "/api/handler?route=" + route, headers: { "x-forwarded-for": "198.51.100.77", host: "nova.test" } };
  const res = {
    setHeader: (k, v) => hdrs.set(String(k).toLowerCase(), v),
    getHeader: (k) => hdrs.get(String(k).toLowerCase()),
    end: (b) => (body = b),
  };
  Object.defineProperty(res, "statusCode", { get: () => status, set: (v) => (status = v) });
  return handler(req, res).then(() => ({ status, body, type: String(hdrs.get("content-type") || ""), cache: String(hdrs.get("cache-control") || "") }));
}
const item = (id) => ({ ...Sup.SEED.find((p) => p.id === id), tallas: [{ talla: "L", libres: 2 }] });

test("publicItem: la prenda de semilla sin foto subida deja img con la foto de catálogo", () => {
  assert.equal(Shop.publicItem(item("camiseta-rosa")).img, "rosa-delante.jpg");
  assert.equal(Shop.publicItem(item("camiseta")).img, "gris-delante.jpg");
  assert.equal(Shop.publicItem({ ...item("camiseta-rosa"), img: "123" }).img, "123");
  assert.equal(Shop.publicItem({ ...item("camiseta-rosa"), foto: "../x" }).img, "");
});

test("GET /api/supply/:id/photo sirve la foto de catálogo (JPEG)", async () => {
  for (const id of ["camiseta-rosa", "camiseta"]) {
    const r = await get(`supply/${id}/photo`);
    assert.equal(r.status, 200, id);
    assert.equal(r.type, "image/jpeg");
    assert.ok(Buffer.isBuffer(r.body) && r.body[0] === 0xff && r.body[1] === 0xd8, "bytes de JPEG");
    assert.ok(!/immutable/.test(r.cache));
  }
  assert.equal((await get("supply/no-existe/photo")).status, 404);
});

test("fotos inseguras no se sirven", async () => {
  for (const f of ["../x", "https://evil.com/a.jpg", "foo/bar.jpg", "a..b.jpg", "x.svg", "", null]) {
    assert.equal(Sup.fotoSegura(f), "", String(f));
    let llamado = false;
    assert.equal(await Sup.fotoBytes(f, { fetchFn: async () => ((llamado = true), { ok: true }) }), null);
    assert.equal(llamado, false);
  }
  await setJSON("x", 1); // asegura el almacén en memoria
  await Sup.leer();
  const { sharedPipe } = await import("../api/_lib/store.js");
  await sharedPipe([["SET", Sup.K.cat, JSON.stringify([{ id: "mala", nombre: "Mala", estado: "disponible", tallas: [], foto: "../x" }, ...Sup.SEED])]]);
  assert.equal((await get("supply/mala/photo")).status, 404);
  await sharedPipe([["DEL", Sup.K.cat]]);
});

test("si el archivo no está en disco se pide solo a www.novasupply.es", async () => {
  const urls = [];
  const fetchFn = async (u) => (urls.push(u), { ok: true, arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 1]).buffer });
  const r = await Sup.fotoBytes("nueva-foto.png", { fetchFn });
  assert.deepEqual(urls, ["https://www.novasupply.es/nueva-foto.png"]);
  assert.equal(r.type, "image/png");
  assert.equal(r.bytes.length, 3);
});
