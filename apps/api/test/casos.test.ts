import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";
import { barrerCasos, casosRepo, evaluarCasosSucursal, UMBRAL } from "../src/repos/casos";

// ============================================================
// GATE B11 (S9 §9 + plan expansión §5 D1 / §3 B1) — EBR determinista + bandeja + espejo.
// Datos sintéticos que disparan CADA indicador → casos correctos; falsos controlados; idempotencia del
// Cron; autocierre con reloj; aislamiento por sucursal; espejo por operador. Sin IA, sin audio (veto D-N5).
// ============================================================

const TS = "2026-01-01T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";
const AHORA = "2026-07-11T08:00:00.000Z"; // 03:00 Lima → último día cerrado = 2026-07-10
const IN = "2026-07-10T20:00:00.000Z"; // 15:00 Lima — DENTRO del horario 14:30–00:00
const OUT = "2026-07-10T15:00:00.000Z"; // 10:00 Lima — FUERA (antes de abrir)
const HACE_20D = "2026-06-25T20:00:00.000Z"; // dentro de la ventana de 30 días

const TA = "t-a";
const TB = "t-b";
const sucA = "suc-a"; // con horario 14:30–00:00
const sucA2 = "suc-a2"; // sin horario
const sucB = "suc-b"; // otro tenant
const tok = { superA: "tok-super-a", adminA: "tok-admin-a", adminA2: "tok-admin-a2", operA: "tok-oper-a", superB: "tok-super-b" };

const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown): RequestInit => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

const PW = "pbkdf2$100000$c2FsdA==$aGFzaA==";

// Org limpia: tenants, 3 sucursales (sucA con horario), admins/super/operador + sesiones. Sin datos de negocio.
async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of ["caso", "cierre_caja", "evento_caja", "venta_item", "venta", "precio_local", "presentacion", "inventario_local", "producto_catalogo", "sesion", "usuario_perfil", "sucursal", "tenant"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'A','Huayruro',?2,?2)`).bind(TA, TS),
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'B','Otra',?2,?2)`).bind(TB, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,activa,hora_apertura,hora_cierre,created_at,updated_at) VALUES (?1,?2,'VES',1,'14:30','00:00',?3,?3)`).bind(sucA, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,activa,created_at,updated_at) VALUES (?1,?2,'Plaza',1,?3,?3)`).bind(sucA2, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,activa,created_at,updated_at) VALUES (?1,?2,'Ajena',1,?3,?3)`).bind(sucB, TB, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-a',?1,NULL,'super_admin','SuperA','sa@h.local',?2,?3,?3)`).bind(TA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-a',?1,?2,'admin_sucursal','AdminA','aa@h.local',?3,?4,?4)`).bind(TA, sucA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-a2',?1,?2,'admin_sucursal','AdminA2','aa2@h.local',?3,?4,?4)`).bind(TA, sucA2, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-oper-a',?1,?2,'operador','OperA','oa@h.local',?3,?4,?4)`).bind(TA, sucA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-b',?1,NULL,'super_admin','SuperB','sb@h.local',?2,?3,?3)`).bind(TB, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s0','u-super-a',?1,?2,?3)`).bind(await hashToken(tok.superA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s1','u-admin-a',?1,?2,?3)`).bind(await hashToken(tok.adminA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s2','u-admin-a2',?1,?2,?3)`).bind(await hashToken(tok.adminA2), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s3','u-oper-a',?1,?2,?3)`).bind(await hashToken(tok.operA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s4','u-super-b',?1,?2,?3)`).bind(await hashToken(tok.superB), TS, FUTURO),
  ]);
}

