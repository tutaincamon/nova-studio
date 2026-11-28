// Corre antes de pintar: tema (plata o rosa) y, si ya se vio, sin la intro.
// También adelanta la foto de portada en WebP, con el JPEG de reserva en el HTML.
try {
  var t = localStorage.getItem("nova_theme") === "rosa" ? "rosa" : "plata";
  if (t === "rosa") document.documentElement.dataset.theme = "rosa";
  [["", "portrait"], ["-wide", "landscape"]].forEach(function (p) {
    var l = document.createElement("link");
    l.rel = "preload";
    l.as = "image";
    l.type = "image/webp";
    l.media = "(orientation: " + p[1] + ")";
    l.href = "/assets/hero-" + t + p[0] + ".webp";
    document.head.appendChild(l);
  });
} catch (e) {}
try {
  if (sessionStorage.getItem("nova_splash")) document.documentElement.classList.add("no-splash");
} catch (e) {}
