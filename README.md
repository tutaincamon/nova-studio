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

## Clientes dormidos y reseñas de Google (panel del dueño)

Panel: **Más → Avisos y reseñas** (solo el dueño; 403 a barberos y caja). Amplía lo que ya hacía el cron, sin duplicarlo:

- **Clientes dormidos**: sin venir `dormantWeeks` semanas (por defecto 6, de 2 a 52) y sin cita futura. Sustituye a la antigua regla de «días» (`lapseDays` se convierte solo a semanas). La misma función alimenta «Clientes», el cron y «Cuánto gana Nova».
- **Aviso automático** (casilla `winbackAuto`, desactivada por defecto): una vez al día, desde las 9:00, como mucho 15 correos; un aviso por cliente cada N semanas (también cuenta un aviso manual), nunca a quien tiene cita o se dio de baja. El correo lleva un enlace de reserva directa `#reservar/<servicio>/<barbero>` con los habituales del cliente ya elegidos.
- **Reseña tras cada cita completada** (`reviews`): una hora después, una sola petición por cita (`revreq:<id>`) y como mucho una cada `reviewGapDays` días por cliente (por defecto 180). El enlace es el del panel; si no, `GOOGLE_REVIEW_URL`; si no, la ficha de Google de la pestaña Web. El botón del correo pasa por `/api/resena/…`, que apunta la medalla.
- **Sin envío en demo**: con `MODO_DEMO=1` o sin `RESEND_API_KEY` no sale ningún correo; cada aviso se anota con estado «simulado» en el registro `avisos:log` (últimos 300; se limpia al borrar a un cliente) y el cron lo cuenta en `simulated`.
- Cron: el mismo `/api/cron/tick` horario. En Vercel exige `CRON_SECRET`; en local solo si la variable está puesta.
- API: `GET /api/staff/avisos`, `POST /api/staff/avisos/resena` (reenviar), `POST /api/staff/clients/contact` (aviso manual) y `POST /api/staff/rules` (`dormantWeeks`, `winbackAuto`, `reviews`, `reviewUrl`, `reviewGapDays`).
- Variable nueva: `GOOGLE_REVIEW_URL`. Tests: `test/reengage.test.js`. El panel está solo en castellano, así que `i18n.js` no cambia.

---

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
| `STRIPE_WEBHOOK_SECRET` | Secreto de firma (`whsec_…`) del webhook `/api/stripe/webhook` de la membresía. Sin él, el webhook responde 503 y no acepta nada |
| `STRIPE_MEMBERSHIP_PRICE_ID` | Opcional. ID de un precio mensual de Stripe (`price_…`) para el primer plan. Sin él, el precio se crea solo con un `lookup_key` |
| `STAFF_PIN` | Clave del dueño, si no tiene una puesta desde el panel |
| `STAFF_PIN_AIRAM` | Clave del panel de Airam (y `STAFF_PIN_` + el id en mayúsculas de cada barbero) |
| `STAFF_PIN_EHEDEY` | Clave de Ehedey |
| `STAFF_PIN_NOA` | Clave de Noah |
| `GOOGLE_REVIEW_URL` | Enlace donde se deja la reseña de Google (`https://…`). El que ponga el dueño en el panel prevalece; si no hay ninguno, se usa la ficha de Google elegida en la pestaña Web |
| `GOOGLE_PLACES_KEY` | Leer la ficha y las reseñas de Google |
| `AVISO_CORREO` | Correo que recibe los avisos del salón, si no es el del titular |
| `PUBLIC_HOST` | Dominio de los enlaces de los correos, de `llms.txt` y de la URL del MCP, si no vale el de la petición |
| `MCP_ALLOWED_ORIGINS` | Opcional. Orígenes de navegador (separados por comas) que pueden llamar a `/api/mcp`, p. ej. un inspector MCP local. Sin ella solo se acepta la propia web; los clientes de servidor (sin `Origin`) siempre entran |

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

## Reserva con tu asistente de IA (MCP)

Un asistente (Claude, ChatGPT, Grok…) puede reservar por orden del cliente, sin navegador ni contraseña. Por ejemplo: «Pídeme cita con Airam el jueves por la tarde».

