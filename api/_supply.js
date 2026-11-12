/* ══════════════════════════════════════════════════════════════════════════
   La ropa compartida con la app del estudio (nova.appflu.es)
   ──────────────────────────────────────────────────────────────────────────
   Las dos webs usan la misma base. Desde que se conectaron, lo que manda es
   la base y no prendas.js (que se queda como copia por si la base falla):

     supply:catalogo    las prendas: nombre, color, precio, estado y tallas
     supply:stock       «prenda|talla» → unidades en el estudio. Una talla que
                        no aparece aquí no se cuenta (se puede reservar sin
                        límite, como antes).
     supply:apartadas   «prenda|talla» → reservas de esta web aún sin recoger
     supply:ventas      las ventas del estudio y las recogidas de esta web

   Airam lo cambia todo desde su panel del estudio, pestaña «Ropa».
   ══════════════════════════════════════════════════════════════════════════ */

function credenciales() {
    const e = process.env;
    const conocidos = [
        ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
        ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
        ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN']
    ];
    for (const [u, t] of conocidos) if (e[u] && e[t]) return { url: e[u], token: e[t] };
    for (const clave of Object.keys(e)) {
        if (!/REST_(API_)?URL$/.test(clave)) continue;
        if (!/^https:\/\//.test(String(e[clave]))) continue;
        const raiz = clave.replace(/REST_(API_)?URL$/, '');
        const conToken = Object.keys(e).find(k => k.startsWith(raiz) && /REST_(API_)?TOKEN$/.test(k) && e[k]);
        if (conToken) return { url: e[clave], token: e[conToken] };
    }
    return null;
}

async function redis(cred, ordenes) {
    const r = await fetch(cred.url.replace(/\/+$/, '') + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cred.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(ordenes),
        signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error('redis ' + r.status);
    return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

const aObjeto = v => {
    if (!v) return {};
    if (!Array.isArray(v)) return v;
    const o = {};
    for (let i = 0; i < v.length; i += 2) o[v[i]] = v[i + 1];
    return o;
};
const precioTxt = n => (n == null || n === '' ? '' : Number(n).toFixed(2).replace('.', ',').replace(',00', '') + ' €');

// El catálogo con las tallas que quedan libres. null si la base aún no lo tiene
// (entonces la web sigue con prendas.js, como siempre).
async function catalogo(cred) {
    const [cat, stock, apart] = await redis(cred, [
        ['GET', 'supply:catalogo'],
        ['HGETALL', 'supply:stock'],
        ['HGETALL', 'supply:apartadas']
    ]);
    let prendas;
    try { prendas = JSON.parse(cat); } catch { prendas = null; }
    if (!Array.isArray(prendas)) return null;
    const s = aObjeto(stock), a = aObjeto(apart);
    return prendas.map(p => {
        const tallas = (p.tallas || []).map(t => {
            const k = p.id + '|' + t;
            const st = s[k] === undefined ? null : Number(s[k]);
            const ap = Math.max(0, Number(a[k] || 0));
            return { talla: t, libres: st === null ? null : Math.max(0, st - ap) };
        });
        const libres = tallas.filter(t => t.libres === null || t.libres > 0).map(t => t.talla);
        const estado = p.estado === 'disponible' && !libres.length ? 'agotado' : p.estado;
        return { id: p.id, nombre: p.nombre, variante: p.variante || '', color: p.color || '', precio: precioTxt(p.precio), precioNum: p.precio, estado, tallas: estado === 'disponible' ? libres : [] };
    });
}

// Aparta una unidad para una reserva. false si ya no queda libre.
async function aparta(cred, prenda, talla) {
    const k = prenda + '|' + talla;
    const [ap] = await redis(cred, [['HINCRBY', 'supply:apartadas', k, '1']]);
    const [st] = await redis(cred, [['HGET', 'supply:stock', k]]);
    if (st === null || st === undefined) return true;
    if (Number(st) - Number(ap) < 0) {
        await redis(cred, [['HINCRBY', 'supply:apartadas', k, '-1']]);
        return false;
    }
    return true;
}
async function libera(cred, prenda, talla) {
    await redis(cred, [['HINCRBY', 'supply:apartadas', prenda + '|' + talla, '-1']]);
}

module.exports = { credenciales, redis, catalogo, aparta, libera, precioTxt };
