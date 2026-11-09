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

export const minutesUntil = (date, hhmm) => {
  const n = nowLocal();
  return absMin(date, hhmm) - absMin(n.date, n.time);
};

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
