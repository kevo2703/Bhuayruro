import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// E8 — Recepción idempotente (upsert lote), cierre de caja (server calcula, 409 dup),
// lotes por vencer. HTTP real contra el Worker; fixture sintético.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";
const T = "t-h", sV = "s-ves", uOper = "u-oper", uAdmin = "u-admin";
const P = "p-1", P2 = "p-2", pres1 = "pres-1", pres2 = "pres-2", inv1 = "inv-1", lote1 = "lote-1";
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
    "cierre_caja", "recepcion", "lote", "inventario_local", "precio_local", "presentacion",
    "producto_catalogo", "sesion", "usuario_perfil", "sucursal", "tenant",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  const hOper = await hashToken(tok.oper), hAdmin = await hashToken(tok.admin);
  const PW = "pbkdf2$310000$c2FsdA==$aGFzaA==";
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T','H',?2,?2)`).bind(T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'VES',?3,?3)`).bind(sV, T, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'operador','O','o@h.local',?4,?5,?5)`).bind(uOper, T, sV, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'admin_sucursal','A','a@h.local',?4,?5,?5)`).bind(uAdmin, T, sV, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('so',?1,?2,?3,?4)`).bind(uOper, hOper, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('sa',?1,?2,?3,?4)`).bind(uAdmin, hAdmin, TS, FUTURO),
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ibuprofeno 400 mg',?3,?3)`).bind(P, T, TS),
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Amoxicilina 500 mg',?3,?3)`).bind(P2, T, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(pres1, P, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(pres2, P2, TS),
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('px1',?1,?2,?3,15254,2746,18000,?4,?4)`).bind(P, sV, pres1, TS),
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,100,10,?4)`).bind(inv1, sV, P, TS),
    db.prepare(`INSERT INTO lote (id,inventario_id,numero_lote,fecha_vencimiento,unidades,fecha_recepcion,created_at,updated_at) VALUES (?1,?2,'L1','2026-09-01',100,?3,?3,?3)`).bind(lote1, inv1, TS),
    // P2 SIN inventario ni lote (la recepción debe crearlos).
  ]);
}

beforeEach(async () => {
  await sembrar();
});

describe("E8 — recepción, caja, lotes por vencer", () => {
  it("recepción idempotente: re-envío mismo client_uuid no duplica stock", async () => {
    const body = { client_uuid: "rec-1", proveedor: "Dist X", items: [{ producto_id: P2, numero_lote: "L2", fecha_vencimiento: "2026-11-01", cantidad: 30 }] };
    const r1 = await req("/api/recepciones", post(tok.oper, body));
    expect(r1.status).toBe(201);
    expect(((await r1.json()) as { idempotent: boolean }).idempotent).toBe(false);
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE sucursal_id=?1 AND producto_id=?2`, sV, P2)).toBe(30);

    const r2 = await req("/api/recepciones", post(tok.oper, body));
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { idempotent: boolean }).idempotent).toBe(true);
    // Stock SIGUE en 30 (no 60): idempotencia.
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE sucursal_id=?1 AND producto_id=?2`, sV, P2)).toBe(30);
    expect(await num("c", `SELECT COUNT(*) c FROM lote l JOIN inventario_local i ON i.id=l.inventario_id WHERE i.producto_id=?1`, P2)).toBe(1);
  });

  it("upsert de lote: mismo número+vencimiento SUMA en 2 recepciones distintas", async () => {
    await req("/api/recepciones", post(tok.oper, { client_uuid: "rec-a", items: [{ producto_id: P, numero_lote: "L1", fecha_vencimiento: "2026-09-01", cantidad: 20 }] }));
    await req("/api/recepciones", post(tok.oper, { client_uuid: "rec-b", items: [{ producto_id: P, numero_lote: "L1", fecha_vencimiento: "2026-09-01", cantidad: 15 }] }));
    // El lote L1 existía con 100 → 100+20+15 = 135 (una sola fila).
    expect(await num("unidades", `SELECT unidades FROM lote WHERE id=?1`, lote1)).toBe(135);
    expect(await num("c", `SELECT COUNT(*) c FROM lote WHERE inventario_id=?1 AND numero_lote='L1'`, inv1)).toBe(1);
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE id=?1`, inv1)).toBe(135);
  });

  it("recepción dedupe intra-request: dos ítems del mismo lote suman en una fila", async () => {
    await req("/api/recepciones", post(tok.oper, { client_uuid: "rec-d", items: [
      { producto_id: P2, numero_lote: "L7", fecha_vencimiento: "2026-12-01", cantidad: 10 },
      { producto_id: P2, numero_lote: "L7", fecha_vencimiento: "2026-12-01", cantidad: 5 },
    ] }));
    expect(await num("c", `SELECT COUNT(*) c FROM lote l JOIN inventario_local i ON i.id=l.inventario_id WHERE i.producto_id=?1 AND l.numero_lote='L7'`, P2)).toBe(1);
    expect(await num("unidades", `SELECT l.unidades FROM lote l JOIN inventario_local i ON i.id=l.inventario_id WHERE i.producto_id=?1 AND l.numero_lote='L7'`, P2)).toBe(15);
  });

  it("cierre de caja: server calcula total_sistema y diferencia; 2.º cierre del día → 409", async () => {
    const vender = (cu: string) => req("/api/ventas", post(tok.oper, { client_uuid: cu, metodo_pago: "efectivo", items: [{ producto_id: P, cantidad: 1, precio_sin_igv_unitario_dm: 15254 }] }));
    await vender("cj-1");
    await vender("cj-2"); // 2 ventas × total 180 = 360 cent

    const dia = (await (await req("/api/caja/dia", bearer(tok.admin))).json()) as { total_sistema_cent: number; num_ventas: number };
    expect(dia.total_sistema_cent).toBe(360);
    expect(dia.num_ventas).toBe(2);

    const cierre = await req("/api/caja/cierres", post(tok.admin, { total_efectivo_cent: 400, total_yape_cent: 0, total_otros_cent: 0 }));
    expect(cierre.status).toBe(201);
    const jc = (await cierre.json()) as { total_sistema_cent: number; diferencia_cent: number };
    expect(jc.total_sistema_cent).toBe(360);
    expect(jc.diferencia_cent).toBe(40); // 400 contado − 360 sistema

    const dup = await req("/api/caja/cierres", post(tok.admin, { total_efectivo_cent: 360, total_yape_cent: 0, total_otros_cent: 0 }));
    expect(dup.status).toBe(409);
  });

  it("lotes por vencer: filtra por vence_antes y solo con stock", async () => {
    const r = await req(`/api/inventario/lotes?vence_antes=2026-10-01`, bearer(tok.admin));
    const j = (await r.json()) as { lotes: { id: string; fecha_vencimiento: string }[] };
    expect(j.lotes.some((l) => l.id === lote1)).toBe(true); // L1 vence 2026-09-01 ≤ 2026-10-01
    // Un lote posterior no aparece.
    const r2 = await req(`/api/inventario/lotes?vence_antes=2026-08-01`, bearer(tok.admin));
    const j2 = (await r2.json()) as { lotes: unknown[] };
    expect(j2.lotes.length).toBe(0);
  });
});
