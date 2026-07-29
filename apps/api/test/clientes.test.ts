import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { TEXTO_OPTIN_WHATSAPP } from "@huayruro/shared";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// P1 — GATE de aislamiento de clientes y seguimiento (patrón §18; bloquea la UI de S14).
//
// Cubre las CUATRO tablas nuevas de 0009 — `cliente`, `cliente_fts`, `cliente_familiar` y
// `tratamiento` — más la integridad por aplicación de `venta.cliente_id`, que no tiene FK.
//
// La regla que se está probando: **el cliente es POR BOTICA**. La misma persona en dos boticas son dos
// filas sin relación, y ningún id de una alcanza datos de la otra. Como acá viven datos personales y de
// salud (DNI, alergias, notas), un fallo de scope no es un bug de listado: es una fuga.
//
// Fixture SINTÉTICO propio, HTTP real contra el Worker (no se llama a los repos por dentro).
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";

const T = "t-huayruro";
const sV = "suc-ves";
const sC = "suc-chz-puerto";

const uSuper = "u-super";
const uAdminVes = "u-admin-ves";
const uAdminChz = "u-admin-chz";
const uOperVes = "u-oper-ves";
const uOperChz = "u-oper-chz";
const uLectorVes = "u-lector-ves";
const dev = "dev-ves";

const P1 = "prod-1";
const presP1 = "pres-1";
const ventaVes = "venta-ves";
const ventaChz = "venta-chz";

const tok = {
  super: "tok-super",
  adminVes: "tok-admin-ves",
  adminChz: "tok-admin-chz",
  operVes: "tok-oper-ves",
  operChz: "tok-oper-chz",
  lector: "tok-lector-ves",
  device: "tok-device-ves",
};

function bearer(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}
function cuerpo(metodo: string, token: string, body: unknown): RequestInit {
  return { method: metodo, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
const post = (token: string, body: unknown) => cuerpo("POST", token, body);
const patch = (token: string, body: unknown) => cuerpo("PATCH", token, body);
const del = (token: string) => ({ method: "DELETE", headers: { Authorization: `Bearer ${token}` } }) as RequestInit;
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

// Mismo cálculo de día local que usa el server (`fechaLocal`, America/Lima): los seguimientos vencen
// por fecha de Lima, no por UTC — a las 20:00 de Lima el UTC ya cambió de día y el test se caería.
const diaLima = (offsetDias = 0): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + offsetDias * 86_400_000),
  );

// Alta por HTTP; devuelve el id creado.
async function crearCliente(token: string, body: Record<string, unknown>): Promise<string> {
  const r = await req("/api/clientes", post(token, body));
  expect(r.status).toBe(201);
  const j = (await r.json()) as { cliente: { id: string } };
  return j.cliente.id;
}

async function sembrar(): Promise<void> {
  const db = env.DB;
  // Orden por dependencia: hijas antes que padres (las FK están activas en D1).
  for (const t of [
    "tratamiento", "cliente_familiar", "cliente_fts", "cliente",
    "sesion", "dispositivo", "venta", "inventario_local", "precio_local",
    "presentacion", "producto_catalogo", "usuario_perfil", "sucursal", "tenant",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }

  const h = {
    super: await hashToken(tok.super),
    adminVes: await hashToken(tok.adminVes),
    adminChz: await hashToken(tok.adminChz),
    operVes: await hashToken(tok.operVes),
    operChz: await hashToken(tok.operChz),
    lector: await hashToken(tok.lector),
    device: await hashToken(tok.device),
  };
  const PW = "pbkdf2$310000$c2FsdA==$aGFzaA==";
  const usuario = (id: string, suc: string | null, rol: string, nombre: string, email: string) =>
    db
      .prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)`)
      .bind(id, T, suc, rol, nombre, email, PW, TS);
  const sesion = (id: string, usuarioId: string, hash: string) =>
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES (?1,?2,?3,?4,?5)`).bind(id, usuarioId, hash, TS, FUTURO);

  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T','Botica Huayruro',?2,?2)`).bind(T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Huayruro VES',?3,?3)`).bind(sV, T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Huayruro Chazuta Puerto',?3,?3)`).bind(sC, T, TS),
    usuario(uSuper, null, "super_admin", "Super", "super@h.local"),
    usuario(uAdminVes, sV, "admin_sucursal", "AdminVes", "av@h.local"),
    usuario(uAdminChz, sC, "admin_sucursal", "AdminChz", "ac@h.local"),
    usuario(uOperVes, sV, "operador", "OperVes", "ov@h.local"),
    usuario(uOperChz, sC, "operador", "OperChz", "oc@h.local"),
    usuario(uLectorVes, sV, "lector_reportes", "LectorVes", "lv@h.local"),
    sesion("s1", uSuper, h.super),
    sesion("s2", uAdminVes, h.adminVes),
    sesion("s3", uAdminChz, h.adminChz),
    sesion("s4", uOperVes, h.operVes),
    sesion("s5", uOperChz, h.operChz),
    sesion("s6", uLectorVes, h.lector),
    db.prepare(`INSERT INTO dispositivo (id,sucursal_id,tipo,nombre,token_hash,created_at) VALUES (?1,?2,'a10_grabador','A10',?3,?4)`).bind(dev, sV, h.device, TS),
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ibuprofeno 400 mg',?3,?3)`).bind(P1, T, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(presP1, P1, TS),
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('pr-ves',?1,?2,?3,15254,2746,18000,?4,?4)`).bind(P1, sV, presP1, TS),
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES ('inv-ves',?1,?2,50,10,?3)`).bind(sV, P1, TS),
    db.prepare(`INSERT INTO venta (id,client_uuid,sucursal_id,fecha_hora,subtotal_sin_igv_cent,igv_total_cent,total_cent,metodo_pago,created_at,updated_at) VALUES (?1,'cu-ves',?2,?3,153,27,180,'efectivo',?3,?3)`).bind(ventaVes, sV, TS),
    db.prepare(`INSERT INTO venta (id,client_uuid,sucursal_id,fecha_hora,subtotal_sin_igv_cent,igv_total_cent,total_cent,metodo_pago,created_at,updated_at) VALUES (?1,'cu-chz',?2,?3,153,27,180,'efectivo',?3,?3)`).bind(ventaChz, sC, TS),
  ]);
}

