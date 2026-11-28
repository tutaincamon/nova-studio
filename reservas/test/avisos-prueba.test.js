// «Enviarme una prueba» del panel Avisos y reseñas: no toca clientes ni deduplicación, vista previa en demo,
// enlace de reserva real, solo dueño, límite por hora y envío real simulado con fetch falso.
import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

const ENV = ["MODO_DEMO", "VERCEL", "CRON_SECRET", "RESEND_API_KEY", "GOOGLE_REVIEW_URL", "STAFF_PIN", "STAFF_PIN_EHEDEY"];
const saved = {};
let handler, store, T;

function http(method, route, { body, cookie, headers = {}, ip = "198.51.100.91" } = {}) {
  const hdrs = new Map();
  let status = 200,
    out = "";
  const req = { method, url: "/api/handler?route=" + route, headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "nova.test", ...(cookie ? { cookie } : {}), ...headers }, body };
  const res = { setHeader: (k, v) => hdrs.set(String(k).toLowerCase(), v), getHeader: (k) => hdrs.get(String(k).toLowerCase()), end: (b) => (out = b == null ? "" : String(b)) };
  Object.defineProperty(res, "statusCode", { get: () => status, set: (v) => (status = v) });
  return handler(req, res).then(() => {
    let json = null;
    try {
      json = out ? JSON.parse(out) : null;
    } catch {}
    return { status, json, cookies: [].concat(hdrs.get("set-cookie") || []) };
  });
}
let ipn = 0;
const nextIp = () => "198.51.103." + (++ipn % 250);
async function login(provider) {
  const r = await http("POST", "staff/login", { body: { provider, pin: "1234" }, ip: nextIp() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.cookies.find((c) => c.startsWith("nova_staff=")).split(";")[0];
}

before(async () => {
  for (const k of ENV) (saved[k] = process.env[k]), delete process.env[k];
  process.env.MODO_DEMO = "1";
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 27, 14, 0) }); // 27-nov-2026, 14:00 en Canarias
  handler = (await import("../api/handler.js")).default;
  store = await import("../api/_lib/store.js");
  T = await import("../api/_lib/time.js");
});
after(() => {
  mock.timers.reset();
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});


let owner;
const go = (body, cookie = owner) => http("POST", "staff/avisos/prueba", { cookie, body, ip: nextIp() });

