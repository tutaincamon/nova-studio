// ─────────────────────────────────────────────────────────────────────────────
// Todo lo que es del negocio está aquí: servicios, equipo, horario y textos.
// Cambiar un precio, una duración o el horario de alguien es tocar este archivo
// y volver a desplegar. El resto del código no sabe nada de NOVA.
// ─────────────────────────────────────────────────────────────────────────────

// Horario del salón, por día de la semana (0 = domingo … 6 = sábado).
// Cada día es una lista de tramos [desde, hasta]. Día sin tramos = cerrado.
const SALON = {
  0: [],
  1: [],
  2: [["10:00", "20:00"]],
  3: [["10:00", "20:00"]],
  4: [["10:00", "20:00"]],
  5: [["10:00", "20:00"]],
  6: [["10:00", "15:00"]],
};

export const BUSINESS = {
  name: "NOVA Studio",
  short: "NOVA",
  tagline: "Barbería en Vecindario",
  tz: "Atlantic/Canary",
  street: "Av. del Atlántico, 317",
  city: "35110 Vecindario · Gran Canaria",
  maps: "https://maps.google.com/?q=Av.+del+Atl%C3%A1ntico+317,+35110+Vecindario,+Las+Palmas",
  mapEmbed: "https://maps.google.com/maps?q=Av.+del+Atl%C3%A1ntico+317,+35110+Vecindario,+Las+Palmas&z=16&output=embed",
  whatsapp: "34658356428",
  email: "novastudioworld@gmail.com",
  instagram: "https://www.instagram.com/novastudio.gc/",
  rating: {
    score: "5,0",
    count: 174,
    source: "Booksy",
    url: "https://booksy.com/es-es/9802_nova-studio_barberia_69860_balos",
  },
  hoursText: [
    ["Martes a viernes", "10:00 — 20:00"],
    ["Sábado", "10:00 — 15:00"],
  ],
  closedText: "Domingo y lunes cerrado",
  drink: "Todos los servicios incluyen una bebida (café o agua).",
};

// Reglas de la agenda.
export const RULES = {
  step: 30, // cada cuántos minutos empieza una hora libre para el cliente (10:00, 10:30, 11:00…)
  leadMinutes: 60, // antelación mínima para reservar
  daysAhead: 60, // hasta cuántos días vista se puede reservar
  cancelHours: 24, // hasta cuántas horas antes se cambia o cancela desde la app
  maxActive: 3, // citas futuras a la vez por cliente
};

// Servicios. `consult: true` = no se reserva aquí, se habla por WhatsApp.
// `providers` limita quién lo hace (vacío = todo el equipo).
export const SERVICES = [
  {
    id: "corte",
    name: "Corte de pelo",
    price: 15,
    duration: 30,
    icon: "scissors",
    desc: "Asesoramiento, tijera y degradados con transiciones suaves.",
  },
  {
    id: "corte-barba",
    name: "Corte y barba",
    price: 19,
    duration: 30,
    icon: "beard",
    desc: "Tu corte más el diseño y perfilado de la barba, con limpieza del cuello.",
  },
  {
    id: "privado",
    name: "Corte privado",
    price: 36,
    duration: 60,
    points: 2,
    icon: "star",
    providers: ["airam"],
    desc: "Con Airam, más tiempo de asesoramiento y de detalle.",
  },
  {
    id: "fuera-horario",
    name: "Corte fuera de horario",
    price: 30,
    consult: true,
    icon: "moon",
    desc: "Te buscamos un hueco especial, con suplemento.",
  },
  {
    id: "vip",
    name: "Servicio VIP a domicilio",
    price: null,
    consult: true,
    icon: "crown",
    desc: "Corte exclusivo con traslado incluido: vamos a donde estés.",
  },
];

// Equipo. `image` es una ruta dentro de /assets (o null para la tarjeta con inicial).
// `hours` permite que alguien tenga un horario distinto al del salón.
// `owner: true` = el dueño: ve la caja de todos y las comisiones.
export const PROVIDERS = [
  { id: "airam", name: "Airam Marrero", role: "Barbero · Fundador", image: "/assets/airam.jpg", hours: SALON, owner: true },
  { id: "ehedey", name: "Ehedey", role: "Barbero", image: "/assets/ehedey.jpg", hours: SALON },
  { id: "noa", name: "Noa", role: "Barbero", image: "/assets/noa.jpg", hours: SALON },
];

