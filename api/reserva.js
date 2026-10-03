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

   OJO: aquí viajan datos personales de gente real (nombre, teléfono y
   correo). No se mandan a ningún sitio más ni se usan para otra cosa que
   avisar de la recogida.
   ══════════════════════════════════════════════════════════════════════════ */

// Lo que de verdad se puede apartar hoy. Si entra más género, se toca aquí
// y en el formulario de index.html, y nada más.
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
        return res.status(200).json({ ok: true, ref });
    } catch (e) {
        console.error('No se pudo guardar la reserva:', e.message);
        return res.status(500).json({ ok: false, error: 'guardar' });
    }
};
