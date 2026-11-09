// ─────────────────────────────────────────────────────────────────────────────
// Tarjeta en garantía con Stripe.
//
// El cliente guarda su tarjeta UNA vez (SetupIntent «off_session»): Stripe la
// guarda en su Customer y nosotros solo apuntamos su id, la marca y los 4 últimos
// números. Si falta a una cita sin avisar, el barbero pulsa «Cobrar» y se cobra
// el precio del servicio sin que el cliente esté delante (PaymentIntent
// off_session). Si su banco pide confirmación, el cliente la hace desde la app.
//
// Claves (en Vercel): STRIPE_SECRET_KEY (sk_…) y STRIPE_PUBLISHABLE_KEY (pk_…).
// Sin claves en Vercel, no se pide tarjeta. En local sin claves hay un «modo
// prueba» que imita a Stripe: tarjeta acabada en 0002 = rechazada al cobrar,
// en 3155 = el banco pide confirmación, cualquier otra = cobro correcto.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";

const KEY = process.env.STRIPE_SECRET_KEY || "";
const PK = process.env.STRIPE_PUBLISHABLE_KEY || "";
export const FAKE = !KEY && !process.env.VERCEL;
export const cardEnabled = () => (!!KEY && !!PK) || FAKE;
export const cardPublic = () => ({ enabled: cardEnabled(), pk: FAKE ? "" : PK, fake: FAKE });

class StripeError extends Error {}

// Stripe recibe los datos como formulario con corchetes: a[b][0]=c.
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function call(method, path, params, idem) {
  const r = await fetch("https://api.stripe.com/v1/" + path + (method === "GET" && params ? "?" + form(params) : ""), {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idem ? { "Idempotency-Key": idem } : {}),
    },
    body: method !== "GET" && params ? form(params) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new StripeError(j.error?.message || "Stripe no responde.");
    e.stripe = j.error || {};
    throw e;
  }
  return j;
}

const cardOf = (pm) =>
  pm?.card && { pm: pm.id, brand: pm.card.brand, last4: pm.card.last4, exp: `${String(pm.card.exp_month).padStart(2, "0")}/${String(pm.card.exp_year).slice(-2)}` };

// ── Modo prueba (solo en local) ──────────────────────────────────────────────
const fakeSetups = new Map(),
  fakeIntents = new Map();
const fid = (p) => p + "_fake_" + crypto.randomBytes(6).toString("hex");

// ── Lo que usa la API ────────────────────────────────────────────────────────
export async function ensureCustomer(u) {
  if (u.stripe) return u.stripe;
  if (FAKE) return fid("cus");
  const c = await call("POST", "customers", { email: u.email, name: u.name || undefined, phone: u.phone || undefined, metadata: { app: "nova-reservas" } }, "cus-" + u.email);
  return c.id;
}

export async function createSetup(customer) {
  if (FAKE) {
    const id = fid("seti");
    fakeSetups.set(id, { id, customer, status: "requires_payment_method" });
    return { id, clientSecret: id + "_secret" };
  }
  const si = await call("POST", "setup_intents", { customer, usage: "off_session", payment_method_types: ["card"], metadata: { app: "nova-reservas" } });
  return { id: si.id, clientSecret: si.client_secret };
}

// Comprueba que la tarjeta quedó guardada y la deja como la de ese cliente.
export async function finishSetup(id, customer, fakeNumber) {
  if (FAKE) {
    const si = fakeSetups.get(id);
    const digits = String(fakeNumber || "").replace(/\D/g, "");
    if (!si || si.customer !== customer) throw new StripeError("No encontramos esa tarjeta. Prueba otra vez.");
    if (digits.length < 12) throw new StripeError("Revisa el número de la tarjeta.");
    fakeSetups.delete(id);
    const brand = digits[0] === "4" ? "visa" : digits[0] === "5" ? "mastercard" : digits[0] === "3" ? "amex" : "card";
    return { pm: fid("pm") + "_" + digits.slice(-4), brand, last4: digits.slice(-4), exp: "12/30" };
  }
  const si = await call("GET", "setup_intents/" + encodeURIComponent(id), { expand: ["payment_method"] });
  if (si.customer !== customer) throw new StripeError("Esa tarjeta no es de tu cuenta.");
  if (si.status !== "succeeded") throw new StripeError("La tarjeta no se ha podido guardar. Prueba otra vez.");
  await call("POST", "customers/" + customer, { invoice_settings: { default_payment_method: si.payment_method.id } });
  return cardOf(si.payment_method);
}

export async function removeCard(pm) {
  if (FAKE || !pm) return;
  await call("POST", `payment_methods/${pm}/detach`).catch(() => {});
}

const piView = (pi, error) => ({ pi: pi.id, status: pi.status, error: error || pi.last_payment_error?.message || "" });

// Cobro sin el cliente delante. Nunca lanza por un rechazo: devuelve el estado
// (succeeded, requires_action = el banco pide confirmación, requires_payment_method = rechazada).
export async function chargeOffSession({ customer, pm, amount, description, metadata, idem }) {
  if (FAKE) {
    const last4 = pm.slice(-4),
      id = fid("pi");
    const status = last4 === "0002" ? "requires_payment_method" : last4 === "3155" ? "requires_action" : "succeeded";
    fakeIntents.set(id, { id, status, amount });
    return { pi: id, status, error: status === "requires_payment_method" ? "La tarjeta ha sido rechazada (modo prueba)." : "" };
  }
  try {
    const pi = await call(
      "POST",
      "payment_intents",
      { amount, currency: "eur", customer, payment_method: pm, off_session: true, confirm: true, description, metadata, payment_method_types: ["card"] },
      idem,
    );
    return piView(pi);
  } catch (e) {
    const pi = e.stripe?.payment_intent;
    if (pi) return piView(pi, e.message);
    throw e;
  }
}

export async function readIntent(id) {
  if (FAKE) {
    const pi = fakeIntents.get(id);
    return pi ? { pi: id, status: pi.status, clientSecret: id + "_secret", error: "" } : null;
  }
  const pi = await call("GET", "payment_intents/" + encodeURIComponent(id));
  return { ...piView(pi), clientSecret: pi.client_secret };
}

// Modo prueba: el cliente «confirma» el pago pendiente desde la app.
export function fakeComplete(id) {
  const pi = fakeIntents.get(id);
  if (pi) pi.status = "succeeded";
}

export async function refund(pi) {
  if (FAKE) {
    const x = fakeIntents.get(pi);
    if (x) x.status = "refunded";
    return;
  }
  await call("POST", "refunds", { payment_intent: pi }, "refund-" + pi);
}
