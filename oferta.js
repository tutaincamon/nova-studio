/* ══════════════════════════════════════════════════════════════════════════
   LA OFERTA DEL MOMENTO · un solo sitio para toda la web
   ──────────────────────────────────────────────────────────────────────────
   La leen la portada (precios tachados, la línea de aviso y la ventana de
   entrada), la ficha de cada prenda y el servidor (api/reserva.js guarda en
   la reserva el precio rebajado, que es el que el estudio cobra al recoger).

   Fuera de las fechas no hace nada: la web vuelve sola al precio de siempre
   y la ventana de entrada vuelve a ser la de la lista de correo. Para la
   próxima oferta se cambian estos datos y nada más; para quitarla antes de
   tiempo, se adelanta «hasta».

   Las horas van en la de Canarias (en invierno es la misma que UTC).
   ══════════════════════════════════════════════════════════════════════════ */
(function (raiz) {
    var OFERTA = {
        nombre:    'Black Friday',
        desde:     '2026-11-23T00:00:00Z',   // el 23/11 a primera hora
        hasta:     '2026-12-01T00:00:00Z',   // hasta el 30/11 a medianoche
        fechas:    'Del 23 al 30 de noviembre',
        descuento: 30,                       // %
        prendas:   ['camiseta', 'camiseta-rosa'],
        destacada: 'camiseta-rosa'           // la que enseña la ventana de entrada
    };

    function activa(ahora) {
        var t = (ahora || new Date()).getTime();
        return t >= Date.parse(OFERTA.desde) && t < Date.parse(OFERTA.hasta);
    }
    function aplica(id, ahora) { return activa(ahora) && OFERTA.prendas.indexOf(id) >= 0; }

    // «47,50 €» o 47.5 → 47.5
    function numero(precio) {
        if (typeof precio === 'number') return precio;
        var n = parseFloat(String(precio || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
        return isNaN(n) ? null : n;
    }
    function rebajado(precio) {
        var n = numero(precio);
        return n == null ? null : Math.round(n * (100 - OFERTA.descuento)) / 100;
    }
    function texto(n) {
        return n == null ? '' : n.toFixed(2).replace('.', ',').replace(',00', '') + ' €';
    }

    var api = { datos: OFERTA, activa: activa, aplica: aplica, numero: numero, rebajado: rebajado, texto: texto };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.OFERTA = api;
})(typeof window !== 'undefined' ? window : this);
