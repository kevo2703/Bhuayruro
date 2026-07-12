import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";
import { conteoRepo } from "../src/repos/conteo";
import { casosRepo, evaluarCasosSucursal } from "../src/repos/casos";

// ============================================================
// GATE P5 (C3) — Conteo cíclico de inventario. Datos sintéticos que ejercen: clasificación ABC + lista
// sugerida (ciega), finalizar con ajuste de stock + valorización de merma, idempotencia, IRA %, y el
// indicador EBR `merma_conteo` (material por sesión + recurrente por SKU). Aislamiento por sucursal/tenant.
// ============================================================

const TS = "2026-01-01T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";
const AHORA = "2026-07-12T08:00:00.000Z"; // 03:00 Lima
const PW = "pbkdf2$100000$c2FsdA==$aGFzaA==";

const TA = "t-a";
const TB = "t-b";
const sucA = "suc-a";
const sucB = "suc-b";
const tok = { superA: "tok-super-a", adminA: "tok-admin-a", superB: "tok-super-b" };

const post = (t: string, body: unknown): RequestInit => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of ["conteo_item", "conteo_sesion", "movimiento_stock", "caso", "venta_item", "venta", "precio_local", "presentacion", "inventario_local", "producto_catalogo", "sesion", "usuario_perfil", "sucursal", "tenant"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'A','Huayruro',?2,?2)`).bind(TA, TS),
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'B','Otra',?2,?2)`).bind(TB, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,activa,created_at,updated_at) VALUES (?1,?2,'VES',1,?3,?3)`).bind(sucA, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,activa,created_at,updated_at) VALUES (?1,?2,'Ajena',1,?3,?3)`).bind(sucB, TB, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-a',?1,NULL,'super_admin','SuperA','sa@h.local',?2,?3,?3)`).bind(TA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-a',?1,?2,'admin_sucursal','AdminA','aa@h.local',?3,?4,?4)`).bind(TA, sucA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-b',?1,NULL,'super_admin','SuperB','sb@h.local',?2,?3,?3)`).bind(TB, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s0','u-super-a',?1,?2,?3)`).bind(await hashToken(tok.superA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s1','u-admin-a',?1,?2,?3)`).bind(await hashToken(tok.adminA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s2','u-super-b',?1,?2,?3)`).bind(await hashToken(tok.superB), TS, FUTURO),
  ]);
}

// Producto + presentación base (factor 1) + inventario en la sucursal (+ precio con costo opcional).
async function seedProd(id: string, nombre: string, suc: string, stock: number, opts: { compraDm?: number; ventaDm?: number } = {}): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)`).bind(id, TA, nombre, TS),
    env.DB.prepare(`INSERT OR IGNORE INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES (?1,?2,'unidad',1,1,?3)`).bind(`pres-${id}`, id, TS),
    env.DB.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES (?1,?2,?3,?4,0,?5)`).bind(`inv-${id}-${suc}`, suc, id, stock, TS),
  ]);
  if (opts.compraDm !== undefined || opts.ventaDm !== undefined) {
    await env.DB.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_compra_dm,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES (?1,?2,?3,?4,?5,?6,0,?6,?7,?7)`)
      .bind(`pl-${id}-${suc}`, id, suc, `pres-${id}`, opts.compraDm ?? null, opts.ventaDm ?? 0, TS)
      .run();
  }
}

// Una venta completada con un ítem del producto (para dar valor de venta a la clasificación ABC).
async function seedVenta(id: string, suc: string, prod: string, totalCent: number, fechaHora = "2026-07-01T20:00:00.000Z"): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO venta (id,client_uuid,sucursal_id,operador_id,fecha_hora,subtotal_sin_igv_cent,igv_total_cent,total_cent,metodo_pago,estado,created_at,updated_at) VALUES (?1,?1,?2,NULL,?3,?4,0,?4,'efectivo','completada',?3,?3)`).bind(id, suc, fechaHora, totalCent),
    env.DB.prepare(`INSERT INTO venta_item (id,venta_id,producto_id,presentacion_id,cantidad_presentacion,cantidad,precio_sin_igv_unitario_dm,igv_unitario_dm,precio_total_unitario_dm,subtotal_sin_igv_cent,igv_subtotal_cent,total_cent,created_at) VALUES (?1,?2,?3,?4,1,1,0,0,0,?5,0,?5,?6)`).bind(`vi-${id}`, id, prod, `pres-${prod}`, totalCent, fechaHora),
  ]);
}

