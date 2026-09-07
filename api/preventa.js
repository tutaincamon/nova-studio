/* ══════════════════════════════════════════════════════════════════════════
   GET /api/preventa?talla=M&color=gris   ·   la puerta al pago (Stripe)
   ──────────────────────────────────────────────────────────────────────────
   La caja de la web es un formulario normal contra esta dirección. Aquí
   miramos qué talla y qué color han elegido, lo apuntamos en la libreta y
   redirigimos al enlace de pago que le toca. Al ser una redirección de
   verdad, el pago se abre igual aunque el navegador no ejecute JavaScript.

   HAY UN ENLACE POR CADA TALLA Y COLOR: diez en total, en la tabla de aquí
   abajo. Son enlaces públicos de Stripe —los mismos que se mandan por
   WhatsApp—, no claves secretas, así que viven en el código y no en una
   variable de entorno: se ven de un vistazo y se cambian sin entrar en el
   panel de Vercel.

   PARA CAMBIAR PRECIOS O AÑADIR UNA TALLA:
     1. Se rehace el enlace en Stripe → Enlaces de pago.
     2. Se pega aquí, en ENLACES.
     3. Si es una talla nueva, se añade también al formulario de index.html.
   Esta tabla manda: si una combinación no está aquí, no se puede pagar.

   LA VUELTA A LA WEB es opcional y se configura en cada enlace, dentro de
   Stripe, poniendo como página de confirmación:
       https://novasupply.es/?pago=ok#preventa
   Si no se pone, Stripe enseña su propia pantalla de "gracias" y ya está.
   ══════════════════════════════════════════════════════════════════════════ */

const ENLACES = {
    'S-gris':   'https://book.stripe.com/5kQaEY5AbgTF4ci03C7IY05',
    'S-rosa':   'https://book.stripe.com/dRm3cwd2DdHtfV0g2A7IY06',
    'M-gris':   'https://book.stripe.com/4gM6oId2D46T9wC3fO7IY07',
    'M-rosa':   'https://book.stripe.com/3cIfZi1jV46T24a2bK7IY08',
    'L-gris':   'https://book.stripe.com/bJe6oI5Ab6f124a5nW7IY09',
    'L-rosa':   'https://book.stripe.com/dRmfZi4w7eLx10603C7IY0a',
    'XL-gris':  'https://book.stripe.com/9B66oI4w7avh4cieYw7IY0b',
    'XL-rosa':  'https://book.stripe.com/5kQ14oe6H8n91062bK7IY0c',
    '2XL-gris': 'https://book.stripe.com/7sYbJ2bYzdHt8sy6s07IY0d',
    '2XL-rosa': 'https://book.stripe.com/7sYfZiaUv8n97oug2A7IY0e'
};

// Talla y color llegan en la propia dirección, que es lo que manda el
// formulario de la caja. No nos fiamos de lo que venga: si la combinación no
// está en la tabla, no hay pago.
function eleccion(req) {
    let q;
    try { q = new URL(req.url || '/', 'http://n').searchParams; } catch { return null; }
    const talla = String(q.get('talla') || '').trim().toUpperCase();
    const color = String(q.get('color') || '').trim().toLowerCase();
    const enlace = ENLACES[talla + '-' + color];
    return enlace ? { talla, color, enlace } : null;
}

/* ── LA LIBRETA ───────────────────────────────────────────────────────────
   Cada reserva se apunta en la misma base que los avisos del Drop 02
   (Upstash Redis por HTTP: sin paquetes que instalar). Cuatro claves, que
   se ven en Vercel → Storage → tu base → Data Browser:

     preventa:pedidos         lista con cada reserva en JSON, la última arriba
     preventa:tallas          cuántas de cada talla
     preventa:colores         cuántas de cada color
     preventa:combinaciones   cuántas de cada talla+color  ← la del taller

   OJO CON LO QUE CUENTA: esto se apunta al pulsar Reservar, o sea que son
   intenciones, no cobros. Quien se eche atrás en Stripe queda apuntado
   igual. La lista de los que han pagado de verdad es la de Stripe, donde
   cada enlace ya lleva su talla y su color en el nombre del producto; la
   referencia de seis letras es la que une una fila con el otro. */

