import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// P4a — GATE de venta cruzada (A4). Δ5 ya existía en 0001; acá se prueba el código nuevo.
//
// Lo que defienden estos tests, en orden de gravedad:
//   1. Las REGLAS son de tenant: una cadena no ve ni toca las de otra, y no puede colgar una regla
//      del producto de otra (si pudiera, el nombre de ese producto saldría impreso en la tarjeta
//      del mostrador ajeno — la fuga menos obvia del frente).
//   2. Los EVENTOS son de sucursal: la conversión de VES no se mezcla con la de Chazuta.
//   3. La plata de la tabla sale de `venta_item` REAL, no del precio de lista: una venta anulada o
//      una sugerencia aceptada que después se quitó del carrito no pueden reportar soles.
//   4. La cola offline reintenta: reenviar la misma op no puede inflar la conversión.
//
// Fixture SINTÉTICO propio con DOS tenants, HTTP real contra el Worker.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";

const T = "t-huayruro";
const T2 = "t-otra-cadena";
const sV = "suc-ves";
const sC = "suc-chz";
const sO = "suc-otra";

const IBU = "prod-ibuprofeno";
const OME = "prod-omeprazol";
const AJENO = "prod-ajeno";
const presOme = "pres-ome";

const tok = {
  super: "tok-super",
  adminVes: "tok-admin-ves",
  adminChz: "tok-admin-chz",
  operVes: "tok-oper-ves",
  operChz: "tok-oper-chz",
  lector: "tok-lector",
  adminOtro: "tok-admin-otro",
};

const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const cuerpo = (m: string, t: string, b: unknown): RequestInit => ({
  method: m,
  headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
  body: JSON.stringify(b),
});
const post = (t: string, b: unknown) => cuerpo("POST", t, b);
const patch = (t: string, b: unknown) => cuerpo("PATCH", t, b);
const del = (t: string): RequestInit => ({ method: "DELETE", headers: { Authorization: `Bearer ${t}` } });
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

const REGLA_OK = {
  disparador_tipo: "principio_activo",
  disparador_valor: "Ibuprofeno",
  sugerido_producto_id: OME,
  guion: "Si lo va a tomar más de dos días, un protector le cuida el estómago.",
  prioridad: 10,
};

type ReglaResp = { regla: { id: string; activa: number; guion: string; prioridad: number; es_demo: number; sugerido_nombre: string } };
type ConversionResp = {
  reglas: { id: string; mostradas: number; aceptadas: number; rechazadas: number; soles_cent: number; activa: number }[];
};

async function crearRegla(token = tok.adminVes, body: Record<string, unknown> = REGLA_OK): Promise<string> {
  const r = await req("/api/sugerencias/reglas", post(token, body));
  expect(r.status).toBe(201);
  return ((await r.json()) as ReglaResp).regla.id;
}

