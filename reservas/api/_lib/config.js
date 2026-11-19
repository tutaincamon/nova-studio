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
  // Titular legal (aviso legal, privacidad, condiciones). Es el mismo que el de NOVA Supply.
  // Dónde está el estudio (para el mapa de la portada).
  geo: { lat: 27.8398143, lng: -15.441367 },
  holder: "Airam Jesús Matas Marrero",
  nif: "54172828P",
  phone: "658 356 428",
  tagline: "Barbería en Vecindario",
  tz: "Atlantic/Canary",
  street: "Av. del Atlántico, 317",
  city: "35110 Vecindario · Gran Canaria",
  maps: "https://maps.google.com/?q=Av.+del+Atl%C3%A1ntico+317,+35110+Vecindario,+Las+Palmas",
  whatsapp: "34658356428",
  email: "novastudioworld@gmail.com",
  instagram: "https://www.instagram.com/novastudio.gc/",
  // Hasta que el dueño elige su ficha de Google en la pestaña Web, la nota sale de Booksy.
  rating: {
    score: "5,0",
    count: 174,
    source: "Booksy",
    url: "https://booksy.com/es-es/9802_nova-studio_barberia_69860_balos",
  },
  // Para el paso desde Booksy: adónde mandar a quien quiere cita antes de la fecha de apertura.
  booksy: "https://booksy.com/es-es/9802_nova-studio_barberia_69860_balos",
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
  { id: "noa", name: "Noah", role: "Barbero", image: "/assets/noa.jpg", hours: SALON },
];

// Comisión (en %) que el dueño cobra de cada servicio que hacen los demás.
// Solo la ve el dueño: no sale en el catálogo ni en el panel de los barberos.
// PENDIENTE de cerrar con NOVA. Airam lo puede cambiar desde su panel (lo que
// ponga allí manda sobre esto, desde el mes que elija en adelante).
export const COMMISSION = { ehedey: 40, noa: 40 };

// Cobros en la caja del local. Los extras se suman al servicio al cobrar
// (el cliente venía a cortarse y se hace también la barba). PENDIENTE de
// cerrar precios con NOVA; el importe final siempre se puede tocar a mano.
export const EXTRAS = [
  { id: "barba", name: "Barba", price: 4 },
  { id: "cejas", name: "Cejas", price: 3 },
  { id: "diseno", name: "Diseño / líneas", price: 3 },
  { id: "lavado", name: "Lavado", price: 3 },
];
export const PAY_METHODS = [
  { id: "efectivo", name: "Efectivo" },
  { id: "tarjeta", name: "Tarjeta" },
  { id: "bizum", name: "Bizum" },
];

// Claves del panel del equipo: una por barbero, en Vercel como
// STAFF_PIN_AIRAM, STAFF_PIN_EHEDEY y STAFF_PIN_NOA. El dueño también entra
// con STAFF_PIN (la clave única de antes). En local, sin variables, es 1234.

// ── Club NOVA ──────────────────────────────────────────────────────────────
// Puntos: cada euro suma `perEuro` puntos, en la silla y en NOVA Supply (la
// ropa la apunta el barbero desde su panel al cobrarla). Cada amigo invitado
// suma cuando viene a su primer corte, al entrar regalamos `welcome` y las
// medallas dan extra. Números grandes a propósito: 150 puntos por un corte se
// sienten como un avance; «1 punto» no.
// La LIGA sale de los puntos ganados en total (canjear no te baja de liga);
// los premios se pagan con el SALDO (ganados − canjeados).
export const POINTS = { perEuro: 10, perFriend: 300, welcome: 100 };

// La tienda de ropa de la casa. Lo que se compra allí también suma puntos.
export const SHOP = {
  name: "NOVA Supply",
  url: "https://novasupply.es",
  label: "novasupply.es",
};

// Ligas: el emblema de la marca es una estrella de cuatro puntas, así que se
// sube de Chispa a Supernova. Cada liga (menos la última) tiene III, II y I.
// `min` en puntos ganados (un corte ≈ 150-190). PENDIENTE de cerrar con NOVA:
// qué regala cada liga y los descuentos en NOVA Supply.
export const LEAGUES = [
  { id: "chispa", name: "Chispa", min: 0, c1: "#ffdcae", c2: "#b8692a", motto: "Aquí empieza todo.", perks: ["Puntos en cada corte y en cada prenda", "Tu código para invitar amigos"] },
  { id: "cometa", name: "Cometa", min: 600, c1: "#dff3ff", c2: "#4c86b8", motto: "Ya se te ve pasar.", perks: ["Bebida premium en cada visita"] },
  { id: "orbita", name: "Órbita", min: 1500, c1: "#e4dcff", c2: "#5e4cb8", motto: "Giras alrededor del estudio.", perks: ["5 % en NOVA Supply", "Te avisamos antes de cada drop"] },
  { id: "estrella", name: "Estrella", min: 3500, c1: "#ffeaa6", c2: "#b5841c", motto: "Brillas con luz propia.", perks: ["10 % en NOVA Supply", "Compras los drops 24 h antes"] },
  { id: "nova", name: "Nova", min: 6500, c1: "#ffd3e0", c2: "#c03d68", motto: "Ya eres de la casa.", perks: ["15 % en NOVA Supply", "Prioridad en huecos fuera de horario"] },
  { id: "supernova", name: "Supernova", min: 10000, c1: "#ffe1ec", c2: "#3a1526", motto: "Lo más alto. Muy pocos llegan.", perks: ["Camiseta Supernova: no se vende, solo se gana", "20 % en NOVA Supply", "Un corte privado al año"] },
];

