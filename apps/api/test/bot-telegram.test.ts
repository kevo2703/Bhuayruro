import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";

// ============================================================
// GATE B9 — Bot de Telegram de inventario + bandeja de aprobación.
// Todo con updates JSON fixture (SIN Telegram real): flujo feliz por texto, foto ilegible→fallback,
// chat NO vinculado=silencio, secret inválido=401, dedup por update_id, aprobación=recepción real
// (stock+lote FEFO), rechazo no toca stock, vinculación por código, proxy R2, y AISLAMIENTO
// (borradores de una sucursal/tenant invisibles para otro admin).
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";
const SECRET = "secreto-webhook-test";

const TA = "t-a";
const TB = "t-b";
const sucA = "suc-a";
const sucA2 = "suc-a2";
const sucB = "suc-b";
const CHAT = "111"; // chat vinculado (operador A / sucursal A)

const tok = { superA: "tok-super-a", adminA: "tok-admin-a", operA: "tok-oper-a", adminA2: "tok-admin-a2", superB: "tok-super-b" };
const GTIN_M1 = "7750100000015";

const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown): RequestInit => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

// ── Fixtures de updates de Telegram ──
const tgReq = (update: unknown, secret: string | null = SECRET) =>
  app.request(
    "/api/telegram/webhook",
    { method: "POST", headers: { "Content-Type": "application/json", ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}) }, body: JSON.stringify(update) },
    env,
  );
const upText = (id: number, chat: string, text: string) => ({ update_id: id, message: { message_id: id, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat), first_name: "Papá" }, text } });
const upCb = (id: number, chat: string, data: string) => ({ update_id: id, callback_query: { id: String(id), from: { id: Number(chat), first_name: "Papá" }, message: { message_id: 1, chat: { id: Number(chat), type: "private" } }, data } });
const upPhoto = (id: number, chat: string) => ({ update_id: id, message: { message_id: id, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat), first_name: "Papá" }, photo: [{ file_id: "f-lo", file_unique_id: "u1", width: 90, height: 90 }, { file_id: "f-hi", file_unique_id: "u2", width: 800, height: 600 }] } });

