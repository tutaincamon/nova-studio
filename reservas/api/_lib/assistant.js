// Tokens de asistente de IA: la llave con la que un asistente (Claude, ChatGPT,
// Grok…) reserva por orden del cliente, sin navegador ni contraseña.
//
// - Se generan con 32 bytes aleatorios y el prefijo «nova_ast_», para que se
//   reconozcan a simple vista (y en un escáner de secretos).
// - En la base solo se guarda su resumen sha256, nunca el token: quien lea la
//   base (o una copia de seguridad) no puede usarlo. Se enseña una sola vez.
// - Duran TOKEN_DAYS días desde el último uso (cada uso los renueva) y se
//   pueden revocar uno a uno desde el perfil o desde el propio asistente.
// - Como mucho MAX_TOKENS por cliente: al crear uno más se revoca el más antiguo.
//
// Claves: «ast:<sha256>» → { id, email, label, via, created, used, exp }
//         «uast:<correo>» (hash) → id público → sha256
import crypto from "node:crypto";
import { cmd, pipe, getJSON } from "./store.js";

export const TOKEN_PREFIX = "nova_ast_";
export const TOKEN_DAYS = 180;
export const MAX_TOKENS = 5;
const TTL = TOKEN_DAYS * 86400;
const TOUCH_MS = 10 * 60 * 1000; // el «último uso» se apunta como mucho cada 10 minutos
const FORMAT = /^nova_ast_[A-Za-z0-9_-]{43}$/;

export const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
export const looksLikeToken = (t) => FORMAT.test(String(t || ""));
const iso = (ms) => new Date(ms).toISOString();
const publicOf = ({ id, label, via, created, used, exp }) => ({ id, label, via, created, used: used || null, exp });

// Los tokens de un correo, con su registro (null si ya caducó).
async function entries(email) {
  const raw = await cmd("HGETALL", "uast:" + email);
  const pairs = [];
  for (let i = 0; i < (raw || []).length; i += 2) pairs.push({ id: raw[i], hash: raw[i + 1] });
  if (!pairs.length) return [];
  const recs = await cmd("MGET", ...pairs.map((p) => "ast:" + p.hash));
  return pairs.map((p, i) => {
    const rec = recs[i] ? JSON.parse(recs[i]) : null;
    return { ...p, rec: rec && rec.email === email && Date.parse(rec.exp) > Date.now() ? rec : null };
  });
}

// Crea un token para `email`. Devuelve el token en claro (solo esta vez) y sus datos públicos.
export async function createToken(email, { label = "Asistente de IA", via = "perfil" } = {}) {
  const list = await entries(email);
  const ops = list.filter((x) => !x.rec).map((x) => ["HDEL", "uast:" + email, x.id]);
  const alive = list.filter((x) => x.rec).sort((a, b) => a.rec.created.localeCompare(b.rec.created));
  while (alive.length >= MAX_TOKENS) {
    const old = alive.shift();
    ops.push(["DEL", "ast:" + old.hash], ["HDEL", "uast:" + email, old.id]);
  }
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const hash = hashToken(token);
  const now = Date.now();
  const rec = { id: crypto.randomBytes(6).toString("hex"), email, label: String(label).slice(0, 60), via, created: iso(now), used: null, exp: iso(now + TTL * 1000) };
  ops.push(["SET", "ast:" + hash, JSON.stringify(rec), "EX", TTL], ["HSET", "uast:" + email, rec.id, hash]);
  await pipe(ops);
  return { token, ...publicOf(rec) };
}

// El registro del token si vale (y lo renueva), o null.
export async function verifyToken(token) {
  if (!looksLikeToken(token)) return null;
  const hash = hashToken(token);
  const rec = await getJSON("ast:" + hash);
  if (!rec || !(Date.parse(rec.exp) > Date.now())) return null;
  const now = Date.now();
  if (!rec.used || now - Date.parse(rec.used) > TOUCH_MS) {
    rec.used = iso(now);
    rec.exp = iso(now + TTL * 1000);
    await cmd("SET", "ast:" + hash, JSON.stringify(rec), "EX", TTL);
  }
  return { ...rec, hash };
}

export async function listTokens(email) {
  return (await entries(email))
    .filter((x) => x.rec)
    .map((x) => publicOf(x.rec))
    .sort((a, b) => b.created.localeCompare(a.created));
}

// Revoca un token por su id público. Devuelve true si existía.
export async function revokeToken(email, id) {
  const hash = await cmd("HGET", "uast:" + email, String(id || ""));
  if (!hash) return false;
  await pipe([
    ["DEL", "ast:" + hash],
    ["HDEL", "uast:" + email, String(id)],
  ]);
  return true;
}

// Al borrar una cuenta: fuera todos sus tokens.
export async function revokeAll(email) {
  const list = await entries(email);
  await pipe([...list.map((x) => ["DEL", "ast:" + x.hash]), ["DEL", "uast:" + email]]);
}
