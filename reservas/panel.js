// NOVA Studio · panel del equipo (agenda, cobros, caja, progreso y ajustes).
// Va aparte de app.js: solo lo descarga quien entra en #equipo. Comparte con
// app.js el ámbito global (funciones, estado y utilidades), así que aquí se usan
// directamente sin importar nada. Se carga una sola vez con loadPanel().

let agendaTimer = 0,
  agendaQuiet = false;
// ── Equipo ─────────────────────────────────────────────────────────────────
const canManage = (providerId) => !!staff && (staff.owner || staff.id === providerId);

const monthLabel = (key) => cap(dayDate(key + "-01").toLocaleDateString("es-ES", { month: "long", year: "numeric" }));

const shortDate = (iso) => fmtDay(iso, { day: "numeric", month: "short" });

function staffLogin() {
  let last = staffHint?.id || "";
  try {
    last = staffHint?.id || localStorage.getItem("nova_staff_who") || "";
  } catch {}
  show(
    back("home", "Inicio") +
      heading("Acceso equipo", staffHint ? `Hola, ${esc(first(staffHint.name))}. Pon tu clave una vez: este móvil se queda con la sesión iniciada.` : "Elige quién eres y pon tu clave. Solo hace falta la primera vez en cada móvil.") +
      `<form id="staff"><div class="who" role="radiogroup" aria-label="Quién eres">${catalog.providers
        .map(
          (p) =>
            `<label class="who-item"><input type="radio" name="provider" value="${esc(p.id)}" ${p.id === last ? "checked" : ""}>${face(p, "who-face")}<span>${esc(first(p.name))}</span></label>`,
        )
        .join("")}<label class="who-item who-caja"><input type="radio" name="provider" value="caja" ${last === "caja" ? "checked" : ""}><span class="who-face" aria-hidden="true">${svg(ICONS.till)}</span><span><strong>Caja</strong><small>La tablet del mostrador: solo para cobrar. Entra con la clave de cualquiera del equipo.</small></span></label></div>
      <label for="s-pin" id="s-pin-l">${last === "caja" ? "Clave de cualquiera del equipo" : "Tu clave"}</label><input id="s-pin" name="pin" type="password" inputmode="numeric" required autocomplete="current-password">
      <button class="btn wide" style="margin-top:16px" type="submit">Entrar</button></form>`,
  );
  $$("#staff [name=provider]").forEach((i) => (i.onchange = () => ($("#s-pin-l").textContent = i.value === "caja" ? "Clave de cualquiera del equipo" : "Tu clave")));
  onForm("staff", async (d) => {
    if (!d.provider) throw Error("Elige quién eres.");
    await api("staff/login", { provider: d.provider, pin: d.pin });
    try {
      localStorage.setItem("nova_staff_who", d.provider);
    } catch {}
    await refreshMe();
    nav();
    render();
  });
}

// Menú del panel. Arriba, solo lo de todos los días: Agenda, Cobrar y Caja.
// Lo demás va en «Más», agrupado por temas y con una línea que explica cada
// apartado (antes eran 12 pestañas que ocupaban media pantalla).
const staffMoreGroups = () =>
  [
    [
      "Tu negocio",
      [
        ["progreso", "Progreso", "Ingresos, ocupación y horas flojas", ICONS.bolt],
        staff.owner && ["ganancias", "Cuánto gana Nova", "Ingresos, gastos y beneficio neto del mes", ICONS.till],
        staff.owner && ["socios", "Socios NOVA+", "Membresías de pago: socios, cortes y cuota mensual", ICONS.gem || ICONS.users],
        staff.owner && ["avisos", "Avisos y reseñas", "Clientes dormidos, peticiones de reseña de Google e historial de envíos", ICONS.bolt],
        staff.owner && ["clientes", "Clientes", "A quién le toca volver y quién se ha perdido", ICONS.users],
        ["faltas", "Faltas", "Quien no vino o canceló tarde, y si se cobra", ICONS.clock],
      ],
    ],
    staff.owner && [
      "Lo que ofreces",
      [
        ["servicios", "Servicios", "Precios, duración y quién hace cada uno", ICONS.scissors],
        ["productos", "Productos", "Lo que se vende en el mostrador", ICONS.jar],
        ["ropa", "Ropa", "Prendas, tallas y unidades de " + (catalog.shop?.name || "la tienda"), ICONS.shirt],
        ["formacion", "Formación", "Interesados en los cursos", ICONS.megaphone],
      ],
    ],
    staff.owner && [
      "Configuración",
      [
        ["ajustes", "Equipo y normas", "Horarios, claves, comisiones, cancelaciones y correos", ICONS.lock],
        ["web", "Web", "Aviso, contacto, fotos y color de la web", ICONS.camera],
      ],
    ],
  ]
    .filter(Boolean)
    .map(([title, items]) => [title, items.filter(Boolean)]);

