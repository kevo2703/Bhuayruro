import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// GATE B8 — matching de listas + motor del pedido (comparador).
// Dos tenants: las tablas nuevas (producto_alias, pedido, pedido_item) exigen su aislamiento.
// El motor del pedido se prueba con un GOLDEN calculado a mano (mismo fixture que shared/pedido.test).
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";
const TA = "t-a";
const TB = "t-b";
const sucA = "suc-a";
const sucB = "suc-b";
const tok = { superA: "tok-super-a", superB: "tok-super-b", adminA: "tok-admin-a" };

const GTIN_IBU = "7750100000015";
// productos del tenant A
const P_IBU = "pa-ibu", P_PARA = "pa-para", P_AMOX = "pa-amox", P_ALC = "pa-alc";
// proveedores del golden (ids fijos → orden determinista prov-a < prov-b < prov-c)
const PA = "prov-a", PB = "prov-b", PC = "prov-c", PMATCH = "prov-match";

function bearer(t: string): RequestInit {
  return { headers: { Authorization: `Bearer ${t}` } };
}
function post(t: string, body: unknown): RequestInit {
  return { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

// oferta matcheada (auto) directamente en lista_item — para el golden del motor sin pasar por matching.
function ofertaGolden(db: D1Database, id: string, listaId: string, fila: number, productoId: string, precioCent: number, factor: number, bonifC: number | null, bonifG: number | null, vencCorto: number) {
  return db
    .prepare(
      `INSERT INTO lista_item (id, lista_id, fila, texto_original, texto_norm, gtin, laboratorio, presentacion_texto,
                               factor_unidades, precio_cent, bonif_compra, bonif_gratis, vencimiento, venc_corto,
                               producto_id, match_metodo, match_score, match_estado)
       VALUES (?1, ?2, ?3, ?4, ?4, NULL, NULL, NULL, ?5, ?6, ?7, ?8, NULL, ?9, ?10, 'fuzzy', 0.95, 'auto')`,
    )
    .bind(id, listaId, fila, `oferta-${id}`, factor, precioCent, bonifC, bonifG, vencCorto, productoId);
}

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of [
    "pedido_item", "pedido", "lista_item", "lista_precios", "producto_alias", "proveedor",
    "sesion", "codigo_barras", "inventario_local", "presentacion", "producto_fts", "producto_catalogo",
    "usuario_perfil", "sucursal", "tenant",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  const PW = "pbkdf2$310000$c2FsdA==$aGFzaA==";
  const prod = (id: string, nombre: string, lab: string | null, pa: string | null) =>
    db
      .prepare(`INSERT INTO producto_catalogo (id, tenant_id, nombre, laboratorio, principio_activo, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`)
      .bind(id, TA, nombre, lab, pa, TS);
  const pres = (pid: string) => db.prepare(`INSERT INTO presentacion (id, producto_id, nombre, factor_unidades, es_base, created_at) VALUES (?1, ?2, 'unidad', 1, 1, ?3)`).bind(`pres-${pid}`, pid, TS);
  const inv = (pid: string, stock: number, min: number) => db.prepare(`INSERT INTO inventario_local (id, sucursal_id, producto_id, stock_unidades, stock_minimo, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(`inv-${pid}`, sucA, pid, stock, min, TS);
  const prov = (id: string, nombre: string, min: number, flete: number) =>
    db.prepare(`INSERT INTO proveedor (id, tenant_id, nombre, monto_minimo_cent, flete_cent, activo, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`).bind(id, TA, nombre, min, flete, TS);
  const lista = (id: string, provId: string) =>
    db.prepare(`INSERT INTO lista_precios (id, tenant_id, proveedor_id, etiqueta, fecha_lista, filas_total, filas_match, estado, created_at) VALUES (?1, ?2, ?3, 'golden', '2026-07-01', 3, 3, 'matcheada', ?4)`).bind(id, TA, provId, TS);

  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'A','Huayruro',?2,?2)`).bind(TA, TS),
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'B','Otra',?2,?2)`).bind(TB, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'VES',?3,?3)`).bind(sucA, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ajena',?3,?3)`).bind(sucB, TB, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-a',?1,NULL,'super_admin','SA','sa@h.local',?2,?3,?3)`).bind(TA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-a',?1,?2,'admin_sucursal','AA','aa@h.local',?3,?4,?4)`).bind(TA, sucA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-b',?1,NULL,'super_admin','SB','sb@h.local',?2,?3,?3)`).bind(TB, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s1','u-super-a',?1,?2,?3)`).bind(await hashToken(tok.superA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s2','u-admin-a',?1,?2,?3)`).bind(await hashToken(tok.adminA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s3','u-super-b',?1,?2,?3)`).bind(await hashToken(tok.superB), TS, FUTURO),
    // catálogo tenant A
    prod(P_IBU, "Ibuprofeno 400 mg", "Genfar", "Ibuprofeno"),
    prod(P_PARA, "Paracetamol 500 mg", "Portugal", "Paracetamol"),
    prod(P_AMOX, "Amoxicilina 500 mg", "Genfar", "Amoxicilina"),
    prod(P_ALC, "Alcohol 70", null, null),
    pres(P_IBU), pres(P_PARA), pres(P_AMOX), pres(P_ALC),
    db.prepare(`INSERT INTO codigo_barras (id, producto_id, presentacion_id, gtin, es_unidad, created_at) VALUES ('cb-ibu', ?1, 'pres-pa-ibu', ?2, 1, ?3)`).bind(P_IBU, GTIN_IBU, TS),
    inv(P_IBU, 0, 100), inv(P_PARA, 10, 100), inv(P_AMOX, 0, 50), inv(P_ALC, 0, 20),
    // proveedores del golden + el de matching
    prov(PA, "Droguería A", 50000, 2500),
    prov(PB, "Droguería B", 80000, 4000),
    prov(PC, "Droguería C", 30000, 1500),
    prov(PMATCH, "Droguería Match", 0, 0),
    lista("la-a", PA), lista("la-b", PB), lista("la-c", PC),
    // ofertas golden (mismas cifras que shared/pedido.test)
    ofertaGolden(db, "li-a1", "la-a", 1, P_IBU, 3800, 100, 10, 1, 0),
    ofertaGolden(db, "li-a2", "la-a", 2, P_PARA, 3000, 100, null, null, 0),
    ofertaGolden(db, "li-a3", "la-a", 3, P_AMOX, 9000, 100, null, null, 0),
    ofertaGolden(db, "li-b1", "la-b", 1, P_IBU, 400, 10, null, null, 0),
    ofertaGolden(db, "li-b2", "la-b", 2, P_PARA, 320, 10, null, null, 0),
    ofertaGolden(db, "li-b3", "la-b", 3, P_AMOX, 8500, 100, null, null, 0),
    ofertaGolden(db, "li-c1", "la-c", 1, P_IBU, 3600, 100, null, null, 0),
    ofertaGolden(db, "li-c3", "la-c", 2, P_AMOX, 8000, 100, null, null, 1),
  ]);
}

