import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// A2 v1 — GATE de la bandeja de reposición de crónicos.
//
// Lo que defienden estos tests, en orden de gravedad:
//   1. AISLAMIENTO POR BOTICA: la bandeja de VES no ve clientes, ventas ni marcas de Chazuta, y una
//      referencia de otra botica no puede escribir el "ya le escribí" (si pudiera, sacaría de la
//      bandeja ajena a alguien a quien nadie escribió — y esa persona se quedaría sin su medicina).
//   2. NADIE RECIBE UN MENSAJE FALSO: no entra quien no dio permiso, no entra una venta anulada, no
//      entra un producto sin marcar, y solo cuenta la ÚLTIMA compra (una vieja avisaría de algo que
//      ya se repuso).
//   3. NO SE REPITE: marcado el aviso, esa persona no vuelve a la lista; marcar dos veces no duplica.
//      Y se puede deshacer, porque el botón vive al lado del enlace.
//   4. UN MENSAJE POR PERSONA: dos tratamientos del mismo cliente = una fila, un WhatsApp.
//
// Fixture SINTÉTICO propio con DOS tenants, HTTP real contra el Worker. Las fechas se calculan
// relativas a HOY porque la ventana de la bandeja se mide contra el día real del server.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";

const T = "t-huayruro";
const T2 = "t-otra-cadena";
const sV = "suc-ves";
const sC = "suc-chz";
const sO = "suc-otra";

const LOS = "prod-losartan"; // crónico, 1 al día
const MET = "prod-metformina"; // crónico, 2 al día
const IBU = "prod-ibuprofeno"; // NO crónico
const AJENO = "prod-ajeno"; // crónico, de la otra cadena

const cV = "cli-ves-optin"; // VES, aceptó WhatsApp, número bueno
const cV2 = "cli-ves-sin-optin"; // VES, nunca aceptó
const cV3 = "cli-ves-mal-numero"; // VES, aceptó pero el número no sirve
const cC = "cli-chz"; // Chazuta, aceptó

