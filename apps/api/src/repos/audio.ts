// Audio A10 casi-tiempo-real (B10.1 §8). Ingesta de chunks del grabador + transcripción Whisper.
// Todo el SQL vive aquí (canal prohibido §4.4 #14). Tres capas:
//   - audioRepo(db, actor)        → ingesta como DISPOSITIVO (scoped por su sucursal).
//   - audioSistemaRepo(db)        → transiciones de estado sin actor (las corre la ingesta y el Cron).
//   - transcribirAudio / barrer*  → orquestación (lee R2 → Whisper → persiste); transcriptor inyectable.
//
// La transcripción se dispara en la ingesta (ctx.waitUntil) para latencia <2 min; el Cron cada 5 min
// barre los que quedaron 'subido' porque el waitUntil no llegó (Worker desalojado, etc.).

import { normalizarNombre, uuidv7 } from "@huayruro/shared";
import { noEncontrado, validacion } from "../lib/errores";
import { fechaLocal } from "../lib/fecha";
import { esSuper } from "../lib/scope";
import type { Actor, ActorDispositivo, Bindings } from "../types";
import { construirInitialPrompt, transcribirBytes, type ResultadoTranscripcion } from "../lib/whisper";
import { extraerSenalesIA, fraseFuente, type Extractor } from "../lib/senales";
import { withRetry } from "./base";
import { quiebreRepo } from "./quiebre";

export type AudioRow = { id: string; sucursal_id: string; r2_key: string; estado: string };

// Firma del transcriptor (inyectable): en producción = Whisper; en tests = un fake determinista
// (evita llamar a Workers AI real — la suite no debe generar cargos de IA). `initialPrompt` = sesgo
// de dominio (nombres de medicamentos + jerga de botica) que arma transcribirAudio por tenant.
// Devuelve un resultado discriminado (B10.3): 'texto' | 'sin_habla' | 'error'.
export type Transcriptor = (env: Bindings, bytes: Uint8Array, initialPrompt?: string) => Promise<ResultadoTranscripcion>;

// Barredora: solo toca 'subido' con al menos este tiempo de vida (dar margen al waitUntil de la ingesta).
const ANTIGUEDAD_BARREDORA_MS = 2 * 60_000;
const MAX_POR_BARRIDA = 50;
// Cotejo de venta_posible: ventana ±10 min alrededor del audio contra las ventas POS de la sucursal (§8).
const VENTANA_VENTA_MS = 10 * 60_000;
// Sesgo de transcripción: cuántos nombres del catálogo caben en el initial_prompt (el resto lo acota
// construirInitialPrompt por longitud). 40 es holgado para el presupuesto de ~200 tokens del prompt.
const MAX_NOMBRES_PROMPT = 40;
// Filtro de ruido (visto en la prueba en vivo: "chancho/mariscos/pescado" con confianza 0): NO creamos
// señal por debajo de este umbral de confianza del extractor. Ajustable sin migración.
const UMBRAL_SENAL = 0.4;

// ── Ingesta como dispositivo (scoped por la sucursal del token de dispositivo) ──
export function audioRepo(db: D1Database, actor: ActorDispositivo) {
  return {
    // ¿ya tengo este chunk? (idempotencia del reintento offline). Scoped por sucursal.
    async existe(id: string): Promise<boolean> {
      const row = await withRetry(() =>
        db.prepare(`SELECT 1 AS x FROM audio_grabacion WHERE id = ?1 AND sucursal_id = ?2`).bind(id, actor.sucursalId).first<{ x: number }>(),
      );
      return !!row;
    },

    // Inserta el chunk como 'subido'. INSERT OR IGNORE por si dos reintentos corren a la vez
    // (el id = client_uuid es la guarda dura). Devuelve si REALMENTE insertó (para no re-transcribir).
    async registrarChunk(p: { id: string; r2Key: string; duracionSeg: number | null; grabadoAt: string; nowIso: string }): Promise<{ inserted: boolean }> {
      const res = await withRetry(() =>
        db
          .prepare(
            `INSERT OR IGNORE INTO audio_grabacion (id, sucursal_id, dispositivo_id, r2_key, duracion_seg, grabado_at, estado, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'subido', ?7)`,
          )
          .bind(p.id, actor.sucursalId, actor.dispositivoId, p.r2Key, p.duracionSeg, p.grabadoAt, p.nowIso)
          .run(),
      );
      return { inserted: (res.meta?.changes ?? 0) > 0 };
    },
  };
}

