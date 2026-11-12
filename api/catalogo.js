/* GET /api/catalogo · las prendas con las tallas que quedan libres ahora mismo.
   Lo usan la portada (los sellos «Quedan L · XL») y la ficha de cada prenda.
   Si la base no tiene catálogo todavía, contesta 404 y la web sigue con
   prendas.js. Aquí no viaja ningún dato personal. */
const S = require('./_supply');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=20, stale-while-revalidate=60');
    const cred = S.credenciales();
    if (!cred) return res.status(404).json({ ok: false });
    try {
        const prendas = await S.catalogo(cred);
        if (!prendas) return res.status(404).json({ ok: false });
        return res.status(200).json({ ok: true, prendas });
    } catch (e) {
        console.error('catalogo:', e.message);
        return res.status(502).json({ ok: false });
    }
};