beforeEach(async () => {
  await sembrar();
});

describe("P1 — aislamiento de `cliente`", () => {
  it("1) el cliente creado por VES no aparece en el padrón de Chazuta", async () => {
    await crearCliente(tok.operVes, { nombre: "María Quispe", telefono: "918343561" });

    const ves = (await (await req("/api/clientes", bearer(tok.adminVes))).json()) as { clientes: unknown[] };
    const chz = (await (await req("/api/clientes", bearer(tok.adminChz))).json()) as { clientes: unknown[] };
    expect(ves.clientes.length).toBe(1);
    expect(chz.clientes.length).toBe(0);
  });

  it("2) panel de un cliente ajeno → 404 (no revela que existe)", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    const r = await req(`/api/clientes/${id}/panel`, bearer(tok.operChz));
    expect(r.status).toBe(404);
  });

  it("3) editar o borrar un cliente ajeno → 404", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    expect((await req(`/api/clientes/${id}`, patch(tok.adminChz, { notas: "intruso" }))).status).toBe(404);
    expect((await req(`/api/clientes/${id}`, del(tok.adminChz))).status).toBe(404);

    // Y el dato quedó intacto tras el intento.
    const fila = await env.DB.prepare(`SELECT notas, deleted_at FROM cliente WHERE id = ?1`).bind(id).first<{ notas: string | null; deleted_at: string | null }>();
    expect(fila?.notas).toBeNull();
    expect(fila?.deleted_at).toBeNull();
  });

  it("4) el DNI es único POR BOTICA: repetirlo en la misma → 409; en la otra → se permite", async () => {
    await crearCliente(tok.operVes, { nombre: "María Quispe", dni: "45678912" });

    const repetido = await req("/api/clientes", post(tok.operVes, { nombre: "Otra María", dni: "45678912" }));
    expect(repetido.status).toBe(409);

    // La misma persona comprando en la otra botica es OTRO registro — es la regla de negocio, no un bug.
    const otraBotica = await req("/api/clientes", post(tok.operChz, { nombre: "María Quispe", dni: "45678912" }));
    expect(otraBotica.status).toBe(201);
  });
});