function staffTop(tab) {
  if (staff.caja)
    return (
      `<div class="staff-top"><span class="who-face" aria-hidden="true">${svg(ICONS.till)}</span><div><p class="eyebrow">NOVA Studio</p><h1>Caja</h1></div></div>` +
      `<div class="tabs" role="navigation" aria-label="Caja">${[
        ["cobrar", "#equipo", "Cobrar"],
        ["agenda", "#equipo/agenda", "Agenda"],
      ]
        .map(([k, href, label]) => `<a href="${href}" class="${k === tab ? "active" : ""}" ${k === tab ? 'aria-current="page"' : ""}>${label}</a>`)
        .join("")}</div>`
    );
  const main = [
    ["agenda", "#equipo", "Agenda"],
    ["cobrar", "#equipo/cobrar", "Cobrar"],
    ["caja", "#equipo/caja", staff.owner ? "Caja" : "Mi caja"],
    ["mas", "#equipo/mas", "Más"],
  ];
  // Dentro de un apartado de «Más», la pestaña «Más» queda marcada y debajo se dice dónde estás.
  const inside = main.some(([k]) => k === tab) ? null : staffMoreGroups().flatMap(([, items]) => items).find(([k]) => k === tab);
  const on = inside ? "mas" : tab;
  return (
    `<div class="staff-top">${face(provById(staff.id), "who-face")}<div><p class="eyebrow">${staff.owner ? "Propietario" : "Panel de barbero"}</p><h1>Hola, ${esc(first(staff.name))}</h1></div></div>` +
    `<div class="tabs" role="navigation" aria-label="Panel">${main.map(([k, href, label]) => `<a href="${href}" class="${k === on ? "active" : ""}" ${k === on ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</div>` +
    (inside ? `<a class="more-back" href="#equipo/mas"><span aria-hidden="true">←</span> Más <i aria-hidden="true">/</i> <b>${esc(inside[1])}</b></a>` : "")
  );
}

// «Más»: el resto del panel, por temas.
async function staffMore() {
  show(
    staffTop("mas") +
      staffMoreGroups()
        .map(
          ([title, items]) =>
            `<p class="section-label">${esc(title)}</p><div class="more-list">${items
              .map(([k, name, desc, icon]) => `<a class="more-item" href="#equipo/${k}"><span class="more-ic" aria-hidden="true">${svg(icon)}</span><span><strong>${esc(name)}</strong><small>${esc(desc)}</small></span><b aria-hidden="true">›</b></a>`)
              .join("")}</div>`,
        )
        .join("") +
      `<button type="button" class="btn wide secondary" style="margin-top:28px" id="staff-out">Salir del panel</button>`,
  );
  $("#staff-out").onclick = async () => {
    await api("staff/logout", {});
    staff = null;
    nav();
    go("home");
  };
}

// ── Agenda: lista, día, semana y mes, con un color por barbero ─────────────
// Como en Google Calendar: cada barbero tiene su color (lo elige el dueño en
// «Equipo y normas») y con la leyenda se enseñan u ocultan sus citas.
const AG_COLORS = {
  azul: ["Azul", "#2f62c9", "#e1e9f8"],
  rojo: ["Rojo", "#c8423a", "#f8e1df"],
  verde: ["Verde", "#2a8a59", "#dcefe4"],
  morado: ["Morado", "#7d4cc0", "#ece3f7"],
  naranja: ["Naranja", "#cf7612", "#f9ead6"],
  rosa: ["Rosa", "#c93f78", "#f8e0ea"],
  turquesa: ["Turquesa", "#1b8c97", "#d8eef0"],
  grafito: ["Grafito", "#4f535a", "#e4e5e7"],
};
const AG_DEFAULT = { airam: "azul", ehedey: "rojo", noa: "verde" };
let agTeam = []; // el equipo que trae la última agenda (con su color)
function agColorKey(id) {
  const p = agTeam.find((x) => x.id === id) || provById(id);
  if (p?.color && AG_COLORS[p.color]) return p.color;
  if (AG_DEFAULT[id]) return AG_DEFAULT[id];
  // Sin color elegido: el primero que no use nadie, por orden de llegada al equipo.
  const all = (agTeam.length ? agTeam : catalog?.providers || []).map((x) => x.id);
  const taken = new Set(all.map((x) => (agTeam.find((y) => y.id === x) || provById(x))?.color || AG_DEFAULT[x]).filter(Boolean));
  const keys = Object.keys(AG_COLORS),
    free = keys.filter((k) => !taken.has(k)),
    pool = free.length ? free : keys;
  const i = Math.max(0, all.filter((x) => !AG_DEFAULT[x] && !(agTeam.find((y) => y.id === x) || provById(x))?.color).indexOf(id));
  return pool[i % pool.length];
}
const agVars = (id) => {
  const [, c, t] = AG_COLORS[agColorKey(id)];
  return `--c:${c};--t:${t}`;
};

const AG_VIEWS = [
  ["list", "Lista"],
  ["day", "Día"],
  ["week", "Semana"],
  ["month", "Mes"],
];
function agView() {
  let v = "";
  try {
    v = localStorage.getItem("nova_ag_view") || "";
  } catch {}
  return AG_VIEWS.some(([k]) => k === v) ? v : staff.caja ? "day" : "list";
}
// A quién se ve. Un barbero, de primeras, solo a sí mismo (y los demás, sin importes).
function agHidden(ids) {
  try {
    const v = JSON.parse(localStorage.getItem("nova_ag_hide_" + staff.id));
    if (Array.isArray(v)) return new Set(v);
  } catch {}
  return new Set(staff.owner || staff.caja ? [] : ids.filter((id) => id !== staff.id));
}
function agSaveHidden(set) {
  try {
    localStorage.setItem("nova_ag_hide_" + staff.id, JSON.stringify([...set]));
  } catch {}
}
const agMonday = (iso) => {
  const d = dayDate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
};
const agAdd = (iso, n) => {
  const d = dayDate(iso);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
function agRange(view, day) {
  if (view === "week") return [agMonday(day), agAdd(agMonday(day), 6)];
  const first1 = day.slice(0, 8) + "01",
    from = agMonday(first1),
    last = isoDay(new Date(dayDate(first1).getFullYear(), dayDate(first1).getMonth() + 1, 0));
  return [from, agAdd(agMonday(last), 6)];
}
function agTitle(view, day) {
  if (view === "list" || view === "day") return longDay(day);
  if (view === "month") return monthLabel(day.slice(0, 7));
  const [a, z] = agRange("week", day);
  const sameMonth = a.slice(0, 7) === z.slice(0, 7);
  return `${sameMonth ? dayDate(a).getDate() : shortDate(a)} – ${shortDate(z)} ${z.slice(0, 4)}`;
}
// Un día de la vista de semana o mes con la forma de «staff/day» (para apuntar una cita ahí).
const agDayOf = (r, date) =>
  r.providers.length && r.providers[0].days
    ? { date, now: r.now, providers: r.providers.map((p) => ({ id: p.id, name: p.name, color: p.color, hours: p.days[date]?.hours || [], off: p.days[date]?.off ? { note: p.days[date].off === true ? "" : p.days[date].off } : null })), bookings: r.bookings.filter((b) => b.date === date) }
    : r;

// Estado de una cita para pintarla: ya pasó, en curso…
function agWhen(b, r) {
  const today = r.now.slice(0, 10),
    nowM = hm(r.now.slice(11));
  if (b.date < today) return "past";
  if (b.date > today) return "";
  return hm(b.end) <= nowM ? "past" : hm(b.start) <= nowM ? "now" : "";
}
const agMark = (b) => (b.kind === "block" ? "" : b.pay ? "✓ " : b.attendance === "done" ? "✓ " : b.attendance === "absent" ? "✗ " : "");

// Citas que se solapan, una al lado de otra (como en Google Calendar).
function agLanes(evts) {
  const out = [];
  let group = [],
    ends = [],
    groupEnd = -1;
  const flush = () => {
    group.forEach((x) => (x.n = ends.length));
    out.push(...group);
    (group = []), (ends = []), (groupEnd = -1);
  };
  for (const x of [...evts].sort((a, b) => a.s - b.s || b.e - a.e)) {
    if (group.length && x.s >= groupEnd) flush();
    let lane = ends.findIndex((end) => end <= x.s);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = x.e;
    x.lane = lane;
    group.push(x);
    groupEnd = Math.max(groupEnd, x.e);
  }
  if (group.length) flush();
  return out;
}

// Rejilla de horas: `cols` son los barberos (día) o los días (semana).
function agGrid(cols, r, compact) {
  const today = r.now.slice(0, 10),
    nowM = hm(r.now.slice(11));
  let a = Infinity,
    z = -Infinity;
  for (const c of cols) {
    for (const [x, y] of c.open) (a = Math.min(a, hm(x))), (z = Math.max(z, hm(y)));
    for (const b of c.events) (a = Math.min(a, hm(b.start))), (z = Math.max(z, hm(b.end)));
  }
  if (!Number.isFinite(a)) (a = 10 * 60), (z = 20 * 60);
  a = Math.floor(a / 60) * 60;
  z = Math.max(a + 60, Math.ceil(z / 60) * 60);
  const H = (m) => `calc(var(--hh) * ${(m - a) / 60})`;
  const hours = [];
  for (let m = a + 60; m < z; m += 60) hours.push(`<span style="top:${H(m)}">${addMin("00:00", m)}</span>`);
  const col = (c) => {
    // Lo que queda fuera del horario se ve rayado, como cerrado.
    const open = c.open.map(([x, y]) => [hm(x), hm(y)]).sort((p, q) => p[0] - q[0]);
    const closed = [];
    let t = a;
    for (const [x, y] of open) {
      if (x > t) closed.push([t, Math.min(x, z)]);
      t = Math.max(t, y);
    }
    if (t < z) closed.push([t, z]);
    const shade = closed.map(([x, y]) => `<i class="ag-closed" style="top:${H(x)};height:calc(var(--hh) * ${(y - x) / 60})"></i>`).join("");
    const evs = agLanes(c.events.map((b) => ({ b, s: hm(b.start), e: Math.max(hm(b.end), hm(b.start) + 15) })))
      .map(({ b, s, e, lane, n }) => {
        const w = agWhen(b, r),
          tall = e - s >= 45;
        return `<button type="button" class="ag-ev${b.kind === "block" ? " block" : ""}${w ? " " + w : ""}${b.attendance === "absent" ? " absent" : ""}" data-id="${esc(b.id)}" style="${agVars(b.provider.id)};top:calc(${H(s)} + 1px);height:calc(var(--hh) * ${(e - s) / 60} - 2px);left:calc(${(lane / n) * 100}% + 1px);width:calc(${100 / n}% - 3px)" title="${esc(`${b.start}–${b.end} · ${b.kind === "block" ? b.service.name : b.name + " · " + b.service.name} · ${first(b.provider.name)}`)}">
            <b>${esc(agMark(b))}${b.kind === "block" ? esc(b.service.name || "Bloqueado") : esc(compact ? first(b.name) : b.name)}</b>${compact && !tall ? "" : `<span>${esc(b.start)}${tall ? "–" + esc(b.end) : ""}${b.kind === "block" || compact ? "" : " · " + esc(b.service.name)}</span>`}
          </button>`;
      })
      .join("");
    const now = c.date === today && nowM >= a && nowM <= z ? `<i class="ag-nowline" style="top:${H(nowM)}"></i>` : "";
    return `<div class="ag-cc${c.off ? " off" : ""}" data-date="${c.date}" data-p="${esc(c.pid || "")}" data-a="${a}" data-z="${z}">${shade}${c.off ? `<em class="ag-offtag">${esc(c.off)}</em>` : ""}${evs}${now}</div>`;
  };
  return `<div class="ag-cal${compact ? " compact" : ""}" style="--n:${cols.length}">
    <div class="ag-ch-row"><span></span>${cols.map((c) => `<div class="ag-ch${c.date === today && compact ? " today" : ""}" ${c.headAttr || ""}>${c.head}</div>`).join("")}</div>
    <div class="ag-body" style="height:calc(var(--hh) * ${(z - a) / 60})"><div class="ag-hours">${hours.join("")}</div>${cols.map(col).join("")}</div>
  </div>`;
}

function agDayView(r, shown) {
  if (!shown.length) return `<p class="ag-free">Elige arriba a quién quieres ver.</p>`;
  return agGrid(
    shown.map((p) => {
      const events = r.bookings.filter((b) => b.provider.id === p.id && b.status === "confirmed");
      const n = events.filter((b) => b.kind === "booking").length;
      return {
        date: r.date,
        pid: p.id,
        open: p.hours,
        off: "",
        events,
        head: `<span class="ag-chp" style="${agVars(p.id)}">${face(provById(p.id) || p, "who-face")}<span><b>${esc(p.id === staff.id ? "Tú" : first(p.name))}</b><small>${p.off ? "De vacaciones · " : !p.hours.length ? "No trabaja · " : ""}${n} ${n === 1 ? "cita" : "citas"}</small></span></span>`,
      };
    }),
    r,
    false,
  );
}

function agWeekView(r, shown) {
  const ids = new Set(shown.map((p) => p.id));
  const [from] = agRange("week", staffDay);
  const days = Array.from({ length: 7 }, (_, i) => agAdd(from, i));
  return agGrid(
    days.map((d) => {
      const team = r.providers.filter((p) => ids.has(p.id));
      const working = team.filter((p) => !p.days[d]?.off && p.days[d]?.hours.length);
      return {
        date: d,
        pid: "",
        open: working.flatMap((p) => p.days[d].hours),
        off: team.length && !working.length ? (team.every((p) => p.days[d]?.off) ? "Vacaciones" : "Cerrado") : "",
        events: r.bookings.filter((b) => b.date === d && ids.has(b.provider.id)),
        head: `<small>${esc(fmtDay(d, { weekday: "short" }))}</small><b>${dayDate(d).getDate()}</b>`,
        headAttr: `data-goday="${d}" role="button" tabindex="0" aria-label="${esc(longDay(d))}"`,
      };
    }),
    r,
    true,
  );
}

function agMonthView(r, shown) {
  const ids = new Set(shown.map((p) => p.id)),
    today = r.now.slice(0, 10),
    month = staffDay.slice(0, 7);
  const days = [];
  for (let d = r.from; d <= r.to; d = agAdd(d, 1)) days.push(d);
  const names = Array.from({ length: 7 }, (_, i) => fmtDay(agAdd(r.from, i), { weekday: "short" }));
  return `<div class="ag-month"><div class="ag-mh">${names.map((n) => `<span>${esc(n)}</span>`).join("")}</div><div class="ag-mgrid">${days
    .map((d) => {
      const list = r.bookings.filter((b) => b.date === d && b.kind === "booking" && ids.has(b.provider.id));
      const max = 3;
      return `<button type="button" class="ag-mc${d.slice(0, 7) !== month ? " out" : ""}${d === today ? " today" : ""}${d < today ? " gone" : ""}" data-goday="${d}" aria-label="${esc(longDay(d))}: ${list.length} ${list.length === 1 ? "cita" : "citas"}">
        <span class="ag-md">${dayDate(d).getDate()}</span>
        ${list
          .slice(0, max)
          .map((b) => `<span class="ag-mev${agWhen(b, r) === "past" ? " past" : ""}" style="${agVars(b.provider.id)}"><i>${esc(b.start)}</i> ${esc(first(b.name))}</span>`)
          .join("")}${list.length > max ? `<small>+${list.length - max} más</small>` : ""}
      </button>`;
    })
    .join("")}</div></div>`;
}

// La lista de siempre: una columna por barbero, con los huecos libres.
function agListView(r, shown) {
  const isToday = r.date === r.now.slice(0, 10),
    nowM = hm(r.now.slice(11));
  const whenOf = (b, next) => (!isToday || b.status !== "confirmed" ? "" : hm(b.end) <= nowM ? "past" : hm(b.start) <= nowM ? "now" : b === next ? "next" : "");
  const tagOf = (b, w) => (w === "now" ? ` <em class="ag-tag">Ahora</em>` : w === "next" ? ` <em class="ag-tag soft">${hm(b.start) - nowM <= 90 ? `En ${hm(b.start) - nowM} min` : "Siguiente"}</em>` : "");
  // Huecos libres de media hora o más dentro del horario: se ven de un vistazo
  // y con un toque se apunta una cita justo ahí.
  const gapsOf = (p, list) => {
    if (!canManage(p.id) || p.off || r.date < r.now.slice(0, 10)) return [];
    const busy = list
      .filter((b) => b.status === "confirmed")
      .map((b) => [hm(b.start), hm(b.end)])
      .sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [a, z] of p.hours) {
      let t = Math.max(hm(a), isToday ? Math.ceil(nowM / 15) * 15 : 0);
      for (const [x, y] of busy) {
        if (y <= t) continue;
        if (x >= hm(z)) break;
        if (x - t >= 30) out.push([t, x]);
        t = Math.max(t, y);
      }
      if (hm(z) - t >= 30) out.push([t, hm(z)]);
    }
    return out;
  };
  if (!shown.length) return `<p class="ag-free">Elige arriba a quién quieres ver.</p>`;
  return shown
    .map((p) => {
      const list = r.bookings.filter((b) => b.provider.id === p.id);
      const live = list.filter((b) => b.status === "confirmed" && b.kind === "booking");
      const total = live.reduce((a, b) => a + (b.service.price || 0), 0);
      const mine = canManage(p.id);
      const next = live.find((b) => hm(b.start) > nowM);
      const rows = [
        ...list.map((b) => {
          const w = b.kind === "booking" ? whenOf(b, next) : whenOf(b) === "past" ? "past" : "";
          return {
            t: hm(b.start),
            html: `<button type="button" class="ag-item ${b.kind === "block" ? "block" : ""} ${b.status === "canceled" ? "canceled" : ""} ${b.attendance} ${w}" data-id="${esc(b.id)}">
                    <time>${esc(b.start)}<small>${esc(b.end)}</small></time>
                    <div><strong>${b.kind === "block" ? "⛔ " + esc(b.service.name) : esc(b.name)}${b.strikes ? ` <em class="strike" title="Ha faltado ${b.strikes} ${b.strikes === 1 ? "vez" : "veces"}">⚠ ${b.strikes}</em>` : ""}${tagOf(b, w)}</strong><span>${b.kind === "block" ? "Bloqueado" : esc(b.service.name) + (b.phone ? " · " + esc(b.phone) : "")}</span></div>
                    <span>${b.status === "canceled" ? (b.late ? "Cancelada tarde" : "Cancelada") : b.pay ? "✓ Cobrado" : b.attendance === "done" ? "✓ Vino" : b.attendance === "absent" ? "✗ No vino" : b.by === "staff" ? "Equipo" : "App"}</span>
                  </button>`,
          };
        }),
        ...gapsOf(p, list).map(([a, z]) => ({
          t: a,
          html: `<button type="button" class="ag-gap" data-p="${esc(p.id)}" data-h="${addMin("00:00", a)}"><span aria-hidden="true">＋</span><b>${addMin("00:00", a)} – ${addMin("00:00", z)}</b> libre</button>`,
        })),
      ].sort((a, b) => a.t - b.t);
      return `<section class="ag-col${mine || staff.caja ? "" : " ag-other"}" style="${agVars(p.id)}"><div class="ag-head"><h2><i class="ag-sw" aria-hidden="true"></i>${p.id === staff.id ? "Tu agenda" : esc(p.name)}</h2><span>${p.off ? `De vacaciones${p.off.note ? " · " + esc(p.off.note) : ""}` : p.hours.length ? p.hours.map((h) => h.join("–")).join(" · ") : "No trabaja"} · ${live.length} ${live.length === 1 ? "cita" : "citas"}${mine ? " · " + euro(total) : ""}</span></div>
        ${rows.length ? rows.map((x) => x.html).join("") : `<p class="ag-free">Sin citas este día.</p>`}</section>`;
    })
    .join("");
}

// La caja ve quién viene y lo cobra; nada de teléfonos ni de cambiar citas.
function cajaBookingSheet(b, r) {
  if (!b) return;
  const today = b.date === r.now.slice(0, 10);
  const canPay = today && b.kind === "booking" && b.status === "confirmed" && !b.pay && b.attendance !== "absent";
  const state = b.kind === "block" ? "Hora bloqueada" : b.pay ? `✓ Cobrado · ${euro(b.pay.amount)}` : b.attendance === "done" ? "✓ Vino" : b.attendance === "absent" ? "✗ No vino" : agWhen(b, r) === "now" ? "Ahora en la silla" : agWhen(b, r) === "past" ? "Sin cobrar" : "Pendiente";
  const sh = sheet(
    `<p class="eyebrow">${esc(longDay(b.date))} · ${esc(b.start)}–${esc(b.end)}</p><h2>${b.kind === "block" ? esc(b.service.name || "Bloqueado") : esc(b.name)}</h2>
    <div class="card"><dl class="detail-list">${b.kind === "block" ? "" : `<div><dt>Servicio</dt><dd>${esc(b.service.name)} · ${euro(b.service.price)}</dd></div>`}<div><dt>Barbero</dt><dd><span class="ag-chp" style="${agVars(b.provider.id)}"><i class="ag-sw" aria-hidden="true"></i>${esc(b.provider.name)}</span></dd></div><div><dt>Estado</dt><dd>${esc(state)}</dd></div></dl></div>` +
      (canPay ? `<button type="button" class="btn wide" id="cj-pay">Cobrar en caja</button>` : ""),
  );
  const pay = sh.el.querySelector("#cj-pay");
  if (pay) pay.onclick = () => (sh.close(), (cobroPre = b.id), go("equipo"));
}

async function staffAgenda() {
  if (!staffDay) staffDay = isoDay(salonDate());
  const view = agView(),
    hashAt = location.hash,
    grid = view === "week" || view === "month";
  const [from, to] = grid ? agRange(view, staffDay) : [staffDay, staffDay];
  const [r, rd] = await Promise.all([
    api(grid ? `staff/range?from=${from}&to=${to}` : "staff/day?date=" + staffDay),
    staff.caja ? { pending: [] } : api("staff/redemptions").catch(() => ({ pending: [] })),
  ]);
  agTeam = r.providers;
  const today = salonDate(),
    todayIso = isoDay(today);
  // Primero la columna propia; luego el resto del equipo.
  const providers = [...r.providers].sort((a, b) => (b.id === staff.id) - (a.id === staff.id));
  const hidden = agHidden(providers.map((p) => p.id));
  const shown = providers.filter((p) => !hidden.has(p.id));

  const canjes = rd.pending.length
    ? `<section class="ag-col"><div class="ag-head"><h2>Premios por entregar</h2><span>${rd.pending.length}</span></div>${rd.pending
        .map(
          (x) => `<div class="ag-item rd-item"><time>${esc(x.id)}</time><div><strong>${esc(x.reward.name)}</strong><span>${esc(x.name || x.email)} · ${nf(x.reward.cost)} pts</span></div><span class="seg"><button type="button" class="small" data-rd="${esc(x.id)}" data-st="done">Entregado</button></span></div>`,
        )
        .join("")}</section>`
    : "";
  let strip = "";
  if (!grid)
    for (let i = -3; i < 21; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i),
        iso = isoDay(d);
      strip += `<button type="button" class="day-chip${iso === staffDay ? " active" : ""}" data-day="${iso}"><small>${esc(fmtDay(iso, { weekday: "short" }))}</small>${d.getDate()}</button>`;
    }
  const isNow = view === "month" ? staffDay.slice(0, 7) === todayIso.slice(0, 7) : view === "week" ? agMonday(staffDay) === agMonday(todayIso) : staffDay === todayIso;
  // En semana y mes: cuántas citas se ven (y el dinero, solo el de lo que lleva cada uno).
  let sum = "";
  if (grid) {
    const ids = new Set(shown.map((p) => p.id));
    const list = r.bookings.filter((b) => b.kind === "booking" && ids.has(b.provider.id) && (view === "week" || b.date.slice(0, 7) === staffDay.slice(0, 7)));
    const money_ = staff.caja ? 0 : list.filter((b) => canManage(b.provider.id)).reduce((a, b) => a + (b.service.price || 0), 0);
    sum = `<p class="ag-sum">${list.length} ${list.length === 1 ? "cita" : "citas"} ${view === "week" ? "esta semana" : "este mes"}${money_ ? ` · ${euro(money_)}${staff.owner ? "" : " tuyos"}` : ""}</p>`;
  }
  const bar =
    `<div class="ag-bar"><div class="ag-views" role="group" aria-label="Vista">${AG_VIEWS.map(([k, label]) => `<button type="button" data-view="${k}" class="${k === view ? "on" : ""}" aria-pressed="${k === view}">${label}</button>`).join("")}</div>
      <div class="ag-nav"><button type="button" class="btn secondary ag-today" ${isNow ? "disabled" : ""}>Hoy</button><button type="button" class="cal-nav" data-step="-1" aria-label="Anterior">‹</button><button type="button" class="cal-nav" data-step="1" aria-label="Siguiente">›</button><strong class="ag-title">${esc(agTitle(view, staffDay))}</strong></div></div>` +
    (providers.length > 1
      ? `<div class="ag-legend" role="group" aria-label="A quién ver">${providers
          .map((p) => `<button type="button" class="ag-lg${hidden.has(p.id) ? " off" : ""}" data-lg="${esc(p.id)}" style="${agVars(p.id)}" aria-pressed="${!hidden.has(p.id)}"><i aria-hidden="true"></i>${esc(p.id === staff.id ? "Tú" : first(p.name))}</button>`)
          .join("")}</div>`
      : "");
  const body = view === "day" ? agDayView(r, shown) : view === "week" ? agWeekView(r, shown) : view === "month" ? agMonthView(r, shown) : agListView(r, shown);
  show(
    staffTop("agenda") +
      (r.alerts || []).map((a) => `<p class="warning">${esc(a)}</p>`).join("") +
      `<div class="ag-wrap${view === "list" ? "" : " ag-wide"}">` +
      bar +
      (strip ? `<div class="day-strip" id="strip">${strip}</div>` : "") +
      (staff.caja ? "" : `<div class="staff-bar"><button type="button" class="btn" id="new-bk">+ Cita</button><button type="button" class="btn secondary" id="new-block">Bloquear hora</button><button type="button" class="btn secondary" id="new-off">Vacaciones</button></div>`) +
      sum +
      (view === "list" ? canjes : "") +
      body +
      (view === "list" ? "" : canjes) +
      `</div>` +
      (staff.caja
        ? ""
        : `<button type="button" class="btn wide secondary" style="margin-top:28px" id="staff-set">${svg(ICONS.cal)} Avisos y calendario</button>` +
          `<button type="button" class="btn wide secondary" style="margin-top:10px" id="staff-out">Salir del panel</button>`),
  );
  if (!agendaQuiet) $("#strip .active")?.scrollIntoView({ inline: "center", block: "nearest" });
  agendaQuiet = false;
  clearTimeout(agendaTimer);
  agendaTimer = setTimeout(function tick() {
    if (!staff || location.hash !== hashAt) return; // ya no está en la agenda
    if (document.hidden || $(".sheet-back")) return void (agendaTimer = setTimeout(tick, 15000)); // con una ficha abierta, espera
    agendaQuiet = true;
    render();
  }, 60000);

  // Vista, días y leyenda.
  $$("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        try {
          localStorage.setItem("nova_ag_view", b.dataset.view);
        } catch {}
        render();
      }),
  );
  $(".ag-today").onclick = () => ((staffDay = todayIso), render());
  $$(".ag-nav [data-step]").forEach(
    (b) =>
      (b.onclick = () => {
        const n = Number(b.dataset.step);
        if (view === "month") {
          const d = dayDate(staffDay.slice(0, 8) + "01");
          d.setMonth(d.getMonth() + n);
          staffDay = isoDay(d).slice(0, 7) === todayIso.slice(0, 7) ? todayIso : isoDay(d);
        } else staffDay = agAdd(staffDay, view === "week" ? 7 * n : n);
        render();
      }),
  );
  $$(".day-chip").forEach((b) => (b.onclick = () => ((staffDay = b.dataset.day), render())));
  $$("[data-goday]").forEach((el) => {
    const open = () => {
      staffDay = el.dataset.goday;
      try {
        localStorage.setItem("nova_ag_view", "day");
      } catch {}
      render();
    };
    el.onclick = open;
    el.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open());
  });
  $$("[data-lg]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.lg;
        hidden.has(id) ? hidden.delete(id) : hidden.add(id);
        agSaveHidden(hidden);
        agendaQuiet = true;
        render();
      }),
  );

  // Citas: la ficha de siempre (o la de la caja).
  const openBk = (id) => {
    const b = r.bookings.find((x) => x.id === id);
    staff.caja ? cajaBookingSheet(b, r) : staffSheet(b);
  };
  $$(".ag-item[data-id], .ag-ev[data-id]").forEach((el) => (el.onclick = (e) => (e.stopPropagation(), openBk(el.dataset.id))));
  $$(".ag-gap").forEach((g) => (g.onclick = () => staffNew(false, r, { provider: g.dataset.p, start: g.dataset.h })));
  // Tocar un hueco vacío de la rejilla apunta una cita a esa hora.
  if (!staff.caja)
    $$(".ag-cc").forEach(
      (c) =>
        (c.onclick = (e) => {
          if (e.target.closest(".ag-ev")) return;
          const date = c.dataset.date,
            pid = c.dataset.p || (shown.length === 1 && canManage(shown[0].id) ? shown[0].id : staff.id);
          if (!canManage(pid) || date < todayIso) return;
          const a = Number(c.dataset.a),
            z = Number(c.dataset.z),
            y = e.clientY - c.getBoundingClientRect().top;
          const m = Math.min(z - 15, a + Math.floor(((y / c.offsetHeight) * (z - a)) / 15) * 15);
          staffDay = date;
          staffNew(false, agDayOf(r, date), { provider: pid, start: addMin("00:00", m) });
        }),
    );
  $$("[data-rd]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await api("staff/redemptions/" + b.dataset.rd, { status: b.dataset.st });
          toast("Premio entregado.");
          render();
        } catch (e) {
          b.disabled = false;
          toast(e.message);
        }
      }),
  );
  if (staff.caja) return;
  $("#new-bk").onclick = () => staffNew(false, agDayOf(r, staffDay));
  $("#new-block").onclick = () => staffNew(true, agDayOf(r, staffDay));
  $("#new-off").onclick = () => offSheet();
  $("#staff-set").onclick = () => staffSettings();
  $("#staff-out").onclick = async () => {
    await api("staff/logout", {});
    staff = null;
    nav();
    go("home");
  };
}

// ── Equipo: caja ───────────────────────────────────────────────────────────
function cajaStats(p, word = "este mes") {
  const withComm = staff.owner && !p.owner;
  const rows = p.rows
    .map(
      (x) =>
        `<li><time>${esc(shortDate(x.date))}<small>${esc(x.start)}</small></time><span><strong>${esc(x.name)}</strong>${esc(x.service)}${x.included ? " · incluido en membresía" : x.pay ? ` · ${esc(methodName(x.method))}` : " · sin cobro apuntado"}</span><b>${euro(x.price)}${withComm ? `<small>${String(x.pct).replace(".", ",")} % ${x.included ? `de ${euro(x.base)} ` : ""}· ${euro(x.commission)}</small>` : ""}</b></li>`,
    )
    .join("");
  return (
    `<div class="stat3 money"><div><strong>${p.services}</strong><span>Servicios</span></div><div><strong>${euro(p.billed)}</strong><span>Facturado</span></div><div><strong>${euro(p.average)}</strong><span>Ticket medio</span></div></div>` +
    `<p class="caja-meta">${p.upcoming ? `Quedan ${p.upcoming} ${p.upcoming === 1 ? "cita" : "citas"} ${esc(word)} (${euro(p.expected)})` : `No quedan citas ${esc(word)}`} · ${p.absent} no ${p.absent === 1 ? "vino" : "vinieron"} · ${p.canceled} ${p.canceled === 1 ? "cancelada" : "canceladas"}${p.penalties ? ` · ${euro(p.penalties)} cobrados por faltas` : ""}</p>` +
    (p.collected
      ? `<p class="caja-meta">Cobrado en caja: <b>${euro(p.collected)}</b> (${(catalog.payMethods || [])
          .filter((m) => p.methods?.[m.id])
          .map((m) => `${esc(m.name.toLowerCase())} ${euro(p.methods[m.id])}`)
          .join(" · ")})</p>`
      : "") +
    (p.unpaid ? `<p class="caja-meta">${p.unpaid} ${p.unpaid === 1 ? "cita hecha" : "citas hechas"} sin cobro apuntado: cuentan con el precio del servicio.</p>` : "") +
    (p.byService.length
      ? `<div class="card caja-svc"><dl class="detail-list">${p.byService.map((x) => `<div><dt>${esc(x.name)} <small>× ${x.count}</small></dt><dd>${euro(x.total)}</dd></div>`).join("")}</dl></div>`
      : "") +
    (p.rows.length
      ? `<details class="caja-more"><summary>Ver ${p.rows.length === 1 ? "el servicio" : `los ${p.rows.length} servicios`}</summary><ul class="caja-rows">${rows}</ul></details>`
      : `<p class="ag-free">No hay servicios hechos ${esc(word)}.</p>`)
  );
}

// Periodo de la caja: un día, una semana (de lunes a domingo), un mes, un año
// o las fechas que se quiera. El mes usa `staffMonth`, igual que «Faltas».
let cajaMode = "mes",
  cajaRef = "",
  cajaFrom = "",
  cajaTo = "";
const CAJA_MODES = [
  ["dia", "Día"],
  ["semana", "Semana"],
  ["mes", "Mes"],
  ["ano", "Año"],
  ["fechas", "Fechas"],
];
const isoAdd = (iso, n) => {
  const d = dayDate(iso);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
const lastDayOf = (month) => isoAdd(shiftMonth(month, 1) + "-01", -1);
const dateTxt = (iso) => fmtDay(iso, { day: "numeric", month: "short", ...(iso.slice(0, 4) !== isoDay(salonDate()).slice(0, 4) ? { year: "numeric" } : {}) });

function cajaRange() {
  const today = isoDay(salonDate());
  const ref = cajaRef || today;
  if (cajaMode === "dia") return { from: ref, to: ref, label: longDay(ref) + (ref.slice(0, 4) !== today.slice(0, 4) ? " de " + ref.slice(0, 4) : ""), word: ref === today ? "hoy" : "ese día" };
  if (cajaMode === "semana") {
    const from = isoAdd(ref, -((dayDate(ref).getDay() + 6) % 7));
    const to = isoAdd(from, 6);
    return { from, to, label: `Semana del ${dateTxt(from)} al ${dateTxt(to)}`, word: from <= today && today <= to ? "esta semana" : "esa semana" };
  }
  if (cajaMode === "ano") {
    const y = ref.slice(0, 4);
    return { from: y + "-01-01", to: y + "-12-31", label: "Año " + y, word: y === today.slice(0, 4) ? "este año" : "ese año", byMonth: true };
  }
  if (cajaMode === "fechas") {
    const from = cajaFrom || isoAdd(today, -29);
    const to = cajaTo && cajaTo >= from ? cajaTo : from > today ? from : today;
    return { from, to, label: `Del ${dateTxt(from)} al ${dateTxt(to)}`, word: "en estas fechas", byMonth: from < isoAdd(to, -92) };
  }
  const m = staffMonth || today.slice(0, 7);
  return { from: m + "-01", to: lastDayOf(m), month: m, label: monthLabel(m), word: m === today.slice(0, 7) ? "este mes" : "ese mes" };
}
// Mueve el periodo uno hacia atrás o hacia delante.
function cajaStep(n) {
  const today = isoDay(salonDate());
  const ref = cajaRef || today;
  if (cajaMode === "mes") staffMonth = shiftMonth(staffMonth || today.slice(0, 7), n);
  else if (cajaMode === "dia") cajaRef = isoAdd(ref, n);
  else if (cajaMode === "semana") cajaRef = isoAdd(ref, 7 * n);
  else if (cajaMode === "ano") cajaRef = String(Number(ref.slice(0, 4)) + n) + ref.slice(4);
}

// Día a día (o mes a mes en un año): servicios, facturado y, para el dueño,
// lo que le queda a él (sus servicios + la comisión de los demás).
function cajaBreakdown(people, range, owner) {
  const g = {};
  for (const p of people)
    for (const x of p.rows) {
      const k = range.byMonth ? x.date.slice(0, 7) : x.date;
      const o = (g[k] ||= { services: 0, billed: 0, mine: 0 });
      o.services++;
      o.billed += x.price;
      o.mine += p.owner ? x.price : x.commission || 0;
    }
  const keys = Object.keys(g).sort().reverse();
  if (keys.length < 2) return "";
  const r2 = (n) => Math.round(n * 100) / 100;
  const max = Math.max(...keys.map((k) => g[k].billed));
  return `<details class="caja-more" open><summary>${range.byMonth ? "Mes a mes" : "Día a día"}</summary><table class="pg-table caja-days"><thead><tr><th>${range.byMonth ? "Mes" : "Día"}</th><th>Servicios</th><th>Facturado</th>${owner ? "<th>Para ti</th>" : ""}</tr></thead><tbody>${keys
    .map((k) => {
      const o = g[k];
      return `<tr><td>${esc(range.byMonth ? monthLabel(k) : shortDay(k))}<i class="caja-bar" style="width:${((100 * o.billed) / (max || 1)).toFixed(1)}%"></i></td><td>${o.services}</td><td>${euro(r2(o.billed))}</td>${owner ? `<td>${euro(r2(o.mine))}</td>` : ""}</tr>`;
    })
    .join("")}</tbody></table></details>`;
}

async function staffCaja() {
  const range = cajaRange();
  const r = await api("staff/summary?" + (range.month ? "month=" + range.month : `from=${range.from}&to=${range.to}`));
  const today = isoDay(salonDate());
  const tooFar = range.from > isoAdd(today, 60);
  const modes = `<div class="pg-chips caja-modes" role="radiogroup" aria-label="Periodo">${CAJA_MODES.map(([id, name]) => `<button type="button" role="radio" aria-checked="${cajaMode === id}" class="${cajaMode === id ? "on" : ""}" data-mode="${id}">${name}</button>`).join("")}</div>`;
  const nav =
    cajaMode === "fechas"
      ? `<form id="caja-dates" class="card caja-dates"><label>Desde<input type="date" name="from" value="${esc(range.from)}" required></label><label>Hasta<input type="date" name="to" value="${esc(range.to)}" required></label><button class="btn" type="submit">Ver</button></form>`
      : `<div class="month-nav"><button type="button" class="cal-nav" data-m="-1" aria-label="Anterior">‹</button><strong>${esc(range.label)}</strong><button type="button" class="cal-nav" data-m="1" aria-label="Siguiente" ${tooFar ? "disabled" : ""}>›</button></div>` +
        (range.from <= today && today <= range.to ? "" : `<button type="button" class="caja-today" id="caja-today">Volver a ${cajaMode === "dia" ? "hoy" : cajaMode === "semana" ? "esta semana" : cajaMode === "ano" ? "este año" : "este mes"}</button>`);
  const me = r.people.find((p) => p.id === staff.id);
  let body;
  if (!r.owner) {
    body = `<p class="section-label">Lo tuyo · ${esc(range.label.toLowerCase())}</p>` + cajaStats(me, range.word) + cajaBreakdown([me], range, false);
  } else {
    const t = r.totals;
    const team = r.people.filter((p) => !p.owner);
    body =
      `<div class="club-card caja-hero"><span class="club-tag">TUS INGRESOS · ${esc(range.label.toUpperCase())}</span><p class="caja-big">${euro(t.income)}</p>
        <ul class="caja-split"><li><span>Tus servicios</span><b>${euro(t.own)}</b></li><li><span>Comisiones del equipo</span><b>${euro(t.commissions)}</b></li><li><span>Facturación de todo el salón</span><b>${euro(t.salon)}</b></li></ul>
        ${r.month ? (t.pendingCommissions ? `<p>Te quedan por cobrar ${euro(t.pendingCommissions)} de comisiones.</p>` : t.commissions ? `<p>Comisiones del mes cobradas.</p>` : "") : ""}</div>` +
      cajaBreakdown(r.people, range, true) +
      `<p class="section-label">Equipo</p>` +
      team
        .map(
          (p) => `<div class="card worker">
            <div class="worker-head">${face(provById(p.id), "who-face")}<div><strong>${esc(p.name)}</strong><span>${p.services} ${p.services === 1 ? "servicio" : "servicios"} · ${euro(p.billed)} facturado</span></div></div>
            <div class="comm-box"><div><span>Comisión</span><strong>${String(p.pct).replace(".", ",")} %</strong></div><div><span>Te toca</span><strong>${euro(p.commission)}</strong></div><div><span>Le queda</span><strong>${euro(Math.round((p.billed - p.commission) * 100) / 100)}</strong></div></div>
            ${p.includedCuts ? `<p class="caja-meta">Incluye ${p.includedCuts} ${p.includedCuts === 1 ? "corte incluido" : "cortes incluidos"} en la membresía NOVA+ (${euro(p.includedCommission)} de comisión, sobre su precio normal).</p>` : ""}
            ${p.expectedCommission ? `<p class="caja-meta">Con las citas que quedan ${esc(range.word)}: +${euro(p.expectedCommission)} de comisión.</p>` : ""}
            <div class="seg"><button type="button" class="secondary" data-pct="${esc(p.id)}">Cambiar %</button>${r.month ? `<button type="button" class="${p.paid ? "paid" : "secondary"}" data-paid="${esc(p.id)}">${p.paid ? "✓ Cobrado" : "Marcar como cobrado"}</button>` : ""}</div>
            ${r.month && p.paid ? `<p class="caja-meta">Cobrado el ${esc(shortDate(p.paid.slice(0, 10)))}. Pulsa otra vez para desmarcarlo.</p>` : ""}
            <details class="caja-more"><summary>Ver el detalle de ${esc(first(p.name))}</summary>${cajaStats(p, range.word)}</details>
          </div>`,
        )
        .join("") +
      (r.month ? "" : `<p class="caja-meta">Para marcar una comisión como cobrada, mira el mes entero.</p>`) +
      `<p class="section-label">Tus servicios</p>` +
      cajaStats(me, range.word);
  }
  show(staffTop("caja") + modes + nav + body);
  $$("[data-mode]").forEach((b) => (b.onclick = () => ((cajaMode = b.dataset.mode), render())));
  $$(".month-nav [data-m]").forEach((b) => (b.onclick = () => (cajaStep(Number(b.dataset.m)), render())));
  const back = $("#caja-today");
  if (back) back.onclick = () => ((cajaRef = ""), (staffMonth = today.slice(0, 7)), render());
  const df = $("#caja-dates");
  if (df)
    df.onsubmit = (e) => {
      e.preventDefault();
      const [a, b] = [df.from.value, df.to.value];
      if (!a || !b) return;
      [cajaFrom, cajaTo] = a <= b ? [a, b] : [b, a];
      if (cajaTo >= isoAdd(cajaFrom, 731)) return toast("Elige como mucho dos años.");
      render();
    };
  $$("[data-pct]").forEach((b) => (b.onclick = () => pctSheet(r.people.find((p) => p.id === b.dataset.pct), r.from.slice(0, 7))));
  $$("[data-paid]").forEach(
    (b) =>
      (b.onclick = async () => {
        const p = r.people.find((x) => x.id === b.dataset.paid);
        b.disabled = true;
        try {
          await api("staff/commission/paid", { provider: p.id, month: r.month, paid: !p.paid });
          toast(p.paid ? "Desmarcado." : `Comisión de ${first(p.name)} cobrada.`);
          render();
        } catch (e) {
          b.disabled = false;
          toast(e.message);
        }
      }),
  );
}

function pctSheet(p, month) {
  const label = monthLabel(month);

  const sh = sheet(
    `<p class="eyebrow">Comisión</p><h2>${esc(p.name)}</h2>
    <p class="muted">Lo que te quedas de cada servicio que hace ${esc(first(p.name))}. Se aplica desde ${esc(label.toLowerCase())} en adelante; los meses anteriores no cambian.</p>
    <form id="pct"><label for="pct-in">Porcentaje</label><div class="pct-field"><input id="pct-in" name="pct" type="number" min="0" max="100" step="0.5" inputmode="decimal" required value="${esc(p.pct)}"><span>%</span></div>
    <button class="btn wide" style="margin-top:18px" type="submit">Guardar</button></form>`,
  );
  sh.el.querySelector("#pct").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await api("staff/commission", { provider: p.id, pct: e.target.pct.value, month });
      sh.close();
      toast("Comisión guardada.");
      render();
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
}

// ── Cuánto gana Nova (solo el dueño) ───────────────────────────────────────
// Ingresos del mes (del servidor), gastos editables y beneficio neto. El
// beneficio se recalcula aquí, al momento, mientras se escribe; el botón
// «Guardar gastos» manda los gastos del mes al servidor.
let earnMonth = "";
const eNum = (v) => {
  const n = Number(String(v ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const eR2 = (n) => Math.round(n * 100) / 100;
const eNumTxt = (n) => (n ? String(n).replace(".", ",") : "");
const eSigned = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + euro(Math.abs(n));
const eCmp = (d, unit = "€") => {
  if (!d || (!d.diff && d.pct == null)) return `<em class="pg-delta">= igual</em>`;
  const cls = d.diff > 0 ? "up" : d.diff < 0 ? "down" : "";
  return `<em class="pg-delta ${cls}">${d.diff > 0 ? "▲" : d.diff < 0 ? "▼" : "="} ${eSigned(d.diff)}${d.pct == null ? "" : ` (${d.pct > 0 ? "+" : d.pct < 0 ? "−" : ""}${String(Math.abs(d.pct)).replace(".", ",")} %)`}</em>`;
};

async function staffEarnings() {
  const q$ = (sel, root = document) => root.querySelector(sel),
    qa = (sel, root = document) => [...root.querySelectorAll(sel)];
  if (!staff.owner) return show(staffTop("ganancias") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Atlantic/Canary" }).slice(0, 7);
  if (!earnMonth) earnMonth = today;
  const r = await api("staff/earnings?month=" + earnMonth);
  const c = r.current;
  const x = r.expenses;
  const step = (n) => {
    const [y, m] = r.month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  };
  const money = (name, value, label, attrs = "") =>
    `<div class="en-row"><label for="en-${esc(name)}">${esc(label)}</label><div class="en-in"><input id="en-${esc(name)}" data-en="${esc(name)}" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(eNumTxt(value))}" ${attrs}><span>€</span></div></div>`;
  const extraRow = (e = { name: "", amount: 0 }) =>
    `<div class="en-extra"><input data-en-xname maxlength="40" placeholder="Concepto" aria-label="Nombre del concepto" value="${esc(e.name)}"><div class="en-in"><input data-en-xamt inputmode="decimal" placeholder="0" aria-label="Importe" value="${esc(eNumTxt(e.amount))}"><span>€</span></div><button type="button" class="en-del" data-en-del aria-label="Quitar concepto">×</button></div>`;
  const [ty, tm] = today.split("-").map(Number);
  const maxMonth = new Date(Date.UTC(ty, tm - 1 + 12, 1)).toISOString().slice(0, 7);
  const barbers = c.byBarber.length
    ? `<table class="pg-table"><thead><tr><th class="en-l">Barbero</th><th>Servicios</th><th>Facturado</th><th>Ocupación</th></tr></thead><tbody>${c.byBarber
        .map((b) => `<tr><td class="en-l">${esc(first(b.name))}</td><td>${b.services}</td><td>${euro(b.billed)}</td><td>${b.occupancy == null ? "—" : pctTxt(b.occupancy)}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="ag-free">Todavía no hay servicios este mes.</p>`;
  const dorm = c.dormant;

  show(
    staffTop("ganancias") +
      `<div class="month-nav"><button type="button" class="cal-nav" data-em="-1" aria-label="Mes anterior">‹</button><label class="en-month"><span class="sr-only">Mes</span><input type="month" id="en-month" value="${esc(r.month)}" max="${esc(maxMonth)}"></label><button type="button" class="cal-nav" data-em="1" aria-label="Mes siguiente">›</button></div>
      <div class="club-card caja-hero pg-hero" aria-live="polite"><span class="club-tag">${esc(monthLabel(r.month).toUpperCase())} · BENEFICIO NETO</span>
        <h2 id="en-net-big"></h2>
        <p id="en-net-sub"></p>
        <p class="en-vs">Mes anterior (${esc(monthLabel(r.prevMonth))}): <b id="en-prev-net"></b> <span id="en-net-cmp"></span></p></div>

      <p class="section-label">Ingresos</p>
      <div class="stat3 money pg-tiles"><div><strong>${euro(c.income.total)}</strong><span>Ingresos</span>${eCmp(r.compare.income)}</div><div><strong>${c.services}</strong><span>Servicios</span>${progDelta(c.services, r.previous.services)}</div><div><strong>${euro(c.ticket)}</strong><span>Ticket medio</span>${progDelta(c.ticket, r.previous.ticket)}</div></div>
      <ul class="caja-rows en-lines">
        <li><span>Servicios (cobrados y completados; los cortes incluidos en membresía no suman aquí)</span><b>${euro(c.income.services)}</b></li>
        ${c.income.other.map((o) => `<li><span>Otros ingresos · ${esc(o.label)}${o.count ? ` (${o.count})` : ""}${o.demo ? " · demo" : ""}</span><b>${euro(o.amount)}</b></li>`).join("") || `<li><span>Otros ingresos (ropa, productos…)</span><b>${euro(0)}</b></li>`}
        <li class="en-sum"><span>Total</span><b>${euro(c.income.total)}</b></li>
      </ul>
      ${r.included && r.included.cuts ? `<p class="caja-meta en-incl">Cortes incluidos en la membresía NOVA+ este mes: <b>${r.included.cuts}</b>. Su ingreso es la cuota (no se cuenta dos veces), pero los barberos cobran comisión por su precio normal (${euro(r.included.base)}): <b>${euro(r.included.commission)}</b> de comisión.</p>` : ""}
      <div class="comm-box"><div><span>Ocupación</span><strong>${c.occupancy == null ? "—" : pctTxt(c.occupancy)}</strong>${r.previous.occupancy == null || c.occupancy == null ? "" : progDelta(c.occupancy, r.previous.occupancy, "pp")}</div><div><span>Clientes nuevos</span><strong>${c.clients.new}</strong></div><div><span>Recurrentes</span><strong>${c.clients.returning}</strong></div></div>
      ${c.clients.unknown ? `<p class="caja-meta">${c.clients.unknown} ${c.clients.unknown === 1 ? "servicio sin correo (no cuenta como nuevo ni recurrente)" : "servicios sin correo (no cuentan como nuevos ni recurrentes)"}.</p>` : ""}
      <p class="section-label">Por barbero</p>${barbers}
      <p class="caja-meta">Ocupación: minutos con cita entre los minutos del horario de cada barbero en el mes (sin horas bloqueadas ni «No vino»).</p>

      <p class="section-label">Clientes dormidos</p>
      <p class="caja-meta">Llevan ${dorm.weeks || 6} semanas o más sin venir y no tienen cita: <b>${dorm.count}</b>. ${dorm.count ? `<a href="#equipo/clientes">Verlos en Clientes</a>` : ""}</p>
      ${dorm.list.length ? `<ul class="caja-rows en-lines">${dorm.list.slice(0, 5).map((d) => `<li><span>${esc(d.name)}</span><b>hace ${Math.round(d.since / 7)} sem.</b></li>`).join("")}</ul>` : ""}

      <p class="section-label">Gastos de ${esc(monthLabel(r.month))}</p>
      <p class="caja-meta">${r.inherited ? `Este mes no tiene gastos guardados: son los de ${esc(monthLabel(r.inheritedFrom))}. Cámbialos y pulsa «Guardar gastos».` : x && Object.values(x.fixed).some(Boolean) ? "Gastos guardados de este mes." : "Aún no has apuntado gastos. Los que guardes se copian a los meses siguientes."}</p>
      <form id="en-form" class="en-form" novalidate autocomplete="off">
        <div class="card en-card">${r.fixedLabels.map(([k, label]) => money("f-" + k, x.fixed[k], label, `data-en-fixed="${esc(k)}"`)).join("")}</div>
        ${
          r.workers.length
            ? `<p class="section-label">Equipo</p><div class="card en-card">${r.workers
                .map(
                  (w) => `<div class="en-person"><strong>${esc(first(w.name))}</strong><small>Facturado: ${euro(w.billed)}${w.inclBase ? ` · cortes incluidos (precio normal): ${euro(w.inclBase)}` : ""}</small>
                  ${money("s-" + w.id, x.salaries[w.id], "Sueldo fijo", `data-en-sal="${esc(w.id)}"`)}
                  <div class="en-row"><label for="en-p-${esc(w.id)}">Comisión por servicio</label><div class="en-in"><input id="en-p-${esc(w.id)}" data-en-pct="${esc(w.id)}" data-def="${w.defaultPct}" inputmode="decimal" value="${esc(eNumTxt(r.net.commissions.find((k) => k.id === w.id)?.pct ?? w.defaultPct))}"><span>%</span></div></div>
                  <p class="en-comm">Comisión: <b data-en-commamt="${esc(w.id)}"></b></p></div>`,
                )
                .join("")}</div>`
            : `<p class="caja-meta">No hay barberos con comisión en el equipo.</p>`
        }
        <p class="section-label">Otros conceptos</p>
        <div id="en-extras" class="card en-card">${x.extras.map(extraRow).join("")}</div>
        <button type="button" class="btn secondary wide" id="en-add">+ Añadir concepto</button>

        <ul class="caja-rows en-lines en-total">
          <li><span>Ingresos</span><b id="en-t-inc"></b></li>
          <li><span>Gastos fijos (incluye sueldos y conceptos)</span><b id="en-t-cost"></b></li>
          <li><span>Comisiones</span><b id="en-t-comm"></b></li>
          <li class="en-sum"><span>Beneficio neto</span><b id="en-t-net"></b></li>
          <li><span>Margen</span><b id="en-t-margin"></b></li>
        </ul>
        <button class="btn wide" type="submit" id="en-save">Guardar gastos</button>
        <p class="caja-meta">Beneficio neto = ingresos − gastos fijos − comisiones. Se calcula al escribir; no se guarda hasta pulsar el botón. La comisión usa lo facturado por cada barbero; si la cambias aquí, solo vale para este análisis (no cambia el % del equipo).</p>
      </form>`,
  );

  const form = q$("#en-form");
  const val = (el) => eNum(el.value);
  const readBody = () => ({
    month: r.month,
    fixed: Object.fromEntries(qa("[data-en-fixed]", form).map((i) => [i.dataset.enFixed, i.value])),
    salaries: Object.fromEntries(qa("[data-en-sal]", form).map((i) => [i.dataset.enSal, i.value])),
    pct: Object.fromEntries(qa("[data-en-pct]", form).map((i) => [i.dataset.enPct, i.value])),
    extras: qa(".en-extra", form).map((row) => ({ name: q$("[data-en-xname]", row).value, amount: q$("[data-en-xamt]", row).value })),
  });
  const recalc = () => {
    const fixed = qa("[data-en-fixed]", form).reduce((a, i) => a + val(i), 0);
    const sal = qa("[data-en-sal]", form).reduce((a, i) => a + val(i), 0);
    const ext = qa("[data-en-xamt]", form).reduce((a, i) => a + val(i), 0);
    let comm = 0;
    for (const w of r.workers) {
      const pct = Math.min(100, val(q$(`[data-en-pct="${CSS.escape(w.id)}"]`, form)));
      const amt = eR2(((w.billed + (w.inclBase || 0)) * pct) / 100);
      comm += amt;
      q$(`[data-en-commamt="${CSS.escape(w.id)}"]`, form).textContent = euro(amt);
    }
    const costs = eR2(fixed + sal + ext);
    comm = eR2(comm);
    const net = eR2(c.income.total - costs - comm);
    const margin = c.income.total > 0 ? Math.round((net / c.income.total) * 1000) / 10 : null;
    const big = q$("#en-net-big");
    big.textContent = (net < 0 ? "−" : "") + euro(Math.abs(net));
    q$("#en-net-sub").textContent = margin == null ? "Sin ingresos este mes: no hay margen que calcular." : `Margen ${String(margin).replace(".", ",")} % de ${euro(c.income.total)} de ingresos`;
    q$("#en-prev-net").textContent = (r.previous.net < 0 ? "−" : "") + euro(Math.abs(r.previous.net));
    q$("#en-net-cmp").innerHTML = eCmp({ diff: eR2(net - r.previous.net), pct: r.previous.net ? Math.round(((net - r.previous.net) / Math.abs(r.previous.net)) * 1000) / 10 : null });
    q$("#en-t-inc").textContent = euro(c.income.total);
    q$("#en-t-cost").textContent = "− " + euro(costs);
    q$("#en-t-comm").textContent = "− " + euro(comm);
    q$("#en-t-net").textContent = (net < 0 ? "−" : "") + euro(Math.abs(net));
    q$("#en-t-margin").textContent = margin == null ? "—" : String(margin).replace(".", ",") + " %";
    q$("#en-net-big").className = net < 0 ? "en-neg" : "";
    q$("#en-t-net").className = net < 0 ? "en-neg" : "";
  };
  form.addEventListener("input", recalc);
  recalc();

  q$("#en-add").onclick = () => {
    if (qa(".en-extra", form).length >= 30) return toast("Como mucho 30 conceptos.");
    q$("#en-extras").insertAdjacentHTML("beforeend", extraRow());
    qa("[data-en-xname]", form).at(-1).focus();
  };
  form.addEventListener("click", (e) => {
    const del = e.target.closest("[data-en-del]");
    if (!del) return;
    del.closest(".en-extra").remove();
    recalc();
  });
  onForm("en-form", async () => {
    await api("staff/expenses", readBody());
    toast("Gastos guardados.");
    await staffEarnings();
  });
  qa("[data-em]").forEach((b) => (b.onclick = () => ((earnMonth = step(Number(b.dataset.em))), staffEarnings())));
  q$("#en-month").onchange = (e) => {
    if (/^\d{4}-\d{2}$/.test(e.target.value)) (earnMonth = e.target.value), staffEarnings();
  };
}

// ── Socios NOVA+ (solo el dueño) ───────────────────────────────────────────
// La membresía de pago (distinta del Club de puntos): lista de socios con su
// plan, estado, cortes y renovación, el ingreso mensual recurrente (MRR) y los
// planes, que se editan aquí. Un plan editado solo vale para altas nuevas: los
// socios que ya están conservan lo que contrataron.
const memStatus = (m) =>
  m.status === "active" ? (m.cancelAtPeriodEnd ? [`Baja programada`, "churn"] : ["Activa", "active"]) : m.status === "past_due" ? ["Impagada", "past_due"] : m.status === "canceled" ? ["Cancelada", "canceled"] : ["Sin completar", "incomplete"];
async function staffMembers() {
  if (!staff.owner) return show(staffTop("socios") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const r = await api("staff/membership");
  const nf0 = (n) => String(n).replace(".", ",");
  const planForm = (p, i) => `<div class="mem-plan-edit" data-plan="${i}">
      <input type="hidden" data-f="id" value="${esc(p.id || "")}">
      <div class="mem-grid"><div><label>Nombre</label><input data-f="name" maxlength="40" value="${esc(p.name || "")}" required></div>
      <div><label>Precio (€/mes)</label><input data-f="price" inputmode="decimal" value="${esc(nf0(p.price ?? ""))}" required></div>
      <div><label>Cortes al mes</label><input data-f="cuts" inputmode="numeric" value="${esc(p.cuts ?? 0)}"></div>
      <div><label>Días vista (0 = los normales)</label><input data-f="daysAhead" inputmode="numeric" value="${esc(p.daysAhead ?? 0)}"></div>
      <div><label>Descuento en el resto (%)</label><input data-f="discountPct" inputmode="decimal" value="${esc(nf0(p.discountPct ?? 0))}"></div></div>
      <label>Servicios que cubre</label><div class="mem-svcs">${r.services.map((s) => `<label><input type="checkbox" data-svc="${esc(s.id)}" ${(p.services || []).includes(s.id) ? "checked" : ""}> ${esc(s.name)}</label>`).join("")}</div>
      <label>Descripción corta</label><input data-f="desc" maxlength="140" value="${esc(p.desc || "")}">
      <label class="check"><input type="checkbox" data-f="active" ${p.active === false ? "" : "checked"}><span>Se puede contratar<small>Desactívalo para que nadie nuevo lo contrate (los socios actuales siguen).</small></span></label>
    </div>`;
  const rows = r.members.length
    ? `<table class="pg-table"><thead><tr><th>Socio</th><th>Estado</th><th>Cortes</th><th>Renueva</th></tr></thead><tbody>${r.members
        .map((m) => {
          const [st, cls] = memStatus(m);
          return `<tr><td class="en-l"><b>${esc(m.name || m.email.split("@")[0])}</b><br><small>${esc(m.plan?.name || "")} · ${euro(m.plan?.price || 0)} · alta ${esc(m.since ? shortDate(m.since) : "—")}${m.demo ? " · demo" : ""}</small></td><td><span class="mem-st ${cls}">${st}</span></td><td>${m.live ? `${m.used}/${m.cuts}<br><small>quedan ${m.left}</small>` : "—"}</td><td>${m.live ? esc(shortDate(m.renews)) : "—"}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : `<p class="ag-free">Todavía no hay socios.</p>`;
  show(
    staffTop("socios") +
      `<div class="stat3 money pg-tiles"><div><strong>${euro(r.mrr)}</strong><span>MRR (al mes)</span></div><div><strong>${r.counts.active}</strong><span>Socios activos</span></div><div><strong>${euro(r.month.revenue)}</strong><span>Cuotas de ${esc(monthLabel(r.month.id))}</span></div></div>
      <p class="caja-meta">MRR = suma de las cuotas de los socios activos. ${r.counts.churning ? `${r.counts.churning} con baja programada (siguen hasta fin de periodo). ` : ""}${r.counts.pastDue ? `${r.counts.pastDue} con la cuota impagada (no cuentan ni tienen ventajas). ` : ""}${r.counts.canceled ? `${r.counts.canceled} de baja. ` : ""}Las cuotas cobradas salen en «Cuánto gana Nova» como línea propia, y los cortes incluidos no se cuentan otra vez.${r.demo ? " <b>Modo demo:</b> sin Stripe, las altas y las cuotas son simuladas." : ""}</p>
      <p class="section-label">Socios</p>${rows}
      <p class="section-label">Planes</p>
      <p class="caja-meta">Los cambios valen para quien se haga socio desde ahora; los socios de antes mantienen su plan y su precio.</p>
      <form id="mem-form" class="card mem-admin" novalidate autocomplete="off"><div id="mem-plans">${r.plans.map(planForm).join("")}</div>
        <button type="button" class="btn secondary wide" id="mem-add">+ Añadir plan</button>
        <button class="btn wide" style="margin-top:12px" type="submit">Guardar planes</button></form>`,
  );
  const wrap = document.getElementById("mem-plans");
  document.getElementById("mem-add").onclick = () => {
    wrap.insertAdjacentHTML("beforeend", planForm({ name: "", price: "", cuts: 1, services: [], daysAhead: 0, discountPct: 0, active: true }, wrap.children.length));
  };
  onForm("mem-form", async () => {
    const plans = [...wrap.querySelectorAll("[data-plan]")].map((el) => {
      const g = (k) => el.querySelector(`[data-f=${k}]`);
      return {
        id: g("id").value,
        name: g("name").value,
        price: g("price").value,
        cuts: Number(g("cuts").value || 0),
        daysAhead: Number(g("daysAhead").value || 0),
        discountPct: g("discountPct").value,
        desc: g("desc").value,
        active: g("active").checked,
        services: [...el.querySelectorAll("[data-svc]:checked")].map((c) => c.dataset.svc),
      };
    });
    await api("staff/membership/plans", { plans });
    toast("Planes guardados.");
    await staffMembers();
  });
}

// ── Equipo: progreso (ganancias y ocupación) ──────────────────────────────
// Para ver si el salón va a más. Cada barbero ve solo lo suyo; el dueño ve el
// salón entero y puede mirar a cada uno. Ocupación = horas con cita entre las
// horas de su horario (sin contar las bloqueadas).
let progPick = "all",
  progMonths = 12;

const WD_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const WD_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const pctTxt = (n) => `${Math.round(n)} %`;

const occOf = (x) => (x.cap ? (100 * x.booked) / x.cap : 0);

const hoursTxt = (min) => {
  const h = Math.round(min / 30) / 2;
  return `${String(h).replace(".", ",")} h`;
};

function progSum(map, ids) {
  const out = { billed: 0, services: 0, clients: 0, booked: 0, cap: 0, comm: 0 };
  for (const id of ids) for (const k in out) out[k] += map?.[id]?.[k] || 0;
  out.billed = Math.round(out.billed * 100) / 100;
  out.comm = Math.round(out.comm * 100) / 100;
  return out;
}

// «+12 %» / «−3 puntos» frente a lo de antes, con flecha y texto (nunca solo color).
function progDelta(now, before, unit = "%") {
  if (unit === "pp") {
    const d = Math.round(now - before);
    if (!before && !now) return "";
    return `<em class="pg-delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "▲ +" : d < 0 ? "▼ −" : "= "}${Math.abs(d)} ${Math.abs(d) === 1 ? "punto" : "puntos"}</em>`;
  }
  if (!before) return now ? `<em class="pg-delta up">nuevo</em>` : "";
  const d = Math.round((100 * (now - before)) / before);
  return `<em class="pg-delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "▲ +" : d < 0 ? "▼ −" : "= "}${Math.abs(d)} %</em>`;
}

// Barras verticales en SVG: una por mes. El mes en curso va con lo hecho en
// negro y lo ya reservado en rayado encima. Valor en la barra más alta y en la
// última; el resto, al tocar.
function progBars(rows, { fmt, max, extra }) {
  const W = 340,
    H = 168,
    top = 22,
    bottom = 24,
    left = 2,
    plotH = H - top - bottom;
  const n = rows.length;
  const slot = (W - left) / n;
  const bw = Math.min(26, slot * 0.62);
  const peak = max ?? Math.max(1, ...rows.map((r) => r.value + (r.extra || 0)));
  const y = (v) => top + plotH - (plotH * Math.max(0, v)) / peak;
  const best = rows.reduce((a, r, i) => (r.value > rows[a].value ? i : a), 0);
  const bar = (x, y0, y1, cls) => {
    const h = y1 - y0;
    if (h <= 0.5) return "";
    const r = Math.min(4, h, bw / 2);
    return `<path class="${cls}" d="M${x} ${y1}V${y0 + r}Q${x} ${y0} ${x + r} ${y0}H${x + bw - r}Q${x + bw} ${y0} ${x + bw} ${y0 + r}V${y1}Z"/>`;
  };
  const grid = [0.5, 1]
    .map((f) => `<line class="pg-grid" x1="0" x2="${W}" y1="${y(peak * f)}" y2="${y(peak * f)}"/>${max ? `<text class="pg-axis" x="${W}" y="${y(peak * f) - 4}" text-anchor="end">${fmt(peak * f)}</text>` : ""}`)
    .join("");
  const marks = rows
    .map((r, i) => {
      const x = left + slot * i + (slot - bw) / 2;
      const base = top + plotH;
      const solid = bar(x, y(r.value), base, "pg-bar");
      const more = r.extra ? bar(x, y(r.value + r.extra), y(r.value), "pg-bar-ahead") : "";
      const label = i === best || i === n - 1 ? `<text class="pg-val" x="${x + bw / 2}" y="${y(r.value + (r.extra || 0)) - 6}" text-anchor="middle">${fmt(r.value)}</text>` : "";
      return `<g class="pg-hit" tabindex="0" data-tip="${esc(r.tip)}"><rect x="${left + slot * i}" y="0" width="${slot}" height="${H}" fill="transparent"/>${solid}${more}${label}<text class="pg-axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(r.label)}</text></g>`;
    })
    .join("");
  return `<div class="pg-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(extra)}"><defs><pattern id="pg-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--bg)"/><line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink)" stroke-width="1.6"/></pattern></defs>${grid}<line class="pg-base" x1="0" x2="${W}" y1="${top + plotH}" y2="${top + plotH}"/>${marks}</svg><div class="pg-tip" hidden></div></div>`;
}

// Mapa de horas: días que abre × horas. Más oscuro = más ocupado.
function progHeat(heat, ids) {
  const cells = {};
  for (const id of ids)
    for (const [k, [b, c]] of Object.entries(heat?.[id] || {})) {
      const x = (cells[k] ||= [0, 0]);
      x[0] += b;
      x[1] += c;
    }
  const keys = Object.keys(cells).filter((k) => cells[k][1] > 0);
  if (!keys.length) return { html: "", low: [] };
  const days = [...new Set(keys.map((k) => Number(k.split("-")[0])))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const hours = [...new Set(keys.map((k) => Number(k.split("-")[1])))].sort((a, b) => a - b);
  const html = `<div class="pg-heat" style="--cols:${hours.length}">
    <span></span>${hours.map((h) => `<span class="pg-hh">${h}</span>`).join("")}
    ${days
      .map(
        (d) =>
          `<span class="pg-hd">${WD_SHORT[d]}</span>` +
          hours
            .map((h) => {
              const c = cells[d + "-" + h];
              if (!c || !c[1]) return `<i class="pg-cell off"></i>`;
              const o = c[0] / c[1];
              const lvl = Math.min(5, Math.floor(o * 5 + 0.0001));
              return `<i class="pg-cell l${lvl}" tabindex="0" data-tip="${esc(`${cap(WD_LONG[d])} de ${h} a ${h + 1} h: ${pctTxt(o * 100)} ocupado`)}"></i>`;
            })
            .join(""),
      )
      .join("")}</div>
    <div class="pg-scale" aria-hidden="true"><span>Libre</span>${[0, 1, 2, 3, 4].map((l) => `<i class="pg-cell l${l}"></i>`).join("")}<span>Lleno</span></div>`;
  // Las franjas más flojas (al menos unas horas de horario en esos meses).
  const big = Math.max(...keys.map((k) => cells[k][1]));
  const low = keys
    .filter((k) => cells[k][1] >= big * 0.5)
    .map((k) => ({ d: Number(k.split("-")[0]), h: Number(k.split("-")[1]), o: cells[k][0] / cells[k][1] }))
    .sort((a, b) => a.o - b.o)
    .slice(0, 3);
  return { html, low };
}

async function staffProgress() {
  const r = await api("staff/progress?months=" + progMonths);
  const ids0 = r.people.map((p) => p.id);
  if (!r.owner || (progPick !== "all" && !ids0.includes(progPick))) progPick = r.owner ? "all" : staff.id;
  const ids = progPick === "all" ? ids0 : [progPick];
  const who = progPick === "all" ? "el salón" : first(r.people.find((p) => p.id === progPick)?.name);
  const cur = r.months.at(-1);
  const prevMonth = r.months.at(-2);
  const mtd = progSum(cur.people, ids);
  const before = progSum(r.prevToDate, ids);
  const rest = progSum(r.restOfMonth, ids);
  const ahead = progSum(r.ahead, ids);
  const curLabel = monthLabel(cur.month).split(" ")[0];
  const prevLabel = monthLabel(prevMonth.month).split(" ")[0].toLowerCase();
  const avg = (x) => (x.services ? x.billed / x.services : 0);
  const shortM = (m) => fmtDay(m + "-01", { month: "short" });
  // El dueño, mirándose a sí mismo: sus ganancias llevan también las comisiones del equipo.
  const boss = r.owner && r.people.find((p) => p.id === progPick)?.owner;
  const gain = (x) => Math.round((x.billed + (boss ? x.comm : 0)) * 100) / 100;

  const filters =
    `<div class="pg-filters">` +
    (r.owner && r.people.length > 1
      ? `<div class="pg-chips" role="radiogroup" aria-label="De quién">${[{ id: "all", name: "Salón" }, ...r.people]
          .map((p) => `<button type="button" role="radio" aria-checked="${progPick === p.id}" class="${progPick === p.id ? "on" : ""}" data-pick="${esc(p.id)}">${esc(first(p.name))}</button>`)
          .join("")}</div>`
      : "") +
    `<div class="pg-chips pg-range" role="radiogroup" aria-label="Meses">${[6, 12]
      .map((n) => `<button type="button" role="radio" aria-checked="${progMonths === n}" class="${progMonths === n ? "on" : ""}" data-months="${n}">${n} meses</button>`)
      .join("")}</div></div>`;

  const hero = `<div class="club-card caja-hero pg-hero"><span class="club-tag">${esc(progPick === "all" && r.owner ? "EL SALÓN" : progPick === staff.id ? "TÚ" : first(r.people.find((p) => p.id === progPick)?.name).toUpperCase())} · LO QUE VA DE ${esc(curLabel.toUpperCase())}</span>
    <p class="caja-big">${euro(gain(mtd))}</p>
    <p class="pg-vs">${progDelta(gain(mtd), gain(before))} <span>frente a ${euro(gain(before))} a estas alturas de ${esc(prevLabel)}</span></p>
    ${boss ? `<ul class="caja-split"><li><span>Tus servicios</span><b>${euro(mtd.billed)}</b></li><li><span>Comisiones del equipo</span><b>${euro(mtd.comm)}</b></li></ul>` : ""}
    ${rest.billed ? `<ul class="caja-split"><li><span>Ya reservado para lo que queda de mes</span><b>${euro(gain(rest))}</b></li><li><span>Si se cumple, el mes cierra en</span><b>${euro(Math.round((gain(mtd) + gain(rest)) * 100) / 100)}</b></li></ul>` : ""}</div>`;

  const tiles = `<div class="stat3 money pg-tiles">
    <div><strong>${pctTxt(occOf(mtd))}</strong><span>Ocupación</span>${progDelta(occOf(mtd), occOf(before), "pp")}</div>
    <div><strong>${mtd.services}</strong><span>Servicios</span>${progDelta(mtd.services, before.services)}</div>
    <div><strong>${euro(Math.round(avg(mtd) * 100) / 100)}</strong><span>Ticket medio</span>${progDelta(avg(mtd), avg(before))}</div></div>
    <p class="caja-meta">Comparado con ${esc(prevLabel)} hasta el mismo día y hora, para que sea justo.</p>`;

  // Series mensuales.
  const series = r.months.map((m) => ({ m, x: progSum(m.people, ids) }));
  const money = series.map(({ m, x }) => ({
    label: shortM(m.month),
    value: gain(x),
    extra: m.partial ? gain(rest) : 0,
    tip: `${monthLabel(m.month)}: ${euro(gain(x))}${boss ? ` (${euro(x.comm)} de comisiones)` : ""} · ${x.services} servicios${m.partial ? ` (en curso; ${euro(gain(rest))} más ya reservados)` : ""}`,
  }));
  const occ = series.map(({ m, x }) => ({
    label: shortM(m.month),
    value: occOf(x),
    tip: `${monthLabel(m.month)}: ${pctTxt(occOf(x))} ocupado · ${hoursTxt(x.booked)} con cita de ${hoursTxt(x.cap)}${m.partial ? " (en curso)" : ""}`,
  }));
  const closed = series.filter(({ m, x }) => !m.partial && (gain(x) || x.cap));
  let trend = "";
  if (closed.length >= 6) {
    const [a, b] = [closed.slice(-6, -3), closed.slice(-3)].map((g) => g.reduce((s, { x }) => s + gain(x), 0) / g.length);
    const [oa, ob] = [closed.slice(-6, -3), closed.slice(-3)].map((g) => occOf(progSum(Object.fromEntries(g.map(({ x }, i) => [i, x])), g.map((_, i) => i))));
    trend = `<p class="pg-trend">Los últimos 3 meses cerrados, de media, ${b >= a ? "<b>han facturado más</b>" : "<b>han facturado menos</b>"} que los 3 anteriores (${euro(Math.round(b))} frente a ${euro(Math.round(a))} al mes) y la ocupación ${Math.round(ob) === Math.round(oa) ? "se ha quedado igual" : ob > oa ? "<b>ha subido</b>" : "<b>ha bajado</b>"} (${pctTxt(ob)} frente a ${pctTxt(oa)}).</p>`;
  }
  const table = `<details class="caja-more"><summary>Ver los números mes a mes</summary><table class="pg-table"><thead><tr><th>Mes</th><th>Ganancias</th><th>Servicios</th><th>Ocupación</th></tr></thead><tbody>${series
    .slice()
    .reverse()
    .map(({ m, x }) => `<tr><td>${esc(monthLabel(m.month))}${m.partial ? " <small>(en curso)</small>" : ""}</td><td>${euro(gain(x))}</td><td>${x.services}</td><td>${pctTxt(occOf(x))}</td></tr>`)
    .join("")}</tbody></table></details>`;

  const charts =
    `<p class="section-label">Ganancias por mes</p><div class="card pg-card">${progBars(money, { fmt: (v) => (v >= 1000 ? `${String(Math.round(v / 100) / 10).replace(".", ",")}k` : `${Math.round(v)}`), extra: "Ganancias por mes" })}
      <p class="pg-legend"><i class="pg-key"></i>Hecho <i class="pg-key ahead"></i>Ya reservado este mes</p></div>` +
    `<p class="section-label">Ocupación por mes</p><div class="card pg-card">${progBars(occ, { fmt: (v) => `${Math.round(v)}%`, max: 100, extra: "Ocupación por mes" })}</div>` +
    trend +
    table;

  const ahead14 = `<p class="section-label">Próximos 14 días</p><div class="card pg-ahead">
    <div class="pg-meter" role="img" aria-label="${pctTxt(occOf(ahead))} de la agenda reservada"><i style="width:${Math.min(100, occOf(ahead)).toFixed(1)}%"></i></div>
    <p><b>${pctTxt(occOf(ahead))}</b> de la agenda ya reservada · ${ahead.services} ${ahead.services === 1 ? "cita" : "citas"} (${euro(ahead.billed)}) · quedan <b>${hoursTxt(Math.max(0, ahead.cap - ahead.booked))}</b> libres por llenar.</p></div>`;

  const { html: heatHtml, low } = progHeat(r.heat, ids);
  const heat = heatHtml
    ? `<p class="section-label">Cuándo hay más trabajo</p><div class="card pg-card">${heatHtml}<div class="pg-tip" hidden></div>
      ${low.length ? `<p class="pg-trend">Las horas más flojas de los últimos 3 meses: ${low.map((x) => `<b>${WD_LONG[x.d]} de ${x.h} a ${x.h + 1} h</b> (${pctTxt(x.o * 100)})`).join(", ")}. Buenas para una oferta o para avisar a la lista de espera.</p>` : ""}</div>`
    : "";

  let team = "";
  if (r.owner && progPick === "all" && r.people.length > 1) {
    team =
      `<p class="section-label">Equipo · ${esc(curLabel.toLowerCase())} hasta hoy</p>` +
      r.people
        .map((p) => {
          const x = progSum(cur.people, [p.id]);
          const b = progSum(r.prevToDate, [p.id]);
          return `<button type="button" class="card worker pg-person" data-pick="${esc(p.id)}"><div class="worker-head">${face(provById(p.id), "who-face")}<div><strong>${esc(p.name)}</strong><span>${x.services} ${x.services === 1 ? "servicio" : "servicios"} · ticket medio ${euro(Math.round(avg(x) * 100) / 100)}</span></div></div>
            <div class="comm-box"><div><span>${p.owner ? "Ganancias (con comisiones)" : "Ganancias"}</span><strong>${euro(Math.round((x.billed + (p.owner ? x.comm : 0)) * 100) / 100)}</strong>${progDelta(x.billed + (p.owner ? x.comm : 0), b.billed + (p.owner ? b.comm : 0))}</div><div><span>Ocupación</span><strong>${pctTxt(occOf(x))}</strong>${progDelta(occOf(x), occOf(b), "pp")}</div><div><span>Clientes</span><strong>${x.clients}</strong>${progDelta(x.clients, b.clients)}</div></div></button>`;
        })
        .join("");
  }

  show(
    staffTop("progreso") +
      filters +
      hero +
      tiles +
      charts +
      ahead14 +
      heat +
      team +
      `<p class="caja-meta pg-note">Ganancias: lo cobrado en caja, o el precio del servicio si no se apuntó el cobro${boss ? ", más tu comisión de lo que ha hecho cada uno del equipo" : ""}. Ocupación: horas con cita entre las horas de ${r.owner && progPick === "all" ? "cada horario" : "tu horario"}, sin contar las bloqueadas ni las citas «No vino». Usa el horario de ahora para los meses pasados.</p>`,
  );
  $$("[data-pick]").forEach((b) => (b.onclick = () => ((progPick = b.dataset.pick), render())));
  $$("[data-months]").forEach((b) => (b.onclick = () => ((progMonths = Number(b.dataset.months)), render())));
  // Tooltip: al pasar el ratón o tocar una barra o una casilla.
  $$(".pg-card").forEach((card) => {
    const tip = card.querySelector(".pg-tip");
    const showTip = (el) => {
      const a = card.getBoundingClientRect(),
        b = el.getBoundingClientRect();
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const x = Math.min(Math.max(b.left + b.width / 2 - a.left, 90), a.width - 90);
      tip.style.left = x + "px";
      tip.style.top = Math.max(4, b.top - a.top - 8) + "px";
      card.querySelectorAll(".is-on").forEach((e) => e.classList.remove("is-on"));
      el.classList.add("is-on");
    };
    const hide = () => {
      tip.hidden = true;
      card.querySelectorAll(".is-on").forEach((e) => e.classList.remove("is-on"));
    };
    card.querySelectorAll("[data-tip]").forEach((el) => {
      el.addEventListener("pointerenter", () => showTip(el));
      el.addEventListener("click", () => showTip(el));
      el.addEventListener("focus", () => showTip(el));
      el.addEventListener("blur", hide);
    });
    card.addEventListener("pointerleave", hide);
  });
}

// ── Equipo: cobrar en caja ─────────────────────────────────────────────────
// La tablet del mostrador. Se elige quién ha hecho el servicio y el formulario
// se rellena solo con su cliente de ahora (a las 11 se cobra al de las 10:30),
// con su servicio y su precio. Todo se puede cambiar: un extra, otro importe…
const methodName = (id) => (id === "membresia" ? "Membresía NOVA+" : (catalog.payMethods || []).find((m) => m.id === id)?.name || id || "");

const byLabel = (by) => (by === "caja" ? "desde la caja" : `por ${esc(first(provById(by)?.name || by))}`);

const cobroSvcs = () => catalog.services.filter((s) => !s.consult);

const minOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const money = (n) => `${(Math.round(Number(n) * 100) / 100).toFixed(2).replace(".", ",")} €`;

// La cita que toca cobrar: la última que ya ha terminado (o está a punto),
// si no la que está en marcha, y si no la siguiente.
function guessBooking(list, nowStamp) {
  if (!list.length) return null;
  const now = minOf(nowStamp.slice(11, 16));
  const ended = list.filter((b) => minOf(b.end) <= now + 10);
  if (ended.length) return ended[ended.length - 1];
  const started = list.filter((b) => minOf(b.start) <= now);
  return started[started.length - 1] || list[0];
}

function cobroForm(r, x) {
  const team = r.team.length ? r.team : catalog.providers;
  const guess = r.date === r.today ? guessBooking(r.pending, r.now) : null;
  const prov = x?.provider.id || (team.some((p) => p.id === staff.id) ? staff.id : guess?.provider || team[0]?.id);
  return `<form id="cobro" class="cobro" autocomplete="off">
    <p class="cb-label">Quién ha hecho el servicio</p>
    <div class="who cb-who" role="radiogroup" aria-label="Barbero">${team
      .map(
        (p) =>
          `<label class="who-item"><input type="radio" name="provider" value="${esc(p.id)}" ${p.id === prov ? "checked" : ""}>${face(provById(p.id) || p, "who-face")}<span>${esc(first(p.name))}</span></label>`,
      )
      .join("")}</div>
    <p class="cb-label">Cliente</p>
    <div class="cb-chips" id="cb-clients"></div>
    <input name="name" id="cb-name" placeholder="Nombre del cliente" maxlength="60" aria-label="Nombre del cliente">
    <input type="hidden" name="booking">
    <p class="cb-label">Servicio</p>
    <div class="cb-chips" role="radiogroup" aria-label="Servicio">${cobroSvcs()
      .map((s) => `<label class="cb-chip"><input type="radio" name="service" value="${esc(s.id)}"><span>${esc(s.name)}</span><small>${euro(s.price)}</small></label>`)
      .join("")}</div>
    ${
      (catalog.extras || []).length
        ? `<p class="cb-label">Extras</p><div class="cb-chips">${catalog.extras
            .map((e) => `<label class="cb-chip cb-extra"><input type="checkbox" name="extras" value="${esc(e.id)}"><span>+ ${esc(e.name)}</span><small>${euro(e.price)}</small></label>`)
            .join("")}</div>`
        : ""
    }
    <p class="cb-label">Importe</p>
    <div class="cb-amount"><input name="amount" id="cb-amount" inputmode="decimal" aria-label="Importe en euros" required><span>€</span></div>
    <p class="cb-hint" id="cb-hint"></p>
    <p class="cb-label cb-pay">Forma de pago</p>
    <div class="cb-chips cb-pay" role="radiogroup" aria-label="Forma de pago">${(catalog.payMethods || [])
      .map((m, i) => `<label class="cb-chip"><input type="radio" name="method" value="${esc(m.id)}" ${(x ? x.method === m.id : i === 0) ? "checked" : ""}><span>${esc(m.name)}</span></label>`)
      .join("")}</div>
    <button class="btn wide cb-go" type="submit">Cobrar</button>
  </form>`;
}

function bindCobroForm(root, r, x, done) {
  const f = root.querySelector("#cobro");
  const amount = f.querySelector("#cb-amount"),
    hint = f.querySelector("#cb-hint"),
    go_ = f.querySelector(".cb-go");
  let touched = !!x;
  const nameIn = f.querySelector("[name=name]"),
    bookIn = f.querySelector("[name=booking]");
  const val = (n) => f.querySelector(`[name=${n}]:checked`)?.value || "";
  const parse = (v) => Math.round(Number(String(v).replace(",", ".")) * 100) / 100;
  const base = () => {
    const s = svcById(val("service"));
    const ex = [...f.querySelectorAll("[name=extras]:checked")].map((i) => catalog.extras.find((e) => e.id === i.value)).filter(Boolean);
    return { s, ex, total: (Number(s?.price) || 0) + ex.reduce((a, e) => a + e.price, 0) };
  };
  let cur = null; // la cita elegida (con «incl» si va incluida en la membresía, o «disc» = % de descuento de socio)
  const refresh = () => {
    const b = base();
    const incl = !!cur?.incl,
      disc = !incl && cur?.disc ? cur.disc : 0;
    if (incl) {
      amount.value = "0";
      touched = false;
    } else if (!touched) amount.value = b.total ? String(Math.round(b.total * (100 - disc)) / 100).replace(".", ",") : "";
    amount.readOnly = incl;
    f.querySelectorAll(".cb-pay").forEach((el) => (el.hidden = incl));
    const n = parse(amount.value);
    const diff = Math.round((n - (b.total * (100 - disc)) / 100) * 100) / 100;
    if (incl) {
      hint.textContent = "Incluida en la membresía NOVA+ del cliente: se cobra a 0 € y no suma como ingreso (ya pagó su cuota).";
      go_.textContent = x ? "Guardar · incluida" : "Registrar · incluida";
      return;
    }
    hint.textContent = !b.s
      ? "Elige el servicio."
      : (disc ? `Socio NOVA+: −${disc} % aplicado. ` : "") + `${b.s.name} ${euro(b.s.price)}${b.ex.map((e) => ` + ${e.name.toLowerCase()} ${euro(e.price)}`).join("")}` +
        (n && diff ? ` · ${diff > 0 ? "+" : "−"}${money(Math.abs(diff))} a mano` : "") +
        (touched && diff ? "" : " · puedes cambiar el importe a mano");
    go_.textContent = (x ? "Guardar · " : "Cobrar ") + (n > 0 ? money(n) : "");
  };
  // Clientes de ese barbero que quedan por cobrar hoy (y la cita del cobro que se edita).
  const clients = (prov) => {
    const list = r.pending.filter((b) => b.provider === prov);
    if (x?.booking && x.provider.id === prov && !list.some((b) => b.id === x.booking))
      list.unshift({ id: x.booking, provider: prov, name: x.name, start: x.time, end: x.time, service: x.items.find((i) => !i.extra)?.id, incl: !!x.included });
    return list;
  };
  const pick = (b, keepService) => {
    cur = b || null;
    bookIn.value = b?.id || "";
    nameIn.value = b ? b.name : "";
    if (b?.service && !keepService) {
      const radio = f.querySelector(`[name=service][value="${b.service}"]`);
      if (radio) radio.checked = true;
    }
    if (!keepService) f.querySelectorAll("[name=extras]").forEach((i) => (i.checked = false));
    [...root.querySelectorAll("#cb-clients .cb-chip")].forEach((c) => c.classList.toggle("on", c.dataset.id === (b?.id || "")));
    if (!keepService) touched = false;
    refresh();
  };
  const drawClients = () => {
    const prov = val("provider");
    const list = clients(prov);
    // Solo los servicios que hace ese barbero (el corte privado es de Airam).
    f.querySelectorAll("[name=service]").forEach((i) => {
      const s = svcById(i.value);
      i.closest("label").hidden = !!s?.providers?.length && !s.providers.includes(prov);
      if (i.closest("label").hidden && i.checked) i.checked = false;
    });
    root.querySelector("#cb-clients").innerHTML =
      list.map((b) => `<button type="button" class="cb-chip" data-id="${esc(b.id)}"><span>${esc(b.start)}</span><small>${esc(b.name)}${b.incl ? " · NOVA+ incluida" : b.disc ? ` · NOVA+ −${b.disc} %` : ""}</small></button>`).join("") +
      `<button type="button" class="cb-chip" data-id=""><span>Sin cita</span><small>Entra sin reservar</small></button>`;
    [...root.querySelectorAll("#cb-clients .cb-chip")].forEach((c) => (c.onclick = () => pick(list.find((b) => b.id === c.dataset.id) || null)));
    return list;
  };

  if (x) {
    drawClients();
    const main = x.items.find((i) => !i.extra);
    if (main) f.querySelector(`[name=service][value="${main.id}"]`) && (f.querySelector(`[name=service][value="${main.id}"]`).checked = true);
    x.items.filter((i) => i.extra).forEach((i) => {
      const c = f.querySelector(`[name=extras][value="${i.id}"]`);
      if (c) c.checked = true;
    });
    amount.value = String(x.amount).replace(".", ",");
    pick(clients(x.provider.id).find((b) => b.id === x.booking) || null, true);
    nameIn.value = x.name;
  } else {
    const preset = cobroPre && r.pending.find((b) => b.id === cobroPre);
    cobroPre = "";
    if (preset) f.querySelector(`[name=provider][value="${preset.provider}"]`) && (f.querySelector(`[name=provider][value="${preset.provider}"]`).checked = true);
    const list = drawClients();
    pick(preset || (r.date === r.today ? guessBooking(list, r.now) : null));
    if (!val("service")) {
      const first = f.querySelector("[name=service]");
      if (first) first.checked = true;
      refresh();
    }
  }

  f.querySelectorAll("[name=provider]").forEach(
    (i) =>
      (i.onchange = () => {
        const list = drawClients();
        pick(r.date === r.today ? guessBooking(list, r.now) : null);
        if (!val("service")) {
          const s = [...f.querySelectorAll("[name=service]")].find((i) => !i.closest("label").hidden);
          if (s) (s.checked = true), refresh();
        }
      }),
  );
  f.querySelectorAll("[name=service], [name=extras]").forEach((i) => (i.onchange = () => ((touched = false), refresh())));
  amount.oninput = () => ((touched = true), refresh());

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    go_.disabled = true;
    try {
      const body = {
        provider: val("provider"),
        booking: bookIn.value,
        name: nameIn.value,
        service: val("service"),
        extras: [...f.querySelectorAll("[name=extras]:checked")].map((i) => i.value),
        amount: amount.value,
        method: val("method"),
      };
      const out = await api(x ? "staff/cobros/" + x.id : "staff/cobros", body);
      done(out.cobro);
    } catch (err) {
      toast(err.message);
    } finally {
      if (document.body.contains(go_)) go_.disabled = false;
    }
  });
}

async function staffCobros() {
  const today = isoDay(salonDate());
  if (!cobroDay) cobroDay = today;
  const r = await api("staff/cobros?date=" + cobroDay);
  const isToday = r.date === r.today;
  const t = r.totals;
  const dayNav = staff.caja
    ? ""
    : `<div class="month-nav"><button type="button" class="cal-nav" data-d="-1" aria-label="Día anterior">‹</button><strong>${esc(isToday ? "Hoy · " + longDay(r.date) : longDay(r.date))}</strong><button type="button" class="cal-nav" data-d="1" aria-label="Día siguiente" ${isToday ? "disabled" : ""}>›</button></div>`;
  const row = (x) => {
    const other = x.provider.id !== staff.id;
    return `<button type="button" class="ag-item cb-row" data-pay="${esc(x.id)}">
      <time>${esc(x.time)}</time>
      <div><strong>${esc(x.name)}</strong><span>${esc(x.items.map((i) => i.name).join(" + "))}${staff.owner || other ? " · " + esc(first(x.provider.name)) : ""}${x.by !== x.provider.id && !staff.caja ? ` · ${byLabel(x.by)}` : ""}</span></div>
      <span class="cb-amt"><b>${money(x.amount)}</b><small>${esc(methodName(x.method))}</small></span>
    </button>`;
  };
  const summary =
    `<div class="stat3 money"><div><strong>${euro(t.total)}</strong><span>${staff.caja ? "En caja hoy" : staff.owner ? "Todo el salón" : "Tus cobros"}</span></div>${t.methods
      .slice(0, 2)
      .map((m) => `<div><strong>${euro(m.total)}</strong><span>${esc(m.name)}</span></div>`)
      .join("")}</div>` +
    `<p class="caja-meta">${t.count} ${t.count === 1 ? "cobro" : "cobros"}${t.methods
      .slice(2)
      .map((m) => ` · ${esc(m.name.toLowerCase())} ${euro(m.total)}`)
      .join("")}</p>` +
    (staff.owner && t.people.length
      ? `<div class="cb-people">${t.people
          .map((p) => `<div class="cb-person">${face(provById(p.id) || p, "who-face")}<div><strong>${esc(first(p.name))}</strong><span>${p.count} ${p.count === 1 ? "servicio" : "servicios"}</span></div><b>${money(p.total)}</b></div>`)
          .join("")}</div>`
      : "");
  show(
    staffTop("cobrar") +
      dayNav +
      (isToday ? `<div class="card cb-card">${cobroForm(r)}</div>` : "") +
      (isToday ? `<button type="button" class="btn wide secondary cb-shop" id="new-shop">${svg(ICONS.bag)} Venta de ropa</button>` : "") +
      `<p class="section-label">${isToday ? "Cobros de hoy" : "Cobros del día"}</p>` +
      summary +
      (r.cobros.length ? r.cobros.map(row).join("") : `<p class="ag-free">Aún no hay cobros este día.</p>`) +
      (staff.caja ? `<button type="button" class="btn wide secondary" style="margin-top:28px" id="staff-out">Cerrar la caja</button>` : ""),
  );
  const shopBtn = $("#new-shop");
  if (shopBtn) shopBtn.onclick = () => staffShop("");
  const out = $("#staff-out");
  if (out)
    out.onclick = async () => {
      await api("staff/logout", {});
      staff = null;
      nav();
      go("equipo");
    };
  $$(".month-nav [data-d]").forEach(
    (b) =>
      (b.onclick = () => {
        const d = dayDate(cobroDay);
        d.setDate(d.getDate() + Number(b.dataset.d));
        cobroDay = isoDay(d) > today ? today : isoDay(d);
        render();
      }),
  );
  if (isToday)
    bindCobroForm($("#app"), r, null, (c) => {
      toast(`Cobrados ${money(c.amount)} a ${first(c.provider.name)}${c.name ? " · " + c.name : ""}.`);
      render();
    });
  $$("[data-pay]").forEach((el) => (el.onclick = () => cobroSheet(r, r.cobros.find((x) => x.id === el.dataset.pay))));
}

function cobroSheet(r, x) {
  if (!x) return;
  const mayEdit = staff.owner || x.provider.id === staff.id || x.by === staff.id || (staff.caja && x.date === r.today);
  const sh = sheet(
    `<p class="eyebrow">Cobro · ${esc(longDay(x.date))} · ${esc(x.time)}</p><h2>${esc(x.name)} · ${money(x.amount)}</h2>` +
      `<p class="muted">Apuntado ${byLabel(x.by)}${x.edited ? ` · cambiado a las ${esc(x.edited.slice(11, 16))}` : ""}.</p>` +
      (mayEdit
        ? cobroForm(r, x) + `<button type="button" class="btn wide danger" style="margin-top:12px" id="cb-del">Quitar este cobro</button>`
        : `<div class="card"><dl class="detail-list"><div><dt>Servicio</dt><dd>${esc(x.items.map((i) => i.name).join(" + "))}</dd></div><div><dt>Pago</dt><dd>${esc(methodName(x.method))}</dd></div></dl></div>`),
  );
  if (!mayEdit) return;
  bindCobroForm(sh.el, r, x, () => {
    sh.close();
    toast("Cobro cambiado.");
    render();
  });
  const del = sh.el.querySelector("#cb-del");
  del.onclick = async () => {
    if (del.dataset.sure !== "1") {
      del.dataset.sure = "1";
      del.textContent = "Pulsa otra vez para quitarlo";
      return;
    }
    del.disabled = true;
    try {
      await api(`staff/cobros/${x.id}/delete`, {});
      sh.close();
      toast("Cobro quitado.");
      render();
    } catch (e) {
      del.disabled = false;
      toast(e.message);
    }
  };
}

// ── Equipo: hojas ──────────────────────────────────────────────────────────
function staffSheet(b) {
  if (!b) return;
  const block = b.kind === "block",
    mine = canManage(b.provider.id);
  const sh = sheet(
    `<p class="eyebrow">${esc(longDay(b.date))} · ${esc(b.start)}–${esc(b.end)}</p><h2>${block ? esc(b.service.name) : esc(b.name)}</h2>` +
      (block
        ? `<p class="muted">Hora bloqueada para ${esc(b.provider.name)}.</p>`
        : (b.strikes ? `<p class="strike-warn">⚠ Este cliente ha faltado ${b.strikes} ${b.strikes === 1 ? "vez" : "veces"} sin avisar.</p>` : "") +
          `<div class="card"><dl class="detail-list"><div><dt>Servicio</dt><dd>${esc(b.service.name)} · ${euro(b.service.price)}</dd></div><div><dt>Barbero</dt><dd>${esc(b.provider.name)}</dd></div><div><dt>Teléfono</dt><dd>${esc(b.phone || "—")}</dd></div><div><dt>Correo</dt><dd>${esc(b.email || "—")}</dd></div><div><dt>Reservada por</dt><dd>${b.by === "staff" ? "Equipo" : "App"}</dd></div></dl></div>`) +
      (b.status !== "confirmed"
        ? b.late && mine
          ? `<p class="warning">La canceló el cliente con poca antelación${b.canceledAt ? " (" + esc(b.canceledAt.slice(11)) + " del " + esc(shortDate(b.canceledAt.slice(0, 10))) + ")" : ""}.</p>` + staffCharge(b)
          : `<p class="warning">Cancelada${b.late ? " tarde" : ""}.</p>`
        : !mine
          ? `<p class="muted">Es una cita de ${esc(first(b.provider.name))}: solo la pueden cambiar ${esc(first(b.provider.name))} o el dueño.</p>`
          : (block
              ? ""
              : (b.pay
                  ? `<p class="cb-paid">✓ Cobrado en caja: <b>${euro(b.pay.amount)}</b> · ${esc(methodName(b.pay.method))}</p>`
                  : b.attendance !== "absent"
                    ? `<button type="button" class="btn wide sp-staff-btn" id="sh-cobrar" style="margin-bottom:10px">Cobrar en caja</button>`
                    : "") +
                `<div class="seg"><button type="button" class="${b.attendance === "done" ? "" : "secondary"}" data-att="done">✓ Vino</button><button type="button" class="${b.attendance === "absent" ? "" : "secondary"}" data-att="absent">✗ No vino</button></div>` +
                staffCharge(b) +
                (b.email && b.attendance !== "absent" ? `<button type="button" class="btn wide secondary sp-staff-btn" id="sh-shop">${svg(ICONS.bag)} Se lleva ropa de ${esc(catalog.shop.name)}</button>` : "") +
                (b.phone ? `<div class="form-actions"><a class="btn secondary" href="tel:${esc(b.phone.replace(/\s/g, ""))}">Llamar</a><a class="btn wa-btn" target="_blank" rel="noopener" href="https://wa.me/${esc(b.phone.replace(/\D/g, ""))}">WhatsApp</a></div>` : "")) +
            (block || b.attendance === "done" || b.pay ? "" : `<button type="button" class="btn wide secondary" style="margin-top:12px" id="sh-move">Cambiar de día u hora</button>`) +
            `<button type="button" class="btn wide danger" style="margin-top:12px" id="sh-cancel">${block ? "Quitar bloqueo" : "Cancelar cita"}</button>`),
  );
  sh.el.querySelectorAll("[data-att]").forEach(
    (x) =>
      (x.onclick = async () => {
        const att = b.attendance === x.dataset.att ? "unmarked" : x.dataset.att;
        try {
          await api(`staff/bookings/${b.id}/state`, { attendance: att });
          sh.close();
          await render();
          // Al marcar «No vino», se vuelve a abrir la ficha con la opción de cobrar.
          if (att === "absent" && b.card) staffSheet({ ...b, attendance: "absent" });
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  bindStaffCharge(sh, b);
  const cobrar = sh.el.querySelector("#sh-cobrar");
  if (cobrar) cobrar.onclick = () => (sh.close(), (cobroPre = b.id), (cobroDay = b.date), go("equipo/cobrar"));
  const shop = sh.el.querySelector("#sh-shop");
  if (shop) shop.onclick = () => (sh.close(), staffShop(b.email));
  const mv = sh.el.querySelector("#sh-move");
  if (mv) mv.onclick = () => (sh.close(), (staffMove = b.id), (calMonth = b.date.slice(0, 7)), (selectedDate = b.date), (dayPicked = true), go("move/" + b.id));
  const c = sh.el.querySelector("#sh-cancel");
  if (c)
    c.onclick = async () => {
      if (c.dataset.sure !== "1") {
        c.dataset.sure = "1";
        c.textContent = "Pulsa otra vez para confirmar";
        return;
      }
      c.disabled = true;
      try {
        await api(`bookings/${b.id}/cancel`, {});
        sh.close();
        render();
      } catch (e) {
        c.disabled = false;
        toast(e.message);
      }
    };
}

// ── Equipo: venta de ropa de NOVA Supply ───────────────────────────────────
// El barbero apunta lo que se lleva el socio y el Club le suma los puntos.
// Se busca al socio por su correo o por su código del Club.
// ── Ropa (NOVA Supply): vender, entregar reservas de la web y llevar el stock ──
// Lo mismo que se ve aquí lo ve la tienda (novasupply.es): las dos partes leen
// el mismo stock y las mismas ventas.
const ESTADO_ROPA = { disponible: ["A la venta", "st-ok"], agotado: ["Agotada", "st-cancel"], proximamente: ["Próximamente", "st-wait"], oculto: ["Oculta", ""] };

const ropaFoto = (r, p) => (p.foto ? `${r.tienda.replace(/\/$/, "")}/${encodeURIComponent(p.foto)}` : "");

const ropaNombre = (p) => p.nombre + (p.variante ? " · " + p.variante : "");

async function staffShop(email) {
  let r;
  try {
    r = await api("staff/ropa");
  } catch (e) {
    return toast(e.message);
  }
  const S = catalog.shop,
    P = catalog.points;
  const sh = sheet(`<p class="eyebrow">${esc(S.name)}</p><h2>Venta de ropa</h2><div id="sp-flow"></div>`);
  const flow = sh.el.querySelector("#sp-flow");
  const venta = r.prendas.filter((p) => p.tallas.length && p.estado !== "oculto" && p.estado !== "proximamente");
  const pick = { prenda: venta.find((p) => p.efectivo === "disponible")?.id || venta[0]?.id || "", talla: "" };
  const draw = () => {
    const p = venta.find((x) => x.id === pick.prenda);
    flow.innerHTML =
      (r.pendientes.length
        ? `<button type="button" class="btn wide secondary" id="sp-web" style="margin-bottom:14px">Entregar una reserva de la web <span class="cb-badge">${r.pendientes.length}</span></button>`
        : "") +
      (!venta.length
        ? `<p class="ag-free">No hay prendas a la venta. ${r.owner ? "Añádelas en la pestaña «Ropa»." : "Díselo al dueño."}</p>`
        : `<form id="sp-sale">
        <p class="section-label" style="margin-top:0">Prenda</p>
        <div class="rp-pick">${venta
          .map(
            (x) => `<button type="button" class="rp-opt${x.id === pick.prenda ? " on" : ""}" data-pr="${esc(x.id)}">${ropaFoto(r, x) ? `<img src="${esc(ropaFoto(r, x))}" alt="" loading="lazy">` : ""}<strong>${esc(ropaNombre(x))}</strong><small>${x.precio != null ? euro(x.precio) : "Sin precio"}</small></button>`,
          )
          .join("")}</div>
        <p class="section-label">Talla</p>
        <div class="tchips">${p.tallas
          .map((t) => {
            const out = t.libres === 0;
            return `<label class="tchip${out ? " dis" : ""}"><input type="radio" name="talla" value="${esc(t.talla)}" ${out ? "disabled" : ""} ${pick.talla === t.talla ? "checked" : ""}><span>${esc(t.talla)}${t.stock !== null ? ` <small>${t.libres}</small>` : ""}</span></label>`;
          })
          .join("")}</div>
        <div class="form-row2" style="margin-top:6px"><div><label for="sp-n">Cuántas</label><select id="sp-n" name="cantidad">${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select></div>
          <div><label for="sp-amount">Cobrado (€)</label><input id="sp-amount" name="importe" required inputmode="decimal" value="${p.precio != null ? Number(p.precio).toFixed(2).replace(".", ",") : ""}" autocomplete="off"></div></div>
        <label for="sp-socio">Socio del Club <small>(opcional: correo o código, para sumarle puntos)</small></label>
        <input id="sp-socio" name="socio" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(email || "")}" placeholder="cliente@correo.com o CARLOS482">
        <p class="sp-preview" id="sp-preview"></p>
        <button class="btn wide" style="margin-top:6px" type="submit">Apuntar venta</button>
        <p class="muted" style="font-size:12px;margin-top:10px">Se descuenta del stock y sale también en la web de la tienda.</p>
      </form>`);
    flow.querySelector("#sp-web")?.addEventListener("click", () => (sh.close(), ropaRecogidas(r)));
    const f = flow.querySelector("#sp-sale");
    if (!f) return;
    const price = () => (p.precio != null ? p.precio : 0);
    const pv = flow.querySelector("#sp-preview");
    const upd = () => {
      const n = Number(String(f.importe.value).replace(",", "."));
      pv.innerHTML = f.socio.value.trim() && n > 0 ? `Le suma <b>+${nf(Math.round(n * P.perEuro))} puntos</b> en el Club.` : "";
    };
    flow.querySelectorAll("[data-pr]").forEach((b) => (b.onclick = () => ((pick.prenda = b.dataset.pr), (pick.talla = ""), draw())));
    f.cantidad.onchange = () => {
      if (p.precio != null) f.importe.value = (price() * Number(f.cantidad.value)).toFixed(2).replace(".", ",");
      upd();
    };
    f.importe.oninput = upd;
    f.socio.oninput = upd;
    upd();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = new FormData(f);
      if (!d.get("talla")) return toast("Elige la talla.");
      const btn = f.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        const x = await api("staff/ropa/venta", { prenda: p.id, talla: d.get("talla"), cantidad: d.get("cantidad"), importe: d.get("importe"), socio: d.get("socio") });
        flow.innerHTML = `<div class="booked-hero"><span class="booked-check">✓</span><h2>Venta apuntada</h2><p class="sub">${esc(ropaNombre(p))} · ${esc(x.venta.talla)}${x.venta.cantidad > 1 ? " × " + x.venta.cantidad : ""} · ${euro(x.venta.importe)}${x.puntos ? ` · <b>+${nf(x.puntos)} puntos</b>` : ""}</p></div>
          <div class="form-actions"><button type="button" class="btn secondary" id="sp-undo">Deshacer</button><button type="button" class="btn" id="sp-ok">Hecho</button></div>`;
        flow.querySelector("#sp-ok").onclick = () => (sh.close(), render());
        flow.querySelector("#sp-undo").onclick = async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            await api(`staff/ropa/venta/${x.venta.id}/deshacer`, {});
            toast("Venta deshecha: la prenda vuelve al stock.");
            sh.close();
            render();
          } catch (err) {
            toast(err.message);
          }
        };
      } catch (err) {
        btn.disabled = false;
        toast(err.message);
      }
    };
  };
  draw();
}

// Reservas hechas en novasupply.es que esperan a que el cliente pase a por ellas.
function ropaRecogidas(r) {
  const sh = sheet(
    `<p class="eyebrow">Reservas de la web</p><h2>Para recoger</h2>
    ${
      r.pendientes.length
        ? r.pendientes
            .map(
              (x) => `<div class="card rp-ped"><div class="tr-item-top"><div><strong>${esc(x.nombre || "")}</strong><span>${esc(x.prendaNombre)} · talla ${esc(x.talla)} · ref. <b>${esc(x.ref)}</b></span></div><span class="appt-state st-wait">${esc(shortDate(String(x.fecha || "").slice(0, 10)))}</span></div>
                ${x.tel ? `<p class="tr-line muted">${esc(x.tel)}${x.correo ? " · " + esc(x.correo) : ""}</p>` : ""}
                <div class="form-actions" style="margin-top:10px"><input class="rp-imp" inputmode="decimal" aria-label="Importe cobrado" value="${x.precio != null ? Number(x.precio).toFixed(2).replace(".", ",") : ""}"><button type="button" class="btn" data-entrega="${esc(x.ref)}">Entregada y cobrada</button></div>
                ${r.owner ? `<button type="button" class="tr-del" data-anula="${esc(x.ref)}">Anular reserva (no viene)</button>` : ""}
              </div>`,
            )
            .join("")
        : `<p class="ag-free">No hay reservas pendientes.</p>`
    }`,
  );
  sh.el.querySelectorAll("[data-entrega]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const x = await api("staff/ropa/recogida", { ref: b.dataset.entrega, importe: b.parentElement.querySelector(".rp-imp").value });
          toast(`Entregada: ${euro(x.venta.importe)}${x.puntos ? ` · +${nf(x.puntos)} puntos` : ""}.`);
          sh.close();
          render();
        } catch (e) {
          b.disabled = false;
          toast(e.message);
        }
      }),
  );
  sh.el.querySelectorAll("[data-anula]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (b.dataset.sure !== "1") {
          b.dataset.sure = "1";
          b.textContent = "Pulsa otra vez: la prenda vuelve a estar libre";
          return;
        }
        try {
          await api("staff/ropa/anular", { ref: b.dataset.anula });
          toast("Reserva anulada.");
          sh.close();
          render();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}