// Medallas. `metric` es lo que se cuenta y `goal` cuánto hace falta.
// `bonus` son los puntos extra que da al conseguirla. La de la reseña va a 0
// a propósito: Google no deja dar nada a cambio de una reseña.
export const MEDALS = [
  { id: "cut-1", group: "silla", code: "SIL-01", icon: "scissors", name: "Primera silla", metric: "cuts", goal: 1, bonus: 50 },
  { id: "cut-5", group: "silla", code: "SIL-05", icon: "comb", name: "Habitual", metric: "cuts", goal: 5, bonus: 100 },
  { id: "cut-10", group: "silla", code: "SIL-10", icon: "home", name: "De la casa", metric: "cuts", goal: 10, bonus: 200 },
  { id: "cut-20", group: "silla", code: "SIL-20", icon: "link", name: "Fijo", metric: "cuts", goal: 20, bonus: 300 },
  { id: "cut-35", group: "silla", code: "SIL-35", icon: "shieldCheck", name: "Veterano", metric: "cuts", goal: 35, bonus: 400 },
  { id: "cut-50", group: "silla", code: "SIL-50", icon: "bolt", name: "Medio centenar", metric: "cuts", goal: 50, bonus: 500 },
  { id: "cut-100", group: "silla", code: "SIL-100", icon: "crown", name: "Leyenda de la silla", metric: "cuts", goal: 100, bonus: 1000 },
  { id: "streak-3", group: "constancia", code: "RCH-03", icon: "flame", name: "En racha", metric: "streak", goal: 3, bonus: 100, desc: "3 meses seguidos con corte" },
  { id: "streak-6", group: "constancia", code: "RCH-06", icon: "flame", name: "Imparable", metric: "streak", goal: 6, bonus: 250, desc: "6 meses seguidos con corte" },
  { id: "streak-12", group: "constancia", code: "RCH-12", icon: "crown", name: "Año impecable", metric: "streak", goal: 12, bonus: 600, desc: "12 meses seguidos con corte" },
  { id: "fresh", group: "constancia", code: "FRS-05", icon: "clock", name: "Siempre fresco", metric: "fresh", goal: 5, bonus: 150, desc: "5 vueltas en menos de 4 semanas" },
  { id: "perfect", group: "constancia", code: "PAL-10", icon: "target", name: "Palabra cumplida", metric: "perfect", goal: 10, bonus: 200, desc: "10 cortes sin faltar nunca" },
  { id: "shop-1", group: "supply", code: "SUP-01", icon: "bag", name: "Primera prenda", metric: "items", goal: 1, bonus: 100, desc: "Tu primera prenda de NOVA Supply" },
  { id: "look", group: "supply", code: "SUP-LK", icon: "shirt", name: "Look completo", metric: "look", goal: 1, bonus: 150, desc: "Corte y prenda el mismo día" },
  { id: "shop-3", group: "supply", code: "SUP-03", icon: "hanger", name: "Armario de la casa", metric: "items", goal: 3, bonus: 200, desc: "3 prendas de NOVA Supply" },
  { id: "shop-6", group: "supply", code: "SUP-06", icon: "gem", name: "Coleccionista", metric: "items", goal: 6, bonus: 400, desc: "6 prendas de NOVA Supply" },
  { id: "ref-1", group: "amigos", code: "AMG-01", icon: "userPlus", name: "Primer amigo", metric: "friends", goal: 1, bonus: 100 },
  { id: "ref-3", group: "amigos", code: "AMG-03", icon: "users", name: "Embajador", metric: "friends", goal: 3, bonus: 200 },
  { id: "ref-5", group: "amigos", code: "AMG-05", icon: "megaphone", name: "Líder de la banda", metric: "friends", goal: 5, bonus: 300 },
  { id: "ref-10", group: "amigos", code: "AMG-10", icon: "star", name: "Leyenda del barrio", metric: "friends", goal: 10, bonus: 600 },
  { id: "early", group: "especiales", code: "ESP-AM", icon: "sun", name: "Madrugador", metric: "early", goal: 3, bonus: 100, desc: "3 cortes antes de las 11:00" },
  { id: "late", group: "especiales", code: "ESP-PM", icon: "moon", name: "Última hora", metric: "late", goal: 3, bonus: 100, desc: "3 cortes desde las 19:00" },
  { id: "saturday", group: "especiales", code: "ESP-SA", icon: "cal", name: "Sábado de estudio", metric: "saturday", goal: 5, bonus: 100, desc: "5 cortes en sábado" },
  { id: "team", group: "especiales", code: "ESP-EQ", icon: "users", name: "Todo el equipo", metric: "barbers", goal: 3, bonus: 100, desc: "Prueba a los 3 barberos" },
  { id: "privado", group: "especiales", code: "ESP-VIP", icon: "gem", name: "Sesión privada", metric: "privado", goal: 1, bonus: 150, desc: "Un corte privado" },
  { id: "profile", group: "especiales", code: "ESP-ID", icon: "camera", name: "Perfil completo", metric: "profile", goal: 1, bonus: 50, desc: "Foto y teléfono en tu perfil" },
  { id: "review", group: "especiales", code: "ESP-RS", icon: "star", name: "Tu opinión cuenta", metric: "review", goal: 1, bonus: 0, desc: "Por dejarnos tu reseña en Google" },
  { id: "year", group: "especiales", code: "ESP-1A", icon: "cake", name: "Aniversario", metric: "year", goal: 1, bonus: 300, desc: "Un año en el Club" },
];
export const MEDAL_GROUPS = [
  { id: "silla", name: "En la silla" },
  { id: "constancia", name: "Constancia" },
  { id: "supply", name: "NOVA Supply" },
  { id: "amigos", name: "Amigos" },
  { id: "especiales", name: "Especiales" },
];