/** Venta real con una línea del producto dado (es de donde salen los "soles agregados"). */
async function venta(id: string, clientUuid: string, sucursal: string, productoId: string, totalCent: number, estado = "completada") {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO venta (id,client_uuid,sucursal_id,fecha_hora,subtotal_sin_igv_cent,igv_total_cent,total_cent,metodo_pago,estado,created_at,updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,'efectivo',?8,?4,?4)`,
    ).bind(id, clientUuid, sucursal, TS, Math.round((totalCent * 100) / 118), totalCent - Math.round((totalCent * 100) / 118), totalCent, estado),
    env.DB.prepare(
      `INSERT INTO venta_item (id,venta_id,producto_id,presentacion_id,cantidad_presentacion,cantidad,precio_sin_igv_unitario_dm,igv_unitario_dm,precio_total_unitario_dm,subtotal_sin_igv_cent,igv_subtotal_cent,total_cent,created_at)
       VALUES (?1,?2,?3,?4,1,1,10169,1831,12000,102,18,?5,?6)`,
    ).bind(`vi-${id}`, id, productoId, presOme, totalCent, TS),
  ]);
}

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of [
    "sugerencia_evento", "regla_sugerencia", "venta_item", "venta", "sesion",
    "inventario_local", "precio_local", "presentacion", "producto_catalogo",
    "usuario_perfil", "sucursal", "tenant",
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
    adminOtro: await hashToken(tok.adminOtro),
  };
  const PW = "pbkdf2$310000$c2FsdA==$aGFzaA==";
  const usuario = (id: string, tenant: string, suc: string | null, rol: string, email: string) =>
    db
      .prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)`)
      .bind(id, tenant, suc, rol, email, email, PW, TS);
  const sesion = (id: string, usuarioId: string, hash: string) =>
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES (?1,?2,?3,?4,?5)`).bind(id, usuarioId, hash, TS, FUTURO);
  const producto = (id: string, tenant: string, nombre: string, pa: string, cat: string) =>
    db
      .prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,principio_activo,categoria,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)`)
      .bind(id, tenant, nombre, pa, cat, TS);

  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T','Botica Huayruro',?2,?2)`).bind(T, TS),
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T2','Otra Cadena',?2,?2)`).bind(T2, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Huayruro VES',?3,?3)`).bind(sV, T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Huayruro Chazuta',?3,?3)`).bind(sC, T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Otra Botica',?3,?3)`).bind(sO, T2, TS),
    usuario("u-super", T, null, "super_admin", "super@h.local"),
    usuario("u-admin-ves", T, sV, "admin_sucursal", "av@h.local"),
    usuario("u-admin-chz", T, sC, "admin_sucursal", "ac@h.local"),
    usuario("u-oper-ves", T, sV, "operador", "ov@h.local"),
    usuario("u-oper-chz", T, sC, "operador", "oc@h.local"),
    usuario("u-lector", T, sV, "lector_reportes", "lr@h.local"),
    usuario("u-admin-otro", T2, sO, "admin_sucursal", "ao@h.local"),
    sesion("s1", "u-super", h.super),
    sesion("s2", "u-admin-ves", h.adminVes),
    sesion("s3", "u-admin-chz", h.adminChz),
    sesion("s4", "u-oper-ves", h.operVes),
    sesion("s5", "u-oper-chz", h.operChz),
    sesion("s6", "u-lector", h.lector),
    sesion("s7", "u-admin-otro", h.adminOtro),
    producto(IBU, T, "Ibuprofeno 400 mg", "Ibuprofeno 400 mg", "Antiinflamatorio"),
    producto(OME, T, "Omeprazol 20 mg", "Omeprazol 20 mg", "Antiulceroso"),
    producto(AJENO, T2, "Producto de la otra cadena", "Loratadina", "Antihistamínico"),
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(presOme, OME, TS),
  ]);
}

beforeEach(async () => {
  await sembrar();
});