// ---- Helpers de siembra de datos de negocio ----
async function seedOperador(id: string, sucursalId: string, nombre: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'operador',?4,?5,?6,?7,?7)`)
    .bind(id, TA, sucursalId, nombre, `${id}@h.local`, PW, TS).run();
}
async function seedVenta(id: string, sucursalId: string, operadorId: string | null, fechaHora: string, estado = "completada", totalCent = 1180, atencionInicio: string | null = null): Promise<void> {
  const sub = Math.round(totalCent / 1.18);
  await env.DB.prepare(
    `INSERT INTO venta (id,client_uuid,sucursal_id,operador_id,fecha_hora,atencion_inicio,subtotal_sin_igv_cent,igv_total_cent,total_cent,metodo_pago,estado,created_at,updated_at)
     VALUES (?1,?1,?2,?3,?4,?5,?6,?7,?8,'efectivo',?9,?4,?4)`,
  ).bind(id, sucursalId, operadorId, fechaHora, atencionInicio, sub, totalCent - sub, totalCent, estado).run();
}
async function seedEvento(id: string, sucursalId: string, operadorId: string | null, tipo: string, fechaHora: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO evento_caja (id,client_uuid,sucursal_id,operador_id,tipo,fecha_hora) VALUES (?1,?1,?2,?3,?4,?5)`)
    .bind(id, sucursalId, operadorId, tipo, fechaHora).run();
}
async function seedCierre(id: string, sucursalId: string, fecha: string, diferenciaCent: number, cerradoPor: string | null = null): Promise<void> {
  await env.DB.prepare(`INSERT INTO cierre_caja (id,sucursal_id,fecha,total_sistema_cent,diferencia_cent,cerrado_por,cerrado_at) VALUES (?1,?2,?3,0,?4,?5,?6)`)
    .bind(id, sucursalId, fecha, diferenciaCent, cerradoPor, `${fecha}T23:59:00.000Z`).run();
}
async function seedInventario(sucursalId: string, productoId: string, nombre: string, stock: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)`).bind(productoId, TA, nombre, TS),
    env.DB.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,?4,0,?5)`).bind(`inv-${productoId}-${sucursalId}`, sucursalId, productoId, stock, TS),
  ]);
}
// Una línea de venta cobrada por debajo del precio vigente (producto + presentación + precio_local).
async function seedBajoPrecio(ventaId: string, sucursalId: string, operadorId: string, fechaHora: string, cobradoDm: number, vigenteDm: number, cantidad = 1): Promise<void> {
  const prod = `p-${ventaId}`;
  const pres = `pres-${ventaId}`;
  await seedVenta(ventaId, sucursalId, operadorId, fechaHora);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)`).bind(prod, TA, `Prod ${ventaId}`, TS),
    env.DB.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(pres, prod, TS),
    env.DB.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES (?1,?2,?3,?4,?5,0,?5,?6,?6)`).bind(`pl-${ventaId}`, prod, sucursalId, pres, vigenteDm, TS),
    env.DB.prepare(`INSERT INTO venta_item (id,venta_id,producto_id,presentacion_id,cantidad_presentacion,cantidad,precio_sin_igv_unitario_dm,igv_unitario_dm,precio_total_unitario_dm,subtotal_sin_igv_cent,igv_subtotal_cent,total_cent,created_at) VALUES (?1,?2,?3,?4,?7,?7,?5,0,?5,0,0,0,?6)`).bind(`vi-${ventaId}`, ventaId, prod, pres, cobradoDm, TS, cantidad),
  ]);
}

const casos = (sucursalId: string, estado: string | null = null) => casosRepo(env.DB).listar(sucursalId, estado);
const soloDe = (arr: Awaited<ReturnType<typeof casos>>, indicador: string) => arr.filter((c) => c.indicador === indicador);

beforeEach(sembrar);

