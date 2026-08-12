/* ══════════════════════════════════════════════════════════════════════════
   NOVA Studio · supernova generada por código
   ──────────────────────────────────────────────────────────────────────────
   Sustituye a los 300 fotogramas del vídeo. Todo se dibuja en un <canvas> en
   función de un único número t ∈ [0,1] que marca el scroll, así que:

     · se adapta a cualquier proporción de pantalla (no hay recortes)
     · no hay que descargar 121 MB de imágenes
     · el movimiento no está cuantizado a 300 pasos
     · el logo NACE del núcleo, no entra por fundido

   IMPORTANTE: el dibujo es determinista. Como el scroll puede saltar hacia
   atrás, nada puede depender del fotograma anterior; el azar sale de una
   semilla fija que se precalcula una sola vez.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const tramo = (v, a, b) => clamp((v - a) / (b - a));
const easeOut  = t => 1 - Math.pow(1 - t, 3);
const easeInOut= t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const suave    = t => t * t * (3 - 2 * t);

/* ── guion de la escena (todo en fracción de scroll) ─────────────────────── */
const T = {
    calma:     [0.00, 0.10],   // la estrella, todavía tranquila
    colapso:   [0.09, 0.225],  // se contrae y se calienta
    destello:  [0.215, 0.30],  // detonación
    rayos:     [0.225, 0.52],
    ondas:     [0.225, 0.80],
    brasas:    [0.235, 0.86],
    nubes:     [0.25, 0.84],
    nacer:     [0.46, 0.70],   // el logo emerge del núcleo
    cabecera:  [0.74, 1.00]    // sube y se ancla arriba
};