describe("P4a — CRUD de reglas", () => {
  it("1) el admin crea una regla y el mostrador la recibe activa", async () => {
    const id = await crearRegla();
    const r = (await (await req("/api/sugerencias/reglas", bearer(tok.operVes))).json()) as { reglas: { id: string; guion: string }[] };
    expect(r.reglas.map((x) => x.id)).toEqual([id]);
    expect(r.reglas[0]?.guion).toContain("protector");
  });

  it("2) el operador NO cura reglas (crear/editar/borrar son del admin)", async () => {
    expect((await req("/api/sugerencias/reglas", post(tok.operVes, REGLA_OK))).status).toBe(403);
    const id = await crearRegla();
    expect((await req(`/api/sugerencias/reglas/${id}`, patch(tok.operVes, { activa: false }))).status).toBe(403);
    expect((await req(`/api/sugerencias/reglas/${id}`, del(tok.operVes))).status).toBe(403);
  });

  it("3) apagar una regla la saca del mostrador SIN perder su historial", async () => {
    const id = await crearRegla();
    await req("/api/sugerencias/eventos", post(tok.operVes, { eventos: [{ id: "ev-1", regla_id: id, resultado: "mostrada" }] }));

    const off = await req(`/api/sugerencias/reglas/${id}`, patch(tok.adminVes, { activa: false }));
    expect(off.status).toBe(200);
    expect(((await off.json()) as ReglaResp).regla.activa).toBe(0);

    const motor = (await (await req("/api/sugerencias/reglas", bearer(tok.operVes))).json()) as { reglas: unknown[] };
    expect(motor.reglas).toEqual([]);

    // Sigue en el tablero, con su conversión intacta: apagar es podar, no borrar.
    const conv = (await (await req("/api/sugerencias/conversion", bearer(tok.adminVes))).json()) as ConversionResp;
    expect(conv.reglas.find((x) => x.id === id)?.mostradas).toBe(1);
  });

  it("4) borrar la regla se lleva sus eventos y lo dice", async () => {
    const id = await crearRegla();
    await req("/api/sugerencias/eventos", post(tok.operVes, { eventos: [{ id: "ev-1", regla_id: id, resultado: "mostrada" }] }));
    expect((await (await req(`/api/sugerencias/reglas/${id}/eventos`, bearer(tok.adminVes))).json())).toEqual({ eventos: 1 });

    const r = await req(`/api/sugerencias/reglas/${id}`, del(tok.adminVes));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, eventos_borrados: 1 });

    const quedan = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sugerencia_evento`).first<{ n: number }>();
    expect(quedan?.n).toBe(0);
  });

  it("5) la validación del guion y del disparador es la MISMA que la del formulario", async () => {
    const malos = [
      { ...REGLA_OK, guion: "   " },
      { ...REGLA_OK, disparador_tipo: "marca" },
      { ...REGLA_OK, disparador_valor: "" },
      { ...REGLA_OK, guion: "x".repeat(300) },
      { ...REGLA_OK, disparador_tipo: "producto", disparador_valor: OME }, // se sugeriría a sí mismo
    ];
    for (const body of malos) {
      expect((await req("/api/sugerencias/reglas", post(tok.adminVes, body))).status).toBe(400);
    }
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM regla_sugerencia`).first<{ n: number }>())?.n).toBe(0);
  });

  it("6) `lector_reportes` no entra ni al motor ni al tablero (curar y atender no son su trabajo)", async () => {
    expect((await req("/api/sugerencias/reglas", bearer(tok.lector))).status).toBe(403);
    expect((await req("/api/sugerencias/conversion", bearer(tok.lector))).status).toBe(403);
  });
});

describe("P4a — aislamiento: las reglas son del TENANT", () => {
  it("7) la regla de otra cadena no aparece, y editarla o borrarla → 404", async () => {
    const ajena = await crearRegla(tok.adminOtro, { ...REGLA_OK, sugerido_producto_id: AJENO });

    const mias = (await (await req("/api/sugerencias/reglas", bearer(tok.operVes))).json()) as { reglas: unknown[] };
    expect(mias.reglas).toEqual([]);

    expect((await req(`/api/sugerencias/reglas/${ajena}`, patch(tok.adminVes, { guion: "intruso" }))).status).toBe(404);
    expect((await req(`/api/sugerencias/reglas/${ajena}`, del(tok.adminVes))).status).toBe(404);
    expect((await req(`/api/sugerencias/reglas/${ajena}/eventos`, bearer(tok.adminVes))).status).toBe(404);

    const fila = await env.DB.prepare(`SELECT guion FROM regla_sugerencia WHERE id = ?1`).bind(ajena).first<{ guion: string }>();
    expect(fila?.guion).toBe(REGLA_OK.guion);
  });

  it("8) no se puede colgar una regla del producto de otra cadena (su nombre saldría en mi tarjeta)", async () => {
    const r = await req("/api/sugerencias/reglas", post(tok.adminVes, { ...REGLA_OK, sugerido_producto_id: AJENO }));
    expect(r.status).toBe(404);

    // Tampoco por la puerta de atrás del PATCH sobre una regla propia.
    const propia = await crearRegla();
    expect((await req(`/api/sugerencias/reglas/${propia}`, patch(tok.adminVes, { sugerido_producto_id: AJENO }))).status).toBe(404);

    // Ni como DISPARADOR de tipo producto.
    expect((await req("/api/sugerencias/reglas", post(tok.adminVes, { ...REGLA_OK, disparador_tipo: "producto", disparador_valor: AJENO }))).status).toBe(404);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM regla_sugerencia`).first<{ n: number }>())?.n).toBe(1);
  });

  it("9) un evento contra una regla ajena → 404 y NO escribe nada", async () => {
    const ajena = await crearRegla(tok.adminOtro, { ...REGLA_OK, sugerido_producto_id: AJENO });
    const r = await req("/api/sugerencias/eventos", post(tok.operVes, { eventos: [{ id: "ev-x", regla_id: ajena, resultado: "aceptada" }] }));
    expect(r.status).toBe(404);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM sugerencia_evento`).first<{ n: number }>())?.n).toBe(0);
  });
});

