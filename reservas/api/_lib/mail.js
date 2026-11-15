// Correos por Resend. Sin RESEND_API_KEY no se envía nada y se dice: quien
// llama decide qué hacer (en local, el código de acceso sale por la consola).
import { BUSINESS } from "./config.js";

const FROM = () => process.env.MAIL_FROM || `${BUSINESS.name} <onboarding@resend.dev>`;
export const mailReady = () => !!process.env.RESEND_API_KEY;

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function shell(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#f5f4f0;font-family:Arial,Helvetica,sans-serif;color:#171717">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
<p style="font-size:11px;letter-spacing:2px;font-weight:700;color:#64645e;margin:0 0 6px">${esc(BUSINESS.name.toUpperCase())}</p>
<h1 style="font-size:26px;letter-spacing:-1px;margin:0 0 18px">${esc(title)}</h1>
<div style="background:#fff;border:1px solid #dcdad3;border-radius:18px;padding:20px;font-size:15px;line-height:1.5">${body}</div>
<p style="font-size:12px;color:#64645e;margin-top:18px">${esc(BUSINESS.street)} · ${esc(BUSINESS.city)}</p>
</div></body></html>`;
}

export async function send(to, subject, title, bodyHtml, replyTo, attachments) {
  if (!mailReady()) return false;
  if (/\.invalid$/i.test(String(to || "").trim())) return false; // clientes de prueba: nunca se les escribe
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM(),
        to: [to],
        subject,
        html: shell(title, bodyHtml),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachments?.length ? { attachments } : {}),
      }),
    });
    if (!r.ok) console.error("Resend", r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error("Resend", e);
    return false;
  }
}

export const codeMail = (to, code) =>
  send(
    to,
    `${code} es tu código de ${BUSINESS.short}`,
    "Tu código para entrar",
    `<p style="margin:0 0 12px">Escribe este código en la app. Caduca en diez minutos.</p>
     <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0">${esc(code)}</p>
     <p style="margin:14px 0 0;color:#64645e;font-size:13px">Si no lo has pedido tú, ignora este correo.</p>`,
  );

export const bookingLines = (b, when) =>
  `<p style="margin:0 0 6px"><b>${esc(b.service.name)}</b> con ${esc(b.provider.name)}</p>
   <p style="margin:0 0 6px">${esc(when)} · ${esc(b.start)}</p>
   <p style="margin:0">${b.service.price ? esc(b.service.price + " €") + " · " : ""}Pago en el local</p>`;
