import Dexie, { type Table } from "dexie";
import { uuidv7 } from "@huayruro/shared";
import { planEviccion, TOPE_COLA_AUDIO_BYTES } from "./grabadora";

// Cola offline de chunks de audio del A10 (B10.1 §8 / plan §13). Store aparte de la cola del POS:
// los blobs son grandes y con tope FIFO de 200 MB. Idempotente por client_uuid (= id de la fila y del
// objeto R2 en el server) → reintentar tras un corte NO duplica. Modo avión → online = se vacía sola.

export type ChunkAudio = {
  client_uuid: string;
  blob: Blob;
  bytes: number;
  duracion_seg: number;
  grabado_at: string;
  creado_at: string;
  intentos: number;
  proximo_intento_at: string | null;
};

export class GrabadoraDB extends Dexie {
  chunks!: Table<ChunkAudio, string>;
  constructor(nombre = "huayruro-grabadora") {
    super(nombre);
    // PK = client_uuid (idempotencia); índice por creado_at para el orden FIFO.
    this.version(1).stores({ chunks: "client_uuid, creado_at" });
  }
}

export const dbGrabadora = new GrabadoraDB();

// Encola un chunk. Antes de guardar, evicta los más viejos si se pasaría del tope (FIFO 200 MB).
// `topeBytes` es inyectable para los tests (evita crear blobs de 200 MB).
export async function encolarChunk(
  db: GrabadoraDB,
  blob: Blob,
  meta: { duracionSeg: number; grabadoAt: string },
  topeBytes = TOPE_COLA_AUDIO_BYTES,
): Promise<string> {
  const existentes = (await db.chunks.orderBy("creado_at").toArray()).map((c) => ({ client_uuid: c.client_uuid, bytes: c.bytes }));
  const borrar = planEviccion(existentes, blob.size, topeBytes);
  if (borrar.length) await db.chunks.bulkDelete(borrar);
  const client_uuid = uuidv7();
  await db.chunks.put({
    client_uuid,
    blob,
    bytes: blob.size,
    duracion_seg: meta.duracionSeg,
    grabado_at: meta.grabadoAt,
    creado_at: new Date().toISOString(),
    intentos: 0,
    proximo_intento_at: null,
  });
  return client_uuid;
}

// Resultado de subir un chunk: ok (borrar), reintentar (red/5xx → backoff), definitivo (4xx: token
// malo/dispositivo desactivado → borrar y avisar; no tiene sentido reintentar en bucle).
export type ResultadoChunk = "ok" | "reintentar" | "definitivo";
export type SubirChunkFn = (c: ChunkAudio) => Promise<ResultadoChunk>;

const BACKOFF_MS = [1_000, 5_000, 30_000, 300_000];
const backoff = (intentos: number) => BACKOFF_MS[Math.min(Math.max(intentos - 1, 0), BACKOFF_MS.length - 1)]!;

// Vacía la cola UNA vez en orden FIFO, respetando el backoff. Reentrante.
export async function flushAudioUnaVez(
  db: GrabadoraDB,
  subir: SubirChunkFn,
  ahora = Date.now(),
): Promise<{ subidos: number; pendientes: number; definitivos: number }> {
  const cola = await db.chunks.orderBy("creado_at").toArray();
  let subidos = 0;
  let pendientes = 0;
  let definitivos = 0;
  for (const c of cola) {
    if (c.proximo_intento_at && new Date(c.proximo_intento_at).getTime() > ahora) {
      pendientes++;
      continue;
    }
    const r = await subir(c);
    if (r === "ok") {
      await db.chunks.delete(c.client_uuid);
      subidos++;
    } else if (r === "definitivo") {
      await db.chunks.delete(c.client_uuid);
      definitivos++;
    } else {
      const intentos = c.intentos + 1;
      await db.chunks.update(c.client_uuid, { intentos, proximo_intento_at: new Date(ahora + backoff(intentos)).toISOString() });
      pendientes++;
    }
  }
  return { subidos, pendientes, definitivos };
}

// Enviador real: POST /api/audio con el token de DISPOSITIVO. Cuerpo = blob crudo; metadatos por query.
export function crearSubidorAudio(getToken: () => string | null): SubirChunkFn {
  return async (c: ChunkAudio): Promise<ResultadoChunk> => {
    const token = getToken();
    if (!token) return "reintentar";
    let res: Response;
    try {
      res = await fetch(
        `/api/audio?client_uuid=${encodeURIComponent(c.client_uuid)}&grabado_at=${encodeURIComponent(c.grabado_at)}&duracion_seg=${c.duracion_seg}`,
        // credentials:"omit" → NO arrastrar la cookie de sesión de un admin logueado en el mismo
        // navegador; el grabador se autentica SOLO con su token de dispositivo (Bearer). Ver también
        // la precedencia Bearer>cookie en el server (mw/auth.ts).
        { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": c.blob.type || "audio/webm" }, body: c.blob, credentials: "omit" },
      );
    } catch {
      return "reintentar"; // sin red
    }
    if (res.ok) return "ok"; // 201 nuevo o 200 idempotente
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) return "definitivo";
    return "reintentar"; // 5xx / 503
  };
}

// Arranca el flusher: vacía al inicio, al volver la conexión y cada intervalo. Devuelve stop().
export function iniciarFlusherAudio(
  db: GrabadoraDB,
  subir: SubirChunkFn,
  onResumen?: (r: { subidos: number; pendientes: number; definitivos: number }) => void,
  intervaloMs = 10_000,
): () => void {
  let corriendo = false;
  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      const r = await flushAudioUnaVez(db, subir);
      onResumen?.(r);
    } catch {
      /* nunca romper la grabación por el flusher */
    } finally {
      corriendo = false;
    }
  };
  const alConectar = () => void tick();
  window.addEventListener("online", alConectar);
  const timer = setInterval(() => void tick(), intervaloMs);
  void tick();
  return () => {
    window.removeEventListener("online", alConectar);
    clearInterval(timer);
  };
}