describe("EBR — cada indicador dispara su caso con evidencia", () => {
  it("cajón sin venta: un operador muy por encima del promedio de la botica → caso 'personal'", async () => {
    await seedOperador("op1", sucA, "Juan");
    await seedOperador("op2", sucA, "Ana");
    for (let i = 0; i < 6; i++) await seedEvento(`e1-${i}`, sucA, "op1", "apertura_sin_venta", IN);
    await seedVenta("v-op1", sucA, "op1", IN); // ambos activos ese día (denominador del promedio)
    await seedVenta("v-op2", sucA, "op2", IN);
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    const c = soloDe(await casos(sucA), "cajon_sin_venta");
    expect(c).toHaveLength(1);
    expect(c[0]!.tipo).toBe("personal");
    expect((c[0]!.evidencia as { operador_id: string }).operador_id).toBe("op1");
    expect((c[0]!.evidencia as { eventos: number }).eventos).toBe(6);
  });

  it("anulaciones: tasa del operador ≥2× el promedio de la botica (30 días) → caso", async () => {
    await seedOperador("op3", sucA, "Luz");
    await seedOperador("op4", sucA, "Rosa");
    for (let i = 0; i < 5; i++) await seedVenta(`an-${i}`, sucA, "op3", HACE_20D, "anulada");
    for (let i = 0; i < 5; i++) await seedVenta(`ac-${i}`, sucA, "op3", HACE_20D, "completada");
    for (let i = 0; i < 20; i++) await seedVenta(`ok-${i}`, sucA, "op4", HACE_20D, "completada");
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    const c = soloDe(await casos(sucA), "anulaciones");
    expect(c).toHaveLength(1);
    expect((c[0]!.evidencia as { operador_id: string }).operador_id).toBe("op3");
    expect((c[0]!.evidencia as { anuladas: number }).anuladas).toBe(5);
  });

  it("venta bajo precio: ≥2 líneas cobradas por debajo del vigente → caso", async () => {
    await seedOperador("op5", sucA, "Beto");
    await seedBajoPrecio("bp1", sucA, "op5", IN, 5000, 10000);
    await seedBajoPrecio("bp2", sucA, "op5", IN, 4000, 10000);
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    const c = soloDe(await casos(sucA), "venta_bajo_precio");
    expect(c).toHaveLength(1);
    expect((c[0]!.evidencia as { lineas: number }).lineas).toBe(2);
  });

  it("una sola línea bajo precio NO dispara (puede ser descuento legítimo)", async () => {
    await seedOperador("op5b", sucA, "Nora");
    await seedBajoPrecio("bp3", sucA, "op5b", IN, 5000, 10000);
    await evaluarCasosSucursal(env.DB, sucA, AHORA);
    expect(soloDe(await casos(sucA), "venta_bajo_precio")).toHaveLength(0);
  });

  it("venta bajo precio escala la diferencia por cantidad (F2): 2 líneas × 30 u × S/10 = S/600 → severidad 3", async () => {
    await seedOperador("op5c", sucA, "Vico");
    await seedBajoPrecio("bpq1", sucA, "op5c", IN, 400000, 500000, 30); // S/40 vs S/50, 30 u
    await seedBajoPrecio("bpq2", sucA, "op5c", IN, 400000, 500000, 30);
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    const c = soloDe(await casos(sucA), "venta_bajo_precio");
    expect(c).toHaveLength(1);
    expect((c[0]!.evidencia as { diferencia_cent: number }).diferencia_cent).toBe(60000); // S/600.00
    expect(c[0]!.severidad).toBe(3);
  });

  it("descuadre: faltante grande en un día + recurrente en la ventana → dos casos 'perdida'", async () => {
    await seedCierre("cc1", sucA, "2026-07-10", -6000); // grande + cuenta como día con faltante
    await seedCierre("cc2", sucA, "2026-07-09", -800);
    await seedCierre("cc3", sucA, "2026-07-08", -700);
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    const c = soloDe(await casos(sucA), "descuadre");
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.tipo === "perdida")).toBe(true);
    expect(c.some((x) => (x.evidencia as { tipo_descuadre: string }).tipo_descuadre === "grande")).toBe(true);
    expect(c.some((x) => (x.evidencia as { tipo_descuadre: string }).tipo_descuadre === "recurrente")).toBe(true);
  });

  it("stock negativo: producto por debajo de 0 → caso 'perdida' (severidad por magnitud)", async () => {
    await seedInventario(sucA, "pn1", "Paracetamol", -25);
    await seedInventario(sucA, "pn2", "Ibuprofeno", -3);
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    const c = soloDe(await casos(sucA), "stock_negativo");
    expect(c).toHaveLength(2);
    expect(c.find((x) => (x.evidencia as { producto_id: string }).producto_id === "pn1")!.severidad).toBe(2);
    expect(c.find((x) => (x.evidencia as { producto_id: string }).producto_id === "pn2")!.severidad).toBe(1);
  });

  it("venta fuera de horario: venta a las 10:00 (antes de abrir) → caso; a las 15:00 no", async () => {
    await seedOperador("op6", sucA, "Caro");
    await seedVenta("fh-out", sucA, "op6", OUT); // 10:00 Lima → fuera
    await seedVenta("fh-in", sucA, "op6", IN); // 15:00 Lima → dentro
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    const c = soloDe(await casos(sucA), "fuera_horario");
    expect(c).toHaveLength(1);
    expect((c[0]!.evidencia as { total: number }).total).toBe(1);
  });

  it("sin horario cargado, 'fuera de horario' NO dispara (cero falsos positivos)", async () => {
    await seedOperador("op7", sucA2, "Pepe");
    await seedVenta("fh2", sucA2, "op7", OUT);
    await evaluarCasosSucursal(env.DB, sucA2, AHORA);
    expect(soloDe(await casos(sucA2), "fuera_horario")).toHaveLength(0);
  });
});

