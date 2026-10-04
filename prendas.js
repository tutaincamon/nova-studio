/* ══════════════════════════════════════════════════════════════════════════
   EL CATÁLOGO · una sola lista para toda la web
   ──────────────────────────────────────────────────────────────────────────
   La portada la usa para pintar la rejilla y prenda.html para pintar la ficha
   grande. Al estar en un único sitio, cambiar un precio o abrir una talla se
   hace aquí y se ve en los dos lados.

   estado:
     'disponible'    se puede apartar; manda la lista de tallas
     'agotado'       se enseña tachada, no se puede apartar
     'proximamente'  todavía no ha salido

   Si abres una talla nueva, acuérdate de añadirla también a TALLAS en
   api/reserva.js: esa lista es la que manda de verdad.
   ══════════════════════════════════════════════════════════════════════════ */
window.PRENDAS = [
    {
        id: 'camiseta',
        nombre: 'Camiseta',
        variante: 'Gris lavado',
        color: 'gris',
        precio: '47,50 €',
        estado: 'agotado',
        tallas: [],
        delante: 'gris-delante.jpg',
        detras:  'gris-detras.jpg',
        altDelante: 'Camiseta NOVA Supply Clothing gris por delante, con el emblema en el pecho',
        altDetras:  'Camiseta NOVA Supply Clothing gris por detrás, con NOVA en grande',
        texto: 'Algodón pesado lavado a la piedra, corte boxy y caída recta. El emblema bordado en el pecho y NOVA en grande a la espalda.'
    },
    {
        id: 'camiseta-rosa',
        nombre: 'Camiseta',
        variante: 'Rosa lavado',
        color: 'rosa',
        precio: '47,50 €',
        estado: 'disponible',
        tallas: ['L', 'XL', 'XXL'],
        delante: 'rosa-delante.jpg',
        detras:  'rosa-detras.jpg',
        altDelante: 'Camiseta NOVA Supply Clothing rosa por delante, con el emblema en el pecho',
        altDetras:  'Camiseta NOVA Supply Clothing rosa por detrás, con NOVA en grande',
        texto: 'La misma camiseta en rosa lavado. Algodón pesado, corte boxy y caída recta, con el emblema bordado en el pecho y NOVA a la espalda.'
    },
    {
        id: 'sudadera',
        nombre: 'Sudadera',
        variante: '',
        color: '',
        precio: '',
        estado: 'proximamente',
        tallas: [],
        delante: 'sud-delante.jpg',
        detras:  'sud-detras.jpg',
        altDelante: 'Sudadera NOVA Supply Clothing por delante, con cremallera y Studio y Nova en las mangas',
        altDetras:  'Sudadera NOVA Supply Clothing por detrás, con el emblema grande en la espalda',
        texto: 'Sudadera con cremallera y capucha, teñida a mano y con desgastes hechos uno a uno. Studio y Nova en las mangas, emblema grande a la espalda.'
    },
    {
        id: 'p-camisa',
        nombre: 'Camisa',
        variante: '',
        color: '',
        precio: '',
        estado: 'proximamente',
        tallas: [],
        delante: 'd2-camisa-delante.jpg',
        detras:  'd2-camisa-detras.jpg',
        altDelante: 'Camisa de NOVA Supply Clothing, de manga corta gris con el emblema en el pecho',
        altDetras:  'Camisa de NOVA Supply Clothing, de manga corta gris con NOVA en grande en la espalda',
        texto: 'Camisa de manga corta en cuadro fino, corte holgado y botón de nácar. Emblema al pecho y NOVA en grande a la espalda.'
    },
    {
        id: 'p-tirantes',
        nombre: 'Tirantes',
        variante: '',
        color: '',
        precio: '',
        estado: 'proximamente',
        tallas: [],
        delante: 'd2-tirantes-delante.jpg',
        detras:  'd2-tirantes-detras.jpg',
        altDelante: 'Camiseta de tirantes de NOVA Supply Clothing, blanca con el emblema en el pecho',
        altDetras:  'Camiseta de tirantes de NOVA Supply Clothing, blanca lisa por detrás',
        texto: 'Camiseta de tirantes de canalé, blanca y ajustada, con el emblema al pecho y la etiqueta tejida en el bajo.'
    },
    {
        id: 'p-vaqueros',
        nombre: 'Vaqueros',
        variante: '',
        color: '',
        precio: '',
        estado: 'proximamente',
        tallas: [],
        delante: 'd2-vaqueros-delante.jpg',
        detras:  'd2-vaqueros-detras.jpg',
        altDelante: 'Vaqueros cortos de NOVA Supply Clothing, pantalón vaquero corto claro por delante',
        altDetras:  'Vaqueros cortos de NOVA Supply Clothing, pantalón vaquero corto claro con el emblema en el bolsillo',
        texto: 'Vaquero corto de pierna ancha en lavado claro, largo por la rodilla y el emblema en el bolsillo de atrás.'
    },
    {
        id: 'p-short',
        nombre: 'Short',
        variante: '',
        color: '',
        precio: '',
        estado: 'proximamente',
        tallas: [],
        delante: 'd2-short-delante.jpg',
        detras:  'd2-short-detras.jpg',
        altDelante: 'Pantalón corto de NOVA Supply Clothing, beige con NOVA en la pernera',
        altDetras:  'Pantalón corto de NOVA Supply Clothing, beige con el emblema en el bolsillo',
        texto: 'Pantalón corto de felpa en beige, cintura elástica con cordón, NOVA en la pernera y el emblema en el bolsillo.'
    }
];

/* Lo que se enseña en el sello de cada ficha */
window.SELLO = function (p) {
    if (p.estado === 'agotado')      return 'Sold out';
    if (p.estado === 'proximamente') return 'Próximamente';
    return p.tallas.length ? 'Quedan ' + p.tallas.join(' · ') : 'Disponible';
};

window.PRENDA_POR_ID = function (id) {
    for (var i = 0; i < window.PRENDAS.length; i++) {
        if (window.PRENDAS[i].id === id) return window.PRENDAS[i];
    }
    return null;
};
