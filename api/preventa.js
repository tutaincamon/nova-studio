/* ══════════════════════════════════════════════════════════════════════════
   GET /api/preventa   ·   la puerta al pago de la preventa (Stripe)
   ──────────────────────────────────────────────────────────────────────────
   La caja de la web es un enlace normal a esta dirección, y esta función
   contesta con una redirección a Stripe. Así el pago se abre igual aunque el
   navegador no ejecute JavaScript, y la clave de Stripe no baja nunca al
   cliente: se queda aquí, en el servidor.

   Se configura en Vercel → Settings → Environment Variables. Hay dos
   caminos, y con cualquiera de los dos la caja de la web se enciende sola:

   1) EL FÁCIL · un enlace de pago ya hecho
      En el panel de Stripe → Enlaces de pago → creas el producto con su
      precio y copias el enlace que te da (https://buy.stripe.com/...):

          STRIPE_LINK = https://buy.stripe.com/xxxxxxxxxxxx

      El precio, las tallas, cuántas unidades puede llevarse cada uno y si
      hay que pedirle la dirección de envío se cambian desde Stripe, sin
      tocar la web. Si además quieres que vuelva a la página al terminar,
      en el enlace pon como página de confirmación:
          https://TU-DOMINIO/?pago=ok#preventa

   2) EL COMPLETO · una sesión de pago nueva por cada clic

          STRIPE_SECRET_KEY = sk_live_...   (Desarrolladores → Claves de API)
          STRIPE_PRICE_ID   = price_...     (el precio dentro del catálogo)

      Aquí la vuelta ya está puesta: Stripe devuelve al cliente a /?pago=ok
      o a /?pago=no y la web le da el mensaje que toca.

   LA TALLA Y EL COLOR se eligen en la web, antes de venir aquí, y llegan
   en la dirección (?talla=M&color=gris). Van a dos sitios:

     1) a Stripe, pegados al cobro —
        · con enlace de pago → en «Referencia del cliente», como
          talla-M_color-gris_ref-a3f9c1
        · con clave + precio → en los metadatos, cada uno en su campo
     2) a la base de datos, para poder contarlos. Ver LA LIBRETA, más abajo.

   Si cambias las tallas o los colores, tócalos en los dos sitios: en la
   lista de aquí abajo y en el formulario de index.html.

   Mientras no haya ninguna de las dos cosas, quien pulse la caja no verá un
   error de Vercel: le sale una página con el aire de la web diciendo que la
   preventa todavía no está abierta, y un enlace para volver.

   La clave secreta NUNCA va en el código: sólo en las variables de Vercel.
   ══════════════════════════════════════════════════════════════════════════ */

const SESIONES = 'https://api.stripe.com/v1/checkout/sessions';

// Lo que se puede pedir. Si algún día cambian las tallas o los colores,
// hay que tocarlo en los dos sitios: aquí y en el formulario de index.html.
const TALLAS = ['S', 'M', 'L', 'XL', 'XXL'];
const COLORES = ['gris', 'rosa'];

// Talla y color llegan en la propia dirección (?talla=M&color=gris), que
// es lo que manda el formulario de la caja. No nos fiamos de lo que venga:
// si no está en las listas, no vale.
function eleccion(req) {
    let q;
    try { q = new URL(req.url || '/', 'http://n').searchParams; } catch { return null; }
    const talla = String(q.get('talla') || '').trim().toUpperCase();
    const color = String(q.get('color') || '').trim().toLowerCase();
    if (!TALLAS.includes(talla) || !COLORES.includes(color)) return null;
    return { talla, color };
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
   igual. La lista de los que han pagado de verdad es la de Stripe, y cada
   cobro lleva su talla y su color; la referencia de seis letras es la que
   une una fila con el otro. */

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

// El enlace de pago, si lo hay. Sólo se acepta por https: esta dirección
// redirige a donde diga la variable, y una variable mal puesta no puede
// convertir la web en un trampolín a cualquier sitio.
function enlace() {
    const url = String(process.env.STRIPE_LINK || process.env.STRIPE_PAYMENT_LINK || '').trim();
    return /^https:\/\/[^\s]+$/.test(url) ? url : '';
}

// Cuál de los dos caminos está configurado, si es que hay alguno.
function camino() {
    const e = process.env;
    if (enlace()) return 'enlace';
    if (e.STRIPE_SECRET_KEY && e.STRIPE_PRICE_ID) return 'checkout';
    return null;
}

// El dominio por el que ha entrado el cliente, para devolverlo a la misma
// web (en Vercel la petición llega por un proxy, de ahí las x-forwarded-*).
function origen(req) {
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return host ? proto + '://' + host : '';
}

async function sesionDePago(req, pedido) {
    const raiz = origen(req);
    const campos = new URLSearchParams({
        mode: 'payment',
        'line_items[0][price]': process.env.STRIPE_PRICE_ID,
        'line_items[0][quantity]': '1',
        success_url: raiz + '/?pago=ok#preventa',
        cancel_url: raiz + '/?pago=no#preventa',
        // La talla y el color quedan pegados al pago: en el panel de Stripe
        // salen tanto en la sesión como en el cobro, que es donde se miran
        // luego para preparar el pedido.
        'metadata[talla]': pedido.talla,
        'metadata[color]': pedido.color,
        'metadata[ref]': pedido.ref,
        'payment_intent_data[metadata][talla]': pedido.talla,
        'payment_intent_data[metadata][color]': pedido.color,
        'payment_intent_data[metadata][ref]': pedido.ref,
        client_reference_id: pedido.ref
    });

    const r = await fetch(SESIONES, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: campos.toString()
    });

    const datos = await r.json().catch(() => ({}));
    if (!r.ok || !datos.url) {
        throw new Error((datos.error && datos.error.message) || 'stripe ' + r.status);
    }
    return datos.url;
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
    const via = camino();

    if (!via) {
        console.error('Preventa sin configurar: falta STRIPE_LINK (o STRIPE_SECRET_KEY + STRIPE_PRICE_ID)');
        return pagina(res, 503, 'La preventa todavía no está abierta. Déjanos tu correo en la web y te avisamos.');
    }

    // Sin talla y color no se paga. El formulario ya los exige, así que aquí
    // sólo caen las direcciones escritas a mano: los devolvemos a la caja.
    const pedido = eleccion(req);
    if (!pedido) {
        res.writeHead(303, { Location: '/#preventa', 'Cache-Control': 'no-store' });
        return res.end();
    }

    pedido.ref = referencia();

    try {
        let destino;
        if (via === 'enlace') {
            // En un enlace de pago la talla y el color no caben como tales,
            // así que viajan en client_reference_id: en el panel de Stripe
            // aparece junto al cobro, en "Referencia del cliente".
            const u = new URL(enlace());
            u.searchParams.set(
                'client_reference_id',
                'talla-' + pedido.talla + '_color-' + pedido.color + '_ref-' + pedido.ref
            );
            destino = u.toString();
        } else {
            destino = await sesionDePago(req, pedido);
        }

        // La libreta es un extra: si falla, la venta sigue adelante igual.
        try {
            await apuntar(pedido);
        } catch (e) {
            console.error('No se pudo apuntar la reserva ' + pedido.ref + ':', e.message);
        }

        res.writeHead(303, { Location: destino, 'Cache-Control': 'no-store' });
        return res.end();
    } catch (e) {
        console.error('No se pudo abrir el pago:', e.message);
        return pagina(res, 502, 'El pago no responde ahora mismo. Inténtalo otra vez en un rato.');
    }
};
