import { uuidv7 } from "@huayruro/shared";
import { apiRequest, ApiError } from "./api";
import type { ColaOp, HuayruroDB, TipoOp } from "./db-local";

// Cola de escrituras idempotente (§9). SIEMPRE se escribe primero en la cola (aunque haya red);
// el flusher la vacía en orden FIFO con backoff. La idempotencia por client_uuid (UUID v7) hace
// que reenviar una op tras un corte NO duplique nada en D1 (el server no-opea — §7.3).

export type ResultadoEnvio =
  | { tipo: "confirmada"; venta_id?: string | null }
  | { tipo: "rechazada"; error: string } // 4xx de negocio/validación → bandeja del admin
  | { tipo: "reintentar"; error: string }; // red/5xx/401 → sigue en cola

export type EnviarFn = (op: ColaOp) => Promise<ResultadoEnvio>;

const RUTA: Record<TipoOp, string> = {
  venta: "/ventas",
  quiebre: "/quiebres",
  recepcion: "/recepciones",
  no_sale: "/eventos-caja/no-sale",
  // A4: qué pasó con la tarjeta de sugerencia. Va por la cola y no por un fetch directo porque en
  // hora punta nada del mostrador puede quedarse esperando a la red. Idempotente por el id de cada
  // evento (el server hace ON CONFLICT DO NOTHING), no por el client_uuid de la op.
  sugerencia: "/sugerencias/eventos",
};

// Backoff 1s / 5s / 30s / 5min (plan §9). `intentos` ≥1 → índice intentos-1 (1.er reintento = 1s).
const BACKOFF_MS = [1_000, 5_000, 30_000, 300_000];
const backoff = (intentos: number) => BACKOFF_MS[Math.min(Math.max(intentos - 1, 0), BACKOFF_MS.length - 1)]!;

// Encola una operación (venta/quiebre/recepción). Devuelve el client_uuid (idempotencia).
export async function encolar(db: HuayruroDB, tipo: TipoOp, payload: Record<string, unknown>): Promise<string> {
  const clientUuid = (payload.client_uuid as string | undefined) ?? uuidv7();
  const op: ColaOp = {
    client_uuid: clientUuid,
    tipo,
    payload: { ...payload, client_uuid: clientUuid },
    creado_at: new Date().toISOString(),
    estado: "pendiente",
    intentos: 0,
    ultimo_error: null,
    proximo_intento_at: null,
    venta_id: null,
  };
  await db.cola_ops.put(op);
  return clientUuid;
}

// Enviador real: mapea tipo→endpoint y clasifica el resultado. 2xx→confirmada; 4xx negocio→
// rechazada; red/5xx/401→reintentar (la cola conserva la op y reintenta más tarde).
export function crearEnviador(getToken: () => string | null): EnviarFn {
  return async (op: ColaOp): Promise<ResultadoEnvio> => {
    try {
      const r = await apiRequest<{ venta_id?: string; idempotent?: boolean }>(RUTA[op.tipo], {
        method: "POST",
        body: op.payload,
        token: getToken(),
        reintentos: 0, // el reintento lo maneja la cola, no el cliente HTTP
      });
      return { tipo: "confirmada", venta_id: r.venta_id ?? null };
    } catch (e) {
      if (e instanceof ApiError && e.esDefinitivo) return { tipo: "rechazada", error: `${e.codigo}: ${e.message}` };
      return { tipo: "reintentar", error: e instanceof Error ? e.message : String(e) };
    }
  };
}

export type ResumenFlush = { confirmadas: number; rechazadas: number; pendientes: number };

// Vacía la cola UNA vez en orden FIFO. Reentrante y seguro de llamar repetidamente (online,
// timer, apertura). Procesa 'pendiente' y 'enviando' (esta última = op que quedó a medias por
// un cierre abrupto: reenviar es seguro por idempotencia). Respeta el backoff (proximo_intento_at).
export async function flushUnaVez(db: HuayruroDB, enviar: EnviarFn, ahora = Date.now()): Promise<ResumenFlush> {
  const pendientes = (await db.cola_ops.where("estado").anyOf(["pendiente", "enviando"]).toArray()).sort((a, b) =>
    a.creado_at < b.creado_at ? -1 : a.creado_at > b.creado_at ? 1 : 0,
  );
  let confirmadas = 0;
  let rechazadas = 0;
  let siguenPendientes = 0;
  for (const op of pendientes) {
    if (op.proximo_intento_at && new Date(op.proximo_intento_at).getTime() > ahora) {
      siguenPendientes++;
      continue;
    }
    await db.cola_ops.update(op.client_uuid, { estado: "enviando" });
    const r = await enviar(op);
    if (r.tipo === "confirmada") {
      await db.cola_ops.update(op.client_uuid, { estado: "confirmada", venta_id: r.venta_id ?? null, ultimo_error: null });
      confirmadas++;
    } else if (r.tipo === "rechazada") {
      await db.cola_ops.update(op.client_uuid, { estado: "rechazada", ultimo_error: r.error });
      rechazadas++;
    } else {
      const intentos = op.intentos + 1;
      await db.cola_ops.update(op.client_uuid, {
        estado: "pendiente",
        intentos,
        ultimo_error: r.error,
        proximo_intento_at: new Date(ahora + backoff(intentos)).toISOString(),
      });
      siguenPendientes++;
    }
  }
  return { confirmadas, rechazadas, pendientes: siguenPendientes };
}

// Arranca el flusher: vacía al inicio, al evento `online` y cada `intervaloMs`. Devuelve stop().
export function iniciarFlusher(db: HuayruroDB, enviar: EnviarFn, intervaloMs = 15_000): () => void {
  let corriendo = false;
  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await flushUnaVez(db, enviar);
    } catch {
      /* nunca romper la UI por el flusher */
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