// Pestaña «Ropa» (dueño): stock de cada prenda, reservas de la web y ventas.
async function staffRopa() {
  const r = await api("staff/ropa");
  show(
    staffTop("ropa") +
      `<div class="stat3 money"><div><strong>${r.mes.unidades}</strong><span>Prendas este mes</span></div><div><strong>${euro(r.mes.importe)}</strong><span>Vendido</span></div><div><strong>${r.pendientes.length}</strong><span>Por recoger</span></div></div>
      <p class="caja-meta">${r.mes.estudio} ${r.mes.estudio === 1 ? "venta" : "ventas"} en el estudio · ${r.mes.web} ${r.mes.web === 1 ? "recogida" : "recogidas"} de la web</p>
      <div class="staff-bar"><button type="button" class="btn" id="rp-sell">${svg(ICONS.bag)} Vender</button>${r.pendientes.length ? `<button type="button" class="btn secondary" id="rp-web">Reservas web (${r.pendientes.length})</button>` : ""}</div>
      <p class="section-label">Stock</p>
      <div class="rp-list">${r.prendas
        .map((p) => {
          const [st, cls] = ESTADO_ROPA[p.efectivo] || ESTADO_ROPA.oculto;
          return `<button type="button" class="ag-item rp-row" data-ed="${esc(p.id)}">${ropaFoto(r, p) ? `<img class="pr-thumb" src="${esc(ropaFoto(r, p))}" alt="" loading="lazy">` : `<span class="pr-thumb pr-noimg">${svg(ICONS.shirt)}</span>`}
            <div><strong>${esc(ropaNombre(p))}</strong><span>${p.tallas.length ? p.tallas.map((t) => `${esc(t.talla)} ${t.stock === null ? "·" : `<b>${t.libres}</b>`}`).join(" &nbsp; ") : "Sin tallas"}${p.precio != null ? " · " + euro(p.precio) : ""}</span></div>
            <span class="appt-state ${cls}">${st}</span></button>`;
        })
        .join("")}</div>
      <button type="button" class="btn wide secondary" style="margin-top:10px" id="rp-new">+ Añadir prenda</button>
      <p class="muted" style="font-size:12px">«·» = esa talla no se cuenta (se vende sin límite). Cuando una prenda a la venta se queda sin tallas libres, la tienda la pone como agotada sola.</p>
      <p class="section-label">Últimas ventas</p>
      ${
        r.ventas.length
          ? r.ventas
              .map(
                (v) => `<div class="ag-item rp-sale"><time>${esc(shortDate(String(v.fecha).slice(0, 10)))}<small>${esc(String(v.fecha).slice(11, 16))}</small></time><div><strong>${esc(v.nombre)} · ${esc(v.talla)}${v.cantidad > 1 ? " × " + v.cantidad : ""}</strong><span>${v.canal === "web" ? "Reserva web" : "Estudio"}${v.cliente ? " · " + esc(v.cliente) : ""}${v.ref ? " · " + esc(v.ref) : ""}</span></div><span class="rp-amt"><b>${euro(v.importe)}</b>${v.canal === "estudio" ? `<button type="button" class="tr-del" data-undo="${esc(v.id)}">Deshacer</button>` : ""}</span></div>`,
              )
              .join("")
          : `<p class="ag-free">Aún no hay ventas apuntadas.</p>`
      }`,
  );
  $("#rp-sell").onclick = () => staffShop("");
  $("#rp-web")?.addEventListener("click", () => ropaRecogidas(r));
  $("#rp-new").onclick = () => prendaSheet(null, r);
  $$("[data-ed]").forEach((b) => (b.onclick = () => prendaSheet(r.prendas.find((p) => p.id === b.dataset.ed), r)));
  $$("[data-undo]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (b.dataset.sure !== "1") {
          b.dataset.sure = "1";
          b.textContent = "¿Seguro?";
          return;
        }
        try {
          await api(`staff/ropa/venta/${b.dataset.undo}/deshacer`, {});
          toast("Venta deshecha.");
          render();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}

function prendaSheet(p, r) {
  const TALLAS = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];
  const has = (t) => p?.tallas.find((x) => x.talla === t);
  const sh = sheet(
    `<p class="eyebrow">${p ? "Prenda" : "Nueva prenda"}</p><h2>${p ? esc(ropaNombre(p)) : "Añadir prenda"}</h2>
    ${p && ropaFoto(r, p) ? `<img class="rp-big" src="${esc(ropaFoto(r, p))}" alt="">` : ""}
    <form id="rp-form">
      <div class="form-row2"><div><label for="rp-n" style="margin-top:0">Nombre</label><input id="rp-n" name="nombre" required maxlength="40" value="${esc(p?.nombre || "")}" placeholder="Camiseta"></div>
      <div><label for="rp-v" style="margin-top:0">Variante</label><input id="rp-v" name="variante" maxlength="30" value="${esc(p?.variante || "")}" placeholder="Gris"></div></div>
      <div class="form-row2"><div><label for="rp-c">Color <small>(una palabra)</small></label><input id="rp-c" name="color" maxlength="20" value="${esc(p?.color || "")}" placeholder="gris"></div>
      <div><label for="rp-p">Precio (€)</label><input id="rp-p" name="precio" inputmode="decimal" value="${p?.precio != null ? Number(p.precio).toFixed(2).replace(".", ",") : ""}"></div></div>
      <label for="rp-e">Estado</label><select id="rp-e" name="estado">${Object.entries(ESTADO_ROPA)
        .map(([k, [l]]) => `<option value="${k}" ${(p?.estado || "disponible") === k ? "selected" : ""}>${l}</option>`)
        .join("")}</select>
      <p class="section-label">Tallas y unidades en el estudio</p>
      <p class="muted" style="font-size:12px;margin-top:-4px">Marca las tallas que hay. Si pones unidades, se descuentan con cada venta y reserva; si lo dejas vacío, no se cuentan.</p>
      <div class="rp-sizes">${TALLAS.map((t) => {
        const x = has(t);
        return `<div class="rp-size"><label class="check" style="margin:0"><input type="checkbox" name="t-${t}" ${x ? "checked" : ""}><span>${t}</span></label><input name="s-${t}" inputmode="numeric" placeholder="—" value="${x && x.stock !== null ? x.stock : ""}" aria-label="Unidades de la ${t}">${x?.apartadas ? `<small>${x.apartadas} apart.</small>` : "<small></small>"}</div>`;
      }).join("")}</div>
      ${p ? "" : `<label for="rp-f">Foto <small>(nombre del archivo en la web de la tienda, p. ej. gris-delante.jpg)</small></label><input id="rp-f" name="foto" maxlength="80">`}
      <button class="btn wide" style="margin-top:16px" type="submit">Guardar</button>
      <p class="muted" style="font-size:12px;margin-top:10px">Los cambios se ven también en novasupply.es.</p>
    </form>`,
  );
  sh.el.querySelector("#rp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(e.target),
      tallas = TALLAS.filter((t) => d.get("t-" + t)),
      stock = Object.fromEntries(tallas.map((t) => [t, String(d.get("s-" + t) || "").trim()]));
    try {
      await api("staff/ropa/prenda", { id: p?.id, nombre: d.get("nombre"), variante: d.get("variante"), color: d.get("color"), precio: d.get("precio"), estado: d.get("estado"), tallas, stock, foto: d.get("foto") || "" });
      sh.close();
      toast("Guardado. Ya se ve en la tienda.");
      render();
    } catch (err) {
      toast(err.message);
    }
  });
}

