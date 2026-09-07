/* ══════════════════════════════════════════════════════════════════════════
   POST /api/visita   ·   cuenta una visita a la web
   ──────────────────────────────────────────────────────────────────────────
   Analítica de andar por casa, hecha en casa: la portada llama a esta
   dirección al cargarse y aquí se suma uno al contador del día. Nada más.

   POR QUÉ NO HACE FALTA CARTEL DE COOKIES
     No se guarda nada en el dispositivo de quien entra: ni cookie, ni
     almacenamiento local, ni identificador que dure más que la propia
     petición. El artículo 22.2 de la LSSI habla de guardar o recuperar
     datos en el equipo del usuario, y aquí no pasa ni lo uno ni lo otro,
     así que no hay nada que consentir.

   CÓMO SE CUENTA A ALGUIEN SIN SABER QUIÉN ES
     Para no contar diez veces a la misma persona hace falta distinguirla
     de otra, pero no saber quién es. Se hace un resumen (SHA-256) de su IP
     y su navegador junto con la fecha, y ese resumen se mete en un
     HyperLogLog de Redis, que es una estructura que sabe decir "he visto
     unos 137 distintos" sin guardar ni uno solo.
       · la IP no se guarda en ningún sitio;
       · el resumen tampoco: el HyperLogLog no los conserva;
       · lleva la fecha dentro, así que el de hoy no se puede cruzar con el
         de mañana. Nadie es seguible de un día para otro.

   LO QUE SE GUARDA, QUE ES TODO LO QUE HAY
     web:vistas:2026-09-07   cuántas páginas se han visto ese día
     web:unicos:2026-09-07   cuánta gente distinta, aproximada
     web:vistas:total        el acumulado de siempre
   Los diarios se borran solos a los 90 días.
   ══════════════════════════════════════════════════════════════════════════ */

const DIAS_QUE_SE_GUARDAN = 60 * 60 * 24 * 90;

// Los mismos nombres de variables que buscan las otras funciones.
function credenciales() {
    const e = process.env;
    const conocidos = [
        ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
        ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
        ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN']
    ];
    for (const [u, tk] of conocidos) if (e[u] && e[tk]) return { url: e[u], token: e[tk] };
    for (const clave of Object.keys(e)) {
        if (!/REST_(API_)?URL$/.test(clave)) continue;
        if (!/^https:\/\//.test(String(e[clave]))) continue;
        const raiz = clave.replace(/REST_(API_)?URL$/, '');
        const conToken = Object.keys(e).find(k => k.startsWith(raiz) && /REST_(API_)?TOKEN$/.test(k) && e[k]);
        if (conToken) return { url: e[clave], token: e[conToken] };
    }
    return null;
}

// La fecha en Canarias, que es donde está la tienda y donde se mira esto.
function diaDeHoy() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Canary' });
}

// Buscadores, robots y monitores no son visitas de nadie.
const ROBOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|headless|lighthouse|pingdom|uptime/i;

function huella(req, dia) {
    const sal = process.env.VISITAS_SAL || 'nova-supply';
    const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
    const ua = String(req.headers['user-agent'] || '');
    return require('crypto').createHash('sha256')
        .update(dia + '|' + sal + '|' + ip + '|' + ua)
        .digest('base64').slice(0, 22);
}

module.exports = async (req, res) => {
    // Siempre contestamos lo mismo y sin cuerpo: esto no le devuelve nada a
    // quien entra, sólo apunta. Y así tampoco sirve para saber si hay base.
    const listo = () => {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
    };

    const cred = credenciales();
    if (!cred) return listo();
    if (ROBOT.test(String(req.headers['user-agent'] || ''))) return listo();

    const dia = diaDeHoy();
    try {
        await fetch(cred.url.replace(/\/+$/, '') + '/pipeline', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + cred.token, 'Content-Type': 'application/json' },
            body: JSON.stringify([
                ['INCR', 'web:vistas:' + dia],
                ['EXPIRE', 'web:vistas:' + dia, String(DIAS_QUE_SE_GUARDAN)],
                ['PFADD', 'web:unicos:' + dia, huella(req, dia)],
                ['EXPIRE', 'web:unicos:' + dia, String(DIAS_QUE_SE_GUARDAN)],
                ['INCR', 'web:vistas:total']
            ]),
            signal: AbortSignal.timeout(2500)
        });
    } catch (e) {
        console.error('No se pudo contar la visita:', e.message);
    }
    return listo();
};