describe("P1 — aislamiento de `cliente_fts` (la búsqueda es la puerta de entrada real)", () => {
  it("5) la misma persona en dos boticas: cada búsqueda devuelve SOLO la fila de su botica", async () => {
    const idVes = await crearCliente(tok.operVes, { nombre: "María Quispe", telefono: "918343561" });
    const idChz = await crearCliente(tok.operChz, { nombre: "María Quispe", telefono: "918343561" });
    expect(idVes).not.toBe(idChz);

    const ves = (await (await req("/api/clientes/buscar?q=maria", bearer(tok.operVes))).json()) as { clientes: { id: string }[] };
    const chz = (await (await req("/api/clientes/buscar?q=maria", bearer(tok.operChz))).json()) as { clientes: { id: string }[] };
    expect(ves.clientes.map((c) => c.id)).toEqual([idVes]);
    expect(chz.clientes.map((c) => c.id)).toEqual([idChz]);
  });

  it("6) busca sin tildes y por teléfono con separadores (lo que de verdad teclean en caja)", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Ñañez", telefono: "918 343 561" });

    const sinTilde = (await (await req("/api/clientes/buscar?q=maria", bearer(tok.operVes))).json()) as { clientes: { id: string }[] };
    expect(sinTilde.clientes.map((c) => c.id)).toContain(id);

    // El teléfono se guarda solo en dígitos, así que estas tres formas tienen que dar lo mismo.
    for (const q of ["918343561", "918-343-561", "343"]) {
      const r = (await (await req(`/api/clientes/buscar?q=${encodeURIComponent(q)}`, bearer(tok.operVes))).json()) as { clientes: { id: string }[] };
      expect(r.clientes.map((c) => c.id), `búsqueda "${q}"`).toContain(id);
    }
  });

  it("7) el índice sigue al perfil: al renombrar deja de matchear el nombre viejo, y el borrado lo saca", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });

    await req(`/api/clientes/${id}`, patch(tok.adminVes, { nombre: "María Rojas" }));
    const viejo = (await (await req("/api/clientes/buscar?q=quispe", bearer(tok.operVes))).json()) as { clientes: unknown[] };
    const nuevo = (await (await req("/api/clientes/buscar?q=rojas", bearer(tok.operVes))).json()) as { clientes: { id: string }[] };
    expect(viejo.clientes.length).toBe(0);
    expect(nuevo.clientes.map((c) => c.id)).toEqual([id]);

    await req(`/api/clientes/${id}`, del(tok.adminVes));
    const borrado = (await (await req("/api/clientes/buscar?q=rojas", bearer(tok.operVes))).json()) as { clientes: unknown[] };
    const listado = (await (await req("/api/clientes", bearer(tok.operVes))).json()) as { clientes: unknown[] };
    expect(borrado.clientes.length).toBe(0);
    expect(listado.clientes.length).toBe(0);
  });

  it("8) una consulta con caracteres reservados de FTS5 no rompe la caja", async () => {
    await crearCliente(tok.operVes, { nombre: "María Quispe" });
    // `-`, `*`, comillas y paréntesis son operadores de FTS5: sin sanear, esto sería un 500 en mostrador.
    for (const q of ['"', "-", "maria*", "(maria)", "AND", "987-654-321", "^", ":"]) {
      const r = await req(`/api/clientes/buscar?q=${encodeURIComponent(q)}`, bearer(tok.operVes));
      expect(r.status, `consulta ${JSON.stringify(q)}`).toBe(200);
    }
  });
});

