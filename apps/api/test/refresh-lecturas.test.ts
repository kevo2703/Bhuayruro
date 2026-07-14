import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// Refresh visual del panel del dueño — LECTURAS nuevas de backend.
// Aislamiento de 2 tenants (A/B) para /hoy/resumen, /ventas, /consolidado/cierres, /casos/:id/reabrir +
// forma/valor (delta null con baseline 0, pct_yape, orden/límite/items_resumen, cobertura, reabrir).
// Fixture sintético propio (no depende del seed). HTTP real contra el Worker.
// ============================================================

const TS = "2026-01-01T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";

// Reloj: la API usa new Date() real → sembramos "hoy" con new Date() para caer en la misma ventana Lima.
const NOW = new Date();
const nowIso = NOW.toISOString();
const menosDias = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const HACE_5D = menosDias(5);
const HACE_10D = menosDias(10);
const ymdMenos = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);

const TA = "t-ra";
const TB = "t-rb";
const sA1 = "s-a1";
const sA2 = "s-a2";
const sB1 = "s-b1";

const tok = { superA: "tk-super-a", adminA1: "tk-admin-a1", operA1: "tk-oper-a1", superB: "tk-super-b", adminB1: "tk-admin-b1" };
const PW = "pbkdf2$100000$c2FsdA==$aGFzaA==";

const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown = {}): RequestInit => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