/* ── azar determinista (mulberry32) ──────────────────────────────────────── */
function semilla(s) {
    return () => {
        s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const R = semilla(0x4E4F5641);   // "NOVA"

/* Filamentos, no rayos.
   Una línea recta desde el centro delata que hay un ordenador detrás. Cada
   filamento es una cadena de nodos cuyo ángulo va derivando en un paseo
   aleatorio, así que serpentea y se abre como los jirones de gas de una
   supernova de verdad. Se dibuja con manchas de luz superpuestas: sin bordes
   vectoriales, sin aristas. */
const FILAMENTOS = Array.from({ length: 58 }, () => {
    const nodos = 14;
    const deriva = [];
    let d = 0;
    for (let j = 0; j < nodos; j++) {
        d += (R() - .5) * 0.30;          // el serpenteo se acumula hacia la punta
        deriva.push(d);
    }
    return {
        ang: R() * TAU,
        largo: 0.30 + Math.pow(R(), 1.6) * 1.0,
        grosor: 0.45 + R() * 1.7,
        retardo: R() * 0.13,
        frio: R() < 0.42,                // unos se enfrían a violeta, otros a brasa
        nudo: 0.5 + R() * 0.6,           // dónde engorda el jirón
        deriva
    };
});

const BRASAS = Array.from({ length: 420 }, () => ({
    ang: R() * TAU, vel: 0.18 + Math.pow(R(), .55) * 1.15,
    tam: 0.5 + R() * 2.6, retardo: R() * 0.10,
    vida: 0.5 + R() * 0.5, tono: R(), curva: (R() - .5) * 0.55,
    // sin esto todas salen en línea recta desde el centro y se ve el patrón
    onda: (R() - .5) * 0.30, fase: R() * TAU, freno: 0.75 + R() * 0.5
}));

const NUBES = Array.from({ length: 14 }, () => ({
    ang: R() * TAU, dist: 0.1 + R() * 0.62, tam: 0.22 + R() * 0.4,
    retardo: R() * 0.16, frio: R() < 0.42, giro: (R() - .5) * 0.5
}));

const GRUMOS = Array.from({ length: 7 }, () => ({
    ang: R() * TAU, dist: 0.25 + R() * 0.55, tam: 0.30 + R() * 0.5, frio: R() < 0.3
}));

const FUGAS = Array.from({ length: 90 }, () => ({
    ang: R() * TAU, dist: 0.06 + R() * 0.95, tam: 0.4 + R() * 1.1, retardo: R() * 0.05
}));

/* ── sprites de luz (mucho más rápido que shadowBlur por partícula) ──────── */
function sprite(rgb) {
    const s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0,   `rgba(${rgb},1)`);
    grd.addColorStop(.22, `rgba(${rgb},.55)`);
    grd.addColorStop(.55, `rgba(${rgb},.14)`);
    grd.addColorStop(1,   `rgba(${rgb},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    return c;
}
const SP = {
    blanco: sprite('255,246,228'),
    oro:    sprite('255,196,104'),
    ambar:  sprite('240,138,38'),
    brasa:  sprite('198,72,12'),
    hielo:  sprite('150,196,246'),
    lila:   sprite('158,140,232')    // los jirones se enfrían hacia el violeta
};

/* ══════════════════════════════════════════════════════════════════════════
   API pública: crearSupernova(canvas)
   ══════════════════════════════════════════════════════════════════════════ */
window.crearSupernova = function (cv) {
    const ctx = cv.getContext('2d');
    let VW = 0, VH = 0, DPR = 1, D = 0;      // D = radio hasta la esquina
    let logo = null, brillo = null, silueta = null, LW = 0, LH = 0;

    /* ── el logo y su resplandor, preparados una sola vez ── */
    const PAD = 170;
    function prepararLogo(img) {
        logo = img; LW = img.naturalWidth; LH = img.naturalHeight;

        // halo naranja, del color de la web (el PNG sólo trae las letras)
        const c = document.createElement('canvas');
        c.width = LW + PAD * 2; c.height = LH + PAD * 2;
        const g = c.getContext('2d');
        for (const [blur, col] of [[58, 'rgba(214,104,16,.55)'], [28, 'rgba(240,150,50,.6)'], [11, 'rgba(255,196,110,.7)']]) {
            g.save(); g.shadowBlur = blur; g.shadowColor = col;
            for (let k = 0; k < 3; k++) g.drawImage(img, PAD, PAD);
            g.restore();
        }
        g.drawImage(img, PAD, PAD);
        brillo = c;

        // silueta blanca: el logo aparece primero como pura luz y luego "enfría"
        const s = document.createElement('canvas');
        s.width = LW; s.height = LH;
        const sg = s.getContext('2d');
        sg.drawImage(img, 0, 0);
        sg.globalCompositeOperation = 'source-in';
        sg.fillStyle = '#fff';
        sg.fillRect(0, 0, LW, LH);
        silueta = s;
    }

    function medir() {
        DPR = Math.min(devicePixelRatio || 1, 2);
        VW = innerWidth; VH = innerHeight;
        if (!VW || !VH) return false;
        cv.width = VW * DPR; cv.height = VH * DPR;
        cv.style.width = VW + 'px'; cv.style.height = VH + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        D = Math.hypot(VW, VH) / 2;
        return true;
    }

    const luz = (sp, x, y, r, a) => {
        if (a <= 0.003 || r <= 0.2) return;
        ctx.globalAlpha = a;
        ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
    };

    /* ── dónde va el logo: grande en el centro → pequeño en la cabecera ── */
    function cajaLogo(k) {
        const anchoGrande = Math.min(VW * 0.80, VH * 1.85, 780);
        const grande = { w: anchoGrande, cx: VW / 2, cy: VH / 2 };

        const space = parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue('--logo-space')) || 150;
        const alto = space * 0.50;
        const anchoCab = Math.min(alto * (LW / LH), VW * 0.62);
        const cab = { w: anchoCab, cx: VW / 2, cy: space * 0.46 };

        const w  = lerp(grande.w,  cab.w,  k);
        const cx = lerp(grande.cx, cab.cx, k);
        const cy = lerp(grande.cy, cab.cy, k);
        const h = w * (LH / LW);
        return { x: cx - w / 2, y: cy - h / 2, w, h };
    }

    /* ══════════════ la escena ══════════════ */
    function pintar(t, reloj) {
        if (!VW && !medir()) return;
        ctx.clearRect(0, 0, VW, VH);

        const cx = VW / 2, cy = VH / 2;

        const colapso = tramo(t, ...T.colapso);
        const flash   = tramo(t, ...T.destello);
        const pRayos  = tramo(t, ...T.rayos);
        const pOndas  = tramo(t, ...T.ondas);
        const pBrasas = tramo(t, ...T.brasas);
        const pNubes  = tramo(t, ...T.nubes);
        const nacer   = tramo(t, ...T.nacer);
        const subir   = tramo(t, ...T.cabecera);

        ctx.globalCompositeOperation = 'lighter';

        /* ── 1. nubes de gas (al fondo de todo) ── */
        for (const n of NUBES) {
            const p = tramo(pNubes, n.retardo, 1);
            if (p <= 0) continue;
            const e = easeOut(p);
            const d = D * n.dist * e * 1.25;
            const a = n.ang + n.giro * e;
            luz(n.frio ? SP.hielo : SP.brasa,
                cx + Math.cos(a) * d, cy + Math.sin(a) * d,
                D * n.tam * (0.28 + e * 0.85),
                0.075 * Math.sin(Math.PI * p) * (1 - subir));
        }

        /* ── 2. filamentos de gas ── */
        if (pRayos > 0 && pRayos < 1) {
            const apaga = 1 - tramo(t, 0.44, 0.60);   // se retiran antes de que nazca el logo
            for (const f of FILAMENTOS) {
                const p = tramo(pRayos, f.retardo, 1);
                if (p <= 0) continue;
                const e = easeOut(p);
                const vida = Math.sin(Math.PI * Math.pow(p, .62)) * apaga;
                if (vida < 0.012) continue;

                const n = f.deriva.length;
                const alcance = D * f.largo * e * 1.45;

                // puntos del jirón
                const px = [], py = [];
                for (let j = 0; j < n; j++) {
                    const u = j / (n - 1);
                    const d = alcance * Math.pow(u, .82);
                    // el serpenteo casi no se nota al nacer y se abre al alejarse
                    const a = f.ang + f.deriva[j] * Math.pow(u, .75);
                    px.push(cx + Math.cos(a) * d);
                    py.push(cy + Math.sin(a) * d);
                }

                // el color se enfría con la distancia al núcleo
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(alcance, 1));
                g.addColorStop(0,   'rgba(255,253,247,1)');
                g.addColorStop(.30, 'rgba(255,212,142,.80)');
                g.addColorStop(.66, f.frio ? 'rgba(158,158,240,.34)' : 'rgba(238,132,44,.38)');
                g.addColorStop(1,   f.frio ? 'rgba(120,120,220,0)'   : 'rgba(200,80,16,0)');
                ctx.strokeStyle = g;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                /* Por tramos: canvas no sabe adelgazar un trazo a lo largo, así
                   que lo partimos. Cada tramo va más fino y más tenue, de modo
                   que el jirón se deshilacha hasta desaparecer en la punta. */
                const BANDAS = 6;
                for (let k = 0; k < 2; k++) {                    // halo + hebra
                    for (let b = 0; b < BANDAS; b++) {
                        const j0 = Math.floor(b * (n - 1) / BANDAS);
                        const j1 = Math.floor((b + 1) * (n - 1) / BANDAS);
                        const u = (b + .5) / BANDAS;
                        const merma = Math.pow(1 - u, 1.5);

                        ctx.globalAlpha = vida * (k ? .46 : .15) * Math.pow(1 - u, .9);
                        ctx.lineWidth = Math.max(0.5,
                            D * 0.0052 * f.grosor * merma * (k ? .85 : 3.1));
                        ctx.beginPath();
                        ctx.moveTo(px[j0], py[j0]);
                        for (let j = j0 + 1; j <= j1; j++) {
                            const mx = (px[j - 1] + px[j]) / 2, my = (py[j - 1] + py[j]) / 2;
                            ctx.quadraticCurveTo(px[j - 1], py[j - 1], mx, my);
                        }
                        ctx.lineTo(px[j1], py[j1]);
                        ctx.stroke();
                    }
                }
            }
        }

        /* ── 3. ondas expansivas ──
           Un círculo perfecto canta tanto como una recta: la deformamos con
           varias sinusoides y la dejamos abollada, como un frente de choque. */
        for (let i = 0; i < 3; i++) {
            const p = tramo(pOndas, i * 0.11, 0.72 + i * 0.09);
            if (p <= 0 || p >= 1) continue;
            const rad = D * 1.45 * easeOut(p);
            const a = (1 - p) * (1 - p) * (i === 0 ? 0.5 : 0.3);
            const col = i === 1 ? '150,196,246' : '255,186,96';
            const fase = i * 2.1;
            // Poca amplitud y en frecuencias altas: si el bulto es grande y lento
            // deja de parecer un frente de choque y parece un polígono redondeado.
            const amp = 0.032 * (1 - p * 0.5);

            const V = 168;
            ctx.beginPath();
            for (let v = 0; v <= V; v++) {
                const th = v / V * TAU;
                const m = 1 + amp * (Math.sin(th * 5 + fase) * .42
                                   + Math.sin(th * 9 - fase * 1.7) * .34
                                   + Math.sin(th * 17 + fase * .6) * .24);
                const r = rad * m;
                const x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r;
                v ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.closePath();
            // Banda luminosa, no un contorno: un trazo fino y brillante se lee
            // como una circunferencia dibujada, no como un frente de choque.
            const anchos = [0.060, 0.028, 0.010], alfas = [0.16, 0.30, 0.5];
            for (let k = 0; k < 3; k++) {
                ctx.globalAlpha = a * alfas[k];
                ctx.strokeStyle = `rgb(${col})`;
                ctx.lineWidth = Math.max(1, D * anchos[k] * (1 - p * .45));
                ctx.stroke();
            }
        }

        /* ── 4. brasas ── */
        for (const b of BRASAS) {
            const p = tramo(pBrasas, b.retardo, b.vida);
            if (p <= 0 || p >= 1) continue;
            const e = easeOut(p);
            // trayectoria curva y con vaivén: la brasa no viaja en línea recta
            const desvio = ang => ang + b.curva * e + Math.sin(e * 4.2 + b.fase) * b.onda * e;
            const dist = q => D * b.vel * b.freno * easeOut(q) * 1.45;

            const ang = desvio(b.ang);
            const d = dist(p);
            const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d;
            const a = (1 - p) * 0.85 * (1 - subir * 0.9);
            const sp = b.tono < .3 ? SP.blanco : b.tono < .78 ? SP.oro : SP.ambar;
            // estela: un punto más atrás, sobre la misma curva
            const qp = Math.max(0, p - .06);
            const ap = desvio(b.ang) - Math.sin(e * 4.2 + b.fase) * b.onda * (e - easeOut(qp));
            const dp = dist(qp);
            luz(sp, cx + Math.cos(ap) * dp, cy + Math.sin(ap) * dp, b.tam * D * 0.008, a * .35);
            luz(sp, x, y, b.tam * D * 0.011 * (1 - p * .45), a);
        }

        /* ── 5. estrellas fugaces del propio estallido ── */
        if (flash > 0 && flash < 1) {
            for (const f of FUGAS) {
                const p = tramo(flash, f.retardo, 1);
                if (p <= 0) continue;
                const d = D * f.dist * easeOut(p) * 1.2;
                luz(SP.blanco, cx + Math.cos(f.ang) * d, cy + Math.sin(f.ang) * d,
                    f.tam * D * 0.006, (1 - p) * 0.5);
            }
        }

        /* ── 6. el núcleo ── */
        {
            // late despacio antes de estallar (por eso entra el reloj)
            const late = 1 + Math.sin(reloj * 0.0022) * 0.06;
            const base = D * 0.055 * late;
            const contraido = base * (1 - colapso * 0.55);
            // el halo no puede crecer sin límite o acaba siendo una niebla beige
            const abierto = D * (0.09 + 0.42 * easeOut(tramo(t, T.destello[0], 0.62)));
            const estalla = t > T.destello[0];
            const r = estalla ? lerp(contraido, abierto, easeOut(tramo(t, T.destello[0], 0.5))) : contraido;

            // se apaga deprisa en cuanto el logo empieza a nacer: el relevo es él
            const vida = Math.pow(1 - nacer, 1.6) * (1 - subir);
            const calor = 1 + colapso * 1.6;

            luz(SP.ambar,  cx, cy, r * 2.2, 0.16 * vida);
            luz(SP.oro,    cx, cy, r * 1.3, 0.38 * vida * calor);
            luz(SP.blanco, cx, cy, r * 0.7, 0.80 * vida * calor);

            // bultos descentrados: un degradado perfectamente redondo no parece
            // materia ardiendo, sino una lámpara
            for (const g of GRUMOS) {
                luz(g.frio ? SP.lila : SP.oro,
                    cx + Math.cos(g.ang) * r * g.dist,
                    cy + Math.sin(g.ang) * r * g.dist,
                    r * g.tam * 0.7, 0.12 * vida);
            }

            // grano incandescente, siempre presente mientras dura el estallido
            luz(SP.blanco, cx, cy, Math.max(D * 0.018, r * 0.16), 0.95 * vida);
        }

        /* ── 7. destello ──
           Radial, no un rectángulo plano: un velo uniforme tapaba justo el
           instante en que la explosión tiene que verse. */
        {
            const pico = 1 - Math.abs(t - 0.245) / 0.038;
            if (pico > 0) {
                const a = Math.pow(pico, 1.9);
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, D * 1.1);
                g.addColorStop(0,   `rgba(255,250,238,${0.92 * a})`);
                g.addColorStop(.28, `rgba(255,222,164,${0.42 * a})`);
                g.addColorStop(.62, `rgba(255,160,54,${0.13 * a})`);
                g.addColorStop(1,   'rgba(255,130,20,0)');
                ctx.globalAlpha = 1;
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, VW, VH);
            }
        }

        /* ── 8. el logo, naciendo del núcleo ── */
        if (nacer > 0 && brillo) {
            const caja = cajaLogo(easeInOut(subir));
            const s = caja.w / LW;
            const ap = suave(nacer);

            ctx.globalCompositeOperation = 'lighter';
            // primero es pura luz…
            const blanco = ap * Math.pow(1 - nacer, 1.5) * 1.8;
            if (blanco > 0.004) {
                ctx.globalAlpha = Math.min(1, blanco);
                ctx.drawImage(silueta, caja.x, caja.y, caja.w, caja.h);
            }
            // …y el halo naranja crece con él
            ctx.globalAlpha = ap;
            ctx.drawImage(brillo, caja.x - PAD * s, caja.y - PAD * s,
                          brillo.width * s, brillo.height * s);

            // …hasta que las letras se imponen, ya con su color real
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = ap;
            ctx.drawImage(logo, caja.x, caja.y, caja.w, caja.h);
        }

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    return {
        medir,
        pintar,
        prepararLogo,
        get listo() { return !!brillo; }
    };
};
})();