const tok = {
  super: "tok-super",
  adminVes: "tok-admin-ves",
  adminChz: "tok-admin-chz",
  operVes: "tok-oper-ves",
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
const put = (t: string, b: unknown) => cuerpo("PUT", t, b);
const del = (t: string, b: unknown) => cuerpo("DELETE", t, b);
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

const DIA_MS = 86_400_000;
const HOY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
/** YYYY-MM-DD a n días de hoy (negativo = pasado). */
const ymd = (n: number): string => new Date(Date.parse(`${HOY}T12:00:00.000Z`) + n * DIA_MS).toISOString().slice(0, 10);

type ItemBandeja = { referencia_tipo: string; referencia_id: string; producto_nombre: string; fecha_agotamiento: string; dias_restantes: number };
type FilaBandeja = { cliente_id: string; cliente_nombre: string; dias_restantes: number; enlace: string; mensaje: string; items: ItemBandeja[] };
type BandejaResp = {
  hoy: string;
  dias: number;
  filas: FilaBandeja[];
  sin_permiso: number;
  sin_numero: number;
  cronicos_marcados: number;
  ya_contactados: { cliente_id: string; envio_ids: string[]; productos: string[] }[];
};

async function bandeja(token = tok.adminVes, query = ""): Promise<BandejaResp> {
  const r = await req(`/api/marketing/reposiciones-hoy${query}`, bearer(token));
  expect(r.status).toBe(200);
  return (await r.json()) as BandejaResp;
}

/** Venta con una línea del producto dado, fechada en el día local indicado. */
async function venta(id: string, sucursal: string, clienteId: string | null, productoId: string, cantidad: number, diaYmd: string, estado = "completada") {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO venta (id,client_uuid,sucursal_id,cliente_id,fecha_hora,subtotal_sin_igv_cent,igv_total_cent,total_cent,metodo_pago,estado,created_at,updated_at)
       VALUES (?1,?1,?2,?3,?4,847,153,1000,'efectivo',?5,?4,?4)`,
      // 15:00 UTC = 10:00 de Lima: el día local de la venta es el que dice el test, no el de UTC.
    ).bind(id, sucursal, clienteId, `${diaYmd}T15:00:00.000Z`, estado),
    env.DB.prepare(
      `INSERT INTO venta_item (id,venta_id,producto_id,presentacion_id,cantidad_presentacion,cantidad,precio_sin_igv_unitario_dm,igv_unitario_dm,precio_total_unitario_dm,subtotal_sin_igv_cent,igv_subtotal_cent,total_cent,created_at)
       VALUES (?1,?2,?3,?4,1,?5,847,153,1000,847,153,1000,?6)`,
    ).bind(`vi-${id}`, id, productoId, `pres-${productoId}`, cantidad, `${diaYmd}T15:00:00.000Z`),
  ]);
}

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of [
    "envio_whatsapp", "tratamiento", "cliente_familiar", "cliente", "venta_item", "venta", "sesion",
    "inventario_local", "precio_local", "presentacion", "producto_catalogo", "usuario_perfil", "sucursal", "tenant",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }

  const h = {
    super: await hashToken(tok.super),
    adminVes: await hashToken(tok.adminVes),
    adminChz: await hashToken(tok.adminChz),
    operVes: await hashToken(tok.operVes),
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
  const producto = (id: string, tenant: string, nombre: string, cronico: 0 | 1, dosis: number | null) =>
    db
      .prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,es_cronico,dosis_diaria_default,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)`)
      .bind(id, tenant, nombre, cronico, dosis, TS);
  const presentacion = (productoId: string) =>
    db.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(`pres-${productoId}`, productoId, TS);
  const cliente = (id: string, suc: string, nombre: string, optin: 0 | 1, wa: string | null) =>
    db
      .prepare(`INSERT INTO cliente (id,sucursal_id,nombre,whatsapp,optin_whatsapp,optin_whatsapp_at,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)`)
      .bind(id, suc, nombre, wa, optin, optin ? TS : null, TS);

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
    usuario("u-lector", T, sV, "lector_reportes", "lr@h.local"),
    usuario("u-admin-otro", T2, sO, "admin_sucursal", "ao@h.local"),
    sesion("s1", "u-super", h.super),
    sesion("s2", "u-admin-ves", h.adminVes),
    sesion("s3", "u-admin-chz", h.adminChz),
    sesion("s4", "u-oper-ves", h.operVes),
    sesion("s5", "u-lector", h.lector),
    sesion("s6", "u-admin-otro", h.adminOtro),
    producto(LOS, T, "Losartán 50 mg", 1, 1),
    producto(MET, T, "Metformina 850 mg", 1, 2),
    producto(IBU, T, "Ibuprofeno 400 mg", 0, null),
    producto(AJENO, T2, "Crónico de la otra cadena", 1, 1),
    presentacion(LOS),
    presentacion(MET),
    presentacion(IBU),
    presentacion(AJENO),
    cliente(cV, sV, "María Quispe", 1, "987654321"),
    cliente(cV2, sV, "Pedro Sin Permiso", 0, "987111222"),
    cliente(cV3, sV, "Rosa Mal Número", 1, "123"),
    cliente(cC, sC, "Cliente de Chazuta", 1, "987333444"),
  ]);
}

beforeEach(async () => {
  await sembrar();
});

