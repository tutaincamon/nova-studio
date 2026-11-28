// Servidor MCP (Model Context Protocol) por «Streamable HTTP», sin librerías:
// JSON-RPC 2.0 por POST y respuestas JSON (sin SSE, que aquí no hace falta).
// Especificación: https://modelcontextprotocol.io (versiones 2025-06-18 y 2025-03-26).
//
// Aquí solo está el protocolo: leer la petición, comprobar el origen y el
// token, validar los argumentos y contestar. Las herramientas (qué hace cada
// una) las pone handler.js, que es quien conoce la agenda y las reglas.
//
// Sin estado: no hay Mcp-Session-Id. Cada POST trae todo lo que hace falta.

export const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// Códigos de error de JSON-RPC.
export const PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603;

const MAX_BODY = 200000;
const MAX_BATCH = 20;

// ── Validación de argumentos (el subconjunto de JSON Schema que usamos) ───
// type object/string/integer/number/boolean, properties, required,
// additionalProperties:false, enum, pattern, minLength, maxLength, minimum, maximum.
export function validate(schema, value, path = "") {
  const errs = [];
  const at = path || "argumentos";
  const t = schema.type;
  if (t === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${at}: tiene que ser un objeto`];
    for (const k of schema.required || []) if (value[k] === undefined) errs.push(`falta «${path ? path + "." : ""}${k}»`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (!sub) {
        if (schema.additionalProperties === false) errs.push(`«${path ? path + "." : ""}${k}» no se admite`);
        continue;
      }
      if (v === undefined) continue;
      errs.push(...validate(sub, v, path ? path + "." + k : k));
    }
    return errs;
  }
  if (t === "string") {
    if (typeof value !== "string") return [`«${at}» tiene que ser texto`];
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`«${at}» es demasiado corto`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`«${at}» es demasiado largo (máx. ${schema.maxLength})`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`«${at}» no tiene el formato esperado${schema.examples ? " (ej. " + schema.examples[0] + ")" : ""}`);
  } else if (t === "integer" || t === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (t === "integer" && !Number.isInteger(value))) return [`«${at}» tiene que ser un número${t === "integer" ? " entero" : ""}`];
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`«${at}» tiene que ser como mínimo ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`«${at}» tiene que ser como máximo ${schema.maximum}`);
  } else if (t === "boolean") {
    if (typeof value !== "boolean") return [`«${at}» tiene que ser true o false`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`«${at}» tiene que ser uno de: ${schema.enum.join(", ")}`);
  if (schema.const !== undefined && value !== schema.const) errs.push(`«${at}» tiene que ser ${JSON.stringify(schema.const)}`);
  return errs;
}

// ── HTTP ───────────────────────────────────────────────────────────────────
async function readRaw(req) {
  // En Vercel, req.body ya viene leído (y lanza un error si el JSON está mal).
  if (req.body !== undefined) {
    if (typeof req.body === "string") return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
    return req.body; // ya es un objeto
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw Object.assign(Error("too big"), { tooBig: true });
  }
  return raw;
}

const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });

function send(res, status, payload, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (payload === undefined) return res.end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

const bearerOf = (req) => {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || "").trim());
  return m ? m[1].trim() : null;
};

// Resultado de una herramienta: el texto para el modelo y los mismos datos estructurados.
export const toolResult = (text, data) => ({
  content: [{ type: "text", text: data === undefined ? text : `${text}\n\n${JSON.stringify(data, null, 2)}` }],
  ...(data !== undefined ? { structuredContent: data } : {}),
  isError: false,
});
export const toolError = (text, data) => ({
  content: [{ type: "text", text: data === undefined ? text : `${text}\n\n${JSON.stringify(data, null, 2)}` }],
  ...(data !== undefined ? { structuredContent: data } : {}),
  isError: true,
});

/**
 * Atiende una petición HTTP al endpoint MCP.
 * opts:
 *  - serverInfo { name, title, version }, instructions
 *  - tools: [{ name, title, description, inputSchema, annotations, auth, run(args, ctx) }]
 *    run devuelve { text, data } o lanza un error con `.message` (se convierte en isError).
 *  - originOk(origin, req) → bool
 *  - resolveToken(token) → registro o null
 *  - before(ctx): límites y carga de datos; puede lanzar { status: 429, message }
 *  - errorText(e, ctx) → { text, data } para errores esperados, o null para un fallo interno
 *  - needAuthText(ctx) → texto cuando una herramienta pide token y no lo hay
 *  - ip(req) → la IP del cliente (para los límites)
 */
