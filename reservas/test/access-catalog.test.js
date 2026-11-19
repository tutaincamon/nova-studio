import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BUSINESS } from "../api/_lib/config.js";
import { accessPolicy } from "../api/_lib/access.js";
import handler from "../api/handler.js";

function call(method, path, { body, ip = "203.0.113.10", headers = {} } = {}) {
  const hdrs = new Map();
  let status = 200;
  let raw = "";
  const req = {
    method,
    url: "/api/" + path,
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body,
  };
  const res = {
    setHeader(k, v) {
      hdrs.set(String(k).toLowerCase(), v);
    },
    getHeader(k) {
      return hdrs.get(String(k).toLowerCase());
    },
    end(b) {
      raw = b == null ? "" : String(b);
    },
  };
  Object.defineProperty(res, "statusCode", {
    get() {
      return status;
    },
    set(v) {
      status = v;
    },
  });
  return handler(req, res).then(() => {
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    const cookies = [].concat(hdrs.get("set-cookie") || []);
    return { status, json, cookies };
  });
}

const sessionCookie = (cookies) => cookies.some((c) => String(c).startsWith("nova_s="));
const sessionLine = (cookies) => [].concat(cookies).find((c) => String(c).startsWith("nova_s=")) || "";
const sessionValue = (cookies) => sessionLine(cookies).slice("nova_s=".length).split(";")[0];
const YEAR = 365 * 86400;

