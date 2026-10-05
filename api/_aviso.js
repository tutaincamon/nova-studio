/* ══════════════════════════════════════════════════════════════════════════
   EL AVISO POR CORREO · lo usan api/reserva.js y api/panel.js
   ──────────────────────────────────────────────────────────────────────────
   No es una dirección de la web: Vercel no publica los archivos de api/ que
   empiezan por guion bajo, solo deja que las demás funciones los usen.

   Se manda con Resend (resend.com), que se habla por HTTP igual que la base:
   no hay que instalar nada. Las variables, en Vercel → Settings →
   Environment Variables:
     RESEND_API_KEY    la clave de Resend. Sin ella no se manda nada.
     AVISO_CORREO      a quién le llega. Si no está: novastudioworld@gmail.com
     AVISO_REMITENTE   quién lo manda. Si no está: el remitente de pruebas
                       de Resend (onboarding@resend.dev).

   Mientras no se verifique un dominio propio en Resend, ese remitente de
   pruebas solo puede escribir al correo con el que se abrió la cuenta: la
   cuenta de Resend y AVISO_CORREO tienen que ser el mismo correo. Si algún
   día se verifica novasupply.es, basta con poner
   AVISO_REMITENTE = NOVA <reservas@novasupply.es>.

   OJO: aquí viajan datos personales de gente real (nombre, teléfono y
   correo). Solo van a la tienda, para que prepare la prenda.
   ══════════════════════════════════════════════════════════════════════════ */

const PARA_POR_DEFECTO = 'novastudioworld@gmail.com';
const DE_POR_DEFECTO = 'NOVA Reservas <onboarding@resend.dev>';
// Hoy solo se aparta la camiseta rosa, así que el nombre sale del color.
const NOMBRE_PRENDA = { rosa: 'Camiseta rosa' };

const escapa = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Se recortan los espacios: una clave pegada con un espacio o un salto de
// línea al final no vale, y no se ve a simple vista en Vercel.
function config() {
    const limpia = v => String(v || '').trim();
    return {
        clave: limpia(process.env.RESEND_API_KEY),
        para: limpia(process.env.AVISO_CORREO) || PARA_POR_DEFECTO,
        de: limpia(process.env.AVISO_REMITENTE) || DE_POR_DEFECTO
    };
}

// Nunca lanza: devuelve { ok: true, id } o { ok: false, motivo, estado, detalle }.
async function manda({ asunto, texto, html, responderA }) {
    const c = config();
    if (!c.clave) return { ok: false, motivo: 'sin-clave' };
    try {
        const cuerpo = { from: c.de, to: [c.para], subject: asunto, text: texto, html };
        if (responderA) cuerpo.reply_to = responderA;
        const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + c.clave, 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(4000)
        });
        const respuesta = await resp.text();
        if (!resp.ok) {
            // Resend contesta los errores en JSON con un «message» legible
            let detalle = respuesta;
            try { const j = JSON.parse(respuesta); detalle = j.message || j.error || respuesta; } catch (e) { }
            return { ok: false, motivo: 'resend', estado: resp.status, detalle: String(detalle).slice(0, 300) };
        }
        let id = '';
        try { id = JSON.parse(respuesta).id || ''; } catch (e) { }
        return { ok: true, id };
    } catch (e) {
        return { ok: false, motivo: 'red', detalle: e.message };
    }
}

// El aviso de una reserva: todos los datos, y al responder se le escribe al cliente.
function avisaReserva(r) {
    const prenda = (NOMBRE_PRENDA[r.color] || r.color) + ' · talla ' + r.talla;
    const hora = new Date(r.fecha).toLocaleString('es-ES', {
        timeZone: 'Atlantic/Canary', dateStyle: 'short', timeStyle: 'short'
    });
    const datos = [
        ['Referencia', r.ref],
        ['Prenda', prenda],
        ['Nombre', r.nombre],
        ['Teléfono', r.tel],
        ['Correo', r.correo],
        ['Cuándo', hora + ' (hora de Canarias)']
    ];
    const pie = 'Se paga y se recoge en la tienda. Si respondes a este correo, le escribes directamente al cliente.';

    const texto = 'Nueva reserva en la web\n\n' +
        datos.map(([k, v]) => k + ': ' + v).join('\n') + '\n\n' + pie;

    // en el HTML todo lo que escribió el cliente va escapado
    const celda = (k, v) => {
        if (k === 'Teléfono') return '<a href="tel:' + escapa(String(v).replace(/[^\d+]/g, '')) + '">' + escapa(v) + '</a>';
        if (k === 'Correo')   return '<a href="mailto:' + escapa(v) + '">' + escapa(v) + '</a>';
        return escapa(v);
    };
    const html =
        '<div style="font-family:Helvetica,Arial,sans-serif;color:#0e0e10;max-width:480px">' +
        '<p style="margin:0 0 14px;font-size:16px;font-weight:bold">Nueva reserva en la web</p>' +
        '<table style="border-collapse:collapse;font-size:14px;line-height:1.5">' +
        datos.map(([k, v]) =>
            '<tr><td style="padding:5px 18px 5px 0;color:#6f6b66;white-space:nowrap">' + k + '</td>' +
            '<td style="padding:5px 0">' + celda(k, v) + '</td></tr>').join('') +
        '</table>' +
        '<p style="margin:18px 0 0;font-size:12px;color:#6f6b66">' + pie + '</p></div>';

    return manda({ asunto: 'Nueva reserva ' + r.ref + ' · ' + prenda, texto, html, responderA: r.correo });
}

// El correo de prueba del botón del panel.
function prueba() {
    const texto = 'Esto es una prueba del aviso de reservas de la web de NOVA. Si lo estás leyendo, cada reserva te llegará a este correo.';
    const html = '<div style="font-family:Helvetica,Arial,sans-serif;color:#0e0e10;max-width:480px">' +
        '<p style="margin:0 0 10px;font-size:16px;font-weight:bold">Prueba del aviso de reservas</p>' +
        '<p style="margin:0;font-size:14px;line-height:1.6">' + escapa(texto) + '</p></div>';
    return manda({ asunto: 'Prueba del aviso de reservas · NOVA', texto, html });
}

module.exports = { config, avisaReserva, prueba };
