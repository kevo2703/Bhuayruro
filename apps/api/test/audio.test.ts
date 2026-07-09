import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { hashToken } from "../src/lib/token";
import { barrerAudios, barrerSenales, procesarSenales, transcribirAudio } from "../src/repos/audio";
import type { Extractor } from "../src/lib/senales";

// ============================================================
// GATE parcial B10.1 (S7 §8) — grabadora A10: provisión de dispositivo, ingesta a R2, transcripción
// Whisper (con transcriptor FAKE — nunca llama a Workers AI real) y barredora del Cron. NO cubre
// señales/veto/bandeja (eso es S8/B10.2). Todo con auth de dispositivo + fixtures de bytes.
// ============================================================

const TS = "2026-07-04T00:00:00.000Z";
const FUTURO = "2999-01-01T00:00:00.000Z";

const TA = "t-a";
const TB = "t-b";
const sucA = "suc-a";
const sucA2 = "suc-a2";
const sucB = "suc-b";
const DEVTOK = "tok-dispositivo-a"; // token del grabador de la sucursal A

const tok = { adminA: "tok-admin-a", operA: "tok-oper-a", adminA2: "tok-admin-a2", superB: "tok-super-b", superA: "tok-super-a" };

const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]); // "audio" de mentira
// Transcriptor fake determinista: NUNCA toca Workers AI. Devuelve texto si hay bytes, null si no.
const fake = async (_e: unknown, b: Uint8Array): Promise<string | null> => (b.byteLength > 0 ? "no hay amoxicilina" : null);

// TS 5.7 tipa Uint8Array como Uint8Array<ArrayBufferLike>, que no calza con BodyInit aunque el
// runtime lo acepta como cuerpo. Cast acotado a los tests (envío de audio crudo).
const cuerpo = (b: Uint8Array): BodyInit => b as unknown as BodyInit;

const bearer = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown): RequestInit => ({ method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (t: string, body: unknown): RequestInit => ({ method: "PATCH", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const req = (path: string, init?: RequestInit) => app.request(path, init, env);

// Sube un chunk de audio como DISPOSITIVO (cuerpo crudo + metadatos por query).
const subir = (token: string, clientUuid: string, bytes: Uint8Array = AUDIO, q = "") =>
  app.request(
    `/api/audio?client_uuid=${clientUuid}&grabado_at=2026-07-08T10:00:00.000Z&duracion_seg=30${q}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/webm" }, body: cuerpo(bytes) },
    env,
  );

const keyDe = (tenant: string, cu: string) => `audio/${tenant}/2026-07-08/${cu}.webm`;

async function sembrar(): Promise<void> {
  const db = env.DB;
  for (const t of ["audio_senal", "audio_grabacion", "quiebre", "venta", "producto_fts", "producto_catalogo", "sesion", "dispositivo", "usuario_perfil", "sucursal", "tenant"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  const PW = "pbkdf2$100000$c2FsdA==$aGFzaA==";
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
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s0','u-super-a',?1,?2,?3)`).bind(await hashToken(tok.superA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s1','u-admin-a',?1,?2,?3)`).bind(await hashToken(tok.adminA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s2','u-oper-a',?1,?2,?3)`).bind(await hashToken(tok.operA), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s3','u-admin-a2',?1,?2,?3)`).bind(await hashToken(tok.adminA2), TS, FUTURO),
    db.prepare(`INSERT INTO sesion (id,usuario_id,token_hash,creada_at,expira_at) VALUES ('s4','u-super-b',?1,?2,?3)`).bind(await hashToken(tok.superB), TS, FUTURO),
    // Grabador ya provisionado en la sucursal A (activo).
    db.prepare(`INSERT INTO dispositivo (id,sucursal_id,tipo,nombre,token_hash,activo,created_at) VALUES ('dev-a',?1,'a10_grabador','Mostrador',?2,1,?3)`).bind(sucA, await hashToken(DEVTOK), TS),
  ]);
}

// Inserta una grabación 'subido' directamente + su objeto en R2 (para aislar transcripción/barredora).
async function seedGrabacion(id: string, sucursalId: string, tenant: string, conObjeto = true): Promise<void> {
  const key = keyDe(tenant, id);
  if (conObjeto && env.MEDIA) await env.MEDIA.put(key, AUDIO, { httpMetadata: { contentType: "audio/webm" } });
  await env.DB.prepare(
    `INSERT INTO audio_grabacion (id,sucursal_id,dispositivo_id,r2_key,duracion_seg,grabado_at,estado,created_at) VALUES (?1,?2,'dev-a',?3,30,?4,'subido',?4)`,
  ).bind(id, sucursalId, key, TS).run();
}

// Producto matcheable del tenant (para el match FTS de un faltante detectado).
async function seedProducto(id: string, tenant: string, nombre: string, textoFts: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO producto_catalogo (id, tenant_id, nombre, created_at, updated_at) VALUES (?1,?2,?3,?4,?4)`).bind(id, tenant, nombre, TS),
    env.DB.prepare(`INSERT INTO producto_fts (producto_id, texto) VALUES (?1, ?2)`).bind(id, textoFts),
  ]);
}

// Grabación ya 'transcrito' con un texto dado (aísla la extracción de señales de Whisper).
async function seedTranscrito(id: string, sucursalId: string, tenant: string, texto: string, grabadoAt = TS): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audio_grabacion (id,sucursal_id,dispositivo_id,r2_key,duracion_seg,grabado_at,estado,transcripcion,created_at) VALUES (?1,?2,'dev-a',?3,30,?4,'transcrito',?5,?4)`,
  ).bind(id, sucursalId, keyDe(tenant, id), grabadoAt, texto).run();
}

