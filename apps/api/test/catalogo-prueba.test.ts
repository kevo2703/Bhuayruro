import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// B10.4.1 — Catálogo de PRUEBA: promueve el maestro (SUSALUD, medicamentos) a productos con 100u de
// stock, marcados es_prueba=1, para que el matcher del audio tenga contra qué pegar durante el piloto.
// Gated (admin+), paginado (keyset), idempotente por GTIN, purgable por flag, aislado por tenant.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";
const TA = "t-a";
const TB = "t-b";
const sucA = "suc-a";
const sucB = "suc-b";
const tok = { adminA: "cp-admin-a", superA: "cp-super-a", adminB: "cp-admin-b" };

const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown): RequestInit => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

// Fila del maestro (data pública, global). id ordenable para el keyset de la paginación.
async function seedMaestro(id: string, gtin: string, nombre: string, dci: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalogo_maestro (id, gtin, nombre, dci, forma_simple, laboratorio, presentacion, nombre_norm)
     VALUES (?1, ?2, ?3, ?4, 'Tableta', 'LabX', 'Caja x 100', ?5)`,
  ).bind(id, gtin, nombre, dci, nombre.toLowerCase()).run();
}

// Producto REAL del tenant (es_prueba=0) — para verificar que la purga de prueba NO lo toca.
async function seedProductoReal(id: string, tenant: string, nombre: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO producto_catalogo (id, tenant_id, nombre, es_prueba, created_at, updated_at) VALUES (?1,?2,?3,0,?4,?4)`,
  ).bind(id, tenant, nombre, TS).run();
}

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of ["lote", "precio_local", "inventario_local", "codigo_barras", "producto_fts", "presentacion", "producto_catalogo", "catalogo_maestro", "sesion", "usuario_perfil", "sucursal", "tenant"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  const PW = "pbkdf2$100000$c2FsdA==$aGFzaA==";
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'A','Huayruro',?2,?2)`).bind(TA, TS),
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'B','Otra',?2,?2)`).bind(TB, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'VES',?3,?3)`).bind(sucA, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ajena',?3,?3)`).bind(sucB, TB, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-a',?1,NULL,'super_admin','SuperA','sa@h.local',?2,?3,?3)`).bind(TA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-a',?1,?2,'admin_sucursal','AdminA','aa@h.local',?3,?4,?4)`).bind(TA, sucA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-b',?1,?2,'admin_sucursal','AdminB','ab@h.local',?3,?4,?4)`).bind(TB, sucB, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s0','u-super-a',?1,?2,?3)`).bind(await hashToken(tok.superA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s1','u-admin-a',?1,?2,?3)`).bind(await hashToken(tok.adminA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s2','u-admin-b',?1,?2,?3)`).bind(await hashToken(tok.adminB), TS, FUTURO),
  ]);
  // Maestro: 3 medicamentos con GTIN (ids ordenables para el keyset).
  await seedMaestro("m-001", "7750001000018", "IBUPROFENO 400MG", "ibuprofeno");
  await seedMaestro("m-002", "7750001000025", "PARACETAMOL 500MG", "paracetamol");
  await seedMaestro("m-003", "7750001000032", "AMOXICILINA 500MG", "amoxicilina");
}

beforeEach(async () => {
  await sembrar();
});

describe("B10.4.1 — conteo", () => {
  it("reporta el techo del maestro y 0 productos de prueba al inicio", async () => {
    const r = (await (await req("/api/catalogo/prueba/conteo", bearer(tok.adminA))).json()) as { productos_prueba: number; total_maestro: number };
    expect(r).toMatchObject({ productos_prueba: 0, total_maestro: 3 });
  });
});

