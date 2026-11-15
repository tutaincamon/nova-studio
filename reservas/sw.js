// Deja la app abrir sin conexión con lo último que se vio, y abrir rápido con
// conexión. La API nunca se guarda: las horas libres y las citas siempre se
// piden en el momento.
// - Fotos, fuentes y app.js / app.css con «?v=»: primero lo guardado en el
//   móvil (no cambian; una versión nueva lleva otro «?v=»).
// - La página: primero la red (para estrenar cambios al momento) y, sin red,
//   lo guardado.
const CACHE = "nova-v37";
const SHELL = ["/", "/app.css?v=36", "/i18n.js?v=36", "/app.js?v=36", "/assets/logo.png", "/assets/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const keep = (req, res) => {
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};
const fixed = (url) => url.pathname.startsWith("/assets/") || url.searchParams.has("v");

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (fixed(url)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => keep(e.request, r))));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((r) => keep(e.request, r))
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/"))),
  );
});
