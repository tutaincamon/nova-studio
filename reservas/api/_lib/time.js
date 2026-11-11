// Fechas en hora de Canarias, sin pasar por UTC: todo se guarda como texto
// local («2026-11-12» y «10:30»), que es como lo piensa el salón.
import { BUSINESS } from "./config.js";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS.tz,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function nowLocal() {
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  return { date, time, min: toMin(time), stamp: date + " " + time };
}

export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const weekday = (date) => new Date(date + "T12:00:00Z").getUTCDay();

export function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Minutos «absolutos» de una fecha y hora locales, para restar dos momentos.
export const absMin = (date, hhmm) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 60000 + toMin(hhmm);
};

// Momento real (milisegundos UTC) de una fecha y hora de Canarias. Tiene en
// cuenta el cambio de hora: el 29 de marzo a las 10:00 no está a la misma
// distancia en horas que el 28 a las 10:00.
const offsetAt = (ms) => {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000;
};
export function epochOf(date, hhmm) {
  const wall = absMin(date, hhmm) * 60000;
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  return t;
}

export const minutesUntil = (date, hhmm) => Math.round((epochOf(date, hhmm) - Date.now()) / 60000);

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(new Date(s + "T12:00:00Z"));
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s));

export function niceDate(date) {
  const s = new Date(date + "T12:00:00Z").toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
