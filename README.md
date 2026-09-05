# NOVA Studio · web

Barbería NOVA Studio — Av. del Atlántico, 317 · Vecindario, Gran Canaria.

Arrancar en local:

```bash
node server.js
```

y abrir http://localhost:5173

---

## Publicada en GitHub Pages

La web funciona **sin servidor**. Cuando no hay backend detrás (que es el caso
en GitHub Pages), las llamadas a `/api/...` devuelven 404 y la página lo detecta
sola: en vez de dar error, prepara el mensaje de la reserva y lo cierra por
**WhatsApp**; las candidaturas se cierran por **email**. El cliente no se queda
tirado en ningún caso.

| | En local con `node server.js` | En GitHub Pages |
|---|---|---|
| Intro, secciones, fotos | ✅ | ✅ |
| Reserva de citas | Se guarda en `reservas.json` | Se cierra por WhatsApp |
| Google Calendar | ✅ si hay credenciales | ❌ (no hay servidor) |
| Candidaturas | Se guardan en `candidaturas.json` | Se cierran por email |

Para tener **la agenda automática en Google Calendar** hace falta un alojamiento
que ejecute Node (Render, Railway, Fly…), no Pages. Los pasos de las credenciales
están más abajo.

> `google-credentials.json`, `reservas.json` y `candidaturas.json` están en
> `.gitignore`: nunca se suben. Contienen la clave del calendario y datos
> personales de clientes.

---

## Qué hay que personalizar

| Dónde | Qué |
|---|---|
| `barberia.html` → `TEL_WHATSAPP` | número de WhatsApp del salón (formato `34XXXXXXXXX`) |
| `barberia.html` → enlaces `tel:` y `mailto:` | teléfono y correo reales |
| `barberia.html` → sección Servicios | precios y servicios definitivos |
| `barberia.html` → `<select id="pro">` | nombres del equipo |
| `config.json` | duración de cada servicio (minutos) |

La dirección ya está puesta: Av. del Atlántico, 317 · 35110 Vecindario · Las Palmas.

---

## Conectar Google Calendar

Sin configurar, la web **ya funciona**: guarda cada cita en `reservas.json` y ofrece
al cliente un enlace para añadirla a su propio calendario. Para que además entre
sola en la agenda del salón:

