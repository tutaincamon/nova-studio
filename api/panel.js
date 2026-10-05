/* ══════════════════════════════════════════════════════════════════════════
   GET /api/panel?clave=...   ·   el resumen de las reservas, para el taller
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

   SÍ ENSEÑA LOS CORREOS de quien se apuntó a la lista desde la ventana de
   la web, pero plegados: hay que desplegar la lista a propósito para verlos. Son datos
   personales, así que quien tenga este enlace tiene acceso a ellos —y por
   eso la clave hay que tratarla como una contraseña, no como un enlace más
   que se reenvía por WhatsApp—.
   ══════════════════════════════════════════════════════════════════════════ */

// El aviso por correo de cada reserva: el panel enseña si está activado y
// tiene un botón para mandar un correo de prueba y ver qué contesta Resend.
const aviso = require('./_aviso');

function explicaPrueba(r, cfg) {
    if (r.ok) return 'Enviado a <b>' + escapa(cfg.para) + '</b>. Si en un par de minutos no lo ves, mira en spam y en Promociones.';
    if (r.motivo === 'sin-clave') return 'No se ha mandado: falta la clave de Resend.';
    if (r.motivo === 'red') return 'No se pudo hablar con Resend (' + escapa(r.detalle || '') + '). Prueba otra vez en un momento.';
    const d = String(r.detalle || '');
    if (/own email address/i.test(d)) return 'Resend lo ha rechazado: con su remitente de pruebas solo deja escribir ' +
        'al correo con el que se abrió la cuenta, y ese no es <b>' + escapa(cfg.para) + '</b>. O la cuenta de Resend ' +
        'se abrió con otro correo, o AVISO_CORREO apunta a otro. Lo que dice Resend: <i>' + escapa(d) + '</i>';
    if (r.estado === 401 || (r.estado === 403 && /api key/i.test(d))) return 'Resend dice que la clave no vale: puede ' +
        'que esté mal copiada o que se haya borrado. Lo que dice Resend: <i>' + escapa(d) + '</i>';
    return 'Resend ha contestado ' + escapa(r.estado || '') + ': <i>' + escapa(d) + '</i>';
}

// El botón de prueba llega como un formulario POST. Vercel suele traer ya el
// cuerpo leído en req.body; si no, se lee aquí.
async function campos(req) {
    let b = req.body;
    if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
    if (Buffer.isBuffer(b)) b = b.toString('utf8');
    if (typeof b !== 'string') {
        b = await new Promise(ok => {
            let s = '';
            req.on('data', c => { s += c; if (s.length > 2000) req.destroy(); });
            req.on('end', () => ok(s));
            req.on('error', () => ok(''));
        });
    }
    try { return Object.fromEntries(new URLSearchParams(b)); } catch { return {}; }
}

// Las filas y columnas salen de lo que hay en la base, no de una lista fija:
// si mañana se abre otra talla u otro color, aparece aquí sin tocar nada.
// Siempre están las tallas que se pueden apartar hoy (las de api/reserva.js)
// y los dos colores del drop, aunque vayan a cero.
const EN_VENTA = ['L', 'XL', 'XXL'];
const COLORES_BASE = ['gris', 'rosa'];
const ORDEN_TALLAS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
// «2XL» es como se llamaba la XXL en la preventa de septiembre. Es la misma
// talla, así que se cuenta y se enseña como XXL.
const talla = t => { const x = String(t || '').toUpperCase(); return x === '2XL' ? 'XXL' : x; };

function cuadro(combinaciones) {
    const n = {}, tallas = new Set(EN_VENTA), colores = new Set(COLORES_BASE);
    for (const [clave, v] of Object.entries(combinaciones || {})) {
        const i = clave.lastIndexOf('-');
        if (i < 1) continue;
        const t = talla(clave.slice(0, i)), c = clave.slice(i + 1).toLowerCase();
        const cuantas = Number(v) || 0;
        if (!cuantas) continue;
        n[t + '-' + c] = (n[t + '-' + c] || 0) + cuantas;
        tallas.add(t); colores.add(c);
    }
    const orden = t => { const i = ORDEN_TALLAS.indexOf(t); return i < 0 ? 99 : i; };
    return { n, tallas: [...tallas].sort((a, b) => orden(a) - orden(b)), colores: [...colores] };
}

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