// ── Estado del audio: lo comparten la ingesta (waitUntil) y el Cron. Sin actor: opera por id de fila. ──
export function audioSistemaRepo(db: D1Database) {
  return {
    async obtener(id: string): Promise<AudioRow | null> {
      return withRetry(() =>
        db.prepare(`SELECT id, sucursal_id, r2_key, estado FROM audio_grabacion WHERE id = ?1`).bind(id).first<AudioRow>(),
      );
    },

    // 'subido' más viejos que el corte (candidatos que el waitUntil no transcribió).
    async pendientes(cutoffIso: string, max: number): Promise<AudioRow[]> {
      const { results } = await withRetry(() =>
        db
          .prepare(`SELECT id, sucursal_id, r2_key, estado FROM audio_grabacion WHERE estado = 'subido' AND created_at < ?1 ORDER BY created_at ASC LIMIT ?2`)
          .bind(cutoffIso, max)
          .all<AudioRow>(),
      );
      return results ?? [];
    },

    // Transición idempotente subido→transcrito (guarda por estado: el waitUntil y el Cron no se pisan).
    async guardarTranscripcion(id: string, texto: string): Promise<void> {
      await withRetry(() =>
        db.prepare(`UPDATE audio_grabacion SET estado = 'transcrito', transcripcion = ?2, error_detalle = NULL WHERE id = ?1 AND estado = 'subido'`).bind(id, texto).run(),
      );
    },

    // subido→error (idempotente por la misma guarda). El Cron NO reintenta 'error' → sin bucles.
    async marcarError(id: string, detalle: string): Promise<void> {
      await withRetry(() =>
        db.prepare(`UPDATE audio_grabacion SET estado = 'error', error_detalle = ?2 WHERE id = ?1 AND estado = 'subido'`).bind(id, detalle.slice(0, 500)).run(),
      );
    },

    // subido→procesado con sin_habla=1 (terminal benigno, B10.3): Whisper corrió pero no oyó voz. NO es
    // error (no ensucia el panel ni se reintenta) ni una transcripción real (flag `sin_habla`, no un
    // estado nuevo — el CHECK no admite ALTER y la tabla no se puede reconstruir por la FK de audio_senal).
    async marcarSinHabla(id: string): Promise<void> {
      await withRetry(() =>
        db.prepare(`UPDATE audio_grabacion SET estado = 'procesado', sin_habla = 1, error_detalle = NULL WHERE id = ?1 AND estado = 'subido'`).bind(id).run(),
      );
    },

    // Recientes de una sucursal (para el panel del admin / estado de la grabadora). sucursalId ya resuelto por la ruta.
    async recientes(sucursalId: string, limite: number): Promise<{ id: string; estado: string; sin_habla: number; duracion_seg: number | null; grabado_at: string; transcripcion: string | null; error_detalle: string | null }[]> {
      const { results } = await withRetry(() =>
        db
          .prepare(`SELECT id, estado, sin_habla, duracion_seg, grabado_at, transcripcion, error_detalle FROM audio_grabacion WHERE sucursal_id = ?1 ORDER BY created_at DESC LIMIT ?2`)
          .bind(sucursalId, limite)
          .all<{ id: string; estado: string; sin_habla: number; duracion_seg: number | null; grabado_at: string; transcripcion: string | null; error_detalle: string | null }>(),
      );
      return results ?? [];
    },
  };
}

// ── Orquestación: lee el chunk de R2 → transcribe → persiste. Idempotente por la guarda de estado. ──
export async function transcribirAudio(
  db: D1Database,
  env: Bindings,
  id: string,
  transcribir: Transcriptor = transcribirBytes,
): Promise<"transcrito" | "error" | "sin_habla" | "omitido"> {
  const repo = audioSistemaRepo(db);
  const row = await repo.obtener(id);
  if (!row || row.estado !== "subido") return "omitido"; // ya procesado o inexistente
  const obj = env.MEDIA ? await env.MEDIA.get(row.r2_key) : null;
  if (!obj) {
    await repo.marcarError(id, "audio ausente en R2");
    return "error";
  }
  const bytes = new Uint8Array(await obj.arrayBuffer());
  // Sesgo de dominio: nombres del catálogo del tenant + jerga de botica → mejor transcripción de
  // medicamentos y términos del mostrador ("fenazopiridina", "vuelto", "sencillo").
  const nombres = await nombresCatalogoTenant(db, row.sucursal_id, MAX_NOMBRES_PROMPT);
  const r = await transcribir(env, bytes, construirInitialPrompt(nombres));
  if (r.estado === "sin_habla") {
    await repo.marcarSinHabla(id); // Whisper corrió, no oyó voz → terminal benigno (no ensucia el panel)
    return "sin_habla";
  }
  if (r.estado === "error") {
    await repo.marcarError(id, r.detalle);
    return "error";
  }
  await repo.guardarTranscripcion(id, r.texto);
  return "transcrito";
}

// Procesa un lote de 'subido' viejos (uno por uno; el volumen del piloto es bajo). Transcriptor inyectable.
export async function barrerAudios(
  db: D1Database,
  env: Bindings,
  opts: { cutoffIso: string; max: number; transcribir?: Transcriptor },
): Promise<{ procesados: number; transcritos: number; errores: number; sin_habla: number }> {
  const filas = await audioSistemaRepo(db).pendientes(opts.cutoffIso, opts.max);
  let transcritos = 0;
  let errores = 0;
  let sinHabla = 0;
  for (const f of filas) {
    const r = await transcribirAudio(db, env, f.id, opts.transcribir);
    if (r === "transcrito") transcritos++;
    else if (r === "error") errores++;
    else if (r === "sin_habla") sinHabla++;
  }
  return { procesados: filas.length, transcritos, errores, sin_habla: sinHabla };
}

// Entrada del Cron (la invoca worker.ts). env.DB se toca AQUÍ (repos/), nunca en worker.ts (§4.4 #14).
// Dos barridos: (1) transcribe los 'subido' que el waitUntil no alcanzó; (2) extrae señales de los
// 'transcrito' cuyo waitUntil no llegó a la fase B10.2 (Worker desalojado entre una fase y la otra).
export async function barrerAudiosPendientes(env: Bindings): Promise<{ procesados: number; transcritos: number; errores: number; sin_habla: number; senales: number }> {
  const cutoffIso = new Date(Date.now() - ANTIGUEDAD_BARREDORA_MS).toISOString();
  const t = await barrerAudios(env.DB, env, { cutoffIso, max: MAX_POR_BARRIDA });
  const s = await barrerSenales(env.DB, env, { max: MAX_POR_BARRIDA });
  // B10.3: snapshot de calidad del día (upsert por sucursal+fecha) — el panel admin lo lee.
  await actualizarReporteCalidad(env.DB);
  return { ...t, senales: s.procesados };
}

