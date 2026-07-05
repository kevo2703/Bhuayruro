import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// GATE E6.3 (plan §7) — venta atómica, idempotente y con FEFO.
// Cubre: reintento idéntico · carrera de client_uuid · carrera de lote (CHECK-retry) ·
// remanente sin lote · doble anulación · golden dinero vía HTTP · blíster (Δ1, factor 10).
// Fixture SINTÉTICO propio. HTTP real contra el Worker.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";
const T = "t-h";
const sV = "s-ves";
const uOper = "u-oper";
const uAdmin = "u-admin";

// Productos
const PB = "p-blister"; // blíster (factor 10) + FEFO cascada 2 lotes
const PC = "p-carrera"; // carrera de lote (CHECK-retry): lote temprano chico + lote grande
const PR = "p-remanente"; // sin lotes; precio 1249 dm → total ≠ round(S×1.18)
const PG = "p-golden"; // 127119 dm (S/15.00) para golden + idempotencia + anulación

const presB_base = "pres-b-base", presB_bli = "pres-b-bli";
const presC = "pres-c", presR = "pres-r", presG = "pres-g";
const invB = "inv-b", invC = "inv-c", invR = "inv-r", invG = "inv-g";
const loteBa = "lote-b-a", loteBb = "lote-b-b"; // PB: A venc antes (5u), B después (100u)
const loteCa = "lote-c-a", loteCb = "lote-c-b"; // PC: A venc antes (5u), B después (100u)
const loteG = "lote-g"; // PG: 100u

