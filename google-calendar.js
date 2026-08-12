// Alta de citas en Google Calendar mediante cuenta de servicio.
// Sin dependencias: firmamos el JWT con `crypto` y llamamos a la API REST.
//
// Para activarlo:
//   1. En Google Cloud Console crea un proyecto y activa "Google Calendar API".
//   2. Crea una cuenta de servicio y descarga su clave JSON.
//   3. Guarda ese JSON aquí como  google-credentials.json
//   4. En Google Calendar, comparte el calendario del salón con el correo
//      client_email de la cuenta de servicio, con permiso
//      "Hacer cambios en los eventos".
//   5. Copia ese id de calendario en config.json -> calendarId
//
// Mientras no exista google-credentials.json la web sigue funcionando: guarda
// la reserva en reservas.json y ofrece al cliente el enlace de WhatsApp.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const CRED_FILE = path.join(ROOT, 'google-credentials.json');
const CONF_FILE = path.join(ROOT, 'config.json');

const b64url = buf => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function leerJSON(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
}

function config() {
    const c = leerJSON(CONF_FILE) || {};
    return {
        calendarId: c.calendarId || 'primary',
        timeZone:   c.timeZone   || 'Atlantic/Canary',   // Gran Canaria
        duraciones: c.duraciones || {},
        invitarCliente: c.invitarCliente === true        // sólo con Workspace + delegación

    };
}

const disponible = () => fs.existsSync(CRED_FILE);

// --- token OAuth2, cacheado hasta que caduca ---
let cache = { token: null, expira: 0 };

async function token() {
    if (cache.token && Date.now() < cache.expira - 60_000) return cache.token;

    const cred = leerJSON(CRED_FILE);
    if (!cred || !cred.client_email || !cred.private_key) {
        throw new Error('google-credentials.json no es una clave de cuenta de servicio válida');
    }

    const ahora = Math.floor(Date.now() / 1000);
    const cabecera = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const cuerpo = b64url(JSON.stringify({
        iss: cred.client_email,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        aud: 'https://oauth2.googleapis.com/token',
        iat: ahora,
        exp: ahora + 3600
    }));
    const firma = b64url(
        crypto.createSign('RSA-SHA256').update(`${cabecera}.${cuerpo}`).sign(cred.private_key)
    );

    const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${cabecera}.${cuerpo}.${firma}`
        })
    });
    const j = await r.json();
    if (!r.ok) throw new Error('OAuth: ' + (j.error_description || j.error || r.status));

    cache = { token: j.access_token, expira: Date.now() + j.expires_in * 1000 };
    return cache.token;
}

// Duración estimada por servicio (minutos); config.json puede sobrescribirla
const DURACION_BASE = {
    'Corte & Estilismo': 45,
    'Corte & Barba': 60,
    'Color & Mechas': 120,
    'Tratamiento capilar': 60,
    'Peinado / Evento': 75,
    'Barbería': 30,
    'Ritual NOVA': 150
};

function minutos(servicio) {
    const c = config();
    return c.duraciones[servicio] || DURACION_BASE[servicio] || 60;
}

/** Crea el evento. Devuelve {ok, id, htmlLink} o lanza error. */
async function crearEvento(r) {
    const c = config();
    const dur = minutos(r.servicio);
    const inicio = `${r.fecha}T${r.hora}:00`;
    const [hh, mm] = r.hora.split(':').map(Number);
    // el salón cierra mucho antes, pero no dejamos que el fin salte de día
    const total = Math.min(hh * 60 + mm + dur, 23 * 60 + 59);
    const finStr = `${r.fecha}T${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;

    const evento = {
        summary: `${r.servicio} · ${r.nombre}`,
        description:
            `Reserva desde la web de NOVA Studio\n\n` +
            `Cliente: ${r.nombre}\nTeléfono: ${r.tel}\n` +
            (r.email ? `Email: ${r.email}\n` : '') +
            `Profesional: ${r.pro}\n` +
            (r.notas ? `\nNotas: ${r.notas}` : ''),
        start: { dateTime: inicio, timeZone: c.timeZone },
        end:   { dateTime: finStr, timeZone: c.timeZone },
        reminders: { useDefault: true }
    };
    // Ojo: una cuenta de servicio NO puede invitar asistentes en un calendario
    // normal (Google responde "Service accounts cannot invite attendees").
    // Sólo lo intentamos si se activa a mano teniendo delegación en Workspace;
    // el email del cliente va siempre en la descripción, que no falla nunca.
    if (r.email && c.invitarCliente) evento.attendees = [{ email: r.email, displayName: r.nombre }];

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendarId)}/events`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(evento)
    });
    const j = await res.json();
    if (!res.ok) throw new Error('Calendar: ' + (j.error?.message || res.status));
    return { ok: true, id: j.id, htmlLink: j.htmlLink };
}

module.exports = { disponible, crearEvento, minutos, config };