// Comisión (en %) que el dueño cobra de cada servicio que hacen los demás.
// Solo la ve el dueño: no sale en el catálogo ni en el panel de los barberos.
// PENDIENTE de cerrar con NOVA. Airam lo puede cambiar desde su panel (lo que
// ponga allí manda sobre esto, desde el mes que elija en adelante).
export const COMMISSION = { ehedey: 40, noa: 40 };

// Claves del panel del equipo: una por barbero, en Vercel como
// STAFF_PIN_AIRAM, STAFF_PIN_EHEDEY y STAFF_PIN_NOA. El dueño también entra
// con STAFF_PIN (la clave única de antes). En local, sin variables, es 1234.

// ── Club NOVA ──────────────────────────────────────────────────────────────
// Puntos: cada corte suma (los servicios pueden valer más con `points`), cada
// amigo invitado suma cuando viene a su primer corte, y las medallas dan extra.
// La LIGA sale de los puntos ganados en total (canjear no te baja de liga);
// los premios se pagan con el SALDO (ganados − canjeados).
export const POINTS = { perCut: 1, perFriend: 3 };

// PENDIENTE de cerrar con NOVA: qué regala cada liga.
// Cada liga (menos la última) se parte en tres divisiones: III, II y I.
export const LEAGUES = [
  { id: "bronce", name: "Bronce", min: 0, c1: "#e2a46b", c2: "#8a4f22", perk: "Bienvenida al Club NOVA" },
  { id: "plata", name: "Plata", min: 6, c1: "#eef1f5", c2: "#8b929c", perk: "Bebida premium en cada visita" },
  { id: "oro", name: "Oro", min: 15, c1: "#ffe08a", c2: "#b5801f", perk: "10 % en productos NOVA" },
  { id: "platino", name: "Platino", min: 30, c1: "#c9fff6", c2: "#3f978e", perk: "Lavado gratis con cada corte" },
  { id: "diamante", name: "Diamante", min: 50, c1: "#bfe3ff", c2: "#3a73c2", perk: "Prioridad en huecos fuera de horario" },
  { id: "onix", name: "Ónix", min: 75, c1: "#f3dfb6", c2: "#4a3d2a", perk: "Camiseta de NOVA Supply" },
  { id: "elite", name: "Élite", min: 110, c1: "#e2ceff", c2: "#6c3fc0", perk: "15 % en productos y ropa NOVA" },
  { id: "leyenda", name: "Leyenda", min: 160, c1: "#ffd0dc", c2: "#c23a63", perk: "Un corte privado gratis al año" },
];