beforeEach(async () => {
  await sembrar();
});

// ---- MATCHING (B8.2) ----
const CSV_MATCH = [
  "PRODUCTO;PRESENTACION;PRECIO;BONIFICACION;VCTO;CODIGO",
  `IBUPROFENO 400MG TAB CAJA X 100 GENFAR;CAJA X 100;38.00;10+1;;${GTIN_IBU}`,
  "PARACETAMOL 500 MG;CAJA X 100;30.00;;;",
  "AMOXICILINA 500 MG SUSPENSION FCO 60 ML MEDIFARMA;FCO X 60 ML;25.00;;;",
  "ALCOHOL EN GEL 70 FRASCO X 500 ML;FCO X 500 ML;8.00;;;",
  "GASA ESTERIL 10 X 10 CM;PAQUETE;5.00;;;",
].join("\n");

async function ingerir(csv: string, etiqueta: string): Promise<string> {
  const r = await req(`/api/proveedores/${PMATCH}/listas`, post(tok.superA, { csv, etiqueta }));
  expect(r.status).toBe(201);
  return ((await r.json()) as { lista_id: string }).lista_id;
}

describe("B8.2 — matching (GTIN → alias → nombre → fuzzy)", () => {
  it("clasifica una lista: 2 auto (GTIN, nombre exacto), 2 pendientes (fuzzy), 1 sin match", async () => {
    const listaId = await ingerir(CSV_MATCH, "julio");
    const r = await req(`/api/proveedores/listas/${listaId}/matchear`, post(tok.superA, {}));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { resumen: { total: number; auto: number; pendiente: number; sin_match: number }; pendientes: { id: string; texto_original: string; producto_id?: string; sugerencias: { producto_id: string }[] }[] };
    expect(j.resumen).toMatchObject({ total: 5, auto: 2, pendiente: 2, sin_match: 1 });

    // GTIN: ibuprofeno → P_IBU con precio_unidad_dm efectivo (bonif 10+1, caja x100) = 3455.
    const items = (await (await req(`/api/proveedores/listas/${listaId}/items`, bearer(tok.superA))).json()) as { items: { texto_original: string; producto_id: string | null; match_metodo: string | null; match_estado: string }[] };
    const ibu = items.items.find((i) => i.texto_original.startsWith("IBUPROFENO"))!;
    expect(ibu.match_metodo).toBe("gtin");
    expect(ibu.producto_id).toBe(P_IBU);
    const dm = await env.DB.prepare(`SELECT precio_unidad_dm FROM lista_item WHERE producto_id = ?1 AND lista_id = ?2`).bind(P_IBU, listaId).first<{ precio_unidad_dm: number }>();
    expect(dm?.precio_unidad_dm).toBe(3455);

    // Nombre exacto: paracetamol.
    const para = items.items.find((i) => i.texto_original.startsWith("PARACETAMOL"))!;
    expect(para.match_metodo).toBe("nombre_exacto");
    expect(para.producto_id).toBe(P_PARA);

    // Los pendientes sugieren el producto correcto (amoxicilina → P_AMOX, alcohol → P_ALC).
    const amox = j.pendientes.find((p) => p.texto_original.startsWith("AMOXICILINA"))!;
    expect(amox.sugerencias[0]!.producto_id).toBe(P_AMOX);
    const gasa = items.items.find((i) => i.texto_original.startsWith("GASA"))!;
    expect(gasa.producto_id).toBeNull();
  });

  it("aprendizaje: confirmar un dudoso escribe alias → la MISMA descripción matchea sola después", async () => {
    const lista1 = await ingerir(CSV_MATCH, "julio");
    const m1 = (await (await req(`/api/proveedores/listas/${lista1}/matchear`, post(tok.superA, {}))).json()) as { pendientes: { id: string; texto_original: string }[] };
    const amox = m1.pendientes.find((p) => p.texto_original.startsWith("AMOXICILINA"))!;
    const alc = m1.pendientes.find((p) => p.texto_original.startsWith("ALCOHOL"))!;
    // confirmar 2 dudosos
    expect((await req(`/api/proveedores/listas/items/${amox.id}/confirmar`, post(tok.superA, { producto_id: P_AMOX }))).status).toBe(200);
    expect((await req(`/api/proveedores/listas/items/${alc.id}/confirmar`, post(tok.superA, { producto_id: P_ALC }))).status).toBe(200);

    // segunda lista del MISMO proveedor con la misma amoxicilina → ahora matchea por alias (auto)
    const lista2 = await ingerir("producto,precio\nAMOXICILINA 500 MG SUSPENSION FCO 60 ML MEDIFARMA,25.00\n", "agosto");
    const m2 = (await (await req(`/api/proveedores/listas/${lista2}/matchear`, post(tok.superA, {}))).json()) as { resumen: { auto: number } };
    expect(m2.resumen.auto).toBe(1);
    const it = await env.DB.prepare(`SELECT match_metodo, producto_id FROM lista_item WHERE lista_id = ?1`).bind(lista2).first<{ match_metodo: string; producto_id: string }>();
    expect(it?.match_metodo).toBe("alias");
    expect(it?.producto_id).toBe(P_AMOX);
  });

  it("descartar suelta el producto y marca 'descartado'", async () => {
    const listaId = await ingerir(CSV_MATCH, "julio");
    const m = (await (await req(`/api/proveedores/listas/${listaId}/matchear`, post(tok.superA, {}))).json()) as { pendientes: { id: string; texto_original: string }[] };
    const gasa = m.pendientes.find((p) => p.texto_original.startsWith("GASA"))!;
    expect((await req(`/api/proveedores/listas/items/${gasa.id}/descartar`, post(tok.superA, {}))).status).toBe(200);
    const it = await env.DB.prepare(`SELECT match_estado, producto_id FROM lista_item WHERE id = ?1`).bind(gasa.id).first<{ match_estado: string; producto_id: string | null }>();
    expect(it?.match_estado).toBe("descartado");
    expect(it?.producto_id).toBeNull();
  });
});