type Metodo = { method?: string; text?: string; reply_markup?: unknown };
const metodo = async (r: Response): Promise<Metodo> => (await r.json()) as Metodo;

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of [
    "recepcion_borrador", "bot_vinculacion", "bot_chat", "movimiento_stock", "lote", "inventario_local", "precio_local",
    "codigo_barras", "presentacion", "producto_catalogo", "audit_log", "sesion", "dispositivo", "usuario_perfil",
    "sucursal", "tenant", "catalogo_maestro",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  const PW = "pbkdf2$310000$c2FsdA==$aGFzaA==";
  await db.batch([
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'A','Huayruro',?2,?2)`).bind(TA, TS),
    db.prepare(`INSERT INTO tenant (id,nombre,nombre_comercial,created_at,updated_at) VALUES (?1,'B','Otra',?2,?2)`).bind(TB, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'VES',?3,?3)`).bind(sucA, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Plaza',?3,?3)`).bind(sucA2, TA, TS),
    db.prepare(`INSERT INTO sucursal (id,tenant_id,nombre,created_at,updated_at) VALUES (?1,?2,'Ajena',?3,?3)`).bind(sucB, TB, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-a',?1,NULL,'super_admin','SuperA','sa@h.local',?2,?3,?3)`).bind(TA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-a',?1,?2,'admin_sucursal','AdminA','aa@h.local',?3,?4,?4)`).bind(TA, sucA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-oper-a',?1,?2,'operador','OperA','oa@h.local',?3,?4,?4)`).bind(TA, sucA, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-admin-a2',?1,?2,'admin_sucursal','AdminA2','aa2@h.local',?3,?4,?4)`).bind(TA, sucA2, PW, TS),
    db.prepare(`INSERT INTO usuario_perfil (id,tenant_id,sucursal_id,rol,nombre,email,password_hash,created_at,updated_at) VALUES ('u-super-b',?1,NULL,'super_admin','SuperB','sb@h.local',?2,?3,?3)`).bind(TB, PW, TS),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s1','u-super-a',?1,?2,?3)`).bind(await hashToken(tok.superA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s2','u-admin-a',?1,?2,?3)`).bind(await hashToken(tok.adminA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s3','u-oper-a',?1,?2,?3)`).bind(await hashToken(tok.operA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s4','u-admin-a2',?1,?2,?3)`).bind(await hashToken(tok.adminA2), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s5','u-super-b',?1,?2,?3)`).bind(await hashToken(tok.superB), TS, FUTURO),
    db.prepare(`INSERT INTO catalogo_maestro (id,gtin,nombre,dci,concentracion,forma,forma_simple,laboratorio,pais,presentacion,unidades_envase,situacion,registro_san,fuente,nombre_norm) VALUES ('m1',?1,'IBUPROFENO','IBUPROFENO','400 mg','TABLETA','TABLETA','GENFAR','PERÚ','CAJA TAB',100,'ACTIVO','EG-1','susalud_gtin_v4','ibuprofeno')`).bind(GTIN_M1),
    db.prepare(`INSERT INTO maestro_fts(maestro_fts) VALUES('rebuild')`),
    // Chat ya vinculado (operador A / sucursal A): la vinculación tiene su propio test.
    db.prepare(`INSERT INTO bot_chat (chat_id,tenant_id,usuario_id,sucursal_id,estado,borrador_json,ultimo_update_id,updated_at) VALUES (?1,?2,'u-oper-a',?3,'inicio','{}',0,?4)`).bind(CHAT, TA, sucA, TS),
  ]);

  env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  delete env.TELEGRAM_BOT_TOKEN; // sin token → las fotos caen a texto (fixtures, sin Telegram real)
}

// Crea un producto real en el catálogo del tenant A (vía API) y devuelve su id.
async function crearProductoA(nombre: string, gtin?: string): Promise<string> {
  const r = await req("/api/catalogo/productos", post(tok.adminA, { nombre, ...(gtin ? { codigo_barras: gtin } : {}) }));
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

// Inserta un borrador pendiente directamente (para aislar la lógica de la bandeja).
async function seedBorrador(id: string, sucursalId: string, payload: Record<string, unknown>): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO recepcion_borrador (id,tenant_id,sucursal_id,chat_id,payload_json,estado,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,'pendiente',?6,?6)`,
  ).bind(id, TA, sucursalId, CHAT, JSON.stringify(payload), TS).run();
}

beforeEach(async () => {
  await sembrar();
});