// Borra una reserva por su referencia y la descuenta de los recuentos: el de
// talla y color y el de reservas de ese día (la misma clave que sumó
// api/reserva.js). Es para quitar pruebas; no se puede deshacer.
async function borra(cred, ref) {
    const base = cred.url.replace(/\/+$/, '');
    const pide = async ordenes => {
        const r = await fetch(base + '/pipeline', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + cred.token, 'Content-Type': 'application/json' },
            body: JSON.stringify(ordenes),
            signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error('redis ' + r.status);
        return r.json();
    };
    const [lista] = await pide([['LRANGE', 'preventa:pedidos', '0', '-1']]);
    const crudo = ((lista && lista.result) || []).find(s => { try { return JSON.parse(s).ref === ref; } catch { return false; } });
    if (!crudo) return { ok: false, ref };

    const p = JSON.parse(crudo);
    const campo = p.talla && p.color ? p.talla + '-' + p.color : '';
    const dia = String(p.fecha || '').slice(0, 10);
    const ordenes = [['LREM', 'preventa:pedidos', '1', crudo]];
    if (campo) ordenes.push(['HINCRBY', 'preventa:combinaciones', campo, '-1']);
    if (dia) ordenes.push(['DECR', 'preventa:clics:' + dia]);
    const r = await pide(ordenes);

    // que ningún recuento se quede por debajo de cero
    const arreglos = [];
    if (campo && Number(r[1] && r[1].result) < 0) arreglos.push(['HSET', 'preventa:combinaciones', campo, '0']);
    const iDia = campo ? 2 : 1;
    if (dia && Number(r[iDia] && r[iDia].result) < 0) arreglos.push(['SET', 'preventa:clics:' + dia, '0']);
    if (arreglos.length) await pide(arreglos);

    return { ok: Number(r[0] && r[0].result) === 1, ref };
}