const tok = { oper: "tok-oper", admin: "tok-admin" };
const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const req = (path: string, init?: RequestInit) => app.request(path, init, env);
const num = (v: string, sql: string, ...bind: unknown[]) =>
  env.DB.prepare(sql).bind(...bind).first<Record<string, number>>().then((r) => r?.[v] ?? null);

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of [
    "audit_log", "evento_caja", "movimiento_stock", "venta_item_lote", "venta_item", "venta",
    "lote", "inventario_local", "precio_local", "codigo_barras", "presentacion", "producto_fts",
    "producto_catalogo", "sesion", "usuario_perfil", "sucursal", "tenant",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  const hOper = await hashToken(tok.oper);
  const hAdmin = await hashToken(tok.admin);
  const PW = "pbkdf2$310000$c2FsdA==$aGFzaA==";

  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T','Botica Huayruro',?2,?2)`).bind(T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'VES',?3,?3)`).bind(sV, T, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'operador','Oper','o@h.local',?4,?5,?5)`).bind(uOper, T, sV, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'admin_sucursal','Admin','a@h.local',?4,?5,?5)`).bind(uAdmin, T, sV, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('so',?1,?2,?3,?4)`).bind(uOper, hOper, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('sa',?1,?2,?3,?4)`).bind(uAdmin, hAdmin, TS, FUTURO),
    // Productos
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ibuprofeno 400 mg',?3,?3)`).bind(PB, T, TS),
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Paracetamol 500 mg',?3,?3)`).bind(PC, T, TS),
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Loratadina 10 mg',?3,?3)`).bind(PR, T, TS),
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Postday',?3,?3)`).bind(PG, T, TS),
    // Presentaciones (Δ1)
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(presB_base, PB, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'blíster x10',10,0,?3)`).bind(presB_bli, PB, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(presC, PC, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(presR, PR, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(presG, PG, TS),
    // Precios vigentes (base) — snapshot del request debe coincidir para no generar advertencia
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('pxb',?1,?2,?3,15254,2746,18000,?4,?4)`).bind(PB, sV, presB_base, TS),
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('pxc',?1,?2,?3,15254,2746,18000,?4,?4)`).bind(PC, sV, presC, TS),
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('pxr',?1,?2,?3,1249,225,1474,?4,?4)`).bind(PR, sV, presR, TS),
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('pxg',?1,?2,?3,127119,22881,150000,?4,?4)`).bind(PG, sV, presG, TS),
    // Inventarios (unidades base)
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,200,10,?4)`).bind(invB, sV, PB, TS),
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,200,10,?4)`).bind(invC, sV, PC, TS),
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,50,10,?4)`).bind(invR, sV, PR, TS),
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,100,10,?4)`).bind(invG, sV, PG, TS),
    // Lotes (PR NO tiene lotes → prueba de remanente)
    db.prepare(`INSERT INTO lote (id,inventario_id,numero_lote,fecha_vencimiento,unidades,fecha_recepcion,created_at,updated_at) VALUES (?1,?2,'A','2026-08-01',5,?3,?3,?3)`).bind(loteBa, invB, TS),
    db.prepare(`INSERT INTO lote (id,inventario_id,numero_lote,fecha_vencimiento,unidades,fecha_recepcion,created_at,updated_at) VALUES (?1,?2,'B','2026-12-01',100,?3,?3,?3)`).bind(loteBb, invB, TS),
    db.prepare(`INSERT INTO lote (id,inventario_id,numero_lote,fecha_vencimiento,unidades,fecha_recepcion,created_at,updated_at) VALUES (?1,?2,'A','2026-08-01',5,?3,?3,?3)`).bind(loteCa, invC, TS),
    db.prepare(`INSERT INTO lote (id,inventario_id,numero_lote,fecha_vencimiento,unidades,fecha_recepcion,created_at,updated_at) VALUES (?1,?2,'B','2026-12-01',100,?3,?3,?3)`).bind(loteCb, invC, TS),
    db.prepare(`INSERT INTO lote (id,inventario_id,numero_lote,fecha_vencimiento,unidades,fecha_recepcion,created_at,updated_at) VALUES (?1,?2,'G','2026-10-01',100,?3,?3,?3)`).bind(loteG, invG, TS),
  ]);
}

beforeEach(async () => {
  await sembrar();
});

const venta = (clientUuid: string, items: unknown[], metodo = "efectivo") =>
  post(tok.oper, { client_uuid: clientUuid, metodo_pago: metodo, items });

describe("GATE E6.3 — venta atómica (plan §7)", () => {
  it("golden dinero vía HTTP: Postday qty1=S/15.00, qty7=S/105.00", async () => {
    const r1 = await req("/api/ventas", venta("g-1", [{ producto_id: PG, cantidad: 1, precio_sin_igv_unitario_dm: 127119 }]));
    const j1 = (await r1.json()) as { subtotal_sin_igv_cent: number; igv_total_cent: number; total_cent: number };
    expect([j1.subtotal_sin_igv_cent, j1.igv_total_cent, j1.total_cent]).toEqual([1271, 229, 1500]);

    const r7 = await req("/api/ventas", venta("g-7", [{ producto_id: PG, cantidad: 7, precio_sin_igv_unitario_dm: 127119 }]));
    const j7 = (await r7.json()) as { subtotal_sin_igv_cent: number; igv_total_cent: number; total_cent: number };
    expect(j7.total_cent).toBe(10500);
    expect(j7.subtotal_sin_igv_cent + j7.igv_total_cent).toBe(j7.total_cent);
  });

  it("regresión: el total NO es round(S×1.18) — 1×1249 dm → total 14 (no 15)", async () => {
    const r = await req("/api/ventas", venta("reg-1", [{ producto_id: PR, cantidad: 1, precio_sin_igv_unitario_dm: 1249 }]));
    const j = (await r.json()) as { subtotal_sin_igv_cent: number; igv_total_cent: number; total_cent: number };
    // subtotal=round(1249/100)=12, igv=round(1249*18/10000)=2 → 14. round(1249*118/10000)=15.
    expect([j.subtotal_sin_igv_cent, j.igv_total_cent, j.total_cent]).toEqual([12, 2, 14]);
  });

  it("remanente sin lote: se vende igual, descuenta inventario, sin venta_item_lote", async () => {
    const r = await req("/api/ventas", venta("rem-1", [{ producto_id: PR, cantidad: 3, precio_sin_igv_unitario_dm: 1249 }]));
    expect(r.status).toBe(200);
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE id=?1`, invR)).toBe(47);
    const vils = await num("c", `SELECT COUNT(*) c FROM venta_item_lote vil JOIN venta_item vi ON vi.id=vil.venta_item_id JOIN venta v ON v.id=vi.venta_id WHERE v.client_uuid='rem-1'`);
    expect(vils).toBe(0);
  });

  it("blíster (Δ1, factor 10): qty2 descuenta 20 unidades base, FEFO cascada A(5)+B(15)", async () => {
    const r = await req("/api/ventas", venta("bli-1", [{ producto_id: PB, presentacion_id: presB_bli, cantidad: 2, precio_sin_igv_unitario_dm: 140000 }]));
    expect(r.status).toBe(200);
    expect(await num("cantidad", `SELECT cantidad FROM venta_item vi JOIN venta v ON v.id=vi.venta_id WHERE v.client_uuid='bli-1'`)).toBe(20);
    expect(await num("cp", `SELECT cantidad_presentacion cp FROM venta_item vi JOIN venta v ON v.id=vi.venta_id WHERE v.client_uuid='bli-1'`)).toBe(2);
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE id=?1`, invB)).toBe(180);
    expect(await num("unidades", `SELECT unidades FROM lote WHERE id=?1`, loteBa)).toBe(0); // A agotado (FEFO)
    expect(await num("unidades", `SELECT unidades FROM lote WHERE id=?1`, loteBb)).toBe(85); // B: 100-15
  });

  it("reintento idéntico (secuencial): misma client_uuid → 1 venta, idempotent, stock 1 vez", async () => {
    const item = [{ producto_id: PG, cantidad: 2, precio_sin_igv_unitario_dm: 127119 }];
    const r1 = (await (await req("/api/ventas", venta("idem-1", item))).json()) as { venta_id: string; idempotent: boolean };
    const r2 = (await (await req("/api/ventas", venta("idem-1", item))).json()) as { venta_id: string; idempotent: boolean };
    expect(r1.idempotent).toBe(false);
    expect(r2.idempotent).toBe(true);
    expect(r2.venta_id).toBe(r1.venta_id);
    expect(await num("c", `SELECT COUNT(*) c FROM venta WHERE client_uuid='idem-1'`)).toBe(1);
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE id=?1`, invG)).toBe(98); // 100-2, UNA vez
  });

  it("carrera de client_uuid (concurrente): 2 requests iguales → exactamente 1 venta", async () => {
    const item = [{ producto_id: PG, cantidad: 3, precio_sin_igv_unitario_dm: 127119 }];
    const [a, b] = await Promise.all([
      req("/api/ventas", venta("race-cu", item)),
      req("/api/ventas", venta("race-cu", item)),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await num("c", `SELECT COUNT(*) c FROM venta WHERE client_uuid='race-cu'`)).toBe(1);
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE id=?1`, invG)).toBe(97); // descuento UNA vez
    expect(await num("c", `SELECT COUNT(*) c FROM movimiento_stock WHERE referencia_id IN (SELECT id FROM venta WHERE client_uuid='race-cu')`)).toBe(1);
  });

  it("carrera de lote (CHECK-rollback-retry): 3 ventas concurrentes de 5u → sin negativos, todas registradas", async () => {
    const mk = (n: number) => req("/api/ventas", venta(`race-lote-${n}`, [{ producto_id: PC, cantidad: 5, precio_sin_igv_unitario_dm: 15254 }]));
    const rs = await Promise.all([mk(1), mk(2), mk(3)]);
    for (const r of rs) expect(r.status).toBe(200);
    // Invariante duro: ningún lote quedó negativo (CHECK) y el total salió de A(5)+B(10).
    expect(await num("unidades", `SELECT unidades FROM lote WHERE id=?1`, loteCa)).toBe(0);
    expect(await num("unidades", `SELECT unidades FROM lote WHERE id=?1`, loteCb)).toBe(90); // 100 - 10
    expect(await num("m", `SELECT MIN(unidades) m FROM lote WHERE inventario_id=?1`, invC)).toBeGreaterThanOrEqual(0);
    expect(await num("s", `SELECT SUM(vil.unidades) s FROM venta_item_lote vil JOIN venta_item vi ON vi.id=vil.venta_item_id JOIN venta v ON v.id=vi.venta_id WHERE v.sucursal_id=?1 AND v.client_uuid LIKE 'race-lote-%'`, sV)).toBe(15);
    expect(await num("c", `SELECT COUNT(*) c FROM venta WHERE client_uuid LIKE 'race-lote-%'`)).toBe(3);
  });

  it("doble anulación (§7.6): 2.ª → 409, repone lote/stock UNA sola vez", async () => {
    const r = await req("/api/ventas", venta("anu-1", [{ producto_id: PG, cantidad: 4, precio_sin_igv_unitario_dm: 127119 }]));
    const { venta_id } = (await r.json()) as { venta_id: string };
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE id=?1`, invG)).toBe(96);
    expect(await num("unidades", `SELECT unidades FROM lote WHERE id=?1`, loteG)).toBe(96);

    const a1 = await req(`/api/ventas/${venta_id}/anular`, post(tok.admin, { motivo: "prueba" }));
    expect(a1.status).toBe(200);
    const a2 = await req(`/api/ventas/${venta_id}/anular`, post(tok.admin, { motivo: "otra vez" }));
    expect(a2.status).toBe(409);

    // Repuesto UNA sola vez (no doble).
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE id=?1`, invG)).toBe(100);
    expect(await num("unidades", `SELECT unidades FROM lote WHERE id=?1`, loteG)).toBe(100);
    expect(await num("c", `SELECT COUNT(*) c FROM movimiento_stock WHERE tipo='anulacion' AND referencia_id=?1`, venta_id)).toBe(1);
    expect(await num("e", `SELECT estado='anulada' e FROM venta WHERE id=?1`, venta_id)).toBe(1);
  });

  it("FTS5 sin tildes: 'ibuprofeno' encuentra 'Ibuprofeno' (remove_diacritics)", async () => {
    // Reindexa PB en FTS (el seed sintético no llena producto_fts).
    await env.DB.prepare(`INSERT INTO producto_fts (producto_id, texto) VALUES (?1,'Ibuprofeno 400 mg Ibuprofeno')`).bind(PB).run();
    const r = await req(`/api/catalogo/productos?q=${encodeURIComponent("ibúprofeno")}`, bearer(tok.oper));
    const j = (await r.json()) as { productos: { id: string }[] };
    expect(j.productos.some((p) => p.id === PB)).toBe(true);
  });
});
