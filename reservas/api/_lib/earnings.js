// «Cuánto gana Nova»: gastos del mes y beneficio neto. Funciones puras, sin
// Redis, para poder usarlas igual en el servidor y en las pruebas.
//
// Gastos de un mes (clave `gastos:<AAAA-MM>`):
//   fixed:   { alquiler, luz, agua, internet, productos, seguridadSocial, autonomo, gestoria, software, otros }
//   salaries:{ <idBarbero>: sueldo fijo }
//   pct:     { <idBarbero>: % de comisión de ESTE análisis }  (solo los que el dueño ha cambiado)
//   extras:  [{ name, amount }]  conceptos libres
//
// Beneficio neto = ingresos − gastos fijos (fijos + sueldos + extras) − comisiones.

export const FIXED = [
  ["alquiler", "Alquiler"],
  ["luz", "Luz"],
  ["agua", "Agua"],
  ["internet", "Internet"],
  ["productos", "Productos"],
  ["seguridadSocial", "Seguridad Social"],
  ["autonomo", "Cuota de autónomo"],
  ["gestoria", "Gestoría"],
  ["software", "Booksy / software"],
  ["otros", "Otros"],
];
export const MAX_AMOUNT = 100000;
export const MAX_EXTRAS = 30;

const r2 = (n) => Math.round(n * 100) / 100;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Importe: número >= 0 y razonable. Admite coma decimal. Lanza Error con un texto para el dueño.
export function amount(v, label) {
  if (v === "" || v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`«${label}»: pon un importe de 0 o más.`);
  if (n > MAX_AMOUNT) throw new RangeError(`«${label}»: el máximo es ${MAX_AMOUNT.toLocaleString("es-ES")} €.`);
  return r2(n);
}
export function percent(v, label) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new RangeError(`«${label}»: el porcentaje va de 0 a 100.`);
  return Math.round(n * 10) / 10;
}

export const emptyExpenses = () => ({ fixed: Object.fromEntries(FIXED.map(([k]) => [k, 0])), salaries: {}, pct: {}, extras: [] });

// Valida lo que manda el navegador. `workers` = barberos reales [{id, name}];
// `defaultPct(id)` = el % que ya tiene el equipo. Solo se guarda lo que importa.
export function cleanExpenses(body, workers, defaultPct) {
  const out = emptyExpenses();
  const f = body?.fixed && typeof body.fixed === "object" ? body.fixed : {};
  for (const [k, label] of FIXED) out.fixed[k] = amount(f[k], label);
  const s = body?.salaries && typeof body.salaries === "object" ? body.salaries : {};
  const p = body?.pct && typeof body.pct === "object" ? body.pct : {};
  for (const w of workers) {
    const sal = amount(s[w.id], "Sueldo de " + w.name);
    if (sal) out.salaries[w.id] = sal;
    if (p[w.id] !== undefined && p[w.id] !== "") {
      const v = percent(p[w.id], "Comisión de " + w.name);
      if (v !== defaultPct(w.id)) out.pct[w.id] = v;
    }
  }
  const extras = Array.isArray(body?.extras) ? body.extras : [];
  if (extras.length > MAX_EXTRAS) throw new RangeError(`Como mucho ${MAX_EXTRAS} conceptos libres.`);
  for (const e of extras) {
    const name = String(e?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name) throw new RangeError("Cada concepto libre necesita un nombre.");
    out.extras.push({ name, amount: amount(e.amount, name) });
  }
  return out;
}

// Cuenta final. `income` = { total, byBarber: { id: facturado } }.
export function netOf(income, exp, workers, defaultPct) {
  const fixed = r2(Object.values(exp.fixed || {}).reduce((a, v) => a + (Number(v) || 0), 0));
  const salaries = r2(workers.reduce((a, w) => a + (Number(exp.salaries?.[w.id]) || 0), 0));
  const extras = r2((exp.extras || []).reduce((a, e) => a + (Number(e.amount) || 0), 0));
  const commissions = workers.map((w) => {
    const pct = exp.pct?.[w.id] ?? defaultPct(w.id);
    return { id: w.id, name: w.name, pct, amount: r2(((income.byBarber?.[w.id] || 0) * pct) / 100) };
  });
  const comm = r2(commissions.reduce((a, c) => a + c.amount, 0));
  const costs = r2(fixed + salaries + extras);
  const net = r2(income.total - costs - comm);
  return { fixed, salaries, extras, costs, commissions, commission: comm, net, margin: income.total > 0 ? Math.round((net / income.total) * 1000) / 10 : null };
}

// Diferencia con el mes anterior: en € y en % (null si no hay base).
export function diff(cur, prev) {
  const d = r2(cur - prev);
  return { diff: d, pct: prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null };
}

export const shiftMonth = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