async function leer(cred) {
    const dias = ultimosDias(DIAS);
    const ordenes = [
        ['HGETALL', 'preventa:combinaciones'],
        ['LRANGE', 'preventa:pedidos', '0', '-1'],
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

function pagina(datos, prueba, borrada) {
    const { n: cuenta, tallas: TALLAS, colores: COLORES } = cuadro(datos.combinaciones);
    const n = (t, c) => Number(cuenta[t + '-' + c] || 0);
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
        ? datos.pedidos.map(p =>
            '<li class="reserva">' +
              '<span class="ref">' + escapa(p.ref || '') + '</span>' +
              '<b>' + escapa(talla(p.talla)) + '</b> ' + escapa(p.color) +
              '<i>' + escapa(cuando(p.fecha)) + '</i>' +
              (p.nombre || p.tel || p.correo
                ? '<span class="quien">' + escapa(p.nombre || '') +
                    (p.tel ? ' · <a href="tel:' + escapa(p.tel) + '">' + escapa(p.tel) + '</a>' : '') +
                    (p.correo ? ' · <a href="mailto:' + escapa(p.correo) + '">' + escapa(p.correo) + '</a>' : '') +
                  '</span>'
                : '<span class="quien sin">De la preventa con Stripe: sin datos de contacto</span>') +
              (p.ref
                ? '<form method="post" class="borrar" onsubmit="return confirm(\'¿Borrar la reserva \' + this.ref.value + \'? No se puede deshacer.\')">' +
                    '<input type="hidden" name="accion" value="borrar">' +
                    '<input type="hidden" name="ref" value="' + escapa(p.ref) + '">' +
                    '<button type="submit">Borrar</button></form>'
                : '') +
            '</li>').join('')
        : '<li class="vacio">Todavía no ha apartado nadie</li>';

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
  <thead><tr><th></th><th>visitas</th><th>personas</th><th>reservas</th></tr></thead>
  <tbody>${conAlgo.map(d => '<tr><th>' + escapa(nombreDia(d.dia)) + '</th>' +
      [d.vistas, d.unicos, d.clics].map(v => '<td class="' + (v ? '' : 'cero') + '">' + v + '</td>').join('') +
      '</tr>').join('')}</tbody>
  <tfoot><tr><th>total</th><td>${sumaVistas}</td><td>${sumaUnicos}</td><td>${sumaClics}</td></tr></tfoot>
</table>
${conversion !== null ? '<p class="conversion">De cada 100 personas que entran, <b>' + conversion + '</b> apartan una prenda</p>' : ''}
` : '';

    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Reservas · NOVA Supply Clothing</title>
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
li.reserva{flex-wrap:wrap}
li.reserva .ref{color:#6f6b66;font-size:10px;letter-spacing:.08em;margin-right:8px}
/* nombre, teléfono y correo: es lo que hace falta para avisar de la recogida, así que se lee bien */
li.reserva .quien{flex-basis:100%;margin-top:4px;color:#4a4744;font-size:12px;letter-spacing:0}
li.reserva .quien a{color:#0e0e10;text-underline-offset:2px}
li.reserva .quien.sin{font-style:italic;font-size:11px;color:#b5b1ac}
.nota-lista{margin:-4px 0 6px;font-size:11px;line-height:1.6;color:#a9a5a0}
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
li.reserva form.borrar{flex-basis:100%;margin:2px 0 0;text-align:right}
li.reserva form.borrar button{padding:3px 0;border:0;background:none;font-family:inherit;font-size:10.5px;font-weight:600;
    letter-spacing:.06em;color:#a4525f;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.estado-correo{margin:0;font-size:12px;line-height:1.7;color:#4a4744}
.prueba{margin:12px 0 0;padding:11px 13px;border-radius:3px;font-size:12px;line-height:1.7}
.prueba.bien{background:rgba(46,125,50,.08);color:#2e5e31}
.prueba.mal{background:rgba(164,82,95,.08);color:#8a4551}
.prueba i{font-style:normal;word-break:break-word;opacity:.85}
form.prueba-correo{margin:14px 0 0}
form.prueba-correo button{width:100%;padding:13px 16px;border:1px solid #0e0e10;border-radius:3px;background:#0e0e10;
    color:#fff;font-family:inherit;font-weight:700;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;cursor:pointer}
.pie{margin:32px 0 0;text-align:center;font-size:10px;line-height:1.9;letter-spacing:.06em;color:#a9a5a0}
</style></head><body><main>

<img class="marca" src="/icono.png" alt="">
<h1>Reservas · Drop 01</h1>
<div class="cifras">
  <div><p class="total">${total}</p><p class="total-pie">${total === 1 ? 'reserva' : 'reservas'}</p></div>
  <div><p class="total">${datos.vistasTotal}</p><p class="total-pie">${datos.vistasTotal === 1 ? 'visita' : 'visitas'}</p></div>
</div>
${masPedida && masPedida[1] ? '<p class="apunte">La talla más pedida es la ' + masPedida[0] + '</p>' : ''}

<p class="ojo"><b>Esto cuenta prendas apartadas</b>, no vendidas. Se cobra en el
local al recoger, así que una reserva sólo se convierte en venta cuando el
cliente aparece y paga. Las que caducan sin recoger siguen contadas aquí.</p>

<table>
  <thead><tr><th></th>${COLORES.map(c => '<th>' + c + '</th>').join('')}<th>total</th></tr></thead>
  <tbody>${filas}</tbody>
  <tfoot><tr><th>total</th>${COLORES.map(c => '<td>' + porColor(c) + '</td>').join('')}<td>${total}</td></tr></tfoot>
</table>

${trafico}

<h2>Reservas · ${datos.pedidos.length}</h2>
${borrada ? '<p class="prueba ' + (borrada.ok ? 'bien' : 'mal') + '">' + (borrada.ok
    ? 'Borrada la reserva <b>' + escapa(borrada.ref) + '</b>, y descontada de los recuentos.'
    : 'No se ha encontrado la reserva <b>' + escapa(borrada.ref) + '</b>: puede que ya estuviera borrada.') + '</p>' : ''}
<p class="ojo-datos">Son datos personales de gente real: úsalos sólo para avisarles de la recogida. No enseñes esta pantalla a nadie ni la fotografíes.</p>
<ul>${ultimos}</ul>

<h2>Lista de correo · ${datos.avisos.length}</h2>
<p class="nota-lista">Quien se apunta desde la ventana que sale al entrar en la web.</p>
${correos}

<h2>Aviso por correo</h2>
${(() => {
    const cfg = aviso.config();
    const estado = cfg.clave
        ? 'Activado. Cada reserva manda un correo a <b>' + escapa(cfg.para) + '</b> (con la clave de Resend que termina en «' + escapa(cfg.clave.slice(-4)) + '»).'
        : 'Desactivado: la web no recibe la clave <b>RESEND_API_KEY</b>. En Vercel → Settings → Environment Variables tiene que llamarse exactamente así y tener marcado Production; después, Redeploy.';
    return '<p class="estado-correo">' + estado + '</p>' +
        (prueba ? '<p class="prueba ' + (prueba.ok ? 'bien' : 'mal') + '">' + explicaPrueba(prueba, cfg) + '</p>' : '') +
        '<form method="post" class="prueba-correo"><input type="hidden" name="accion" value="prueba-correo">' +
        '<button type="submit">Mandar correo de prueba</button></form>';
})()}

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

    // los botones del panel: «Mandar correo de prueba» y «Borrar»
    let prueba = null, borrada = null;
    if (req.method === 'POST') {
        const f = await campos(req);
        if (f.accion === 'prueba-correo') prueba = await aviso.prueba();
        if (f.accion === 'borrar' && f.ref) {
            const ref = String(f.ref).slice(0, 20);
            try { borrada = await borra(cred, ref); }
            catch (e) { console.error('El panel no pudo borrar la reserva:', e.message); borrada = { ok: false, ref }; }
        }
    }

    try {
        const datos = await leer(cred);
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow'
        });
        return res.end(pagina(datos, prueba, borrada));
    } catch (e) {
        console.error('El panel no pudo leer la base:', e.message);
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end('No se pudo leer la base de datos. Inténtalo en un momento.');
    }
};
