// Audio A10 casi-tiempo-real (B10.1 §8). Ingesta de chunks del grabador + transcripción Whisper.
// Todo el SQL vive aquí (canal prohibido §4.4 #14). Tres capas:
//   - audioRepo(db, actor)        → ingesta como DISPOSITIVO (scoped por su sucursal).
//   - audioSistemaRepo(db)        → transiciones de estado sin actor (las corre la ingesta y el Cron).
//   - transcribirAudio / barrer*  → orquestación (lee R2 → Whisper → persiste); transcriptor inyectable.
//
// La transcripción se dispara en la ingesta (ctx.waitUntil) para latencia <2 min; el Cron cada 5 min
// barre los que quedaron 'subido' porque el waitUntil no llegó (Worker desalojado, etc.).

import { normalizarNombre } from "@huayruro/shared";
import { noEncontrado } from "../lib/errores";
import type { ActorDispositivo, Bindings } from "../types";
import { transcribirBytes } from "../lib/whisper";
import { extraerSenalesIA, type Extractor } from "../lib/senales";
import { withRetry } from "./base";
import { quiebreRepo } from "./quiebre";

export type AudioRow = { id: string; sucursal_id: string; r2_key: string; estado: string };

// Firma del transcriptor (inyectable): en producción = Whisper; en tests = un fake determinista
// (evita llamar a Workers AI real — la suite no debe generar cargos de IA).
export type Transcriptor = (env: Bindings, bytes: Uint8Array) => Promise<string | null>;

