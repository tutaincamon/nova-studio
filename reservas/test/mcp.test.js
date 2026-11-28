// Servidor MCP (/api/mcp) y tokens de asistente de IA, con la base en memoria.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, mock, test } from "node:test";
import handler from "../api/handler.js";
import { cmd, dumpKeys, getJSON, scanKeys, setJSON } from "../api/_lib/store.js";
import { RULES, SERVICES } from "../api/_lib/config.js";
import * as T from "../api/_lib/time.js";

function http(method, route, { body, raw, ip = "198.51.100.10", headers = {} } = {}) {
  const hdrs = new Map();
  let status = 200;
  let out = "";
  const req = {
    method,
    url: "/api/handler?route=" + route,
    headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "nova.test", ...headers },
    body: raw !== undefined ? raw : body,
  };
  const res = {
    setHeader: (k, v) => hdrs.set(String(k).toLowerCase(), v),
    getHeader: (k) => hdrs.get(String(k).toLowerCase()),
    end: (b) => (out = b == null ? "" : String(b)),
  };
  Object.defineProperty(res, "statusCode", { get: () => status, set: (v) => (status = v) });
  return handler(req, res).then(() => {
    let json = null;
    try {
      json = out ? JSON.parse(out) : null;
    } catch {}
    return { status, headers: hdrs, text: out, json, cookies: [].concat(hdrs.get("set-cookie") || []) };
  });
}
let rid = 0;
const rpc = (method, params, opts = {}) => http("POST", "mcp", { body: { jsonrpc: "2.0", id: ++rid, method, ...(params !== undefined ? { params } : {}) }, ...opts });
const tool = async (name, args, opts = {}) => {
  const r = await rpc("tools/call", { name, arguments: args }, opts);
  return { ...r, result: r.json?.result, error: r.json?.error, text: r.json?.result?.content?.[0]?.text || "" };
};
const bearer = (t) => ({ authorization: "Bearer " + t });

// Un martes-viernes con al menos `ahead` días de margen (el salón abre de 10 a 20).
function workday(ahead = 2) {
  const today = T.nowLocal().date;
  for (let i = ahead; i < 40; i++) {
    const d = T.addDays(today, i);
    if ([2, 3, 4, 5].includes(T.weekday(d))) return d;
  }
}
// Cuenta con token, en modo demo, lista para reservar (con tarjeta en garantía de prueba).
async function client(email, ip) {
  await tool("request_login_code", { email }, { ip });
  const v = await tool("verify_login_code", { email, code: "000000", name: "Cliente " + email.split("@")[0] }, { ip });
  assert.equal(v.result.isError, false, v.text);
  const u = await getJSON("user:" + email);
  await setJSON("user:" + email, { ...u, card: { brand: "visa", last4: "4242", exp: "12/30", pm: "pm_test" } });
  return v.result.structuredContent.token;
}