// Venta POS mínima de la sucursal, a una hora dada (para el cotejo ±10 min de venta_posible).
async function seedVenta(id: string, sucursalId: string, fechaHora: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO venta (id, client_uuid, sucursal_id, fecha_hora, subtotal_sin_igv_cent, igv_total_cent, total_cent, metodo_pago, estado, created_at, updated_at)
     VALUES (?1, ?1, ?2, ?3, 100, 18, 118, 'efectivo', 'completada', ?3, ?3)`,
  ).bind(id, sucursalId, fechaHora).run();
}

// Extractor fake determinista: NUNCA toca Workers AI. "no hay/se acabó" → faltante amoxicilina;
// "cobrar/venta" → una venta posible de paracetamol. Vacío en otro caso.
const fakeExtraer: Extractor = async (_e, texto) => {
  const t = texto.toLowerCase();
  const faltantes = /no hay|se acab|no tenemos|ya no queda/.test(t) ? [{ nombre: "amoxicilina", cantidad: null, confianza: 0.9 }] : [];
  const ventas = /cobrar|venta|son \d/.test(t) ? [{ items: [{ nombre: "paracetamol", cantidad: 2 }], confianza: 0.7 }] : [];
  return { faltantes, ventas };
};

beforeEach(async () => {
  await sembrar();
});

describe("B10.1 — provisión de dispositivo grabador", () => {
  it("admin crea grabador → token EN CLARO una vez; el token sirve para subir; aparece en la lista", async () => {
    const r = await req("/api/dispositivos", post(tok.adminA, { nombre: "Caja 1" }));
    expect(r.status).toBe(201);
    const d = (await r.json()) as { id: string; nombre: string; token: string };
    expect(d.nombre).toBe("Caja 1");
    expect(d.token.length).toBeGreaterThan(20);

    // El token nuevo autentica como dispositivo y sube un chunk.
    expect((await subir(d.token, "aaaaaaaa-1111-1111-1111-111111111111")).status).toBe(201);

    const lista = (await (await req("/api/dispositivos", bearer(tok.adminA))).json()) as { dispositivos: { id: string; nombre: string }[] };
    expect(lista.dispositivos.some((x) => x.id === d.id)).toBe(true);
    // La lista NUNCA expone el hash del token.
    expect(JSON.stringify(lista)).not.toMatch(/token_hash/);
  });

  it("kill-switch: desactivar el grabador → deja de autenticar (401)", async () => {
    expect((await subir(DEVTOK, "bbbbbbbb-2222-2222-2222-222222222222")).status).toBe(201);
    expect((await req("/api/dispositivos/dev-a", patch(tok.adminA, { activo: false }))).status).toBe(200);
    expect((await subir(DEVTOK, "cccccccc-3333-3333-3333-333333333333")).status).toBe(401);
  });
});

describe("B10.1 — ingesta de audio (auth de dispositivo → R2 + fila 'subido')", () => {
  it("sube un chunk → 201, fila 'subido' scoped a la sucursal del token, objeto en R2", async () => {
    const cu = "11111111-1111-1111-1111-111111111111";
    const r = await subir(DEVTOK, cu);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ id: cu, idempotent: false });

    const row = await env.DB.prepare(`SELECT sucursal_id, dispositivo_id, estado, duracion_seg, r2_key FROM audio_grabacion WHERE id=?1`).bind(cu).first<{ sucursal_id: string; dispositivo_id: string; estado: string; duracion_seg: number; r2_key: string }>();
    expect(row).toMatchObject({ sucursal_id: sucA, dispositivo_id: "dev-a", estado: "subido", duracion_seg: 30 });

    if (env.MEDIA) {
      const obj = await env.MEDIA.get(keyDe(TA, cu));
      expect(obj).toBeTruthy();
      expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(AUDIO);
    }
  });

  it("reintento offline con el MISMO client_uuid → 200 idempotent, una sola fila", async () => {
    const cu = "22222222-2222-2222-2222-222222222222";
    expect((await subir(DEVTOK, cu)).status).toBe(201);
    const r2 = await subir(DEVTOK, cu);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ idempotent: true });
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audio_grabacion WHERE id=?1`).bind(cu).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("cuerpo vacío o client_uuid inválido → 400", async () => {
    expect((await subir(DEVTOK, "no-es-uuid")).status).toBe(400);
    const vacio = await app.request(`/api/audio?client_uuid=33333333-3333-3333-3333-333333333333`, { method: "POST", headers: { Authorization: `Bearer ${DEVTOK}`, "Content-Type": "audio/webm" }, body: cuerpo(new Uint8Array([])) }, env);
    expect(vacio.status).toBe(400);
  });

  it("un USUARIO (no dispositivo) no puede subir audio → 403", async () => {
    expect((await subir(tok.adminA, "44444444-4444-4444-4444-444444444444")).status).toBe(403);
    expect((await subir(tok.operA, "55555555-5555-5555-5555-555555555555")).status).toBe(403);
  });

  // Regresión: la grabadora abierta en el MISMO navegador que el panel arrastra la cookie de sesión
  // del admin. El Bearer del DISPOSITIVO debe mandar sobre esa cookie → si no, /api/audio daba 403.
  it("con cookie de sesión de admin + Bearer de dispositivo → autentica como DISPOSITIVO (201), no 403", async () => {
    const cu = "66666666-6666-6666-6666-666666666666";
    const r = await app.request(
      `/api/audio?client_uuid=${cu}&grabado_at=2026-07-08T10:00:00.000Z&duracion_seg=30`,
      { method: "POST", headers: { Authorization: `Bearer ${DEVTOK}`, Cookie: `sesion=${tok.adminA}`, "Content-Type": "audio/webm" }, body: cuerpo(AUDIO) },
      env,
    );
    expect(r.status).toBe(201);
    const row = await env.DB.prepare(`SELECT dispositivo_id, sucursal_id FROM audio_grabacion WHERE id=?1`).bind(cu).first<{ dispositivo_id: string; sucursal_id: string }>();
    expect(row).toMatchObject({ dispositivo_id: "dev-a", sucursal_id: sucA }); // se registró como el grabador, no el admin
  });

  it("solo cookie de usuario (sin Bearer) en /api/audio → 403 (sigue siendo usuario, no dispositivo)", async () => {
    const r = await app.request(
      `/api/audio?client_uuid=77777777-7777-7777-7777-777777777777&grabado_at=2026-07-08T10:00:00.000Z&duracion_seg=30`,
      { method: "POST", headers: { Cookie: `sesion=${tok.adminA}`, "Content-Type": "audio/webm" }, body: cuerpo(AUDIO) },
      env,
    );
    expect(r.status).toBe(403);
  });
});