describe("P4a — aislamiento: los eventos son de la SUCURSAL", () => {
  it("10) la conversión de VES no cuenta lo que pasó en Chazuta (misma regla de la cadena)", async () => {
    const id = await crearRegla();
    await req("/api/sugerencias/eventos", post(tok.operVes, { eventos: [{ id: "ev-v1", regla_id: id, resultado: "mostrada" }] }));
    await req("/api/sugerencias/eventos", post(tok.operVes, { eventos: [{ id: "ev-v2", regla_id: id, resultado: "aceptada" }] }));
    await req("/api/sugerencias/eventos", post(tok.operChz, { eventos: [{ id: "ev-c1", regla_id: id, resultado: "mostrada" }] }));

    const ves = (await (await req("/api/sugerencias/conversion", bearer(tok.adminVes))).json()) as ConversionResp;
    const chz = (await (await req("/api/sugerencias/conversion", bearer(tok.adminChz))).json()) as ConversionResp;
    expect(ves.reglas[0]).toMatchObject({ mostradas: 1, aceptadas: 1 });
    expect(chz.reglas[0]).toMatchObject({ mostradas: 1, aceptadas: 0 });
  });

  it("11) el super tiene que elegir botica y no puede pedir una que no es suya", async () => {
    await crearRegla();
    expect((await req("/api/sugerencias/conversion", bearer(tok.super))).status).toBe(400);
    expect((await req(`/api/sugerencias/conversion?sucursal_id=${sO}`, bearer(tok.super))).status).toBe(404);
    expect((await req(`/api/sugerencias/conversion?sucursal_id=${sV}`, bearer(tok.super))).status).toBe(200);
  });
});

describe("P4a — eventos: idempotencia y enlace con la venta", () => {
  it("12) reenviar la MISMA op de la cola no infla la conversión", async () => {
    const id = await crearRegla();
    const body = {
      eventos: [
        { id: "ev-1", regla_id: id, resultado: "mostrada" },
        { id: "ev-2", regla_id: id, resultado: "aceptada" },
      ],
    };
    expect((await req("/api/sugerencias/eventos", post(tok.operVes, body))).status).toBe(201);
    expect((await req("/api/sugerencias/eventos", post(tok.operVes, body))).status).toBe(201); // reintento tras corte

    const conv = (await (await req("/api/sugerencias/conversion", bearer(tok.adminVes))).json()) as ConversionResp;
    expect(conv.reglas[0]).toMatchObject({ mostradas: 1, aceptadas: 1 });
  });

  it("13) el evento se engancha a la venta por su client_uuid (la cola es FIFO: la venta va primero)", async () => {
    const id = await crearRegla();
    await venta("venta-1", "cu-1", sV, OME, 1200);

    const r = await req(
      "/api/sugerencias/eventos",
      post(tok.operVes, { venta_client_uuid: "cu-1", eventos: [{ id: "ev-1", regla_id: id, resultado: "aceptada" }] }),
    );
    expect(await r.json()).toMatchObject({ registrados: 1, ignorados: 0, venta_id: "venta-1" });
  });

  it("14) una venta de OTRA botica no se puede enganchar (el client_uuid no basta)", async () => {
    const id = await crearRegla();
    await venta("venta-chz", "cu-chz", sC, OME, 1200);
    const r = await req(
      "/api/sugerencias/eventos",
      post(tok.operVes, { venta_client_uuid: "cu-chz", eventos: [{ id: "ev-1", regla_id: id, resultado: "aceptada" }] }),
    );
    expect(await r.json()).toMatchObject({ venta_id: null });
  });

  it("15) sin venta (la persona se fue) el evento se guarda igual: si no, la conversión saldría inflada", async () => {
    const id = await crearRegla();
    const r = await req("/api/sugerencias/eventos", post(tok.operVes, { eventos: [{ id: "ev-1", regla_id: id, resultado: "rechazada" }] }));
    expect(r.status).toBe(201);
    const conv = (await (await req("/api/sugerencias/conversion", bearer(tok.adminVes))).json()) as ConversionResp;
    expect(conv.reglas[0]).toMatchObject({ rechazadas: 1, soles_cent: 0 });
  });

  it("16) un cuerpo sin eventos, o con un resultado inventado, es 400", async () => {
    const id = await crearRegla();
    expect((await req("/api/sugerencias/eventos", post(tok.operVes, {}))).status).toBe(400);
    expect((await req("/api/sugerencias/eventos", post(tok.operVes, { eventos: [] }))).status).toBe(400);
    expect((await req("/api/sugerencias/eventos", post(tok.operVes, { eventos: [{ id: "e", regla_id: id, resultado: "comprada" }] }))).status).toBe(400);
  });
});

