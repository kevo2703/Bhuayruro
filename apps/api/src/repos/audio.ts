// Audio A10 casi-tiempo-real (B10.1 §8). Ingesta de chunks del grabador + transcripción Whisper.
// Todo el SQL vive aquí (canal prohibido §4.4 #14). Tres capas:
//   - audioRepo(db, actor)        → ingesta como DISPOSITIVO (scoped por su sucursal).
//   - audioSistemaRepo(db)        → transiciones de estado sin actor (las corre la ingesta y el Cron).
//   - transcribirAudio / barrer*  → orquestación (lee R2 → Whisper → persiste); transcriptor inyectable.
//
// La transcripción se dispara en la ingesta (ctx.waitUntil) para latencia <2 min; el Cron cada 5 min
// barre los que quedaron 'subido' porque el waitUntil no llegó (Worker desalojado, etc.).

import type { ActorDispositivo, Bindings } from "../types";
import { transcribirBytes } from "../lib/whisper";
import { withRetry } from "./base";

export type AudioRow = { id: string; sucursal_id: string; r2_key: string; estado: string };

// Firma del transcriptor (inyectable): en producción = Whisper; en tests = un fake determinista
// (evita llamar a Workers AI real — la suite no debe generar cargos de IA).
export type Transcriptor = (env: Bindings, bytes: Uint8Array) => Promise<string | null>;

// Barredora: solo toca 'subido' con al menos este tiempo de vida (dar margen al waitUntil de la ingesta).
const ANTIGUEDAD_BARREDORA_MS = 2 * 60_000;
const MAX_POR_BARRIDA = 50;

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
export async function barrerAudiosPendientes(env: Bindings): Promise<{ procesados: number; transcritos: number; errores: number }> {
  const cutoffIso = new Date(Date.now() - ANTIGUEDAD_BARREDORA_MS).toISOString();
  return barrerAudios(env.DB, env, { cutoffIso, max: MAX_POR_BARRIDA });
}