describe("avisos: «Enviarme una prueba»", { concurrency: 1 }, () => {
  before(async () => {
    owner = await login("airam");
    await store.pipe([
      ["SET", "user:dorm@demo.test", JSON.stringify({ email: "dorm@demo.test", name: "Dormido Real" })],
      ["SADD", "users", "dorm@demo.test"],
    ]);
  });

  test("solo el dueño: barbero 403, sin sesión 401", async () => {
    const barber = await login("ehedey");
    assert.equal((await go({ email: "a@b.es", kind: "ambos" }, barber)).status, 403);
    assert.equal((await go({ email: "a@b.es", kind: "ambos" }, "")).status, 401);
  });

  test("valida el correo y la elección", async () => {
    assert.equal((await go({ email: "no-es-correo", kind: "ambos" })).status, 400);
    assert.equal((await go({ email: "a@b.es", kind: "otra" })).status, 400);
    assert.equal((await go({ email: "a@b.es", kind: "dormido" })).status, 200);
  });

  test("en demo: simulado, con vista previa, enlace de reserva real y sin tocar a nadie", async () => {
    await http("POST", "staff/rules", { cookie: owner, body: { reviewUrl: "https://g.page/r/ejemplo/review" }, ip: nextIp() });
    const before = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    assert.equal(before.json.testLimit, 10);
    const r = await go({ email: "Dueño.Prueba@Ejemplo.es", kind: "ambos" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.sim, true);
    assert.equal(r.json.example.name, "Carlos (ejemplo)");
    assert.equal(r.json.example.weeks, 7);
    assert.equal(r.json.sent.length, 2);
    const [d, v] = r.json.sent;
    assert.ok(d.status === "simulado" && v.status === "simulado");
    assert.ok(d.subject.startsWith("[Prueba] ") && v.subject.startsWith("[Prueba] "));
    assert.match(d.html, /Hola Carlos/);
    assert.match(d.html, /href="https:\/\/nova\.test\/#reservar\/[^/"]+\/[^/"]+"/); // servicio y barbero reales
    assert.match(v.html, /href="https:\/\/g\.page\/r\/ejemplo\/review"/);
    assert.doesNotMatch(d.html + v.html, /<script|\/api\/unsub\/|\/api\/resena\//);
    // No se tocó nada de ningún cliente ni de la deduplicación.
    const keys = await store.scanKeys("*");
    assert.ok(!keys.some((k) => /^(winback:|revreq:|revmail:|reviewed:|nomkt:)/.test(k)), keys.join(","));
    const after = await http("GET", "staff/avisos", { cookie: owner, ip: nextIp() });
    const dorm = after.json.dormant.find((x) => x.email === "dorm@demo.test");
    assert.ok(!dorm || dorm.lastNotice === null);
    // Queda en el historial, marcado como prueba, y no sale entre las peticiones de reseña de citas.
    const tests = after.json.log.filter((x) => x.test);
    assert.equal(tests.length, 3); // la del dormido de arriba (400/200 anterior) + las dos de ahora
    assert.ok(tests.every((x) => x.status === "simulado" && !x.bookingId));
    assert.deepEqual(after.json.reviews, []);
    assert.equal(after.json.config.auto, false); // sigue desactivado por defecto
  });

  test("con Resend configurado: envía solo al correo escrito y enseña el error de Resend sin secretos", async () => {
    process.env.RESEND_API_KEY = "re_clave_secreta_de_prueba";
    delete process.env.MODO_DEMO;
    const calls = [];
    const real = globalThis.fetch;
    let fail = false;
    globalThis.fetch = async (url, opt) => {
      calls.push({ url: String(url), body: JSON.parse(opt.body), auth: opt.headers.Authorization });
      return fail ? new Response(JSON.stringify({ message: "The domain is not verified" }), { status: 403 }) : new Response("{}", { status: 200 });
    };
    try {
      const ok = await go({ email: "yo@ejemplo.es", kind: "ambos" });
      assert.equal(ok.json.sim, false);
      assert.deepEqual(ok.json.sent.map((x) => x.status), ["enviado", "enviado"]);
      assert.equal(calls.length, 2);
      assert.ok(calls.every((c) => c.url === "https://api.resend.com/emails" && c.body.to.length === 1 && c.body.to[0] === "yo@ejemplo.es" && c.body.subject.startsWith("[Prueba] ")));
      fail = true;
      const bad = await go({ email: "yo@ejemplo.es", kind: "resena" });
      assert.equal(bad.status, 200);
      assert.equal(bad.json.ok, false);
      assert.equal(bad.json.sent[0].status, "fallido");
      assert.match(bad.json.sent[0].error, /not verified/);
      assert.ok(!JSON.stringify(bad.json).includes("re_clave_secreta"));
      const none = await store.scanKeys("*");
      assert.ok(!none.some((k) => /^(winback:|revreq:|revmail:)/.test(k)));
    } finally {
      globalThis.fetch = real;
      delete process.env.RESEND_API_KEY;
      process.env.MODO_DEMO = "1";
    }
  });

  test("límite: como mucho 10 pruebas por hora", async () => {
    const used = (await store.scanKeys("rl:avisotest:*")).length;
    assert.equal(used, 1);
    const sc = { status: 0 };
    for (let i = 0; i < 12 && sc.status !== 429; i++) sc.status = (await go({ email: "yo@ejemplo.es", kind: "dormido" })).status;
    assert.equal(sc.status, 429);
    assert.equal((await go({ email: "yo@ejemplo.es", kind: "dormido" })).status, 429);
  });
});