describe("P1 — aislamiento de `cliente_familiar` y `tratamiento`", () => {
  it("9) agregar familiar o tratamiento a un cliente ajeno → 404", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    expect((await req(`/api/clientes/${id}/familiares`, post(tok.operChz, { nombre: "Hijo" }))).status).toBe(404);
    expect((await req(`/api/clientes/${id}/tratamientos`, post(tok.operChz, { descripcion: "x" }))).status).toBe(404);

    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM cliente_familiar`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("10) un tratamiento NO puede colgarse de un familiar de otro cliente ni de una venta de otra botica", async () => {
    const mio = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    const otro = await crearCliente(tok.operVes, { nombre: "Juan Pérez" });

    const rf = await req(`/api/clientes/${otro}/familiares`, post(tok.operVes, { nombre: "Hijo de Juan", relacion: "hijo" }));
    const { familiar } = (await rf.json()) as { familiar: { id: string } };

    const familiarAjeno = await req(`/api/clientes/${mio}/tratamientos`, post(tok.operVes, { descripcion: "ibuprofeno", familiar_id: familiar.id }));
    expect(familiarAjeno.status).toBe(404);

    const ventaAjena = await req(`/api/clientes/${mio}/tratamientos`, post(tok.operVes, { descripcion: "ibuprofeno", venta_id: ventaChz }));
    expect(ventaAjena.status).toBe(404);

    // La venta de MI botica sí se acepta.
    const ok = await req(`/api/clientes/${mio}/tratamientos`, post(tok.operVes, { descripcion: "ibuprofeno", venta_id: ventaVes }));
    expect(ok.status).toBe(201);
  });

  it("11) editar un tratamiento ajeno → 404, aun conociendo su id y usando un cliente propio", async () => {
    const ajeno = await crearCliente(tok.operChz, { nombre: "Cliente Chazuta" });
    const rt = await req(`/api/clientes/${ajeno}/tratamientos`, post(tok.operChz, { descripcion: "amoxicilina", duracion_dias: 7, fecha_inicio: diaLima(-1) }));
    const { id: tratamientoAjeno } = (await rt.json()) as { id: string };

    const propio = await crearCliente(tok.operVes, { nombre: "Cliente VES" });
    // Id de tratamiento real de la otra botica, colgado de un cliente que sí es mío: el JOIN debe cortarlo.
    const r = await req(`/api/clientes/${propio}/tratamientos/${tratamientoAjeno}`, patch(tok.operVes, { estado: "cerrado" }));
    expect(r.status).toBe(404);

    const fila = await env.DB.prepare(`SELECT estado FROM tratamiento WHERE id = ?1`).bind(tratamientoAjeno).first<{ estado: string }>();
    expect(fila?.estado).toBe("activo");
  });

  it("12) el panel solo trae familiares, seguimientos y compras del cliente pedido", async () => {
    const mio = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    const otro = await crearCliente(tok.operVes, { nombre: "Juan Pérez" });
    await req(`/api/clientes/${mio}/familiares`, post(tok.operVes, { nombre: "Hijo de María", relacion: "hijo" }));
    await req(`/api/clientes/${otro}/familiares`, post(tok.operVes, { nombre: "Hijo de Juan", relacion: "hijo" }));
    await req(`/api/clientes/${mio}/tratamientos`, post(tok.operVes, { descripcion: "ibuprofeno para el hijo" }));
    await req(`/api/clientes/${otro}/tratamientos`, post(tok.operVes, { descripcion: "amoxicilina" }));

    const panel = (await (await req(`/api/clientes/${mio}/panel`, bearer(tok.operVes))).json()) as {
      cliente: { id: string };
      familiares: { nombre: string }[];
      tratamientos: { descripcion: string }[];
    };
    expect(panel.cliente.id).toBe(mio);
    expect(panel.familiares.map((f) => f.nombre)).toEqual(["Hijo de María"]);
    expect(panel.tratamientos.map((t) => t.descripcion)).toEqual(["ibuprofeno para el hijo"]);
  });
});

describe("P1 — integridad de `venta.cliente_id` (sin FK, validada por el repo)", () => {
  const venta = (clienteId: string | null, uuid: string) => ({
    client_uuid: uuid,
    metodo_pago: "efectivo",
    ...(clienteId ? { cliente_id: clienteId } : {}),
    items: [{ producto_id: P1, cantidad: 1, precio_sin_igv_unitario_dm: 15254 }],
  });

  it("13) vender asignando un cliente de OTRA botica → 404 y la venta NO se crea", async () => {
    const ajeno = await crearCliente(tok.operChz, { nombre: "Cliente Chazuta" });
    const r = await req("/api/ventas", post(tok.operVes, venta(ajeno, "cu-fuga")));
    expect(r.status).toBe(404);

    const fila = await env.DB.prepare(`SELECT id FROM venta WHERE client_uuid = 'cu-fuga'`).first<{ id: string }>();
    expect(fila).toBeNull();
  });

  it("14) cliente_id inexistente o ya borrado → 404 (la columna no acepta basura)", async () => {
    const inexistente = await req("/api/ventas", post(tok.operVes, venta("no-existe", "cu-inventado")));
    expect(inexistente.status).toBe(404);

    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    await req(`/api/clientes/${id}`, del(tok.adminVes));
    const borrado = await req("/api/ventas", post(tok.operVes, venta(id, "cu-borrado")));
    expect(borrado.status).toBe(404);

    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM venta WHERE client_uuid IN ('cu-inventado','cu-borrado')`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("15) con un cliente propio la venta entra y queda asignada (y sale en su panel)", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    const r = await req("/api/ventas", post(tok.operVes, venta(id, "cu-buena")));
    expect(r.status).toBe(200);

    const fila = await env.DB.prepare(`SELECT cliente_id FROM venta WHERE client_uuid = 'cu-buena'`).first<{ cliente_id: string }>();
    expect(fila?.cliente_id).toBe(id);

    const panel = (await (await req(`/api/clientes/${id}/panel`, bearer(tok.operVes))).json()) as { compras: { total_cent: number }[] };
    expect(panel.compras.length).toBe(1);
    expect(panel.compras[0]!.total_cent).toBe(180);
  });
});