describe("A2 — la bandeja sale sola de las ventas", () => {
  it("1) una venta de un crónico entra a la bandeja sin que nadie llene nada en el mostrador", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28)); // 30 tabletas, 1/día → se le acaba en 2 días
    const b = await bandeja();

    expect(b.filas).toHaveLength(1);
    const f = b.filas[0]!;
    expect(f.cliente_id).toBe(cV);
    expect(f.items[0]?.fecha_agotamiento).toBe(ymd(2));
    expect(f.items[0]?.dias_restantes).toBe(2);
    expect(f.items[0]?.referencia_tipo).toBe("venta_item");
    // El enlace lleva el 51 delante y el mensaje puesto (no lo envía: lo pre-carga).
    expect(f.enlace).toContain("https://wa.me/51987654321?text=");
    expect(f.mensaje).toContain("María");
    expect(f.mensaje).toContain("Losartán 50 mg");
    expect(f.mensaje).toContain("Botica Huayruro");
  });

  it("2) la dosis manda: 30 unidades a 2 por día duran la mitad", async () => {
    await venta("v1", sV, cV, MET, 30, ymd(-13)); // 15 días de tratamiento → se acaba en 2
    const b = await bandeja();
    expect(b.filas[0]?.items[0]?.dias_restantes).toBe(2);
  });

  it("3) al que le queda mucho todavía NO se le escribe", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-5)); // le quedan 25 días
    expect((await bandeja()).filas).toHaveLength(0);
  });

  it("4) los atrasados siguen en la lista y van primero", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-35)); // se le acabó hace 5 días
    await venta("v2", sV, cV3, LOS, 30, ymd(-29)); // le queda 1 día (pero su número no sirve)
    await env.DB.prepare(`UPDATE cliente SET whatsapp = '987000111' WHERE id = ?1`).bind(cV3).run();

    const b = await bandeja();
    expect(b.filas.map((f) => f.cliente_id)).toEqual([cV, cV3]);
    expect(b.filas[0]?.dias_restantes).toBe(-5);
    expect(b.filas[0]?.mensaje).toContain("se le habría acabado");
  });

  it("5) lo que se acabó hace meses ya no es reposición (no se arrastra para siempre)", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-120)); // se acabó hace 90 días
    expect((await bandeja()).filas).toHaveLength(0);
  });

  it("6) la ventana se puede abrir hasta 7 días y no más", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-24)); // le quedan 6 días
    expect((await bandeja()).filas).toHaveLength(0);
    expect((await bandeja(tok.adminVes, "?dias=7")).filas).toHaveLength(1);
    const tope = await bandeja(tok.adminVes, "?dias=99");
    expect(tope.dias).toBe(7);
  });

  it("7) un producto que NO está marcado como crónico no genera avisos", async () => {
    await venta("v1", sV, cV, IBU, 30, ymd(-28));
    const b = await bandeja();
    expect(b.filas).toHaveLength(0);
    expect(b.cronicos_marcados).toBe(2); // Losartán y Metformina; el Ibuprofeno no
  });

  it("8) una venta ANULADA no manda a nadie a comprar de nuevo", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28), "anulada");
    expect((await bandeja()).filas).toHaveLength(0);
  });

  it("9) solo cuenta la ÚLTIMA compra de ese producto", async () => {
    await venta("v-vieja", sV, cV, LOS, 30, ymd(-40)); // esta ya venció hace rato
    await venta("v-nueva", sV, cV, LOS, 30, ymd(-28)); // esta es la vigente
    const b = await bandeja();
    expect(b.filas).toHaveLength(1);
    expect(b.filas[0]?.items).toHaveLength(1);
    expect(b.filas[0]?.items[0]?.dias_restantes).toBe(2);
  });

  it("10) dos tratamientos de la misma persona = UNA fila y UN mensaje", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    await venta("v2", sV, cV, MET, 30, ymd(-14));
    const b = await bandeja();
    expect(b.filas).toHaveLength(1);
    expect(b.filas[0]?.items).toHaveLength(2);
    expect(b.filas[0]?.mensaje).toContain("Losartán 50 mg (hasta el");
    expect(b.filas[0]?.mensaje).toContain("Metformina 850 mg (hasta el");
    expect(b.filas[0]?.mensaje).toContain("¿Se los separamos");
  });

  it("11) una venta sin cliente identificado no puede avisar (no hay a quién)", async () => {
    await venta("v1", sV, null, LOS, 30, ymd(-28));
    expect((await bandeja()).filas).toHaveLength(0);
  });
});

describe("A2 — permiso y número", () => {
  it("12) quien NO dio permiso de WhatsApp no entra, se cuenta aparte y su teléfono no viaja", async () => {
    await venta("v1", sV, cV2, LOS, 30, ymd(-28));
    const b = await bandeja();
    expect(b.filas).toHaveLength(0);
    expect(b.sin_permiso).toBe(1);
    expect(JSON.stringify(b)).not.toContain("987111222");
  });

  it("13) el que aceptó pero tiene un número inservible se cuenta aparte (no se inventa un enlace)", async () => {
    await venta("v1", sV, cV3, LOS, 30, ymd(-28));
    const b = await bandeja();
    expect(b.filas).toHaveLength(0);
    expect(b.sin_numero).toBe(1);
  });
});

describe("A2 — seguimientos escritos a mano", () => {
  const tratamiento = (id: string, clienteId: string, productoId: string | null, inicio: string, dias: number) =>
    env.DB.prepare(
      `INSERT INTO tratamiento (id,cliente_id,producto_id,descripcion,duracion_dias,estado,fecha_inicio,created_at,updated_at)
       VALUES (?1,?2,?3,'seguimiento de prueba',?4,'activo',?5,?6,?6)`,
    ).bind(id, clienteId, productoId, dias, inicio, TS).run();

  it("14) un seguimiento con duración escrita también llega a la bandeja", async () => {
    await tratamiento("t1", cV, null, ymd(-28), 30);
    const b = await bandeja();
    expect(b.filas).toHaveLength(1);
    expect(b.filas[0]?.items[0]?.referencia_tipo).toBe("tratamiento");
    expect(b.filas[0]?.items[0]?.dias_restantes).toBe(2);
  });

  it("15) si hay seguimiento Y venta del mismo producto, la persona sale UNA sola vez", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    await tratamiento("t1", cV, LOS, ymd(-27), 30); // el humano dijo que empezó un día después
    const b = await bandeja();
    expect(b.filas).toHaveLength(1);
    expect(b.filas[0]?.items).toHaveLength(1);
    // Gana el escrito a mano: alguien lo puso a propósito.
    expect(b.filas[0]?.items[0]?.referencia_tipo).toBe("tratamiento");
    expect(b.filas[0]?.items[0]?.dias_restantes).toBe(3);
  });
});