const ENV = ["MODO_DEMO", "VERCEL", "RESEND_API_KEY", "LOGIN_CON_CODIGO"];
const saved = {};
before(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  process.env.MODO_DEMO = "1";
});
after(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("servidor MCP", { concurrency: 1 }, () => {
  test("initialize negocia la versión y anuncia herramientas", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /application\/json/);
    assert.equal(r.json.jsonrpc, "2.0");
    assert.equal(r.json.result.protocolVersion, "2025-03-26");
    assert.deepEqual(r.json.result.capabilities.tools, { listChanged: false });
    assert.equal(r.json.result.serverInfo.name, "nova-studio-reservas");
    assert.ok(r.json.result.instructions);
    const later = await rpc("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    assert.equal(later.json.result.protocolVersion, "2025-06-18");
  });

  test("notifications/initialized responde 202 sin cuerpo y ping devuelve {}", async () => {
    const n = await http("POST", "mcp", { body: { jsonrpc: "2.0", method: "notifications/initialized" } });
    assert.equal(n.status, 202);
    assert.equal(n.text, "");
    const p = await rpc("ping");
    assert.deepEqual(p.json.result, {});
  });

  test("tools/list devuelve las 9 herramientas con esquemas estrictos", async () => {
    const r = await rpc("tools/list", {});
    const names = r.json.result.tools.map((t) => t.name);
    assert.deepEqual(names.sort(), ["cancel_booking", "create_booking", "get_availability", "list_barbers", "list_my_bookings", "list_services", "request_login_code", "revoke_assistant_token", "verify_login_code"]);
    for (const t of r.json.result.tools) {
      assert.equal(t.inputSchema.type, "object");
      assert.equal(t.inputSchema.additionalProperties, false);
      assert.ok(t.description.length > 20);
    }
  });

  test("list_services y list_barbers funcionan sin token y sin datos privados", async () => {
    const s = await tool("list_services", {});
    assert.equal(s.result.isError, false);
    for (const x of SERVICES) {
      const got = s.result.structuredContent.services.find((y) => y.id === x.id);
      assert.equal(got.price_eur, x.price ?? null);
      assert.equal(got.bookable, !x.consult);
    }
    assert.match(s.text, /Corte de pelo/);
    const b = await tool("list_barbers", {});
    assert.equal(b.result.isError, false);
    assert.ok(b.result.structuredContent.barbers.length >= 1);
    for (const p of b.result.structuredContent.barbers) {
      for (const k of ["email", "pinHash", "commission", "hours"]) assert.equal(k in p, false);
    }
  });

  test("antelación mínima de 15 min: el mismo día no salen huecos que empiecen antes", async () => {
    assert.equal(RULES.leadMinutes, 15);
    const date = "2026-12-02"; // miércoles; el salón abre de 10 a 20 (hora de Canarias, UTC+0 en invierno)
    const slotsAt = async (hhmm) => {
      mock.timers.enable({ apis: ["Date"], now: new Date(`${date}T${hhmm}:00Z`) });
      try {
        const r = await tool("get_availability", { service_id: "corte", date, barber_id: "airam" });
        assert.equal(r.result.isError, false, r.text);
        return r.result.structuredContent.days[0].slots.map((x) => x.time);
      } finally {
        mock.timers.reset();
      }
    };
    const a = await slotsAt("12:15"); // 12:30 empieza justo a 15 min: sale
    assert.equal(a.includes("12:30"), true);
    assert.equal(a.includes("12:00"), false);
    const b = await slotsAt("12:16"); // 12:30 empieza a 14 min: no sale
    assert.equal(b.includes("12:30"), false);
    assert.equal(b.includes("13:00"), true);
  });

  test("get_availability devuelve huecos de varios días y valida los argumentos", async () => {
    const date = workday();
    const r = await tool("get_availability", { service_id: "corte", date, days: 2 });
    assert.equal(r.result.isError, false);
    const days = r.result.structuredContent.days;
    assert.equal(days.length, 2);
    assert.equal(days[0].date, date);
    assert.ok(days[0].slots.length > 0);
    assert.match(days[0].slots[0].time, /^\d{2}:\d{2}$/);
    assert.ok(days[0].slots[0].barbers.length >= 1);
    const one = await tool("get_availability", { service_id: "privado", date, barber_id: "ehedey" });
    assert.equal(one.result.isError, true);
    assert.match(one.text, /no hace/);
    const consult = await tool("get_availability", { service_id: "vip", date });
    assert.equal(consult.result.isError, true);
    assert.match(consult.text, /WhatsApp/);
    const tooMany = await tool("get_availability", { service_id: "corte", date, days: 15 });
    assert.equal(tooMany.error.code, -32602);
    const past = await tool("get_availability", { service_id: "corte", date: "2020-01-01" });
    assert.equal(past.result.isError, true);
  });

  test("flujo completo en MODO_DEMO: código, token, reservar, ver y cancelar", async () => {
    const ip = "198.51.100.20";
    const email = "ia-flujo@example.com";
    const req = await tool("request_login_code", { email }, { ip });
    assert.equal(req.result.isError, false);
    assert.equal(req.result.structuredContent.demo, true);
    assert.match(req.text, /Modo demo/);

    const noName = await tool("verify_login_code", { email, code: "000000" }, { ip });
    assert.equal(noName.result.isError, true);
    assert.match(noName.text, /nombre/);

    const v = await tool("verify_login_code", { email, code: "000000", name: "Ana IA", phone: "+34 600 111 222", client_name: "Claude" }, { ip });
    assert.equal(v.result.isError, false, v.text);
    const token = v.result.structuredContent.token;
    assert.match(token, /^nova_ast_[A-Za-z0-9_-]{43}$/);
    assert.equal(v.result.structuredContent.token_type, "Bearer");
    assert.match(v.text, /Authorization: Bearer/);
    assert.match(v.result.structuredContent.mcp_url, /\/api\/mcp$/);
    const u = await getJSON("user:" + email);
    assert.equal(u.name, "Ana IA");
    assert.equal(u.phone, "+34 600 111 222");

    const date = workday(3);
    const args = { service_id: "corte", barber_id: "airam", date, time: "11:00", accept_terms: true, note: "Degradado bajo" };

    // Sin token: error claro con cómo conseguirlo.
    const anon = await tool("create_booking", args, { ip });
    assert.equal(anon.result.isError, true);
    assert.match(anon.text, /request_login_code/);

    // Sin tarjeta en garantía (Stripe de prueba activo): no se salta la regla, manda a la web.
    const card = await tool("create_booking", args, { ip, headers: bearer(token) });
    assert.equal(card.result.isError, true);
    assert.equal(card.result.structuredContent.need_card, true);
    assert.match(card.result.structuredContent.url, /\/perfil$/);

    await setJSON("user:" + email, { ...u, card: { brand: "visa", last4: "4242", exp: "12/30", pm: "pm_test" } });
    const terms = await tool("create_booking", { ...args, accept_terms: false }, { ip, headers: bearer(token) });
    assert.equal(terms.result.isError, true);
    assert.match(terms.text, /condiciones/);

    const ok = await tool("create_booking", args, { ip, headers: bearer(token) });
    assert.equal(ok.result.isError, false, ok.text);
    const b = ok.result.structuredContent.booking;
    assert.equal(b.barber.id, "airam");
    assert.equal(b.date, date);
    assert.equal(b.start, "11:00");
    assert.equal(b.service.price_eur, 15);
    const stored = await getJSON("bk:" + b.id);
    assert.equal(stored.email, email);
    assert.equal(stored.via, "asistente");
    assert.equal(stored.note, "Degradado bajo");

    // La misma hora ya no sale libre ni se puede volver a coger.
    const avail = await tool("get_availability", { service_id: "corte", date, barber_id: "airam" });
    assert.equal(avail.result.structuredContent.days[0].slots.some((x) => x.time === "11:00"), false);
    const again = await tool("create_booking", args, { ip, headers: bearer(token) });
    assert.equal(again.result.isError, true);

    const mine = await tool("list_my_bookings", {}, { ip, headers: bearer(token) });
    assert.equal(mine.result.isError, false);
    assert.deepEqual(mine.result.structuredContent.upcoming.map((x) => x.id), [b.id]);
    assert.equal(mine.result.structuredContent.upcoming[0].free_cancellation, true);

    // El token también vale como argumento, para clientes sin cabeceras.
    const viaArg = await tool("list_my_bookings", { assistant_token: token }, { ip });
    assert.equal(viaArg.result.isError, false);
    assert.equal(viaArg.result.structuredContent.upcoming.length, 1);

    const cancel = await tool("cancel_booking", { booking_id: b.id }, { ip, headers: bearer(token) });
    assert.equal(cancel.result.isError, false, cancel.text);
    assert.equal(cancel.result.structuredContent.late, false);
    assert.equal((await getJSON("bk:" + b.id)).status, "canceled");
    const empty = await tool("list_my_bookings", {}, { ip, headers: bearer(token) });
    assert.equal(empty.result.structuredContent.upcoming.length, 0);
  });

  test("no se cancelan citas de otros y la cancelación tardía pide confirmar el cargo", async () => {
    const a = await client("ia-a@example.com", "198.51.100.30");
    const bTok = await client("ia-b@example.com", "198.51.100.31");
    const date = workday(4);
    const made = await tool("create_booking", { service_id: "corte-barba", date, time: "12:00", accept_terms: true }, { headers: bearer(a) });
    assert.equal(made.result.isError, false, made.text);
    const id = made.result.structuredContent.booking.id;

    const other = await tool("cancel_booking", { booking_id: id }, { headers: bearer(bTok) });
    assert.equal(other.result.isError, true);
    assert.equal((await getJSON("bk:" + id)).status, "confirmed");

    // Con una política de cancelación muy larga, esta cita ya está «dentro del plazo».
    await setJSON("norms", { cancelHours: 2000 });
    try {
      const warn = await tool("cancel_booking", { booking_id: id }, { headers: bearer(a) });
      assert.equal(warn.result.isError, true);
      assert.equal(warn.result.structuredContent.late, true);
      assert.ok(warn.result.structuredContent.fee_eur > 0);
      assert.equal((await getJSON("bk:" + id)).status, "confirmed");
      const done = await tool("cancel_booking", { booking_id: id, accept_late_fee: true }, { headers: bearer(a) });
      assert.equal(done.result.isError, false, done.text);
      assert.equal(done.result.structuredContent.late, true);
      assert.equal((await getJSON("bk:" + id)).late, true);
    } finally {
      await cmd("DEL", "norms");
    }
  });

  test("token inválido: 401 con WWW-Authenticate; revocar lo invalida", async () => {
    for (const bad of ["nova_ast_" + "x".repeat(43), "cualquier-cosa"]) {
      const r = await rpc("tools/list", {}, { headers: bearer(bad) });
      assert.equal(r.status, 401);
      assert.match(r.headers.get("www-authenticate"), /^Bearer /);
      assert.match(r.headers.get("www-authenticate"), /invalid_token/);
      assert.equal(r.json.error.code, -32001);
    }
    const badArg = await tool("list_my_bookings", { assistant_token: "nova_ast_" + "y".repeat(43) });
    assert.equal(badArg.result.isError, true);
    assert.match(badArg.text, /no es válido/);

    const token = await client("ia-revoke@example.com", "198.51.100.40");
    const ok = await tool("list_my_bookings", {}, { headers: bearer(token) });
    assert.equal(ok.result.isError, false);
    const rev = await tool("revoke_assistant_token", {}, { headers: bearer(token) });
    assert.equal(rev.result.isError, false);
    const gone = await tool("list_my_bookings", {}, { headers: bearer(token) });
    assert.equal(gone.status, 401);
  });

  test("el token solo se guarda resumido (sha256), nunca en claro", async () => {
    const token = await client("ia-hash@example.com", "198.51.100.50");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const all = JSON.stringify(await dumpKeys(await scanKeys("*")));
    assert.equal(all.includes(token), false);
    assert.equal(all.includes(token.slice("nova_ast_".length)), false);
    assert.ok((await scanKeys("ast:*")).includes("ast:" + hash));
    const rec = await getJSON("ast:" + hash);
    assert.equal(rec.email, "ia-hash@example.com");
    assert.ok(rec.created && rec.exp);
    assert.ok(Date.parse(rec.exp) - Date.now() > 170 * 86400000);
  });

  test("perfil web: crear, listar sin el token, máximo 5 y revocar", async () => {
    const ip = "198.51.100.60";
    const noSession = await http("POST", "assistant/tokens", { body: {}, ip });
    assert.equal(noSession.status, 401);
    const enter = await http("POST", "auth/request", { body: { email: "ia-web@example.com" }, ip });
    const cookie = "nova_s=" + enter.cookies.find((c) => c.startsWith("nova_s=")).slice(7).split(";")[0];
    await http("POST", "auth/name", { body: { name: "Web IA" }, headers: { cookie }, ip });

    const made = [];
    for (let i = 0; i < 6; i++) {
      const r = await http("POST", "assistant/tokens", { body: {}, headers: { cookie }, ip });
      assert.equal(r.status, 200);
      assert.match(r.json.token, /^nova_ast_/);
      assert.match(r.json.mcp, /\/api\/mcp$/);
      made.push(r.json);
    }
    const list = await http("GET", "assistant/tokens", { headers: { cookie }, ip });
    assert.equal(list.status, 200);
    assert.equal(list.json.tokens.length, 5);
    assert.equal(list.text.includes("nova_ast_"), false);
    assert.equal(list.json.tokens.some((t) => t.id === made[0].id), false); // el más antiguo, revocado
    assert.equal((await rpc("ping", undefined, { headers: bearer(made[0].token) })).status, 401);
    assert.equal((await rpc("ping", undefined, { headers: bearer(made[5].token) })).status, 200);

    const rv = await http("POST", `assistant/tokens/${made[5].id}/revoke`, { body: {}, headers: { cookie }, ip });
    assert.equal(rv.status, 200);
    assert.equal((await rpc("ping", undefined, { headers: bearer(made[5].token) })).status, 401);
    const again = await http("POST", `assistant/tokens/${made[5].id}/revoke`, { body: {}, headers: { cookie }, ip });
    assert.equal(again.status, 404);
  });

  test("límites: código por correo, reservas por token y llamadas por IP", async () => {
    const ip = "198.51.100.70";
    let last;
    for (let i = 0; i < 6; i++) last = await tool("request_login_code", { email: "ia-limite@example.com" }, { ip });
    assert.equal(last.result.isError, true);
    assert.match(last.text, /Demasiados/);

    const token = await client("ia-limite-book@example.com", "198.51.100.71");
    for (let i = 0; i < 11; i++) last = await tool("create_booking", { service_id: "no-existe", date: workday(), time: "10:00", accept_terms: true }, { headers: bearer(token) });
    assert.equal(last.result.isError, true);
    assert.match(last.text, /Demasiados/);

    const flood = "198.51.100.72";
    let r;
    for (let i = 0; i < 241; i++) r = await rpc("ping", undefined, { ip: flood });
    assert.equal(r.status, 429);
    assert.equal(r.json.error.code, -32000);
  });

  test("errores JSON-RPC y HTTP", async () => {
    const parse = await http("POST", "mcp", { raw: "{no es json" });
    assert.equal(parse.status, 400);
    assert.equal(parse.json.error.code, -32700);
    assert.equal(parse.json.id, null);

    const invalid = await http("POST", "mcp", { body: { jsonrpc: "1.0", id: 1, method: "ping" } });
    assert.equal(invalid.json.error.code, -32600);

    const unknown = await rpc("resources/list", {});
    assert.equal(unknown.json.error.code, -32601);

    const noTool = await tool("borrar_todo", {});
    assert.equal(noTool.error.code, -32602);
    const missing = await tool("get_availability", { date: "2026-12-01" });
    assert.equal(missing.error.code, -32602);
    assert.match(missing.error.message, /service_id/);
    const extra = await tool("list_services", { hack: true });
    assert.equal(extra.error.code, -32602);
    const badDate = await tool("get_availability", { service_id: "corte", date: "mañana" });
    assert.equal(badDate.error.code, -32602);

    const batch = await http("POST", "mcp", {
      body: [{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "b", method: "nada" }],
    });
    assert.equal(batch.status, 200);
    assert.equal(batch.json.length, 2);
    assert.deepEqual(batch.json[0], { jsonrpc: "2.0", id: "a", result: {} });
    assert.equal(batch.json[1].error.code, -32601);
    const emptyBatch = await http("POST", "mcp", { body: [] });
    assert.equal(emptyBatch.json.error.code, -32600);

    const get = await http("GET", "mcp");
    assert.equal(get.status, 405);
    assert.match(get.headers.get("allow"), /POST/);

    const version = await rpc("ping", undefined, { headers: { "mcp-protocol-version": "1999-01-01" } });
    assert.equal(version.status, 400);
    const okVersion = await rpc("ping", undefined, { headers: { "mcp-protocol-version": "2025-06-18" } });
    assert.equal(okVersion.status, 200);

    const evil = await rpc("ping", undefined, { headers: { origin: "https://evil.example" } });
    assert.equal(evil.status, 403);
    const own = await rpc("ping", undefined, { headers: { origin: "https://nova.test" } });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get("access-control-allow-origin"), "https://nova.test");
  });

  test("llms.txt y /.well-known/mcp.json salen de los datos de la app", async () => {
    const r = await http("GET", "llms.txt");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/plain/);
    assert.match(r.text, /^# NOVA Studio\n\n> /);
    assert.match(r.text, /https:\/\/nova\.test\/api\/mcp/);
    assert.match(r.text, /request_login_code/);
    for (const s of SERVICES) {
      assert.ok(r.text.includes(s.name), s.name);
      if (s.price != null) assert.ok(r.text.includes(`${s.name} (id \`${s.id}\`): ${s.price} €`), s.id);
    }
    const w = await http("GET", "well-known/mcp.json");
    assert.equal(w.status, 200);
    assert.equal(w.json.transport.type, "streamable-http");
    assert.equal(w.json.transport.url, "https://nova.test/api/mcp");
    assert.equal(w.json.tools.length, 9);
  });
});
