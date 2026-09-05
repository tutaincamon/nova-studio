/* ══════════════════════════════════════════════════════════════════════════
   POST /api/avisos   ·   guarda un correo para avisar del Drop 02
   ──────────────────────────────────────────────────────────────────────────
   Vercel convierte cualquier archivo de esta carpeta api/ en una función sin
   servidor. Esta habla con Upstash Redis por HTTP, así que no hace falta
   instalar ningún paquete ni tener package.json.

   Los correos se guardan en un hash de Redis: la clave es el correo y el
   valor la fecha en que se apuntó. Al ser un hash, un correo repetido no se
   duplica — y HSET nos dice si era nuevo (1) o ya estaba (0), que es
   justo lo que la web necesita para dar un mensaje u otro.

   Para verlos: en Vercel, pestaña Storage → tu base → Data Browser →
   clave "avisos:drop02".
   ══════════════════════════════════════════════════════════════════════════ */

const CLAVE = 'avisos:drop02';
const ES_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// La integración de Vercel llama a las variables de una forma y la de
// Upstash de otra, según cómo la hayas dado de alta. Aceptamos las dos.
function credenciales() {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? { url, token } : null;
}

async function redis(cred, comando) {
    const r = await fetch(cred.url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${cred.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(comando)
    });
    if (!r.ok) throw new Error('redis ' + r.status);
    return r.json();
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'metodo' });
    }

    // Vercel ya parsea el JSON, pero si llega como texto lo intentamos igual
    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch { cuerpo = {}; }
    }

    const correo = String((cuerpo && cuerpo.correo) || '').trim().toLowerCase();

    if (!ES_CORREO.test(correo) || correo.length > 160) {
        return res.status(400).json({ ok: false, error: 'correo' });
    }

    const cred = credenciales();
    if (!cred) {
        console.error('Faltan las variables de entorno de la base de datos');
        return res.status(500).json({ ok: false, error: 'sin-base' });
    }

    try {
        // HSET devuelve 1 si el campo es nuevo y 0 si ya existía
        const { result } = await redis(cred, ['HSET', CLAVE, correo, new Date().toISOString()]);
        return res.status(200).json({ ok: true, nuevo: result === 1 });
    } catch (e) {
        console.error('No se pudo guardar el correo:', e.message);
        return res.status(500).json({ ok: false, error: 'guardar' });
    }
};
