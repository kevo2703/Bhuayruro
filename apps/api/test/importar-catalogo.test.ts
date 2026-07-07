import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// Importador de catálogo en lote (T-K4). HTTP real contra el Worker; fixture sintético.
// Cubre: dry-run sin escribir, commit de productos nuevos (dinero/lote/blíster), producto compartido
// (omitido vs agregado-a-sucursal), rechazos, aislamiento por sucursal, purga del seed demo, roles.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";
const T = "t-h", sV = "s-ves", sC = "s-chz";
const T2 = "t-otro", sX = "s-otro"; // otro tenant + sucursal (aislamiento)
const uOper = "u-oper", uAdmin = "u-admin", uAdminC = "u-admin-c", uSuper = "u-super";
const tok = { oper: "tok-oper", admin: "tok-admin", adminC: "tok-admin-c", super: "tok-super" };

const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown): RequestInit => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const req = (path: string, init?: RequestInit) => app.request(path, init, env);
const num = (v: string, sql: string, ...bind: unknown[]) =>
  env.DB.prepare(sql).bind(...bind).first<Record<string, number>>().then((r) => r?.[v] ?? null);
const json = async (r: Response) => (await r.json()) as any;

const CAB =
  "nombre,codigo_barras,laboratorio,principio_activo,categoria,presentacion_texto,requiere_receta,es_cronico,precio_compra,precio_venta,stock_inicial,stock_minimo,numero_lote,fecha_vencimiento,blister_nombre,blister_factor,blister_precio_venta,blister_codigo_barras";
const IBU = "Ibuprofeno 400 mg,7799000000015,Genfar,Ibuprofeno 400 mg,Antiinflamatorio,Tableta,no,no,0.90,1.80,100,20,L-1,2027-03-31,Blíster x10,10,17.00,7799000000022";
const PARA = "Paracetamol 500 mg,7799000000039,Genérico,Paracetamol 500 mg,Analgésico,Tableta,no,no,0.75,1.50,200,30,,,,,,";
const CSV2 = `${CAB}\n${IBU}\n${PARA}\n`;

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of [
    "audit_log", "evento_caja", "movimiento_stock", "venta_item_lote", "venta_item", "venta",
    "quiebre", "cierre_caja", "recepcion", "lote", "inventario_local", "precio_local", "codigo_barras",
    "producto_fts", "presentacion", "producto_catalogo", "sesion", "usuario_perfil", "sucursal", "tenant",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  const hOper = await hashToken(tok.oper), hAdmin = await hashToken(tok.admin), hAdminC = await hashToken(tok.adminC), hSuper = await hashToken(tok.super);
  const PW = "pbkdf2$100000$c2FsdA==$aGFzaA==";
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T','H',?2,?2)`).bind(T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'VES',?3,?3)`).bind(sV, T, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Chazuta',?3,?3)`).bind(sC, T, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'operador','O','o@h.local',?4,?5,?5)`).bind(uOper, T, sV, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'admin_sucursal','A','a@h.local',?4,?5,?5)`).bind(uAdmin, T, sV, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,?3,'admin_sucursal','AC','ac@h.local',?4,?5,?5)`).bind(uAdminC, T, sC, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES (?1,?2,NULL,'super_admin','S','s@h.local',?3,?4,?4)`).bind(uSuper, T, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('so',?1,?2,?3,?4)`).bind(uOper, hOper, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('sa',?1,?2,?3,?4)`).bind(uAdmin, hAdmin, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('sac',?1,?2,?3,?4)`).bind(uAdminC, hAdminC, TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('ss',?1,?2,?3,?4)`).bind(uSuper, hSuper, TS, FUTURO),
    // Segundo tenant + sucursal (para probar aislamiento cross-tenant del super).
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'T2','H2',?2,?2)`).bind(T2, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Otra',?3,?3)`).bind(sX, T2, TS),
  ]);
}

beforeEach(async () => {
  await sembrar();
});

