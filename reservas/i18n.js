"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Inglés para quien no habla español (turistas, residentes de fuera…).
//
// Cómo funciona:
// - El idioma sale del móvil (español → español; cualquier otro → inglés), de
//   «?lang=en» en el enlace o del botón ES/EN de la cabecera, que se recuerda.
// - La app sigue pintando en español. Si el idioma es inglés, todo lo que entra
//   en la pantalla pasa por EN (frases exactas) y PATTERNS (frases con datos).
// - Las frases con nombres, precios o fechas se escriben en app.js con
//   L("español", "English").
// - El panel del equipo (#equipo) se queda siempre en español.
//
// Para traducir un texto nuevo: añádelo a EN tal cual se ve en español.
// ─────────────────────────────────────────────────────────────────────────────
const LANG_KEY = "nova_lang";
let LANG = (() => {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "en" || q === "es") {
      localStorage.setItem(LANG_KEY, q);
      return q;
    }
    const s = localStorage.getItem(LANG_KEY);
    if (s === "en" || s === "es") return s;
  } catch {}
  const l = (navigator.languages && navigator.languages[0]) || navigator.language || "es";
  return /^(es|ca|gl|eu)\b/i.test(l) ? "es" : "en";
})();
const L = (es, en) => (LANG === "en" ? en : es);
// Lo mismo, para las pantallas donde «L» ya es la liga del socio.
const tl = L;
const LOC = () => (LANG === "en" ? "en-GB" : "es-ES");
const DAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const EN = {
  // ── Red y errores ──
  "Estás sin conexión. Revisa los datos o el wifi y prueba otra vez.": "You're offline. Check your data or wifi and try again.",
  "La conexión va lenta y no ha llegado respuesta. Prueba otra vez.": "The connection is slow and no reply came back. Please try again.",
  "Algo ha fallado. Prueba otra vez.": "Something went wrong. Please try again.",
  "Vaya…": "Oops…",
  "Volver al inicio": "Back to home",
  "Demasiados datos.": "Too much data.",
  "Petición mal formada.": "Bad request.",
  "Petición incorrecta.": "Bad request.",
  "Esa hora se acaba de ocupar. Elige otra, por favor.": "That time was just taken. Please choose another.",
  "Ese servicio no se reserva por aquí.": "This service can't be booked online.",
  "Ese barbero no hace este servicio.": "That barber doesn't offer this service.",
  "Elige día y hora.": "Choose a day and time.",
  "Falta tu nombre.": "Please enter your name.",
  "Revisa tu correo.": "Please check your email address.",
  "Revisa tu teléfono.": "Please check your phone number.",
  "Tienes que aceptar las condiciones.": "You need to accept the terms.",
  "Añade una tarjeta para garantizar la cita.": "Add a card to guarantee your booking.",
  "Ya estamos guardando otra reserva tuya. Un momento…": "We're already saving another booking of yours. One moment…",
  "Esa hora ya no está libre. Mira estas otras:": "That time is no longer free. Here are some others:",
  "Esa hora ya no está libre. Elige otra, por favor.": "That time is no longer free. Please choose another.",
  "Ese código no existe.": "That code doesn't exist.",
  "Ese código no existe. Revísalo.": "That code doesn't exist. Please check it.",
  "Ese es tu propio código.": "That's your own code.",
  "Entra para ver el ranking.": "Log in to see the ranking.",
  "Entra con tu correo para reservar. Te mandamos un código.": "Log in with your email to book. We'll send you a code.",
  "Por ahora solo se puede entrar con el correo.": "For now you can only log in with your email.",
  "Ya tienes 200 amigos en el ranking, que es el máximo.": "You already have 200 friends on the ranking, which is the maximum.",
  "No encontramos a ese amigo.": "We couldn't find that friend.",
  "Ranking": "Ranking",
  "Tu reserva se está guardando…": "Your booking is being saved…",
  "Ahora mismo no se apuntan avisos.": "Alerts aren't available right now.",
  "Elige servicio y barbero.": "Choose a service and a barber.",
  "Elige uno de los próximos días.": "Choose one of the coming days.",
  "Pon tu correo para poder avisarte.": "Enter your email so we can let you know.",
  "No encontramos esa cita.": "We couldn't find that booking.",
  "Entra para ver tus citas.": "Log in to see your bookings.",
  "La hora de la cita ya ha pasado.": "The time of this booking has already passed.",
  "Esta cita ya no está activa.": "This booking is no longer active.",
  "Entra para ver tu Club.": "Log in to see your Club.",
  "Entra en tu cuenta.": "Log in to your account.",
  "Esa foto no vale. Prueba con otra.": "That photo doesn't work. Try another one.",
  "Ese premio no existe.": "That reward doesn't exist.",
  "Un momento…": "One moment…",
  "Ahora mismo no hace falta tarjeta.": "No card is needed right now.",
  "Ya tienes cuenta con este correo. Entra con él y sigue con tu reserva.": "You already have an account with this email. Log in with it to continue your booking.",
  "Tienes citas pendientes garantizadas con esta tarjeta. Cámbiala por otra o cancela esas citas antes de quitarla.":
    "You have upcoming bookings guaranteed with this card. Replace it or cancel those bookings before removing it.",
  "Tienes un pago pendiente. Págalo antes de quitar la tarjeta.": "You have a pending payment. Pay it before removing the card.",
  "No hay nada pendiente de pago.": "There's nothing left to pay.",
  "Ese pago ya no existe. Escríbenos por WhatsApp.": "That payment no longer exists. Message us on WhatsApp.",
  "No hemos podido enviar el correo. Prueba otra vez en un rato.": "We couldn't send the email. Please try again in a while.",
  "Ahora mismo no podemos enviar el código por correo. Escríbenos por WhatsApp y te ayudamos.": "We can't email the code right now. Message us on WhatsApp and we'll help you.",
  "El código ha caducado. Pide otro.": "The code has expired. Ask for a new one.",
  "Demasiados intentos. Pide otro código.": "Too many attempts. Ask for a new code.",
  "Ese código no es correcto.": "That code isn't right.",
  "Tienes que aceptar que te contactemos.": "You need to agree to be contacted.",
  "Dinos tu nivel.": "Tell us your level.",
  "No se ha podido cargar el pago seguro. Revisa tu conexión.": "Secure payment couldn't load. Check your connection.",
  "El pago aún no se ha completado. Prueba otra vez.": "The payment hasn't gone through yet. Please try again.",
  "No se ha podido leer esa foto.": "That photo couldn't be read.",

  // ── Cabecera, navegación y piezas comunes ──
  "Entrar": "Log in",
  "Mi cuenta": "My account",
  "Reservar": "Book",
  "Inicio": "Home",
  "Mis citas": "My bookings",
  "Puntos y premios": "Points & rewards",
  "Perfil": "Profile",
  "Agenda": "Schedule",
  "Tu panel": "Your panel",
  "Cerrar": "Close",
  "Volver": "Back",
  "Información legal": "Legal information",
  "Privacidad": "Privacy",
  "Condiciones": "Terms",
  "Aviso legal": "Legal notice",
  "Ver en Google Maps ↗": "View on Google Maps ↗",
  "Equipo": "Team",
  "Barbería · Vecindario": "Barbershop · Vecindario",
  "NOVA Studio, inicio": "NOVA Studio, home",
  "Navegación principal": "Main navigation",
  "Cargando NOVA…": "Loading NOVA…",
  "NOVA Studio · Barbería en Vecindario": "NOVA Studio · Barbershop in Vecindario",

  // ── Portada ──
  "Herramientas de barbería de NOVA Studio con el logo": "NOVA Studio barber tools with the logo",
  "te esperan": "are waiting for you",
  "Próximo hueco libre": "Next free slot",
  "Buscando…": "Searching…",
  "Elige tu día": "Pick your day",
  "Mira toda la agenda": "See the whole calendar",
  "Reserva en un minuto": "Book in a minute",
  "¿Qué te hacemos?": "What can we do for you?",
  "Elige tu servicio. Después, tu barbero y tu hora.": "Choose your service. Then your barber and your time.",
  "Por WhatsApp": "Via WhatsApp",
  "desde": "from",
  "Fuera de carta": "Off the menu",
  "Se cuadra por WhatsApp": "Arranged on WhatsApp",
  "Reserva activa": "Upcoming booking",
  "Ver mi cita ›": "See my booking ›",
  "El equipo": "The team",
  "Manos que": "Hands that",
  "marcan estilo.": "set the style.",
  "Lo que dicen de nosotros": "What people say",
  "El corte se nota.": "You can see the cut.",
  "La experiencia, también.": "And feel the experience.",
  "Leer reseñas ↗": "Read reviews ↗",
  "Ver trabajos en Instagram ↗": "See our work on Instagram ↗",
  "Tu barbería en Vecindario": "Your barbershop in Vecindario",
  "Nos vemos en": "See you at",
  "el estudio.": "the studio.",
  "Cargando mapa…": "Loading map…",
  "Cómo llegar": "Directions",
  "Barbería en Gran Canaria": "Barbershop in Gran Canaria",
  "Imagen": "Image",
  "y estilo.": "and style.",
  "Barbero trabajando con un cliente": "Barber working with a client",
  "Detalle del acabado de un corte": "Close-up of a finished haircut",
  "Herramientas de barbería": "Barber tools",
  "Espejo dorado del estudio": "The studio's gold mirror",
  "En cabina": "In the chair",
  "El acabado": "The finish",
  "El oficio": "The craft",
  "La casa": "The house",
  "Servicios": "Services",
  "Corte de pelo": "Haircut",
  "Degradado": "Fade",
  "Corte y barba": "Haircut & beard",
  "Corte privado": "Private haircut",
  "Fuera de horario": "After hours",
  "VIP a domicilio": "VIP home visit",
  "La ropa": "The house",
  "de la casa.": "clothing line.",
  "Camiseta · Rosa": "T-shirt · Pink",
  "Cómo suma en el Club": "How it adds up in the Club",
  "Barbería · Vecindario, Gran Canaria": "Barbershop · Vecindario, Gran Canaria",
  "Dirección": "Address",
  "Horario": "Opening hours",
  "Contacto": "Contact",
  "Productos": "Products",
  "Formación": "Training",

  // ── Datos del negocio (vienen del servidor) ──
  "Martes a viernes": "Tuesday to Friday",
  "Sábado": "Saturday",
  "Domingo y lunes cerrado": "Closed Sunday and Monday",
  "Todos los servicios incluyen una bebida (café o agua).": "Every service includes a drink (coffee or water).",
  "Barbería en Vecindario": "Barbershop in Vecindario",
  "Barbero": "Barber",
  "Barbera": "Barber",
  "Barbero · Fundador": "Barber · Founder",
  "Fundador": "Founder",
  "Fundadora": "Founder",
  "Asesoramiento, tijera y degradados con transiciones suaves.": "Consultation, scissors and fades with smooth transitions.",
  "Tu corte más el diseño y perfilado de la barba, con limpieza del cuello.": "Your haircut plus beard design and shaping, with a neck clean-up.",
  "Con Airam, más tiempo de asesoramiento y de detalle.": "With Airam, with more time for consultation and detail.",
  "Corte fuera de horario": "After-hours haircut",
  "Te buscamos un hueco especial, con suplemento.": "We'll find you a special slot, with a surcharge.",
  "Servicio VIP a domicilio": "VIP home service",
  "Corte exclusivo con traslado incluido: vamos a donde estés.": "Exclusive haircut with travel included: we come to you.",

  // ── Elegir barbero, consulta y calendario ──
  "Cambiar servicio": "Change service",
  "Elige a tu barbero": "Choose your barber",
  "Sin preferencia": "No preference",
  "La primera hora libre de cualquiera del equipo": "The first free time with anyone on the team",
  "El primero que esté libre": "Whoever is free first",
  "Precio a consultar": "Price on request",
  "Escríbenos por WhatsApp": "Message us on WhatsApp",
  "Cuéntanos qué necesitas y qué día te vendría bien.": "Tell us what you need and which day suits you.",
  "Lo cuadramos contigo": "We arrange it with you",
  "Te decimos precio final y hora.": "We'll tell you the final price and time.",
  "Te la apuntamos": "We book it for you",
  "La cita aparece en la agenda del salón.": "The booking goes into the salon's calendar.",
  "Escribir por WhatsApp": "Message on WhatsApp",
  "Cambiar barbero": "Change barber",
  "Volver a la cita": "Back to the booking",
  "Elige la nueva hora": "Choose the new time",
  "Día y hora": "Day and time",
  "Elige una hora": "Pick a time",
  "Muchas horas": "Plenty of times",
  "Algunas horas": "Some times",
  "Pocas horas": "Few times",
  "Te mandamos un código de 6 cifras a tu correo. Si es tu primera vez, la cuenta se crea al entrar.": "We'll send a 6-digit code to your email. The first time, your account is created as you log in.",
  "Mes anterior": "Previous month",
  "Mes siguiente": "Next month",
  "Este día está completo": "This day is fully booked",
  "Si alguien cancela, te escribimos al momento para que elijas hora antes que nadie.": "If someone cancels, we'll email you straight away so you can pick a time before anyone else.",
  "Tu correo": "Your email",
  "Avísame si se libera": "Let me know if a slot opens",
  "No quedan horas libres este mes. Prueba el mes siguiente.": "No free times left this month. Try next month.",
  "Nueva hora": "New time",
  "Tu cita": "Your booking",
  "Cambiar": "Change",
  "Continuar": "Continue",
  "Cita cambiada.": "Booking changed.",
  "Se acaba de ocupar": "Just taken",
  "Otra persona ha cogido esa hora": "Someone else has just taken that time",
  "Estas siguen libres. Toca una y queda reservada.": "These are still free. Tap one and it's booked.",
  "con quien esté libre": "with whoever is free",
  "Ver el calendario": "See the calendar",

  // ── Tus datos y reserva ──
  "Cambiar hora": "Change time",
  "Confirma tu cita": "Confirm your booking",
  "Un toque y listo.": "One tap and you're done.",
  "Tus datos": "Your details",
  "Solo lo necesario para guardar tu cita.": "Just what we need to save your booking.",
  "Nombre": "Name",
  "Correo": "Email",
  "Teléfono": "Phone",
  "(opcional, por si hay algún cambio)": "(optional, in case anything changes)",
  "Prefijo del país": "Country code",
  "Eres del Club NOVA": "You're in the NOVA Club",
  "CLUB": "CLUB",
  "Entras en el Club al reservar": "You join the Club when you book",
  "Con estos mismos datos. Sin contraseñas.": "With these same details. No passwords.",
  "¿Te ha invitado un amigo?": "Did a friend invite you?",
  "Pon su código": "Enter their code",
  "Código de amigo": "Friend code",
  "Ej.: CARLOS482": "E.g. CARLOS482",
  "Añadir tarjeta y reservar": "Add card and book",
  "Confirmar reserva": "Confirm booking",
  "Reservar y pagar en el local": "Book and pay at the shop",
  "Repetir esta cita": "Repeat this booking",
  "No, solo esta": "No, just this one",
  "Cada semana": "Every week",
  "Cada 2 semanas": "Every 2 weeks",
  "Cada 3 semanas": "Every 3 weeks",
  "Cada 4 semanas": "Every 4 weeks",
  "Cuántas veces": "How many times",
  "Mismo día de la semana, misma hora y mismo barbero. Si algún día ya está ocupado, te lo decimos.":
    "Same weekday, same time and same barber. If any day is already taken, we'll tell you.",
  "Ahora no se cobra nada. El servicio se paga en el local, en efectivo o con tarjeta.": "Nothing is charged now. You pay for the service at the shop, in cash or by card.",
  "En el local puedes pagar en efectivo o con tarjeta.": "At the shop you can pay in cash or by card.",
  "Comprobando…": "Checking…",
  "Ese código de amigo no existe. Revísalo o bórralo.": "That friend code doesn't exist. Check it or delete it.",
  "Sin tarjeta en garantía no podemos guardar la cita.": "We can't save the booking without a guarantee card.",
  "La conexión va lenta. Seguimos intentándolo…": "The connection is slow. Still trying…",

  // ── Cita reservada ──
  "¡Cita reservada!": "Booking confirmed!",
  "Te esperamos en": "See you at",
  "✓ Confirmada": "✓ Confirmed",
  "Tu barbero": "Your barber",
  "Día": "Day",
  "Hora": "Time",
  "Servicio": "Service",
  "Precio": "Price",
  "Añadir a mi calendario": "Add to my calendar",
  "¿Usas Google Calendar?": "Using Google Calendar?",
  "¿Usas el calendario del iPhone u Outlook?": "Using iPhone Calendar or Outlook?",
  "Ya tenías cuenta con este correo. Entra con tu correo para ver y cambiar todas tus citas.": "You already had an account with this email. Log in with it to see and change all your bookings.",
  "Entrar a mis citas": "Go to my bookings",
  "Ver, cambiar o cancelar mi cita": "See, change or cancel my booking",
  "Completa tu perfil": "Complete your profile",
  "Déjanos tu teléfono por si hay algún cambio con tu cita. Solo te lo pedimos esta vez.": "Leave us your phone number in case anything changes with your booking. We'll only ask this once.",
  "Guardar": "Save",
  "Teléfono guardado. Gracias.": "Phone saved. Thank you.",

  // ── Mis citas y una cita ──
  "No tienes citas pendientes": "You have no upcoming bookings",
  "Reserva tu próximo corte en un minuto ›": "Book your next haircut in a minute ›",
  "Historial": "History",
  "Cancelada": "Cancelled",
  "Cancelada tarde": "Cancelled late",
  "No vino": "No-show",
  "✓ Realizada": "✓ Done",
  "Realizada": "Done",
  "Confirmada": "Confirmed",
  "Estado": "Status",
  "Referencia": "Reference",
  "Dónde": "Where",
  "Garantía": "Guarantee",
  "Cambiar día u hora": "Change day or time",
  "Cancelar cita": "Cancel booking",
  "Reservar otra igual": "Book the same again",
  "¿Cancelar la cita?": "Cancel the booking?",
  "Cancelar también las siguientes citas de esta serie": "Also cancel the following bookings in this series",
  "No": "No",
  "Sí, cancelar": "Yes, cancel",
  "Cita cancelada. Tu barbero revisará si se cobra.": "Booking cancelled. Your barber will review whether there's a charge.",
  "Cita cancelada.": "Booking cancelled.",
  "Tu barbero ha decidido no cobrarte nada por esta cita.": "Your barber has decided not to charge you for this booking.",

  // ── Entrar ──
  "Entra en tu cuenta": "Log in to your account",
  "Sin contraseña: pon el correo con el que reservaste y te enviamos un código de 6 cifras.": "No password: enter the email you booked with and we'll send you a 6-digit code.",
  "Sin contraseña: pon el correo con el que reservaste.": "No password: enter the email you booked with.",
  "Ahora mismo el acceso por correo no está activo. Si necesitas cambiar una cita, escríbenos por WhatsApp.": "Email login isn't active right now. If you need to change a booking, message us on WhatsApp.",
  "Correo electrónico": "Email",
  "Recibir código": "Get a code",
  "¿Aún no tienes cuenta? Se crea sola con tu primera reserva.": "No account yet? It's created automatically with your first booking.",
  "Reservar cita": "Book an appointment",
  "¿Trabajas en el estudio?": "Do you work at the studio?",
  "Entra en tu panel": "Go to your panel",
  "Modo prueba: el código sale en la consola del servidor.": "Test mode: the code is printed in the server console.",
  "Mira tu correo": "Check your email",
  "Te hemos enviado un código de 6 cifras. Caduca en diez minutos.": "We've sent you a 6-digit code. It expires in ten minutes.",
  "Código": "Code",
  "Usar otro correo": "Use another email",

  // ── Perfil ──
  "Cambiar foto": "Change photo",
  "Tu foto": "Your photo",
  "Tu perfil": "Your profile",
  "punto": "point",
  "puntos": "points",
  "ganados": "earned",
  "Corte": "Haircut",
  "Cortes": "Haircuts",
  "Medallas": "Medals",
  "Amigos": "Friends",
  "Tus citas": "Your bookings",
  "Toca una cita para cambiarla de día u hora o cancelarla.": "Tap a booking to change its day or time, or to cancel it.",
  "Ver historial": "See history",
  "Tu tarjeta": "Your card",
  "TARJETA": "CARD",
  "Quitar": "Remove",
  "Aún no tienes tarjeta guardada. Te la pediremos al reservar, para garantizar la cita. No se cobra nada salvo que faltes sin avisar.":
    "You don't have a saved card yet. We'll ask for one when you book, to guarantee the appointment. Nothing is charged unless you miss it without notice.",
  "Añadir tarjeta": "Add card",
  "Cerrar sesión": "Log out",
  "Foto actualizada.": "Photo updated.",
  "¿Seguro? Pulsa otra vez": "Sure? Tap again",
  "Tarjeta quitada.": "Card removed.",
  "Guardado.": "Saved.",

  // ── Club ──
  "EL CLUB": "THE CLUB",
  "TUS PUNTOS": "YOUR POINTS",
  "Reservar mi primer corte": "Book my first haircut",
  "Ya soy del Club · Entrar": "I'm already in the Club · Log in",
  "Las ligas": "The leagues",
  "Premios del Club": "Club rewards",
  "Para recoger en el local": "To collect at the shop",
  "Enséñale este código a tu barbero": "Show this code to your barber",
  "Movimientos": "Activity",
  "Ver mi perfil y medallas": "See my profile and medals",
  "Canjear premio": "Redeem reward",
  "Ahora no": "Not now",
  "Canjear": "Redeem",
  "¡Canjeado!": "Redeemed!",
  "Tu código": "Your code",
  "Enséñaselo a tu barbero en tu próxima visita.": "Show it to your barber on your next visit.",
  "Hecho": "Done",
  "Tu liga": "Your league",
  "✓ Superada": "✓ Passed",
  "✓ Conseguida": "✓ Earned",
  "Conseguida": "Earned",
  "Lo próximo": "Up next",
  "Nueva liga": "New league",
  "Subes de división": "You moved up a division",
  "Medalla nueva": "New medal",
  "Seguir": "Continue",
  "La ropa de": "The house",
  "la casa.": "clothing line.",
  "INVITA Y SUMA": "INVITE AND EARN",
  "Pásale tu código para que lo ponga al reservar. Los puntos son tuyos en cuanto venga a su primera cita.": "Give them your code to enter when booking. The points are yours as soon as they come to their first appointment.",
  "Copiar código": "Copy code",
  "Compartir mi código": "Share my code",
  "Código copiado.": "Code copied.",
  "Bienvenida al Club": "Welcome to the Club",
  "Bonus de medallas": "Medal bonus",
  // Ligas (los nombres se quedan: son de la marca)
  "Aquí empieza todo.": "This is where it all begins.",
  "Puntos en cada corte y en cada prenda": "Points on every haircut and every garment",
  "Tu código para invitar amigos": "Your code to invite friends",
  "Ya se te ve pasar.": "People are starting to notice you.",
  "Bebida premium en cada visita": "Premium drink on every visit",
  "Giras alrededor del estudio.": "You orbit around the studio.",
  "5 % en NOVA Supply": "5 % off NOVA Supply",
  "Te avisamos antes de cada drop": "We tell you before every drop",
  "Brillas con luz propia.": "You shine with your own light.",
  "10 % en NOVA Supply": "10 % off NOVA Supply",
  "Compras los drops 24 h antes": "You buy drops 24 h early",
  "Ya eres de la casa.": "You're one of the family now.",
  "15 % en NOVA Supply": "15 % off NOVA Supply",
  "Prioridad en huecos fuera de horario": "Priority for after-hours slots",
  "Lo más alto. Muy pocos llegan.": "The very top. Very few make it.",
  "Camiseta Supernova: no se vende, solo se gana": "Supernova T-shirt: never sold, only earned",
  "20 % en NOVA Supply": "20 % off NOVA Supply",
  "Un corte privado al año": "One private haircut a year",
  // Medallas
  "En la silla": "In the chair",
  "Constancia": "Consistency",
  "Especiales": "Specials",
  "Primera silla": "First chair",
  "Habitual": "Regular",
  "De la casa": "One of the family",
  "Fijo": "Fixture",
  "Veterano": "Veteran",
  "Medio centenar": "Half a hundred",
  "Leyenda de la silla": "Chair legend",
  "En racha": "On a streak",
  "Imparable": "Unstoppable",
  "Año impecable": "Flawless year",
  "Siempre fresco": "Always fresh",
  "Palabra cumplida": "Word kept",
  "Primera prenda": "First garment",
  "Look completo": "Full look",
  "Armario de la casa": "House wardrobe",
  "Coleccionista": "Collector",
  "Primer amigo": "First friend",
  "Embajador": "Ambassador",
  "Líder de la banda": "Leader of the pack",
  "Leyenda del barrio": "Neighbourhood legend",
  "Madrugador": "Early bird",
  "Última hora": "Last call",
  "Sábado de estudio": "Studio Saturday",
  "Todo el equipo": "The whole team",
  "Sesión privada": "Private session",
  "Perfil completo": "Complete profile",
  "Aniversario": "Anniversary",
  "3 meses seguidos con corte": "3 months in a row with a haircut",
  "6 meses seguidos con corte": "6 months in a row with a haircut",
  "12 meses seguidos con corte": "12 months in a row with a haircut",
  "5 vueltas en menos de 4 semanas": "5 returns within 4 weeks",
  "10 cortes sin faltar nunca": "10 haircuts without ever missing one",
  "Tu primera prenda de NOVA Supply": "Your first NOVA Supply garment",
  "Corte y prenda el mismo día": "Haircut and garment on the same day",
  "3 prendas de NOVA Supply": "3 NOVA Supply garments",
  "6 prendas de NOVA Supply": "6 NOVA Supply garments",
  "3 cortes antes de las 11:00": "3 haircuts before 11:00",
  "3 cortes desde las 19:00": "3 haircuts from 19:00",
  "5 cortes en sábado": "5 haircuts on a Saturday",
  "Prueba a los 3 barberos": "Try all 3 barbers",
  "Un corte privado": "A private haircut",
  "Foto y teléfono en tu perfil": "Photo and phone on your profile",
  "Un año en el Club": "One year in the Club",
  // Premios
  "Bebida premium": "Premium drink",
  "Refresco, energética o café especial": "Soft drink, energy drink or specialty coffee",
  "Barba gratis con tu corte": "Free beard with your haircut",
  "Te cobramos solo el corte": "We only charge for the haircut",
  "Lavado y peinado": "Wash and style",
  "Con tu próximo corte": "With your next haircut",
  "Producto de peinado": "Styling product",
  "Cera o polvo, a elegir": "Wax or powder, your choice",
  "Corte gratis": "Free haircut",
  "Corte de pelo completo": "Full haircut",
  "20 € en NOVA Supply": "€20 at NOVA Supply",
  "Para cualquier prenda de la tienda": "For any garment in the shop",
  "Corte privado gratis": "Free private haircut",
  "Una hora con Airam": "An hour with Airam",
  "Camiseta NOVA Supply": "NOVA Supply T-shirt",
  "La que elijas de la colección en tienda": "Any one you choose from the in-store collection",

  // ── Productos ──
  "Agotado": "Sold out",
  "Se compra en el estudio. Pídeselo a tu barbero en tu próxima cita.": "Buy it at the studio. Ask your barber at your next appointment.",
  "Preguntar por WhatsApp": "Ask on WhatsApp",
  "En el estudio": "At the studio",
  "para casa.": "for home.",
  "Lo que usamos en la silla, para que lo tengas en casa. Se compran en el estudio.": "What we use in the chair, so you can have it at home. Sold at the studio.",
  "Pronto subiremos los productos del estudio.": "We'll be adding the studio's products soon.",

  // ── Tu cita de siempre ──
  "Te toca": "You're due",
  "Tu cita de siempre": "Your usual booking",
  "Lo calculamos con tus últimas citas.": "Worked out from your recent bookings.",

  // ── Formación ──
  "¿Quieres aprender": "Want to learn",
  "a cortar?": "to cut hair?",
  "Apúntate a la lista": "Join the list",
  "Lista de interesados": "Interest list",
  "Apúntate": "Sign up",
  "sin compromiso.": "with no commitment.",
  "(te escribiremos por WhatsApp)": "(we'll message you on WhatsApp)",
  "(opcional)": "(optional)",
  "(opcional, para ver tus cortes)": "(optional, so we can see your cuts)",
  "@tuusuario": "@yourusername",
  "¿Cuál es tu nivel?": "What's your level?",
  "¿Cómo prefieres las clases?": "How would you like the classes?",
  "¿Qué te interesa?": "What are you interested in?",
  "Marca todo lo que quieras": "Tick as many as you like",
  "¿Cuándo te viene bien?": "When suits you?",
  "¿Algo más?": "Anything else?",
  "Tu experiencia, qué te gustaría conseguir…": "Your experience, what you'd like to achieve…",
  "Acepto que me contactéis por WhatsApp o correo sobre la formación.": "I agree to be contacted by WhatsApp or email about the training.",
  "Apuntarme a la lista": "Put me on the list",
  "Gratis y sin compromiso. Puedes pedir que te borremos cuando quieras.": "Free and with no commitment. You can ask us to remove you at any time.",
  "Te escribiremos por WhatsApp en cuanto haya fechas, antes de anunciarlo a nadie más.": "We'll message you on WhatsApp as soon as there are dates, before announcing it to anyone else.",
  "Cambiar mis respuestas": "Change my answers",
  "Clases prácticas de barbería en el estudio de Vecindario, para empezar desde cero o para afinar tu técnica.": "Hands-on barbering classes at the Vecindario studio, to start from scratch or to sharpen your technique.",
  "Quiero apuntarme": "I want to sign up",
  "Qué vas a aprender": "What you'll learn",
  "Del primer degradado": "From your first fade",
  "al acabado.": "to the finish.",
  "Para quién": "Who it's for",
  "Vengas de donde": "Wherever you're",
  "vengas.": "coming from.",
  "Cómo funciona": "How it works",
  "Primero,": "First,",
  "la lista.": "the list.",
  "Te apuntas.": "You sign up.",
  "Es gratis y no te compromete a nada.": "It's free and doesn't commit you to anything.",
  "Te escribimos los primeros": "We message you first",
  ", antes de anunciarlo, con fechas, plazas y precio.": ", before announcing it, with dates, places and price.",
  "¿Dudas?": "Questions?",
  "Próximamente": "Coming soon",
  "Desde cero": "From scratch",
  "Nunca has cogido una máquina y quieres empezar bien.": "You've never held clippers and want to start the right way.",
  "Ya he practicado": "I've practised",
  "Cortas a amigos o familia y te falta técnica.": "You cut friends' or family's hair and need more technique.",
  "Ya trabajo de barbero": "I already work as a barber",
  "Quieres perfeccionar degradados, tijera y acabado.": "You want to perfect fades, scissor work and finishing.",
  "En grupo reducido": "In a small group",
  "Individual, uno a uno": "Individual, one to one",
  "Me da igual": "Either is fine",
  "Degradados": "Fades",
  "Tijera": "Scissor work",
  "Barba y perfilado": "Beard and line-up",
  "Diseño y líneas": "Designs and lines",
  "Asesoramiento de imagen": "Image consulting",
  "Trabajar de barbero": "Working as a barber",
  "Mañanas entre semana": "Weekday mornings",
  "Tardes entre semana": "Weekday afternoons",
  "Domingo o lunes": "Sunday or Monday",
  "Sábados": "Saturdays",

  // ── Tarjeta en garantía ──
  "Tarjeta en garantía": "Guarantee card",
  "Modo prueba · no es un cobro real": "Test mode · not a real charge",
  "Número de tarjeta": "Card number",
  "Caducidad": "Expiry",
  "Cargando pago seguro…": "Loading secure payment…",
  "Pago seguro con Stripe. NOVA nunca ve el número de tu tarjeta.": "Secure payment with Stripe. NOVA never sees your card number.",
  "Cambiar tarjeta": "Change card",
  "Añade tu tarjeta": "Add your card",
  "No se cobra nada ahora. Queda guardada en tu perfil para tus próximas citas y puedes quitarla cuando quieras.": "Nothing is charged now. It stays on your profile for your next bookings and you can remove it whenever you like.",
  "Guardar tarjeta": "Save card",
  "Ya estaba pagado. Gracias.": "It was already paid. Thank you.",
  "Pago pendiente": "Pending payment",
  "Tu banco pide que confirmes el pago.": "Your bank is asking you to confirm the payment.",
  "Tu tarjeta no se pudo cobrar. Prueba otra vez o usa otra tarjeta.": "Your card couldn't be charged. Try again or use another card.",
  "Al pulsar el botón, tu banco te pedirá la confirmación.": "When you press the button, your bank will ask you to confirm.",
  "Pago completado. Gracias.": "Payment complete. Thank you.",
};