// Los mismos nombres de variables que busca api/avisos.js: si la base ya
// está enchufada para los avisos, esto funciona sin tocar nada.
function credenciales() {
    const e = process.env;
    const conocidos = [
        ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
        ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
        ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN']
    ];
    for (const [u, tk] of conocidos) {
        if (e[u] && e[tk]) return { url: e[u], token: e[tk] };
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

// Seis letras y números para poder casar la fila de la libreta con el cobro
// que aparece luego en Stripe.
function referencia() {
    return require('crypto').randomBytes(3).toString('hex');
}

async function apuntar(pedido) {
    const cred = credenciales();
    if (!cred) return false;

    const fila = JSON.stringify({
        ref: pedido.ref,
        talla: pedido.talla,
        color: pedido.color,
        fecha: new Date().toISOString()
    });

    // Las cuatro escrituras van en una sola llamada (pipeline de Upstash),
    // que es un viaje de ida y vuelta y no cuatro delante del cliente.
    const r = await fetch(cred.url.replace(/\/+$/, '') + '/pipeline', {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + cred.token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([
            ['LPUSH', 'preventa:pedidos', fila],
            ['HINCRBY', 'preventa:tallas', pedido.talla, 1],
            ['HINCRBY', 'preventa:colores', pedido.color, 1],
            ['HINCRBY', 'preventa:combinaciones', pedido.talla + '-' + pedido.color, 1]
        ]),
        // Si la base se atasca, no dejamos al cliente esperando: se pierde
        // el apunte, no la venta.
        signal: AbortSignal.timeout(2500)
    });
    if (!r.ok) throw new Error('redis ' + r.status);
    return true;
}

// Si alguien llega aquí sin JavaScript y el pago no se puede abrir, mejor
// una página con el mismo aire que la web que el error pelado de Vercel.
function pagina(res, codigo, mensaje) {
    res.writeHead(codigo, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(
        '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>NOVA Supply Clothing · preventa</title>' +
        '<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:22px;background:#fff;color:#0e0e10;' +
        'font:300 15px/1.7 "Segoe UI",system-ui,sans-serif;text-align:center;padding:32px}' +
        'p{margin:0;max-width:34ch;color:#6f6b66}' +
        'a{color:#0e0e10;text-decoration:none;border-bottom:1px solid rgba(14,14,16,.25);' +
        'font-size:11px;letter-spacing:.24em;text-transform:uppercase}</style>' +
        '</head><body><p>' + mensaje + '</p><a href="/">Volver a la web</a></body></html>'
    );
}

module.exports = async (req, res) => {
    if (!Object.keys(ENLACES).length) {
        console.error('Preventa cerrada: la tabla ENLACES está vacía');
        return pagina(res, 503, 'La preventa todavía no está abierta. Déjanos tu correo en la web y te avisamos.');
    }

    // Sin una talla y un color de la tabla no se paga. El formulario ya los
    // exige, así que aquí sólo caen las direcciones escritas a mano o una
    // combinación que ya no existe: los devolvemos a la caja.
    const pedido = eleccion(req);
    if (!pedido) {
        res.writeHead(303, { Location: '/#preventa', 'Cache-Control': 'no-store' });
        return res.end();
    }

    pedido.ref = referencia();

    // La referencia viaja pegada al cobro: en el panel de Stripe sale en
    // "Referencia del cliente", y es lo que permite casarlo con la libreta.
    // La talla y el color no hace falta mandarlos: cada enlace ya es de una
    // talla y un color concretos, así que Stripe los sabe por el producto.
    let destino = pedido.enlace;
    try {
        const u = new URL(pedido.enlace);
        u.searchParams.set('client_reference_id', 'ref-' + pedido.ref);
        destino = u.toString();
    } catch { /* si el enlace estuviera mal escrito, mejor ir tal cual */ }

    // La libreta es un extra: si falla, la venta sigue adelante igual.
    try {
        await apuntar(pedido);
    } catch (e) {
        console.error('No se pudo apuntar la reserva ' + pedido.ref + ':', e.message);
    }

    res.writeHead(303, { Location: destino, 'Cache-Control': 'no-store' });
    return res.end();
};