// ── Equipo: faltas y cobros ────────────────────────────────────────────────
// Dentro de la ficha de una cita marcada «No vino»: cobrar el servicio en la
// tarjeta que el cliente dejó en garantía, y ver cómo ha ido el cobro.
// Lo que se cobra según las normas que puso el dueño (100 % = el servicio entero).
const feeOf = (b) => b.fee ?? Math.round((Number(b.service.price) || 0) * (b.late ? catalog.rules.lateFeePct : catalog.rules.noShowFeePct)) / 100;

function staffCharge(b) {
  const late = b.status === "canceled" && b.late;
  if (b.kind !== "booking" || !(late || (b.status === "confirmed" && b.attendance === "absent"))) return "";
  const c = b.charge,
    price = euro(feeOf(b)),
    why = late ? `Canceló con ${String(b.hoursLeft ?? "menos de " + catalog.rules.cancelHours).replace(".", ",")} h de antelación` : "No vino y no avisó";
  const forgive = `<button type="button" class="btn wide secondary" id="chg-waive">No cobrar (motivo justificado)</button>`;
  if (b.waived) return `<div class="chg"><strong>No se cobra</strong><span>${esc(why)}. Se decidió no cobrar${b.waived.note ? ": " + esc(b.waived.note) : ""}.</span><button type="button" class="btn small secondary" id="chg-unwaive">Deshacer</button></div>`;
  if (!feeOf(b)) return `<div class="chg"><strong>${esc(why)}</strong><span>Con las normas actuales no se cobra nada.</span></div>`;
  if (c?.status === "succeeded")
    return `<div class="chg ok"><strong>✓ Cobrado: ${euro(c.amount)}</strong><span>${esc(cardLabel(c))} · ${esc(shortDate(c.at.slice(0, 10)))}</span>${
      staff.owner ? `<button type="button" class="btn small secondary" id="chg-refund">Devolver el dinero</button>` : ""
    }</div>`;
  if (c?.status === "refunded") return `<div class="chg"><strong>Cobro devuelto</strong><span>Se le devolvieron ${euro(c.amount)}.</span></div>`;
  if (c?.status === "requires_action")
    return `<div class="chg wait"><strong>⏳ Pendiente de que el cliente lo confirme</strong><span>Su banco pide confirmación. Le hemos avisado: lo verá en «Mis citas» al entrar en la app.</span></div>`;
  const past = new Date(`${b.date}T${b.start}:00`) < salonDate();
  if (!late && !past) return `<p class="muted chg-hint">Cuando pase la hora de la cita podrás cobrarle la falta.</p>`;
  if (!b.card) return `<div class="chg"><strong>${esc(why)} · sin tarjeta guardada</strong><span>Este cliente no dejó tarjeta (cita apuntada a mano o de antes). Habla con él por WhatsApp.</span>${forgive}</div>`;
  return `<div class="chg${c ? " bad" : ""}">${
    c ? `<strong>✗ No se pudo cobrar</strong><span>${esc(c.error || "El banco rechazó el cobro.")}</span>` : `<strong>${esc(why)}</strong><span>Según las condiciones que aceptó se le pueden cobrar ${price}. Tú decides: si tuvo un motivo justificado, no lo cobres.</span>`
  }<button type="button" class="btn wide" id="chg-go">${c ? "Reintentar" : "Cobrar"} ${price}</button>${forgive}</div>`;
}