const stockDe = async (prod: string, suc: string): Promise<number> =>
  (await env.DB.prepare(`SELECT stock_unidades AS s FROM inventario_local WHERE producto_id=?1 AND sucursal_id=?2`).bind(prod, suc).first<{ s: number }>())?.s ?? -999;
const casos = (suc: string) => casosRepo(env.DB).listar(suc, null);
const mermaCasos = async (suc: string) => (await casos(suc)).filter((c) => c.indicador === "merma_conteo");

beforeEach(sembrar);

describe("Sugeridos ABC (lista del día, ciega)", () => {
  it("prioriza A>B>C por valor de venta y NO expone el stock esperado", async () => {
    await seedProd("p-mucho", "Vende Mucho", sucA, 50);
    await seedProd("p-poco", "Vende Poco", sucA, 50);
    await seedProd("p-cero", "Sin Venta", sucA, 50);
    await seedVenta("vm", sucA, "p-mucho", 100000);
    await seedVenta("vp", sucA, "p-poco", 1000);

    const r = await conteoRepo(env.DB).sugeridos(sucA, { hoyYmd: "2026-07-12", nowIso: AHORA, limite: 20 });
    expect(r.total_universo).toBe(3);
    expect(r.total_vencidos).toBe(3); // ninguno contado aún
    expect(r.sugeridos.map((s) => s.producto_id)).toEqual(["p-mucho", "p-poco", "p-cero"]);
    expect(r.sugeridos[0]!.clase).toBe("A");
    expect(r.sugeridos[2]!.clase).toBe("C"); // sin venta → C
    // Ciego: la fila no trae el stock esperado.
    expect(Object.keys(r.sugeridos[0]!)).not.toContain("esperado");
    expect(Object.keys(r.sugeridos[0]!)).not.toContain("stock");
  });

  it("un producto recién contado sale de la lista hasta que venza su cadencia", async () => {
    await seedProd("p-a", "Producto A", sucA, 50);
    await seedVenta("va", sucA, "p-a", 100000); // clase A → cadencia 7 días
    await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "c-a-1", operadorId: null, items: [{ productoId: "p-a", contado: 50 }], notas: null, nowIso: "2026-07-11T20:00:00.000Z" });

    const r = await conteoRepo(env.DB).sugeridos(sucA, { hoyYmd: "2026-07-12", nowIso: AHORA, limite: 20 });
    expect(r.sugeridos.find((s) => s.producto_id === "p-a")).toBeUndefined(); // contado ayer, aún no vence
  });
});

describe("Finalizar — ajuste de stock + valorización de merma + idempotencia", () => {
  it("descuadre negativo ajusta stock, registra movimiento y valoriza la merma al costo", async () => {
    await seedProd("p-caro", "Caro", sucA, 100, { compraDm: 30000 }); // S/3.00 costo por unidad base
    const r = await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cc-1", operadorId: "u-admin-a", items: [{ productoId: "p-caro", contado: 90 }], notas: "conteo semanal", nowIso: AHORA });

    expect(r.idempotent).toBe(false);
    expect(r.items_contados).toBe(1);
    expect(r.items_descuadrados).toBe(1);
    expect(r.merma_valor_cent).toBe(-3000); // 10 u × S/3.00 = S/30.00
    expect(await stockDe("p-caro", sucA)).toBe(90); // ajustado a lo contado

    const mov = await env.DB.prepare(`SELECT cantidad, motivo, tipo FROM movimiento_stock WHERE producto_id='p-caro'`).first<{ cantidad: number; motivo: string; tipo: string }>();
    expect(mov?.cantidad).toBe(-10); // delta con signo
    expect(mov?.motivo).toBe("conteo_ciclico");
    const item = await env.DB.prepare(`SELECT esperado_unidades AS e, contado_unidades AS c, diferencia_valor_cent AS v FROM conteo_item WHERE producto_id='p-caro'`).first<{ e: number; c: number; v: number }>();
    expect(item).toMatchObject({ e: 100, c: 90, v: -3000 });
  });

  it("sin costo de compra valoriza al precio de venta (fallback)", async () => {
    await seedProd("p-sv", "Solo Venta", sucA, 20, { ventaDm: 50000 }); // S/5.00 venta, sin compra
    const r = await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cc-2", operadorId: null, items: [{ productoId: "p-sv", contado: 18 }], notas: null, nowIso: AHORA });
    expect(r.merma_valor_cent).toBe(-1000); // 2 u × S/5.00 = S/10.00
  });

  it("conteo exacto no ajusta ni marca descuadre", async () => {
    await seedProd("p-ok", "Exacto", sucA, 30, { compraDm: 10000 });
    const r = await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cc-3", operadorId: null, items: [{ productoId: "p-ok", contado: 30 }], notas: null, nowIso: AHORA });
    expect(r.items_descuadrados).toBe(0);
    expect(r.merma_valor_cent).toBe(0);
    const mov = await env.DB.prepare(`SELECT COUNT(*) AS n FROM movimiento_stock WHERE producto_id='p-ok'`).first<{ n: number }>();
    expect(mov?.n).toBe(0); // no hay movimiento si no hubo diferencia
  });

  it("reintento con el mismo client_uuid NO re-ajusta el stock (idempotente)", async () => {
    await seedProd("p-idem", "Idem", sucA, 100, { compraDm: 10000 });
    const a = await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cc-idem", operadorId: null, items: [{ productoId: "p-idem", contado: 80 }], notas: null, nowIso: AHORA });
    const b = await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cc-idem", operadorId: null, items: [{ productoId: "p-idem", contado: 80 }], notas: null, nowIso: AHORA });
    expect(a.idempotent).toBe(false);
    expect(b.idempotent).toBe(true);
    expect(await stockDe("p-idem", sucA)).toBe(80); // una sola vez, no 60
    const sesiones = await env.DB.prepare(`SELECT COUNT(*) AS n FROM conteo_sesion WHERE sucursal_id=?1`).bind(sucA).first<{ n: number }>();
    expect(sesiones?.n).toBe(1);
  });

  it("productos sin inventario en la sucursal quedan omitidos (no rompen la hoja)", async () => {
    await seedProd("p-real", "Real", sucA, 10, { compraDm: 10000 });
    const r = await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cc-4", operadorId: null, items: [{ productoId: "p-real", contado: 10 }, { productoId: "p-fantasma", contado: 5 }], notas: null, nowIso: AHORA });
    expect(r.items_contados).toBe(1);
    expect(r.omitidos).toEqual(["p-fantasma"]);
  });
});

