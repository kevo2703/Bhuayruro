import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// GATE 3 (BLOQUEANTE) — 14 tests de aislamiento (plan §4.4).
// Fixture SINTÉTICO propio (no depende del seed). HTTP real contra el Worker.
// PROHIBIDO cargar datos reales antes de que esto esté 14/14 verde.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";

const T = "t-huayruro";
const sV = "suc-ves";
const sC = "suc-chz-puerto";
const sL = "suc-chz-plaza";

const uSuper = "u-super";
const uAdminVes = "u-admin-ves";
const uAdminChz = "u-admin-chz";
const uOperVes = "u-oper-ves";
const uLectorVes = "u-lector-ves";
const dev = "dev-ves";

const P1 = "prod-1";
const presP1 = "pres-1";
const precioVes = "precio-ves";
const precioChz = "precio-chz";
const invVes = "inv-ves";
const invChz = "inv-chz";
const ventaVes = "venta-ves";
const ventaChz = "venta-chz";

// Tokens en claro (el server guarda solo su SHA-256).
const tok = {
  super: "tok-super",
  adminVes: "tok-admin-ves",
  adminChz: "tok-admin-chz",
  oper: "tok-oper-ves",
  lector: "tok-lector-ves",
  device: "tok-device-ves",
};

function bearer(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}
function post(token: string, body: unknown): RequestInit {
  return { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
function patch(token: string, body: unknown): RequestInit {
  return { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

async function sembrar(): Promise<void> {
  const db = env.DB;
  // Limpieza (por si el aislamiento de storage no aplica entre tests).
  for (const t of [
    "sesion", "dispositivo", "venta", "inventario_local", "precio_local",
    "presentacion", "producto_catalogo", "usuario_perfil", "sucursal", "tenant",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }

  const hSuper = await hashToken(tok.super);
  const hAdminVes = await hashToken(tok.adminVes);
  const hAdminChz = await hashToken(tok.adminChz);
  const hOper = await hashToken(tok.oper);
  const hLector = await hashToken(tok.lector);
  const hDevice = await hashToken(tok.device);
  const PW = "pbkdf2$310000$c2FsdA==$aGFzaA=="; // placeholder (no se usa: los tests van por token)

  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T','Botica Huayruro',?2,?2)`).bind(T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Huayruro VES',?3,?3)`).bind(sV, T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Huayruro Chazuta Puerto',?3,?3)`).bind(sC, T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Huayruro Chazuta Plaza',?3,?3)`).bind(sL, T, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,NULL,'super_admin','Super','super@h.local',?3,?4,?4)`).bind(uSuper, T, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'admin_sucursal','AdminVes','av@h.local',?4,?5,?5)`).bind(uAdminVes, T, sV, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'admin_sucursal','AdminChz','ac@h.local',?4,?5,?5)`).bind(uAdminChz, T, sC, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'operador','OperVes','ov@h.local',?4,?5,?5)`).bind(uOperVes, T, sV, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'lector_reportes','LectorVes','lv@h.local',?4,?5,?5)`).bind(uLectorVes, T, sV, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s1',?1,?2,?3,?4)`).bind(uSuper, hSuper, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s2',?1,?2,?3,?4)`).bind(uAdminVes, hAdminVes, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s3',?1,?2,?3,?4)`).bind(uAdminChz, hAdminChz, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s4',?1,?2,?3,?4)`).bind(uOperVes, hOper, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s5',?1,?2,?3,?4)`).bind(uLectorVes, hLector, TS, FUTURO),
    db.prepare(`INSERT INTO dispositivo (id,sucursal_id,tipo,nombre,token_hash,created_at) VALUES (?1,?2,'a10_grabador','A10',?3,?4)`).bind(dev, sV, hDevice, TS),
    db.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ibuprofeno 400 mg',?3,?3)`).bind(P1, T, TS),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(presP1, P1, TS),
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES (?1,?2,?3,?4,15254,2746,18000,?5,?5)`).bind(precioVes, P1, sV, presP1, TS),
    db.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES (?1,?2,?3,?4,15254,2746,18000,?5,?5)`).bind(precioChz, P1, sC, presP1, TS),
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,50,10,?4)`).bind(invVes, sV, P1, TS),
    db.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,50,10,?4)`).bind(invChz, sC, P1, TS),
    db.prepare(`INSERT INTO venta (id,client_uuid,sucursal_id,fecha_hora,subtotal_sin_igv_cent,igv_total_cent,total_cent,metodo_pago,created_at,updated_at) VALUES (?1,'cu-ves',?2,?3,153,27,180,'efectivo',?3,?3)`).bind(ventaVes, sV, TS),
    db.prepare(`INSERT INTO venta (id,client_uuid,sucursal_id,fecha_hora,subtotal_sin_igv_cent,igv_total_cent,total_cent,metodo_pago,created_at,updated_at) VALUES (?1,'cu-chz',?2,?3,153,27,180,'efectivo',?3,?3)`).bind(ventaChz, sC, TS),
  ]);
}

beforeEach(async () => {
  await sembrar();
});