describe("P1 — seguimientos pendientes (sin IA: fecha + duración)", () => {
  it("16) solo sale el que ya vence; el que aún no, no aparece", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    await req(`/api/clientes/${id}/tratamientos`, post(tok.operVes, {
      descripcion: "ibuprofeno para el hijo",
      indicacion_seguimiento: "preguntar si le bajó la fiebre",
      duracion_dias: 5,
      fecha_inicio: diaLima(-6),
    }));
    await req(`/api/clientes/${id}/tratamientos`, post(tok.operVes, {
      descripcion: "vitaminas",
      duracion_dias: 30,
      fecha_inicio: diaLima(0),
    }));

    const r = (await (await req("/api/seguimientos/pendientes", bearer(tok.operVes))).json()) as {
      pendientes: { descripcion: string; indicacion_seguimiento: string | null; dias_de_atraso: number; cliente_nombre: string }[];
    };
    expect(r.pendientes.length).toBe(1);
    expect(r.pendientes[0]!.descripcion).toBe("ibuprofeno para el hijo");
    expect(r.pendientes[0]!.indicacion_seguimiento).toBe("preguntar si le bajó la fiebre");
    expect(r.pendientes[0]!.cliente_nombre).toBe("María Quispe");
    expect(r.pendientes[0]!.dias_de_atraso).toBe(1);
  });

  it("17) sin duración escrita, la deduce de cantidad ÷ dosis diaria", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "Juan Pérez" });
    // 20 tabletas a 4 por día = 5 días; iniciado hace 6 → le tocaba ayer.
    await req(`/api/clientes/${id}/tratamientos`, post(tok.operVes, {
      descripcion: "amoxicilina",
      cantidad_dispensada: 20,
      dosis_diaria: 4,
      fecha_inicio: diaLima(-6),
    }));
    // Sin duración NI dosis no hay regla de días que aplicar: no entra a la lista (sí al panel).
    await req(`/api/clientes/${id}/tratamientos`, post(tok.operVes, { descripcion: "crema", fecha_inicio: diaLima(-30) }));

    const r = (await (await req("/api/seguimientos/pendientes", bearer(tok.operVes))).json()) as { pendientes: { descripcion: string }[] };
    expect(r.pendientes.map((p) => p.descripcion)).toEqual(["amoxicilina"]);

    const panel = (await (await req(`/api/clientes/${id}/panel`, bearer(tok.operVes))).json()) as { tratamientos: unknown[] };
    expect(panel.tratamientos.length).toBe(2);
  });

  it("18) la lista es POR BOTICA y cerrar el seguimiento lo saca", async () => {
    const ves = await crearCliente(tok.operVes, { nombre: "Cliente VES" });
    const chz = await crearCliente(tok.operChz, { nombre: "Cliente Chazuta" });
    const vencido = { descripcion: "control", duracion_dias: 3, fecha_inicio: diaLima(-5) };
    const rt = await req(`/api/clientes/${ves}/tratamientos`, post(tok.operVes, vencido));
    const { id: tratamientoVes } = (await rt.json()) as { id: string };
    await req(`/api/clientes/${chz}/tratamientos`, post(tok.operChz, vencido));

    const antesVes = (await (await req("/api/seguimientos/pendientes", bearer(tok.operVes))).json()) as { pendientes: { cliente_nombre: string }[] };
    const antesChz = (await (await req("/api/seguimientos/pendientes", bearer(tok.operChz))).json()) as { pendientes: { cliente_nombre: string }[] };
    expect(antesVes.pendientes.map((p) => p.cliente_nombre)).toEqual(["Cliente VES"]);
    expect(antesChz.pendientes.map((p) => p.cliente_nombre)).toEqual(["Cliente Chazuta"]);

    expect((await req(`/api/clientes/${ves}/tratamientos/${tratamientoVes}`, patch(tok.operVes, { estado: "cerrado" }))).status).toBe(200);
    const despues = (await (await req("/api/seguimientos/pendientes", bearer(tok.operVes))).json()) as { pendientes: unknown[] };
    expect(despues.pendientes.length).toBe(0);
  });
});

