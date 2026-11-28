// Clientes dormidos y peticiones de reseña: reglas puras (sin Redis ni correo)
// para usarlas igual en el cron, en el panel del dueño y en las pruebas.
//
// Registro de avisos (clave `avisos:log`, JSON, los últimos LOG_MAX):
//   { id, at: "AAAA-MM-DD HH:MM", type: "dormido"|"resena", email, name, status: "enviado"|"simulado"|"fallido",
//     by: "auto"|<idBarbero>, bookingId? }

export const LOG_MAX = 300;
export const WEEKS = { min: 2, max: 52, def: 6 };
export const REVIEW_GAP = { min: 7, max: 365, def: 180 };

// «N semanas» válidas (entero entre 2 y 52). Lanza RangeError con un texto para el dueño.
export function weeksOf(v) {
  const n = Math.round(Number(String(v ?? "").replace(",", ".")));
  if (!Number.isFinite(n) || n < WEEKS.min || n > WEEKS.max) throw new RangeError(`Pon entre ${WEEKS.min} y ${WEEKS.max} semanas.`);
  return n;
}
export function gapOf(v) {
  const n = Math.round(Number(String(v ?? "").replace(",", ".")));
  if (!Number.isFinite(n) || n < REVIEW_GAP.min || n > REVIEW_GAP.max) throw new RangeError(`Pon entre ${REVIEW_GAP.min} y ${REVIEW_GAP.max} días.`);
  return n;
}
// Normas guardadas antes de existir «semanas»: se pasan de días a semanas.
export const weeksFromDays = (days) => Math.min(WEEKS.max, Math.max(WEEKS.min, Math.round(Number(days) / 7) || WEEKS.def));

const dayNum = (d) => Date.UTC(...String(d).slice(0, 10).split("-").map((n, i) => (i === 1 ? n - 1 : +n)));
export const daysBetween = (a, b) => Math.round((dayNum(b) - dayNum(a)) / 86400000);

// ¿Está dormido? Ha venido alguna vez, lleva N semanas o más sin venir y no tiene cita próxima.
export const isDormant = (c, weeks) => !!(c.visits && c.since != null && c.since >= weeks * 7 && !c.next);

// ¿Toca avisarle? Dormido, con correo, sin haberse dado de baja y sin otro aviso (de cualquier canal) en las últimas N semanas.
export function dormantDue(c, weeks, today) {
  if (!isDormant(c, weeks) || !c.email || c.optout) return false;
  return !c.contacted?.at || daysBetween(c.contacted.at, today) >= weeks * 7;
}

// Lista para el panel: los dormidos, del que más tiempo lleva al que menos.
export function dormantList(clients, weeks, today) {
  return clients
    .filter((c) => isDormant(c, weeks))
    .sort((a, b) => b.since - a.since)
    .map((c) => ({
      email: c.email,
      name: c.name || c.email.split("@")[0],
      last: c.last,
      since: c.since,
      weeks: Math.floor(c.since / 7),
      optout: !!c.optout,
      lastNotice: c.contacted ? { at: c.contacted.at, channel: c.contacted.channel, by: c.contacted.by, simulated: !!c.contacted.simulated } : null,
      due: dormantDue(c, weeks, today),
    }));
}

// Enlace de reserva directa: abre la app con el servicio y el barbero habituales ya puestos.
export function bookLink(host, habit, ok = { service: () => true, provider: () => true }) {
  const base = host ? `https://${host}` : "";
  const s = habit?.service && ok.service(habit.service) ? habit.service : "";
  const p = habit?.provider && ok.provider(habit.provider) ? habit.provider : "";
  return s && p ? `${base}/#reservar/${encodeURIComponent(s)}/${encodeURIComponent(p)}` : `${base}/#reservar`;
}

// ¿Se le pide reseña por esta cita? Cita hecha (y acabada hace una hora o más), sin petición previa
// de ESA cita y sin otra petición al cliente en los últimos `gapDays` días.
export function reviewDue({ booking, askedBooking, lastAsk, gapDays, today }) {
  if (!booking || askedBooking) return false;
  return !lastAsk?.at || daysBetween(lastAsk.at, today) >= gapDays;
}

// Añade una entrada al registro (más reciente primero) y lo recorta.
export const pushLog = (log, entry) => [entry, ...(Array.isArray(log) ? log : [])].slice(0, LOG_MAX);