// Medallas. `metric` es lo que se cuenta y `goal` cuánto hace falta.
// `bonus` son los puntos extra que da al conseguirla.
export const MEDALS = [
  { id: "cut-1", group: "cortes", code: "CUT-01", icon: "scissors", name: "Primer corte", metric: "cuts", goal: 1, bonus: 1 },
  { id: "cut-5", group: "cortes", code: "CUT-05", icon: "comb", name: "Habitual", metric: "cuts", goal: 5, bonus: 1 },
  { id: "cut-10", group: "cortes", code: "CUT-10", icon: "home", name: "De la casa", metric: "cuts", goal: 10, bonus: 2 },
  { id: "cut-20", group: "cortes", code: "CUT-20", icon: "link", name: "Fiel", metric: "cuts", goal: 20, bonus: 3 },
  { id: "cut-35", group: "cortes", code: "CUT-35", icon: "shieldCheck", name: "Veterano", metric: "cuts", goal: 35, bonus: 4 },
  { id: "cut-50", group: "cortes", code: "CUT-50", icon: "flame", name: "Medio centenar", metric: "cuts", goal: 50, bonus: 5 },
  { id: "cut-75", group: "cortes", code: "CUT-75", icon: "bolt", name: "Inquebrantable", metric: "cuts", goal: 75, bonus: 6 },
  { id: "cut-100", group: "cortes", code: "CUT-100", icon: "crown", name: "Leyenda de la silla", metric: "cuts", goal: 100, bonus: 8 },
  { id: "ref-1", group: "amigos", code: "AMG-01", icon: "userPlus", name: "Primer amigo", metric: "friends", goal: 1, bonus: 1 },
  { id: "ref-3", group: "amigos", code: "AMG-03", icon: "users", name: "Embajador", metric: "friends", goal: 3, bonus: 1 },
  { id: "ref-5", group: "amigos", code: "AMG-05", icon: "megaphone", name: "Líder de la banda", metric: "friends", goal: 5, bonus: 2 },
  { id: "ref-10", group: "amigos", code: "AMG-10", icon: "star", name: "Influencer NOVA", metric: "friends", goal: 10, bonus: 3 },
  { id: "early", group: "especiales", code: "ESP-AM", icon: "sun", name: "Madrugador", metric: "early", goal: 3, bonus: 1, desc: "3 cortes antes de las 11:00" },
  { id: "late", group: "especiales", code: "ESP-PM", icon: "moon", name: "Última hora", metric: "late", goal: 3, bonus: 1, desc: "3 cortes desde las 19:00" },
  { id: "saturday", group: "especiales", code: "ESP-SA", icon: "cal", name: "Sábado NOVA", metric: "saturday", goal: 5, bonus: 1, desc: "5 cortes en sábado" },
  { id: "privado", group: "especiales", code: "ESP-VIP", icon: "gem", name: "Sesión privada", metric: "privado", goal: 1, bonus: 1, desc: "Un corte privado" },
  { id: "perfect", group: "especiales", code: "ESP-OK", icon: "target", name: "Asistencia perfecta", metric: "perfect", goal: 10, bonus: 2, desc: "10 cortes sin faltar nunca" },
  { id: "streak", group: "especiales", code: "ESP-3M", icon: "flame", name: "Racha", metric: "streak", goal: 3, bonus: 1, desc: "3 meses seguidos con corte" },
  { id: "profile", group: "especiales", code: "ESP-ID", icon: "camera", name: "Perfil completo", metric: "profile", goal: 1, bonus: 1, desc: "Foto y teléfono en tu perfil" },
  { id: "year", group: "especiales", code: "ESP-1A", icon: "cake", name: "Aniversario", metric: "year", goal: 1, bonus: 2, desc: "Un año en el Club" },
];
export const MEDAL_GROUPS = [
  { id: "cortes", name: "Por cortes" },
  { id: "amigos", name: "Por amigos" },
  { id: "especiales", name: "Especiales" },
];

// Premios que se canjean con puntos. PENDIENTE de cerrar con NOVA.
export const REWARDS = [
  { id: "bebida", name: "Bebida premium", cost: 3, desc: "Refresco, energética o café especial", icon: "cup" },
  { id: "lavado", name: "Lavado y peinado", cost: 5, desc: "Con tu próximo corte", icon: "drop" },
  { id: "barba", name: "Barba gratis con tu corte", cost: 8, desc: "Te cobramos solo el corte", icon: "beard" },
  { id: "producto", name: "Producto de peinado", cost: 12, desc: "Cera o polvo, a elegir", icon: "jar" },
  { id: "corte", name: "Corte gratis", cost: 15, desc: "Corte de pelo completo", icon: "scissors" },
  { id: "camiseta", name: "Camiseta NOVA Supply", cost: 25, desc: "De la colección que haya en tienda", icon: "shirt" },
  { id: "privado", name: "Corte privado gratis", cost: 30, desc: "Una hora con Airam", icon: "gem" },
];

export function publicCatalog() {
  return {
    business: { ...BUSINESS, week: SALON }, // `week` = horario por día, para el «Abierto ahora»
    rules: { cancelHours: RULES.cancelHours, daysAhead: RULES.daysAhead },
    services: SERVICES,
    providers: PROVIDERS.map(({ hours, ...p }) => p),
    points: POINTS,
    leagues: LEAGUES,
    medals: MEDALS,
    medalGroups: MEDAL_GROUPS,
    rewards: REWARDS,
  };
}
