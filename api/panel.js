/* ══════════════════════════════════════════════════════════════════════════
   GET /api/panel?clave=...   ·   el resumen de la preventa, para el taller
   ──────────────────────────────────────────────────────────────────────────
   Una sola página con lo único que hace falta saber para encargar género:
   cuántas piezas de cada talla y cada color se han reservado. Sin consolas,
   sin JSON en crudo y sin nada que se pueda romper tocando.

   CÓMO SE ABRE
     https://novasupply.es/api/panel?clave=LA-CLAVE

   La clave se pone en Vercel → Settings → Environment Variables:
       PANEL_CLAVE = una cadena larga y aleatoria
   Mientras esa variable no exista, el panel no existe: contesta 404 como
   cualquier dirección inventada, para no anunciar que está ahí. Y con la
   clave mal, lo mismo — no dice "clave incorrecta", que sería confirmar que
   hay algo detrás.

   NO ENSEÑA NINGÚN CORREO. De la lista de avisos del Drop 02 sólo sale
   cuántos hay apuntados; las direcciones se quedan en la base de datos,
   que es donde tienen que estar.
   ══════════════════════════════════════════════════════════════════════════ */

const TALLAS = ['S', 'M', 'L', 'XL', '2XL'];
const COLORES = ['gris', 'rosa'];

// Los mismos nombres de variables que buscan las otras dos funciones.
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

// Comparación que no delata la clave por lo que tarda en fallar.
function mismaClave(a, b) {
    const x = String(a || ''), y = String(b || '');
    if (!y || x.length !== y.length) return false;
    let d = 0;
    for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return d === 0;
}

// Upstash devuelve los hash como lista plana [clave, valor, clave, valor…]
function aObjeto(v) {
    if (!v) return {};
    if (!Array.isArray(v)) return v;
    const o = {};
    for (let i = 0; i < v.length; i += 2) o[v[i]] = v[i + 1];
    return o;
}

async function leer(cred) {
    const r = await fetch(cred.url.replace(/\/+$/, '') + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cred.token, 'Content-Type': 'application/json' },
        body: JSON.stringify([
            ['HGETALL', 'preventa:combinaciones'],
            ['LRANGE', 'preventa:pedidos', '0', '39'],
            ['HLEN', 'avisos:drop02']
        ]),
        signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) throw new Error('redis ' + r.status);
    const p = await r.json();
    return {
        combinaciones: aObjeto(p[0] && p[0].result),
        pedidos: ((p[1] && p[1].result) || []).map(f => { try { return JSON.parse(f); } catch { return null; } }).filter(Boolean),
        avisos: Number((p[2] && p[2].result) || 0)
    };
}