describe("P1 — permisos sobre datos personales", () => {
  it("19) lector_reportes NO accede al padrón (ni listar, ni buscar, ni panel)", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe", dni: "45678912", alergias: "penicilina" });
    for (const ruta of ["/api/clientes", "/api/clientes/buscar?q=maria", `/api/clientes/${id}/panel`, "/api/seguimientos/pendientes"]) {
      expect((await req(ruta, bearer(tok.lector))).status, ruta).toBe(403);
    }
  });

  it("20) un token de dispositivo (el A10 del mostrador) no lee clientes", async () => {
    expect((await req("/api/clientes", bearer(tok.device))).status).toBe(403);
    expect((await req("/api/clientes/buscar?q=maria", bearer(tok.device))).status).toBe(403);
  });

  it("21) el operador crea y lee, pero editar y borrar el perfil es de admin", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    expect((await req(`/api/clientes/${id}`, patch(tok.operVes, { notas: "x" }))).status).toBe(403);
    expect((await req(`/api/clientes/${id}`, del(tok.operVes))).status).toBe(403);
    expect((await req(`/api/clientes/${id}/panel`, bearer(tok.operVes))).status).toBe(200);
    // Cerrar el seguimiento SÍ es del operador: es el acto de mostrador que remata el flujo.
    const rt = await req(`/api/clientes/${id}/tratamientos`, post(tok.operVes, { descripcion: "control" }));
    const { id: tid } = (await rt.json()) as { id: string };
    expect((await req(`/api/clientes/${id}/tratamientos/${tid}`, patch(tok.operVes, { estado: "cerrado" }))).status).toBe(200);
  });

  it("22) sin sesión no se llega a nada", async () => {
    expect((await req("/api/clientes")).status).toBe(401);
    expect((await req("/api/clientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
  });
});

describe("P1 — consentimiento de WhatsApp", () => {
  it("23) el opt-in guarda la fecha y el TEXTO exacto que se leyó; revocarlo limpia ambos", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe", whatsapp: "918 343 561", optin_whatsapp: true });

    const conOptin = await env.DB.prepare(`SELECT optin_whatsapp, optin_whatsapp_at, optin_whatsapp_texto, whatsapp FROM cliente WHERE id = ?1`).bind(id)
      .first<{ optin_whatsapp: number; optin_whatsapp_at: string | null; optin_whatsapp_texto: string | null; whatsapp: string | null }>();
    expect(conOptin?.optin_whatsapp).toBe(1);
    expect(conOptin?.optin_whatsapp_texto).toBe(TEXTO_OPTIN_WHATSAPP);
    expect(conOptin?.optin_whatsapp_at).toBeTruthy();
    expect(conOptin?.whatsapp).toBe("918343561"); // normalizado a dígitos para el deep-link de A2

    await req(`/api/clientes/${id}`, patch(tok.adminVes, { optin_whatsapp: false }));
    const revocado = await env.DB.prepare(`SELECT optin_whatsapp, optin_whatsapp_at, optin_whatsapp_texto FROM cliente WHERE id = ?1`).bind(id)
      .first<{ optin_whatsapp: number; optin_whatsapp_at: string | null; optin_whatsapp_texto: string | null }>();
    expect(revocado?.optin_whatsapp).toBe(0);
    expect(revocado?.optin_whatsapp_at).toBeNull();
    expect(revocado?.optin_whatsapp_texto).toBeNull();
  });

  it("24) sin opt-in explícito nadie queda marcado como que aceptó", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "Juan Pérez", telefono: "918343561" });
    const fila = await env.DB.prepare(`SELECT optin_whatsapp, optin_whatsapp_at FROM cliente WHERE id = ?1`).bind(id)
      .first<{ optin_whatsapp: number; optin_whatsapp_at: string | null }>();
    expect(fila?.optin_whatsapp).toBe(0);
    expect(fila?.optin_whatsapp_at).toBeNull();
  });
});

