// Cómo se entra en la cuenta.
//
// Por defecto hace falta un código de 6 cifras al correo. En Vercel eso no se
// puede apagar: LOGIN_CON_CODIGO=0 solo vale en el ordenador, para pruebas.
// Si en producción falta RESEND_API_KEY, no se abre ninguna sesión.

export function accessPolicy(env = process.env) {
  const onVercel = !!env.VERCEL;
  const direct = !onVercel && env.LOGIN_CON_CODIGO === "0";
  const mail = !!env.RESEND_API_KEY;
  return {
    direct,
    code: !direct,
    // En producción el formulario de correo solo aparece si de verdad podemos
    // mandar el código. En local, sin Resend, el código sale por la consola.
    email: direct || mail || !onVercel,
    phone: false,
  };
}

export const MAIL_NOT_READY =
  "Ahora mismo no podemos enviarte el código por correo: falta configurar el correo del estudio. Escríbenos por WhatsApp y te ayudamos a reservar. No hemos abierto ninguna sesión.";