describe("importador — dry-run", () => {
  it("previsualiza (dinero correcto) sin escribir nada", async () => {
    const dr = await json(await req(`/api/catalogo/importar?dry_run=1&sucursal_id=${sV}`, post(tok.super, { csv: CSV2 })));
    expect(dr.dry_run).toBe(true);
    expect(dr.resumen.validas).toBe(2);
    expect(dr.resumen.con_blister).toBe(1);
    expect(dr.resumen.con_lote).toBe(1);
    // dinero: Ibuprofeno pvp 1.80 → sin_igv 15254 (= seed)
    const ibu = dr.muestra.find((m: any) => m.nombre.startsWith("Ibuprofeno"));
    expect(ibu.precio_venta_publico_dm).toBe(18000);
    expect(ibu.precio_sin_igv_dm).toBe(15254);
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo`)).toBe(0);
  });

  it("dos dry-runs seguidos no crean productos", async () => {
    await req(`/api/catalogo/importar?dry_run=1&sucursal_id=${sV}`, post(tok.super, { csv: CSV2 }));
    await req(`/api/catalogo/importar?dry_run=1&sucursal_id=${sV}`, post(tok.super, { csv: CSV2 }));
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo`)).toBe(0);
  });
});

describe("importador — commit de productos nuevos", () => {
  it("crea 2 productos con presentaciones, códigos, precios, inventario y lote correctos", async () => {
    const r = await json(await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv: CSV2 })));
    expect(r.creados).toBe(2);
    expect(r.fallidos).toHaveLength(0);
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo`)).toBe(2);
    // Ibuprofeno tiene 2 presentaciones (base + blíster) y 2 códigos de barras; Paracetamol 1 y 1.
    expect(await num("c", `SELECT COUNT(*) c FROM presentacion`)).toBe(3); // ibu base+blister, para base
    expect(await num("c", `SELECT COUNT(*) c FROM codigo_barras`)).toBe(3); // ibu base+blister, para base
    expect(await num("c", `SELECT COUNT(*) c FROM lote`)).toBe(1); // solo ibu trae lote
    // Precio de Ibuprofeno base (§6): sin_igv 15254, igv 2746, total 18000.
    const precio = await env.DB.prepare(
      `SELECT precio_sin_igv_dm s, igv_dm i, precio_total_dm t, precio_compra_dm c FROM precio_local pl
       JOIN producto_catalogo p ON p.id=pl.producto_id JOIN presentacion pr ON pr.id=pl.presentacion_id
       WHERE p.nombre='Ibuprofeno 400 mg' AND pr.es_base=1`,
    ).first<{ s: number; i: number; t: number; c: number }>();
    expect(precio).toMatchObject({ s: 15254, i: 2746, t: 18000, c: 9000 });
    // Precio del blíster (pvp 17.00): sin_igv = round(1700000/118)=144068.
    const pb = await num("s", `SELECT pl.precio_sin_igv_dm s FROM precio_local pl JOIN presentacion pr ON pr.id=pl.presentacion_id WHERE pr.es_base=0`);
    expect(pb).toBe(144068);
  });

  it("el producto importado es vendible: el escáner devuelve su precio", async () => {
    await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv: CSV2 }));
    const barcode = await json(await req(`/api/catalogo/barcode/7799000000015?sucursal_id=${sV}`, bearer(tok.super)));
    expect(barcode.producto.nombre).toBe("Ibuprofeno 400 mg");
    expect(barcode.producto.precio_total_dm).toBe(18000);
  });

  it("admin_sucursal importa a SU sucursal (sin pasar sucursal_id)", async () => {
    const r = await json(await req(`/api/catalogo/importar`, post(tok.admin, { csv: `${CAB}\n${PARA}` })));
    expect(r.creados).toBe(1);
    expect(r.sucursal_id).toBe(sV);
    expect(await num("c", `SELECT COUNT(*) c FROM inventario_local WHERE sucursal_id=?1`, sV)).toBe(1);
  });

  it("re-importar el mismo archivo es idempotente (2da vez: todo omitido)", async () => {
    const a = await json(await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv: CSV2 })));
    expect(a.creados).toBe(2);
    const b = await json(await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv: CSV2 })));
    expect(b.creados).toBe(0);
    expect(b.omitidos).toBe(2);
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo`)).toBe(2);
  });
});