describe("GATE 3 — aislamiento (plan §4.4)", () => {
  it("1) super_admin lista las 3 sucursales", async () => {
    const r = await req("/api/sucursales", bearer(tok.super));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { sucursales: unknown[] };
    expect(j.sucursales.length).toBe(3);
  });

  it("2) admin_ves ve exactamente 1 sucursal (VES)", async () => {
    const r = await req("/api/sucursales", bearer(tok.adminVes));
    const j = (await r.json()) as { sucursales: { nombre: string }[] };
    expect(j.sucursales.length).toBe(1);
    expect(j.sucursales[0]!.nombre).toBe("Huayruro VES");
  });

  it("3) admin_chz ve exactamente 1 (Chazuta Puerto)", async () => {
    const r = await req("/api/sucursales", bearer(tok.adminChz));
    const j = (await r.json()) as { sucursales: { nombre: string }[] };
    expect(j.sucursales.length).toBe(1);
    expect(j.sucursales[0]!.nombre).toBe("Huayruro Chazuta Puerto");
  });

  it("4) catálogo idéntico para admin_ves y admin_chz (compartido a nivel tenant)", async () => {
    const a = (await (await req("/api/catalogo/productos", bearer(tok.adminVes))).json()) as { productos: unknown[] };
    const b = (await (await req("/api/catalogo/productos", bearer(tok.adminChz))).json()) as { productos: unknown[] };
    expect(a.productos.length).toBe(b.productos.length);
    expect(a.productos.length).toBeGreaterThan(0);
  });

  it("5) admin_ves pidiendo precios de Chazuta → 404", async () => {
    const r = await req(`/api/precios?sucursal_id=${sC}&producto_id=${P1}`, bearer(tok.adminVes));
    expect(r.status).toBe(404);
  });

  it("6) admin_ves POST /ventas con sucursal_id de Chazuta en el body → registra en VES", async () => {
    const r = await req(
      "/api/ventas",
      post(tok.adminVes, {
        client_uuid: "cu-nueva-1",
        metodo_pago: "efectivo",
        sucursal_id: sC, // debe ser IGNORADO
        items: [{ producto_id: P1, cantidad: 1, precio_sin_igv_unitario_dm: 15254 }],
      }),
    );
    expect(r.status).toBe(200);
    const j = (await r.json()) as { sucursal_id: string };
    expect(j.sucursal_id).toBe(sV);
    const fila = await env.DB.prepare(`SELECT sucursal_id FROM venta WHERE client_uuid='cu-nueva-1'`).first<{ sucursal_id: string }>();
    expect(fila?.sucursal_id).toBe(sV);
  });

  it("7) admin_ves GET /ventas/:id de una venta de Chazuta → 404", async () => {
    const r = await req(`/api/ventas/${ventaChz}`, bearer(tok.adminVes));
    expect(r.status).toBe(404);
  });

  it("8) anular venta ajena → 404; operador anulando → 403", async () => {
    const ajena = await req(`/api/ventas/${ventaChz}/anular`, post(tok.adminVes, { motivo: "x" }));
    expect(ajena.status).toBe(404);
    const operador = await req(`/api/ventas/${ventaVes}/anular`, post(tok.oper, { motivo: "x" }));
    expect(operador.status).toBe(403);
  });

  it("9) admin_ves ajustando inventario/precio de Chazuta (IDs directos) → 404", async () => {
    const inv = await req("/api/inventario/ajustes", post(tok.adminVes, { inventario_id: invChz, cantidad: 5 }));
    expect(inv.status).toBe(404);
    const precio = await req(`/api/precios/${precioChz}`, patch(tok.adminVes, { precio_sin_igv_dm: 99999 }));
    expect(precio.status).toBe(404);
  });

  it("10) lector_reportes intentando escribir → 403", async () => {
    const venta = await req(
      "/api/ventas",
      post(tok.lector, { client_uuid: "cu-l", metodo_pago: "efectivo", items: [{ producto_id: P1, cantidad: 1, precio_sin_igv_unitario_dm: 15254 }] }),
    );
    expect(venta.status).toBe(403);
    const ajuste = await req("/api/inventario/ajustes", post(tok.lector, { inventario_id: invVes, cantidad: 5 }));
    expect(ajuste.status).toBe(403);
  });

  it("11) operador creando usuarios o leyendo audit_log → 403", async () => {
    const usuario = await req("/api/usuarios", post(tok.oper, { nombre: "X", email: "x@h.local", password: "12345678" }));
    expect(usuario.status).toBe(403);
    const audit = await req("/api/audit", bearer(tok.oper));
    expect(audit.status).toBe(403);
  });

  it("12) consolidado de faltantes con admin_sucursal → 403 (solo super)", async () => {
    const r = await req("/api/consolidado/faltantes", bearer(tok.adminVes));
    expect(r.status).toBe(403);
  });

  it("13) token de dispositivo intentando leer ventas → 403", async () => {
    const r = await req(`/api/ventas/${ventaVes}`, bearer(tok.device));
    expect(r.status).toBe(403);
  });
});