describe("B10.4.1 — carga (promoción del maestro)", () => {
  it("promueve el maestro completo: producto es_prueba=1 + presentación + 100u + lote + precio + código; FTS lo encuentra", async () => {
    const r = (await (await req("/api/catalogo/prueba/cargar", post(tok.adminA, { cantidad: 250 }))).json()) as { creados: number; omitidos: number; siguiente_desde: string | null; total_maestro: number };
    expect(r).toMatchObject({ creados: 3, omitidos: 0, siguiente_desde: null, total_maestro: 3 });

    // Estructura completa de UN producto promovido (por su GTIN).
    const prod = await env.DB.prepare(
      `SELECT p.id, p.es_prueba, p.nombre FROM producto_catalogo p JOIN codigo_barras cb ON cb.producto_id = p.id WHERE cb.gtin='7750001000018' AND p.tenant_id=?1`,
    ).bind(TA).first<{ id: string; es_prueba: number; nombre: string }>();
    expect(prod).toMatchObject({ es_prueba: 1, nombre: "IBUPROFENO 400MG" });
    const pid = prod!.id;
    expect((await env.DB.prepare(`SELECT stock_unidades FROM inventario_local WHERE producto_id=?1 AND sucursal_id=?2`).bind(pid, sucA).first<{ stock_unidades: number }>())?.stock_unidades).toBe(100);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM lote l JOIN inventario_local i ON i.id=l.inventario_id WHERE i.producto_id=?1`).bind(pid).first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM precio_local WHERE producto_id=?1`).bind(pid).first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM presentacion WHERE producto_id=?1 AND es_base=1`).bind(pid).first<{ n: number }>())?.n).toBe(1);

    // El matcher del audio (FTS) lo encuentra por su nombre.
    const fts = await env.DB.prepare(
      `SELECT p.id FROM producto_fts f JOIN producto_catalogo p ON p.id=f.producto_id WHERE producto_fts MATCH 'ibuprofeno*' AND p.tenant_id=?1`,
    ).bind(TA).first<{ id: string }>();
    expect(fts?.id).toBe(pid);
  });

  it("paginación por keyset: cargar de a 2 recorre todo sin repetir", async () => {
    const p1 = (await (await req("/api/catalogo/prueba/cargar", post(tok.adminA, { cantidad: 2 }))).json()) as { creados: number; siguiente_desde: string | null };
    expect(p1.creados).toBe(2);
    expect(p1.siguiente_desde).toBe("m-002"); // último id leído (página llena → hay más)
    const p2 = (await (await req("/api/catalogo/prueba/cargar", post(tok.adminA, { desde: p1.siguiente_desde, cantidad: 2 }))).json()) as { creados: number; siguiente_desde: string | null };
    expect(p2.creados).toBe(1);
    expect(p2.siguiente_desde).toBeNull(); // página incompleta → fin
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM producto_catalogo WHERE tenant_id=?1 AND es_prueba=1`).bind(TA).first<{ n: number }>())?.n).toBe(3);
  });

  it("idempotente: re-cargar salta los GTIN ya presentes (creados=0, omitidos=3)", async () => {
    await req("/api/catalogo/prueba/cargar", post(tok.adminA, { cantidad: 250 }));
    const r2 = (await (await req("/api/catalogo/prueba/cargar", post(tok.adminA, { cantidad: 250 }))).json()) as { creados: number; omitidos: number };
    expect(r2).toMatchObject({ creados: 0, omitidos: 3 });
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM producto_catalogo WHERE tenant_id=?1`).bind(TA).first<{ n: number }>())?.n).toBe(3);
  });

  it("dedup con >99 GTIN: carga 101 medicamentos (gtinsExistentes trocea 99+2) y re-cargar los salta todos", async () => {
    // sembrar() dejó 3; agregamos 98 → 101 para CRUZAR el borde de troceo (99) del dedup, que en la D1
    // remota tiene tope de 100 binds/query. Verifica que el chunking produce el resultado correcto.
    for (let i = 0; i < 98; i++) {
      const n = String(i).padStart(3, "0");
      await seedMaestro(`extra-${n}`, `GTIN-${n}`, `MED ${n}`, `med ${n}`);
    }
    const conteo = (await (await req("/api/catalogo/prueba/conteo", bearer(tok.adminA))).json()) as { total_maestro: number };
    expect(conteo.total_maestro).toBe(101);
    const r = (await (await req("/api/catalogo/prueba/cargar", post(tok.adminA, { cantidad: 250 }))).json()) as { creados: number; omitidos: number };
    expect(r).toMatchObject({ creados: 101, omitidos: 0 }); // el dedup cruzó 2 trozos (99 + 2) sin error
    const r2 = (await (await req("/api/catalogo/prueba/cargar", post(tok.adminA, { cantidad: 250 }))).json()) as { creados: number; omitidos: number };
    expect(r2).toMatchObject({ creados: 0, omitidos: 101 }); // idempotencia a través de los trozos
  });

  it("no duplica un GTIN que el tenant ya tiene como producto REAL (respeta el catálogo real)", async () => {
    // El tenant ya tiene ibuprofeno real con ese GTIN.
    await seedProductoReal("p-real", TA, "Ibuprofeno real");
    await env.DB.prepare(`INSERT INTO codigo_barras (id,producto_id,gtin,es_unidad,created_at) VALUES ('cb-real','p-real','7750001000018',1,?1)`).bind(TS).run();
    const r = (await (await req("/api/catalogo/prueba/cargar", post(tok.adminA, { cantidad: 250 }))).json()) as { creados: number; omitidos: number };
    expect(r).toMatchObject({ creados: 2, omitidos: 1 }); // saltó el GTIN del producto real
  });
});

describe("B10.4.1 — purga (solo super) + aislamiento", () => {
  it("purgar borra SOLO los productos de prueba; el catálogo real queda intacto", async () => {
    await seedProductoReal("p-real", TA, "Producto real que se queda");
    await req("/api/catalogo/prueba/cargar", post(tok.adminA, { cantidad: 250 }));
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM producto_catalogo WHERE tenant_id=?1`).bind(TA).first<{ n: number }>())?.n).toBe(4);

    const r = await req("/api/catalogo/prueba/purgar", post(tok.superA, {}));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, productos: 3 });
    // Solo queda el real; lo de prueba (y su inventario/lote/precio/código/fts) se fue.
    const quedan = await env.DB.prepare(`SELECT id, es_prueba FROM producto_catalogo WHERE tenant_id=?1`).bind(TA).all<{ id: string; es_prueba: number }>();
    expect(quedan.results.map((x) => x.id)).toEqual(["p-real"]);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM inventario_local`).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM lote`).first<{ n: number }>())?.n).toBe(0);
  });

  it("purga es solo-super (un admin no puede: 403)", async () => {
    expect((await req("/api/catalogo/prueba/purgar", post(tok.adminA, {}))).status).toBe(403);
  });

  it("aislamiento: la carga del admin A no crea nada en el tenant B", async () => {
    await req("/api/catalogo/prueba/cargar", post(tok.adminA, { cantidad: 250 }));
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM producto_catalogo WHERE tenant_id=?1`).bind(TB).first<{ n: number }>())?.n).toBe(0);
    // Y el admin B ve 0 productos de prueba en SU tenant.
    const r = (await (await req("/api/catalogo/prueba/conteo", bearer(tok.adminB))).json()) as { productos_prueba: number };
    expect(r.productos_prueba).toBe(0);
  });
});
