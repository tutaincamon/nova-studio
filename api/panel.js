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

   SÍ ENSEÑA LOS CORREOS de quien se apuntó a los avisos del Drop 02, pero
   plegados: hay que desplegar la lista a propósito para verlos. Son datos
   personales, así que quien tenga este enlace tiene acceso a ellos —y por
   eso la clave hay que tratarla como una contraseña, no como un enlace más
   que se reenvía por WhatsApp—.
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

// Los últimos n días en Canarias, del más reciente al más antiguo. Se
// calcula desde el mediodía para que ningún cambio de hora mueva un día.
function ultimosDias(n) {
    const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Canary' });
    const base = new Date(hoy + 'T12:00:00Z').getTime();
    const dias = [];
    for (let i = 0; i < n; i++) dias.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
    return dias;
}

const DIAS = 14;

async function leer(cred) {
    const dias = ultimosDias(DIAS);
    const ordenes = [
        ['HGETALL', 'preventa:combinaciones'],
        ['LRANGE', 'preventa:pedidos', '0', '39'],
        ['HGETALL', 'avisos:drop02'],
        ['GET', 'web:vistas:total']
    ];
    for (const d of dias) {
        ordenes.push(['GET', 'web:vistas:' + d]);
        ordenes.push(['PFCOUNT', 'web:unicos:' + d]);
        ordenes.push(['GET', 'preventa:clics:' + d]);
    }

    const r = await fetch(cred.url.replace(/\/+$/, '') + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cred.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(ordenes),
        signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('redis ' + r.status);
    const p = await r.json();
    const num = i => Number((p[i] && p[i].result) || 0);
    const trafico = dias.map((dia, i) => ({
        dia,
        vistas: num(4 + i * 3),
        unicos: num(5 + i * 3),
        clics: num(6 + i * 3)
    }));
    // La lista de avisos es correo → fecha en que se apuntó. La damos del
    // más reciente al más antiguo, que es como se mira.
    const avisos = Object.entries(aObjeto(p[2] && p[2].result))
        .map(([correo, fecha]) => ({ correo, fecha }))
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return {
        combinaciones: aObjeto(p[0] && p[0].result),
        pedidos: ((p[1] && p[1].result) || []).map(f => { try { return JSON.parse(f); } catch { return null; } }).filter(Boolean),
        avisos,
        vistasTotal: num(3),
        trafico
    };
}

const escapa = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// "dom 7/9"
function nombreDia(dia) {
    try {
        return new Date(dia + 'T12:00:00Z').toLocaleDateString('es-ES', {
            timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'numeric'
        }).replace(',', '');
    } catch { return dia; }
}

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
        : '<li class="vacio">Todavía no ha pulsado nadie</li>';

    // Los correos van plegados: son datos personales y no tienen por qué
    // quedarse a la vista de quien pase por detrás.
    const correos = datos.avisos.length
        ? '<details><summary>Ver los ' + datos.avisos.length + ' correos</summary>' +
          '<p class="ojo-datos">Son datos personales de gente real. No reenvíes esta pantalla ' +
          'ni pegues la lista en ningún sitio que no sea el correo con el que les escribas, y ' +
          'mándalo en copia oculta.</p>' +
          '<ul class="correos">' + datos.avisos.map(a =>
              '<li>' + escapa(a.correo) + '<i>' + escapa(cuando(a.fecha)) + '</i></li>').join('') +
          '</ul>' +
          '<p class="etiqueta-copia">Todos juntos, para pegarlos en copia oculta</p>' +
          '<textarea readonly rows="3" onclick="this.select()">' +
          escapa(datos.avisos.map(a => a.correo).join(', ')) + '</textarea></details>'
        : '<p class="vacio-correos">Todavía no se ha apuntado nadie</p>';

    // Tráfico: sólo los días que tienen algo, para no enseñar catorce ceros
    // el primer día. Si no hay nada todavía, no se pinta la sección.
    const conAlgo = datos.trafico.filter(d => d.vistas || d.unicos || d.clics);
    const sumaVistas = conAlgo.reduce((s, d) => s + d.vistas, 0);
    const sumaUnicos = conAlgo.reduce((s, d) => s + d.unicos, 0);
    const sumaClics = conAlgo.reduce((s, d) => s + d.clics, 0);
    const conversion = sumaUnicos ? Math.round(sumaClics / sumaUnicos * 100) : null;

    const trafico = conAlgo.length ? `
<h2>Últimos días</h2>
<table class="dias">
  <thead><tr><th></th><th>visitas</th><th>personas</th><th>clicks</th></tr></thead>
  <tbody>${conAlgo.map(d => '<tr><th>' + escapa(nombreDia(d.dia)) + '</th>' +
      [d.vistas, d.unicos, d.clics].map(v => '<td class="' + (v ? '' : 'cero') + '">' + v + '</td>').join('') +
      '</tr>').join('')}</tbody>
  <tfoot><tr><th>total</th><td>${sumaVistas}</td><td>${sumaUnicos}</td><td>${sumaClics}</td></tr></tfoot>
</table>
${conversion !== null ? '<p class="conversion">De cada 100 personas que entran, <b>' + conversion + '</b> pulsan Reservar</p>' : ''}
` : '';

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
.cifras{display:flex;justify-content:center;gap:clamp(26px,10vw,58px);margin-top:8px}
.cifras>div{text-align:center}
.total{margin:0;font-weight:700;font-size:46px;letter-spacing:-.02em;line-height:1.1}
.total-pie{margin:2px 0 0;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#6f6b66}
.apunte{margin:14px 0 0;text-align:center;font-size:11px;letter-spacing:.06em;color:#6f6b66}
table.dias td,table.dias th{padding:9px 4px}
table.dias tbody th{font-size:11px;font-weight:600;color:#6f6b66;text-transform:capitalize}
table.dias td{font-size:15px}
.conversion{margin:14px 0 0;text-align:center;font-size:11.5px;line-height:1.7;color:#6f6b66}
.conversion b{font-weight:700;color:#0e0e10;font-size:14px}
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
details{margin-top:4px}
summary{cursor:pointer;padding:11px 0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
        font-weight:700;color:#0e0e10;border-bottom:1px solid rgba(14,14,16,.12)}
summary::marker{color:#c9c5c0}
.ojo-datos{margin:14px 0 4px;padding:12px 14px;border-radius:3px;background:rgba(14,14,16,.04);
           font-size:11px;line-height:1.7;color:#6f6b66}
ul.correos li{font-size:12.5px;word-break:break-all}
ul.correos li i{white-space:nowrap}
.etiqueta-copia{margin:18px 0 6px;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:#a9a5a0}
textarea{width:100%;padding:10px 12px;border:1px solid rgba(14,14,16,.18);border-radius:3px;
         background:#fbfaf9;color:#6f6b66;font-family:inherit;font-size:11px;line-height:1.6;resize:vertical}
.vacio-correos{margin:0;padding:18px 0;text-align:center;font-size:12px;color:#6f6b66}
.pie{margin:32px 0 0;text-align:center;font-size:10px;line-height:1.9;letter-spacing:.06em;color:#a9a5a0}
</style></head><body><main>

<img class="marca" src="/icono.png" alt="">
<h1>Preventa · Drop 01</h1>
<div class="cifras">
  <div><p class="total">${total}</p><p class="total-pie">${total === 1 ? 'click' : 'clicks'}</p></div>
  <div><p class="total">${datos.vistasTotal}</p><p class="total-pie">${datos.vistasTotal === 1 ? 'visita' : 'visitas'}</p></div>
</div>
${masPedida && masPedida[1] ? '<p class="apunte">La talla más pedida es la ' + masPedida[0] + '</p>' : ''}

<p class="ojo"><b>Esto cuenta quién ha pulsado Reservar</b>, no quién ha pagado.
Si alguien se echó atrás en Stripe, sigue contado aquí. Para lo cobrado de
verdad, mira los pagos en Stripe.</p>

<table>
  <thead><tr><th></th>${COLORES.map(c => '<th>' + c + '</th>').join('')}<th>total</th></tr></thead>
  <tbody>${filas}</tbody>
  <tfoot><tr><th>total</th>${COLORES.map(c => '<td>' + porColor(c) + '</td>').join('')}<td>${total}</td></tr></tfoot>
</table>

${trafico}

<h2>Últimos clicks</h2>
<ul>${ultimos}</ul>

<h2>Avisos del Drop 02 · ${datos.avisos.length}</h2>
${correos}

<p class="pie">Actualizado ${cuando(new Date().toISOString())} · recarga para ver lo nuevo</p>

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