// ============================================================
// B10.2 (§8) — Señales derivadas del audio: faltantes + ventas posibles.
//
// Pipeline: 'transcrito' → (LLM chico extrae faltantes/ventas) → match FTS contra el catálogo del
// tenant (faltantes) / cotejo ±10 min contra las ventas POS (ventas) → filas en audio_senal →
// 'procesado'. TODO el SQL vive aquí; el extractor es inyectable (tests nunca llaman a Workers AI).
//
// VETO D-N5 (§2.3): audio_senal NO tiene operador_id; NINGUNA query de este bloque cruza el audio con
// personal/operador. El quiebre que nace al confirmar un faltante se registra SIN operador (el faltante
// lo dijo el ambiente, no se atribuye a nadie). El test del veto (tipo canal-prohibido) lo verifica.
// ============================================================

// Fila del audio + su tenant (para matchear contra el catálogo del tenant y cotejar sus ventas).
type FilaSenales = { id: string; sucursal_id: string; tenant_id: string; transcripcion: string | null; grabado_at: string; estado: string };

// Un ítem de una señal tal como se persiste en items_json. SKU/precio SIEMPRE se resuelven en D1 (§4.3).
type SenalItem = { producto_id: string | null; nombre_detectado: string; cantidad: number | null; confianza: number };

async function filaParaSenales(db: D1Database, id: string): Promise<FilaSenales | null> {
  return withRetry(() =>
    db
      .prepare(
        `SELECT a.id, a.sucursal_id, s.tenant_id, a.transcripcion, a.grabado_at, a.estado
         FROM audio_grabacion a JOIN sucursal s ON s.id = a.sucursal_id WHERE a.id = ?1`,
      )
      .bind(id)
      .first<FilaSenales>(),
  );
}

// 'transcrito' listos para extraer señales (los que el waitUntil de la ingesta no procesó).
async function transcritosPendientes(db: D1Database, max: number): Promise<{ id: string }[]> {
  const { results } = await withRetry(() =>
    db.prepare(`SELECT id FROM audio_grabacion WHERE estado = 'transcrito' ORDER BY created_at ASC LIMIT ?1`).bind(max).all<{ id: string }>(),
  );
  return results ?? [];
}

// Arma un término FTS5 desde un nombre detectado (sin tildes, tokens ≥3, prefijo). null si no hay nada útil.
function terminoFts(nombre: string): string | null {
  const limpio = normalizarNombre(nombre).replace(/[^\p{L}\p{N} ]/gu, " ");
  const tokens = limpio.split(/\s+/).filter((t) => t.length >= 3).slice(0, 4);
  return tokens.length ? tokens.map((t) => `${t}*`).join(" ") : null;
}

async function buscarFts(db: D1Database, tenantId: string, termino: string): Promise<{ id: string; nombre: string } | null> {
  try {
    return await withRetry(() =>
      db
        .prepare(
          `SELECT p.id, p.nombre FROM producto_fts f JOIN producto_catalogo p ON p.id = f.producto_id
           WHERE producto_fts MATCH ?1 AND p.tenant_id = ?2 AND p.deleted_at IS NULL ORDER BY rank LIMIT 1`,
        )
        .bind(termino, tenantId)
        .first<{ id: string; nombre: string }>(),
    );
  } catch {
    return null; // término FTS mal formado → sin match (la señal se crea igual con el nombre detectado)
  }
}

// Corrección aprendida (B10.3): ¿ya nos enseñaron que esta forma OÍDA es tal producto? Devuelve el
// producto (vivo) o null. Se consulta ANTES del FTS: "penasopiridina" matchea Fenazopiridina de una.
async function buscarCorreccion(db: D1Database, tenantId: string, textoNorm: string): Promise<{ producto_id: string; nombre: string } | null> {
  const row = await withRetry(() =>
    db
      .prepare(
        `SELECT p.id, p.nombre FROM audio_correccion c JOIN producto_catalogo p ON p.id = c.producto_id
         WHERE c.tenant_id = ?1 AND c.texto_norm = ?2 AND p.deleted_at IS NULL`,
      )
      .bind(tenantId, textoNorm)
      .first<{ id: string; nombre: string }>(),
  );
  return row ? { producto_id: row.id, nombre: row.nombre } : null;
}