function bindStaffCharge(sh, b) {
  const go2 = sh.el.querySelector("#chg-go");
  if (go2)
    go2.onclick = async () => {
      if (go2.dataset.sure !== "1") {
        go2.dataset.sure = "1";
        go2.textContent = `Pulsa otra vez para cobrar ${euro(feeOf(b))}`;
        return;
      }
      go2.disabled = true;
      try {
        const r = await api(`staff/bookings/${b.id}/charge`, {});
        const st = r.charge.status;
        toast(st === "succeeded" ? `Cobrados ${euro(r.charge.amount)}.` : st === "requires_action" ? "Su banco pide confirmación: le hemos avisado." : "El banco ha rechazado el cobro.");
        sh.close();
        await render();
        staffSheet({ ...b, charge: r.charge });
      } catch (e) {
        go2.disabled = false;
        toast(e.message);
      }
    };
  const wv = sh.el.querySelector("#chg-waive"),
    uw = sh.el.querySelector("#chg-unwaive");
  if (wv)
    wv.onclick = async () => {
      wv.disabled = true;
      try {
        await api(`staff/bookings/${b.id}/waive`, {});
        toast("Hecho: no se le cobra.");
        sh.close();
        await render();
        staffSheet({ ...b, waived: { at: "" } });
      } catch (e) {
        wv.disabled = false;
        toast(e.message);
      }
    };
  if (uw)
    uw.onclick = async () => {
      try {
        await api(`staff/bookings/${b.id}/waive`, { undo: true });
        sh.close();
        await render();
        const { waived, ...rest } = b;
        staffSheet(rest);
      } catch (e) {
        toast(e.message);
      }
    };
  const rf = sh.el.querySelector("#chg-refund");
  if (rf)
    rf.onclick = async () => {
      if (rf.dataset.sure !== "1") {
        rf.dataset.sure = "1";
        rf.textContent = `¿Devolver ${euro(b.charge.amount)}? Pulsa otra vez`;
        return;
      }
      rf.disabled = true;
      try {
        await api(`staff/bookings/${b.id}/refund`, {});
        toast("Dinero devuelto.");
        sh.close();
        render();
      } catch (e) {
        rf.disabled = false;
        toast(e.message);
      }
    };
}

// Pestaña «Faltas»: quién no vino este mes y cómo van los cobros.
async function staffFaltas() {
  const nowKey = monthKey(salonDate());
  if (!staffMonth) staffMonth = nowKey;
  const r = await api("staff/noshows?month=" + staffMonth);
  const label = monthLabel(r.month);
  const status = (b) =>
    b.waived
      ? ["No se cobra", ""]
      : b.charge?.status === "succeeded"
      ? ["Cobrada", "st-done"]
      : b.charge?.status === "refunded"
        ? ["Devuelta", ""]
        : b.charge?.status === "requires_action"
          ? ["Pendiente", "st-wait"]
          : b.charge
            ? ["Rechazada", "st-cancel"]
            : b.card
              ? ["Sin cobrar", "st-cancel"]
              : ["Sin tarjeta", ""];
  show(
    staffTop("faltas") +
      `<div class="month-nav"><button type="button" class="cal-nav" data-m="-1" aria-label="Mes anterior">‹</button><strong>${esc(label)}</strong><button type="button" class="cal-nav" data-m="1" aria-label="Mes siguiente" ${staffMonth >= nowKey ? "disabled" : ""}>›</button></div>` +
      `<div class="stat3 money"><div><strong>${r.list.length}</strong><span>${r.list.length === 1 ? "Falta" : "Faltas y tardías"}</span></div><div><strong>${euro(r.charged)}</strong><span>Cobrado</span></div><div><strong>${r.uncharged}</strong><span>Sin cobrar</span></div></div>` +
      (r.pending ? `<p class="caja-meta">${euro(r.pending)} pendientes de que el cliente confirme o pague.</p>` : "") +
      (r.list.length
        ? `<div class="faltas">${r.list
            .map((b) => {
              const [t, cls] = status(b);
              return `<button type="button" class="ag-item falta" data-id="${esc(b.id)}"><time>${esc(shortDate(b.date))}<small>${esc(b.start)}</small></time><div><strong>${esc(b.name)}</strong><span>${b.late ? "Canceló tarde · " : "No vino · "}${esc(b.service.name)} · ${euro(b.fee ?? b.service.price)}${staff.owner ? " · " + esc(first(b.provider.name)) : ""}${b.strikes > 1 ? ` · ⚠ ${b.strikes} faltas` : ""}</span></div><span class="appt-state ${cls}">${t}</span></button>`;
            })
            .join("")}</div>`
        : `<p class="ag-free">Nadie ha faltado este mes. 🙌</p>`) +
      `<p class="muted" style="margin-top:18px">Aquí salen quienes no vinieron y quienes cancelaron con menos de ${catalog.rules.cancelHours} h. Tú decides en cada caso si se cobra. Para apuntar que alguien no vino, abre la cita en la Agenda y pulsa «✗ No vino».</p>`,
  );
  $$(".month-nav [data-m]").forEach((b) => (b.onclick = () => ((staffMonth = shiftMonth(staffMonth, Number(b.dataset.m))), render())));
  $$(".falta[data-id]").forEach((el) => (el.onclick = () => staffSheet(r.list.find((b) => b.id === el.dataset.id))));
}

// Clientes que ya han venido (socios y apuntados por teléfono), para no volver
// a escribir nombre, teléfono y correo. Se piden una vez por sesión del panel.
let contactsP = null;

const staffContacts = () => (contactsP ||= api("staff/contacts").then((r) => r.contacts || [], () => ((contactsP = null), [])));

