import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// GATE E7.2 (lado D1) — el complemento de apps/pwa/src/lib/cola.test.ts: al volver online, la
// cola reenvía cada op; el server debe materializar EXACTAMENTE 3 ventas únicas aunque cada una
// llegue 2 veces (idempotencia por client_uuid, §7.3). Prueba la garantía a nivel base de datos.

const TS = "2026-07-04T00:00:00.000Z", FUTURO = "2999-01-01T00:00:00.000Z";
const T = "t", sV = "s", uOper = "u", P = "p", pres = "pr", inv = "i", lote = "l";
const TOK = "tok-oper";
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const req = (path: string, init?: RequestInit) => app.request(path, init, env);
const num = (v: string, sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).first<Record<string, number>>().then((r) => r?.[v] ?? null);

beforeEach(async () => {
  const db = env.DB;
  for (const t of ["movimiento_stock", "venta_item_lote", "venta_item", "venta", "lote", "inventario_local", "precio_local", "presentacion", "producto_catalogo", "sesion", "usuario_perfil", "sucursal", "tenant"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  const h = await hashToken(TOK);
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T','H',?2,?2)`).bind(T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'VES',?3,?3)`).bind(sV, T, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'operador','O','o@h',?4,?5,?5)`).bind(uOper, T, sV, "pbkdf2$310000$c2FsdA==$aGFzaA==", TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('so',?1,?2,?3,?4)`).bind(uOper, h, TS, FUTURO),
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ibuprofeno',?3,?3)`).bind(P, T, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(pres, P, TS),
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('px',?1,?2,?3,15254,2746,18000,?4,?4)`).bind(P, sV, pres, TS),
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,100,10,?4)`).bind(inv, sV, P, TS),
    db.prepare(`INSERT INTO lote (id,inventario_id,numero_lote,fecha_vencimiento,unidades,fecha_recepcion,created_at,updated_at) VALUES (?1,?2,'L','2026-09-01',100,?3,?3,?3)`).bind(lote, inv, TS),
  ]);
});

describe("GATE E7.2 (D1) — cola reenvía, 3 ventas únicas", () => {
  it("3 client_uuids, cada uno enviado 2 veces (blip de red) → 3 ventas, stock descontado 1 vez c/u", async () => {
    const uuids = ["cu-1", "cu-2", "cu-3"];
    const enviar = (cu: string) => req("/api/ventas", post({ client_uuid: cu, metodo_pago: "efectivo", items: [{ producto_id: P, cantidad: 2, precio_sin_igv_unitario_dm: 15254 }] }));

    // 1.er intento (respuesta se "pierde") y reenvío del flusher, por cada op.
    for (const cu of uuids) {
      const r1 = await enviar(cu);
      const r2 = await enviar(cu);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(((await r2.json()) as { idempotent: boolean }).idempotent).toBe(true); // el reenvío no-opea
    }

    expect(await num("c", `SELECT COUNT(*) c FROM venta WHERE sucursal_id=?1`, sV)).toBe(3);
    // 3 ventas × 2 unidades = 6 descontadas UNA sola vez cada una (100 - 6 = 94).
    expect(await num("stock_unidades", `SELECT stock_unidades FROM inventario_local WHERE id=?1`, inv)).toBe(94);
    expect(await num("u", `SELECT unidades u FROM lote WHERE id=?1`, lote)).toBe(94);
    expect(await num("c", `SELECT COUNT(*) c FROM movimiento_stock WHERE tipo='venta'`)).toBe(3);
  });
});