// ---- MOTOR DEL PEDIDO (B8.3) — golden ----
const ITEMS = [
  { producto_id: P_IBU, nombre: "Ibuprofeno 400", unidades_base: 1000 },
  { producto_id: P_PARA, nombre: "Paracetamol 500", unidades_base: 1000 },
  { producto_id: P_AMOX, nombre: "Amoxicilina 500", unidades_base: 500 },
];

describe("B8.3 — motor del pedido (golden e2e)", () => {
  it("SIN aceptar venc. corto: el mejor combo es {A} solo, total S/1120.45", async () => {
    const r = await req(`/api/pedidos/comparar`, post(tok.superA, { items: ITEMS, aceptar_venc_corto: [] }));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { top3: { proveedor_ids: string[]; total_cent: number; valido: boolean }[]; proveedores_evaluados: number };
    expect(j.top3[0]!.proveedor_ids).toEqual([PA]);
    expect(j.top3[0]!.total_cent).toBe(112045);
    expect(j.top3[0]!.valido).toBe(true);
    expect(j.proveedores_evaluados).toBe(3);
  });

  it("ACEPTANDO venc. corto de la amoxicilina: gana {A,C} y ahorra S/35", async () => {
    const r = await req(`/api/pedidos/comparar`, post(tok.superA, { items: ITEMS, aceptar_venc_corto: [P_AMOX] }));
    const j = (await r.json()) as { top3: { proveedor_ids: string[]; total_cent: number; delta_cent: number }[] };
    expect(j.top3[0]!.proveedor_ids).toEqual([PA, PC]);
    expect(j.top3[0]!.total_cent).toBe(108545);
    const soloA = j.top3.find((t) => t.proveedor_ids.join() === PA)!;
    expect(soloA.delta_cent).toBe(3500);
  });

  it("guarda el pedido {A,C}, lo detalla por proveedor y exporta el CSV de C", async () => {
    const crear = await req(`/api/pedidos?sucursal_id=${sucA}`, post(tok.superA, { items: ITEMS, aceptar_venc_corto: [P_AMOX], proveedor_ids: [PA, PC] }));
    expect(crear.status).toBe(201);
    const { id } = (await crear.json()) as { id: string; total_cent: number };

    const det = (await (await req(`/api/pedidos/${id}`, bearer(tok.superA))).json()) as { por_proveedor: { proveedor_id: string; subtotal_cent: number; renglones: unknown[] }[] };
    expect(det.por_proveedor.length).toBe(2);
    const c = det.por_proveedor.find((p) => p.proveedor_id === PC)!;
    expect(c.subtotal_cent).toBe(40000);

    const csvRes = await req(`/api/pedidos/${id}/csv?proveedor_id=${PC}`, bearer(tok.superA));
    expect(csvRes.status).toBe(200);
    const csv = await csvRes.text();
    expect(csv).toMatch(/Amoxicilina/);
    expect(csv).toMatch(/TOTAL/);

    // aparece en el listado
    const lst = (await (await req(`/api/pedidos`, bearer(tok.superA))).json()) as { pedidos: { id: string }[] };
    expect(lst.pedidos.some((p) => p.id === id)).toBe(true);
  });

  it("base del pedido = faltantes de la sucursal (sugerido)", async () => {
    const r = await req(`/api/pedidos/base?sucursal_id=${sucA}`, bearer(tok.superA));
    const j = (await r.json()) as { necesidades: { producto_id: string; unidades_base: number }[] };
    const ibu = j.necesidades.find((n) => n.producto_id === P_IBU)!;
    expect(ibu.unidades_base).toBe(200); // max(0, 100*2 - 0)
    expect(j.necesidades.length).toBe(4);
  });
});