describe("B9 — webhook: seguridad", () => {
  it("secret inválido o ausente → 401 sin cuerpo", async () => {
    expect((await tgReq(upText(1, CHAT, "hola"), "malo")).status).toBe(401);
    expect((await tgReq(upText(1, CHAT, "hola"), null)).status).toBe(401);
  });

  it("chat NO vinculado → silencio total (200 vacío, sin crear bot_chat)", async () => {
    const r = await tgReq(upText(1, "999", "hola, ¿precios?"));
    expect(r.status).toBe(200);
    expect(await metodo(r)).toEqual({}); // ni un mensaje: no confirmamos que el bot existe
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bot_chat WHERE chat_id='999'`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

describe("B9 — webhook: flujo feliz por texto crea un borrador", () => {
  it("recorre producto→lote→precio→blíster→cantidad→ubicación→enviar", async () => {
    let id = 10;
    const paso = async (u: unknown) => metodo(await tgReq(u));

    expect((await paso(upText(id++, CHAT, "/nuevo"))).text).toMatch(/foto de la CAJA/i);
    expect((await paso(upText(id++, CHAT, "Ibuprofeno 400mg Genfar"))).text).toMatch(/Entendí/i);
    expect((await paso(upCb(id++, CHAT, "ok"))).text).toMatch(/LOTE/i);
    expect((await paso(upText(id++, CHAT, "A123 / 05-2027"))).text).toMatch(/vence 2027-05/i);
    expect((await paso(upCb(id++, CHAT, "ok"))).text).toMatch(/Precio por unidad/i);
    expect((await paso(upText(id++, CHAT, "1.50"))).text).toMatch(/blíster/i);
    expect((await paso(upText(id++, CHAT, "no"))).text).toMatch(/unidades sueltas/i);
    expect((await paso(upText(id++, CHAT, "50"))).text).toMatch(/Dónde va/i);
    const resumen = await paso(upText(id++, CHAT, "estante 3, gaveta B"));
    expect(resumen.text).toMatch(/Resumen/i);
    const enviar = await paso(upCb(id++, CHAT, "enviar"));
    expect(enviar.text).toMatch(/Enviado/i);

    const b = await env.DB.prepare(`SELECT payload_json, estado FROM recepcion_borrador WHERE sucursal_id=?1 AND estado='pendiente'`).bind(sucA).first<{ payload_json: string; estado: string }>();
    expect(b).toBeTruthy();
    const p = JSON.parse(b!.payload_json) as { cantidad: number; lote: string; vencimiento: string; precio_unidad_cent: number; ubicacion: string };
    expect(p).toMatchObject({ cantidad: 50, lote: "A123", vencimiento: "2027-05-01", precio_unidad_cent: 150, ubicacion: "estante 3, gaveta B" });
  });

  it("foto ilegible (sin token) → fallback a texto, sin avanzar de estado", async () => {
    await tgReq(upText(20, CHAT, "/nuevo")); // estado = producto
    const r = await metodo(await tgReq(upPhoto(21, CHAT)));
    expect(r.text).toMatch(/no pude leer/i);
    const chat = await env.DB.prepare(`SELECT estado FROM bot_chat WHERE chat_id=?1`).bind(CHAT).first<{ estado: string }>();
    expect(chat?.estado).toBe("producto"); // se quedó pidiendo el dato
  });

  it("dedup: reenviar el MISMO update_id no duplica el borrador", async () => {
    let id = 30;
    await tgReq(upText(id++, CHAT, "/nuevo"));
    await tgReq(upText(id++, CHAT, "Paracetamol 500"));
    await tgReq(upCb(id++, CHAT, "ok"));
    await tgReq(upText(id++, CHAT, "L9 / 08-2027"));
    await tgReq(upCb(id++, CHAT, "ok"));
    await tgReq(upText(id++, CHAT, "0.90"));
    await tgReq(upText(id++, CHAT, "no"));
    await tgReq(upText(id++, CHAT, "20"));
    await tgReq(upText(id++, CHAT, "mostrador"));
    const enviarUpdate = upCb(id, CHAT, "enviar");
    await tgReq(enviarUpdate);
    const reenvio = await tgReq(enviarUpdate); // Telegram reintenta el mismo update_id
    expect(await metodo(reenvio)).toEqual({}); // deduplicado: 200 vacío
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM recepcion_borrador WHERE sucursal_id=?1`).bind(sucA).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});

describe("B9 — vinculación por código", () => {
  it("admin genera código → /vincular en el bot enlaza el chat", async () => {
    const gen = await req("/api/bot/vincular-codigo", post(tok.adminA, {}));
    expect(gen.status).toBe(201);
    const { codigo } = (await gen.json()) as { codigo: string };
    expect(codigo).toMatch(/^\d{6}$/);

    const nuevoChat = "222";
    const r = await metodo(await tgReq(upText(1, nuevoChat, `/vincular ${codigo}`)));
    expect(r.text).toMatch(/vinculado/i);
    const bc = await env.DB.prepare(`SELECT tenant_id, usuario_id, sucursal_id FROM bot_chat WHERE chat_id=?1`).bind(nuevoChat).first<{ tenant_id: string; usuario_id: string; sucursal_id: string }>();
    expect(bc).toMatchObject({ tenant_id: TA, usuario_id: "u-admin-a", sucursal_id: sucA });

    // El código ya usado no re-vincula.
    expect((await metodo(await tgReq(upText(2, "333", `/vincular ${codigo}`)))).text).toMatch(/no es válido/i);
  });
});

describe("B9 — bandeja: aprobación crea recepción real", () => {
  it("aprobar con producto del catálogo → stock + lote FEFO reales; 2ª aprobación → 409", async () => {
    const pid = await crearProductoA("Ibuprofeno 400", GTIN_M1);
    await seedBorrador("bor-1", sucA, { producto_id: pid, lote: "L1", vencimiento: "2027-05-01", cantidad: 30, precio_unidad_cent: 150, fotos: [] });

    const pend = (await (await req("/api/recepciones/pendientes", bearer(tok.adminA))).json()) as { pendientes: { id: string }[] };
    expect(pend.pendientes.length).toBe(1);

    const ap = await req("/api/recepciones/pendientes/bor-1/aprobar", post(tok.adminA, {}));
    expect(ap.status).toBe(200);
    const { recepcion_id } = (await ap.json()) as { recepcion_id: string };
    expect(recepcion_id).toBeTruthy();

    const inv = await env.DB.prepare(`SELECT stock_unidades FROM inventario_local WHERE sucursal_id=?1 AND producto_id=?2`).bind(sucA, pid).first<{ stock_unidades: number }>();
    expect(inv?.stock_unidades).toBe(30);
    const lote = await env.DB.prepare(`SELECT numero_lote, unidades, fecha_vencimiento FROM lote l JOIN inventario_local i ON i.id=l.inventario_id WHERE i.producto_id=?1`).bind(pid).first<{ numero_lote: string; unidades: number; fecha_vencimiento: string }>();
    expect(lote).toMatchObject({ numero_lote: "L1", unidades: 30, fecha_vencimiento: "2027-05-01" });

    const bor = await env.DB.prepare(`SELECT estado, recepcion_id FROM recepcion_borrador WHERE id='bor-1'`).first<{ estado: string; recepcion_id: string }>();
    expect(bor?.estado).toBe("aprobado");

    // Re-aprobar el mismo borrador → 409 (ya resuelto).
    expect((await req("/api/recepciones/pendientes/bor-1/aprobar", post(tok.adminA, {}))).status).toBe(409);
  });

  it("borrador sin producto pero con GTIN ya en catálogo → se auto-resuelve al aprobar", async () => {
    const pid = await crearProductoA("Ibuprofeno 400", GTIN_M1);
    await seedBorrador("bor-g", sucA, { gtin: GTIN_M1, lote: "LG", vencimiento: "2028-01-01", cantidad: 10 });
    const ap = await req("/api/recepciones/pendientes/bor-g/aprobar", post(tok.adminA, {}));
    expect(ap.status).toBe(200);
    expect(((await ap.json()) as { producto_id: string }).producto_id).toBe(pid);
    const inv = await env.DB.prepare(`SELECT stock_unidades FROM inventario_local WHERE sucursal_id=?1 AND producto_id=?2`).bind(sucA, pid).first<{ stock_unidades: number }>();
    expect(inv?.stock_unidades).toBe(10);
  });

  it("borrador sin producto → alta al vuelo crea el producto y la recepción", async () => {
    await seedBorrador("bor-alta", sucA, { producto_texto: "Loratadina 10mg", gtin: "7750100000099", lote: "LA", vencimiento: "2028-03-01", cantidad: 25, precio_unidad_cent: 200 });
    const ap = await req("/api/recepciones/pendientes/bor-alta/aprobar", post(tok.adminA, { nuevo_producto: { nombre: "Loratadina 10mg", codigo_barras: "7750100000099" } }));
    expect(ap.status).toBe(200);
    const { producto_id } = (await ap.json()) as { producto_id: string };
    const inv = await env.DB.prepare(`SELECT stock_unidades FROM inventario_local WHERE sucursal_id=?1 AND producto_id=?2`).bind(sucA, producto_id).first<{ stock_unidades: number }>();
    expect(inv?.stock_unidades).toBe(25);
    // Quedó vendible: precio vigente creado desde el precio capturado.
    const precio = await env.DB.prepare(`SELECT COUNT(*) AS n FROM precio_local WHERE producto_id=?1 AND vigente_hasta IS NULL`).bind(producto_id).first<{ n: number }>();
    expect(precio?.n).toBe(1);
  });

  it("rechazar NO toca el stock", async () => {
    const pid = await crearProductoA("Amoxicilina 500");
    await seedBorrador("bor-r", sucA, { producto_id: pid, lote: "LR", vencimiento: "2027-09-01", cantidad: 40 });
    expect((await req("/api/recepciones/pendientes/bor-r/rechazar", post(tok.adminA, {}))).status).toBe(200);
    const bor = await env.DB.prepare(`SELECT estado FROM recepcion_borrador WHERE id='bor-r'`).first<{ estado: string }>();
    expect(bor?.estado).toBe("rechazado");
    const inv = await env.DB.prepare(`SELECT COUNT(*) AS n FROM inventario_local WHERE producto_id=?1`).bind(pid).first<{ n: number }>();
    expect(inv?.n).toBe(0); // ni inventario se creó
  });
});

describe("B9 — aislamiento de la bandeja", () => {
  it("borrador de sucursal A invisible para admin de A2, super B, y sin tocarlo por id (404)", async () => {
    const pid = await crearProductoA("Ibuprofeno 400", GTIN_M1);
    await seedBorrador("bor-x", sucA, { producto_id: pid, lote: "LX", vencimiento: "2027-05-01", cantidad: 5 });

    // admin de OTRA sucursal del mismo tenant no lo ve ni lo aprueba.
    const pa2 = (await (await req("/api/recepciones/pendientes", bearer(tok.adminA2))).json()) as { pendientes: unknown[] };
    expect(pa2.pendientes.length).toBe(0);
    expect((await req("/api/recepciones/pendientes/bor-x/aprobar", post(tok.adminA2, {}))).status).toBe(404);

    // super del OTRO tenant tampoco (fallo cerrado: 404).
    const pb = (await (await req(`/api/recepciones/pendientes?sucursal_id=${sucA}`, bearer(tok.superB))).json()) as { pendientes: unknown[] };
    expect(pb.pendientes.length).toBe(0);
    expect((await req("/api/recepciones/pendientes/bor-x/aprobar", post(tok.superB, {}))).status).toBe(404);
    expect((await req("/api/recepciones/pendientes/bor-x/rechazar", post(tok.superB, {}))).status).toBe(404);
  });

  it("operador no entra a la bandeja (admin+)", async () => {
    expect((await req("/api/recepciones/pendientes", bearer(tok.operA))).status).toBe(403);
  });
});

describe("B9 — proxy de fotos (R2 vía Worker)", () => {
  it("sirve la foto del borrador propio; el tenant ajeno recibe 404", async () => {
    if (!env.MEDIA) return; // sin binding R2 en el entorno de test, se omite
    const key = `bot/${TA}/2026-07-07/foto.jpg`;
    await env.MEDIA.put(key, new Uint8Array([1, 2, 3, 4]), { httpMetadata: { contentType: "image/jpeg" } });
    await seedBorrador("bor-foto", sucA, { producto_texto: "X", lote: "L", vencimiento: "2027-01-01", cantidad: 1, fotos: [key] });

    const ok = await req("/api/recepciones/pendientes/bor-foto/foto/0", bearer(tok.adminA));
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    expect((await req("/api/recepciones/pendientes/bor-foto/foto/0", bearer(tok.superB))).status).toBe(404);
    expect((await req("/api/recepciones/pendientes/bor-foto/foto/9", bearer(tok.adminA))).status).toBe(404);
  });
});
