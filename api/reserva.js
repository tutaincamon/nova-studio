/* ══════════════════════════════════════════════════════════════════════════
   POST /api/reserva   ·   aparta una prenda para recoger en tienda
   ──────────────────────────────────────────────────────────────────────────
   Aquí NO se cobra nada. La web ya no tiene pasarela de pago: el cliente deja
   su nombre, su teléfono y su correo, nosotros le guardamos la prenda y paga
   cuando pasa a recogerla por la tienda.

   Se apunta en los mismos sitios que usaba la preventa, así el panel
   (/api/panel) sigue leyéndolo sin cambios:
     · preventa:pedidos        lista con cada reserva entera, la última arriba
     · preventa:combinaciones  cuántas van de cada talla y color
     · preventa:clics:<día>    cuántas se hicieron ese día

   Para verlas: Vercel → Storage → tu base → Data Browser, o directamente el
   panel con su clave.

   Y con cada reserva le llega un correo a la tienda con todos los datos
   (ver avisaPorCorreo, más abajo).

   OJO: aquí viajan datos personales de gente real (nombre, teléfono y
   correo). No se mandan a ningún sitio más que a la base y a ese aviso, ni
   se usan para otra cosa que avisar de la recogida.
   ══════════════════════════════════════════════════════════════════════════ */

// Lo que de verdad se puede apartar hoy. Si entra más género, se toca aquí
// y en prendas.js, y nada más: el panel saca las tallas y colores de la base.
const TALLAS  = ['L', 'XL', 'XXL'];
const COLORES = ['rosa'];

const ES_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Teléfono español o internacional escrito como le dé la gana a cada uno
const ES_TEL = /^[+()\d][\d\s()+.-]{7,19}$/;

function credenciales() {
    const e = process.env;
    const conocidos = [
        ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
        ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
        ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN']
    ];
    for (const [u, t] of conocidos) {
        if (e[u] && e[t]) return { url: e[u], token: e[t] };
    }
    for (const clave of Object.keys(e)) {
        if (!/REST_(API_)?URL$/.test(clave)) continue;
        if (!/^https:\/\//.test(String(e[clave]))) continue;
        const raiz = clave.replace(/REST_(API_)?URL$/, '');
        const conToken = Object.keys(e).find(
            k => k.startsWith(raiz) && /REST_(API_)?TOKEN$/.test(k) && e[k]
        );
        if (conToken) return { url: e[clave], token: e[conToken] };
    }
    return null;
}

// Varias órdenes de un tirón: una reserva toca tres claves a la vez
async function redis(cred, ordenes) {
    const r = await fetch(cred.url.replace(/\/+$/, '') + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cred.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(ordenes),
        signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('redis ' + r.status);
    return r.json();
}

const limpia = (v, max) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);

/* ---------- el aviso por correo a la tienda ----------
   Se manda con Resend (resend.com), que se habla por HTTP igual que la base:
   no hay que instalar nada. Sin la variable RESEND_API_KEY no se manda
   nada y la reserva funciona igual.

   Mientras no se verifique un dominio propio en Resend, el remitente es el
   suyo de pruebas (onboarding@resend.dev), que solo puede escribir al correo
   con el que se abrió la cuenta. Por eso la cuenta de Resend tiene que ir a
   nombre del mismo correo que recibe los avisos. Si algún día se verifica
   novasupply.es, basta con poner AVISO_REMITENTE = NOVA <reservas@novasupply.es>. */
const AVISO_PARA = process.env.AVISO_CORREO || 'novastudioworld@gmail.com';
const AVISO_DE   = process.env.AVISO_REMITENTE || 'NOVA Reservas <onboarding@resend.dev>';
// Hoy solo se aparta la camiseta rosa, así que el nombre sale del color.
const NOMBRE_PRENDA = { rosa: 'Camiseta rosa' };

const escapa = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function avisaPorCorreo(r) {
    const clave = process.env.RESEND_API_KEY;
    if (!clave) return false;

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
        if (k === 'Teléfono') return '<a href="tel:' + escapa(v.replace(/[^\d+]/g, '')) + '">' + escapa(v) + '</a>';
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

    const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: AVISO_DE,
            to: [AVISO_PARA],
            reply_to: r.correo,
            subject: 'Nueva reserva ' + r.ref + ' · ' + prenda,
            text: texto,
            html
        }),
        signal: AbortSignal.timeout(4000)
    });
    if (!resp.ok) throw new Error('resend ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
    return true;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'metodo' });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch { cuerpo = {}; }
    }
    cuerpo = cuerpo || {};

    const nombre = limpia(cuerpo.nombre, 80);
    const tel    = limpia(cuerpo.tel, 24);
    const correo = limpia(cuerpo.correo, 160).toLowerCase();
    const talla  = limpia(cuerpo.talla, 6).toUpperCase();
    const color  = limpia(cuerpo.color, 16).toLowerCase();

    // Se valida aquí aunque el navegador ya lo haya hecho: a esta dirección
    // puede llamar cualquiera, no sólo el formulario.
    if (nombre.length < 2)        return res.status(400).json({ ok: false, error: 'nombre' });
    if (!ES_TEL.test(tel))        return res.status(400).json({ ok: false, error: 'tel' });
    if (!ES_CORREO.test(correo))  return res.status(400).json({ ok: false, error: 'correo' });
    if (!TALLAS.includes(talla))  return res.status(400).json({ ok: false, error: 'talla' });
    if (!COLORES.includes(color)) return res.status(400).json({ ok: false, error: 'color' });

    const cred = credenciales();
    if (!cred) {
        console.error('Faltan las variables de entorno de la base de datos');
        return res.status(500).json({ ok: false, error: 'sin-base' });
    }

    const fecha = new Date().toISOString();
    // Referencia corta para que el cliente la diga al recoger
    const ref = 'NV-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const dia = fecha.slice(0, 10);

    const reserva = { ref, nombre, tel, correo, talla, color, fecha, estado: 'pendiente' };

    try {
        await redis(cred, [
            ['LPUSH',  'preventa:pedidos', JSON.stringify(reserva)],
            ['LTRIM',  'preventa:pedidos', '0', '499'],
            ['HINCRBY','preventa:combinaciones', talla + '-' + color, '1'],
            ['INCR',   'preventa:clics:' + dia]
        ]);
    } catch (e) {
        console.error('No se pudo guardar la reserva:', e.message);
        return res.status(500).json({ ok: false, error: 'guardar' });
    }

    // La reserva ya está guardada. Si el aviso falla, queda apuntado en el
    // registro de Vercel y el cliente no se entera: se responde igual. Se
    // espera a que salga antes de responder porque, una vez respondido,
    // Vercel puede congelar la función y el correo no llegaría a irse.
    try { await avisaPorCorreo(reserva); }
    catch (e) { console.error('No se pudo mandar el aviso por correo:', e.message); }

    return res.status(200).json({ ok: true, ref });
};