async function seedProducto(id: string, tenant: string, nombre: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,activo,created_at,updated_at) VALUES (?1,?2,?3,1,?4,?4)`).bind(id, tenant, nombre, TS).run();
  await env.DB.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(`pres-${id}`, id, TS).run();
}
async function seedInventario(sucursal: string, prodId: string, stock: number, minimo: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,?4,?5,?6)`).bind(`inv-${prodId}-${sucursal}`, sucursal, prodId, stock, minimo, TS).run();
}
async function seedVenta(id: string, sucursal: string, fechaHora: string, metodo: string, totalCent: number, estado = "completada"): Promise<void> {
  const sub = Math.round(totalCent / 1.18);
  await env.DB.prepare(
    `INSERT INTO venta (id,client_uuid,sucursal_id,fecha_hora,subtotal_sin_igv_cent,igv_total_cent,total_cent,metodo_pago,estado,created_at,updated_at)
     VALUES (?1,?1,?2,?3,?4,?5,?6,?7,?8,?3,?3)`,
  ).bind(id, sucursal, fechaHora, sub, totalCent - sub, totalCent, metodo, estado).run();
}
async function seedVentaItem(id: string, ventaId: string, prodId: string, cantidad: number, totalCent: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO venta_item (id,venta_id,producto_id,presentacion_id,cantidad_presentacion,cantidad,precio_sin_igv_unitario_dm,igv_unitario_dm,precio_total_unitario_dm,subtotal_sin_igv_cent,igv_subtotal_cent,total_cent,created_at)
     VALUES (?1,?2,?3,?4,?5,?5,0,0,0,0,0,?6,?7)`,
  ).bind(id, ventaId, prodId, `pres-${prodId}`, cantidad, totalCent, TS).run();
}
async function seedCierre(id: string, sucursal: string, fecha: string, sistema: number, contado: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO cierre_caja (id,sucursal_id,fecha,total_efectivo_cent,total_yape_cent,total_otros_cent,total_sistema_cent,diferencia_cent,cerrado_at) VALUES (?1,?2,?3,?4,0,0,?5,?6,?7)`,
  ).bind(id, sucursal, fecha, contado, sistema, contado - sistema, `${fecha}T23:00:00.000Z`).run();
}
async function seedCasoResuelto(id: string, sucursal: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO caso (id,sucursal_id,tipo,indicador,severidad,evidencia_json,estado,revisor_id,notas,clave_dedup,created_at,resuelto_at)
     VALUES (?1,?2,'perdida','stock_negativo',2,'{"resumen":"x"}','confirmado','u-admin-a1','revisado',?3,?4,?4)`,
  ).bind(id, sucursal, `dedup-${id}`, nowIso).run();
}

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of ["caso", "cierre_caja", "conteo_item", "conteo_sesion", "venta_item", "venta", "precio_local", "presentacion", "inventario_local", "producto_catalogo", "quiebre", "recepcion_borrador", "sesion", "usuario_perfil", "sucursal", "tenant"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'A','Huayruro A',?2,?2)`).bind(TA, TS),
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'B','Otra B',?2,?2)`).bind(TB, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,activa,created_at,updated_at) VALUES (?1,?2,'A Uno',1,?3,?3)`).bind(sA1, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,activa,created_at,updated_at) VALUES (?1,?2,'A Dos',1,?3,?3)`).bind(sA2, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,activa,created_at,updated_at) VALUES (?1,?2,'B Uno',1,?3,?3)`).bind(sB1, TB, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-ra',?1,NULL,'super_admin','SuperA','sra@h.local',?2,?3,?3)`).bind(TA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-a1',?1,?2,'admin_sucursal','AdminA1','aa1@h.local',?3,?4,?4)`).bind(TA, sA1, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-oper-a1',?1,?2,'operador','OperA1','oa1@h.local',?3,?4,?4)`).bind(TA, sA1, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-rb',?1,NULL,'super_admin','SuperB','srb@h.local',?2,?3,?3)`).bind(TB, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-b1',?1,?2,'admin_sucursal','AdminB1','ab1@h.local',?3,?4,?4)`).bind(TB, sB1, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('rs0','u-super-ra',?1,?2,?3)`).bind(await hashToken(tok.superA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('rs1','u-admin-a1',?1,?2,?3)`).bind(await hashToken(tok.adminA1), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('rs2','u-oper-a1',?1,?2,?3)`).bind(await hashToken(tok.operA1), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('rs3','u-super-rb',?1,?2,?3)`).bind(await hashToken(tok.superB), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('rs4','u-admin-b1',?1,?2,?3)`).bind(await hashToken(tok.adminB1), TS, FUTURO),
  ]);

  // Productos (A y B).
  await seedProducto("pA", TA, "Paracetamol 500 mg");
  await seedProducto("pA2", TA, "Clorfenamina");
  await seedProducto("pVel", TA, "Ibuprofeno 400 mg"); // con rotación → cobertura numérica
  await seedProducto("pSin", TA, "Amoxicilina 500 mg"); // sin rotación → cobertura null
  await seedProducto("pB", TB, "Producto B");

  // ---- Ventas de HOY ----
  // sA1: 1000 yape + 1000 efectivo; sA2: 2000 efectivo. Cadena A hoy = 4000, yape 1000 → pct_yape 25.
  await seedVenta("vA1-yape", sA1, nowIso, "yape", 1000);
  await seedVenta("vA1-efec", sA1, nowIso, "efectivo", 1000);
  await seedVenta("vA2-efec", sA2, nowIso, "efectivo", 2000);
  // Venta de hoy con 2 ítems (items_resumen): Paracetamol ×4 · Clorfenamina ×2.
  await seedVenta("vA1-items", sA1, nowIso, "efectivo", 3000);
  await seedVentaItem("viA1-1", "vA1-items", "pA", 4, 2000);
  await seedVentaItem("viA1-2", "vA1-items", "pA2", 2, 1000);
  // Venta en tenant B (para probar aislamiento del feed cadena de A).
  await seedVenta("vB1", sB1, nowIso, "efectivo", 500);

  // ---- Ventas viejas (baseline delta): SOLO en sA1 → sA2 tiene baseline 0 (delta null). ----
  await seedVenta("vA1-old", sA1, HACE_5D, "efectivo", 1400);
  // Rotación de pVel: 60 u vendidas hace 10 días (velocidad = 2/día → cobertura = 15 sobre stock 30).
  await seedVenta("vA1-vel", sA1, HACE_10D, "efectivo", 6000);
  await seedVentaItem("viVel", "vA1-vel", "pVel", 60, 6000);

  // ---- Inventario bajo mínimo en sA1 (cobertura) ----
  await seedInventario(sA1, "pVel", 30, 100); // bajo, con rotación → cobertura 15
  await seedInventario(sA1, "pSin", 5, 100); // bajo, sin rotación → cobertura null

  // ---- Cierres (consolidado): sA1 dentro de 21 días, sB1 en tenant B ----
  await seedCierre("cc-a1", sA1, ymdMenos(2), 5000, 4800); // dif -200
  await seedCierre("cc-b1", sB1, ymdMenos(2), 3000, 3000);
}

beforeEach(sembrar);