// Barredora: solo toca 'subido' con al menos este tiempo de vida (dar margen al waitUntil de la ingesta).
const ANTIGUEDAD_BARREDORA_MS = 2 * 60_000;
const MAX_POR_BARRIDA = 50;
// Cotejo de venta_posible: ventana ±10 min alrededor del audio contra las ventas POS de la sucursal (§8).
const VENTANA_VENTA_MS = 10 * 60_000;

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

    // Recientes de una sucursal (para el panel del admin / estado de la grabadora). sucursalId ya resuelto por la ruta.
    async recientes(sucursalId: string, limite: number): Promise<{ id: string; estado: string; duracion_seg: number | null; grabado_at: string; transcripcion: string | null; error_detalle: string | null }[]> {
      const { results } = await withRetry(() =>
        db
          .prepare(`SELECT id, estado, duracion_seg, grabado_at, transcripcion, error_detalle FROM audio_grabacion WHERE sucursal_id = ?1 ORDER BY created_at DESC LIMIT ?2`)
          .bind(sucursalId, limite)
          .all<{ id: string; estado: string; duracion_seg: number | null; grabado_at: string; transcripcion: string | null; error_detalle: string | null }>(),
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
): Promise<"transcrito" | "error" | "omitido"> {
  const repo = audioSistemaRepo(db);
  const row = await repo.obtener(id);
  if (!row || row.estado !== "subido") return "omitido"; // ya procesado o inexistente
  const obj = env.MEDIA ? await env.MEDIA.get(row.r2_key) : null;
  if (!obj) {
    await repo.marcarError(id, "audio ausente en R2");
    return "error";
  }
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const texto = await transcribir(env, bytes);
  if (texto == null) {
    await repo.marcarError(id, "sin transcripción (IA no disponible o audio ilegible)");
    return "error";
  }
  await repo.guardarTranscripcion(id, texto);
  return "transcrito";
}

// Procesa un lote de 'subido' viejos (uno por uno; el volumen del piloto es bajo). Transcriptor inyectable.
export async function barrerAudios(
  db: D1Database,
  env: Bindings,
  opts: { cutoffIso: string; max: number; transcribir?: Transcriptor },
): Promise<{ procesados: number; transcritos: number; errores: number }> {
  const filas = await audioSistemaRepo(db).pendientes(opts.cutoffIso, opts.max);
  let transcritos = 0;
  let errores = 0;
  for (const f of filas) {
    const r = await transcribirAudio(db, env, f.id, opts.transcribir);
    if (r === "transcrito") transcritos++;
    else if (r === "error") errores++;
  }
  return { procesados: filas.length, transcritos, errores };
}

// Entrada del Cron (la invoca worker.ts). env.DB se toca AQUÍ (repos/), nunca en worker.ts (§4.4 #14).
// Dos barridos: (1) transcribe los 'subido' que el waitUntil no alcanzó; (2) extrae señales de los
// 'transcrito' cuyo waitUntil no llegó a la fase B10.2 (Worker desalojado entre una fase y la otra).
export async function barrerAudiosPendientes(env: Bindings): Promise<{ procesados: number; transcritos: number; errores: number; senales: number }> {
  const cutoffIso = new Date(Date.now() - ANTIGUEDAD_BARREDORA_MS).toISOString();
  const t = await barrerAudios(env.DB, env, { cutoffIso, max: MAX_POR_BARRIDA });
  const s = await barrerSenales(env.DB, env, { max: MAX_POR_BARRIDA });
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

// Matchea un nombre detectado contra el catálogo del tenant (FTS). Primero todos los tokens (AND);
// si no pega, el token más largo (más informativo) solo. v1: primero-que-pega-gana; el humano confirma.
async function matchProductoTenant(db: D1Database, tenantId: string, nombre: string): Promise<{ producto_id: string; nombre: string } | null> {
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
  p: { id: string; sucursalId: string; audioId: string; tipo: "faltante" | "venta_posible"; items: SenalItem[]; estado: string; nowIso: string },
): Promise<void> {
  await withRetry(() =>
    db
      .prepare(
        `INSERT OR IGNORE INTO audio_senal (id, sucursal_id, audio_id, tipo, items_json, estado, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      )
      .bind(p.id, p.sucursalId, p.audioId, p.tipo, JSON.stringify(p.items), p.estado, p.nowIso)
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
    for (let i = 0; i < senales.faltantes.length; i++) {
      const f = senales.faltantes[i]!;
      const match = await matchProductoTenant(db, fila.tenant_id, f.nombre);
      const items: SenalItem[] = [{ producto_id: match?.producto_id ?? null, nombre_detectado: f.nombre, cantidad: f.cantidad, confianza: f.confianza }];
      await insertarSenal(db, { id: `${id}-f${i}`, sucursalId: fila.sucursal_id, audioId: id, tipo: "faltante", items, estado: "pendiente", nowIso });
    }
    // Ventas posibles: autocierra si ya hay venta POS en la ventana (asistencia de registro, §8).
    const hayVenta = senales.ventas.length > 0 ? await hayVentaEnVentana(db, fila.sucursal_id, fila.grabado_at, VENTANA_VENTA_MS) : false;
    for (let i = 0; i < senales.ventas.length; i++) {
      const v = senales.ventas[i]!;
      const items: SenalItem[] = v.items.map((it) => ({ producto_id: null, nombre_detectado: it.nombre, cantidad: it.cantidad, confianza: v.confianza }));
      await insertarSenal(db, { id: `${id}-v${i}`, sucursalId: fila.sucursal_id, audioId: id, tipo: "venta_posible", items, estado: hayVenta ? "autocerrado" : "pendiente", nowIso });
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
): Promise<"transcrito" | "error" | "omitido"> {
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
export type SenalPendiente = { id: string; tipo: string; created_at: string; items: (SenalItem & { producto_nombre: string | null })[] };

export function audioSenalRepo(db: D1Database) {
  return {
    // Señales pendientes de la sucursal, enriquecidas con el nombre del producto matcheado (si hay).
    async pendientes(sucursalId: string): Promise<SenalPendiente[]> {
      const { results } = await withRetry(() =>
        db
          .prepare(`SELECT id, tipo, items_json, created_at FROM audio_senal WHERE sucursal_id = ?1 AND estado = 'pendiente' ORDER BY created_at DESC LIMIT 50`)
          .bind(sucursalId)
          .all<{ id: string; tipo: string; items_json: string; created_at: string }>(),
      );
      const filas = results ?? [];
      const senales = filas.map((r) => ({ id: r.id, tipo: r.tipo, created_at: r.created_at, items: parseItems(r.items_json) }));
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
    async confirmar(senalId: string, sucursalId: string, opts: { nowIso: string; ventaId?: string | null }): Promise<{ estado: string; quiebre_id?: string; venta_id?: string | null; idempotent?: boolean }> {
      const senal = await withRetry(() =>
        db.prepare(`SELECT id, tipo, items_json, estado FROM audio_senal WHERE id = ?1 AND sucursal_id = ?2`).bind(senalId, sucursalId).first<{ id: string; tipo: string; items_json: string; estado: string }>(),
      );
      if (!senal) throw noEncontrado("señal de audio");
      if (senal.estado !== "pendiente") return { estado: senal.estado, idempotent: true };

      if (senal.tipo === "faltante") {
        const primero = parseItems(senal.items_json)[0];
        // VETO D-N5: el quiebre nace del audio ambiente → operadorId NULL (no se atribuye a nadie).
        const q = await quiebreRepo(db).registrar({
          clientUuid: `senal:${senalId}`,
          sucursalId,
          operadorId: null,
          productoId: primero?.producto_id ?? null,
          gtinConsultado: null,
          descripcionLibre: primero?.producto_id ? null : (primero?.nombre_detectado ?? "faltante detectado por audio"),
          nowIso: opts.nowIso,
        });
        await withRetry(() =>
          db.prepare(`UPDATE audio_senal SET estado = 'confirmado', quiebre_id = ?2, updated_at = ?3 WHERE id = ?1 AND estado = 'pendiente'`).bind(senalId, q.id, opts.nowIso).run(),
        );
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