const plain = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Nueva cita o bloqueo desde la agenda. `day` es lo que ya se ve en pantalla
// (horario y citas de ese día): con eso se proponen las horas libres del
// barbero elegido y se marca la primera, en vez de buscarla en una lista larga.
function staffNew(block, day, preset = {}) {
  const opts = (list, label) => list.map((x) => `<option value="${esc(x.id)}" ${x.id === staff.id ? "selected" : ""}>${esc(label(x))}</option>`).join("");
  // Un barbero solo apunta en su agenda, y solo los servicios que hace.
  const services = catalog.services.filter((s) => !s.consult && (staff.owner || !s.providers?.length || s.providers.includes(staff.id)));
  const today = staffDay === isoDay(salonDate()),
    nowMin = salonDate().getHours() * 60 + salonDate().getMinutes();
  const busyOf = (pid) => (day?.bookings || []).filter((b) => b.provider.id === pid && b.status === "confirmed").map((b) => [hm(b.start), hm(b.end)]);
  const isFree = (busy, t, dur) => !busy.some(([a, z]) => t < z && t + dur > a);
  // Horas del horario del barbero (cada 15 min) en las que cabe el servicio.
  const freeStarts = (pid, dur) => {
    const busy = busyOf(pid),
      out = [];
    for (const [a, z] of day?.providers?.find((p) => p.id === pid)?.hours || [])
      for (let t = hm(a); t + dur <= hm(z); t += 15) if ((!today || t >= nowMin - 10) && isFree(busy, t, dur)) out.push(addMin("00:00", t));
    return out;
  };
  const sh = sheet(
    `<h2>${block ? "Bloquear hora" : "Nueva cita"}</h2><p class="muted">${esc(longDay(staffDay))}${staff.owner ? "" : " · en tu agenda"}</p>
    <form id="sn" autocomplete="off">
      ${staff.owner ? `<label for="sn-prov">Barbero</label><select id="sn-prov" name="provider">${opts(catalog.providers, (p) => p.name)}</select>` : `<input type="hidden" name="provider" value="${esc(staff.id)}">`}
      ${block ? "" : `<label for="sn-svc">Servicio</label><select id="sn-svc" name="service">${opts(services, (s) => `${s.name} · ${s.duration} min`)}</select>`}
      <label>${block ? "Desde" : "Hora"}</label>
      <div class="sn-free" id="sn-free"></div>
      <div class="form-actions" style="margin-top:8px"><div><label class="sr-only" for="sn-start">Hora de inicio</label><select id="sn-start" name="start"></select></div>${block ? `<div><label class="sr-only" for="sn-end">Hasta</label><select id="sn-end" name="end"></select></div>` : ""}</div>
      ${
        block
          ? `<label for="sn-note">Motivo (opcional)</label><input id="sn-note" name="note" maxlength="60" placeholder="Comida, médico…">`
          : `<label for="sn-name">Nombre del cliente</label><input id="sn-name" name="name" required maxlength="120" placeholder="Escribe y elige si ya ha venido"><div class="sn-sug" id="sn-sug" hidden></div>
             <label for="sn-phone">Teléfono</label><input id="sn-phone" name="phone" type="tel" maxlength="30"><label for="sn-email">Correo <small class="opt">(opcional: le suma puntos del Club)</small></label><input id="sn-email" name="email" type="email">
             <label for="sn-every">Repetir</label><div class="form-actions" style="margin-top:0"><select id="sn-every" name="every"><option value="">No</option><option value="1">Cada semana</option><option value="2">Cada 2 semanas</option><option value="3">Cada 3 semanas</option><option value="4">Cada 4 semanas</option></select><select name="times" aria-label="Cuántas veces">${[2, 3, 4, 5, 6, 8, 10, 12].map((n) => `<option value="${n}" ${n === 4 ? "selected" : ""}>${n} citas</option>`).join("")}</select></div>`
      }
      <button class="btn wide" style="margin-top:18px" type="submit">${block ? "Bloquear" : "Apuntar cita"}</button>
    </form>`,
  );
  const q = (x) => sh.el.querySelector(x),
    f = q("#sn"),
    startSel = q("#sn-start"),
    endSel = q("#sn-end"),
    freeBox = q("#sn-free");
  // Pinta las horas: arriba las libres más cercanas a un toque; en la lista,
  // todas (de 8:00 a 22:00) con las ocupadas marcadas y sin poder elegirse.
  const paint = () => {
    const pid = f.provider.value,
      dur = block ? 15 : services.find((s) => s.id === f.service.value)?.duration || 30,
      busy = busyOf(pid),
      free = freeStarts(pid, dur),
      keep = startSel.value;
    let o = "";
    for (let t = 8 * 60; t <= 22 * 60 - 15; t += 15) {
      const h = addMin("00:00", t),
        ok = isFree(busy, t, dur);
      o += `<option value="${h}" ${ok ? "" : "disabled"}>${h}${ok ? "" : " · ocupado"}</option>`;
    }
    startSel.innerHTML = o;
    const pick = (keep && isFree(busy, hm(keep), dur) && keep) || free[0] || [...startSel.options].find((x) => !x.disabled)?.value;
    if (pick) startSel.value = pick;
    freeBox.innerHTML = free.length
      ? free
          .slice(0, 8)
          .map((h) => `<button type="button" class="sn-chip${h === startSel.value ? " on" : ""}" data-h="${h}">${h}</button>`)
          .join("") + (free.length > 8 ? `<span class="sn-more">+${free.length - 8} más en la lista</span>` : "")
      : `<span class="sn-more">${day?.providers?.find((p) => p.id === pid)?.hours?.length ? "Sin huecos en su horario: elige la hora en la lista." : "Ese día no trabaja: elige la hora en la lista si aun así quieres apuntarla."}</span>`;
    freeBox.querySelectorAll(".sn-chip").forEach((b) => (b.onclick = () => ((startSel.value = b.dataset.h), mark())));
    if (endSel) paintEnd();
  };
  const mark = () => {
    freeBox.querySelectorAll(".sn-chip").forEach((b) => b.classList.toggle("on", b.dataset.h === startSel.value));
    if (endSel) paintEnd();
  };
  // Bloqueo: el fin por defecto es una hora después del inicio.
  const paintEnd = () => {
    const from = hm(startSel.value || "10:00"),
      keep = endSel.value;
    let o = "";
    for (let t = from + 15; t <= 22 * 60; t += 15) o += `<option>${addMin("00:00", t)}</option>`;
    endSel.innerHTML = o;
    endSel.value = keep && hm(keep) > from ? keep : addMin("00:00", Math.min(from + 60, 22 * 60));
  };
  if (preset.provider && f.provider.tagName === "SELECT") f.provider.value = preset.provider;
  paint();
  if (preset.start && [...startSel.options].some((o) => o.value === preset.start && !o.disabled)) (startSel.value = preset.start), mark();
  startSel.onchange = mark;
  if (f.provider.tagName === "SELECT") f.provider.onchange = paint;
  if (f.service) f.service.onchange = paint;

  // Autocompletar: al escribir el nombre (o el teléfono) salen los clientes que
  // coinciden; al tocar uno se rellenan nombre, teléfono y correo.
  const nameIn = q("#sn-name"),
    sug = q("#sn-sug");
  if (nameIn) {
    const fill = (c) => {
      nameIn.value = c.n;
      f.phone.value = c.p || "";
      f.email.value = c.e || "";
      sug.hidden = true;
    };
    const suggest = async (src) => {
      const text = plain(src.value).trim(),
        digits = src.value.replace(/\D/g, "");
      if (text.length < 2 && digits.length < 3) return void (sug.hidden = true);
      const list = (await staffContacts()).filter((c) => (src === nameIn ? plain(c.n).includes(text) : digits.length >= 3 && String(c.p).replace(/\D/g, "").includes(digits))).slice(0, 5);
      if (document.activeElement !== src || !list.length) return void (sug.hidden = true);
      sug.innerHTML = list.map((c, i) => `<button type="button" data-i="${i}"><strong>${esc(c.n)}</strong><span>${esc([c.p, c.e].filter(Boolean).join(" · ") || "Sin teléfono")}</span></button>`).join("");
      sug.hidden = false;
      // pointerdown (y no click) para que llegue antes de que el campo pierda el foco
      sug.querySelectorAll("button").forEach((b) => b.addEventListener("pointerdown", (e) => (e.preventDefault(), fill(list[+b.dataset.i]))));
    };
    staffContacts(); // se van pidiendo mientras se elige la hora
    nameIn.oninput = () => suggest(nameIn);
    f.phone.oninput = () => !nameIn.value && suggest(f.phone);
    nameIn.onblur = f.phone.onblur = () => setTimeout(() => (sug.hidden = true), 150);
  }

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const r = await api("staff/book", { ...d, date: staffDay, block, repeat: d.every ? { every: Number(d.every), times: Number(d.times) } : null });
      availCache.clear();
      contactsP = null;
      sh.close();
      toast(block ? "Hora bloqueada." : r.series ? `${r.series.made} citas apuntadas${r.series.skipped.length ? ` (ocupado el ${r.series.skipped.map(shortDate).join(", ")})` : ""}.` : "Cita apuntada.");
      render();
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
}

// Panel del dueño: subir, cambiar, ocultar y borrar productos.
async function staffProducts() {
  let list;
  try {
    list = await loadProducts(true);
  } catch (e) {
    throw e;
  }
  if (!staff.owner) return show(staffTop("productos") + `<p class="ag-free">Los productos los lleva el dueño.</p>`);
  show(
    staffTop("productos") +
      `<div class="staff-bar"><button type="button" class="btn" id="pr-new">+ Añadir producto</button></div>` +
      (list.length
        ? `<div class="pr-admin">${list
            .map(
              (p) => `<button type="button" class="ag-item pr-row" data-edit="${esc(p.id)}">${prodImg(p, "pr-thumb")}<div><strong>${esc(p.name)}</strong><span>${p.brand ? esc(p.brand) + " · " : ""}${euro(p.price)}</span></div><span>${
                p.visible === false ? `<span class="appt-state">Oculto</span>` : p.soldOut ? `<span class="appt-state st-cancel">Agotado</span>` : `<span class="appt-state st-ok">Visible</span>`
              }</span></button>`,
            )
            .join("")}</div>`
        : `<p class="ag-free">Aún no hay productos. Pulsa «Añadir producto», hazle una foto con el móvil y ponle nombre y precio.</p>`) +
      `<p class="muted" style="margin-top:18px">Los clientes los ven en la portada y en <a href="#productos">la página de productos</a>.</p>`,
  );
  $("#pr-new").onclick = () => productSheet(null);
  $$("[data-edit]").forEach((el) => (el.onclick = () => productSheet(list.find((p) => p.id === el.dataset.edit))));
}

function productSheet(p) {
  let photo = "";
  const sh = sheet(
    `<p class="eyebrow">Producto</p><h2>${p ? "Cambiar producto" : "Nuevo producto"}</h2>
    <form id="pr-form">
      <label class="pr-photo" id="pr-photo">${p?.img ? prodImg(p) : `<span>${svg(ICONS.camera)}Hacer o elegir foto</span>`}<input type="file" accept="image/*" class="sr-only" id="pr-file"></label>
      <label for="pr-name">Nombre</label><input id="pr-name" name="name" required maxlength="80" value="${esc(p?.name || "")}" placeholder="Cera mate">
      <label for="pr-brand">Marca <small>(opcional)</small></label><input id="pr-brand" name="brand" maxlength="60" value="${esc(p?.brand || "")}">
      <label for="pr-price">Precio</label><div class="pct-field"><input id="pr-price" name="price" required inputmode="decimal" value="${p ? String(p.price).replace(".", ",") : ""}" placeholder="12"><span>€</span></div>
      <label for="pr-desc">Descripción <small>(opcional)</small></label><textarea id="pr-desc" name="desc" rows="3" maxlength="400" placeholder="Para qué sirve, cómo se usa…">${esc(p?.desc || "")}</textarea>
      <label class="check"><input type="checkbox" name="visible" ${p?.visible === false ? "" : "checked"}><span>Visible para los clientes</span></label>
      <label class="check" style="margin-top:10px"><input type="checkbox" name="soldOut" ${p?.soldOut ? "checked" : ""}><span>Agotado ahora mismo</span></label>
      <button class="btn wide" style="margin-top:18px" type="submit">Guardar</button>
      ${p ? `<button type="button" class="btn wide danger" style="margin-top:10px" id="pr-del">Borrar producto</button>` : ""}
    </form>`,
  );
  const f = sh.el.querySelector("#pr-form");
  sh.el.querySelector("#pr-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      photo = await shrinkImage(file, 640);
      const box = sh.el.querySelector("#pr-photo");
      box.querySelector("img, span")?.remove();
      box.insertAdjacentHTML("afterbegin", `<img src="${photo}" alt="">`);
    } catch {
      toast("No se ha podido leer esa foto.");
    }
  };
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(f),
      btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await api("staff/products", { id: p?.id, name: d.get("name"), brand: d.get("brand"), price: d.get("price"), desc: d.get("desc"), visible: d.get("visible") === "on", soldOut: d.get("soldOut") === "on", photo });
      sh.close();
      toast("Producto guardado.");
      render();
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
  const del = sh.el.querySelector("#pr-del");
  if (del)
    del.onclick = async () => {
      if (del.dataset.sure !== "1") {
        del.dataset.sure = "1";
        del.textContent = "Pulsa otra vez para borrar";
        return;
      }
      try {
        await api("staff/products", { id: p.id, delete: true });
        sh.close();
        toast("Producto borrado.");
        render();
      } catch (err) {
        toast(err.message);
      }
    };
}

// ── Clientes (solo el dueño): quién viene, a quién le toca y quién se ha perdido ──
let clientFilter = "perdido";

const STATUS_CL = { perdido: ["Se ha perdido", "st-cancel"], "le-toca": ["Le toca", "st-wait"], "con-cita": ["Tiene cita", "st-ok"], "al-dia": ["Al día", "st-done"], nuevo: ["Nuevo", ""] };