describe("/hoy/resumen — aislamiento y valores", () => {
  it("super A ve cadena + SUS 2 boticas; nunca datos de B", async () => {
    const r = await req("/api/hoy/resumen", bearer(tok.superA));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { cadena: { ventas_cent: number; pct_yape: number } | null; boticas: { sucursal_id: string; ventas_cent: number }[] };
    expect(j.cadena).not.toBeNull();
    expect(j.boticas.map((b) => b.sucursal_id).sort()).toEqual([sA1, sA2]);
    expect(j.boticas.some((b) => b.sucursal_id === sB1)).toBe(false);
    // Cadena hoy = 1000+1000+3000 (sA1) + 2000 (sA2) = 7000; yape 1000 → pct 14 (round(1000/7000*100)).
    expect(j.cadena!.ventas_cent).toBe(7000);
    expect(j.cadena!.pct_yape).toBe(Math.round((1000 / 7000) * 100));
  });

  it("admin de sucursal ve SOLO la suya (cadena null, 1 botica)", async () => {
    const r = await req("/api/hoy/resumen", bearer(tok.adminA1));
    const j = (await r.json()) as { cadena: null; boticas: { sucursal_id: string }[] };
    expect(j.cadena).toBeNull();
    expect(j.boticas).toHaveLength(1);
    expect(j.boticas[0]!.sucursal_id).toBe(sA1);
  });

  it("super B no ve ninguna botica de A", async () => {
    const r = await req("/api/hoy/resumen", bearer(tok.superB));
    const j = (await r.json()) as { boticas: { sucursal_id: string }[] };
    expect(j.boticas.map((b) => b.sucursal_id)).toEqual([sB1]);
  });

  it("delta_pct_vs_tipico es null cuando el baseline (14d) es 0", async () => {
    const r = await req("/api/hoy/resumen", bearer(tok.superA));
    const j = (await r.json()) as { boticas: { sucursal_id: string; delta_pct_vs_tipico: number | null }[] };
    const b1 = j.boticas.find((b) => b.sucursal_id === sA1)!;
    const b2 = j.boticas.find((b) => b.sucursal_id === sA2)!;
    expect(typeof b1.delta_pct_vs_tipico).toBe("number"); // sA1 tiene ventas viejas → baseline > 0
    expect(b2.delta_pct_vs_tipico).toBeNull(); // sA2 sin ventas viejas → baseline 0 → null
  });

  it("campos sin columna quedan como null (próximamente): ciudad, en_linea, revisado_2am", async () => {
    const r = await req("/api/hoy/resumen", bearer(tok.adminA1));
    const j = (await r.json()) as { revisado_2am: null; boticas: { ciudad: null; en_linea: null }[] };
    expect(j.revisado_2am).toBeNull();
    expect(j.boticas[0]!.ciudad).toBeNull();
    expect(j.boticas[0]!.en_linea).toBeNull();
  });
});

describe("/ventas — feed, aislamiento, orden, items_resumen", () => {
  it("super A sin sucursal_id → cadena de A (nunca ventas de B)", async () => {
    const r = await req("/api/ventas", bearer(tok.superA));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ventas: { sucursal_id: string; fecha_hora: string; items_resumen: string }[] };
    expect(j.ventas.every((v) => v.sucursal_id === sA1 || v.sucursal_id === sA2)).toBe(true);
    expect(j.ventas.some((v) => v.sucursal_id === sB1)).toBe(false);
    // Orden fecha_hora DESC.
    for (let i = 1; i < j.ventas.length; i++) expect(j.ventas[i - 1]!.fecha_hora >= j.ventas[i]!.fecha_hora).toBe(true);
    // items_resumen de la venta con 2 ítems.
    const conItems = j.ventas.find((v) => v.items_resumen.includes("Paracetamol"));
    expect(conItems!.items_resumen).toContain("Paracetamol 500 mg ×4");
    expect(conItems!.items_resumen).toContain("Clorfenamina ×2");
    expect(conItems!.items_resumen).toContain(" · ");
  });

  it("admin ve solo su sucursal; super A con ?sucursal_id de B → 404", async () => {
    const r = await req("/api/ventas", bearer(tok.adminA1));
    const j = (await r.json()) as { ventas: { sucursal_id: string }[] };
    expect(j.ventas.every((v) => v.sucursal_id === sA1)).toBe(true);
    expect((await req(`/api/ventas?sucursal_id=${sB1}`, bearer(tok.superA))).status).toBe(404);
  });

  it("límite ≤ 40 y solo 'completada'", async () => {
    await seedVenta("vAnul", sA1, nowIso, "efectivo", 900, "anulada");
    const r = await req(`/api/ventas?sucursal_id=${sA1}`, bearer(tok.superA));
    const j = (await r.json()) as { ventas: { id: string }[] };
    expect(j.ventas.length).toBeLessThanOrEqual(40);
    expect(j.ventas.some((v) => v.id === "vAnul")).toBe(false);
  });
});