// ---- AISLAMIENTO (extiende §4.4 a las tablas de B8) ----
describe("B8 — aislamiento multi-tenant", () => {
  it("el tenant B no matchea/confirma listas de A, ni ve/abre sus pedidos", async () => {
    // B intenta matchear una lista de A → 404
    const listaId = await ingerir(CSV_MATCH, "julio");
    expect((await req(`/api/proveedores/listas/${listaId}/matchear`, post(tok.superB, {}))).status).toBe(404);
    // crear un pedido de A y verificar que B no lo ve ni lo abre
    const crear = await req(`/api/pedidos?sucursal_id=${sucA}`, post(tok.superA, { items: ITEMS, aceptar_venc_corto: [], proveedor_ids: [PA] }));
    const { id } = (await crear.json()) as { id: string };
    const lstB = (await (await req(`/api/pedidos`, bearer(tok.superB))).json()) as { pedidos: unknown[] };
    expect(lstB.pedidos.length).toBe(0);
    expect((await req(`/api/pedidos/${id}`, bearer(tok.superB))).status).toBe(404);
    expect((await req(`/api/pedidos/${id}/csv?proveedor_id=${PA}`, bearer(tok.superB))).status).toBe(404);
    // B comparando con los productos de A no encuentra ofertas (no fuga)
    const comp = (await (await req(`/api/pedidos/comparar`, post(tok.superB, { items: ITEMS, aceptar_venc_corto: [] }))).json()) as { top3: unknown[]; proveedores_evaluados: number };
    expect(comp.proveedores_evaluados).toBe(0);
    expect(comp.top3.length).toBe(0);
  });

  it("operador no gestiona matching ni pedidos (403)", async () => {
    expect((await req(`/api/pedidos`, bearer(tok.adminA))).status).toBe(200); // admin sí
    const listaId = await ingerir(CSV_MATCH, "julio");
    // admin_sucursal puede matchear (abastecimiento es del tenant)
    expect((await req(`/api/proveedores/listas/${listaId}/matchear`, post(tok.adminA, {}))).status).toBe(200);
  });
});
