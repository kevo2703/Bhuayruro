import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// E10-E11 — Quiebres, dashboards, consolidado (CSV), CRUD usuarios/sucursales, mínimos,
// presentaciones (Δ1). HTTP real contra el Worker; fixture sintético.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";
const T = "t-h", sV = "s-ves", sC = "s-chz", uOper = "u-oper", uAdmin = "u-admin", uSuper = "u-super";
const P = "p-1", pres1 = "pres-1", inv1 = "inv-1", lote1 = "lote-1";
const tok = { oper: "tok-oper", admin: "tok-admin", super: "tok-super" };

const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown): RequestInit => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (t: string, body: unknown): RequestInit => ({ method: "PATCH", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const req = (path: string, init?: RequestInit) => app.request(path, init, env);
const num = (v: string, sql: string, ...bind: unknown[]) =>
  env.DB.prepare(sql).bind(...bind).first<Record<string, number>>().then((r) => r?.[v] ?? null);

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of [
    "audit_log", "evento_caja", "movimiento_stock", "venta_item_lote", "venta_item", "venta",
    "quiebre", "cierre_caja", "recepcion", "lote", "inventario_local", "precio_local", "presentacion",
    "producto_catalogo", "sesion", "usuario_perfil", "sucursal", "tenant",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  const hOper = await hashToken(tok.oper), hAdmin = await hashToken(tok.admin), hSuper = await hashToken(tok.super);
  const PW = "pbkdf2$310000$c2FsdA==$aGFzaA==";
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T','H',?2,?2)`).bind(T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'VES',?3,?3)`).bind(sV, T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Chazuta',?3,?3)`).bind(sC, T, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'operador','O','o@h.local',?4,?5,?5)`).bind(uOper, T, sV, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'admin_sucursal','A','a@h.local',?4,?5,?5)`).bind(uAdmin, T, sV, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,NULL,'super_admin','S','s@h.local',?3,?4,?4)`).bind(uSuper, T, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('so',?1,?2,?3,?4)`).bind(uOper, hOper, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('sa',?1,?2,?3,?4)`).bind(uAdmin, hAdmin, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('ss',?1,?2,?3,?4)`).bind(uSuper, hSuper, TS, FUTURO),
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ibuprofeno 400 mg',?3,?3)`).bind(P, T, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(pres1, P, TS),
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_compra_dm,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('px1',?1,?2,?3,10000,15254,2746,18000,?4,?4)`).bind(P, sV, pres1, TS),
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,100,10,?4)`).bind(inv1, sV, P, TS),
    db.prepare(`INSERT INTO lote (id,inventario_id,numero_lote,fecha_vencimiento,unidades,fecha_recepcion,created_at,updated_at) VALUES (?1,?2,'L1','2026-09-01',100,?3,?3,?3)`).bind(lote1, inv1, TS),
  ]);
}

beforeEach(async () => {
  await sembrar();
});