1. En [Google Cloud Console](https://console.cloud.google.com) crea un proyecto
   y activa **Google Calendar API**.
2. Crea una **cuenta de servicio** y descarga su clave en JSON.
3. Guarda ese archivo en esta carpeta como **`google-credentials.json`**.
4. Abre Google Calendar → el calendario del salón → *Configuración y uso compartido*
   → **Compartir con determinadas personas** → añade el `client_email` que aparece
   dentro del JSON, con permiso **«Hacer cambios en los eventos»**.
5. En esa misma pantalla, copia el **ID del calendario** y pégalo en
   `config.json` → `calendarId`.
6. Reinicia el servidor. Al arrancar debe decir `Google Calendar: activo`.

A partir de ahí cada reserva crea el evento con el cliente, el teléfono, el
servicio y las notas, con la duración que indique `config.json`.

El evento **no invita al cliente por email**: una cuenta de servicio no puede
hacerlo en un calendario normal (Google devuelve *«Service accounts cannot
invite attendees»*) y eso tumbaría la reserva. Su email queda en la descripción
del evento. Si tienes Google Workspace con delegación en todo el dominio,
puedes activarlo con `"invitarCliente": true` en `config.json`.

> `google-credentials.json`, `reservas.json` y `candidaturas.json` nunca se
> sirven por HTTP: el servidor los bloquea con un 403.

---

## Cómo está montada la intro

La supernova **se genera por código** (`supernova.js`), no son imágenes. Todo se
dibuja en función de un único número `t ∈ [0,1]` que marca la posición del
scroll, con inercia para suavizar los saltos de rueda.

El guion está en la constante `T`, al principio de `supernova.js`:

| Tramo | Qué ocurre |
|---|---|
| 0 – 10 % | la estrella, latiendo tranquila |
| 9 – 22 % | colapso: se contrae y se calienta |
| 21 – 30 % | detonación y destello |
| 22 – 80 % | filamentos, ondas expansivas, brasas y nubes de gas |
| 46 – 70 % | el logo **nace** del núcleo: primero es luz blanca y luego enfría hasta su color |
| 74 – 100 % | el logo sube y se ancla en la cabecera |

Ventajas frente a los 300 fotogramas:

- **164 KB en vez de 121 MB.** Ya se puede publicar en cualquier hosting.
- Se dibuja a la medida exacta del viewport: llena igual de bien un móvil en
  vertical que un monitor panorámico, sin recortes ni bandas.
- ~1 ms por fotograma, sin descargas ni tirones.
- El movimiento no está cuantizado a 300 pasos.

Para que no cante que hay un ordenador detrás se evitan las formas exactas:

- **Filamentos, no rayos.** Cada jirón es una cadena de nodos cuyo ángulo va
  derivando en un paseo aleatorio, así que serpentea. Se dibuja por tramos, cada
  uno más fino y tenue, para que se afile hasta desaparecer en la punta.
- **Frentes de choque abollados.** Las ondas no son `arc()`: el radio se modula
  con varias sinusoides de frecuencia alta y se pintan como una banda difusa,
  no como un contorno.
- **Brasas con vaivén**, no en línea recta desde el centro.
- **Núcleo con bultos descentrados**: un degradado perfectamente redondo parece
  una lámpara, no materia ardiendo.

Para retocarlo: los colores del halo del logo están en `prepararLogo()`, y el
número y comportamiento de cada elemento en las constantes `FILAMENTOS`,
`BRASAS`, `NUBES` y `GRUMOS`.

> El dibujo es **determinista**: como el scroll puede saltar hacia atrás, nada
> depende del fotograma anterior. El azar sale de una semilla fija.

`logo-nova.png` se extrajo de `nova sin fondo.jpeg` — que traía el damero de
transparencia grabado en los píxeles — recuperando solo las letras.

---

## El fondo de estrellas (`cielo.js`)

No depende del scroll sino del reloj: la página respira aunque nadie la toque.
Tres capas, de más quieta a más viva:

1. **base** — cientos de estrellas fijas, pintadas *una* vez en un lienzo
   aparte. Cada fotograma sólo se copia, no se recalculan.
2. **vivas** — unas decenas que laten, y una de cada cinco que **destella** de
   tarde en tarde con un brillo en cruz. El destello es raro y breve porque la
   onda va elevada a la 16.ª potencia: sólo asoma en el pico.
3. **cometas** — un haz corto que cruza en diagonal cada 5–13 s.

Cuesta 0,15 ms por fotograma. Frecuencia y brillo de los cometas, en
`lanzarCometa()`; densidad de las que laten, en `sembrarVivas()`.

---

## Las fotos

`supernova_im.jpg` ilustra la sección **Origen**, con los bordes difuminados por
una máscara radial para que se funda con el campo de estrellas.

Las cuatro del salón (`im1`, `im4`, `im3`, `Im2`) van dentro de **Servicios**,
en una tira intercalada entre las dos filas de tarjetas: tres tarjetas, las
cuatro fotos, tres tarjetas.

Van en **tiles cuadrados**, no estirados. Las cuatro son verticales o cuadradas
(proporciones de 0,56 a 0,94), así que al alargarlas en horizontal se perdía
medio encuadre. Cuadradas conservan el 90–94 % de la imagen (la vertical, un
66 %), y cada una lleva su propio `object-position` para que no se quede fuera
lo que importa: el carro entero de herramientas, el barbero y el cliente, el
espejo con el bordado. Están en las reglas `.foto.f-oficio`, `.f-cabina`,
`.f-acabado` y `.f-casa`.

Ninguna es una foto pegada: cada una tiene tres movimientos independientes,
anidados para que no se pisen entre sí.

| Capa | Qué hace |
|---|---|
| `.foto` | se descubre de abajo arriba al entrar en pantalla (`clip-path`) |
| `.lente` | paralaje: se desplaza según dónde esté en la pantalla (JS) |
| `img` | respira sola con un zoom lentísimo de 26 s |

Como venían con luz fría de salón y cada una de su padre y de su madre, se pasan
a blanco y negro y se tiñen con un **duotono**: `multiply` con oro (`#ffc470`)
baja las luces a dorado y `screen` con violeta oscuro (`#0f0d1e`) sube las
sombras. El tinte depende del brillo de cada píxel, no de su posición, y por eso
las cuatro casan entre sí y con el fondo. Al pasar el ratón recuperan su color
real.

Para cambiar el tono, esos dos colores están en `.foto .velo` y `.foto::after`.
Para sustituir una foto basta con dejar otra con el mismo nombre; el recorte lo
resuelve `object-fit: cover`.

---

### Volver a la versión con el vídeo

La anterior sigue guardada en **`index-frames.html`** (usa la carpeta
`frames/`). Para recuperarla basta con renombrarla a `barberia.html`.

Si te quedas con la versión generada por código, puedes **borrar la carpeta
`frames/` y liberar 121 MB**.
