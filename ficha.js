/* ══════════════════════════════════════════════════════════════════════════
   LA FICHA DE UNA PRENDA
   ──────────────────────────────────────────────────────────────────────────
   prenda.html es una sola plantilla para las siete prendas. Aquí leemos el
   ?id= de la dirección, buscamos esa prenda en prendas.js y rellenamos la
   página. Si la prenda se puede apartar, montamos el formulario; si está
   agotada o aún no ha salido, en su lugar sale un aviso.

   Igual que en la portada, aquí NO se cobra: se aparta y se paga en tienda.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var ES_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var ES_TEL    = /^[+()\d][\d\s()+.-]{7,19}$/;
    var $ = function (id) { return document.getElementById(id); };

    var id = '';
    try { id = new URL(location.href).searchParams.get('id') || ''; } catch (e) { id = ''; }
    var p = window.PRENDA_POR_ID ? window.PRENDA_POR_ID(id) : null;

    if (!p) { $('noexiste').hidden = false; return; }

    /* ---------- cabecera de la página ---------- */
    var titulo = p.nombre + (p.variante ? ' · ' + p.variante : '');
    document.title = titulo + ' · NOVA Supply Clothing';

    /* ---------- las fotos ---------- */
    var del = $('foto-delante'), det = $('foto-detras');
    del.src = p.delante; del.alt = p.altDelante;
    det.src = p.detras;  det.alt = p.altDetras;

    var caraActual = 'delante';
    function pinta(cara) {
        caraActual = cara;
        del.classList.toggle('activa', cara === 'delante');
        det.classList.toggle('activa', cara === 'detras');
        Array.prototype.forEach.call($('caras').querySelectorAll('button'), function (b) {
            b.setAttribute('aria-pressed', b.getAttribute('data-cara') === cara ? 'true' : 'false');
        });
        $('visor').setAttribute('aria-label',
            titulo + ', ' + (cara === 'delante' ? 'por delante' : 'por detrás') + '. Pulsa para girarla.');
    }
    $('visor').addEventListener('click', function () {
        pinta(caraActual === 'delante' ? 'detras' : 'delante');
    });
    Array.prototype.forEach.call($('caras').querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () { pinta(b.getAttribute('data-cara')); });
    });
    pinta('delante');

    /* ---------- los datos ---------- */
    var sello = $('sello');
    sello.textContent = window.SELLO(p);
    if (p.estado === 'agotado') sello.classList.add('fin');

    $('nombre').textContent = p.nombre;
    if (p.variante) { $('variante').textContent = p.variante; $('variante').hidden = false; }
    if (p.precio)   { $('precio').textContent   = p.precio;   $('precio').hidden   = false; }
    $('texto').textContent = p.texto;

    $('ficha').hidden = false;

    /* ---------- ¿se puede apartar? ---------- */
    if (p.estado !== 'disponible' || !p.tallas.length) {
        $('cerrado').hidden = false;
        $('cerrado-texto').textContent = p.estado === 'agotado'
            ? 'Esta se ha agotado. Únete a la lista y te avisamos si vuelve a entrar.'
            : 'Todavía no ha salido. Únete a la lista y serás de los primeros en saberlo.';
        return;
    }

    /* ---------- el formulario ---------- */
    $('aparta').hidden = false;

    var cajaTallas = $('tallas-opciones');
    p.tallas.forEach(function (t, i) {
        var lab = document.createElement('label');
        lab.className = 'opcion';
        var inp = document.createElement('input');
        inp.type = 'radio'; inp.name = 'talla'; inp.value = t;
        if (i === 0) inp.checked = true;
        var sp = document.createElement('span');
        sp.textContent = t;
        lab.appendChild(inp); lab.appendChild(sp);
        cajaTallas.appendChild(lab);
    });

    var form = $('form'), aviso = $('avisillo');

    function falla(msg, campo) {
        aviso.textContent = msg;
        if (campo) { campo.classList.add('mal'); campo.focus(); }
        return false;
    }
    function valor(n) { var c = form.elements[n]; return c ? String(c.value || '').trim() : ''; }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        Array.prototype.forEach.call(form.querySelectorAll('.mal'), function (c) { c.classList.remove('mal'); });
        aviso.textContent = '';

        var marcada = form.querySelector('input[name="talla"]:checked');
        var datos = {
            nombre: valor('nombre'), tel: valor('tel'), correo: valor('correo'),
            talla: marcada ? marcada.value : '', color: p.color
        };

        if (!datos.talla)                  return falla('Elige una talla.');
        if (datos.nombre.length < 2)       return falla('Dinos tu nombre.', form.elements.nombre);
        if (!ES_TEL.test(datos.tel))       return falla('Ese teléfono no parece correcto.', form.elements.tel);
        if (!ES_CORREO.test(datos.correo)) return falla('Ese correo no parece correcto.', form.elements.correo);

        var boton = form.querySelector('button[type=submit]');
        boton.disabled = true;
        aviso.textContent = 'Apartándola…';

        fetch('/api/reserva', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, datos: d }; }); })
        .then(function (res) {
            if (res.ok && res.datos && res.datos.ok) {
                $('ref').textContent = res.datos.ref;
                $('ficha').hidden = true;
                $('hecho').hidden = false;
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            throw new Error((res.datos && res.datos.error) || 'fallo');
        })
        .catch(function () {
            boton.disabled = false;
            aviso.textContent = 'No hemos podido apartarla. Inténtalo otra vez o escríbenos.';
        });
    });

    /* ---------- la guía de tallas ----------
       Es un <dialog>: el navegador oscurece el fondo, atrapa el foco y lo
       cierra con Esc. Si no supiera de <dialog>, el enlace abre la imagen. */
    (function () {
        var abre = $('guia'), caja = $('tallas');
        if (!abre || !caja || !caja.showModal) return;

        var tablas = { gris: $('tabla-gris'), rosa: $('tabla-rosa') };
        var botones = caja.querySelectorAll('.tallas-caras button');

        function ensena(cual) {
            if (!tablas[cual]) cual = 'gris';
            for (var c in tablas) tablas[c].hidden = (c !== cual);
            Array.prototype.forEach.call(botones, function (b) {
                b.setAttribute('aria-pressed', b.getAttribute('data-tabla') === cual ? 'true' : 'false');
            });
        }
        Array.prototype.forEach.call(botones, function (b) {
            b.addEventListener('click', function () { ensena(b.getAttribute('data-tabla')); });
        });

        abre.addEventListener('click', function (e) {
            e.preventDefault();
            ensena(p.color || 'gris');       // abre por la tabla de su color
            caja.showModal();
        });

        // clic en el fondo oscuro: el evento le llega al propio <dialog>
        caja.addEventListener('click', function (e) { if (e.target === caja) caja.close(); });
    })();
})();