// Aprende (o refuerza) una corrección: forma OÍDA normalizada → producto del tenant. Upsert por
// (tenant_id, texto_norm): si ya existía con otro producto se corrige y se cuenta una vez más. NO
// guarda quién la enseñó (VETO D-N5: es vocabulario, no supervisión). No-op si el texto es vacío.
async function aprenderCorreccion(db: D1Database, tenantId: string, textoNorm: string, productoId: string, nowIso: string): Promise<void> {
  if (!textoNorm) return;
  await withRetry(() =>
    db
      .prepare(
        `INSERT INTO audio_correccion (id, tenant_id, texto_norm, producto_id, veces, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
         ON CONFLICT (tenant_id, texto_norm) DO UPDATE SET
           producto_id = excluded.producto_id,
           veces = audio_correccion.veces + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(uuidv7(), tenantId, textoNorm, productoId, nowIso)
      .run(),
  );
}

// ¿el producto es del tenant y está vivo? (valida el override de "corregir" antes de tocar nada).
async function productoDelTenant(db: D1Database, tenantId: string, productoId: string): Promise<boolean> {
  const row = await withRetry(() =>
    db.prepare(`SELECT 1 AS x FROM producto_catalogo WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`).bind(productoId, tenantId).first<{ x: number }>(),
  );
  return !!row;
}

// Matchea un nombre detectado contra el catálogo del tenant. Pipeline: corrección aprendida →
// FTS con todos los tokens (AND) → FTS con el token más largo. Primero-que-pega-gana; el humano confirma.
async function matchProductoTenant(db: D1Database, tenantId: string, nombre: string): Promise<{ producto_id: string; nombre: string } | null> {
  const norm = normalizarNombre(nombre);
  if (norm) {
    const corr = await buscarCorreccion(db, tenantId, norm);
    if (corr) return corr; // lo aprendido pisa al FTS
  }
  const termino = terminoFts(nombre);
  if (!termino) return null;
  let row = await buscarFts(db, tenantId, termino);
  if (!row) {
    const tokens = normalizarNombre(nombre).replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((t) => t.length >= 3);
    const largo = tokens.sort((a, b) => b.length - a.length)[0];
    if (largo) row = await buscarFts(db, tenantId, `${largo}*`);
  }
  return row ? { producto_id: row.id, nombre: row.nombre } : null;
}

// Nombres del catálogo del tenant de una sucursal (para sesgar Whisper hacia SUS medicamentos).
// B10.3: se prioriza (1) los productos con corrección aprendida (los que Whisper suele masacrar → hay
// que deletreárselos) y (2) la frecuencia de venta (los más probables de oírse), con el nombre como
// desempate estable. Así el presupuesto acotado del initial_prompt (~200 tokens) se gasta en lo que
// más importa, no en la "A". Sin corrección ni ventas cae al orden alfabético de siempre.
async function nombresCatalogoTenant(db: D1Database, sucursalId: string, limite: number): Promise<string[]> {
  const { results } = await withRetry(() =>
    db
      .prepare(
        `SELECT p.nombre FROM producto_catalogo p
         JOIN sucursal s ON s.id = ?1 AND s.tenant_id = p.tenant_id
         LEFT JOIN (
           SELECT vi.producto_id, COUNT(*) AS n
           FROM venta_item vi JOIN venta v ON v.id = vi.venta_id
           WHERE v.sucursal_id = ?1 AND v.estado = 'completada'
           GROUP BY vi.producto_id
         ) vf ON vf.producto_id = p.id
         LEFT JOIN (
           SELECT producto_id, SUM(veces) AS c FROM audio_correccion GROUP BY producto_id
         ) cx ON cx.producto_id = p.id
         WHERE p.deleted_at IS NULL
         ORDER BY (CASE WHEN cx.c IS NOT NULL THEN 1 ELSE 0 END) DESC, COALESCE(vf.n, 0) DESC, p.nombre ASC
         LIMIT ?2`,
      )
      .bind(sucursalId, limite)
      .all<{ nombre: string }>(),
  );
  return (results ?? []).map((r) => r.nombre);
}

// ¿hubo alguna venta POS (no anulada) en la sucursal dentro de ±ventana del audio? Cotejo de
// venta_posible (§8): si SÍ → la señal se autocierra en silencio; si NO → borrador para el operador.
// D-N5: mira SOLO existencia de venta por sucursal+tiempo; jamás el operador de esa venta.
async function hayVentaEnVentana(db: D1Database, sucursalId: string, centroIso: string, ventanaMs: number): Promise<boolean> {
  const centro = Date.parse(centroIso);
  const base = Number.isFinite(centro) ? centro : Date.now();
  const desde = new Date(base - ventanaMs).toISOString();
  const hasta = new Date(base + ventanaMs).toISOString();
  const row = await withRetry(() =>
    db
      .prepare(`SELECT 1 AS x FROM venta WHERE sucursal_id = ?1 AND estado = 'completada' AND fecha_hora BETWEEN ?2 AND ?3 LIMIT 1`)
      .bind(sucursalId, desde, hasta)
      .first<{ x: number }>(),
  );
  return !!row;
}

async function insertarSenal(
  db: D1Database,
  p: { id: string; sucursalId: string; audioId: string; tipo: "faltante" | "venta_posible"; items: SenalItem[]; estado: string; frase: string | null; nowIso: string },
): Promise<void> {
  await withRetry(() =>
    db
      .prepare(
        `INSERT OR IGNORE INTO audio_senal (id, sucursal_id, audio_id, tipo, items_json, estado, frase, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
      )
      .bind(p.id, p.sucursalId, p.audioId, p.tipo, JSON.stringify(p.items), p.estado, p.frase, p.nowIso)
      .run(),
  );
}

// Transición idempotente transcrito→procesado (guarda por estado: ingesta y Cron no se pisan).
async function marcarProcesado(db: D1Database, id: string): Promise<void> {
  await withRetry(() =>
    db.prepare(`UPDATE audio_grabacion SET estado = 'procesado' WHERE id = ?1 AND estado = 'transcrito'`).bind(id).run(),
  );
}

// Extrae señales de un audio 'transcrito' y las persiste; luego lo pasa a 'procesado'. Idempotente:
// solo procesa 'transcrito' (guarda) y usa ids deterministas por audio+índice (INSERT OR IGNORE).
export async function procesarSenales(
  db: D1Database,
  env: Bindings,
  id: string,
  extraer: Extractor = extraerSenalesIA,
): Promise<"procesado" | "omitido"> {
  const fila = await filaParaSenales(db, id);
  if (!fila || fila.estado !== "transcrito") return "omitido"; // ya procesado, inexistente o no transcrito
  const texto = (fila.transcripcion ?? "").trim();
  const nowIso = new Date().toISOString();

  // Extracción best-effort: si la IA no está o falla (null), el audio igual pasa a 'procesado' (la
  // transcripción queda guardada); no se reintenta en bucle. El audio es asistencia, no dato crítico.
  const senales = texto ? await extraer(env, texto) : null;
  if (senales) {
    // Faltantes: UNA señal por producto detectado (calza con el quiebre_id único de la señal).
    // Filtro de ruido: descartamos lo de baja confianza (conversación ajena que el modelo sobre-interpreta).
    for (let i = 0; i < senales.faltantes.length; i++) {
      const f = senales.faltantes[i]!;
      if (f.confianza < UMBRAL_SENAL) continue;
      const match = await matchProductoTenant(db, fila.tenant_id, f.nombre);
      const items: SenalItem[] = [{ producto_id: match?.producto_id ?? null, nombre_detectado: f.nombre, cantidad: f.cantidad, confianza: f.confianza }];
      // Contexto (B10.4.2): la frase de la transcripción donde se oyó el producto (para poder actuar).
      const frase = fraseFuente(texto, f.nombre);
      await insertarSenal(db, { id: `${id}-f${i}`, sucursalId: fila.sucursal_id, audioId: id, tipo: "faltante", items, estado: "pendiente", frase, nowIso });
    }
    // Ventas posibles: autocierra si ya hay venta POS en la ventana (asistencia de registro, §8).
    const ventas = senales.ventas.filter((v) => v.confianza >= UMBRAL_SENAL);
    const hayVenta = ventas.length > 0 ? await hayVentaEnVentana(db, fila.sucursal_id, fila.grabado_at, VENTANA_VENTA_MS) : false;
    for (let i = 0; i < ventas.length; i++) {
      const v = ventas[i]!;
      const items: SenalItem[] = v.items.map((it) => ({ producto_id: null, nombre_detectado: it.nombre, cantidad: it.cantidad, confianza: v.confianza }));
      const frase = fraseFuente(texto, v.items.map((it) => it.nombre).join(" "));
      await insertarSenal(db, { id: `${id}-v${i}`, sucursalId: fila.sucursal_id, audioId: id, tipo: "venta_posible", items, estado: hayVenta ? "autocerrado" : "pendiente", frase, nowIso });
    }
  }
  await marcarProcesado(db, id);
  return "procesado";
}

// Pipeline completo de la ingesta (waitUntil): transcribe y, si salió texto, extrae señales — para
// llegar a la señal en pantalla en <2 min. El Cron cubre lo que este waitUntil no alcance.
export async function procesarAudio(
  db: D1Database,
  env: Bindings,
  id: string,
  opts: { transcribir?: Transcriptor; extraer?: Extractor } = {},
): Promise<"transcrito" | "error" | "sin_habla" | "omitido"> {
  const r = await transcribirAudio(db, env, id, opts.transcribir);
  if (r === "transcrito") await procesarSenales(db, env, id, opts.extraer);
  return r;
}

// Barre los 'transcrito' pendientes de extracción (la corre el Cron tras barrerAudios). Extractor inyectable.
export async function barrerSenales(db: D1Database, env: Bindings, opts: { max: number; extraer?: Extractor }): Promise<{ procesados: number }> {
  const filas = await transcritosPendientes(db, opts.max);
  let procesados = 0;
  for (const f of filas) {
    await procesarSenales(db, env, f.id, opts.extraer);
    procesados++;
  }
  return { procesados };
}

// ── Bandeja de señales (Mostrador, badge 🎙️) — lee/actúa scoped por sucursal (ya resuelta y verificada
// en la ruta). Sin actor: opera por sucursal_id validado (aislamiento en la ruta). D-N5: nunca toca operador. ──
export type SenalPendiente = {
  id: string; tipo: string; created_at: string;
  frase: string | null; transcripcion: string | null; audio_id: string | null;
  items: (SenalItem & { producto_nombre: string | null })[];
};

export function audioSenalRepo(db: D1Database) {
  return {
    // Señales pendientes de la sucursal, enriquecidas con: el nombre del producto matcheado (si hay),
    // la FRASE-fuente y la transcripción completa del chunk (B10.4.2, contexto) + audio_id (reproductor).
    async pendientes(sucursalId: string): Promise<SenalPendiente[]> {
      const { results } = await withRetry(() =>
        db
          .prepare(
            `SELECT s.id, s.tipo, s.items_json, s.created_at, s.frase, s.audio_id, g.transcripcion
             FROM audio_senal s LEFT JOIN audio_grabacion g ON g.id = s.audio_id
             WHERE s.sucursal_id = ?1 AND s.estado = 'pendiente' ORDER BY s.created_at DESC LIMIT 50`,
          )
          .bind(sucursalId)
          .all<{ id: string; tipo: string; items_json: string; created_at: string; frase: string | null; audio_id: string | null; transcripcion: string | null }>(),
      );
      const filas = results ?? [];
      const senales = filas.map((r) => ({ id: r.id, tipo: r.tipo, created_at: r.created_at, frase: r.frase, transcripcion: r.transcripcion, audio_id: r.audio_id, items: parseItems(r.items_json) }));
      // Resuelve el nombre de catálogo de los producto_id matcheados (una sola query).
      const ids = [...new Set(senales.flatMap((s) => s.items.map((i) => i.producto_id).filter((x): x is string => !!x)))];
      const nombres = await nombresDeProductos(db, ids);
      return senales.map((s) => ({
        ...s,
        items: s.items.map((it) => ({ ...it, producto_nombre: it.producto_id ? (nombres.get(it.producto_id) ?? null) : null })),
      }));
    },

    // Confirma una señal pendiente de la sucursal. faltante → quiebre REAL (sin operador, D-N5);
    // venta_posible → marca confirmado (el operador registra la venta por el flujo normal; liga venta_id si lo pasa).
    // `productoId` (opcional, solo faltante) = "corregir": el humano elige el producto correcto cuando el
    // match salió mal o vacío → ese producto va al quiebre Y se APRENDE la corrección (forma oída → producto).
    async confirmar(senalId: string, sucursalId: string, opts: { nowIso: string; ventaId?: string | null; productoId?: string | null }): Promise<{ estado: string; quiebre_id?: string; venta_id?: string | null; idempotent?: boolean }> {
      const senal = await withRetry(() =>
        db
          .prepare(`SELECT s.id, s.tipo, s.items_json, s.estado, su.tenant_id FROM audio_senal s JOIN sucursal su ON su.id = s.sucursal_id WHERE s.id = ?1 AND s.sucursal_id = ?2`)
          .bind(senalId, sucursalId)
          .first<{ id: string; tipo: string; items_json: string; estado: string; tenant_id: string }>(),
      );
      if (!senal) throw noEncontrado("señal de audio");
      if (senal.estado !== "pendiente") return { estado: senal.estado, idempotent: true };

      if (senal.tipo === "faltante") {
        const primero = parseItems(senal.items_json)[0];
        // Override de "corregir": si vino un producto, debe ser del tenant (si no, 404). Gana sobre el match.
        const override = opts.productoId?.trim() || null;
        if (override && !(await productoDelTenant(db, senal.tenant_id, override))) throw noEncontrado("producto");
        const productoId = override ?? primero?.producto_id ?? null;
        // VETO D-N5: el quiebre nace del audio ambiente → operadorId NULL (no se atribuye a nadie).
        const q = await quiebreRepo(db).registrar({
          clientUuid: `senal:${senalId}`,
          sucursalId,
          operadorId: null,
          productoId,
          gtinConsultado: null,
          descripcionLibre: productoId ? null : (primero?.nombre_detectado ?? "faltante detectado por audio"),
          nowIso: opts.nowIso,
        });
        await withRetry(() =>
          db.prepare(`UPDATE audio_senal SET estado = 'confirmado', quiebre_id = ?2, updated_at = ?3 WHERE id = ?1 AND estado = 'pendiente'`).bind(senalId, q.id, opts.nowIso).run(),
        );
        // Aprende la corrección: la forma oída ahora apunta a este producto (los próximos audios matchean solos).
        if (productoId) await aprenderCorreccion(db, senal.tenant_id, normalizarNombre(primero?.nombre_detectado ?? ""), productoId, opts.nowIso);
        return { estado: "confirmado", quiebre_id: q.id };
      }
      // venta_posible
      await withRetry(() =>
        db.prepare(`UPDATE audio_senal SET estado = 'confirmado', venta_id = ?2, updated_at = ?3 WHERE id = ?1 AND estado = 'pendiente'`).bind(senalId, opts.ventaId ?? null, opts.nowIso).run(),
      );
      return { estado: "confirmado", venta_id: opts.ventaId ?? null };
    },

    // Descarta una señal pendiente de la sucursal (no era faltante / no aplica). 404 si es ajena.
    async descartar(senalId: string, sucursalId: string, nowIso: string): Promise<void> {
      const res = await withRetry(() =>
        db.prepare(`UPDATE audio_senal SET estado = 'descartado', updated_at = ?3 WHERE id = ?1 AND sucursal_id = ?2 AND estado = 'pendiente'`).bind(senalId, sucursalId, nowIso).run(),
      );
      if ((res.meta?.changes ?? 0) === 0) {
        const existe = await withRetry(() => db.prepare(`SELECT 1 AS x FROM audio_senal WHERE id = ?1 AND sucursal_id = ?2`).bind(senalId, sucursalId).first<{ x: number }>());
        if (!existe) throw noEncontrado("señal de audio"); // ajena o inexistente → aislamiento
        // existe pero ya no estaba pendiente → idempotente (no-op)
      }
    },
  };
}

// ── Diccionario de correcciones aprendidas (B10.3) — curación desde el panel admin (admin+). Es
// vocabulario del tenant (forma oída → producto), NUNCA personal (VETO D-N5: sin operador). ──
export type CorreccionListada = { id: string; texto_norm: string; producto_id: string; producto_nombre: string | null; veces: number; updated_at: string };

export function audioCorreccionRepo(db: D1Database, tenantId: string) {
  return {
    // Correcciones del tenant, más reforzadas primero (las que más se equivoca Whisper).
    async listar(): Promise<CorreccionListada[]> {
      const { results } = await withRetry(() =>
        db
          .prepare(
            `SELECT c.id, c.texto_norm, c.producto_id, p.nombre AS producto_nombre, c.veces, c.updated_at
             FROM audio_correccion c LEFT JOIN producto_catalogo p ON p.id = c.producto_id
             WHERE c.tenant_id = ?1 ORDER BY c.veces DESC, c.updated_at DESC LIMIT 200`,
          )
          .bind(tenantId)
          .all<CorreccionListada>(),
      );
      return results ?? [];
    },

    // Enseña "texto oído → producto" y, de paso, re-matchea las señales de faltante pendientes de la
    // sucursal cuyo nombre oído normaliza a ese texto (el operador ya ve el producto sin re-grabar).
    async enseniar(p: { texto: string; productoId: string; sucursalId: string; nowIso: string }): Promise<{ aprendida: boolean; senales_actualizadas: number }> {
      const textoNorm = normalizarNombre(p.texto ?? "");
      if (!textoNorm) throw validacion("texto a corregir vacío");
      if (!(await productoDelTenant(db, tenantId, p.productoId))) throw noEncontrado("producto");
      await aprenderCorreccion(db, tenantId, textoNorm, p.productoId, p.nowIso);

      const { results } = await withRetry(() =>
        db.prepare(`SELECT id, items_json FROM audio_senal WHERE sucursal_id = ?1 AND tipo = 'faltante' AND estado = 'pendiente'`).bind(p.sucursalId).all<{ id: string; items_json: string }>(),
      );
      let n = 0;
      for (const s of results ?? []) {
        const items = parseItems(s.items_json);
        const it = items[0];
        if (it && !it.producto_id && normalizarNombre(it.nombre_detectado) === textoNorm) {
          it.producto_id = p.productoId;
          await withRetry(() =>
            db.prepare(`UPDATE audio_senal SET items_json = ?2, updated_at = ?3 WHERE id = ?1 AND estado = 'pendiente'`).bind(s.id, JSON.stringify(items), p.nowIso).run(),
          );
          n++;
        }
      }
      return { aprendida: true, senales_actualizadas: n };
    },

    // Borra una corrección equivocada (p.ej. un auto-aprendizaje de un match errado).
    async borrar(id: string): Promise<void> {
      await withRetry(() => db.prepare(`DELETE FROM audio_correccion WHERE id = ?1 AND tenant_id = ?2`).bind(id, tenantId).run());
    },
  };
}

// Parseo defensivo de items_json (nunca revienta la bandeja si una fila trae basura).
function parseItems(json: string): SenalItem[] {
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((it) => {
      const o = it as Record<string, unknown>;
      return {
        producto_id: typeof o?.producto_id === "string" ? o.producto_id : null,
        nombre_detectado: typeof o?.nombre_detectado === "string" ? o.nombre_detectado : "",
        cantidad: typeof o?.cantidad === "number" ? o.cantidad : null,
        confianza: typeof o?.confianza === "number" ? o.confianza : 0,
      };
    });
  } catch {
    return [];
  }
}