describe("P1 — alta rápida y paginación", () => {
  it("25) con el nombre solo alcanza (los 10 segundos del mostrador); sin nombre → 400", async () => {
    const r = await req("/api/clientes", post(tok.operVes, { nombre: "Señora del ibuprofeno" }));
    expect(r.status).toBe(201);
    expect((await req("/api/clientes", post(tok.operVes, { nombre: "   " }))).status).toBe(400);
    expect((await req("/api/clientes", post(tok.operVes, {}))).status).toBe(400);
  });

  it("26) el cursor keyset recorre el padrón completo sin repetir ni saltarse a nadie", async () => {
    for (let i = 0; i < 7; i++) await crearCliente(tok.operVes, { nombre: `Cliente ${i}` });

    const vistos: string[] = [];
    let cursor: string | null = null;
    for (let pagina = 0; pagina < 10; pagina++) {
      const url: string = `/api/clientes?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const j = (await (await req(url, bearer(tok.operVes))).json()) as { clientes: { id: string }[]; siguiente_cursor: string | null };
      vistos.push(...j.clientes.map((c) => c.id));
      cursor = j.siguiente_cursor;
      if (!cursor) break;
    }
    expect(vistos.length).toBe(7);
    expect(new Set(vistos).size).toBe(7);
  });

  it("28) un body con tipos raros responde 400, nunca 500 ni guarda basura", async () => {
    // Sin coerción defensiva, `{}` haría reventar `.trim()` (TypeError → 500) y un `String(v)` a
    // ciegas guardaría el literal "[object Object]" como nombre de una persona.
    for (const nombre of [{}, [], 123, true, null]) {
      const r = await req("/api/clientes", post(tok.operVes, { nombre }));
      expect(r.status, `nombre=${JSON.stringify(nombre)}`).toBe(400);
    }

    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    // Un objeto en un campo opcional se toma como "borrar el dato", jamás como valor.
    expect((await req(`/api/clientes/${id}`, patch(tok.adminVes, { alias: {} }))).status).toBe(200);
    expect((await req(`/api/clientes/${id}`, patch(tok.adminVes, { nombre: {} }))).status).toBe(400);
    const fila = await env.DB.prepare(`SELECT nombre, alias FROM cliente WHERE id = ?1`).bind(id).first<{ nombre: string; alias: string | null }>();
    expect(fila?.nombre).toBe("María Quispe");
    expect(fila?.alias).toBeNull();

    // Y un estado inventado no burla el cast de TypeScript ni el CHECK de la tabla.
    const rt = await req(`/api/clientes/${id}/tratamientos`, post(tok.operVes, { descripcion: "control" }));
    const { id: tid } = (await rt.json()) as { id: string };
    expect((await req(`/api/clientes/${id}/tratamientos/${tid}`, patch(tok.operVes, { estado: "borrado" }))).status).toBe(400);
    expect((await req(`/api/clientes/${id}/tratamientos`, post(tok.operVes, { descripcion: "x", duracion_dias: "muchos" }))).status).toBe(400);
    expect((await req(`/api/clientes/${id}/tratamientos`, post(tok.operVes, { descripcion: "x", dosis_diaria: 0 }))).status).toBe(400);
  });

  it("27) fecha_nacimiento mal formada → 400 (los cumpleaños salen de ahí)", async () => {
    expect((await req("/api/clientes", post(tok.operVes, { nombre: "X", fecha_nacimiento: "12/05/1990" }))).status).toBe(400);
    expect((await req("/api/clientes", post(tok.operVes, { nombre: "X", fecha_nacimiento: "1990-05-12" }))).status).toBe(201);
  });
});

// ============================================================
// S14 — lo que la UI necesita y S13 no construyó: cumpleaños de la semana y el KPI de identificadas.
// ============================================================

// Fecha de nacimiento cuyo MM-DD cae dentro de N días (misma cuenta de día Lima que el server).
const naceEn = (offsetDias: number, anio = 1990): string => `${anio}-${diaLima(offsetDias).slice(5)}`;

describe("P1/S14 — cumpleaños de la semana", () => {
  it("29) trae los de los próximos 7 días, en orden, y deja fuera al de la semana que viene", async () => {
    await crearCliente(tok.operVes, { nombre: "Cumple Hoy", fecha_nacimiento: naceEn(0) });
    await crearCliente(tok.operVes, { nombre: "Cumple En Tres", fecha_nacimiento: naceEn(3) });
    await crearCliente(tok.operVes, { nombre: "Cumple En Diez", fecha_nacimiento: naceEn(10) });
    await crearCliente(tok.operVes, { nombre: "Sin Fecha" });

    const r = (await (await req("/api/clientes/cumpleanos", bearer(tok.operVes))).json()) as {
      cumpleanos: { nombre: string; dias_para: number; edad: number | null; fecha: string }[];
    };
    expect(r.cumpleanos.map((c) => c.nombre)).toEqual(["Cumple Hoy", "Cumple En Tres"]);
    expect(r.cumpleanos[0]!.dias_para).toBe(0);
    expect(r.cumpleanos[1]!.dias_para).toBe(3);
    expect(r.cumpleanos[0]!.fecha).toBe(diaLima(0));
    // La edad se calcula sobre el año del cumpleaños, no sobre "hoy".
    expect(r.cumpleanos[0]!.edad).toBe(Number(diaLima(0).slice(0, 4)) - 1990);
  });

  it("30) la lista es POR BOTICA: el cumpleañero de Chazuta no aparece en VES", async () => {
    await crearCliente(tok.operVes, { nombre: "Cumple VES", fecha_nacimiento: naceEn(1) });
    await crearCliente(tok.operChz, { nombre: "Cumple Chazuta", fecha_nacimiento: naceEn(1) });

    const ves = (await (await req("/api/clientes/cumpleanos", bearer(tok.operVes))).json()) as { cumpleanos: { nombre: string }[] };
    const chz = (await (await req("/api/clientes/cumpleanos", bearer(tok.operChz))).json()) as { cumpleanos: { nombre: string }[] };
    expect(ves.cumpleanos.map((c) => c.nombre)).toEqual(["Cumple VES"]);
    expect(chz.cumpleanos.map((c) => c.nombre)).toEqual(["Cumple Chazuta"]);
  });

  it("31) son nombres de personas: lector_reportes y dispositivo quedan fuera; sin sesión, 401", async () => {
    await crearCliente(tok.operVes, { nombre: "Cumple Hoy", fecha_nacimiento: naceEn(0) });
    expect((await req("/api/clientes/cumpleanos", bearer(tok.lector))).status).toBe(403);
    expect((await req("/api/clientes/cumpleanos", bearer(tok.device))).status).toBe(403);
    expect((await req("/api/clientes/cumpleanos")).status).toBe(401);
  });

  it("32) el cliente borrado deja de cumplir años en la lista", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "Cumple Hoy", fecha_nacimiento: naceEn(0) });
    await req(`/api/clientes/${id}`, del(tok.adminVes));
    const r = (await (await req("/api/clientes/cumpleanos", bearer(tok.operVes))).json()) as { cumpleanos: unknown[] };
    expect(r.cumpleanos.length).toBe(0);
  });

  it("33) la ventana se puede ampliar con ?dias= (para preparar la semana)", async () => {
    await crearCliente(tok.operVes, { nombre: "Cumple En Diez", fecha_nacimiento: naceEn(10) });
    const semana = (await (await req("/api/clientes/cumpleanos", bearer(tok.operVes))).json()) as { cumpleanos: unknown[] };
    const quincena = (await (await req("/api/clientes/cumpleanos?dias=15", bearer(tok.operVes))).json()) as { cumpleanos: { dias_para: number }[] };
    expect(semana.cumpleanos.length).toBe(0);
    expect(quincena.cumpleanos.map((c) => c.dias_para)).toEqual([10]);
  });
});

describe("P1/S14 — KPI '% de ventas identificadas' (A1), derivado de datos vivos", () => {
  const venta = (clienteId: string | null, uuid: string) => ({
    client_uuid: uuid,
    metodo_pago: "efectivo",
    ...(clienteId ? { cliente_id: clienteId } : {}),
    items: [{ producto_id: P1, cantidad: 1, precio_sin_igv_unitario_dm: 15254 }],
  });
  type Resumen = {
    cadena: { identificadas_hoy: { ventas: number; identificadas: number; pct: number | null } } | null;
    boticas: { sucursal_id: string; identificadas_hoy: { ventas: number; identificadas: number; pct: number | null }; identificadas_30d: { ventas: number; identificadas: number } }[];
  };

  it("34) sale del conteo real de ventas de HOY, nunca de un número escrito a mano", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    expect((await req("/api/ventas", post(tok.operVes, venta(id, "cu-id-1")))).status).toBe(200);
    expect((await req("/api/ventas", post(tok.operVes, venta(null, "cu-anon-1")))).status).toBe(200);

    const r = (await (await req("/api/hoy/resumen", bearer(tok.adminVes))).json()) as Resumen;
    const ves = r.boticas.find((b) => b.sucursal_id === sV)!;
    expect(ves.identificadas_hoy).toEqual({ ventas: 2, identificadas: 1, pct: 50 });
    // La ventana de 30 días contiene lo de hoy (y puede traer más del fixture: no se fija un exacto).
    expect(ves.identificadas_30d.ventas).toBeGreaterThanOrEqual(2);
    expect(ves.identificadas_30d.identificadas).toBeGreaterThanOrEqual(1);
  });

  it("35) sin ventas hoy el KPI es null, NO 0 % (que se leería como 'nadie se identificó')", async () => {
    const r = (await (await req("/api/hoy/resumen", bearer(tok.adminChz))).json()) as Resumen;
    const chz = r.boticas.find((b) => b.sucursal_id === sC)!;
    expect(chz.identificadas_hoy.ventas).toBe(0);
    expect(chz.identificadas_hoy.pct).toBeNull();
  });

  it("36) identificar en VES no mueve el KPI de Chazuta, y el de la cadena suma ventas (no promedia %)", async () => {
    const id = await crearCliente(tok.operVes, { nombre: "María Quispe" });
    await req("/api/ventas", post(tok.operVes, venta(id, "cu-id-2")));
    await req("/api/ventas", post(tok.operVes, venta(null, "cu-anon-2")));
    await req("/api/ventas", post(tok.operVes, venta(null, "cu-anon-3")));

    const chz = (await (await req("/api/hoy/resumen", bearer(tok.adminChz))).json()) as Resumen;
    expect(chz.boticas.find((b) => b.sucursal_id === sC)!.identificadas_hoy).toEqual({ ventas: 0, identificadas: 0, pct: null });

    // El super ve la cadena: 1 de 3 = 33 % (si promediara los porcentajes de las dos boticas daría otra cosa).
    const superR = (await (await req("/api/hoy/resumen", bearer(tok.super))).json()) as Resumen;
    expect(superR.cadena!.identificadas_hoy).toEqual({ ventas: 3, identificadas: 1, pct: 33 });
  });
});
