// Solo para probar en el ordenador: `npm run dev` y abrir http://localhost:5180
// Sirve los archivos y manda /api/* a la misma función que usa Vercel.
// Sin credenciales de Redis, guarda todo en memoria (se borra al cerrar).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "./api/handler.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv.find((a) => /^\d+$/.test(a)) || process.env.PORT || 5180);
if (process.argv.includes("--demo")) await (await import("./dev-seed.js")).seed();
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

http
  .createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.startsWith("/api/")) return handler(req, res);
    let file = normalize(join(root, path === "/" ? "index.html" : path));
    if (!file.startsWith(root) || /[\\/](api|\.vercel)[\\/]|dev-(server|seed)|\.env|package\.json/.test(file.slice(root.length - 1))) {
      res.statusCode = 404;
      return res.end();
    }
    try {
      if (!extname(file)) file = join(root, "index.html");
      const data = await readFile(file);
      res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("No existe");
    }
  })
  .listen(port, () => console.log(`NOVA reservas en http://localhost:${port}`));
