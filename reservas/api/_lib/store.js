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
    case "TTL": {
      const e = alive(k);
      return !e ? -2 : e.exp ? Math.ceil((e.exp - Date.now()) / 1000) : -1;
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

// ── Apartar y guardar de una vez (todo o nada) ─────────────────────────────
// `claim` comprueba que ninguno de los tramos `locks` es de otra cita; si no
// lo es, los aparta para `owner`, suelta los tramos de `release` que sean suyos
// y hace las escrituras de `writes`, todo en un solo paso dentro de Redis. Si
// la función se corta a medias no queda nada a medio hacer: ni un tramo
// apartado sin cita ni una cita sin su tramo.
// Devuelve true, o el id de la cita que ya tiene alguno de los tramos.
// `writes`: [["SET", clave, valor], ["HSET", clave, campo, valor], ["SADD"|"SREM"|"HDEL", clave, x]…]
const CLAIM_LUA = `
local n, r, owner, ttl = tonumber(ARGV[1]), tonumber(ARGV[2]), ARGV[3], tonumber(ARGV[4])
for i = 1, n do
  local v = redis.call('GET', KEYS[i])
  if v and v ~= owner then return v end
end
for i = n + 1, n + r do
  if redis.call('GET', KEYS[i]) == owner then redis.call('DEL', KEYS[i]) end
end
for i = 1, n do redis.call('SET', KEYS[i], owner, 'EX', ttl) end
local i = 5
while i <= #ARGV do
  local c, k, argc = ARGV[i], KEYS[tonumber(ARGV[i + 1])], tonumber(ARGV[i + 2])
  local a = {}
  for j = 1, argc do a[j] = ARGV[i + 2 + j] end
  redis.call(c, k, unpack(a))
  i = i + 3 + argc
end
return 'OK'`;

export async function claim(locks, owner, ttl, writes = [], release = []) {
  const keys = [...locks, ...release, ...writes.map((w) => w[1])].map((k) => PREFIX + k);
  const argv = [locks.length, release.length, owner, Math.max(1, Math.round(ttl))];
  writes.forEach((w, i) => argv.push(w[0].toUpperCase(), locks.length + release.length + i + 1, w.length - 2, ...w.slice(2).map(String)));
  if (!creds()) {
    if (process.env.VERCEL) throw Error("La base de datos no está conectada.");
    // En memoria no hay Lua, pero Node no corta este bucle a medias: es igual de atómico.
    for (const k of keys.slice(0, locks.length)) {
      const v = alive(k)?.v;
      if (v != null && v !== owner) return v;
    }
    for (const k of keys.slice(locks.length, locks.length + release.length)) if (alive(k)?.v === owner) mem.delete(k);
    for (const k of keys.slice(0, locks.length)) local(["SET", k, owner, "EX", argv[3]]);
    writes.forEach((w, i) => local([w[0], keys[locks.length + release.length + i], ...w.slice(2)]));
    return true;
  }
  const j = await rest("", ["EVAL", CLAIM_LUA, keys.length, ...keys, ...argv.map(String)]);
  if (j.error) throw Error(j.error);
  return j.result === "OK" ? true : String(j.result);
}

// Contador con caducidad para frenar abusos. Si alguna vez se queda sin
// caducidad (un corte entre los dos pasos), la siguiente llamada se la pone:
// nadie se queda bloqueado para siempre.
export async function hit(key, seconds) {
  const [n, ttl] = await pipe([
    ["INCR", key],
    ["TTL", key],
  ]);
  if (ttl < 0) await cmd("EXPIRE", key, seconds);
  return n;
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

// ── Copias de seguridad ─────────────────────────────────────────────────────
// Lista las claves de esta app (sin el prefijo) que encajan con `match`
// (solo admite «*» al final o «*» suelto).
export async function scanKeys(match = "*") {
  const full = PREFIX + match;
  if (!creds()) {
    const base = full.endsWith("*") ? full.slice(0, -1) : null;
    return [...mem.keys()].filter((k) => alive(k) && (base !== null ? k.startsWith(base) : k === full)).map((k) => k.slice(PREFIX.length));
  }
  const out = [];
  let cursor = "0";
  do {
    const j = await rest("", ["SCAN", cursor, "MATCH", full, "COUNT", 1000]);
    if (j.error) throw Error(j.error);
    cursor = String(j.result[0]);
    out.push(...j.result[1].map((k) => k.slice(PREFIX.length)));
  } while (cursor !== "0");
  return [...new Set(out)];
}
// Lee claves de cualquier tipo: [{ k, t: "string" | "set" | "hash", v }].
export async function dumpKeys(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 200) {
    const part = keys.slice(i, i + 200);
    let types;
    if (!creds()) types = part.map((k) => { const e = alive(PREFIX + k); return !e ? "none" : e.v instanceof Set ? "set" : e.v instanceof Map ? "hash" : "string"; });
    else types = (await rest("/pipeline", part.map((k) => ["TYPE", PREFIX + k]))).map((x) => x.result);
    const reads = part.map((k, j) => (types[j] === "set" ? ["SMEMBERS", k] : types[j] === "hash" ? ["HGETALL", k] : ["GET", k]));
    const vals = await pipe(reads);
    part.forEach((k, j) => {
      if (types[j] === "none" || vals[j] == null) return;
      out.push({ k, t: types[j] === "set" ? "set" : types[j] === "hash" ? "hash" : "string", v: types[j] === "hash" ? hgetall(vals[j]) : vals[j] });
    });
  }
  return out;
}