describe("/consolidado/cierres — solo super, aislado por tenant", () => {
  it("super A ve solo cierres de A, con sucursal_nombre y dif_cent", async () => {
    const r = await req("/api/consolidado/cierres", bearer(tok.superA));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { cierres: { sucursal_id: string; sucursal_nombre: string; dif_cent: number; esperado_cent: number; contado_cent: number }[] };
    expect(j.cierres.length).toBe(1);
    expect(j.cierres[0]!.sucursal_id).toBe(sA1);
    expect(j.cierres[0]!.sucursal_nombre).toBe("A Uno");
    expect(j.cierres[0]!.dif_cent).toBe(-200);
    expect(j.cierres.some((cc) => cc.sucursal_id === sB1)).toBe(false);
  });

  it("admin_sucursal → 403 (solo super)", async () => {
    expect((await req("/api/consolidado/cierres", bearer(tok.adminA1))).status).toBe(403);
  });

  it("/caja/cierres existente ahora trae sucursal_nombre (aditivo)", async () => {
    const r = await req(`/api/caja/cierres?sucursal_id=${sA1}`, bearer(tok.superA));
    const j = (await r.json()) as { cierres: { sucursal_nombre: string }[] };
    expect(j.cierres[0]!.sucursal_nombre).toBe("A Uno");
  });
});

describe("/casos/:id/reabrir — idempotente, limpia campos, aislado", () => {
  it("reabrir vuelve a 'abierto' y limpia revisor/nota/resuelto_at (idempotente)", async () => {
    await seedCasoResuelto("caso-a1", sA1);
    const r1 = await req("/api/casos/caso-a1/reabrir", post(tok.adminA1));
    expect(r1.status).toBe(200);
    const fila1 = await env.DB.prepare(`SELECT estado, revisor_id, notas, resuelto_at FROM caso WHERE id='caso-a1'`).first<{ estado: string; revisor_id: string | null; notas: string | null; resuelto_at: string | null }>();
    expect(fila1!.estado).toBe("abierto");
    expect(fila1!.revisor_id).toBeNull();
    expect(fila1!.notas).toBeNull();
    expect(fila1!.resuelto_at).toBeNull();
    // Idempotente: reabrir de nuevo no falla.
    expect((await req("/api/casos/caso-a1/reabrir", post(tok.adminA1))).status).toBe(200);
  });

  it("un admin no puede reabrir un caso de otra sucursal/tenant (404)", async () => {
    await seedCasoResuelto("caso-b1", sB1);
    expect((await req("/api/casos/caso-b1/reabrir", post(tok.adminA1))).status).toBe(404);
    // super B eligiendo la sucursal de A → 404 (aislamiento de tenant).
    await seedCasoResuelto("caso-a1b", sA1);
    expect((await req(`/api/casos/caso-a1b/reabrir?sucursal_id=${sA1}`, post(tok.superB))).status).toBe(404);
  });

  it("la bandeja /casos trae conteos {abiertos, resueltos} y filtra 'resueltos'", async () => {
    await seedCasoResuelto("caso-r1", sA1);
    const r = await req("/api/casos?estado=resueltos", bearer(tok.adminA1));
    const j = (await r.json()) as { casos: { id: string; estado: string }[]; conteos: { abiertos: number; resueltos: number } };
    expect(j.conteos.resueltos).toBeGreaterThanOrEqual(1);
    expect(j.casos.every((cx) => ["confirmado", "descartado", "autocerrado"].includes(cx.estado))).toBe(true);
  });
});

describe("/inventario cobertura_dias — null cuando velocidad 0", () => {
  it("stock bajo con rotación → número; sin rotación → null", async () => {
    const r = await req(`/api/inventario?sucursal_id=${sA1}&bajo_minimo=1`, bearer(tok.superA));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { inventario: { producto_id: string; cobertura_dias: number | null }[] };
    const vel = j.inventario.find((x) => x.producto_id === "pVel")!;
    const sin = j.inventario.find((x) => x.producto_id === "pSin")!;
    expect(vel.cobertura_dias).toBe(15); // stock 30 / (60u/30d = 2/día)
    expect(sin.cobertura_dias).toBeNull(); // sin ventas → velocidad 0
  });
});

describe("Conteos de catálogo / maestro (Ajustes)", () => {
  it("/catalogo/conteo cuenta productos activos del tenant; /maestro/conteo el maestro global", async () => {
    const cat = (await (await req("/api/catalogo/conteo", bearer(tok.adminA1))).json()) as { activos: number };
    expect(cat.activos).toBe(4); // pA, pA2, pVel, pSin (tenant A)
    const maestro = (await (await req("/api/maestro/conteo", bearer(tok.adminA1))).json()) as { total: number };
    expect(typeof maestro.total).toBe("number");
  });
});
