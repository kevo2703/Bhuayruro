import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// GATE B7 (+ B8.1) — catálogo maestro, alta asistida y proveedores/listas.
// Fixture propio con DOS tenants: las tablas nuevas tenant-scoped (proveedor,
// lista_precios, lista_item) exigen su test de aislamiento (plan §2.3 D-N7).
// El maestro es GLOBAL a propósito: mismo resultado para ambos tenants.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";

const TA = "t-a";
const TB = "t-b";
const sucA = "suc-a";
const sucB = "suc-b";

const tok = { superA: "tok-super-a", superB: "tok-super-b", adminA: "tok-admin-a", operA: "tok-oper-a" };

const M1 = "maestro-1"; // IBUPROFENO con GTIN
const GTIN_M1 = "7750100000015";

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
  for (const t of [
    "lista_item", "lista_precios", "producto_alias", "pedido_item", "pedido", "proveedor",
    "sesion", "codigo_barras", "presentacion", "producto_catalogo", "usuario_perfil",
    "sucursal", "tenant", "catalogo_maestro",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }

  const PW = "pbkdf2$310000$c2FsdA==$aGFzaA=="; // placeholder: los tests van por token
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'A','Huayruro',?2,?2)`).bind(TA, TS),
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'B','Otra Botica',?2,?2)`).bind(TB, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'VES',?3,?3)`).bind(sucA, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ajena',?3,?3)`).bind(sucB, TB, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-a',?1,NULL,'super_admin','SuperA','sa@h.local',?2,?3,?3)`).bind(TA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-b',?1,NULL,'super_admin','SuperB','sb@h.local',?2,?3,?3)`).bind(TB, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-a',?1,?2,'admin_sucursal','AdminA','aa@h.local',?3,?4,?4)`).bind(TA, sucA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-oper-a',?1,?2,'operador','OperA','oa@h.local',?3,?4,?4)`).bind(TA, sucA, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s1','u-super-a',?1,?2,?3)`).bind(await hashToken(tok.superA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s2','u-super-b',?1,?2,?3)`).bind(await hashToken(tok.superB), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s3','u-admin-a',?1,?2,?3)`).bind(await hashToken(tok.adminA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s4','u-oper-a',?1,?2,?3)`).bind(await hashToken(tok.operA), TS, FUTURO),
    // Maestro (muestra realista de la fuente SUSALUD, MAYÚSCULAS y sin tildes en nombre):
    db.prepare(`INSERT INTO catalogo_maestro (id,gtin,nombre,dci,concentracion,forma,forma_simple,laboratorio,pais,presentacion,unidades_envase,situacion,registro_san,fuente,nombre_norm) VALUES (?1,?2,'IBUPROFENO','IBUPROFENO','400 mg','TABLETA RECUBIERTA','TABLETA','GENFAR','PERÚ','CAJA TAB',100,'ACTIVO','EG-123','susalud_gtin_v4','ibuprofeno')`).bind(M1, GTIN_M1),
    db.prepare(`INSERT INTO catalogo_maestro (id,gtin,nombre,dci,concentracion,forma,forma_simple,laboratorio,pais,presentacion,unidades_envase,situacion,registro_san,fuente,nombre_norm) VALUES ('maestro-2','7750100000022','PARACETAMOL','PARACETAMOL','500 mg','TABLETA','TABLETA','PORTUGAL','PERÚ','CAJA TAB',100,'ACTIVO','EG-124','susalud_gtin_v4','paracetamol')`),
    db.prepare(`INSERT INTO catalogo_maestro (id,gtin,nombre,dci,concentracion,forma,forma_simple,laboratorio,pais,presentacion,unidades_envase,situacion,registro_san,fuente,nombre_norm) VALUES ('maestro-3','7750100000039','AMOXICILINA','AMOXICILINA','500 mg','CAPSULA','CAPSULA','MEDIFARMA','PERÚ','CAJA CAP',100,'ACTIVO','EG-125','susalud_gtin_v4','amoxicilina')`),
    // maestro_fts es de contenido externo: tras sembrar el contenido se reconstruye el índice.
    db.prepare(`INSERT INTO maestro_fts(maestro_fts) VALUES('rebuild')`),
  ]);
}

beforeEach(async () => {
  await sembrar();
});

describe("B7 — catálogo maestro (global read-only)", () => {
  it("busca con tildes ('ibúprofeno' → IBUPROFENO, remove_diacritics)", async () => {
    const r = await req(`/api/maestro/buscar?q=${encodeURIComponent("ibúprofeno")}`, bearer(tok.adminA));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { resultados: { nombre: string; unidades_envase: number }[] };
    expect(j.resultados.length).toBe(1);
    expect(j.resultados[0]!.nombre).toBe("IBUPROFENO");
    expect(j.resultados[0]!.unidades_envase).toBe(100);
  });

  it("lookup por GTIN exacto", async () => {
    const r = await req(`/api/maestro/por-gtin/${GTIN_M1}`, bearer(tok.superA));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { producto: { id: string; dci: string; laboratorio: string } };
    expect(j.producto.id).toBe(M1);
    expect(j.producto.dci).toBe("IBUPROFENO");
    expect(j.producto.laboratorio).toBe("GENFAR");
    expect((await req("/api/maestro/por-gtin/000000000000", bearer(tok.superA))).status).toBe(404);
  });

  it("es global: ambos tenants ven lo mismo; sin sesión → 401", async () => {
    const a = (await (await req("/api/maestro/buscar?q=paracetamol", bearer(tok.superA))).json()) as { resultados: unknown[] };
    const b = (await (await req("/api/maestro/buscar?q=paracetamol", bearer(tok.superB))).json()) as { resultados: unknown[] };
    expect(a.resultados.length).toBe(1);
    expect(b.resultados.length).toBe(1);
    expect((await req("/api/maestro/buscar?q=x")).status).toBe(401);
  });
});

describe("B7.4 — alta asistida (producto nace con GTIN del maestro)", () => {
  it("POST /catalogo/productos con codigo_barras → el escáner lo encuentra", async () => {
    const r = await req(
      "/api/catalogo/productos",
      post(tok.adminA, { nombre: "Ibuprofeno 400 mg", laboratorio: "GENFAR", principio_activo: "IBUPROFENO 400 mg", presentacion: "CAJA TAB x100", codigo_barras: GTIN_M1 }),
    );
    expect(r.status).toBe(201);
    const creado = (await r.json()) as { id: string; presentacion_base_id: string };

    const scan = await req(`/api/catalogo/barcode/${GTIN_M1}`, bearer(tok.adminA));
    expect(scan.status).toBe(200);
    const j = (await scan.json()) as { producto: { producto_id: string; presentacion_id: string; factor_unidades: number } };
    expect(j.producto.producto_id).toBe(creado.id);
    expect(j.producto.presentacion_id).toBe(creado.presentacion_base_id);
    expect(j.producto.factor_unidades).toBe(1);
  });

  it("GTIN repetido → 422 y NO deja producto a medias (batch atómico)", async () => {
    await req("/api/catalogo/productos", post(tok.adminA, { nombre: "Uno", codigo_barras: GTIN_M1 }));
    const dup = await req("/api/catalogo/productos", post(tok.adminA, { nombre: "Dos", codigo_barras: GTIN_M1 }));
    expect(dup.status).toBe(422);
    const huerfano = await env.DB.prepare(`SELECT COUNT(*) AS n FROM producto_catalogo WHERE nombre='Dos'`).first<{ n: number }>();
    expect(huerfano?.n).toBe(0);
  });

  it("codigo_barras con formato inválido → 400", async () => {
    const r = await req("/api/catalogo/productos", post(tok.adminA, { nombre: "X", codigo_barras: "no válido!!" }));
    expect(r.status).toBe(400);
  });
});

const CSV_LISTA = [
  "PRODUCTO;PRESENTACION;PRECIO;BONIFICACION;VCTO;CODIGO",
  `IBUPROFENO 400MG TAB;CAJA X 100;38.00;10+1;05/2027;${GTIN_M1}`,
  "PARACETAMOL 500MG TAB;CAJA X 100;30.00;;12/2026;",
  "JARABE X 120 ML;FCO X 120 ML;12.90;;;",
].join("\n");

describe("B8.1 — proveedores y listas", () => {
  async function crearProveedor(token = tok.superA, nombre = "Droguería Lima Norte"): Promise<string> {
    const r = await req("/api/proveedores", post(token, { nombre, ruc: "20512345678", contacto: "999888777", monto_minimo_cent: 50000, flete_cent: 2500, dias_entrega: 4 }));
    expect(r.status).toBe(201);
    return ((await r.json()) as { id: string }).id;
  }

  it("CRUD: crear, listar, editar mínimo/flete, desactivar; nombre duplicado → 409", async () => {
    const id = await crearProveedor();
    const lista = (await (await req("/api/proveedores", bearer(tok.superA))).json()) as { proveedores: { id: string; monto_minimo_cent: number; activo: number }[] };
    expect(lista.proveedores.length).toBe(1);
    expect(lista.proveedores[0]!.monto_minimo_cent).toBe(50000);

    expect((await req(`/api/proveedores/${id}`, patch(tok.superA, { monto_minimo_cent: 80000, activo: false }))).status).toBe(200);
    const tras = (await (await req("/api/proveedores", bearer(tok.superA))).json()) as { proveedores: { monto_minimo_cent: number; activo: number }[] };
    expect(tras.proveedores[0]!.monto_minimo_cent).toBe(80000);
    expect(tras.proveedores[0]!.activo).toBe(0);

    expect((await req("/api/proveedores", post(tok.superA, { nombre: "Droguería Lima Norte" }))).status).toBe(409);
  });

  it("operador no gestiona proveedores → 403", async () => {
    expect((await req("/api/proveedores", bearer(tok.operA))).status).toBe(403);
    expect((await req("/api/proveedores", post(tok.operA, { nombre: "X" }))).status).toBe(403);
  });

  it("dry_run previsualiza sin escribir; commit guarda ítems con factor/bonif/venc_corto", async () => {
    const provId = await crearProveedor();

    const dry = await req(`/api/proveedores/${provId}/listas?dry_run=1`, post(tok.superA, { csv: CSV_LISTA }));
    expect(dry.status).toBe(200);
    const prev = (await dry.json()) as { dry_run: true; resumen: { validas: number; con_factor: number; con_bonif: number } };
    expect(prev.resumen.validas).toBe(3);
    expect(prev.resumen.con_factor).toBe(2); // el jarabe (120 ML) queda NULL a propósito
    expect(prev.resumen.con_bonif).toBe(1);
    const enBd = await env.DB.prepare(`SELECT COUNT(*) AS n FROM lista_precios`).first<{ n: number }>();
    expect(enBd?.n).toBe(0);

    const commit = await req(`/api/proveedores/${provId}/listas`, post(tok.superA, { csv: CSV_LISTA, etiqueta: "julio 2026", fecha_lista: "2026-07-07" }));
    expect(commit.status).toBe(201);
    const res = (await commit.json()) as { lista_id: string; insertadas: number };
    expect(res.insertadas).toBe(3);

    const items = await req(`/api/proveedores/listas/${res.lista_id}/items`, bearer(tok.superA));
    expect(items.status).toBe(200);
    const ji = (await items.json()) as { lista: { etiqueta: string; filas_total: number; estado: string }; items: { texto_original: string; factor_unidades: number | null; precio_cent: number; bonif_compra: number | null; venc_corto: number; gtin: string | null; match_estado: string }[] };
    expect(ji.lista.filas_total).toBe(3);
    expect(ji.lista.estado).toBe("borrador");

    const ibu = ji.items[0]!;
    expect(ibu.factor_unidades).toBe(100);
    expect(ibu.precio_cent).toBe(3800);
    expect(ibu.bonif_compra).toBe(10);
    expect(ibu.gtin).toBe(GTIN_M1);
    expect(ibu.match_estado).toBe("pendiente");

    // vence 12/2026 → corto con umbral 8 meses; 05/2027 según fecha de corrida no se asevera.
    const para = ji.items[1]!;
    expect(para.venc_corto).toBe(1);
    const jarabe = ji.items[2]!;
    expect(jarabe.factor_unidades).toBeNull();
    expect(jarabe.venc_corto).toBe(0);

    const listas = (await (await req("/api/proveedores/listas", bearer(tok.superA))).json()) as { listas: { proveedor_nombre: string; filas_total: number }[] };
    expect(listas.listas.length).toBe(1);
    expect(listas.listas[0]!.proveedor_nombre).toBe("Droguería Lima Norte");
  });

  it("admin_sucursal también puede (abastecimiento es del tenant, no de una botica)", async () => {
    const provId = await crearProveedor(tok.adminA, "Droguería Sur");
    const commit = await req(`/api/proveedores/${provId}/listas`, post(tok.adminA, { csv: "producto,precio\nALCOHOL 70,5.50\n", etiqueta: "test" }));
    expect(commit.status).toBe(201);
  });

  it("CSV sin columna de precio → 400 con mensaje claro", async () => {
    const provId = await crearProveedor();
    const r = await req(`/api/proveedores/${provId}/listas?dry_run=1`, post(tok.superA, { csv: "producto\nIBUPROFENO\n" }));
    expect(r.status).toBe(400);
    const j = (await r.json()) as { error: { mensaje: string } };
    expect(j.error.mensaje).toMatch(/precio/);
  });

  it("AISLAMIENTO (D-N7): proveedores/listas de un tenant invisibles para el otro", async () => {
    const provId = await crearProveedor();
    const commit = await req(`/api/proveedores/${provId}/listas`, post(tok.superA, { csv: CSV_LISTA, etiqueta: "julio" }));
    const { lista_id } = (await commit.json()) as { lista_id: string };

    // Tenant B no ve nada del tenant A…
    const deB = (await (await req("/api/proveedores", bearer(tok.superB))).json()) as { proveedores: unknown[] };
    expect(deB.proveedores.length).toBe(0);
    const listasB = (await (await req("/api/proveedores/listas", bearer(tok.superB))).json()) as { listas: unknown[] };
    expect(listasB.listas.length).toBe(0);
    // …ni puede tocarlo por id directo (fallo cerrado: 404, no 403).
    expect((await req(`/api/proveedores/${provId}`, patch(tok.superB, { activo: false }))).status).toBe(404);
    expect((await req(`/api/proveedores/${provId}/listas?dry_run=1`, post(tok.superB, { csv: CSV_LISTA }))).status).toBe(404);
    expect((await req(`/api/proveedores/${provId}/listas`, post(tok.superB, { csv: CSV_LISTA, etiqueta: "x" }))).status).toBe(404);
    expect((await req(`/api/proveedores/listas/${lista_id}/items`, bearer(tok.superB))).status).toBe(404);
  });
});