describe("importador — catálogo compartido (multi-sucursal)", () => {
  // Producto ya en el catálogo, con inventario en VES pero NO en Chazuta.
  async function sembrarCompartido() {
    const G = "7799000000015";
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES ('pC',?1,'Ibuprofeno 400 mg',?2,?2)`).bind(T, TS),
      env.DB.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES ('prC','pC','unidad',1,1,?1)`).bind(TS),
      env.DB.prepare(`INSERT INTO codigo_barras (id,producto_id,presentacion_id,gtin,created_at) VALUES ('cbC','pC','prC',?1,?2)`).bind(G, TS),
      env.DB.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES ('invC',?1,'pC',50,10,?2)`).bind(sV, TS),
      env.DB.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('plC','pC',?1,'prC',15254,2746,18000,?2,?2)`).bind(sV, TS),
    ]);
  }

  it("VES ya lo vende → omitido; NO crea producto duplicado", async () => {
    await sembrarCompartido();
    const r = await json(await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv: `${CAB}\n${IBU}` })));
    expect(r.omitidos).toBe(1);
    expect(r.creados).toBe(0);
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo WHERE nombre='Ibuprofeno 400 mg'`)).toBe(1);
  });

  it("Chazuta aún no lo vende → agrega precio+stock a SU sucursal sin duplicar el producto", async () => {
    await sembrarCompartido();
    const r = await json(await req(`/api/catalogo/importar?sucursal_id=${sC}`, post(tok.adminC, { csv: `${CAB}\n${IBU}` })));
    expect(r.agregados).toBe(1);
    expect(r.creados).toBe(0);
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo`)).toBe(1); // compartido
    expect(await num("c", `SELECT COUNT(*) c FROM precio_local WHERE producto_id='pC' AND sucursal_id=?1`, sC)).toBe(1);
    expect(await num("s", `SELECT stock_unidades s FROM inventario_local WHERE producto_id='pC' AND sucursal_id=?1`, sC)).toBe(100);
    // el blíster se ignora en producto existente (nota informativa)
    expect(r.notas.some((n: any) => /blíster ignorado/.test(n.nota))).toBe(true);
  });
});

describe("importador — validación y roles", () => {
  it("filas inválidas van a rechazadas; las válidas se importan", async () => {
    const csv = `${CAB}\n${PARA}\nMalo,,,,,,,,,abc,,,,,,,,`;
    const r = await json(await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv })));
    expect(r.creados).toBe(1);
    expect(r.rechazadas).toHaveLength(1);
    expect(r.rechazadas[0].motivos.join()).toMatch(/precio_venta inválido/);
  });

  it("falta columna obligatoria → 400", async () => {
    const r = await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv: "nombre\nX" }));
    expect(r.status).toBe(400);
  });

  it("super sin sucursal_id → 400", async () => {
    const r = await req(`/api/catalogo/importar`, post(tok.super, { csv: CSV2 }));
    expect(r.status).toBe(400);
  });

  it("operador no puede importar → 403", async () => {
    const r = await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.oper, { csv: CSV2 }));
    expect(r.status).toBe(403);
  });

  it("plantilla se descarga como CSV", async () => {
    const r = await req(`/api/catalogo/importar/plantilla`, bearer(tok.admin));
    expect(r.headers.get("content-type")).toContain("text/csv");
    const t = await r.text();
    expect(t.split(/\r?\n/)[0]).toContain("precio_venta");
  });
});