// Frases que llegan del servidor con datos dentro.
const PATTERNS = [
  [/^Ya tienes (\d+) citas pendientes\. Cuando pase alguna podrás reservar otra\.$/, (m) => `You already have ${m[1]} upcoming bookings. Once one has passed you can book another.`],
  [/^Quedan menos de (\d+) horas: para cambiarla, escríbenos por WhatsApp\.$/, (m) => `Less than ${m[1]} hours to go: to change it, message us on WhatsApp.`],
  [/^Te faltan (\d+) puntos\.$/, (m) => `You need ${m[1]} more points.`],
  [/^NOVA Supply · (\d+) prendas?$/, (m) => `NOVA Supply · ${m[1]} ${m[1] === "1" ? "item" : "items"}`],
  [/^Amigo: (.+)$/, (m) => `Friend: ${m[1]}`],
  [/^Canje: (.+)$/, (m) => `Redeemed: ${tx(m[1])}`],
];

// Traduce un texto exacto (sin espacios alrededor). En español lo deja igual.
function tx(s) {
  if (LANG !== "en" || s == null) return s;
  const k = String(s);
  if (Object.prototype.hasOwnProperty.call(EN, k)) return EN[k];
  for (const [re, fn] of PATTERNS) {
    const m = k.match(re);
    if (m) return fn(m);
  }
  return k;
}
function trText(s) {
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m[2]) return s;
  const t = tx(m[2]);
  return t === m[2] ? s : m[1] + t + m[3];
}
const TR_ATTRS = ["placeholder", "aria-label", "title", "alt"];
const TR_SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA"]);
function trTree(root) {
  if (root.nodeType === 3) {
    if (!TR_SKIP.has(root.parentNode?.nodeName)) {
      const v = trText(root.nodeValue);
      if (v !== root.nodeValue) root.nodeValue = v;
    }
    return;
  }
  if (root.nodeType !== 1 || TR_SKIP.has(root.nodeName)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = root; n; n = w.nextNode()) {
    if (n.nodeType === 1) {
      for (const a of TR_ATTRS) {
        const v = n.getAttribute(a);
        if (v) {
          const t = trText(v);
          if (t !== v) n.setAttribute(a, t);
        }
      }
    } else if (!TR_SKIP.has(n.parentNode.nodeName)) {
      const v = trText(n.nodeValue);
      if (v !== n.nodeValue) n.nodeValue = v;
    }
  }
}
// El panel del equipo se queda en español.
const trOff = () => LANG !== "en" || document.body.dataset.page === "equipo";
const trObs = new MutationObserver((records) => {
  if (trOff()) return;
  trObs.disconnect();
  for (const r of records) {
    if (r.type === "characterData") trTree(r.target);
    else r.addedNodes.forEach(trTree);
  }
  trWatch();
});
const trWatch = () => trObs.observe(document.body, { childList: true, subtree: true, characterData: true });

// Lo que no repinta la app: idioma de la página, título y botón ES/EN.
function applyLang() {
  document.documentElement.lang = LANG;
  document.title = L("NOVA Studio · Reserva tu cita en Vecindario", "NOVA Studio · Book your barber in Vecindario");
  const b = document.getElementById("lang-btn");
  if (b) {
    b.textContent = L("EN", "ES");
    b.setAttribute("aria-label", L("Switch to English", "Cambiar a español"));
    b.setAttribute("lang", L("en", "es"));
  }
  if (!trOff()) trTree(document.body);
}
function setLang(l) {
  LANG = l === "en" ? "en" : "es";
  try {
    localStorage.setItem(LANG_KEY, LANG);
  } catch {}
  applyLang();
}
trWatch();
applyLang();