export async function serveMcp(req, res, opts) {
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin;
  // Protección contra DNS rebinding y páginas ajenas: si la petición viene de
  // un navegador (trae Origin), solo se acepta el origen de la propia web o los
  // de MCP_ALLOWED_ORIGINS. Los clientes de servidor a servidor no mandan Origin.
  if (origin) {
    if (!opts.originOk(origin, req)) return send(res, 403, rpcError(null, INVALID_REQUEST, "Origen no permitido."));
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
  }
  if (req.method === "OPTIONS") {
    return send(res, 204, undefined, {
      Allow: "POST, OPTIONS",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
      "Access-Control-Max-Age": "86400",
    });
  }
  // Sin SSE: GET (abrir un canal de avisos) y DELETE (cerrar sesión) no se usan.
  if (req.method !== "POST") return send(res, 405, rpcError(null, INVALID_REQUEST, "Este servidor MCP solo acepta POST."), { Allow: "POST, OPTIONS" });

  const pv = req.headers["mcp-protocol-version"];
  if (pv && !PROTOCOLS.includes(String(pv))) return send(res, 400, rpcError(null, INVALID_REQUEST, `Versión de protocolo no admitida: ${pv}. Admitidas: ${PROTOCOLS.join(", ")}.`));

  const ct = String(req.headers["content-type"] || "");
  if (ct && !ct.includes("application/json")) return send(res, 415, rpcError(null, INVALID_REQUEST, "Manda el cuerpo como application/json."));

  let msg;
  try {
    const raw = await readRaw(req);
    msg = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    if (e.tooBig) return send(res, 413, rpcError(null, INVALID_REQUEST, "Petición demasiado grande."));
    return send(res, 400, rpcError(null, PARSE_ERROR, "JSON mal formado."));
  }

  const ctx = { req, ip: opts.ip(req), token: null, account: null };
  try {
    await opts.before(ctx);
  } catch (e) {
    if (e.status === 429) return send(res, 429, rpcError(null, -32000, e.message), { "Retry-After": "60" });
    throw e;
  }

  // Token en la cabecera: si viene y no vale, 401 (el cliente sabe que tiene que pedir otro).
  const bearer = bearerOf(req);
  if (bearer) {
    const rec = await opts.resolveToken(bearer);
    if (!rec)
      return send(res, 401, rpcError(null, -32001, "El token de asistente no es válido, ha caducado o se ha revocado. Consigue otro con request_login_code y verify_login_code, o desde tu perfil en la web."), {
        "WWW-Authenticate": `Bearer realm="${opts.serverInfo.name}", error="invalid_token", error_description="Token de asistente no valido, caducado o revocado"`,
      });
    ctx.token = bearer;
    ctx.account = rec;
  }

  const batch = Array.isArray(msg);
  const list = batch ? msg : [msg];
  if (batch && !list.length) return send(res, 400, rpcError(null, INVALID_REQUEST, "Lote vacío."));
  if (list.length > MAX_BATCH) return send(res, 400, rpcError(null, INVALID_REQUEST, `Como mucho ${MAX_BATCH} mensajes por lote.`));

  const out = [];
  for (const m of list) {
    const r = await handleMessage(m, ctx, opts);
    if (r) out.push(r);
  }
  // Solo avisos o respuestas: 202 sin cuerpo.
  if (!out.length) return send(res, 202);
  return send(res, 200, batch ? out : out[0]);
}

async function handleMessage(m, ctx, opts) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return rpcError(null, INVALID_REQUEST, "Mensaje JSON-RPC no válido.");
  const hasId = Object.prototype.hasOwnProperty.call(m, "id");
  // Respuestas del cliente a peticiones nuestras (no hacemos ninguna): se ignoran.
  if (!("method" in m) && ("result" in m || "error" in m)) return null;
  const idOk = !hasId || m.id === null || typeof m.id === "string" || (typeof m.id === "number" && Number.isFinite(m.id));
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string" || !idOk) return rpcError(idOk && hasId ? m.id : null, INVALID_REQUEST, "Mensaje JSON-RPC no válido.");
  if (m.params !== undefined && (typeof m.params !== "object" || m.params === null)) return hasId ? rpcError(m.id, INVALID_PARAMS, "«params» tiene que ser un objeto.") : null;

  // Avisos (sin id): notifications/initialized, notifications/cancelled… No se contestan.
  if (!hasId) return null;
  const id = m.id,
    params = m.params || {};
  try {
    switch (m.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        if (typeof asked !== "string") return rpcError(id, INVALID_PARAMS, "Falta «protocolVersion».");
        return rpcResult(id, {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: opts.serverInfo,
          instructions: opts.instructions,
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, {
          tools: opts.tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}) })),
        });
      case "tools/call":
        return rpcResult(id, await callTool(id, params, ctx, opts));
      default:
        return rpcError(id, METHOD_NOT_FOUND, `Método no disponible: ${m.method}`);
    }
  } catch (e) {
    if (e.rpc) return rpcError(id, e.rpc, e.message, e.data);
    console.error("MCP", e);
    return rpcError(id, INTERNAL_ERROR, "Error interno del servidor.");
  }
}

const rpcFail = (code, message, data) => {
  throw Object.assign(Error(message), { rpc: code, data });
};

async function callTool(id, params, ctx, opts) {
  const tool = typeof params.name === "string" && opts.tools.find((t) => t.name === params.name);
  if (!tool) rpcFail(INVALID_PARAMS, `Herramienta desconocida: ${params.name}`);
  const args = params.arguments === undefined ? {} : params.arguments;
  const errs = validate(tool.inputSchema, args);
  if (errs.length) rpcFail(INVALID_PARAMS, `Argumentos no válidos para ${tool.name}: ${errs.join("; ")}.`, { errors: errs });

  let account = ctx.account;
  if (tool.auth) {
    // Si el cliente no deja poner cabeceras, el token puede ir como argumento.
    if (!account && args.assistant_token) {
      account = await opts.resolveToken(args.assistant_token);
      if (!account) return toolError("El token de asistente no es válido, ha caducado o se ha revocado. Consigue otro con request_login_code y verify_login_code.");
    }
    if (!account) return toolError(opts.needAuthText(ctx));
  }
  try {
    const r = await tool.run(args, { ...ctx, account, token: ctx.token || (account ? args.assistant_token : null) });
    return toolResult(r.text, r.data);
  } catch (e) {
    const known = opts.errorText(e, ctx);
    if (known) return toolError(known.text, known.data);
    console.error("MCP herramienta", tool.name, e);
    return toolError("Algo ha fallado en el servidor. Prueba otra vez en un momento.");
  }
}
