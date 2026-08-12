// Servidor de la web de NOVA Studio.
//   node server.js        → http://localhost:5173
//   node server.js 8080   → http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');
const gcal = require('./google-calendar');

const PORT = Number(process.argv[2]) || 5173;
const ROOT = __dirname;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.woff2':'font/woff2'
};

// Nunca servimos claves ni datos de clientes aunque estén en la carpeta
const PRIVADO = /^(google-credentials\.json|reservas\.json|candidaturas\.json|config\.json)$/i;

const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
};

const leerCuerpo = (req, max = 1e5) => new Promise((ok, ko) => {
    let b = '';
    req.on('data', c => {
        b += c;
        if (b.length > max) { ko(new Error('cuerpo demasiado grande')); req.destroy(); }
    });
    req.on('end', () => ok(b));
    req.on('error', ko);
});

function apuntar(archivo, registro) {
    const f = path.join(ROOT, archivo);
    const lista = (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } })();
    lista.push({ ...registro, recibido: new Date().toISOString() });
    fs.writeFileSync(f, JSON.stringify(lista, null, 2));
}

const CAMPOS_OBLIGATORIOS = ['nombre', 'tel', 'servicio', 'fecha', 'hora'];

http.createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);

    // ---------------- reservas ----------------
    if (req.method === 'POST' && url === '/api/reservas') {
        try {
            const r = JSON.parse(await leerCuerpo(req));
            for (const c of CAMPOS_OBLIGATORIOS) {
                if (!r[c] || !String(r[c]).trim()) return json(res, 400, { ok: false, error: `falta ${c}` });
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fecha) || !/^\d{2}:\d{2}$/.test(r.hora)) {
                return json(res, 400, { ok: false, error: 'fecha u hora con formato incorrecto' });
            }

            const reserva = {
                nombre: String(r.nombre).slice(0, 120),
                tel:    String(r.tel).slice(0, 40),
                email:  String(r.email || '').slice(0, 120),
                servicio: String(r.servicio).slice(0, 80),
                pro:    String(r.pro || 'Sin preferencia').slice(0, 60),
                fecha: r.fecha, hora: r.hora,
                notas:  String(r.notas || '').slice(0, 600)
            };

            let calendario = { conectado: false };
            if (gcal.disponible()) {
                try {
                    const ev = await gcal.crearEvento(reserva);
                    calendario = { conectado: true, id: ev.id, enlace: ev.htmlLink };
                } catch (e) {
                    console.error('[calendar]', e.message);
                    calendario = { conectado: false, error: e.message };
                }
            }

            apuntar('reservas.json', { ...reserva, calendario });
            return json(res, 200, { ok: true, calendario, duracion: gcal.minutos(reserva.servicio) });
        } catch (e) {
            return json(res, 400, { ok: false, error: e.message });
        }
    }

    // ---------------- candidaturas ----------------
    if (req.method === 'POST' && url === '/api/candidaturas') {
        try {
            const c = JSON.parse(await leerCuerpo(req));
            if (!c.nombre || !c.tel) return json(res, 400, { ok: false, error: 'faltan datos' });
            apuntar('candidaturas.json', {
                nombre: String(c.nombre).slice(0, 120),
                tel:    String(c.tel).slice(0, 40),
                email:  String(c.email || '').slice(0, 120),
                puesto: String(c.puesto || '').slice(0, 80),
                experiencia: String(c.experiencia || '').slice(0, 40),
                mensaje: String(c.mensaje || '').slice(0, 1200)
            });
            return json(res, 200, { ok: true });
        } catch (e) {
            return json(res, 400, { ok: false, error: e.message });
        }
    }

    // ¿está el calendario configurado? (la web adapta el mensaje de confirmación)
    if (url === '/api/estado') return json(res, 200, { calendario: gcal.disponible() });

    // ---------------- ficheros estáticos ----------------
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    if (PRIVADO.test(rel)) { res.writeHead(403).end('403'); return; }

    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('403'); return; }

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 · no encontrado');
            return;
        }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
            'Content-Type': TYPES[ext] || 'application/octet-stream',
            // los fotogramas no cambian nunca: que el navegador los reutilice
            'Cache-Control': ext === '.png' ? 'public, max-age=31536000, immutable' : 'no-cache'
        });
        res.end(data);
    });
}).listen(PORT, () => {
    console.log(`NOVA Studio · http://localhost:${PORT}`);
    console.log(gcal.disponible()
        ? `Google Calendar: activo (${gcal.config().calendarId})`
        : 'Google Calendar: sin configurar — las reservas se guardan en reservas.json');
});