// Premios que se canjean con puntos (≈ 7 % de vuelta). PENDIENTE de cerrar con NOVA.
export const REWARDS = [
  { id: "bebida", name: "Bebida premium", cost: 300, desc: "Refresco, energética o café especial", icon: "cup" },
  { id: "barba", name: "Barba gratis con tu corte", cost: 600, desc: "Te cobramos solo el corte", icon: "beard" },
  { id: "lavado", name: "Lavado y peinado", cost: 600, desc: "Con tu próximo corte", icon: "drop" },
  { id: "producto", name: "Producto de peinado", cost: 1500, desc: "Cera o polvo, a elegir", icon: "jar" },
  { id: "corte", name: "Corte gratis", cost: 2000, desc: "Corte de pelo completo", icon: "scissors" },
  { id: "supply-20", name: "20 € en NOVA Supply", cost: 2500, desc: "Para cualquier prenda de la tienda", icon: "bag" },
  { id: "privado", name: "Corte privado gratis", cost: 4500, desc: "Una hora con Airam", icon: "gem" },
  { id: "camiseta", name: "Camiseta NOVA Supply", cost: 5500, desc: "La que elijas de la colección en tienda", icon: "shirt" },
];

// ── Formación ──────────────────────────────────────────────────────────────
// Fase 1: aún no hay fechas. La página explica la formación y recoge una lista
// de interesados que solo ve el dueño en su panel. Cuando haya cursos con fecha,
// plazas y precio, se añadirán aquí (fase 2).
export const TRAINING = {
  teacher: "airam",
  status: "Próximamente", // lo que se ve arriba mientras no hay fechas
  levels: [
    { id: "cero", name: "Desde cero", desc: "Nunca has cogido una máquina y quieres empezar bien." },
    { id: "basico", name: "Ya he practicado", desc: "Cortas a amigos o familia y te falta técnica." },
    { id: "pro", name: "Ya trabajo de barbero", desc: "Quieres perfeccionar degradados, tijera y acabado." },
  ],
  formats: [
    { id: "grupo", name: "En grupo reducido" },
    { id: "individual", name: "Individual, uno a uno" },
    { id: "igual", name: "Me da igual" },
  ],
  topics: ["Degradados", "Tijera", "Barba y perfilado", "Diseño y líneas", "Asesoramiento de imagen", "Trabajar de barbero"],
  availability: ["Mañanas entre semana", "Tardes entre semana", "Domingo o lunes", "Sábados"],
};

// Lo que ve cualquiera en /api/catalog. El nombre y el NIF del titular no van
// aquí: el aviso legal los pide a /api/legal. El teléfono y el correo sí,
// porque son el contacto del estudio (WhatsApp, mapa, ficha).
export function publicBusiness() {
  const { nif, holder, ...rest } = BUSINESS;
  return { ...rest, week: SALON };
}

export function publicCatalog() {
  return {
    training: TRAINING,
    business: publicBusiness(), // `week` = horario por día, para el «Abierto ahora»
    rules: { cancelHours: RULES.cancelHours, daysAhead: RULES.daysAhead },
    services: SERVICES,
    providers: PROVIDERS.map(({ hours, ...p }) => p),
    points: POINTS,
    shop: SHOP,
    leagues: LEAGUES,
    medals: MEDALS,
    medalGroups: MEDAL_GROUPS,
    rewards: REWARDS,
    extras: EXTRAS,
    payMethods: PAY_METHODS,
  };
}