describe("Indicador merma_conteo (EBR)", () => {
  it("una sesión con merma material abre un caso 'perdida'", async () => {
    await seedProd("p-m", "Merma Fuerte", sucA, 100, { compraDm: 30000 });
    await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cm-1", operadorId: null, items: [{ productoId: "p-m", contado: 90 }], notas: null, nowIso: AHORA }); // merma S/30
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    const c = await mermaCasos(sucA);
    expect(c).toHaveLength(1);
    expect(c[0]!.tipo).toBe("perdida");
    expect((c[0]!.evidencia as { tipo_merma: string }).tipo_merma).toBe("material");
    expect((c[0]!.evidencia as { merma_cent: number }).merma_cent).toBe(-3000);
  });

  it("una merma pequeña (bajo el piso material) NO abre caso", async () => {
    await seedProd("p-chico", "Merma Chica", sucA, 100, { compraDm: 100 }); // S/0.01 costo
    await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cm-2", operadorId: null, items: [{ productoId: "p-chico", contado: 95 }], notas: null, nowIso: AHORA }); // merma S/0.05
    await evaluarCasosSucursal(env.DB, sucA, AHORA);
    expect(await mermaCasos(sucA)).toHaveLength(0);
  });

  it("el Cron es idempotente: reprocesar no duplica el caso", async () => {
    await seedProd("p-dup", "Merma Dup", sucA, 100, { compraDm: 30000 });
    await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cm-3", operadorId: null, items: [{ productoId: "p-dup", contado: 90 }], notas: null, nowIso: AHORA });
    await evaluarCasosSucursal(env.DB, sucA, AHORA);
    await evaluarCasosSucursal(env.DB, sucA, AHORA); // segunda corrida
    expect(await mermaCasos(sucA)).toHaveLength(1);
  });

  it("un SKU con faltante recurrente (≥3 conteos) abre un caso recurrente aunque cada merma sea chica", async () => {
    await seedProd("p-rec", "Recurrente", sucA, 100, { compraDm: 100 }); // costo chico → material nunca dispara
    await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "r-1", operadorId: null, items: [{ productoId: "p-rec", contado: 95 }], notas: null, nowIso: "2026-07-05T20:00:00.000Z" });
    await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "r-2", operadorId: null, items: [{ productoId: "p-rec", contado: 90 }], notas: null, nowIso: "2026-07-08T20:00:00.000Z" });
    await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "r-3", operadorId: null, items: [{ productoId: "p-rec", contado: 85 }], notas: null, nowIso: "2026-07-11T20:00:00.000Z" });
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    const c = await mermaCasos(sucA);
    expect(c).toHaveLength(1);
    expect((c[0]!.evidencia as { tipo_merma: string }).tipo_merma).toBe("recurrente");
    expect((c[0]!.evidencia as { sesiones: number }).sesiones).toBe(3);
  });

  it("el tope anti-fatiga reserva cupos a casos NUEVOS: los ya persistidos no hambrean a uno nuevo", async () => {
    // 40 productos en stock negativo (sev 2) llenan el tope (40/corrida) la primera noche.
    for (let i = 0; i < 40; i++) await seedProd(`neg-${String(i).padStart(2, "0")}`, `Neg ${i}`, sucA, -25);
    await evaluarCasosSucursal(env.DB, sucA, AHORA);
    expect((await casos(sucA)).filter((c) => c.indicador === "stock_negativo")).toHaveLength(40);

    // Aparece una merma material (sev 2), rankeada DESPUÉS de los 40 stock_negativo ya persistidos.
    await seedProd("p-merma", "Merma Nueva", sucA, 100, { compraDm: 30000 });
    await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "cm-tope", operadorId: null, items: [{ productoId: "p-merma", contado: 90 }], notas: null, nowIso: AHORA }); // S/30 → sev 2
    await evaluarCasosSucursal(env.DB, sucA, AHORA);

    // Con el pre-filtro de clave_dedup, los 40 persistidos ya no consumen cupo → el caso nuevo SÍ entra.
    expect(await mermaCasos(sucA)).toHaveLength(1);
  });
});