- **Servidor MCP**: `https://nova.appflu.es/api/mcp`. Usa Streamable HTTP: JSON-RPC 2.0 por `POST`, respuestas JSON, sin SSE y sin sesión (versiones 2025-06-18 y 2025-03-26). `GET` devuelve 405.
- **Sin token**: `list_services`, `list_barbers`, `get_availability`.
- **Con token**: `create_booking`, `list_my_bookings`, `cancel_booking`, `revoke_assistant_token`.
- **Cómo se consigue el token**: el asistente llama a `request_login_code` con el correo del cliente (le llega el mismo código de 6 cifras que en la web) y después a `verify_login_code` con ese código y el nombre si la cuenta es nueva. El token se devuelve una sola vez. También se puede generar en la web: **Perfil → «Conectar mi asistente de IA»**. Desde ahí se ven los tokens activos y se revocan. En modo demo (`MODO_DEMO=1`) no se manda correo y vale cualquier código de 6 cifras, igual que la web entra solo con el correo.
- **Cómo se usa**: cabecera `Authorization: Bearer nova_ast_…`. Si el cliente MCP no deja poner cabeceras, el token también vale en el argumento `assistant_token`. Un token inválido en la cabecera da 401 con `WWW-Authenticate: Bearer`.
- **Tokens**: 32 bytes aleatorios. En Redis solo se guarda su sha256 (`bnova:ast:<sha256>`, índice `bnova:uast:<correo>`). Caducan a los 180 días sin uso y cada uso los renueva. Hay como mucho 5 por cliente: al crear el sexto se revoca el más antiguo. Al borrar la cuenta se borran también.
- **Mismas reglas que la web**: huecos, antelación, días vista, máximo de citas, condiciones y cancelación tardía usan las mismas funciones (`freeSlots`/`freeTimes`, `bookFor`, `cancelFor`, `codeRequest`/`codeCheck`). Si el estudio pide tarjeta en garantía y el cliente no tiene, `create_booking` devuelve un error con el enlace al perfil para añadirla.
- **Límites**: 240 llamadas por minuto e IP. Para pedir código, 5 cada 15 minutos por correo y 10 por IP, además de los de la web. Para comprobarlo, 10 por correo y 30 por IP. Reservas y cancelaciones: 10 por hora y token.
- **Descubrimiento**: `/llms.txt` (se genera con los servicios y el equipo que hay en la base, así que no se desfasa), `/.well-known/mcp.json`, y el JSON-LD (`HairSalon` con catálogo de precios) en `index.html`. El JSON-LD es estático: `test/llms-jsonld.test.js` comprueba que coincide con `config.js`.

Conectarlo en Claude Code, por ejemplo:

```bash
claude mcp add --transport http nova https://nova.appflu.es/api/mcp --header "Authorization: Bearer nova_ast_…"
```

Probar con curl en local (`MODO_DEMO=1 node dev-server.js 5291 --demo`):

```bash
M=http://localhost:5291/api/mcp
curl -s -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' $M
curl -s -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' $M
curl -s -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_availability","arguments":{"service_id":"corte","date":"2026-12-03","days":3}}}' $M
curl -s -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"request_login_code","arguments":{"email":"yo@example.com"}}}' $M
curl -s -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"verify_login_code","arguments":{"email":"yo@example.com","code":"000000","name":"Yo"}}}' $M
curl -s -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"create_booking","arguments":{"service_id":"corte","barber_id":"airam","date":"2026-12-03","time":"17:00","accept_terms":true}}}' $M
```

En local Stripe va en modo prueba, así que `create_booking` pide antes una tarjeta. Añádela desde el perfil, con cualquier número de prueba.

Limitaciones: no hay SSE ni notificaciones del servidor. No hay OAuth: los clientes que solo aceptan conectores con OAuth (como los conectores web de algunos asistentes) pueden usar las herramientas de consulta y pasar el token en `assistant_token`. Las citas que se repiten no se piden por el asistente. La nota del cliente llega en el correo al salón, pero el panel aún no la enseña.

---

## Cuánto gana Nova (panel del dueño)

En el panel, **Más → Cuánto gana Nova** (solo el dueño; la API devuelve 403 a barberos y caja). Elige el mes (por defecto el actual) y compara con el anterior en € y %.

- **Ingresos**: facturación de las citas hechas o cobradas (misma lógica que Caja y Progreso: una cita cobrada cuenta por lo cobrado), servicios, ticket medio, ocupación (minutos con cita entre minutos de horario de cada barbero), ingresos por barbero, clientes nuevos y recurrentes, y clientes dormidos (los mismos de «Avisos y reseñas», según las semanas que fije el dueño).
- **Otros ingresos**: línea aparte. Hoy suma la ropa vendida (`supply:ventas`). Para añadir otra fuente, se agrega un objeto a la lista `INCOME_SOURCES` de `api/handler.js` (`{ id, label, get(month) }`).
- **Gastos** editables (alquiler, luz, agua, internet, productos, sueldo fijo y comisión % de cada barbero, Seguridad Social, autónomo, gestoría, software, otros y conceptos libres), guardados en `gastos:<AAAA-MM>`. Un mes sin gastos propios hereda los del último mes anterior que los tenga. El servidor valida (importes de 0 a 100.000 €, % de 0 a 100, máximo 30 conceptos libres).
- **Beneficio neto** = ingresos − gastos fijos − comisiones, con margen %. Se recalcula en el navegador al escribir; el botón «Guardar gastos» lo guarda. El % de comisión sale del equipo; si se cambia aquí solo vale para este análisis.
- API: `GET /api/staff/earnings?month=AAAA-MM` y `POST /api/staff/expenses`. Sin variables de entorno nuevas.
- Tests: `test/earnings.test.js`. El panel está solo en castellano (no usa `i18n.js`), así que no hay textos nuevos allí.