async function nombresDeProductos(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(", ");
  const { results } = await withRetry(() =>
    db.prepare(`SELECT id, nombre FROM producto_catalogo WHERE id IN (${placeholders})`).bind(...ids).all<{ id: string; nombre: string }>(),
  );
  for (const r of results ?? []) map.set(r.id, r.nombre);
  return map;
}

// ============================================================
// B10.3 (§8) — Reporte de calidad del audio. El Cron upserta un snapshot diario por sucursal
// (audio_reporte_calidad, PK sucursal+fecha); el panel admin lee el historial y calcula "hoy" en vivo.
// TODO el SQL vive aquí; algunas queries tocan audio_senal → NO cruzan personal (VETO D-N5).
// ============================================================

// Señal se cuenta "de baja confianza" si su primer ítem quedó por debajo de este umbral (dudosa → revisar).
const UMBRAL_BAJA_CONF = 0.6;

export type CalidadDia = {
  fecha: string;
  transcritos: number; procesados: number; errores: number; sin_habla: number;
  senales: number; senales_sin_match: number; senales_baja_conf: number;
};
export type SinMatchPendiente = { id: string; nombre_detectado: string; confianza: number; created_at: string; frase: string | null; transcripcion: string | null; audio_id: string | null };
export type ErrorReciente = { id: string; error_detalle: string | null; created_at: string };
export type ReporteCalidad = { dias: CalidadDia[]; sin_match: SinMatchPendiente[]; errores: ErrorReciente[] };