describe("EBR — falsos controlados e idempotencia", () => {
  it("operador nuevo con pocas ventas y 1 anulación NO dispara anulaciones (piso de volumen)", async () => {
    await seedOperador("nuevo", sucA, "Nuevo");
    await seedVenta("nv1", sucA, "nuevo", HACE_20D, "anulada");
    await seedVenta("nv2", sucA, "nuevo", HACE_20D, "completada");
    await evaluarCasosSucursal(env.DB, sucA, AHORA);
    expect(soloDe(await casos(sucA), "anulaciones")).toHaveLength(0);
  });

  it("el Cron es idempotente: correr dos veces no duplica casos", async () => {
    await seedInventario(sucA, "pn9", "X", -30);
    const r1 = await evaluarCasosSucursal(env.DB, sucA, AHORA);
    const r2 = await evaluarCasosSucursal(env.DB, sucA, AHORA);
    expect(r1.creados).toBe(1);
    expect(r2.creados).toBe(0); // dedup por clave_dedup
    expect(await casosRepo(env.DB).conteoAbiertos(sucA)).toBe(1);
  });
});

describe("barrerCasos (Cron nocturno) — autocierre + todas las sucursales", () => {
  it("autocierra un caso 'abierto' de más de 14 días y deja los recientes", async () => {
    const viejo = new Date(Date.parse(AHORA) - 20 * 86_400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO caso (id,sucursal_id,tipo,indicador,severidad,evidencia_json,estado,clave_dedup,created_at) VALUES ('c-viejo',?1,'perdida','stock_negativo',1,'{}','abierto','viejo',?2)`).bind(sucA, viejo),
      env.DB.prepare(`INSERT INTO caso (id,sucursal_id,tipo,indicador,severidad,evidencia_json,estado,clave_dedup,created_at) VALUES ('c-nuevo',?1,'perdida','stock_negativo',1,'{}','abierto','nuevo',?2)`).bind(sucA, AHORA),
    ]);
    const r = await barrerCasos(env, AHORA);
    expect(r.autocerrados).toBe(1);

    const todos = await casos(sucA, null);
    expect(todos.find((c) => c.id === "c-viejo")!.estado).toBe("autocerrado");
    expect(todos.find((c) => c.id === "c-nuevo")!.estado).toBe("abierto");
  });

  it("evalúa todas las sucursales activas y devuelve el conteo", async () => {
    await seedInventario(sucA, "z1", "Z", -10);
    await seedInventario(sucB, "z2", "Z", -10);
    const r = await barrerCasos(env, AHORA);
    expect(r.sucursales).toBeGreaterThanOrEqual(3);
    expect(r.creados).toBeGreaterThanOrEqual(2);
  });
});

describe("Bandeja de casos — rutas, aislamiento y resolución", () => {
  async function abrirUnCaso(sucursalId: string): Promise<void> {
    await seedInventario(sucursalId, `neg-${sucursalId}`, "Neg", -10);
    await evaluarCasosSucursal(env.DB, sucursalId, AHORA);
  }

  it("admin lista los casos de SU sucursal; un operador no puede (403)", async () => {
    await abrirUnCaso(sucA);
    const ok = await req("/api/casos", bearer(tok.adminA));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { casos: unknown[] }).casos.length).toBeGreaterThanOrEqual(1);
    expect((await req("/api/casos", bearer(tok.operA))).status).toBe(403);
  });

  it("el super DEBE elegir sucursal y solo una de su tenant (aislamiento)", async () => {
    await abrirUnCaso(sucA);
    expect((await req("/api/casos", bearer(tok.superA))).status).toBe(400); // sin sucursal_id
    expect((await req(`/api/casos?sucursal_id=${sucA}`, bearer(tok.superA))).status).toBe(200);
    expect((await req(`/api/casos?sucursal_id=${sucA}`, bearer(tok.superB))).status).toBe(404); // sucA no es del tenant B
  });

  it("confirmar registra revisor + estado; un admin de otra sucursal no puede tocarlo (404)", async () => {
    await abrirUnCaso(sucA);
    const id = (await casos(sucA))[0]!.id;
    const r = await req(`/api/casos/${id}/confirmar`, post(tok.adminA, { notas: "revisado" }));
    expect(r.status).toBe(200);
    const fila = (await casos(sucA, null)).find((c) => c.id === id)!;
    expect(fila.estado).toBe("confirmado");
    expect(fila.revisor_id).toBe("u-admin-a");
    expect(fila.notas).toBe("revisado");

    await abrirUnCaso(sucA2);
    const idA2 = (await casos(sucA2))[0]!.id;
    expect((await req(`/api/casos/${idA2}/confirmar`, post(tok.adminA, {}))).status).toBe(404);
  });

  it("descartar saca el caso de la bandeja de abiertos", async () => {
    await abrirUnCaso(sucA);
    const id = (await casos(sucA))[0]!.id;
    expect((await req(`/api/casos/${id}/descartar`, post(tok.adminA, {}))).status).toBe(200);
    expect(await casosRepo(env.DB).conteoAbiertos(sucA)).toBe(0);
  });
});

describe("Espejo operativo (B11.2)", () => {
  it("métricas por operador vs promedio de la botica, con tiempo de servicio (Δ2)", async () => {
    await seedOperador("m1", sucA, "Mile");
    await seedOperador("m2", sucA, "Toño");
    // m1: 2 ventas de S/11.80, con atención_inicio (servicio ~120s). m2: 1 venta de S/5.90.
    await seedVenta("mv1", sucA, "m1", IN, "completada", 1180, "2026-07-10T19:58:00.000Z");
    await seedVenta("mv2", sucA, "m1", "2026-07-10T21:00:00.000Z", "completada", 1180, "2026-07-10T20:58:00.000Z");
    await seedVenta("mv3", sucA, "m2", IN, "completada", 590);

    const r = await req(`/api/casos/espejo?sucursal_id=${sucA}`, bearer(tok.superA));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { operadores: Array<{ operador_id: string; ventas: number; ticket_cent: number; servicio_prom_seg: number | null }>; promedio: { ticket_cent: number } };
    const m1 = body.operadores.find((o) => o.operador_id === "m1")!;
    expect(m1.ventas).toBe(2);
    expect(m1.ticket_cent).toBe(1180);
    expect(m1.servicio_prom_seg).toBe(120);
    expect(body.promedio.ticket_cent).toBeGreaterThan(0);
  });

  it("el super no puede ver el espejo de una sucursal de otro tenant (404)", async () => {
    expect((await req(`/api/casos/espejo?sucursal_id=${sucA}`, bearer(tok.superB))).status).toBe(404);
  });
});

describe("Umbrales", () => {
  it("están expuestos y son ajustables sin migración", () => {
    expect(UMBRAL.AUTOCIERRE_DIAS).toBe(14);
    expect(UMBRAL.DESCUADRE_DIAS).toBeGreaterThan(0);
  });
});