---

## Socio NOVA+ (membresía mensual de pago)

Capa **nueva y distinta del Club** (puntos, ligas y medallas, que siguen gratis): el cliente paga una cuota al mes con Stripe Subscriptions y recibe cortes incluidos y ventajas. Plan por defecto: «Club NOVA», 30 €/mes, 2 cortes (corte y corte+barba), reserva hasta 90 días vista (los demás, 60) y 10 % en el resto de servicios y en la ropa. El precio está pendiente de cerrar.

- **Planes**: los de partida están en `MEMBERSHIP` (`api/_lib/config.js`); el dueño los edita en **Más → Socios NOVA+** (nombre, precio, cortes, servicios cubiertos, días vista, descuento, activo). Se guardan en la clave `memplans`. Un plan editado vale para altas nuevas: cada socio guarda una copia de lo que contrató.
- **Alta (perfil → «Socio NOVA+»)**: con `STRIPE_SECRET_KEY`, redirige a Stripe Checkout (`mode=subscription`). El producto y el precio se crean solos la primera vez con `lookup_key` `nova_socio_<plan>_<céntimos>` (si el dueño cambia el precio se crea otro precio; los socios antiguos siguen con el suyo), o se usa `STRIPE_MEMBERSHIP_PRICE_ID`. «Gestionar pago» abre el portal de Stripe (hay que activarlo en el panel de Stripe). «Darme de baja» pone `cancel_at_period_end`: conserva las ventajas hasta fin de periodo y puede deshacerlo.
- **Modo demo**: sin `STRIPE_SECRET_KEY` (también con `MODO_DEMO=1`), alta y baja son inmediatas, sin cobro, marcadas «demo». La renovación mensual se simula al abrir la cuenta o en el cron.
- **Webhook** `POST /api/stripe/webhook` (función propia `api/stripe-webhook.js`, con el cuerpo en bruto): firma `Stripe-Signature` comprobada a mano con HMAC-SHA256 (tolerancia de 5 min, sin dependencias). Eventos: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`. Estados: `active`, `past_due` (sin ventajas), `canceled`, `incomplete`. Cada evento se procesa una sola vez. En Stripe hay que crear el endpoint con esos eventos y copiar su secreto en `STRIPE_WEBHOOK_SECRET`.
- **Al reservar**: si es socio activo, el servicio está cubierto y le quedan cortes del periodo, la cita sale «incluida en tu membresía» (`b.membership.included`, 0 € en caja). Los cortes usados no son un contador: se cuentan sobre las citas del periodo, así que **cancelar a tiempo devuelve el corte**; cancelar tarde o «No vino» lo gasta. Las citas de un periodo futuro (por los días vista) salen incluidas si la membresía se renueva. Las citas repetidas y las que crea el equipo no consumen corte.
- **Caja y ganancias**: la cita incluida se «cobra» a 0 € con forma de pago «Membresía» y no suma como ingreso del servicio; las cuotas cobradas salen como línea propia («Socio NOVA+ (cuotas)») en «Cuánto gana Nova», así que no se cuenta dos veces. **Comisión del barbero**: cobra su % por cada corte incluido, calculado sobre el **precio normal** del servicio aunque el cliente pague 0 € (Caja → «Te toca» y «Cuánto gana Nova» → Comisiones; el cobro de caja guarda el precio normal en `normal`). «Cuánto gana Nova» muestra cuántos cortes incluidos hubo y la comisión que generaron; el ingreso sigue siendo solo la cuota. **Puntos**: el socio sigue sumando puntos del Club por el valor normal del servicio (`pointsOf`). Sin variables de entorno nuevas. A los demás servicios del socio, la caja le propone su descuento %.
- **Panel (solo el dueño, 403 al resto)**: socios con plan, estado, cortes usados/restantes, alta, próxima renovación y MRR (suma de cuotas de los socios activos). `GET /api/staff/membership` y `POST /api/staff/membership/plans`.
- API del cliente: `GET /api/membership`, `POST /api/membership/join|cancel|portal`. `/api/me` y `/api/catalog` llevan la membresía.
- Tests: `test/membership.test.js`. Sin dependencias nuevas.

---

## Probar

```bash
cd reservas
npm test
```

Cubre el acceso (código obligatorio, y que en producción sin correo no hay sesión) y que `/api/catalog` no devuelve el NIF ni el nombre del titular. Esos dos datos siguen en `/api/legal`, que es lo que pinta el aviso legal.

`test/mcp.test.js` cubre el servidor MCP: `initialize`, herramientas, el flujo código → token → reservar → ver → cancelar en modo demo, la cancelación tardía, el 401, revocar, el máximo de 5 tokens, los límites, que el token solo se guarda resumido y los errores JSON-RPC. `test/llms-jsonld.test.js` comprueba el JSON-LD contra `config.js` y que `index.html` no tiene scripts en línea.