describe("E10-E11 — quiebres, dashboards, consolidado, CRUD", () => {
  it("quiebre idempotente por client_uuid y aparece en faltantes de la botica (aunque el stock esté OK)", async () => {
    const q = { client_uuid: "q-1", producto_id: P, descripcion_libre: null };
    const r1 = await req("/api/quiebres", post(tok.oper, q));
    expect(r1.status).toBe(201);
    const r2 = await req("/api/quiebres", post(tok.oper, q));
    expect(r2.status).toBe(200); // idempotente
    expect(await num("c", `SELECT COUNT(*) c FROM quiebre WHERE producto_id=?1`, P)).toBe(1);

    // P tiene stock 100 > mínimo 10, pero el quiebre lo mete en faltantes.
    const f = (await (await req("/api/faltantes", bearer(tok.admin))).json()) as { faltantes: { producto_id: string; quiebres_14d: number }[] };
    const fila = f.faltantes.find((x) => x.producto_id === P);
    expect(fila?.quiebres_14d).toBe(1);
  });

  it("dashboard/resumen: cuenta la venta del día y estima margen con precio_compra", async () => {
    await req("/api/ventas", post(tok.oper, { client_uuid: "v-1", metodo_pago: "efectivo", items: [{ producto_id: P, cantidad: 2, precio_sin_igv_unitario_dm: 15254 }] }));
    const d = (await (await req("/api/dashboard/resumen?rango=hoy", bearer(tok.admin))).json()) as { num_ventas: number; ventas_cent: number; margen_estimado_cent: number; margen_parcial: boolean };
    expect(d.num_ventas).toBe(1);
    expect(d.ventas_cent).toBeGreaterThan(0);
    // margen = subtotal(2×15254=30508 dm → 305 cent) − costo(2×10000dm/100=200 cent) = 105 cent.
    expect(d.margen_estimado_cent).toBe(105);
    expect(d.margen_parcial).toBe(false);
  });

  it("consolidado super: JSON con sugerido + CSV con cabecera y fila TOTAL", async () => {
    await req("/api/quiebres", post(tok.oper, { client_uuid: "q-c", producto_id: P }));
    // Bajar el stock de P por debajo del mínimo para que sea faltante duro también.
    await env.DB.prepare(`UPDATE inventario_local SET stock_unidades=3 WHERE id=?1`).bind(inv1).run();

    const j = (await (await req("/api/consolidado/faltantes", bearer(tok.super))).json()) as { items: { producto: { id: string }; sugerido_total: number }[] };
    const it = j.items.find((x) => x.producto.id === P);
    expect(it).toBeTruthy();
    expect(it!.sugerido_total).toBe(17); // max(0, 10*2 − 3)

    const csvRes = await req("/api/consolidado/faltantes.csv", bearer(tok.super));
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    const csv = await csvRes.text();
    expect(csv.split("\r\n")[0]).toBe("producto,sucursal,stock,minimo,quiebres_14d,sugerido");
    expect(csv).toContain('"TOTAL"');
  });

  it("consolidado es SOLO para super (admin → 403)", async () => {
    expect((await req("/api/consolidado/faltantes", bearer(tok.admin))).status).toBe(403);
    expect((await req("/api/consolidado/faltantes.csv", bearer(tok.admin))).status).toBe(403);
    expect((await req("/api/consolidado/resumen", bearer(tok.admin))).status).toBe(403);
  });

  it("PATCH usuario: admin desactiva a su operador; no puede tocar al super (404)", async () => {
    const r = await req(`/api/usuarios/${uOper}`, patch(tok.admin, { activo: false }));
    expect(r.status).toBe(200);
    expect(await num("activo", `SELECT activo FROM usuario_perfil WHERE id=?1`, uOper)).toBe(0);
    // El super no es de su sucursal → 404 (aislamiento §4.4).
    expect((await req(`/api/usuarios/${uSuper}`, patch(tok.admin, { activo: false }))).status).toBe(404);
  });

  it("PATCH inventario mínimo y POST presentación (Δ1)", async () => {
    const rm = await req(`/api/inventario/${P}/minimo`, patch(tok.admin, { stock_minimo: 25 }));
    expect(rm.status).toBe(200);
    expect(await num("stock_minimo", `SELECT stock_minimo FROM inventario_local WHERE id=?1`, inv1)).toBe(25);

    const rp = await req(`/api/catalogo/productos/${P}/presentaciones`, post(tok.admin, { nombre: "blíster x10", factor_unidades: 10 }));
    expect(rp.status).toBe(201);
    const pres = (await (await req(`/api/catalogo/productos/${P}/presentaciones`, bearer(tok.admin))).json()) as { presentaciones: unknown[] };
    expect(pres.presentaciones.length).toBe(2);
  });

  it("sucursales: super crea y desactiva; devuelve id", async () => {
    const rc = await req("/api/sucursales", post(tok.super, { nombre: "Nueva Botica", direccion: "Av. Test 123" }));
    expect(rc.status).toBe(201);
    const { id } = (await rc.json()) as { id: string };
    expect(id).toBeTruthy();
    const rp = await req(`/api/sucursales/${id}`, patch(tok.super, { activa: false }));
    expect(rp.status).toBe(200);
    expect(await num("activa", `SELECT activa FROM sucursal WHERE id=?1`, id)).toBe(0);
  });
});
