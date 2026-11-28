// La ficha schema.org (JSON-LD) de index.html es estática: este test comprueba
// que sus precios y su horario siguen siendo los de config.js, y que la página
// no tiene scripts en línea que la CSP bloquearía.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { SERVICES, publicBusiness } from "../api/_lib/config.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], body: m[2] }));
const ld = JSON.parse(scripts.find((s) => /type="application\/ld\+json"/.test(s.attrs)).body);

test("index.html solo tiene scripts externos y bloques de datos JSON-LD (CSP sin unsafe-inline)", () => {
  for (const s of scripts) {
    if (/\bsrc=/.test(s.attrs)) continue;
    assert.match(s.attrs, /type="application\/ld\+json"/, "script en línea que la CSP bloquearía");
  }
});

test("el JSON-LD tiene los servicios reservables con los precios de config.js", () => {
  assert.equal(ld["@type"], "HairSalon");
  const offers = ld.hasOfferCatalog.itemListElement;
  const bookable = SERVICES.filter((s) => !s.consult);
  assert.equal(offers.length, bookable.length);
  for (const s of bookable) {
    const o = offers.find((x) => x.itemOffered.name === s.name);
    assert.ok(o, `falta ${s.name} en el JSON-LD`);
    assert.equal(Number(o.price), s.price, `precio de ${s.name}`);
    assert.equal(o.priceCurrency, "EUR");
  }
  const prices = bookable.map((s) => s.price);
  assert.ok(ld.priceRange.includes(`${Math.min(...prices)} €`));
  assert.ok(ld.priceRange.includes(`${Math.max(...prices)} €`));
  assert.equal(ld.potentialAction["@type"], "ReserveAction");
});

test("el horario del JSON-LD es el del salón", () => {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const specs = ld.openingHoursSpecification.flatMap((x) => [].concat(x.dayOfWeek).map((d) => [d, x.opens, x.closes]));
  const week = publicBusiness().week;
  for (let d = 0; d < 7; d++) {
    const want = (week[d] || []).map(([a, b]) => [names[d], a, b]);
    assert.deepEqual(specs.filter(([n]) => n === names[d]), want, names[d]);
  }
});

test("la dirección y el teléfono del JSON-LD son los de config.js", () => {
  const b = publicBusiness();
  assert.equal(ld.name, b.name);
  assert.equal(ld.telephone.replace(/\D/g, "").slice(-9), b.phone.replace(/\D/g, ""));
  assert.equal(ld.address.streetAddress.replace(/,/g, ""), b.street.replace(/,/g, ""));
});