describe("IRA % (resumen)", () => {
  it("calcula exactitud sobre los items contados del periodo", async () => {
    await seedProd("i-1", "Uno", sucA, 10, { compraDm: 10000 });
    await seedProd("i-2", "Dos", sucA, 10, { compraDm: 10000 });
    await seedProd("i-3", "Tres", sucA, 10, { compraDm: 10000 });
    // 3 items: 2 exactos, 1 descuadrado → IRA 66.7%.
    await conteoRepo(env.DB).finalizar({ sucursalId: sucA, clientUuid: "ira-1", operadorId: null, items: [
      { productoId: "i-1", contado: 10 }, { productoId: "i-2", contado: 10 }, { productoId: "i-3", contado: 8 },
    ], notas: null, nowIso: AHORA });

    const r = await conteoRepo(env.DB).resumen(sucA, { dias: 30, nowIso: AHORA });
    expect(r.items_contados).toBe(3);
    expect(r.items_exactos).toBe(2);
    expect(r.ira_pct).toBe(66.7);
    expect(r.sesiones).toHaveLength(1);
  });

  it("sin conteos, IRA es null (no 0)", async () => {
    const r = await conteoRepo(env.DB).resumen(sucA, { dias: 30, nowIso: AHORA });
    expect(r.ira_pct).toBeNull();
    expect(r.items_contados).toBe(0);
  });
});

describe("Rutas + aislamiento", () => {
  it("admin finaliza un conteo por HTTP (201) e idempotente (200)", async () => {
    await seedProd("h-1", "HTTP Uno", sucA, 40, { compraDm: 10000 });
    const body = { client_uuid: "http-1", items: [{ producto_id: "h-1", contado: 35 }] };
    const r1 = await req("/api/conteos", post(tok.adminA, body));
    expect(r1.status).toBe(201);
    const r2 = await req("/api/conteos", post(tok.adminA, body));
    expect(r2.status).toBe(200); // idempotente
    expect(await stockDe("h-1", sucA)).toBe(35);
  });

  it("super sin sucursal_id → 400; super con sucursal de otro tenant → 404", async () => {
    const sinSuc = await req("/api/conteos/sugeridos", bearer(tok.superA));
    expect(sinSuc.status).toBe(400);
    const ajena = await req(`/api/conteos/sugeridos?sucursal_id=${sucB}`, bearer(tok.superA));
    expect(ajena.status).toBe(404); // sucB es del tenant B
  });

  it("un super de OTRO tenant no puede contar en la sucursal ajena", async () => {
    await seedProd("x-1", "X", sucA, 10, { compraDm: 10000 });
    const r = await req(`/api/conteos?sucursal_id=${sucA}`, post(tok.superB, { client_uuid: "x-http", items: [{ producto_id: "x-1", contado: 9 }] }));
    expect(r.status).toBe(404);
  });

  it("sin token → 401", async () => {
    const r = await req("/api/conteos/resumen");
    expect(r.status).toBe(401);
  });
});
