# NOVA Studio · app de reservas

Barbería NOVA Studio — Av. del Atlántico, 317 · Vecindario, Gran Canaria.

La app de citas está en `reservas/`. Es una sola página (`index.html`, `app.js`, `app.css`) y una función de Vercel (`reservas/api/handler.js`) con Redis (Vercel KV o Upstash). La demo vive en el proyecto de Vercel que publica esa carpeta.

En la raíz del repo siguen los archivos de la tienda de ropa NOVA Supply (otra web, otro despliegue). Esta guía es la de las reservas.

Arrancar en local, desde `reservas/`:

```bash
npm test
npm run dev
```

y abrir http://localhost:5180

Sin variables de entorno, los datos se quedan en memoria (se borran al cerrar) y el código de acceso de 6 cifras sale por la consola. No se abre sesión solo con el correo.

El cliente escribe el correo una vez, recibe el código y la sesión queda en ese dispositivo un año. Cada vez que abre la app se renueva. Pedir otro código (otro móvil, u otro navegador) no cierra las sesiones que ya estaban abiertas. Solo «Cerrar sesión» borra la de ese aparato. La cookie es `HttpOnly`, `SameSite=Lax`, con `Max-Age` y `Expires`, y `Secure` en HTTPS, para que la conserve la PWA instalada en iOS y en Android. El nombre se pide una sola vez (reserva y ranking). El teléfono es opcional.

---

## Qué hace

| Pieza | Dónde |
|---|---|
| Reserva, cuenta, club, lista de espera, formación | `reservas/app.js` y `reservas/api/handler.js` |
| Panel del equipo (agenda, caja, ropa, clientes) | `reservas/panel.js`, se descarga al entrar en `#equipo` |
| Servicios, equipo, horario, puntos, textos legales de negocio | `reservas/api/_lib/config.js` |
| Correo | `reservas/api/_lib/mail.js` (Resend) |
| Tarjeta en garantía | `reservas/api/_lib/stripe.js` |
| Stock compartido con la tienda | claves `supply:*` y `preventa:*` en la misma base |

El cron horario (`/api/cron/tick`) manda recordatorios, reseñas, reactivación y la copia de los lunes. Hace falta `CRON_SECRET` y el correo configurado. Sin correo, el cron no escribe a nadie.

---

## Variables de entorno

Solo los nombres. Los valores van en Vercel, nunca en el repo.

| Nombre | Para qué |
|---|---|
| `KV_REST_API_URL` | Base Redis (o `UPSTASH_REDIS_REST_URL`) |
| `KV_REST_API_TOKEN` | Token de esa base (o `UPSTASH_REDIS_REST_TOKEN`) |
| `STORE_PREFIX` | Prefijo de las claves. Si no se pone, es `bnova:` |
| `RESEND_API_KEY` | Enviar correos (código de acceso, confirmaciones, recordatorios) |
| `MAIL_FROM` | Remitente, con un dominio verificado en Resend |
| `LOGIN_CON_CODIGO` | En Vercel no cambia nada. En local, `0` entra sin código (solo para pruebas) |
| `MODO_DEMO` | Si vale `1`, se entra solo con el correo también en producción y la app muestra «Modo demo». Sin esta variable, en producción hace falta el código |
| `CRON_SECRET` | El cron de Vercel lo manda como `Authorization: Bearer …` |
| `STRIPE_SECRET_KEY` | Cobro de faltas y tarjeta en garantía. Sin las dos claves, no se pide tarjeta |
| `STRIPE_PUBLISHABLE_KEY` | La clave pública que carga el móvil |
| `STAFF_PIN` | Clave del dueño, si no tiene una puesta desde el panel |
| `STAFF_PIN_AIRAM` | Clave del panel de Airam (y `STAFF_PIN_` + el id en mayúsculas de cada barbero) |
| `STAFF_PIN_EHEDEY` | Clave de Ehedey |
| `STAFF_PIN_NOA` | Clave de Noah |
| `GOOGLE_PLACES_KEY` | Leer la ficha y las reseñas de Google |
| `AVISO_CORREO` | Correo que recibe los avisos del salón, si no es el del titular |
| `PUBLIC_HOST` | Dominio de los enlaces de los correos, si no vale el de la petición |

`VERCEL` la pone la plataforma. No hay que crearla.

---

## Activar Resend y el código de acceso

En producción no se puede entrar solo con el correo, salvo que pongas `MODO_DEMO=1`. Si falta el correo y no hay modo demo, la app no abre sesión y dice que hay que escribir por WhatsApp.

Mientras la demo no tenga Resend, en Vercel puedes poner `MODO_DEMO` a `1`. El cliente entra con el correo, ve un aviso discreto de «Modo demo» y la sesión queda guardada igual. Cuando actives Resend, quita `MODO_DEMO`: vuelve el código y el aviso desaparece.

1. En [Resend](https://resend.com) verifica el dominio desde el que quieres escribir (por ejemplo `novastudio.es`) y crea una API key.
2. En Vercel → Settings → Environment Variables, añade `RESEND_API_KEY` y `MAIL_FROM`. `MAIL_FROM` tiene esta forma: `NOVA Studio <hola@tudominio>`.
3. Añade `CRON_SECRET` (una cadena larga aleatoria). Vercel Cron la envía solo en la llamada horaria.
4. No hace falta `LOGIN_CON_CODIGO`. El código de 6 cifras es el camino normal. Caduca a los 10 minutos y solo se pide una vez por dispositivo. Quita `MODO_DEMO` si lo habías puesto para la demo.
5. Vuelve a desplegar. En `#login` debe decir que se manda un código, no que el correo basta.
6. Prueba con un correo tuyo. Si Resend rechaza el envío, la sesión no se abre.

En el ordenador, sin `RESEND_API_KEY`, el mismo código se imprime en la terminal donde corre `npm run dev`.

---

## Probar

```bash
cd reservas
npm test
```

Cubre el acceso (código obligatorio, y que en producción sin correo no hay sesión) y que `/api/catalog` no devuelve el NIF ni el nombre del titular. Esos dos datos siguen en `/api/legal`, que es lo que pinta el aviso legal.