const escapa = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function cuando(iso) {
    try {
        return new Date(iso).toLocaleString('es-ES', {
            timeZone: 'Atlantic/Canary', day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    } catch { return ''; }
}

function pagina(datos) {
    const n = (t, c) => Number(datos.combinaciones[t + '-' + c] || 0);
    const porTalla = t => COLORES.reduce((s, c) => s + n(t, c), 0);
    const porColor = c => TALLAS.reduce((s, t) => s + n(t, c), 0);
    const total = TALLAS.reduce((s, t) => s + porTalla(t), 0);
    const masPedida = TALLAS.map(t => [t, porTalla(t)]).sort((a, b) => b[1] - a[1])[0];

    const filas = TALLAS.map(t => {
        const celdas = COLORES.map(c => {
            const v = n(t, c);
            return '<td class="' + (v ? 'hay' : 'cero') + '">' + v + '</td>';
        }).join('');
        return '<tr><th>' + t + '</th>' + celdas + '<td class="suma">' + porTalla(t) + '</td></tr>';
    }).join('');

    const ultimos = datos.pedidos.length
        ? datos.pedidos.slice(0, 20).map(p =>
            '<li><b>' + escapa(p.talla) + '</b> ' + escapa(p.color) +
            '<i>' + escapa(cuando(p.fecha)) + '</i>' +
            '<span>' + escapa(p.ref || '') + '</span></li>').join('')
        : '<li class="vacio">Todavía no hay ninguna reserva</li>';

    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Preventa · NOVA Supply Clothing</title>
<link rel="icon" type="image/png" href="/icono.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#0e0e10;padding:26px 18px 60px;
     font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500}
main{max-width:520px;margin:0 auto}
.marca{display:block;width:44px;margin:0 auto 22px}
h1{margin:0;text-align:center;font-weight:700;font-size:12px;letter-spacing:.22em;text-transform:uppercase;text-indent:.22em}
.total{margin:6px 0 0;text-align:center;font-weight:700;font-size:52px;letter-spacing:-.02em;line-height:1.1}
.total-pie{margin:0 0 4px;text-align:center;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#6f6b66}
.ojo{margin:24px 0 30px;padding:13px 15px;border:1px solid rgba(164,82,95,.35);border-radius:3px;
     background:rgba(164,82,95,.06);font-size:11.5px;line-height:1.7;color:#8a4551}
.ojo b{font-weight:700}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th,td{padding:11px 6px;text-align:center;border-bottom:1px solid rgba(14,14,16,.12)}
thead th{font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:#6f6b66;border-bottom-color:#0e0e10}
tbody th{font-size:12px;font-weight:700;text-align:left;letter-spacing:.08em}
td{font-size:19px;font-weight:600}
td.cero{color:#c9c5c0;font-weight:500}
td.suma{font-size:14px;color:#6f6b66}
tfoot td,tfoot th{border-bottom:0;padding-top:14px;font-size:12px;color:#6f6b66;font-weight:700}
h2{margin:34px 0 12px;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#6f6b66;font-weight:700}
ul{list-style:none;margin:0;padding:0}
li{display:flex;align-items:baseline;gap:10px;padding:9px 0;border-bottom:1px solid rgba(14,14,16,.08);font-size:12px}
li b{font-weight:700;min-width:30px}
li i{font-style:normal;color:#6f6b66;margin-left:auto;font-size:11px}
li span{color:#c9c5c0;font-size:10px;letter-spacing:.06em}
li.vacio{color:#6f6b66;justify-content:center;padding:22px 0}
.pie{margin:32px 0 0;text-align:center;font-size:10px;line-height:1.9;letter-spacing:.06em;color:#a9a5a0}
</style></head><body><main>

<img class="marca" src="/icono.png" alt="">
<h1>Preventa · Drop 01</h1>
<p class="total">${total}</p>
<p class="total-pie">${total === 1 ? 'reserva' : 'reservas'}${masPedida && masPedida[1] ? ' · la más pedida, ' + masPedida[0] : ''}</p>

<p class="ojo"><b>Esto cuenta quién ha pulsado Reservar</b>, no quién ha pagado.
Si alguien se echó atrás en Stripe, sigue contado aquí. Para lo cobrado de
verdad, mira los pagos en Stripe.</p>

<table>
  <thead><tr><th></th>${COLORES.map(c => '<th>' + c + '</th>').join('')}<th>total</th></tr></thead>
  <tbody>${filas}</tbody>
  <tfoot><tr><th>total</th>${COLORES.map(c => '<td>' + porColor(c) + '</td>').join('')}<td>${total}</td></tr></tfoot>
</table>

<h2>Últimas reservas</h2>
<ul>${ultimos}</ul>

<p class="pie">${datos.avisos} apuntados a los avisos del Drop 02<br>
Actualizado ${cuando(new Date().toISOString())} · recarga para ver lo nuevo</p>

</main></body></html>`;
}

module.exports = async (req, res) => {
    let clave = '';
    try { clave = new URL(req.url || '/', 'http://n').searchParams.get('clave') || ''; } catch { }

    // Sin clave configurada, o con una que no es, esta dirección no existe.
    if (!process.env.PANEL_CLAVE || !mismaClave(clave, process.env.PANEL_CLAVE)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end('404');
    }

    const cred = credenciales();
    if (!cred) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end('La base de datos no está conectada en este proyecto.');
    }

    try {
        const datos = await leer(cred);
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow'
        });
        return res.end(pagina(datos));
    } catch (e) {
        console.error('El panel no pudo leer la base:', e.message);
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end('No se pudo leer la base de datos. Inténtalo en un momento.');
    }
};
