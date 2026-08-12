/* ══════════════════════════════════════════════════════════════════════════
   NOVA Studio · el fondo de estrellas, vivo
   ──────────────────────────────────────────────────────────────────────────
   Tres capas, de más quieta a más viva:

     1. base      cientos de estrellas fijas, pintadas UNA vez en un lienzo
                  aparte. Cada fotograma sólo se copia: no se recalculan.
     2. vivas     unas decenas que laten, y unas pocas que destellan de tarde
                  en tarde con un brillo en cruz.
     3. cometas   un haz corto y leve que cruza cada pocos segundos.

   A diferencia de la supernova, esto NO depende del scroll sino del reloj:
   la página respira aunque nadie la toque.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;

function semilla(s) {
    return () => {
        s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

window.crearCielo = function (cv) {
    const ctx = cv.getContext('2d');
    const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let VW = 0, VH = 0, DPR = 1;
    let base = null;                 // lienzo con las estrellas fijas
    let vivas = [], cometas = [], proximoCometa = 3000;

    /* ── estrellas fijas: se pintan una sola vez ── */
    function construirBase() {
        base = document.createElement('canvas');
        base.width = cv.width; base.height = cv.height;
        const g = base.getContext('2d');
        g.setTransform(DPR, 0, 0, DPR, 0, 0);

        const R = semilla(0x43494548);          // "CIEH": mismo cielo en cada visita
        const n = Math.round(VW * VH / 1400);
        for (let i = 0; i < n; i++) {
            const x = R() * VW, y = R() * VH;
            const r = R() < .93 ? R() * .85 + .22 : R() * 1.4 + .95;
            const a = R() * .55 + .10;
            const t = R();
            const col = t < .74 ? '255,255,255' : t < .88 ? '198,220,255' : '255,226,182';
            g.beginPath();
            g.arc(x, y, r, 0, TAU);
            g.fillStyle = `rgba(${col},${a})`;
            g.fill();
        }
    }

    /* ── las que se mueven ── */
    function sembrarVivas() {
        const R = semilla(0x56495641);          // "VIVA"
        const n = Math.round(clamp(VW * VH / 16000, 26, 90));
        vivas = Array.from({ length: n }, () => {
            const raro = R() < .22;             // ~1 de cada 5 llega a destellar
            return {
                x: R(), y: R(),                 // en fracción: sobreviven al resize
                r: .55 + R() * 1.25,
                brillo: .22 + R() * .5,
                per: 1500 + R() * 4200,
                fase: R() * TAU,
                raro,
                perRaro: 7000 + R() * 14000,
                faseRaro: R() * TAU,
                frio: R() < .3
            };
        });
    }

    function medir() {
        DPR = Math.min(devicePixelRatio || 1, 2);
        VW = innerWidth; VH = innerHeight;
        if (!VW || !VH) return false;
        cv.width = VW * DPR; cv.height = VH * DPR;
        cv.style.width = VW + 'px'; cv.style.height = VH + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        construirBase();
        sembrarVivas();
        return true;
    }

    /* ── cometas ──
       Cortos, tenues y de paso: si son largos o brillantes cansan enseguida. */
    function lanzarCometa(reloj) {
        const R = Math.random;
        // Entra por arriba y baja en diagonal marcada. Con ángulos casi
        // horizontales cruzaba la franja superior y desaparecía sin que diera
        // tiempo a verlo.
        const haciaDerecha = R() < .5;
        const x0 = haciaDerecha ? R() * VW * .45 - VW * .06
                                : VW * .61 + R() * VW * .45;
        const y0 = -VH * .04 + R() * VH * .30;
        const inclina = 0.62 + R() * 0.5;                  // ~35° a 64°
        const ang = haciaDerecha ? inclina : Math.PI - inclina;

        cometas.push({
            t0: reloj,
            dur: 1800 + R() * 1500,
            x0, y0, ang,
            dist: (0.55 + R() * 0.4) * Math.hypot(VW, VH),
            largo: 85 + R() * 145,
            grosor: 1.1 + R() * 0.9,
            brillo: 0.42 + R() * 0.32,
            frio: R() < 0.45
        });
    }

    function pintarCometa(c, reloj) {
        const p = (reloj - c.t0) / c.dur;
        if (p < 0 || p > 1) return p <= 1;
        // aparece y se apaga suavemente: nunca "salta" a la vista
        const vida = Math.sin(Math.PI * p);
        const av = p * p * (3 - 2 * p);                     // acelera y frena
        const co = Math.cos(c.ang), si = Math.sin(c.ang);
        const x = c.x0 + co * c.dist * av;
        const y = c.y0 + si * c.dist * av;
        const lx = x - co * c.largo, ly = y - si * c.largo;

        const col = c.frio ? '188,214,255' : '255,226,178';
        const g = ctx.createLinearGradient(x, y, lx, ly);
        g.addColorStop(0, `rgba(${col},${c.brillo * vida})`);
        g.addColorStop(.35, `rgba(${col},${c.brillo * vida * .35})`);
        g.addColorStop(1, `rgba(${col},0)`);

        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = g;
        ctx.lineCap = 'round';
        ctx.lineWidth = c.grosor;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(x, y);
        ctx.stroke();

        // cabeza
        const h = ctx.createRadialGradient(x, y, 0, x, y, c.grosor * 3.2);
        h.addColorStop(0, `rgba(255,255,255,${c.brillo * vida})`);
        h.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = h;
        ctx.beginPath();
        ctx.arc(x, y, c.grosor * 3.2, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        return true;
    }

    /* ── un fotograma ── */
    function pintar(reloj) {
        if (!VW && !medir()) return;
        ctx.clearRect(0, 0, VW, VH);
        if (base) ctx.drawImage(base, 0, 0, VW, VH);

        if (quieto) return;                                  // sin movimiento si lo piden

        ctx.globalCompositeOperation = 'lighter';
        for (const s of vivas) {
            const x = s.x * VW, y = s.y * VH;
            // latido de fondo
            let a = s.brillo * (.42 + .58 * (.5 + .5 * Math.sin(reloj / s.per + s.fase)));

            // destello ocasional: la potencia alta hace que el pico sea raro y breve
            let chispa = 0;
            if (s.raro) {
                const onda = .5 + .5 * Math.sin(reloj / s.perRaro + s.faseRaro);
                chispa = Math.pow(onda, 16);
                a += chispa * .85;
            }

            const col = s.frio ? '206,226,255' : '255,246,226';
            const g = ctx.createRadialGradient(x, y, 0, x, y, s.r * 3.4);
            g.addColorStop(0, `rgba(${col},${clamp(a, 0, 1)})`);
            g.addColorStop(.4, `rgba(${col},${clamp(a * .28, 0, 1)})`);
            g.addColorStop(1, `rgba(${col},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, s.r * 3.4, 0, TAU);
            ctx.fill();

            // en el pico le sale la cruz de las estrellas brillantes
            if (chispa > .06) {
                const L = s.r * (5 + chispa * 16);
                ctx.strokeStyle = `rgba(${col},${chispa * .55})`;
                ctx.lineWidth = Math.max(.6, s.r * .5);
                ctx.beginPath();
                ctx.moveTo(x - L, y); ctx.lineTo(x + L, y);
                ctx.moveTo(x, y - L); ctx.lineTo(x, y + L);
                ctx.stroke();
            }
        }
        ctx.globalCompositeOperation = 'source-over';

        // cometas
        if (reloj > proximoCometa) {
            lanzarCometa(reloj);
            proximoCometa = reloj + 5200 + Math.random() * 7500;
        }
        cometas = cometas.filter(c => reloj - c.t0 < c.dur);
        for (const c of cometas) pintarCometa(c, reloj);
    }

    return { medir, pintar };
};
})();
