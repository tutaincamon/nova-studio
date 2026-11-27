// Webhook de Stripe (/api/stripe/webhook, ver vercel.json). Va en su propia
// función porque la firma se comprueba sobre el cuerpo EXACTO que manda Stripe:
// aquí Vercel no lo convierte en objeto antes de que lo leamos.
import { webhookHttp } from "./_lib/membership.js";

export const config = { api: { bodyParser: false } };
export default webhookHttp;
