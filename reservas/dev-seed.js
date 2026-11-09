// Solo en local: `node dev-server.js 5180 --demo` llena la memoria con un socio
// de prueba (demo@nova.test) que ya tiene cortes, amigos y un canje, para ver
// el perfil, las ligas y las medallas con datos. No se sube a Vercel.
import { cmd, pipe, setJSON } from "./api/_lib/store.js";
import { SERVICES, PROVIDERS } from "./api/_lib/config.js";
import { nowLocal, addDays, toMin, toHHMM } from "./api/_lib/time.js";

let n = 0;
function booking(email, name, date, start, serviceId = "corte", extra = {}, providerId = "airam") {
  const s = SERVICES.find((x) => x.id === serviceId),
    p = PROVIDERS.find((x) => x.id === providerId);
  return {
    id: "D" + String(++n).padStart(6, "0"),
    kind: "booking",
    service: { id: s.id, name: s.name, price: s.price, duration: s.duration },
    provider: { id: p.id, name: p.name },
    date,
    start,
    end: toHHMM(toMin(start) + s.duration),
    status: "confirmed",
    attendance: "done",
    created: date + " 09:00",
    email,
    name,
    phone: "+34 600 000 000",
    by: "client",
    ...extra,
  };
}
async function save(b) {
  await pipe([
    ["SET", "bk:" + b.id, JSON.stringify(b)],
    ["SADD", "ubk:" + b.email, b.id],
    ["SADD", "day:" + b.date, b.id],
    ["HSET", `occ:${b.provider.id}:${b.date.slice(0, 7)}`, b.id, `${b.date}|${b.start}|${b.end}`],
  ]);
}

export async function seed() {
  const today = nowLocal().date;
  const email = "demo@nova.test";
  await cmd("SET", "seq:member", 41);
  // Con tarjeta de prueba guardada (modo prueba de Stripe, sin cobros reales).
  const testCard = (last4) => ({ stripe: "cus_fake_demo_" + last4, card: { pm: "pm_fake_demo_" + last4, brand: "visa", last4, exp: "12/30", saved: addDays(today, -60) + " 10:00" } });
  await setJSON("user:" + email, { email, name: "Alex Demo", phone: "+34 611 222 333", no: 42, created: addDays(today, -400) + " 10:00", ref: "ALEX123", ...testCard("4242") });
  await cmd("SET", "refcode:ALEX123", email);

  // 14 cortes en los últimos meses, alguno temprano, alguno tarde y en sábado.
  const plan = [
    [-380, "10:00"], [-330, "10:15", "corte-barba"], [-300, "19:00"], [-260, "10:30"], [-220, "17:00"],
    [-190, "19:15"], [-150, "12:00", "privado"], [-120, "10:00"], [-95, "18:00"], [-70, "16:30", "corte-barba"],
    [-50, "11:30"], [-30, "13:00"], [-14, "10:45"], [-3, "17:30", "corte-barba"],
  ];
  for (const [d, t, s] of plan) {
    let date = addDays(today, d);
    while ([0, 1].includes(new Date(date + "T12:00:00Z").getUTCDay())) date = addDays(date, -1); // domingo y lunes cierra
    await save(booking(email, "Alex Demo", date, t, s));
  }

  // Dos amigos invitados: uno ya vino (suma), otro aún no.
  for (const [fe, fname, came] of [["marta@nova.test", "Marta Ruiz", true], ["pablo@nova.test", "Pablo Díaz", false]]) {
    await setJSON("user:" + fe, { email: fe, name: fname, phone: "", no: 50, created: addDays(today, -40) + " 10:00", referredBy: email, ref: fname.split(" ")[0].toUpperCase() + "777" });
    await cmd("SADD", "refs:" + email, fe);
    if (came) await save(booking(fe, fname, addDays(today, -20), "12:30"));
  }

  // Trabajo del equipo en las últimas semanas y los próximos días, para ver
  // la caja de cada barbero y las comisiones del dueño.
  const clients = ["Carlos Pérez", "Jonay Suárez", "Iván Rodríguez", "Kevin Santana", "Adrián Melián", "Yeray Vega"];
  let k = 0;
  for (let d = -20; d <= 6; d++) {
    const date = addDays(today, d);
    if ([0, 1].includes(new Date(date + "T12:00:00Z").getUTCDay())) continue;
    for (const [pid, times] of [["ehedey", ["10:00", "12:30", "17:00"]], ["noa", ["11:00", "16:00"]], ["airam", ["13:00"]]]) {
      for (const t of times) {
        const who = clients[k++ % clients.length];
        const svc = k % 3 === 0 ? "corte-barba" : "corte";
        const extra = d > 0 ? { attendance: "unmarked" } : k % 11 === 0 ? { attendance: "absent" } : {};
        await save(booking(`c${k % clients.length}@nova.test`, who, date, t, svc, extra, pid));
      }
    }
  }
  // Esos clientes, con tarjeta de prueba: la de c1 la rechaza el banco al cobrar
  // una falta y la de c2 pide confirmación. c5 no dejó tarjeta.
  for (let i = 0; i < clients.length - 1; i++)
    await setJSON(`user:c${i}@nova.test`, { email: `c${i}@nova.test`, name: clients[i], phone: "+34 600 000 000", no: 60 + i, created: addDays(today, -90) + " 10:00", ref: "CLI" + i + "00", ...testCard(i === 1 ? "0002" : i === 2 ? "3155" : "4242") });
  // Alex no vino hace dos días a una cita con Noa (sin cobrar todavía).
  let miss = addDays(today, -2);
  while ([0, 1].includes(new Date(miss + "T12:00:00Z").getUTCDay())) miss = addDays(miss, -1);
  await save(booking(email, "Alex Demo", miss, "18:30", "corte", { attendance: "absent", guarantee: { brand: "visa", last4: "4242" } }, "noa"));

  // Un premio canjeado pendiente de recoger.
  const rd = { id: "C1A2B3", email, name: "Alex Demo", reward: { id: "bebida", name: "Bebida premium", cost: 3 }, status: "pending", created: addDays(today, -2) + " 18:00" };
  await pipe([
    ["SET", "rd:" + rd.id, JSON.stringify(rd)],
    ["SADD", "urd:" + email, rd.id],
    ["SADD", "rdpending", rd.id],
  ]);
  console.log("  Datos de prueba: entra con demo@nova.test");
}