// Borrar los datos de un cliente que lo pide (solo el dueño).
function eraseSheet() {
  const sh = sheet(
    `<p class="eyebrow">Derecho de supresión</p><h2>Borrar los datos de un cliente</h2>
     <form id="er-find" style="margin-top:14px"><label for="er-q" style="margin-top:0">Su correo, su código del Club o su teléfono</label>
     <div class="form-actions" style="margin-top:0"><input id="er-q" name="q" required autocomplete="off" style="flex:2"><button class="btn" type="submit">Buscar</button></div></form>
     <div id="er-out"></div>`,
  );
  const out = sh.el.querySelector("#er-out");
  sh.el.querySelector("#er-q").focus();
  sh.el.querySelector("#er-find").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim(),
      btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const { preview: p } = await api("staff/clients/erase", { q, dry: true });
      const block = p.active ? "Tiene citas pendientes: cancélalas antes en la Agenda." : p.owes ? "Tiene un cobro por falta sin cerrar: decide antes en «Faltas» si se cobra." : "";
      out.innerHTML = `<div class="card er-who"><strong>${esc(p.name || "Sin nombre")}</strong><span>${esc([p.email, p.phone].filter(Boolean).join(" · ") || "Sin datos de contacto")}</span>
          <ul><li>${p.account ? "Su cuenta del Club" + (p.points ? ` y sus ${nf(p.points)} puntos` : "") : "No tiene cuenta (lo apuntó el equipo)"}</li><li>${p.bookings} ${p.bookings === 1 ? "cita se queda" : "citas se quedan"} sin nombre ni contacto</li><li>Los cobros no se tocan</li></ul></div>` +
        (block
          ? `<p class="warning">${esc(block)}</p>`
          : `<form id="er-go"><label for="er-c">Escribe <b>BORRAR</b> para confirmar. No se puede deshacer.</label><input id="er-c" name="confirm" autocomplete="off" autocapitalize="characters" required>
             <button class="btn wide danger" style="margin-top:12px" type="submit">Borrar sus datos</button></form>`);
      const go = out.querySelector("#er-go");
      if (go)
        go.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const b2 = ev.target.querySelector("[type=submit]");
          b2.disabled = true;
          try {
            const r = await api("staff/clients/erase", { q, confirm: ev.target.confirm.value });
            sh.close();
            toast(`Datos de ${r.name || "ese cliente"} borrados.`);
            render();
          } catch (err) {
            b2.disabled = false;
            toast(err.message);
          }
        });
    } catch (err) {
      out.innerHTML = `<p class="warning">${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

async function staffClients() {
  if (!staff.owner) return show(staffTop("clientes") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const [r, n] = await Promise.all([api("staff/clients"), api("staff/rules")]);
  const list = r.list.filter((c) => clientFilter === "todos" || c.status === clientFilter);
  const habitTxt = (c) =>
    c.habit ? `${cap(DAY_LONG[c.habit.weekday]).slice(0, 3)} ${c.habit.start || ""}${provById(c.habit.provider) ? " · " + first(provById(c.habit.provider).name) : ""}${c.every ? " · " + everyText(c.every) : ""}` : "";
  const msg = (c) => `Hola ${first(c.name) || ""}, soy ${first(staff.name)} de NOVA Studio. ${n.winbackText}${n.winbackOffer ? " " + n.winbackOffer : ""}`;
  show(
    staffTop("clientes") +
      `<div class="stat3 money"><div><strong>${r.stats.lost}</strong><span>Se han perdido</span></div><div><strong>${r.stats.due}</strong><span>Les toca</span></div><div><strong>${r.stats.booked}</strong><span>Con cita</span></div></div>
      <div class="tr-filter">${[["perdido", "Se han perdido", r.stats.lost], ["le-toca", "Les toca", r.stats.due], ["con-cita", "Con cita", r.stats.booked], ["todos", "Todos", r.stats.total]]
        .map(([k, l, c]) => `<button type="button" class="${clientFilter === k ? "on" : ""}" data-cf="${k}">${l} <small>${c}</small></button>`)
        .join("")}</div>
      ${
        list.length
          ? list
              .map((c) => {
                const [st, cls] = STATUS_CL[c.status] || STATUS_CL.nuevo;
                return `<article class="card cl-item">
                  <div class="tr-item-top"><div><strong>${esc(c.name || c.email)}</strong><span>${c.visits} ${c.visits === 1 ? "visita" : "visitas"}${c.last ? ` · última hace ${c.since} días` : ""}${c.next ? ` · cita el ${esc(shortDate(c.next.date))} ${esc(c.next.start)}` : ""}</span></div><span class="appt-state ${cls}">${st}</span></div>
                  ${habitTxt(c) ? `<p class="tr-line">🗓 Suele venir: ${esc(habitTxt(c))}</p>` : ""}
                  ${c.contacted ? `<p class="tr-line muted">Contactado el ${esc(shortDate(c.contacted.at.slice(0, 10)))} por ${c.contacted.channel === "email" ? "correo" : "WhatsApp"}${c.contacted.by === "auto" ? " (automático)" : ""}</p>` : ""}
                  ${c.status !== "con-cita" ? `<div class="form-actions" style="margin-top:10px">${
                    c.phone ? `<a class="btn small wa-btn" target="_blank" rel="noopener" data-wa="${esc(c.email)}" href="https://wa.me/${esc(c.phone.replace(/\D/g, ""))}?text=${encodeURIComponent(msg(c))}">WhatsApp</a>` : ""
                  }${c.email && !c.optout ? `<button type="button" class="btn small secondary" data-mail="${esc(c.email)}" >${r.sim ? "Enviar correo (simulado)" : "Enviar correo"}</button>` : c.optout ? `<span class="muted" style="font-size:12px">No quiere correos</span>` : ""}</div>` : ""}
                </article>`;
              })
              .join("")
          : `<p class="ag-free">Nadie en esta lista. 🙌</p>`
      }
      <p class="muted" style="font-size:13px;margin:14px 0 0">Cuántas semanas sin venir son «perdido», el mensaje y el envío automático se ajustan en <a href="#equipo/avisos">Avisos y reseñas</a>.</p>
      <p class="section-label">Borrar los datos de un cliente</p>
      <div class="card"><p class="muted" style="margin:0 0 12px;font-size:14px;line-height:1.5">Si alguien te pide que borres sus datos, búscalo aquí. Se borran su cuenta y sus puntos; sus citas se quedan sin nombre ni contacto (para que cuadren las cuentas) y los cobros se guardan, como manda la ley. Las cuentas que pasan 3 años sin uso se borran solas.</p>
      <button type="button" class="btn wide secondary" id="cl-erase">Buscar a quién borrar</button></div>`,
  );
  $("#cl-erase").onclick = eraseSheet;
  $$("[data-cf]").forEach((b) => (b.onclick = () => ((clientFilter = b.dataset.cf), render())));
  $$("[data-wa]").forEach((a) => a.addEventListener("click", () => api("staff/clients/contact", { email: a.dataset.wa, channel: "whatsapp" }).catch(() => {})));
  $$("[data-mail]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const x = await api("staff/clients/contact", { email: b.dataset.mail, channel: "email" });
          toast(x.status === "simulado" ? "Simulado: anotado en el historial, no se ha enviado." : "Correo enviado.");
          render();
        } catch (e) {
          b.disabled = false;
          toast(e.message);
        }
      }),
  );
}

// ── Avisos y reseñas (solo el dueño) ───────────────────────────────────────
// Clientes dormidos, peticiones de reseña de Google y registro de envíos. Sin
// correo activo (o en demo) los avisos no salen: quedan «simulados» en el registro.
const NOTICE_ST = { enviado: ["Enviado", "st-ok"], simulado: ["Simulado", "st-wait"], fallido: ["Falló", "st-cancel"] };
const REVIEW_SRC = { panel: "el enlace de arriba", env: "GOOGLE_REVIEW_URL", google: "tu ficha de Google (pestaña Web)", "": "ninguno todavía" };
async function staffAvisos() {
  if (!staff.owner) return show(staffTop("avisos") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const [r, n] = await Promise.all([api("staff/avisos"), api("staff/rules")]);
  const c = r.config;
  const st = (x) => {
    const [t, cls] = NOTICE_ST[x] || NOTICE_ST.enviado;
    return `<span class="appt-state ${cls}">${t}</span>`;
  };
  const noticeTxt = (x) => `${esc(shortDate(x.at.slice(0, 10)))} · ${x.type === "resena" ? "Reseña" : "Dormido"}`;
  show(
    staffTop("avisos") +
      (r.sim ? `<p class="warning">${r.mail ? "Modo demo" : "El correo no está activado"}: los avisos NO se envían, se anotan como «simulado» en el historial.</p>` : "") +
      `<p class="section-label">Clientes dormidos <small>(${r.dormant.length})</small></p>
      ${
        r.dormant.length
          ? r.dormant
              .map(
                (d) => `<article class="card cl-item">
          <div class="tr-item-top"><div><strong>${esc(d.name)}</strong><span>Última visita ${esc(shortDate(d.last))} · ${d.weeks} semanas</span></div>${d.due ? `<span class="appt-state st-wait">Toca avisar</span>` : ""}</div>
          <p class="tr-line muted">${d.lastNotice ? `Último aviso: ${esc(shortDate(d.lastNotice.at.slice(0, 10)))}${d.lastNotice.simulated ? " (simulado)" : ""}${d.lastNotice.by === "auto" ? " · automático" : ""}` : "Aún sin aviso"}</p>
          <div class="form-actions" style="margin-top:10px">${d.optout ? `<span class="muted" style="font-size:12px">No quiere correos</span>` : `<button type="button" class="btn small secondary" data-notice="${esc(d.email)}">Enviar aviso</button>`}</div>
        </article>`,
              )
              .join("")
          : `<p class="ag-free">Nadie lleva ${c.dormantWeeks} semanas sin venir. 🙌</p>`
      }
      <p class="section-label">Peticiones de reseña recientes</p>
      ${
        r.reviews.length
          ? r.reviews
              .map(
                (x) => `<article class="card cl-item">
          <div class="tr-item-top"><div><strong>${esc(x.name || x.email)}</strong><span>${esc(x.service || "")} · cita del ${esc(shortDate(x.date))}</span></div>${st(x.status)}</div>
          <p class="tr-line muted">Pedida el ${esc(shortDate(x.at.slice(0, 10)))}${x.reviewed ? " · ya ha pulsado «Dejar mi reseña»" : ""}</p>
          <div class="form-actions" style="margin-top:10px"><button type="button" class="btn small secondary" data-resend="${esc(x.bookingId)}">Reenviar</button></div>
        </article>`,
              )
              .join("")
          : `<p class="ag-free">Todavía no se ha pedido ninguna reseña.</p>`
      }
      <p class="section-label">Configuración</p>
      <form id="av" class="card norms">
        <label class="check" style="margin-top:0"><input type="checkbox" name="winbackAuto" ${c.auto ? "checked" : ""}><span>Avisar solos a los clientes dormidos (un correo cada ese mismo número de semanas como mucho, con enlace para darse de baja; nunca a quien ya tiene cita)</span></label>
        <label for="av-w">Un cliente está dormido si lleva sin venir</label>
        <div class="pct-field"><input id="av-w" name="dormantWeeks" inputmode="numeric" value="${c.dormantWeeks}"><span>semanas</span></div>
        <label for="av-t">Mensaje</label><textarea id="av-t" name="winbackText" rows="3" maxlength="600">${esc(n.winbackText)}</textarea>
        <label for="av-o">Oferta <small>(opcional)</small></label><input id="av-o" name="winbackOffer" maxlength="200" value="${esc(n.winbackOffer)}" placeholder="Ej.: 10 % en tu próximo corte esta semana">
        <label class="check"><input type="checkbox" name="reviews" ${c.reviews ? "checked" : ""}><span>Pedir reseña de Google por correo, una hora después de cada cita completada</span></label>
        <label for="av-u">Enlace de reseña <small>(si lo pones aquí, manda sobre el resto)</small></label>
        <input id="av-u" name="reviewUrl" type="url" inputmode="url" placeholder="https://g.page/r/…/review" value="${esc(c.reviewUrl)}">
        <p class="muted" style="font-size:12px;margin:6px 0 0">Ahora se usa: ${esc(REVIEW_SRC[c.reviewSource] || "")}.</p>
        <label for="av-g">Como mucho una petición a cada cliente cada</label>
        <div class="pct-field"><input id="av-g" name="reviewGapDays" inputmode="numeric" value="${c.reviewGapDays}"><span>días</span></div>
        <button class="btn wide" style="margin-top:14px" type="submit">Guardar</button>
      </form>
      <p class="section-label">Historial de envíos</p>
      ${
        r.log.length
          ? `<div class="card">${r.log.map((x) => `<p class="tr-line" style="margin:0 0 8px">${noticeTxt(x)} · ${esc(x.name || x.email)} ${st(x.status)}</p>`).join("")}</div>`
          : `<p class="ag-free">Aún no hay avisos.</p>`
      }`,
  );
  const run = (btn, path, body, okMsg) =>
    (btn.onclick = async () => {
      btn.disabled = true;
      try {
        const x = await api(path, body(btn));
        toast(x.status === "simulado" ? "Simulado: anotado en el historial, no se ha enviado." : okMsg);
        render();
      } catch (e) {
        btn.disabled = false;
        toast(e.message);
      }
    });
  $$("[data-notice]").forEach((b) => run(b, "staff/clients/contact", (x) => ({ email: x.dataset.notice, channel: "email" }), "Aviso enviado."));
  $$("[data-resend]").forEach((b) => run(b, "staff/avisos/resena", (x) => ({ bookingId: x.dataset.resend }), "Petición reenviada."));
  onForm("av", async (d) => {
    await api("staff/rules", {
      dormantWeeks: d.dormantWeeks,
      winbackText: d.winbackText,
      winbackOffer: d.winbackOffer,
      winbackAuto: d.winbackAuto === "on",
      reviews: d.reviews === "on",
      reviewUrl: d.reviewUrl,
      reviewGapDays: d.reviewGapDays,
    });
    toast("Guardado.");
    render();
  });
}


// Estado de las tareas automáticas (recordatorios y correos).
function autoStatus(n) {
  if (!n.mail) return `<p class="warning" style="margin-top:12px">Los correos aún no se envían: falta activar el servicio de correo. Las opciones quedan guardadas y empezarán a funcionar en cuanto se active.</p>`;
  if (!n.cron) return `<p class="warning" style="margin-top:12px">Falta activar las tareas automáticas en Vercel (variable CRON_SECRET) para que salgan los recordatorios.</p>`;
  // La pasada de cada hora y la diaria se guardan aparte: así lo de la mañana no se pisa a la hora siguiente.
  const c = n.lastCron,
    d = n.lastDaily;
  return c
    ? `<p class="muted" style="font-size:12px;margin-top:10px">Última pasada: ${esc(c.at)}${c.error ? ` · <b>falló: ${esc(c.error)}</b>` : ""} · ${c.soon || 0} recordatorios de hoy${c.reviews ? ` · ${c.reviews} reseñas pedidas` : ""}${c.rebook ? ` · ${c.rebook} «¿cuándo vuelves?»` : ""}${
        d
          ? `<br>Pasada diaria (${esc(d.at)}): ${d.reminders || 0} recordatorios de mañana${d.winback ? ` · ${d.winback} correos a clientes perdidos` : ""}${d.purge?.warned ? ` · ${d.purge.warned} avisos de cuenta sin uso` : ""}${d.purge?.erased ? ` · ${d.purge.erased} cuentas sin uso borradas` : ""}`
          : ""
      }</p>`
    : "";
}

// ── Copia de seguridad (solo el dueño) ─────────────────────────────────────
const backupBlock = () => `<p class="section-label">Copia de seguridad</p>
  <div class="card">
    <p class="muted" style="margin-top:0">Descarga todos los datos (clientes, citas, cobros, Club, ajustes) en un archivo y guárdalo en tu ordenador o en Drive. Los lunes también te llega una copia por correo, cuando el correo esté activado.</p>
    <div class="stack"><a class="btn wide" href="/api/staff/backup?part=data" download>Descargar datos</a><a class="btn wide secondary" href="/api/staff/backup?part=photos" download>Descargar fotos</a>
    <label class="btn wide secondary" style="margin:0">Recuperar desde una copia<input type="file" accept="application/json,.json" class="sr-only" id="bk-file"></label></div>
  </div>`;

// Datos de prueba: clientes, citas, cobros y ranking ficticios para ver la app
// con vida. Se borran de una vez y no tocan nada de verdad.
async function demoBox() {
  const box = $("#demo-box");
  if (!box) return;
  let st;
  try {
    st = await api("staff/demo");
  } catch (e) {
    box.innerHTML = `<p class="muted" style="margin:0">${esc(e.message)}</p>`;
    return;
  }
  const n = (x) => Number(x || 0).toLocaleString("es-ES");
  box.innerHTML = st.loaded
    ? `<p style="margin-top:0"><b>Están cargados</b> desde el ${esc(shortDate(st.at.slice(0, 10)))}: ${n(st.users)} clientes ficticios, ${n(st.bookings)} citas y ${n(st.pays)} cobros.</p>
       <p class="muted">Salen en la agenda, la caja, el progreso y el ranking del Club. Bórralos antes de empezar con clientes de verdad.</p>
       <button type="button" class="btn wide secondary" id="demo-clear">Borrar los datos de prueba</button>`
    : `<p class="muted" style="margin-top:0">Carga unos 36 clientes ficticios con casi un año de citas y cobros con cada barbero, citas para los próximos días y puntos del Club, para ver la agenda, la caja, el progreso y el ranking en marcha. Sus correos son inventados: nunca se les escribe. Luego se borran de una vez, sin tocar nada de verdad.</p>
       <button type="button" class="btn wide" id="demo-load">Cargar datos de prueba</button>`;
  const run = async (btn, action, msg) => {
    btn.disabled = true;
    btn.textContent = action === "load" ? "Cargando… (puede tardar un minuto)" : "Borrando…";
    try {
      const r = await api("staff/demo", { action });
      toast(msg(r));
      contactsP = null;
      demoBox();
    } catch (e) {
      toast(e.message);
      demoBox();
    }
  };
  const load = $("#demo-load");
  if (load) load.onclick = () => run(load, "load", (r) => `Listo: ${n(r.users)} clientes, ${n(r.bookings)} citas y ${n(r.pays)} cobros de prueba.`);
  const clear = $("#demo-clear");
  if (clear)
    clear.onclick = () => {
      const sh = sheet(`<p class="eyebrow">Datos de prueba</p><h2>¿Borrar los datos de prueba?</h2><p class="muted">Se quitan los clientes ficticios, sus citas, sus cobros y sus puntos. Lo de verdad no se toca.</p><div class="stack"><button type="button" class="btn wide" id="demo-yes">Sí, borrarlos</button><button type="button" class="btn wide secondary" id="demo-no">Cancelar</button></div>`);
      sh.el.querySelector("#demo-no").onclick = () => sh.close();
      sh.el.querySelector("#demo-yes").onclick = () => {
        sh.close();
        run(clear, "clear", (r) => `Borrados ${n(r.users)} clientes y ${n(r.bookings)} citas de prueba.`);
      };
    };
}

function bindBackup() {
  const f = $("#bk-file");
  if (!f) return;
  f.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      return toast("Ese archivo no se puede leer.");
    }
    if (backup?.app !== "nova-reservas") return toast("Ese archivo no es una copia de esta app.");
    const sh = sheet(
      `<p class="eyebrow">Copia del ${esc(String(backup.created || "").slice(0, 16))}</p><h2>¿Recuperar esta copia?</h2>
      <p class="muted">Trae ${backup.count} registros (${backup.part === "photos" ? "fotos" : "datos"}). Se escriben encima de lo que haya con el mismo nombre; lo que no venga en la copia se queda como está.</p>
      <form id="rs"><label for="rs-c">Escribe RESTAURAR para confirmar</label><input id="rs-c" name="confirm" autocomplete="off" required>
      <button class="btn wide danger" style="margin-top:14px" type="submit">Recuperar</button></form>`,
    );
    sh.el.querySelector("#rs").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        const r = await api("staff/restore", { confirm: new FormData(ev.target).get("confirm"), backup });
        sh.close();
        toast(`Copia recuperada: ${r.written} registros.`);
        (catalog = null), (catalogBust = true);
        await loadCatalog();
        render();
      } catch (err) {
        toast(err.message);
      }
    });
  };
}

// ── Servicios (solo el dueño): crear, cambiar, ordenar y activar/desactivar ──
const SVC_ICON_OPTS = [["scissors", "Tijeras"], ["beard", "Barba"], ["star", "Estrella"], ["moon", "Luna"], ["crown", "Corona"], ["drop", "Gota"], ["gem", "Diamante"], ["bolt", "Rayo"]];

async function staffServices() {
  if (!staff.owner) return show(staffTop("servicios") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const r = await api("staff/services");
  show(
    staffTop("servicios") +
      `<p class="muted" style="margin-top:0">Lo que ven los clientes al reservar. Desactiva uno para quitarlo de la web sin borrarlo; las citas que ya tengan se quedan como estaban.</p>
      <div class="svc-admin">${r.services
        .map(
          (x, i) => `<div class="ag-item sv-row${x.active === false ? " off" : ""}">
            <button type="button" class="sv-main" data-sv="${esc(x.id)}"><span class="svc-ic">${svcIcon(x.icon)}</span><span><strong>${esc(x.name)}</strong><small>${x.consult ? "Por WhatsApp" : `${x.duration} min`} · ${x.price != null ? euro(x.price) : "Consultar"}${x.providers?.length ? " · solo " + esc(x.providers.map((id) => first(r.team.find((p) => p.id === id)?.name || id)).join(", ")) : ""}</small></span></button>
            <span class="sv-side"><label class="switch" title="Activo"><input type="checkbox" data-act="${esc(x.id)}" ${x.active === false ? "" : "checked"}><i></i></label>
            <span class="sv-move"><button type="button" data-up="${esc(x.id)}" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button><button type="button" data-down="${esc(x.id)}" ${i === r.services.length - 1 ? "disabled" : ""} aria-label="Bajar">↓</button></span></span>
          </div>`,
        )
        .join("")}</div>
      <button type="button" class="btn wide" style="margin-top:12px" id="sv-new">+ Añadir servicio</button>`,
  );
  const reload = async () => {
    (catalog = null), (catalogBust = true);
    await loadCatalog();
    render();
  };
  const save = async (x, extra) => {
    try {
      await api("staff/services", { ...x, ...extra });
      reload();
    } catch (e) {
      toast(e.message);
      render();
    }
  };
  $$("[data-act]").forEach((c) => (c.onchange = () => save(r.services.find((x) => x.id === c.dataset.act), { active: c.checked })));
  $$("[data-up]").forEach((b) => (b.onclick = () => save(r.services.find((x) => x.id === b.dataset.up), { move: "up" })));
  $$("[data-down]").forEach((b) => (b.onclick = () => save(r.services.find((x) => x.id === b.dataset.down), { move: "down" })));
  $$("[data-sv]").forEach((b) => (b.onclick = () => serviceSheet(r.services.find((x) => x.id === b.dataset.sv), r.team, reload)));
  $("#sv-new").onclick = () => serviceSheet(null, r.team, reload);
}

function serviceSheet(x, team, reload) {
  const durs = [];
  for (let m = 15; m <= 240; m += 15) durs.push(m);
  const sh = sheet(
    `<p class="eyebrow">Servicio</p><h2>${x ? esc(x.name) : "Nuevo servicio"}</h2>
    <form id="sv-form">
      <label for="sv-n" style="margin-top:0">Nombre</label><input id="sv-n" name="name" required maxlength="50" value="${esc(x?.name || "")}" placeholder="Corte y barba">
      <label for="sv-d">Descripción corta <small id="sv-cnt">(${(x?.desc || "").length}/80)</small></label><textarea id="sv-d" name="desc" rows="2" maxlength="80">${esc((x?.desc || "").slice(0, 80))}</textarea>
      <div class="form-row2"><div><label for="sv-t">Duración</label><select id="sv-t" name="duration">${durs.map((m) => `<option value="${m}" ${(x?.duration || 30) === m ? "selected" : ""}>${m} min</option>`).join("")}</select></div>
      <div><label for="sv-p">Precio (€)</label><input id="sv-p" name="price" inputmode="decimal" value="${x?.price != null ? Number(x.price).toFixed(2).replace(".", ",").replace(",00", "") : ""}"></div></div>
      <label for="sv-i">Icono</label><select id="sv-i" name="icon">${SVC_ICON_OPTS.map(([k, l]) => `<option value="${k}" ${(x?.icon || "scissors") === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label>¿Quién lo hace? <small>(sin marcar = todo el equipo)</small></label>
      <div class="tchips">${team.map((p) => `<label class="tchip"><input type="checkbox" name="providers" value="${esc(p.id)}" ${x?.providers?.includes(p.id) ? "checked" : ""}><span>${esc(first(p.name))}</span></label>`).join("")}</div>
      <label class="check"><input type="checkbox" name="consult" ${x?.consult ? "checked" : ""}><span>No se reserva en la app: se habla por WhatsApp (sale en «Fuera de carta»)</span></label>
      <label class="check" style="margin-top:10px"><input type="checkbox" name="active" ${x?.active === false ? "" : "checked"}><span>Activo (se ve en la web)</span></label>
      <button class="btn wide" style="margin-top:16px" type="submit">Guardar</button>
      ${x ? `<button type="button" class="btn wide danger" style="margin-top:10px" id="sv-del">Borrar servicio</button>` : ""}
    </form>`,
  );
  const f = sh.el.querySelector("#sv-form");
  f.desc.oninput = () => (sh.el.querySelector("#sv-cnt").textContent = `(${f.desc.value.length}/80)`);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(f);
    try {
      await api("staff/services", { id: x?.id, name: d.get("name"), desc: d.get("desc"), duration: d.get("duration"), price: d.get("price"), icon: d.get("icon"), providers: d.getAll("providers"), consult: d.get("consult") === "on", active: d.get("active") === "on" });
      sh.close();
      toast("Servicio guardado. Ya se ve en la web.");
      reload();
    } catch (err) {
      toast(err.message);
    }
  });
  const del = sh.el.querySelector("#sv-del");
  if (del)
    del.onclick = async () => {
      if (del.dataset.sure !== "1") {
        del.dataset.sure = "1";
        del.textContent = "Pulsa otra vez (mejor desactívalo si lo vas a volver a usar)";
        return;
      }
      try {
        await api("staff/services", { id: x.id, delete: true });
        sh.close();
        toast("Servicio borrado.");
        reload();
      } catch (err) {
        toast(err.message);
      }
    };
}

// ── Vacaciones y días libres ───────────────────────────────────────────────
// El barbero no sale para reservar esos días. El dueño lo pone para cualquiera.
async function offSheet() {
  let team = catalog.providers;
  const who = staff.owner ? team : team.filter((p) => p.id === staff.id);
  const today = isoDay(salonDate ? salonDate() : new Date());
  const sh = sheet(
    `<p class="eyebrow">Vacaciones y días libres</p><h2>Bloquear días</h2>
    <p class="muted" style="margin-top:0">Esos días no saldrá para reservar. Para unas horas sueltas, usa «Bloquear hora» en la agenda.</p>
    <form id="off-form">
      ${staff.owner ? `<label for="off-p" style="margin-top:0">Barbero</label><select id="off-p" name="provider">${who.map((p) => `<option value="${esc(p.id)}" ${p.id === staff.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>` : `<input type="hidden" name="provider" value="${esc(staff.id)}">`}
      <div class="form-row2 even"><div><label for="off-f">Desde</label><input id="off-f" name="from" type="date" required min="${today}" value="${today}"></div><div><label for="off-t">Hasta (incluido)</label><input id="off-t" name="to" type="date" required min="${today}" value="${today}"></div></div>
      <label for="off-n">Motivo <small>(opcional)</small></label><input id="off-n" name="note" maxlength="60" placeholder="Vacaciones, formación…">
      <button class="btn wide" style="margin-top:16px" type="submit">Bloquear esos días</button>
    </form>
    <div id="off-list"></div>`,
  );
  const f = sh.el.querySelector("#off-form");
  const list = async () => {
    const pid = f.provider.value;
    const t = staff.owner ? (await api("staff/team")).team : null;
    const p = (t || team).find((x) => x.id === pid);
    const off = (p?.off || []).filter((r) => r.to >= today);
    sh.el.querySelector("#off-list").innerHTML = off.length
      ? `<p class="section-label">Ya bloqueado</p>${off.map((r) => `<div class="ag-item off-row"><div><strong>${esc(shortDate(r.from))}${r.to !== r.from ? " – " + esc(shortDate(r.to)) : ""}</strong><span>${esc(r.note || "Días libres")}</span></div><button type="button" class="tr-del" data-unoff="${esc(r.from)}|${esc(r.to)}">Quitar</button></div>`).join("")}`
      : "";
    sh.el.querySelectorAll("[data-unoff]").forEach(
      (b) =>
        (b.onclick = async () => {
          const [from, to] = b.dataset.unoff.split("|");
          try {
            await api("staff/off", { provider: pid, from, to, delete: true });
            toast("Días desbloqueados.");
            (catalog = null), (catalogBust = true);
            await loadCatalog();
            availCache.clear();
            team = catalog.providers;
            list();
          } catch (e) {
            toast(e.message);
          }
        }),
    );
  };
  if (f.provider.tagName === "SELECT") f.provider.onchange = list;
  f.from.onchange = () => {
    if (f.to.value < f.from.value) f.to.value = f.from.value;
    f.to.min = f.from.value;
  };
  list().catch(() => {});
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(f);
    try {
      const r = await api("staff/off", { provider: d.get("provider"), from: d.get("from"), to: d.get("to"), note: d.get("note") });
      availCache.clear();
      (catalog = null), (catalogBust = true);
      await loadCatalog();
      team = catalog.providers;
      toast(r.clash.length ? `Bloqueado. Ojo: hay ${r.clash.length} ${r.clash.length === 1 ? "cita" : "citas"} esos días; muévelas o cancélalas desde la agenda.` : "Días bloqueados.");
      list();
      render();
    } catch (err) {
      toast(err.message);
    }
  });
}

// Reduce la foto en el móvil antes de subirla, sin recortarla, hasta que pese poco.
async function shrinkFit(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return encodeLight(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function staffWeb() {
  if (!staff.owner) return show(staffTop("web") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const r = await api("staff/site");
  const R = r.rating,
    G = r.google,
    src = R.want === "google" ? "Google" : "Booksy",
    when = R.at ? new Date(R.at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  // Reseñas: de la ficha de Google cuando hay clave y ficha elegida; si no, de Booksy.
  const wrStatus = R.mode === "manual" ? "Puestas a mano" : R.ok === false ? `${esc(R.err || `No se pudo leer ${src}.`)} · ${esc(when)}` : `Se leen solas de ${src} · última vez ${esc(when)}`;
  const gBlock = !G.ready
    ? `<p class="wr-g muted">Para enseñar las reseñas de Google falta la clave de Google en Vercel (<code>GOOGLE_PLACES_KEY</code>). Mientras, salen de Booksy.</p>`
    : G.placeId
      ? `<div class="wr-g"><p><b>Ficha de Google:</b> ${esc(G.name || G.placeId)}${G.address ? `<small>${esc(G.address)}</small>` : ""}${G.test ? `<small>Ficha de prueba: en local y sin clave de Google.</small>` : ""}</p>
        <div class="form-actions"><button type="button" class="btn secondary" id="wg-find">Cambiar de ficha</button><button type="button" class="btn secondary" id="wg-off">Quitar</button></div></div>`
      : `<div class="wr-g"><p><b>Elige tu ficha de Google</b> y la web enseñará sus reseñas en vez de las de Booksy.</p><button type="button" class="btn wide" id="wg-find">Buscar mi ficha</button></div>`;
  show(
    staffTop("web") +
      `<p class="section-label">Aviso temporal</p>
      <form id="nt" class="card norms">
        <label class="check" style="margin-top:0"><input type="checkbox" name="on" ${r.notice.on ? "checked" : ""}><span>Enseñar un aviso arriba de la web</span></label>
        <label for="nt-t">Texto <small>(máx. 160)</small></label><textarea id="nt-t" name="text" rows="2" maxlength="160" placeholder="Ej.: Del 24 al 31 de diciembre abrimos de 9:00 a 14:00.">${esc(r.notice.text || "")}</textarea>
        <div class="form-row2"><div><label for="nt-u">Se quita solo el <small>(opcional)</small></label><input id="nt-u" name="until" type="date" value="${esc(r.notice.until || "")}"></div>
        <div><label for="nt-c">Color</label><select id="nt-c" name="tone"><option value="info" ${r.notice.tone !== "alerta" ? "selected" : ""}>Normal</option><option value="alerta" ${r.notice.tone === "alerta" ? "selected" : ""}>Llamativo</option></select></div></div>
        <button class="btn wide" style="margin-top:14px" type="submit">Guardar aviso</button>
      </form>
      <p class="section-label">Contacto</p>
      <form id="ct" class="card norms">
        <label for="ct-s" style="margin-top:0">Dirección</label><input id="ct-s" name="street" maxlength="80" value="${esc(r.contact.street)}">
        <label for="ct-c">Localidad</label><input id="ct-c" name="city" maxlength="80" value="${esc(r.contact.city)}">
        <label for="ct-m">Enlace de Google Maps</label><input id="ct-m" name="maps" inputmode="url" value="${esc(r.contact.maps)}" placeholder="https://maps.app.goo.gl/…">
        <label for="ct-w">WhatsApp <small>(con prefijo)</small></label><input id="ct-w" name="whatsapp" inputmode="tel" value="${esc(r.contact.whatsapp)}">
        <label for="ct-i">Instagram <small>(usuario o enlace)</small></label><input id="ct-i" name="instagram" value="${esc(r.contact.instagram)}">
        <p class="muted" style="font-size:12px;margin:10px 0 0">El mapa de la portada se saca de la dirección.</p>
        <button class="btn wide" style="margin-top:14px" type="submit">Guardar contacto</button>
      </form>
      <p class="section-label">Tema de la web</p>
      <div class="theme-pick">${[
        ["plata", "Plata", "Gris y negro, con el logo plateado en la portada."],
        ["rosa", "Rosa", "El rosa del logo, con la portada rosa de antes."],
      ]
        .map(
          ([id, name, txt]) =>
            `<button type="button" class="tp tp-${id}${(r.theme || "plata") === id ? " on" : ""}" data-theme-set="${id}" aria-pressed="${(r.theme || "plata") === id}"><span class="tp-sw" aria-hidden="true"><i></i><i></i><i></i></span><strong>${name}</strong><small>${txt}</small></button>`,
        )
        .join("")}</div>
      <p class="section-label">Reseñas</p>
      <div class="card web-rating">
        <div class="wr-now"><strong>★ ${esc(R.shown.score)}</strong><span>${R.shown.count} reseñas de ${esc(R.shown.source)}<small>${wrStatus}</small></span></div>
        <div class="form-actions" style="margin-top:12px"><button type="button" class="btn secondary" id="wr-auto">${R.mode === "manual" ? `Volver a leerlas de ${src}` : "Actualizar ahora"}</button><button type="button" class="btn secondary" id="wr-manual">Poner a mano</button></div>
        ${gBlock}
      </div>
      <p class="section-label">Fotos de la web</p>
      <p class="muted" style="margin-top:-4px">Toca una foto para cambiarla. Se ve al momento en la web; puedes volver a la original cuando quieras.</p>
      <div class="web-grid">${r.slots
        .map((x) => {
          const mine = !!r.photos[x.id];
          const src = mine ? `/api/site/${x.id}/photo?v=${esc(r.photos[x.id])}` : x.def;
          return `<button type="button" class="web-slot" data-slot="${esc(x.id)}"><span class="ws-pic${x.id === "hero-wide" ? " wide" : ""}${x.logo ? " logo" : ""}">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<span class="ws-add">${svg(ICONS.camera)}Añadir</span>`}${mine && x.def ? `<em>Tuya</em>` : ""}</span><strong>${esc(x.label)}</strong><small>${esc(x.where)}</small></button>`;
        })
        .join("")}</div>`,
  );
  const reload = async () => {
    (catalog = null), (catalogBust = true);
    await loadCatalog();
    render();
  };
  onForm("nt", async (d) => {
    await api("staff/site", { notice: { on: d.on === "on", text: d.text, until: d.until, tone: d.tone } });
    toast(d.on === "on" ? "Aviso puesto. Ya lo ven los clientes." : "Aviso guardado (apagado).");
    reload();
  });
  onForm("ct", async (d) => {
    await api("staff/site", { contact: d });
    toast("Contacto guardado.");
    reload();
  });
  $$("[data-theme-set]").forEach(
    (el) =>
      (el.onclick = async () => {
        if (el.classList.contains("on")) return;
        $$("[data-theme-set]").forEach((b) => (b.disabled = true));
        try {
          const x = await api("staff/site", { theme: el.dataset.themeSet });
          applyTheme(x.theme);
          toast(x.theme === "rosa" ? "Web en rosa. Ya la ven así los clientes." : "Web en plata. Ya la ven así los clientes.");
          reload();
        } catch (err) {
          toast(err.message);
          $$("[data-theme-set]").forEach((b) => (b.disabled = false));
        }
      }),
  );
  $("#wr-auto").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const x = await api("staff/site", { rating: { mode: "auto" } });
      toast(x.rating.ok ? `Leídas de ${src}: ★ ${x.rating.shown.score} · ${x.rating.shown.count} reseñas.` : x.rating.err || `${src} no responde ahora. Prueba más tarde o ponlas a mano.`);
      reload();
    } catch (err) {
      toast(err.message);
    }
  };
  // Buscar la ficha de Google por nombre (o pegar su ID) y elegirla.
  $("#wg-find")?.addEventListener("click", () => {
    const sh = sheet(
      `<p class="eyebrow">Reseñas</p><h2>Tu ficha de Google</h2>
      <form id="wg-form"><label for="wg-q">Nombre de la barbería y pueblo</label><input id="wg-q" name="q" required maxlength="120" value="NOVA Studio Vecindario">
      <button class="btn wide" style="margin-top:12px" type="submit">Buscar</button></form>
      <div id="wg-res" class="wg-res" aria-live="polite"></div>
      <p class="muted" style="font-size:12px;margin-top:14px">¿No sale la tuya? Pega en el buscador el ID de la ficha (empieza por ChIJ). Se saca en <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener">el buscador de IDs de Google</a>.</p>`,
    );
    let hits = [];
    sh.el.querySelector("#wg-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const box = sh.el.querySelector("#wg-res"),
        btn = e.target.querySelector("button");
      btn.disabled = true;
      box.innerHTML = `<p class="muted">Buscando en Google…</p>`;
      try {
        hits = (await api("staff/site", { google: { search: e.target.q.value } })).places;
        box.innerHTML = hits.length
          ? hits
              .map(
                (p, i) =>
                  `<button type="button" class="wg-hit" data-i="${i}"><strong>${esc(p.name)}</strong><span>${esc(p.address)}${p.score ? ` · ★ ${String(p.score).replace(".", ",")} (${p.count})` : ""}</span></button>`,
              )
              .join("")
          : `<p class="muted">No sale nada con ese nombre. Prueba con otro (por ejemplo, el de la ficha tal cual).</p>`;
      } catch (err) {
        box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
      }
      btn.disabled = false;
      box.querySelectorAll(".wg-hit").forEach(
        (b) =>
          (b.onclick = async () => {
            const p = hits[+b.dataset.i];
            box.querySelectorAll(".wg-hit").forEach((x) => (x.disabled = true));
            try {
              const x = await api("staff/site", { google: { placeId: p.id, name: p.name, address: p.address } });
              sh.close();
              toast(
                (x.rating.ok ? `Listo: la web ya enseña las reseñas de Google (★ ${x.rating.shown.score} · ${x.rating.shown.count}).` : x.rating.err || "Ficha guardada.") +
                  (x.reviewUrl ? " El correo «Dejar mi reseña» también lleva ahora a Google." : ""),
              );
              reload();
            } catch (err) {
              toast(err.message);
              box.querySelectorAll(".wg-hit").forEach((x) => (x.disabled = false));
            }
          }),
      );
    });
  });
  $("#wg-off")?.addEventListener("click", async (e) => {
    if (!confirm("¿Quitar la ficha de Google? La web volverá a enseñar las reseñas de Booksy.")) return;
    e.currentTarget.disabled = true;
    try {
      await api("staff/site", { google: { placeId: "" } });
      toast("Ficha quitada. La web vuelve a enseñar Booksy.");
      reload();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#wr-manual").onclick = () => {
    const sh = sheet(
      `<p class="eyebrow">Reseñas</p><h2>Poner a mano</h2><p class="muted">Úsalo solo si ${src} deja de leerse solo. Mientras esté a mano, no se actualiza.</p>
      <form id="wr-form"><label for="wr-s">Nota (de 1 a 5)</label><input id="wr-s" name="score" inputmode="decimal" required value="${esc(R.shown.score)}">
      <label for="wr-c">Número de reseñas</label><input id="wr-c" name="count" inputmode="numeric" required value="${esc(R.shown.count)}">
      <button class="btn wide" style="margin-top:16px" type="submit">Guardar</button></form>`,
    );
    sh.el.querySelector("#wr-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      try {
        await api("staff/site", { rating: { mode: "manual", score: d.get("score"), count: d.get("count") } });
        sh.close();
        toast("Reseñas guardadas.");
        reload();
      } catch (err) {
        toast(err.message);
      }
    });
  };
  $$("[data-slot]").forEach(
    (el) =>
      (el.onclick = () => {
        const x = r.slots.find((y) => y.id === el.dataset.slot),
          mine = !!r.photos[x.id];
        const sh = sheet(
          `<p class="eyebrow">${esc(x.where)}</p><h2>${esc(x.label)}</h2>
          <span class="ws-pic big${x.id === "hero-wide" ? " wide" : ""}"><img src="${mine ? `/api/site/${x.id}/photo?v=${esc(r.photos[x.id])}` : esc(x.def)}" alt=""></span>
          <div class="stack" style="margin-top:14px"><label class="btn wide" style="margin:0">${svg(ICONS.camera)} Hacer o elegir foto<input type="file" accept="image/*" class="sr-only" id="ws-file"></label>
          ${mine ? `<button type="button" class="btn wide secondary" id="ws-reset">Volver a la original</button>` : ""}</div>
          <p class="muted" style="font-size:13px;margin-top:12px">${x.id === "hero" ? "Mejor una foto en vertical." : x.id === "hero-wide" ? "Mejor una foto en horizontal y ancha." : "Se ajusta sola al hueco; lo importante, en el centro."}</p>`,
        );
        sh.el.querySelector("#ws-file").onchange = async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          try {
            toast("Subiendo foto…");
            await api("staff/site", { slot: x.id, photo: await shrinkFit(f, x.max) });
            sh.close();
            toast("Foto cambiada.");
            reload();
          } catch (err) {
            toast(err.message === "big" ? "Esa foto es demasiado grande. Prueba con otra." : err.message || "No se ha podido leer esa foto.");
          }
        };
        const rs = sh.el.querySelector("#ws-reset");
        if (rs)
          rs.onclick = async () => {
            try {
              await api("staff/site", { slot: x.id, reset: true });
              sh.close();
              toast("Vuelve a estar la original.");
              reload();
            } catch (err) {
              toast(err.message);
            }
          };
      }),
  );
}