describe("B10.1 — transcripción (Whisper simulado por transcriptor fake)", () => {
  it("transcribirAudio: 'subido' con objeto en R2 → 'transcrito' + texto", async () => {
    await seedGrabacion("aud-ok", sucA, TA);
    expect(await transcribirAudio(env.DB, env, "aud-ok", fake)).toBe("transcrito");
    const row = await env.DB.prepare(`SELECT estado, transcripcion FROM audio_grabacion WHERE id='aud-ok'`).first<{ estado: string; transcripcion: string }>();
    expect(row).toMatchObject({ estado: "transcrito", transcripcion: "no hay amoxicilina" });
  });

  it("transición idempotente: re-transcribir un 'transcrito' → 'omitido', no lo pisa", async () => {
    await seedGrabacion("aud-idem", sucA, TA);
    await transcribirAudio(env.DB, env, "aud-idem", fake);
    expect(await transcribirAudio(env.DB, env, "aud-idem", async () => "OTRO TEXTO")).toBe("omitido");
    const row = await env.DB.prepare(`SELECT transcripcion FROM audio_grabacion WHERE id='aud-idem'`).first<{ transcripcion: string }>();
    expect(row?.transcripcion).toBe("no hay amoxicilina");
  });

  it("objeto ausente en R2 → 'error'; transcriptor que devuelve null → 'error'", async () => {
    await seedGrabacion("aud-sin-r2", sucA, TA, false); // sin objeto en R2
    expect(await transcribirAudio(env.DB, env, "aud-sin-r2", fake)).toBe("error");
    expect((await env.DB.prepare(`SELECT estado FROM audio_grabacion WHERE id='aud-sin-r2'`).first<{ estado: string }>())?.estado).toBe("error");

    await seedGrabacion("aud-null", sucA, TA);
    expect(await transcribirAudio(env.DB, env, "aud-null", async () => null)).toBe("error");
    expect((await env.DB.prepare(`SELECT estado FROM audio_grabacion WHERE id='aud-null'`).first<{ estado: string }>())?.estado).toBe("error");
  });
});

