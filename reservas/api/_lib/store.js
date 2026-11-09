// Base de datos: Redis por REST (Upstash / Vercel KV).
// Sin credenciales y fuera de Vercel se usa una memoria local, para probar en
// el ordenador. En Vercel sin credenciales se niega a arrancar: una memoria
// que se borra en cada arranque perdería reservas sin avisar.

const PREFIX = process.env.STORE_PREFIX || "bnova:";

function creds() {
  const e = process.env;
  for (const [u, t] of [
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ])
    if (e[u] && e[t]) return { url: e[u].replace(/\/$/, ""), token: e[t] };
  return null;
}

// ── Redis por REST ──────────────────────────────────────────────────────────
async function rest(path, body) {
  const c = creds();
  const r = await fetch(c.url + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw Error(`Base de datos: ${r.status}`);
  return r.json();
}

// ── Memoria local (solo para desarrollo) ───────────────────────────────────
const mem = new Map(); // clave -> { v, exp }
const alive = (k) => {
  const e = mem.get(k);
  if (!e) return undefined;
  if (e.exp && e.exp < Date.now()) {
    mem.delete(k);
    return undefined;
  }
  return e;
};
function local([cmd, ...a]) {
  cmd = cmd.toUpperCase();
  const k = a[0];
  switch (cmd) {
    case "GET":
      return alive(k)?.v ?? null;
    case "MGET":
      return a.map((x) => alive(x)?.v ?? null);
    case "SET": {
      const opts = a.slice(2).map(String);
      if (opts.includes("NX") && alive(k)) return null;
      const ex = opts.indexOf("EX");
      mem.set(k, { v: String(a[1]), exp: ex >= 0 ? Date.now() + Number(opts[ex + 1]) * 1000 : 0 });
      return "OK";
    }
    case "DEL":
      return a.reduce((n, x) => n + (mem.delete(x) ? 1 : 0), 0);
    case "INCR": {
      const v = Number(alive(k)?.v || 0) + 1;
      mem.set(k, { v: String(v), exp: alive(k)?.exp || 0 });
      return v;
    }
    case "EXPIRE": {
      const e = alive(k);
      if (!e) return 0;
      e.exp = Date.now() + Number(a[1]) * 1000;
      return 1;
    }
    case "SADD":
    case "SREM":
    case "SMEMBERS": {
      const e = alive(k) || { v: new Set(), exp: 0 };
      if (!(e.v instanceof Set)) e.v = new Set();
      if (cmd === "SMEMBERS") return [...e.v];
      let n = 0;
      for (const x of a.slice(1)) {
        const had = e.v.has(String(x));
        if (cmd === "SADD" && !had) (e.v.add(String(x)), n++);
        if (cmd === "SREM" && had) (e.v.delete(String(x)), n++);
      }
      mem.set(k, e);
      return n;
    }
    case "HSET":
    case "HDEL":
    case "HGETALL": {
      const e = alive(k) || { v: new Map(), exp: 0 };
      if (!(e.v instanceof Map)) e.v = new Map();
      if (cmd === "HGETALL") return [...e.v].flat();
      let n = 0;
      if (cmd === "HSET") for (let i = 1; i < a.length; i += 2) (e.v.set(String(a[i]), String(a[i + 1])), n++);
      else for (const f of a.slice(1)) n += e.v.delete(String(f)) ? 1 : 0;
      mem.set(k, e);
      return n;
    }
    default:
      throw Error("Comando no soportado en memoria: " + cmd);
  }
}

if (!creds() && process.env.VERCEL)
  console.error("Falta la base de datos: KV_REST_API_URL / KV_REST_API_TOKEN");

// Las claves de cada comando llevan el prefijo de esta app. Así puede compartir
// la base con la web de NOVA sin pisarse.
const KEYED_ALL = new Set(["MGET", "DEL"]);
const withPrefix = ([cmd, ...a]) => {
  const c = cmd.toUpperCase();
  if (KEYED_ALL.has(c)) return [c, ...a.map((k) => PREFIX + k)];
  return [c, PREFIX + a[0], ...a.slice(1)];
};

export async function cmd(...args) {
  const full = withPrefix(args);
  if (!creds()) {
    if (process.env.VERCEL) throw Error("La base de datos no está conectada.");
    return local(full);
  }
  const j = await rest("", full);
  if (j.error) throw Error(j.error);
  return j.result;
}

export async function pipe(list) {
  if (!list.length) return [];
  const full = list.map(withPrefix);
  if (!creds()) {
    if (process.env.VERCEL) throw Error("La base de datos no está conectada.");
    return full.map(local);
  }
  const j = await rest("/pipeline", full);
  return j.map((x) => {
    if (x.error) throw Error(x.error);
    return x.result;
  });
}

export const getJSON = async (k) => {
  const v = await cmd("GET", k);
  return v ? JSON.parse(v) : null;
};
export const setJSON = (k, v, ...opts) => cmd("SET", k, JSON.stringify(v), ...opts);
export const hgetall = (arr) => {
  const o = {};
  for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};
export const usingMemory = () => !creds();