// Cuenta la salud del audio de UNA sucursal en UN día (YYYY-MM-DD, por substr del created_at ISO/UTC).
async function calcularCalidadSucursalDia(db: D1Database, sucursalId: string, fecha: string): Promise<Omit<CalidadDia, "fecha">> {
  const grab = await withRetry(() =>
    db.prepare(`SELECT estado, sin_habla, COUNT(*) AS n FROM audio_grabacion WHERE sucursal_id = ?1 AND date(created_at,'-5 hours') = ?2 GROUP BY estado, sin_habla`).bind(sucursalId, fecha).all<{ estado: string; sin_habla: number; n: number }>(),
  );
  let transcritos = 0, procesados = 0, errores = 0, sinHabla = 0;
  for (const r of grab.results ?? []) {
    if (r.sin_habla === 1) sinHabla += r.n; // chunk sin voz (estado 'procesado' + flag) — no cuenta como transcrito
    else if (r.estado === "procesado") { procesados += r.n; transcritos += r.n; } // procesado real ya pasó por transcripción
    else if (r.estado === "transcrito") transcritos += r.n;
    else if (r.estado === "error") errores += r.n;
  }
  const sen = await withRetry(() =>
    db.prepare(`SELECT tipo, items_json FROM audio_senal WHERE sucursal_id = ?1 AND date(created_at,'-5 hours') = ?2`).bind(sucursalId, fecha).all<{ tipo: string; items_json: string }>(),
  );
  let senales = 0, sinMatch = 0, bajaConf = 0;
  for (const r of sen.results ?? []) {
    senales++;
    const it = parseItems(r.items_json)[0];
    if (r.tipo === "faltante" && it && !it.producto_id) sinMatch++;
    if (it && it.confianza < UMBRAL_BAJA_CONF) bajaConf++;
  }
  return { transcritos, procesados, errores, sin_habla: sinHabla, senales, senales_sin_match: sinMatch, senales_baja_conf: bajaConf };
}