describe("P4a — los soles agregados salen de la VENTA, no del precio de lista", () => {
  it("17) sugerencia aceptada y cobrada → la tabla muestra el dinero real de esa línea", async () => {
    const id = await crearRegla();
    await venta("venta-1", "cu-1", sV, OME, 1200);
    await req(
      "/api/sugerencias/eventos",
      post(tok.operVes, {
        venta_client_uuid: "cu-1",
        eventos: [
          { id: "ev-1", regla_id: id, resultado: "mostrada" },
          { id: "ev-2", regla_id: id, resultado: "aceptada" },
        ],
      }),
    );

    const conv = (await (await req("/api/sugerencias/conversion", bearer(tok.adminVes))).json()) as ConversionResp;
    expect(conv.reglas[0]).toMatchObject({ mostradas: 1, aceptadas: 1, soles_cent: 1200 });
  });

  it("18) si la venta se anuló, esos soles no existen (aunque la sugerencia se haya aceptado)", async () => {
    const id = await crearRegla();
    await venta("venta-anulada", "cu-a", sV, OME, 1200, "anulada");
    await req(
      "/api/sugerencias/eventos",
      post(tok.operVes, { venta_client_uuid: "cu-a", eventos: [{ id: "ev-1", regla_id: id, resultado: "aceptada" }] }),
    );

    const conv = (await (await req("/api/sugerencias/conversion", bearer(tok.adminVes))).json()) as ConversionResp;
    expect(conv.reglas[0]).toMatchObject({ aceptadas: 1, soles_cent: 0 });
  });

  it("19) aceptada pero el producto NO terminó en la venta (se lo quitaron del carrito) → 0 soles", async () => {
    const id = await crearRegla();
    await venta("venta-2", "cu-2", sV, IBU, 1800); // la venta llevó otra cosa, no el sugerido
    await req(
      "/api/sugerencias/eventos",
      post(tok.operVes, { venta_client_uuid: "cu-2", eventos: [{ id: "ev-1", regla_id: id, resultado: "aceptada" }] }),
    );

    const conv = (await (await req("/api/sugerencias/conversion", bearer(tok.adminVes))).json()) as ConversionResp;
    expect(conv.reglas[0]).toMatchObject({ aceptadas: 1, soles_cent: 0 });
  });

  it("20) dos ventas distintas con la misma regla suman; el reintento de la cola NO duplica la plata", async () => {
    const id = await crearRegla();
    await venta("venta-1", "cu-1", sV, OME, 1200);
    await venta("venta-2", "cu-2", sV, OME, 800);
    const op1 = post(tok.operVes, { venta_client_uuid: "cu-1", eventos: [{ id: "ev-1", regla_id: id, resultado: "aceptada" }] });
    const op2 = post(tok.operVes, { venta_client_uuid: "cu-2", eventos: [{ id: "ev-2", regla_id: id, resultado: "aceptada" }] });
    await req("/api/sugerencias/eventos", op1);
    await req("/api/sugerencias/eventos", op2);
    await req("/api/sugerencias/eventos", post(tok.operVes, { venta_client_uuid: "cu-1", eventos: [{ id: "ev-1", regla_id: id, resultado: "aceptada" }] }));

    const conv = (await (await req("/api/sugerencias/conversion", bearer(tok.adminVes))).json()) as ConversionResp;
    expect(conv.reglas[0]).toMatchObject({ aceptadas: 2, soles_cent: 2000 });
  });
});