describe("B10.1 — barredora del Cron", () => {
  it("transcribe todos los 'subido' viejos; deja intactos los ya procesados", async () => {
    await seedGrabacion("b1", sucA, TA);
    await seedGrabacion("b2", sucA, TA);
    // Uno ya transcrito: la barredora no lo re-toca.
    await seedGrabacion("b3", sucA, TA);
    await env.DB.prepare(`UPDATE audio_grabacion SET estado='transcrito', transcripcion='ya' WHERE id='b3'`).run();

    const r = await barrerAudios(env.DB, env, { cutoffIso: FUTURO, max: 50, transcribir: fake });
    expect(r).toMatchObject({ procesados: 2, transcritos: 2, errores: 0 });
    const subidos = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audio_grabacion WHERE estado='subido'`).first<{ n: number }>();
    expect(subidos?.n).toBe(0);
    expect((await env.DB.prepare(`SELECT transcripcion FROM audio_grabacion WHERE id='b3'`).first<{ transcripcion: string }>())?.transcripcion).toBe("ya");
  });

  it("respeta el corte de antigüedad: no toca lo que aún es reciente", async () => {
    await seedGrabacion("reciente", sucA, TA);
    const r = await barrerAudios(env.DB, env, { cutoffIso: "2000-01-01T00:00:00.000Z", max: 50, transcribir: fake });
    expect(r.procesados).toBe(0);
    expect((await env.DB.prepare(`SELECT estado FROM audio_grabacion WHERE id='reciente'`).first<{ estado: string }>())?.estado).toBe("subido");
  });
});

describe("B10.1 — panel de grabaciones y aislamiento (D-N8)", () => {
  it("GET /audio lista las recientes de MI sucursal", async () => {
    await seedGrabacion("g1", sucA, TA);
    const r = (await (await req("/api/audio", bearer(tok.adminA))).json()) as { grabaciones: { id: string; estado: string }[] };
    expect(r.grabaciones.some((x) => x.id === "g1")).toBe(true);
  });

  it("grabaciones de la sucursal A: invisibles para admin de A2 y para super del OTRO tenant", async () => {
    await seedGrabacion("gx", sucA, TA);
    // admin de otra sucursal del mismo tenant: no las ve.
    const a2 = (await (await req("/api/audio", bearer(tok.adminA2))).json()) as { grabaciones: unknown[] };
    expect(a2.grabaciones.length).toBe(0);
    // super del OTRO tenant pidiendo la sucursal ajena → 404 (fallo cerrado).
    expect((await req(`/api/audio?sucursal_id=${sucA}`, bearer(tok.superB))).status).toBe(404);
  });

  it("un super del OTRO tenant no crea ni gestiona grabadores de una sucursal ajena → 404", async () => {
    expect((await req(`/api/dispositivos?sucursal_id=${sucA}`, post(tok.superB, { nombre: "x" }))).status).toBe(404);
    expect((await req(`/api/dispositivos?sucursal_id=${sucA}`, bearer(tok.superB))).status).toBe(404);
    expect((await req(`/api/dispositivos/dev-a?sucursal_id=${sucA}`, patch(tok.superB, { activo: false }))).status).toBe(404);
    // Y el grabador de A sigue activo (nadie ajeno lo tocó).
    expect((await env.DB.prepare(`SELECT activo FROM dispositivo WHERE id='dev-a'`).first<{ activo: number }>())?.activo).toBe(1);
  });

  it("operador no entra al panel de audio ni provisiona grabadores (admin+)", async () => {
    expect((await req("/api/audio", bearer(tok.operA))).status).toBe(403);
    expect((await req("/api/dispositivos", post(tok.operA, { nombre: "x" }))).status).toBe(403);
  });
});

// ============================================================
// B10.2 (S8 §8) — Extracción de señales + bandeja del Mostrador. Extractor SIEMPRE fake (nunca IA real).
// ============================================================

describe("B10.2 — extracción de señales (faltante) + match FTS contra el catálogo del tenant", () => {
  it("'no hay amoxicilina' → señal faltante 'pendiente' con el producto del tenant matcheado; audio→'procesado'", async () => {
    await seedProducto("p-amox", TA, "Amoxicilina 500mg", "amoxicilina 500 mg tabletas");
    await seedTranscrito("aud-f", sucA, TA, "no hay amoxicilina, se acabó");

    expect(await procesarSenales(env.DB, env, "aud-f", fakeExtraer)).toBe("procesado");
    expect((await env.DB.prepare(`SELECT estado FROM audio_grabacion WHERE id='aud-f'`).first<{ estado: string }>())?.estado).toBe("procesado");

    const senal = await env.DB.prepare(`SELECT id, tipo, estado, items_json, sucursal_id FROM audio_senal WHERE audio_id='aud-f'`).first<{ id: string; tipo: string; estado: string; items_json: string; sucursal_id: string }>();
    expect(senal).toMatchObject({ id: "aud-f-f0", tipo: "faltante", estado: "pendiente", sucursal_id: sucA });
    const items = JSON.parse(senal!.items_json) as { producto_id: string; nombre_detectado: string }[];
    expect(items[0]).toMatchObject({ producto_id: "p-amox", nombre_detectado: "amoxicilina" });
  });

  it("faltante sin match en el catálogo → señal igual, con producto_id null (el humano decide)", async () => {
    await seedTranscrito("aud-nm", sucA, TA, "no hay amoxicilina");
    await procesarSenales(env.DB, env, "aud-nm", fakeExtraer);
    const items = JSON.parse((await env.DB.prepare(`SELECT items_json FROM audio_senal WHERE audio_id='aud-nm'`).first<{ items_json: string }>())!.items_json) as { producto_id: string | null }[];
    expect(items[0]!.producto_id).toBeNull();
  });

  it("transcripción sin faltante ni venta → 0 señales, audio igual pasa a 'procesado'", async () => {
    await seedTranscrito("aud-vacio", sucA, TA, "buenos días, ¿cómo está?");
    await procesarSenales(env.DB, env, "aud-vacio", fakeExtraer);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audio_senal WHERE audio_id='aud-vacio'`).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare(`SELECT estado FROM audio_grabacion WHERE id='aud-vacio'`).first<{ estado: string }>())?.estado).toBe("procesado");
  });

  it("idempotente: reprocesar un 'procesado' → 'omitido', sin señales duplicadas", async () => {
    await seedProducto("p-amox", TA, "Amoxicilina 500mg", "amoxicilina 500 mg");
    await seedTranscrito("aud-idem", sucA, TA, "no hay amoxicilina");
    await procesarSenales(env.DB, env, "aud-idem", fakeExtraer);
    expect(await procesarSenales(env.DB, env, "aud-idem", fakeExtraer)).toBe("omitido");
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audio_senal WHERE audio_id='aud-idem'`).first<{ n: number }>())?.n).toBe(1);
  });
});

describe("B10.2 — venta_posible: cotejo ±10 min contra las ventas POS de la sucursal", () => {
  it("mención de venta CON venta POS en la ventana → señal 'autocerrado' (silenciosa)", async () => {
    await seedTranscrito("aud-vok", sucA, TA, "ya son 5 soles, gracias", "2026-07-08T15:00:00.000Z");
    await seedVenta("v-cerca", sucA, "2026-07-08T15:03:00.000Z"); // dentro de ±10 min
    await procesarSenales(env.DB, env, "aud-vok", fakeExtraer);
    const s = await env.DB.prepare(`SELECT tipo, estado FROM audio_senal WHERE audio_id='aud-vok'`).first<{ tipo: string; estado: string }>();
    expect(s).toMatchObject({ tipo: "venta_posible", estado: "autocerrado" });
  });

  it("mención de venta SIN venta POS en la ventana → señal 'pendiente' (borrador para el operador)", async () => {
    await seedTranscrito("aud-vno", sucA, TA, "ya son 5 soles, gracias", "2026-07-08T15:00:00.000Z");
    await seedVenta("v-lejos", sucA, "2026-07-08T15:30:00.000Z"); // fuera de ±10 min
    await procesarSenales(env.DB, env, "aud-vno", fakeExtraer);
    expect((await env.DB.prepare(`SELECT estado FROM audio_senal WHERE audio_id='aud-vno'`).first<{ estado: string }>())?.estado).toBe("pendiente");
  });

  it("la venta de OTRA sucursal no autocierra (cotejo por sucursal, no cross-botica)", async () => {
    await seedTranscrito("aud-vx", sucA, TA, "ya son 5 soles", "2026-07-08T15:00:00.000Z");
    await seedVenta("v-a2", sucA2, "2026-07-08T15:03:00.000Z"); // misma hora, OTRA sucursal
    await procesarSenales(env.DB, env, "aud-vx", fakeExtraer);
    expect((await env.DB.prepare(`SELECT estado FROM audio_senal WHERE audio_id='aud-vx'`).first<{ estado: string }>())?.estado).toBe("pendiente");
  });
});

describe("B10.2 — bandeja del Mostrador: listar, confirmar (→ quiebre real) y descartar", () => {
  it("GET /audio/senales lista las pendientes de MI sucursal con el nombre del producto", async () => {
    await seedProducto("p-amox", TA, "Amoxicilina 500mg", "amoxicilina 500 mg");
    await seedTranscrito("aud-b", sucA, TA, "no hay amoxicilina");
    await procesarSenales(env.DB, env, "aud-b", fakeExtraer);

    const r = (await (await req("/api/audio/senales", bearer(tok.operA))).json()) as { senales: { id: string; tipo: string; items: { producto_id: string; producto_nombre: string }[] }[] };
    expect(r.senales.length).toBe(1);
    expect(r.senales[0]).toMatchObject({ id: "aud-b-f0", tipo: "faltante" });
    expect(r.senales[0]!.items[0]).toMatchObject({ producto_id: "p-amox", producto_nombre: "Amoxicilina 500mg" });
  });

  it("confirmar un faltante → crea QUIEBRE real (sin operador, D-N5), liga quiebre_id y sale de la bandeja", async () => {
    await seedProducto("p-amox", TA, "Amoxicilina 500mg", "amoxicilina 500 mg");
    await seedTranscrito("aud-c", sucA, TA, "no hay amoxicilina");
    await procesarSenales(env.DB, env, "aud-c", fakeExtraer);

    const r = await req("/api/audio/senales/aud-c-f0/confirmar", post(tok.operA, {}));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; estado: string; quiebre_id: string };
    expect(j).toMatchObject({ ok: true, estado: "confirmado" });

    // El quiebre existe, apunta al producto y NO tiene operador (veto D-N5).
    const q = await env.DB.prepare(`SELECT producto_id, operador_id FROM quiebre WHERE id=?1`).bind(j.quiebre_id).first<{ producto_id: string; operador_id: string | null }>();
    expect(q).toMatchObject({ producto_id: "p-amox", operador_id: null });
    // La señal quedó confirmada con el quiebre ligado y ya no está pendiente.
    const s = await env.DB.prepare(`SELECT estado, quiebre_id FROM audio_senal WHERE id='aud-c-f0'`).first<{ estado: string; quiebre_id: string }>();
    expect(s).toMatchObject({ estado: "confirmado", quiebre_id: j.quiebre_id });
    expect((await (await req("/api/audio/senales", bearer(tok.operA))).json() as { senales: unknown[] }).senales.length).toBe(0);
  });

  it("confirmar dos veces → idempotente (un solo quiebre por señal)", async () => {
    await seedProducto("p-amox", TA, "Amoxicilina 500mg", "amoxicilina 500 mg");
    await seedTranscrito("aud-c2", sucA, TA, "no hay amoxicilina");
    await procesarSenales(env.DB, env, "aud-c2", fakeExtraer);
    await req("/api/audio/senales/aud-c2-f0/confirmar", post(tok.operA, {}));
    const r2 = await req("/api/audio/senales/aud-c2-f0/confirmar", post(tok.operA, {}));
    expect(r2.status).toBe(200);
    expect((await r2.json() as { idempotent?: boolean }).idempotent).toBe(true);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM quiebre WHERE client_uuid='senal:aud-c2-f0'`).first<{ n: number }>())?.n).toBe(1);
  });

  it("descartar una señal pendiente → sale de la bandeja, sin quiebre", async () => {
    await seedTranscrito("aud-d", sucA, TA, "no hay amoxicilina");
    await procesarSenales(env.DB, env, "aud-d", fakeExtraer);
    expect((await req("/api/audio/senales/aud-d-f0/descartar", post(tok.operA, {}))).status).toBe(200);
    expect((await env.DB.prepare(`SELECT estado FROM audio_senal WHERE id='aud-d-f0'`).first<{ estado: string }>())?.estado).toBe("descartado");
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM quiebre`).first<{ n: number }>())?.n).toBe(0);
  });

  it("aislamiento: admin de otra sucursal no ve ni confirma la señal de sucA (404); super del otro tenant tampoco", async () => {
    await seedProducto("p-amox", TA, "Amoxicilina 500mg", "amoxicilina 500 mg");
    await seedTranscrito("aud-ais", sucA, TA, "no hay amoxicilina");
    await procesarSenales(env.DB, env, "aud-ais", fakeExtraer);

    // admin de la sucursal hermana A2: su bandeja está vacía y no puede confirmar la señal de A.
    expect(((await (await req("/api/audio/senales", bearer(tok.adminA2))).json()) as { senales: unknown[] }).senales.length).toBe(0);
    expect((await req("/api/audio/senales/aud-ais-f0/confirmar", post(tok.adminA2, {}))).status).toBe(404);
    // super del OTRO tenant pidiendo la sucursal ajena → 404.
    expect((await req(`/api/audio/senales?sucursal_id=${sucA}`, bearer(tok.superB))).status).toBe(404);
    // La señal sigue pendiente (nadie ajeno la tocó) y no se creó ningún quiebre.
    expect((await env.DB.prepare(`SELECT estado FROM audio_senal WHERE id='aud-ais-f0'`).first<{ estado: string }>())?.estado).toBe("pendiente");
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM quiebre`).first<{ n: number }>())?.n).toBe(0);
  });
});

describe("B10.2 — barredora de señales del Cron (transcrito → procesado)", () => {
  it("barrerSenales procesa todos los 'transcrito' y los deja 'procesado'", async () => {
    await seedProducto("p-amox", TA, "Amoxicilina", "amoxicilina");
    await seedTranscrito("bs1", sucA, TA, "no hay amoxicilina");
    await seedTranscrito("bs2", sucA2, TA, "buenos días");
    const r = await barrerSenales(env.DB, env, { max: 50, extraer: fakeExtraer });
    expect(r.procesados).toBe(2);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audio_grabacion WHERE estado='transcrito'`).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audio_senal WHERE audio_id='bs1'`).first<{ n: number }>())?.n).toBe(1);
  });
});