// Upsert del snapshot de HOY para cada sucursal con actividad de audio hoy (lo corre el Cron; idempotente
// por PK sucursal+fecha → cada corrida recalcula "hoy" y lo pisa, así el panel lo ve casi al día).
export async function actualizarReporteCalidad(db: D1Database): Promise<{ sucursales: number }> {
  const hoy = fechaLocal(); // día LOCAL Lima (coherente con caja/dashboard), no UTC
  const { results } = await withRetry(() =>
    db
      .prepare(
        `SELECT DISTINCT sucursal_id FROM audio_grabacion WHERE date(created_at,'-5 hours') = ?1
         UNION SELECT DISTINCT sucursal_id FROM audio_senal WHERE date(created_at,'-5 hours') = ?1`,
      )
      .bind(hoy)
      .all<{ sucursal_id: string }>(),
  );
  const sucs = results ?? [];
  const nowIso = new Date().toISOString();
  for (const s of sucs) {
    const c = await calcularCalidadSucursalDia(db, s.sucursal_id, hoy);
    await withRetry(() =>
      db
        .prepare(
          `INSERT INTO audio_reporte_calidad (sucursal_id, fecha, transcritos, procesados, errores, sin_habla, senales, senales_sin_match, senales_baja_conf, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
           ON CONFLICT (sucursal_id, fecha) DO UPDATE SET
             transcritos = excluded.transcritos, procesados = excluded.procesados, errores = excluded.errores,
             sin_habla = excluded.sin_habla, senales = excluded.senales, senales_sin_match = excluded.senales_sin_match,
             senales_baja_conf = excluded.senales_baja_conf, updated_at = excluded.updated_at`,
        )
        .bind(s.sucursal_id, hoy, c.transcritos, c.procesados, c.errores, c.sin_habla, c.senales, c.senales_sin_match, c.senales_baja_conf, nowIso)
        .run(),
    );
  }
  return { sucursales: sucs.length };
}