describe("acceso y catálogo", { concurrency: 1 }, () => {
test("la política de acceso exige código y en Vercel no deja entrar solo con el correo", () => {
  assert.equal(accessPolicy({}).code, true);
  assert.equal(accessPolicy({}).direct, false);
  assert.equal(accessPolicy({ LOGIN_CON_CODIGO: "0" }).direct, true);
  const prod = accessPolicy({ VERCEL: "1", LOGIN_CON_CODIGO: "0" });
  assert.equal(prod.direct, false);
  assert.equal(prod.code, true);
  assert.equal(prod.email, false);
  assert.equal(accessPolicy({ VERCEL: "1", RESEND_API_KEY: "re_test" }).email, true);
  const demo = accessPolicy({ VERCEL: "1", MODO_DEMO: "1" });
  assert.equal(demo.direct, true);
  assert.equal(demo.code, false);
  assert.equal(demo.demo, true);
  assert.equal(demo.email, true);
});

test("el catálogo público no incluye el NIF ni el nombre del titular", async () => {
  const { status, json } = await call("GET", "catalog");
  assert.equal(status, 200);
  assert.equal("nif" in json.business, false);
  assert.equal("holder" in json.business, false);
  assert.equal(json.business.name, BUSINESS.name);
  assert.ok(json.business.phone);
  assert.ok(json.business.whatsapp);
  assert.ok(json.services.length);
});

test("el aviso legal sigue devolviendo titular y NIF", async () => {
  const { status, json } = await call("GET", "legal");
  assert.equal(status, 200);
  assert.equal(json.holder, BUSINESS.holder);
  assert.equal(json.nif, BUSINESS.nif);
});

test("en local el correo no abre sesión hasta acertar el código", async () => {
  const prev = process.env.LOGIN_CON_CODIGO;
  delete process.env.LOGIN_CON_CODIGO;
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try {
    const res = await call("POST", "auth/request", { body: { email: "ana@example.com" }, ip: "203.0.113.21" });
    assert.equal(res.status, 200);
    assert.equal(res.json.direct, undefined);
    assert.equal(res.json.dev, true);
    assert.ok(res.json.challenge);
    assert.equal(sessionCookie(res.cookies), false);
    const code = logs.join("\n").match(/\b(\d{6})\b/)[1];
    const ok = await call("POST", "auth/verify", {
      body: { challenge: res.json.challenge, code },
      ip: "203.0.113.21",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
    assert.equal(sessionCookie(ok.cookies), true);
  } finally {
    console.log = orig;
    if (prev === undefined) delete process.env.LOGIN_CON_CODIGO;
    else process.env.LOGIN_CON_CODIGO = prev;
  }
});

test("en producción, sin correo configurado, no se abre sesión", async () => {
  const saved = {
    VERCEL: process.env.VERCEL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    LOGIN_CON_CODIGO: process.env.LOGIN_CON_CODIGO,
    MODO_DEMO: process.env.MODO_DEMO,
  };
  process.env.VERCEL = "1";
  delete process.env.RESEND_API_KEY;
  delete process.env.MODO_DEMO;
  process.env.LOGIN_CON_CODIGO = "0";
  try {
    const res = await call("POST", "auth/request", { body: { email: "otro@example.com" }, ip: "203.0.113.22" });
    assert.equal(res.status, 503);
    assert.match(res.json.error, /código/);
    assert.match(res.json.error, /No hemos abierto ninguna sesión/);
    assert.equal(sessionCookie(res.cookies), false);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("MODO_DEMO entra solo con el correo y deja la cookie un año", async () => {
  const saved = { VERCEL: process.env.VERCEL, MODO_DEMO: process.env.MODO_DEMO, RESEND_API_KEY: process.env.RESEND_API_KEY, LOGIN_CON_CODIGO: process.env.LOGIN_CON_CODIGO };
  delete process.env.VERCEL;
  delete process.env.RESEND_API_KEY;
  delete process.env.LOGIN_CON_CODIGO;
  process.env.MODO_DEMO = "1";
  try {
    const res = await call("POST", "auth/request", {
      body: { email: "demo@example.com" },
      ip: "203.0.113.30",
      headers: { "x-forwarded-proto": "https" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.direct, true);
    const line = sessionLine(res.cookies);
    assert.match(line, /Max-Age=31536000/);
    assert.match(line, /Expires=/);
    assert.match(line, /HttpOnly/);
    assert.match(line, /SameSite=Lax/);
    assert.match(line, /Secure/);
    assert.match(line, /Path=\//);
    assert.equal(line.includes("Max-Age=" + YEAR), true);
    const me = await call("GET", "me", { headers: { cookie: "nova_s=" + sessionValue(res.cookies) }, ip: "203.0.113.30" });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, "demo@example.com");
    assert.equal(me.json.auth.demo, true);
    assert.match(sessionLine(me.cookies), /Max-Age=31536000/);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("un código nuevo no cierra las sesiones ya abiertas", async () => {
  const prev = process.env.LOGIN_CON_CODIGO;
  process.env.LOGIN_CON_CODIGO = "0";
  delete process.env.VERCEL;
  delete process.env.MODO_DEMO;
  try {
    const first = await call("POST", "auth/request", { body: { email: "dos@example.com" }, ip: "203.0.113.31" });
    const second = await call("POST", "auth/request", { body: { email: "dos@example.com" }, ip: "203.0.113.32" });
    const a = sessionValue(first.cookies);
    const b = sessionValue(second.cookies);
    assert.ok(a && b && a !== b);
    const meA = await call("GET", "me", { headers: { cookie: "nova_s=" + a }, ip: "203.0.113.31" });
    const meB = await call("GET", "me", { headers: { cookie: "nova_s=" + b }, ip: "203.0.113.32" });
    assert.equal(meA.json.user.email, "dos@example.com");
    assert.equal(meB.json.user.email, "dos@example.com");
    const out = await call("POST", "auth/logout", { body: {}, headers: { cookie: "nova_s=" + b }, ip: "203.0.113.32" });
    assert.equal(out.status, 200);
    const still = await call("GET", "me", { headers: { cookie: "nova_s=" + a }, ip: "203.0.113.31" });
    const gone = await call("GET", "me", { headers: { cookie: "nova_s=" + b }, ip: "203.0.113.32" });
    assert.equal(still.json.user.email, "dos@example.com");
    assert.equal(gone.json.user, null);
  } finally {
    if (prev === undefined) delete process.env.LOGIN_CON_CODIGO;
    else process.env.LOGIN_CON_CODIGO = prev;
  }
});

test("el nombre es obligatorio y el teléfono no bloquea el alta", async () => {
  const prev = process.env.LOGIN_CON_CODIGO;
  process.env.LOGIN_CON_CODIGO = "0";
  delete process.env.VERCEL;
  try {
    const enter = await call("POST", "auth/request", { body: { email: "ana2@example.com" }, ip: "203.0.113.33" });
    const cookie = "nova_s=" + sessionValue(enter.cookies);
    const missing = await call("POST", "auth/name", { body: { name: "A" }, headers: { cookie }, ip: "203.0.113.33" });
    assert.equal(missing.status, 400);
    const ok = await call("POST", "auth/name", { body: { name: "Ana" }, headers: { cookie }, ip: "203.0.113.33" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.name, "Ana");
    assert.equal(ok.json.user.phone, "");
    const bad = await call("POST", "auth/name", { body: { name: "Ana", phone: "12" }, headers: { cookie }, ip: "203.0.113.33" });
    assert.equal(bad.status, 400);
    const withPhone = await call("POST", "auth/name", {
      body: { name: "Ana", phone: "+34 600 111 222" },
      headers: { cookie },
      ip: "203.0.113.33",
    });
    assert.equal(withPhone.status, 200);
    assert.equal(withPhone.json.user.phone, "+34 600 111 222");
  } finally {
    if (prev === undefined) delete process.env.LOGIN_CON_CODIGO;
    else process.env.LOGIN_CON_CODIGO = prev;
  }
});
});