describe("importador — atomicidad", () => {
  it("una fila que choca por GTIN de blíster con un código existente falla SOLA (sin escritura parcial)", async () => {
    // Código existente en otro producto, igual al blíster del IBU importado.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES ('pX',?1,'Otro',?2,?2)`).bind(T, TS),
      env.DB.prepare(`INSERT INTO codigo_barras (id,producto_id,gtin,created_at) VALUES ('cbX','pX','7799000000022',?1)`).bind(TS),
    ]);
    const r = await json(await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv: `${CAB}\n${IBU}\n${PARA}` })));
    expect(r.creados).toBe(1); // Paracetamol sí
    expect(r.fallidos).toHaveLength(1); // Ibuprofeno choca por el GTIN de su blíster
    expect(r.fallidos[0].nombre).toBe("Ibuprofeno 400 mg");
    // el producto fallido NO quedó a medias
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo WHERE nombre='Ibuprofeno 400 mg'`)).toBe(0);
  });
});

describe("importador — purga del catálogo demo (seed sintético)", () => {
  async function sembrarDemo() {
    const D = "30000000-0000-7000-8000-000100000000"; // marcador de seed §5.6
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Demo Postday',?3,?3)`).bind(D, T, TS),
      env.DB.prepare(`INSERT INTO presentacion (id,producto_id,nombre,factor_unidades,es_base,created_at) VALUES ('prD',?1,'unidad',1,1,?2)`).bind(D, TS),
      env.DB.prepare(`INSERT INTO codigo_barras (id,producto_id,presentacion_id,gtin,created_at) VALUES ('cbD',?1,'prD','111',?2)`).bind(D, TS),
      env.DB.prepare(`INSERT INTO inventario_local (id,sucursal_id,producto_id,stock_unidades,stock_minimo,updated_at) VALUES ('invD',?1,?2,50,10,?3)`).bind(sV, D, TS),
      env.DB.prepare(`INSERT INTO lote (id,inventario_id,numero_lote,fecha_vencimiento,unidades,fecha_recepcion,created_at,updated_at) VALUES ('loD','invD','L','2027-01-01',50,?1,?1,?1)`).bind(TS),
      env.DB.prepare(`INSERT INTO precio_local (id,producto_id,sucursal_id,presentacion_id,precio_sin_igv_dm,igv_dm,precio_total_dm,vigente_desde,created_at) VALUES ('plD',?1,?2,'prD',127119,22881,150000,?3,?3)`).bind(D, sV, TS),
      // producto REAL (no demo) que debe sobrevivir
      env.DB.prepare(`INSERT INTO producto_catalogo (id,tenant_id,nombre,created_at,updated_at) VALUES ('real1',?1,'Real',?2,?2)`).bind(T, "2026-07-06T10:00:00.000Z"),
    ]);
  }

  it("cuenta y purga solo el catálogo demo; el producto real sobrevive", async () => {
    await sembrarDemo();
    const conteo = await json(await req(`/api/catalogo/demo/conteo`, bearer(tok.super)));
    expect(conteo.productos).toBe(1);
    const purga = await json(await req(`/api/catalogo/demo/purgar`, post(tok.super, {})));
    expect(purga.ok).toBe(true);
    expect(purga.productos).toBe(1);
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo`)).toBe(1); // solo el real
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo WHERE id='real1'`)).toBe(1);
    expect(await num("c", `SELECT COUNT(*) c FROM lote`)).toBe(0);
    expect(await num("c", `SELECT COUNT(*) c FROM precio_local`)).toBe(0);
  });

  it("purga es solo-super (admin → 403)", async () => {
    expect((await req(`/api/catalogo/demo/purgar`, post(tok.admin, {}))).status).toBe(403);
  });
});

describe("importador — endurecimiento adversarial", () => {
  it("F6: re-importar productos SIN código es idempotente (dedup por nombre, no duplica)", async () => {
    const csv = "nombre,precio_venta,stock_inicial\nGasa esteril,3.00,50\nAlgodon hidrofilo,2.00,30";
    const a = await json(await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv })));
    expect(a.creados).toBe(2);
    const b = await json(await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv })));
    expect(b.creados).toBe(0);
    expect(b.omitidos).toBe(2);
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo`)).toBe(2);
  });

  it("F9: super NO puede importar a una sucursal de otro tenant → 404 (sin escritura)", async () => {
    const r = await req(`/api/catalogo/importar?sucursal_id=${sX}`, post(tok.super, { csv: CSV2 }));
    expect(r.status).toBe(404);
    expect(await num("c", `SELECT COUNT(*) c FROM producto_catalogo WHERE tenant_id=?1`, T2)).toBe(0);
  });

  it("F3: nombre con fórmula se neutraliza en el CSV de faltantes (anti-inyección)", async () => {
    await req(`/api/catalogo/importar?sucursal_id=${sV}`, post(tok.super, { csv: "nombre,precio_venta,stock_inicial,stock_minimo\n=cmd|calc,2.00,0,5" }));
    const csvRes = await req(`/api/consolidado/faltantes.csv`, bearer(tok.super));
    const text = await csvRes.text();
    expect(text).toContain("'=cmd|calc"); // prefijo apóstrofo neutraliza la fórmula en Excel
  });
});