// Reporte para el panel admin: "hoy" calculado en vivo + los días previos desde el snapshot, más las
// listas accionables (faltantes pendientes SIN match para enseñar corrección + audios en 'error').
export async function reporteCalidad(db: D1Database, sucursalId: string, dias: number): Promise<ReporteCalidad> {
  const hoy = fechaLocal(); // día LOCAL Lima (coherente con caja/dashboard), no UTC
  const hoyLive: CalidadDia = { fecha: hoy, ...(await calcularCalidadSucursalDia(db, sucursalId, hoy)) };
  const prev = await withRetry(() =>
    db
      .prepare(
        `SELECT fecha, transcritos, procesados, errores, sin_habla, senales, senales_sin_match, senales_baja_conf
         FROM audio_reporte_calidad WHERE sucursal_id = ?1 AND fecha < ?2 ORDER BY fecha DESC LIMIT ?3`,
      )
      .bind(sucursalId, hoy, Math.max(0, dias - 1))
      .all<CalidadDia>(),
  );

  const pend = await withRetry(() =>
    db
      .prepare(
        `SELECT s.id, s.items_json, s.created_at, s.frase, s.audio_id, g.transcripcion
         FROM audio_senal s LEFT JOIN audio_grabacion g ON g.id = s.audio_id
         WHERE s.sucursal_id = ?1 AND s.tipo = 'faltante' AND s.estado = 'pendiente' ORDER BY s.created_at DESC LIMIT 50`,
      )
      .bind(sucursalId)
      .all<{ id: string; items_json: string; created_at: string; frase: string | null; audio_id: string | null; transcripcion: string | null }>(),
  );
  const sinMatch: SinMatchPendiente[] = [];
  for (const r of pend.results ?? []) {
    const it = parseItems(r.items_json)[0];
    if (it && !it.producto_id) sinMatch.push({ id: r.id, nombre_detectado: it.nombre_detectado, confianza: it.confianza, created_at: r.created_at, frase: r.frase, transcripcion: r.transcripcion, audio_id: r.audio_id });
  }

  const err = await withRetry(() =>
    db.prepare(`SELECT id, error_detalle, created_at FROM audio_grabacion WHERE sucursal_id = ?1 AND estado = 'error' ORDER BY created_at DESC LIMIT 20`).bind(sucursalId).all<ErrorReciente>(),
  );

  return { dias: [hoyLive, ...(prev.results ?? [])], sin_match: sinMatch, errores: err.results ?? [] };
}

// ============================================================
// B10.4.3 — Reproductor de audio + retención/purga para el QA del piloto (3 meses). Sirve el chunk de
// R2 vía el Worker (proxy autenticado admin+, como el proxy de fotos del bot) y purga TODO el audio del
// tenant al cerrar la prueba (salvaguarda LPDP — Ley 29733: el audio del mostrador puede tener datos de
// salud). NO cruza con personal (VETO D-N5): solo audio_grabacion/audio_senal por sucursal→tenant.
// La retención (7→30 días) es un cambio de infra al desplegar (wrangler r2 bucket lifecycle), no código.
// ============================================================
export function audioMediaRepo(db: D1Database, actor: Actor) {
  const tenantId = actor.tenantId;
  return {
    // Clave R2 de un chunk. Aislamiento como el proxy de fotos (recepcion-borrador.propio): el super ve
    // todo su tenant; un admin_sucursal SOLO su sucursal (D-N8). null si es ajeno/inexistente → 404.
    async claveAudio(audioId: string): Promise<string | null> {
      const row = await withRetry(() =>
        db
          .prepare(`SELECT g.r2_key, g.sucursal_id FROM audio_grabacion g JOIN sucursal s ON s.id = g.sucursal_id WHERE g.id = ?1 AND s.tenant_id = ?2`)
          .bind(audioId, tenantId)
          .first<{ r2_key: string; sucursal_id: string }>(),
      );
      if (!row) return null;
      if (!esSuper(actor) && actor.sucursalId && row.sucursal_id !== actor.sucursalId) return null; // otra sucursal del tenant → 404
      return row.r2_key;
    },

    // Todas las claves R2 del audio del tenant (para borrarlas de R2 antes de purgar). Solo super (la ruta lo exige).
    async clavesAudioTenant(): Promise<string[]> {
      const { results } = await withRetry(() =>
        db
          .prepare(`SELECT g.r2_key FROM audio_grabacion g JOIN sucursal s ON s.id = g.sucursal_id WHERE s.tenant_id = ?1`)
          .bind(tenantId)
          .all<{ r2_key: string }>(),
      );
      return (results ?? []).map((r) => r.r2_key);
    },

    // Purga las filas de audio del tenant (señales primero por la FK audio_senal→audio_grabacion).
    // NO toca los quiebres reales creados al confirmar faltantes (son data operativa, no audio).
    async purgarAudioTenant(): Promise<{ grabaciones: number }> {
      const antes = await withRetry(() =>
        db.prepare(`SELECT COUNT(*) AS n FROM audio_grabacion g JOIN sucursal s ON s.id = g.sucursal_id WHERE s.tenant_id = ?1`).bind(tenantId).first<{ n: number }>(),
      );
      const sucQuery = `SELECT id FROM sucursal WHERE tenant_id = ?1`;
      const b = (sql: string) => db.prepare(sql).bind(tenantId);
      await withRetry(() =>
        db.batch([
          b(`DELETE FROM audio_senal WHERE sucursal_id IN (${sucQuery})`),
          b(`DELETE FROM audio_grabacion WHERE sucursal_id IN (${sucQuery})`),
        ]),
      );
      return { grabaciones: antes?.n ?? 0 };
    },
  };
}