describe("A2 — “ya le escribí”", () => {
  async function marcar(token = tok.operVes, cliente = cV, refs?: { tipo: string; id: string }[]) {
    const b = await bandeja(token === tok.lector ? tok.adminVes : token);
    const fila = b.filas.find((f) => f.cliente_id === cliente);
    const referencias = refs ?? (fila?.items ?? []).map((i) => ({ tipo: i.referencia_tipo, id: i.referencia_id }));
    return req("/api/marketing/reposiciones/contactado", post(token, { cliente_id: cliente, referencias, mensaje: fila?.mensaje ?? "" }));
  }

  it("16) marcado el aviso, esa persona no vuelve a salir en la lista", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    expect((await marcar()).status).toBe(201);

    const b = await bandeja();
    expect(b.filas).toHaveLength(0);
    expect(b.ya_contactados).toHaveLength(1);
    expect(b.ya_contactados[0]?.productos).toEqual(["Losartán 50 mg"]);
  });

  it("17) marcar dos veces no duplica el registro (dos personas mirando la misma bandeja)", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    const primera = await marcar();
    expect(primera.status).toBe(201);
    // La segunda llega con la referencia en la mano aunque la bandeja ya no la muestre.
    const r = await req(
      "/api/marketing/reposiciones/contactado",
      post(tok.adminVes, { cliente_id: cV, referencias: [{ tipo: "venta_item", id: "vi-v1" }] }),
    );
    expect(r.status).toBe(201);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM envio_whatsapp`).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("18) deshacer devuelve a la persona a la bandeja", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    await marcar();
    const b = await bandeja();
    const ids = b.ya_contactados[0]!.envio_ids;

    const r = await req("/api/marketing/reposiciones/contactado", del(tok.adminVes, { ids }));
    expect(r.status).toBe(200);
    expect((await bandeja()).filas).toHaveLength(1);
  });

  it("19) una nueva compra vuelve a generar aviso (marcar no silencia para siempre)", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    await marcar();
    expect((await bandeja()).filas).toHaveLength(0);

    await venta("v2", sV, cV, LOS, 30, ymd(-27)); // vuelve a comprar; ese aviso es otro
    const b = await bandeja();
    expect(b.filas).toHaveLength(1);
    expect(b.filas[0]?.items[0]?.referencia_id).toBe("vi-v2");
  });

  it("20) marcar sin referencias válidas es 404, no un registro vacío", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    const r = await req("/api/marketing/reposiciones/contactado", post(tok.adminVes, { cliente_id: cV, referencias: [{ tipo: "venta_item", id: "no-existe" }] }));
    expect(r.status).toBe(404);
  });
});

describe("A2 — aislamiento por botica y por cadena", () => {
  it("21) la bandeja de VES no ve a los clientes de Chazuta", async () => {
    await venta("v1", sC, cC, LOS, 30, ymd(-28));
    expect((await bandeja(tok.adminVes)).filas).toHaveLength(0);
    expect((await bandeja(tok.adminChz)).filas).toHaveLength(1);
  });

  it("22) no se puede marcar a un cliente de otra botica", async () => {
    await venta("v1", sC, cC, LOS, 30, ymd(-28));
    const r = await req("/api/marketing/reposiciones/contactado", post(tok.adminVes, { cliente_id: cC, referencias: [{ tipo: "venta_item", id: "vi-v1" }] }));
    expect(r.status).toBe(404);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM envio_whatsapp`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("23) una referencia de OTRA botica no escribe nada aunque el cliente sea mío", async () => {
    await venta("v-chz", sC, cC, LOS, 30, ymd(-28)); // línea de venta de Chazuta
    await venta("v-ves", sV, cV, LOS, 30, ymd(-28));
    const r = await req(
      "/api/marketing/reposiciones/contactado",
      post(tok.adminVes, { cliente_id: cV, referencias: [{ tipo: "venta_item", id: "vi-v-chz" }] }),
    );
    expect(r.status).toBe(404);
    // Y el cliente de VES sigue en su bandeja: nadie lo silenció por rebote.
    expect((await bandeja(tok.adminVes)).filas).toHaveLength(1);
  });

  it("24) no se puede deshacer el registro de otra botica", async () => {
    await venta("v1", sC, cC, LOS, 30, ymd(-28));
    await req("/api/marketing/reposiciones/contactado", post(tok.adminChz, { cliente_id: cC, referencias: [{ tipo: "venta_item", id: "vi-v1" }] }));
    const id = (await env.DB.prepare(`SELECT id FROM envio_whatsapp`).first<{ id: string }>())?.id ?? "";

    const r = await req("/api/marketing/reposiciones/contactado", del(tok.adminVes, { ids: [id] }));
    expect(r.status).toBe(404);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM envio_whatsapp`).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("25) el admin de otra cadena no ve nada de Huayruro", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    const b = await bandeja(tok.adminOtro);
    expect(b.filas).toHaveLength(0);
    expect(b.cronicos_marcados).toBe(1); // solo el suyo
  });

  it("26) el lector de reportes no entra al padrón por esta puerta", async () => {
    expect((await req("/api/marketing/reposiciones-hoy", bearer(tok.lector))).status).toBe(403);
    expect((await req("/api/marketing/reposiciones/contactado", post(tok.lector, { cliente_id: cV, referencias: [] }))).status).toBe(403);
  });

  it("27) el super elige botica y ve la de esa botica, no la suma de todas", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    await venta("v2", sC, cC, LOS, 30, ymd(-28));
    expect((await bandeja(tok.super, `?sucursal_id=${sV}`)).filas.map((f) => f.cliente_id)).toEqual([cV]);
    expect((await bandeja(tok.super, `?sucursal_id=${sC}`)).filas.map((f) => f.cliente_id)).toEqual([cC]);
  });
});

describe("Δ4 — marcar el SKU como crónico (lo que le da contenido a la bandeja)", () => {
  it("28) el admin marca un producto con su dosis y aparece en la lista de crónicos", async () => {
    const r = await req(`/api/catalogo/productos/${IBU}/cronico`, put(tok.adminVes, { es_cronico: true, dosis_diaria: 3 }));
    expect(r.status).toBe(200);
    const lista = (await (await req("/api/catalogo/cronicos", bearer(tok.adminVes))).json()) as { productos: { id: string; dosis_diaria_default: number }[] };
    expect(lista.productos.find((p) => p.id === IBU)?.dosis_diaria_default).toBe(3);
  });

  it("29) marcar sin dosis se rechaza (marcado sin dosis = bandeja que no puede calcular nada)", async () => {
    const r = await req(`/api/catalogo/productos/${IBU}/cronico`, put(tok.adminVes, { es_cronico: true, dosis_diaria: null }));
    expect(r.status).toBe(422);
    const r0 = await req(`/api/catalogo/productos/${IBU}/cronico`, put(tok.adminVes, { es_cronico: true, dosis_diaria: 0 }));
    expect(r0.status).toBe(422);
  });

  it("30) desmarcar borra la dosis y saca los avisos de ese producto", async () => {
    await venta("v1", sV, cV, LOS, 30, ymd(-28));
    expect((await bandeja()).filas).toHaveLength(1);

    expect((await req(`/api/catalogo/productos/${LOS}/cronico`, put(tok.adminVes, { es_cronico: false, dosis_diaria: null }))).status).toBe(200);
    const p = await env.DB.prepare(`SELECT es_cronico, dosis_diaria_default FROM producto_catalogo WHERE id = ?1`).bind(LOS).first<{ es_cronico: number; dosis_diaria_default: number | null }>();
    expect(p?.es_cronico).toBe(0);
    expect(p?.dosis_diaria_default).toBeNull();
    expect((await bandeja()).filas).toHaveLength(0);
  });

  it("31) no se puede marcar el producto de otra cadena, ni marcar siendo vendedor", async () => {
    expect((await req(`/api/catalogo/productos/${AJENO}/cronico`, put(tok.adminVes, { es_cronico: true, dosis_diaria: 1 }))).status).toBe(404);
    expect((await req(`/api/catalogo/productos/${IBU}/cronico`, put(tok.operVes, { es_cronico: true, dosis_diaria: 1 }))).status).toBe(403);
  });
});