const DAYS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

async function staffTeam() {
  if (!staff.owner) return show(staffTop("ajustes") + `<p class="ag-free">Esto lo lleva el dueño.</p>`);
  const [n, t] = await Promise.all([api("staff/rules"), api("staff/team")]);
  const hoursTxt = (p) => {
    const on = WEEK_ORDER.filter((d) => p.hours?.[d]?.length);
    if (!on.length) return "Sin horario";
    return on.map((d) => DAYS_ES[d].slice(0, 3)).join(" ") + " · " + p.hours[on[0]][0].join("–");
  };
  show(
    staffTop("ajustes") +
      `<p class="section-label">Normas de cancelación</p>
      <form id="norms" class="card norms">
        <label for="n-hours" style="margin-top:0">Se puede cancelar gratis hasta</label>
        <div class="pct-field"><input id="n-hours" name="cancelHours" inputmode="numeric" required value="${n.cancelHours}"><span>h antes</span></div>
        <label for="n-late">Si cancela con menos tiempo, se le puede cobrar</label>
        <div class="pct-field"><input id="n-late" name="lateFeePct" inputmode="numeric" required value="${n.lateFeePct}"><span>% del servicio</span></div>
        <label for="n-abs">Si no viene, se le puede cobrar</label>
        <div class="pct-field"><input id="n-abs" name="noShowFeePct" inputmode="numeric" required value="${n.noShowFeePct}"><span>% del servicio</span></div>
        <p class="muted" style="font-size:13px;margin:12px 0 0">Nunca se cobra solo: cada barbero decide en su pestaña «Faltas» si cobra o no, por si hay un motivo justificado. Con 0 % no se cobra nunca.</p>
        <p class="section-label" style="margin-top:22px">Correos automáticos</p>
        <label class="check" style="margin-top:0"><input type="checkbox" name="reminders" ${n.reminders ? "checked" : ""}><span>Recordatorio el día antes de cada cita</span></label>
        <label class="check"><input type="checkbox" name="remindSoon" ${n.remindSoon ? "checked" : ""}><span>Otro recordatorio unas 2 horas antes (no a quien reservó ese mismo día)</span></label>
        <label class="check"><input type="checkbox" name="waitlist" ${n.waitlist ? "checked" : ""}><span>En los días completos, los clientes pueden pedir aviso. Si alguien cancela, se les escribe al momento</span></label>
        <label class="check"><input type="checkbox" name="dailyClose" ${n.dailyClose ? "checked" : ""}><span>Cada mañana, el resumen de caja de ayer a tu correo (con las citas que quedaron sin cobrar)</span></label>
        <label class="check"><input type="checkbox" name="reviews" ${n.reviews ? "checked" : ""}><span>Correo una hora después de cada corte marcado como hecho: a quien no ha dejado reseña se le pide (como mucho una vez cada 6 meses); a quien ya pulsó «Dejar mi reseña» se le pregunta cuándo vuelve, si no tiene otra cita</span></label>
        <label for="n-review">Enlace donde se deja la reseña</label>
        <input id="n-review" name="reviewUrl" type="url" inputmode="url" placeholder="https://g.page/r/…/review" value="${esc(n.reviewUrl || "")}">
        <p class="muted" style="font-size:12px;margin:6px 0 0">En Google: tu ficha de empresa → «Pedir reseñas» → copiar enlace.</p>
        <p class="section-label" style="margin-top:22px">Citas que se repiten</p>
        <label class="check"><input type="checkbox" name="recurring" ${n.recurring ? "checked" : ""}><span>Los clientes pueden reservar citas que se repiten (cada 1, 2, 3 o 4 semanas)</span></label>
        <label for="n-rmax">Como mucho, cuántas citas de una vez</label>
        <div class="pct-field"><input id="n-rmax" name="recurringMax" inputmode="numeric" value="${n.recurringMax}"><span>citas</span></div>
        <p class="section-label" style="margin-top:22px">Paso desde Booksy</p>
        <label for="n-open" style="margin-top:0">Los clientes reservan en la app desde el</label>
        <input id="n-open" name="openFrom" type="date" value="${esc(n.openFrom || "")}">
        <p class="muted" style="font-size:12px;margin:6px 0 0">Antes de ese día la agenda sigue en Booksy, y la app manda allí a quien pida cita para esas fechas. El equipo puede apuntar citas en la app cualquier día. En Booksy, cierra los días desde esta fecha para que las dos agendas no se pisen. Vacío = sin límite.</p>
        ${autoStatus(n)}
        <button class="btn wide" style="margin-top:14px" type="submit">Guardar normas</button>
      </form>
      <p class="section-label">Equipo</p>
      <div class="team-admin">${t.team
        .map(
          (p) => `<button type="button" class="ag-item tm-row${p.active === false ? " off" : ""}" data-w="${esc(p.id)}">${face(p, "pr-thumb")}<div><strong>${esc(p.name)}</strong><span>${esc(p.role || "")} · ${esc(hoursTxt(p))}</span></div><span>${
            p.active === false ? `<span class="appt-state">De baja</span>` : p.owner ? `<span class="appt-state st-done">Dueño</span>` : `<span class="appt-state st-ok">${String(p.commission ?? 0).replace(".", ",")} %</span>`
          }</span></button>`,
        )
        .join("")}</div>
      <button type="button" class="btn wide" style="margin-top:12px" id="w-new">+ Añadir trabajador</button>` +
      backupBlock() +
      `<p class="section-label">Datos de prueba</p><div class="card" id="demo-box"><p class="muted" style="margin:0">Cargando…</p></div>`,
  );
  bindBackup();
  demoBox();
  onForm("norms", async (d) => {
    const on = (k) => d[k] === "on";
    await api("staff/rules", { ...d, reminders: on("reminders"), recurring: on("recurring"), remindSoon: on("remindSoon"), waitlist: on("waitlist"), dailyClose: on("dailyClose"), reviews: on("reviews") });
    (catalog = null), (catalogBust = true);
    await loadCatalog();
    toast("Normas guardadas.");
    render();
  });
  $("#w-new").onclick = () => workerSheet(null, t.services);
  $$("[data-w]").forEach((el) => (el.onclick = () => workerSheet(t.team.find((p) => p.id === el.dataset.w), t.services)));
}

function workerSheet(p, services) {
  let photo = "";
  const salon = catalog.business.week || {};
  const hours = p?.hours || salon;
  const timeSel = (name, sel) => {
    let o = "";
    for (let m = 7 * 60; m <= 23 * 60; m += 30) {
      const v = addMin("00:00", m);
      o += `<option ${v === sel ? "selected" : ""}>${v}</option>`;
    }
    return `<select name="${name}" aria-label="${name.startsWith("a") ? "Entrada" : "Salida"}">${o}</select>`;
  };
  const owner = !!p?.owner;
  const sh = sheet(
    `<p class="eyebrow">${p ? (owner ? "Dueño" : "Trabajador") : "Nuevo trabajador"}</p><h2>${p ? esc(p.name) : "Añadir al equipo"}</h2>
    <form id="w-form">
      <label class="pr-photo w-photo" id="w-photo">${p?.image ? `<img src="${esc(p.image)}" alt="">` : `<span>${svg(ICONS.camera)}Foto</span>`}<input type="file" accept="image/*" class="sr-only" id="w-file"></label>
      <label for="w-name">Nombre</label><input id="w-name" name="name" required maxlength="60" value="${esc(p?.name || "")}">
      <label for="w-role">Puesto <small>(se ve en su tarjeta)</small></label><input id="w-role" name="role" maxlength="40" value="${esc(p?.role || "Barbero")}">
      <label for="w-email">Su correo <small>(al entrar con él en la app le sale su panel)</small></label><input id="w-email" name="email" type="email" maxlength="120" value="${esc(p?.email || "")}">
      <fieldset class="tr-field"><legend>Horario</legend><div class="w-hours">${WEEK_ORDER.map((d) => {
        const r = hours[d]?.[0];
        return `<div class="w-day"><label class="check"><input type="checkbox" name="on${d}" ${r ? "checked" : ""}><span>${DAYS_ES[d]}</span></label>${timeSel("a" + d, r?.[0] || "10:00")}${timeSel("b" + d, r?.[1] || "20:00")}</div>`;
      }).join("")}</div></fieldset>
      <fieldset class="tr-field"><legend>Color en la agenda</legend><div class="w-colors">${Object.entries(AG_COLORS)
        .map(([k, [label, c]]) => `<label class="w-color" title="${label}"><input type="radio" name="color" value="${k}" ${k === (p ? agColorKey(p.id) : "") ? "checked" : ""}><span style="--c:${c}"></span><small>${label}</small></label>`)
        .join("")}</div></fieldset>
      <fieldset class="tr-field"><legend>Servicios que hace</legend><div class="tchips">${services
        .map((x) => {
          const blocked = x.only.length && !x.only.includes(p?.id);
          const on = p ? !p.services?.length || p.services.includes(x.id) : !x.only.length;
          return `<label class="tchip${blocked ? " dis" : ""}"><input type="checkbox" name="svc" value="${esc(x.id)}" ${on && !blocked ? "checked" : ""} ${blocked ? "disabled" : ""}><span>${esc(x.name)}${blocked ? " · solo " + esc(x.only.join(", ")) : ""}</span></label>`;
        })
        .join("")}</div></fieldset>
      ${owner ? "" : `<label for="w-comm">Su comisión para ti</label><div class="pct-field"><input id="w-comm" name="commission" inputmode="decimal" value="${String(p?.commission ?? 40).replace(".", ",")}"><span>%</span></div><p class="muted" style="font-size:12px;margin:6px 0 0">Para cambiarla solo desde un mes en adelante, usa «Cambiar %» en Caja y comisiones.</p>`}
      <label for="w-pin">${p ? "Nueva clave del panel <small>(déjalo vacío para no cambiarla)</small>" : "Clave del panel <small>(4 a 8 números)</small>"}</label><input id="w-pin" name="pin" inputmode="numeric" autocomplete="new-password" maxlength="8" ${p ? "" : "required"} placeholder="${p?.hasPin ? "••••" : ""}">
      ${owner ? "" : `<label class="check" style="margin-top:16px"><input type="checkbox" name="active" ${p?.active === false ? "" : "checked"}><span>En activo (sale para reservar y puede entrar a su panel)</span></label>`}
      <button class="btn wide" style="margin-top:18px" type="submit">${p ? "Guardar cambios" : "Añadir al equipo"}</button>
    </form>`,
  );
  const f = sh.el.querySelector("#w-form");
  sh.el.querySelector("#w-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      photo = await shrinkPortrait(file);
      const box = sh.el.querySelector("#w-photo");
      box.querySelector("img, span")?.remove();
      box.insertAdjacentHTML("afterbegin", `<img src="${photo}" alt="">`);
    } catch {
      toast("No se ha podido leer esa foto.");
    }
  };
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(f),
      btn = f.querySelector("[type=submit]");
    const hrs = {};
    for (const day of WEEK_ORDER) hrs[day] = d.get("on" + day) ? [d.get("a" + day), d.get("b" + day)] : null;
    btn.disabled = true;
    try {
      const r = await api("staff/team", {
        id: p?.id,
        name: d.get("name"),
        role: d.get("role"),
        email: d.get("email"),
        hours: hrs,
        services: d.getAll("svc"),
        color: d.get("color") || "",
        commission: d.get("commission") ?? undefined,
        pin: d.get("pin"),
        active: owner ? true : d.get("active") === "on",
        photo,
      });
      sh.close();
      (catalog = null), (catalogBust = true);
      await loadCatalog();
      toast(r.pending ? `Guardado. Ojo: le quedan ${r.pending} citas pendientes; muévelas o cancélalas desde la Agenda.` : p ? "Guardado." : `${first(r.worker.name)} ya está en el equipo.`);
      await render();
      // La clave se la da el dueño: se le enseña una vez para que se la pase.
      const pin = String(d.get("pin") || "").trim();
      if (pin) pinHandOver(r.worker, pin, !p);
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });
}

function pinHandOver(w, pin, isNew) {
  sheet(
    `<p class="eyebrow">${isNew ? "Nuevo en el equipo" : "Clave cambiada"}</p><h2>Dale su clave a ${esc(first(w.name))}</h2>
    <p class="cb-pin">${esc(pin)}</p>
    <p class="muted">Con ella entra a su panel en <b>Equipo</b>, eligiendo su nombre. También le sirve para abrir la <b>Caja</b> de la tablet.</p>
    <p class="muted">No se vuelve a enseñar: apúntala o pásasela ahora. Si se le olvida, pon una nueva desde aquí.</p>`,
  );
}

// Foto de trabajador en vertical (3:4), como las tarjetas de «Elige a tu barbero».
async function shrinkPortrait(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = 480,
      H = 640,
      r = Math.min(img.naturalWidth / W, img.naturalHeight / H),
      sw = W * r,
      sh = H * r,
      c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.getContext("2d").drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 3, sw, sh, 0, 0, W, H);
    return encodeLight(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Avisos y calendario de cada barbero ────────────────────────────────────
// Cada barbero pone el correo donde quiere que le avisen de sus citas y
// conecta su agenda con Google Calendar o con el calendario del móvil.
async function staffSettings() {
  let r;
  try {
    r = await api("staff/settings");
  } catch (e) {
    return toast(e.message);
  }
  const url = () => `${location.origin}/api/cal/${r.feed}.ics`,
    webcal = () => url().replace(/^https?:/, "webcal:");
  const sh = sheet(
    `<p class="eyebrow">${esc(first(staff.name))}</p><h2>Avisos y calendario</h2>
    <p class="section-label" style="margin-top:18px">Avisos por correo</p>
    <form id="st-mail"><label for="st-email" style="margin-top:0">Tu correo</label><input id="st-email" name="email" type="email" autocomplete="email" value="${esc(r.email)}" placeholder="tucorreo@gmail.com">
      <label class="check" style="margin-top:12px"><input type="checkbox" name="notify" ${r.notify ? "checked" : ""}><span>Avisarme de cada cita nueva, cambiada o cancelada</span></label>
      <div class="form-actions" style="margin-top:14px"><button class="btn" type="submit">Guardar</button><button type="button" class="btn secondary" id="st-test">Enviar prueba</button></div>
      ${r.mail ? "" : `<p class="warning">El envío de correos aún no está activado en la app. Tu correo queda guardado y los avisos empezarán a llegar en cuanto se active.</p>`}</form>
    <p class="section-label">Tu agenda en tu calendario</p>
    <p class="muted" style="margin-top:0">Tus citas aparecen en Google Calendar o en el calendario del iPhone, con el nombre del cliente, el servicio y su teléfono. Se actualiza sola.</p>
    <div class="stack"><a class="btn wide" id="st-google" target="_blank" rel="noopener" href="#">${svg(ICONS.cal)} Añadir a Google Calendar</a>
      <a class="btn wide secondary" id="st-apple" href="#">Añadir al calendario del iPhone</a>
      <button type="button" class="btn wide secondary" id="st-copy">${svg(ICONS.copy)} Copiar el enlace</button></div>
    <p class="muted" style="font-size:13px;margin-top:12px">Google tarda unas horas en traer los cambios; el iPhone, unos minutos. Para ver una cita al instante, mira la Agenda de este panel. El enlace es solo tuyo: no lo compartas.</p>
    <button type="button" class="tr-del" id="st-reset">Crear un enlace nuevo (el anterior deja de funcionar)</button>`,
  );
  const q = (s) => sh.el.querySelector(s);
  const links = () => {
    q("#st-google").href = "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal());
    q("#st-apple").href = webcal();
  };
  links();
  const save = (extra = {}) => api("staff/settings", { email: q("#st-email").value, notify: q("[name=notify]").checked, ...extra });
  q("#st-mail").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await save();
      toast("Guardado.");
    } catch (err) {
      toast(err.message);
    }
  });
  q("#st-test").onclick = async () => {
    try {
      await save({ test: true });
      toast("Enviado. Mira tu correo.");
    } catch (err) {
      toast(err.message);
    }
  };
  q("#st-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(url());
      toast("Enlace copiado.");
    } catch {
      toast(url());
    }
  };
  const rs = q("#st-reset");
  rs.onclick = async () => {
    if (rs.dataset.sure !== "1") {
      rs.dataset.sure = "1";
      rs.textContent = "Pulsa otra vez: habrá que volver a añadirlo al calendario";
      return;
    }
    try {
      r.feed = (await save({ resetFeed: true })).feed;
      links();
      rs.dataset.sure = "";
      rs.textContent = "Enlace nuevo creado. Vuelve a añadirlo a tu calendario.";
    } catch (err) {
      toast(err.message);
    }
  };
}

const TR_STATUS = { new: ["Nuevo", "st-ok"], contacted: ["Contactado", "st-wait"], enrolled: ["Apuntado", "st-done"], discarded: ["Descartado", "st-cancel"] };

// Panel del dueño: quién quiere aprender y qué pide, para decidir fechas y grupos.
let trainFilter = "all";

async function staffTraining() {
  let r;
  try {
    r = await api("staff/training");
  } catch (e) {
    if (e.status === 403) return show(staffTop("formacion") + `<p class="ag-free">${esc(e.message)}</p>`);
    throw e;
  }
  const T = catalog.training,
    S = r.stats;
  const name = (list, id) => list.find((x) => (x.id || x) === id)?.name || id;
  const bars = (title, counts, list) => {
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return "";
    const max = rows[0][1];
    return `<div class="tr-bars"><p class="section-label">${title}</p>${rows
      .map(([k, n]) => `<div class="tr-bar"><span>${esc(name(list, k))}</span><i style="--w:${Math.round((n / max) * 100)}%"></i><b>${n}</b></div>`)
      .join("")}</div>`;
  };
  const shown = r.list.filter((t) => trainFilter === "all" || t.status === trainFilter);
  const filters = [["all", "Todos", S.total], ["new", "Nuevos", S.fresh], ["contacted", "Contactados"], ["enrolled", "Apuntados", S.enrolled], ["discarded", "Descartados"]];
  const link = location.origin + "/formacion";
  show(
    staffTop("formacion") +
      `<div class="stat3 money"><div><strong>${S.total}</strong><span>Interesados</span></div><div><strong>${S.fresh}</strong><span>Sin contactar</span></div><div><strong>${S.enrolled}</strong><span>Apuntados</span></div></div>` +
      `<p class="muted" style="font-size:13px;margin:0 0 12px">Las fichas se borran solas 2 años después del último contacto (cuando se apuntó o cuando cambiaste su estado o su nota), como dice la política de privacidad.</p>` +
      `<div class="card tr-share"><div><strong>Enlace para compartir</strong><span>${esc(link.replace(/^https?:\/\//, ""))}</span></div><button type="button" class="btn small" id="tr-share">Compartir</button></div>` +
      (S.total
        ? `<details class="caja-more" ${S.total >= 3 ? "open" : ""}><summary>Qué piden</summary>${bars("Nivel", S.level, T.levels)}${bars("Formato", S.format, T.formats)}${bars("Les interesa", S.topics, T.topics)}${bars("Cuándo pueden", S.availability, T.availability)}</details>` +
          `<div class="tr-filter" role="tablist">${filters
            .map(([k, l, n]) => `<button type="button" class="${trainFilter === k ? "on" : ""}" data-f="${k}">${l}${n !== undefined ? ` <small>${n}</small>` : ""}</button>`)
            .join("")}</div>` +
          (shown.length
            ? shown
                .map((t) => {
                  const [st, cls] = TR_STATUS[t.status] || TR_STATUS.new;
                  const msg = `Hola ${first(t.name)}, soy ${first(staff.name)} de NOVA Studio. Te escribo por la formación de barbería que pediste en la app.`;
                  return `<article class="card tr-item" data-id="${esc(t.id)}">
                    <div class="tr-item-top"><div><strong>${esc(t.name)}</strong><span>${esc(name(T.levels, t.level))}${t.format ? " · " + esc(name(T.formats, t.format)) : ""}</span></div><span class="appt-state ${cls}">${st}</span></div>
                    ${t.topics.length ? `<p class="tr-tags">${t.topics.map((x) => `<span>${esc(x)}</span>`).join("")}</p>` : ""}
                    ${t.availability.length ? `<p class="tr-line">🕒 ${esc(t.availability.join(" · "))}</p>` : ""}
                    ${t.message ? `<p class="tr-msg">«${esc(t.message)}»</p>` : ""}
                    <p class="tr-line muted">${esc(t.phone)}${t.email ? " · " + esc(t.email) : ""}${t.instagram ? ` · <a href="https://instagram.com/${encodeURIComponent(t.instagram)}" target="_blank" rel="noopener">@${esc(t.instagram)}</a>` : ""} · ${esc(shortDate(t.created.slice(0, 10)))}</p>
                    <div class="form-actions" style="margin-top:10px"><a class="btn small wa-btn" target="_blank" rel="noopener" href="https://wa.me/${esc(t.phone.replace(/\D/g, ""))}?text=${encodeURIComponent(msg)}">WhatsApp</a>
                      <select class="tr-st" aria-label="Estado">${Object.entries(TR_STATUS).map(([k, [l]]) => `<option value="${k}" ${k === t.status ? "selected" : ""}>${l}</option>`).join("")}</select></div>
                    <button type="button" class="tr-del" data-del="${esc(t.id)}">Borrar sus datos</button>
                  </article>`;
                })
                .join("")
            : `<p class="ag-free">Nadie en este filtro.</p>`)
        : `<p class="ag-free">Aún no se ha apuntado nadie. Comparte el enlace en tu Instagram para empezar a llenar la lista.</p>`),
  );
  $("#tr-share").onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Formación de barbería", url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast("Enlace copiado.");
      }
    } catch {}
  };
  $$(".tr-filter [data-f]").forEach((b) => (b.onclick = () => ((trainFilter = b.dataset.f), render())));
  $$(".tr-item .tr-st").forEach(
    (s) =>
      (s.onchange = async () => {
        try {
          await api("staff/training/" + s.closest(".tr-item").dataset.id, { status: s.value });
          toast("Guardado.");
          render();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  $$("[data-del]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (b.dataset.sure !== "1") {
          b.dataset.sure = "1";
          b.textContent = "Pulsa otra vez para borrar";
          return;
        }
        try {
          await api("staff/training/" + b.dataset.del, { delete: true });
          toast("Datos borrados.");
          render();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
}
