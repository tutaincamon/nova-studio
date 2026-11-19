// Cómo se entra en la cuenta.
//
// Por defecto hace falta un código de 6 cifras al correo, una sola vez en ese
// dispositivo. En Vercel eso no se apaga con LOGIN_CON_CODIGO=0 (ese 0 solo
// vale en el ordenador). La excepción es MODO_DEMO=1: entra solo con el correo
// también en producción, mientras la demo no tenga Resend. Sin esa variable,
// si en producción falta RESEND_API_KEY, no se abre ninguna sesión.

export function accessPolicy(env = process.env) {
  const onVercel = !!env.VERCEL;
  const demo = env.MODO_DEMO === "1";
  const direct = demo || (!onVercel && env.LOGIN_CON_CODIGO === "0");
  const mail = !!env.RESEND_API_KEY;
  return {
    direct,
    code: !direct,
    demo,
    // En producción el formulario de correo solo aparece si podemos mandar el
    // código, o si la demo permite entrar sin él. En local, sin Resend, el
    // código sale por la consola.
    email: direct || mail || !onVercel,
    phone: false,
  };
}

export const MAIL_NOT_READY =
  "Ahora mismo no podemos enviarte el código por correo: falta configurar el correo del estudio. Escríbenos por WhatsApp y te ayudamos a reservar. No hemos abierto ninguna sesión.";
