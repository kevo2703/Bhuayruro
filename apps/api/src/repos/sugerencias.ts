import { errorDeRegla, normalizarRegla, uuidv7, type ReglaEntrante, type ResultadoSugerencia } from "@huayruro/shared";
import { noEncontrado, validacion } from "../lib/errores";
import type { Actor } from "../types";
import { withRetry } from "./base";

// ============================================================
// A4 — Venta cruzada por reglas (plan de expansión §2 A4). Δ5 ya estaba migrada en
// `0001_esquema_p0.sql:301-321`: esta sesión escribe el código, no el esquema.
//
// AISLAMIENTO (dos niveles distintos a propósito, §2.3 D-N7):
//   · `regla_sugerencia` es de TENANT — la cadena cura sus consejos una vez y valen en sus boticas.
//     Toda consulta filtra `tenant_id`; una regla ajena es 404, no 403.
//   · `sugerencia_evento` es de SUCURSAL — la conversión es de CADA botica y no cruza a las otras.
//   · `sugerido_producto_id` se verifica contra el catálogo del tenant ANTES de guardar: sin eso,
//     una regla podría apuntar al producto de otra cadena y su nombre saldría impreso en la tarjeta
//     del mostrador. Es la fuga menos obvia de este frente.
//
// IDEMPOTENCIA: el id de cada evento lo genera el POS y acá se inserta con ON CONFLICT DO NOTHING.
// La cola offline reintenta la misma op tras un corte y no duplica ni infla la conversión.
//
// SOLES AGREGADOS: se derivan de `venta_item` de la venta enlazada (dinero real que entró), NUNCA
// del precio de lista guardado al momento de sugerir. Si la sugerencia se aceptó y después se
// quitó del carrito, o la venta se anuló, esos soles no existen y la tabla no debe decir que sí.
// ============================================================

// Marcador de las reglas demo, misma convención que la purga del catálogo sintético del importador:
// prefijo fijo en el id → la pantalla las puede rotular y borrar de un tap.
const PREFIJO_DEMO = "90000000-0000-7000-8000-";
const ES_DEMO_SQL = `(CASE WHEN r.id LIKE '${PREFIJO_DEMO}%' THEN 1 ELSE 0 END)`;

export type ReglaFila = {
  id: string;
  disparador_tipo: string;
  disparador_valor: string;
  sugerido_producto_id: string;
  sugerido_nombre: string;
  guion: string;
  prioridad: number;
  activa: number;
  es_demo: number;
  created_at: string;
};

export type ReglaConversion = ReglaFila & {
  mostradas: number;
  aceptadas: number;
  rechazadas: number;
  soles_cent: number;
};

/** Payload mínimo que el motor del Mostrador cachea en Dexie (sin nada que no use). */
export type ReglaMotor = {
  id: string;
  disparador_tipo: string;
  disparador_valor: string;
  sugerido_producto_id: string;
  guion: string;
  prioridad: number;
};

export type EventoEntrante = { id: string; regla_id: string; resultado: string; fecha_hora?: string | null };

/** Edición parcial de una regla (el PATCH distingue "no vino" de "vino en otro valor"). */
export type CamposRegla = Partial<ReglaEntrante> & { activa?: boolean };

const RESULTADOS = new Set<string>(["mostrada", "aceptada", "rechazada"]);

// Tope de eventos por op de la cola: una atención genera 2 (mostrada + resultado). Un número mayor
// solo puede venir de un cliente roto o manipulado; se corta acá y no en la base.
export const MAX_EVENTOS_POR_OP = 50;

export function sugerenciasRepo(db: D1Database, actor: Actor) {
  const tid = actor.tenantId;

  const reglaPropia = async (id: string): Promise<{ id: string }> => {
    const r = await withRetry(() =>
      db.prepare(`SELECT id FROM regla_sugerencia WHERE id = ?1 AND tenant_id = ?2`).bind(id, tid).first<{ id: string }>(),
    );
    if (!r) throw noEncontrado("regla");
    return r;
  };

  // El producto sugerido tiene que ser del MISMO tenant y estar vivo: una regla que apunta a un
  // producto borrado deja la tarjeta sin nombre ni precio en el mostrador.
  const productoPropio = async (productoId: string): Promise<void> => {
    const p = await withRetry(() =>
      db
        .prepare(`SELECT id FROM producto_catalogo WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`)
        .bind(productoId, tid)
        .first<{ id: string }>(),
    );
    if (!p) throw noEncontrado("producto");
  };

  const obtener = async (id: string): Promise<ReglaFila | null> =>
    withRetry(() =>
      db
        .prepare(
          `SELECT r.id, r.disparador_tipo, r.disparador_valor, r.sugerido_producto_id, p.nombre AS sugerido_nombre,
                  r.guion, r.prioridad, r.activa, r.created_at, ${ES_DEMO_SQL} AS es_demo
           FROM regla_sugerencia r
           JOIN producto_catalogo p ON p.id = r.sugerido_producto_id
           WHERE r.id = ?1 AND r.tenant_id = ?2`,
        )
        .bind(id, tid)
        .first<ReglaFila>(),
    );

  return {
    obtener,

    /** Reglas ACTIVAS para el motor del POS (se cachean en Dexie y corren sin red). */
    async paraMotor(): Promise<ReglaMotor[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT r.id, r.disparador_tipo, r.disparador_valor, r.sugerido_producto_id, r.guion, r.prioridad
             FROM regla_sugerencia r
             JOIN producto_catalogo p ON p.id = r.sugerido_producto_id AND p.deleted_at IS NULL AND p.activo = 1
             WHERE r.tenant_id = ?1 AND r.activa = 1
             ORDER BY r.prioridad DESC, r.id`,
          )
          .bind(tid)
          .all<ReglaMotor>(),
      );
      return r.results ?? [];
    },

    /**
     * Tablero del admin: todas las reglas del tenant + la conversión de UNA botica. La conversión
     * viaja junta con la regla a propósito — la pantalla existe para PODAR lo que no convierte, y
     * separar los números de la regla obligaría a cruzarlos a ojo.
     */
    async conversion(sucursalId: string): Promise<ReglaConversion[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT r.id, r.disparador_tipo, r.disparador_valor, r.sugerido_producto_id,
                    p.nombre AS sugerido_nombre, r.guion, r.prioridad, r.activa, r.created_at,
                    ${ES_DEMO_SQL} AS es_demo,
                    COALESCE(ev.mostradas, 0)  AS mostradas,
                    COALESCE(ev.aceptadas, 0)  AS aceptadas,
                    COALESCE(ev.rechazadas, 0) AS rechazadas,
                    COALESCE(so.soles_cent, 0) AS soles_cent
             FROM regla_sugerencia r
             JOIN producto_catalogo p ON p.id = r.sugerido_producto_id
             LEFT JOIN (
               SELECT regla_id,
                      SUM(CASE WHEN resultado = 'mostrada'  THEN 1 ELSE 0 END) AS mostradas,
                      SUM(CASE WHEN resultado = 'aceptada'  THEN 1 ELSE 0 END) AS aceptadas,
                      SUM(CASE WHEN resultado = 'rechazada' THEN 1 ELSE 0 END) AS rechazadas
               FROM sugerencia_evento WHERE sucursal_id = ?2 GROUP BY regla_id
             ) ev ON ev.regla_id = r.id
             LEFT JOIN (
               -- Soles REALES: lo que la venta cobró de ese producto. DISTINCT por (regla, venta)
               -- para que dos eventos de la misma regla en una venta no cuenten la plata dos veces.
               SELECT e.regla_id, SUM(vi.total_cent) AS soles_cent
               FROM (SELECT DISTINCT regla_id, venta_id FROM sugerencia_evento
                     WHERE sucursal_id = ?2 AND resultado = 'aceptada' AND venta_id IS NOT NULL) e
               JOIN regla_sugerencia r2 ON r2.id = e.regla_id
               JOIN venta v  ON v.id = e.venta_id AND v.estado = 'completada'
               JOIN venta_item vi ON vi.venta_id = e.venta_id AND vi.producto_id = r2.sugerido_producto_id
               GROUP BY e.regla_id
             ) so ON so.regla_id = r.id
             WHERE r.tenant_id = ?1
             ORDER BY r.activa DESC, aceptadas DESC, r.prioridad DESC, p.nombre`,
          )
          .bind(tid, sucursalId)
          .all<ReglaConversion>(),
      );
      return r.results ?? [];
    },

    async crear(entrante: ReglaEntrante, nowIso: string): Promise<ReglaFila> {
      const err = errorDeRegla(entrante);
      if (err) throw validacion(err);
      const r = normalizarRegla(entrante);
      await productoPropio(r.sugerido_producto_id);
      if (r.disparador_tipo === "producto") await productoPropio(r.disparador_valor);

      const id = uuidv7();
      await withRetry(() =>
        db
          .prepare(
            `INSERT INTO regla_sugerencia (id, tenant_id, disparador_tipo, disparador_valor, sugerido_producto_id, guion, prioridad, activa, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)`,
          )
          .bind(id, tid, r.disparador_tipo, r.disparador_valor, r.sugerido_producto_id, r.guion, r.prioridad, nowIso)
          .run(),
      );
      const fila = await obtener(id);
      if (!fila) throw noEncontrado("regla");
      return fila;
    },

    /**
     * Edición parcial. `activa` es el interruptor que de verdad se usa en la operación: apagar una
     * regla que no convierte conserva su historial; borrarla lo pierde.
     */
    async actualizar(id: string, campos: CamposRegla): Promise<ReglaFila> {
      const actual = await obtener(id);
      if (!actual) throw noEncontrado("regla");

      const fusion: ReglaEntrante = {
        disparador_tipo: campos.disparador_tipo ?? actual.disparador_tipo,
        disparador_valor: campos.disparador_valor ?? actual.disparador_valor,
        sugerido_producto_id: campos.sugerido_producto_id ?? actual.sugerido_producto_id,
        guion: campos.guion ?? actual.guion,
        prioridad: campos.prioridad ?? actual.prioridad,
      };
      const err = errorDeRegla(fusion);
      if (err) throw validacion(err);
      const r = normalizarRegla(fusion);
      if (r.sugerido_producto_id !== actual.sugerido_producto_id) await productoPropio(r.sugerido_producto_id);
      if (r.disparador_tipo === "producto" && r.disparador_valor !== actual.disparador_valor) await productoPropio(r.disparador_valor);
      const activa = campos.activa === undefined ? actual.activa : campos.activa ? 1 : 0;

      await withRetry(() =>
        db
          .prepare(
            `UPDATE regla_sugerencia
                SET disparador_tipo = ?3, disparador_valor = ?4, sugerido_producto_id = ?5, guion = ?6, prioridad = ?7, activa = ?8
              WHERE id = ?1 AND tenant_id = ?2`,
          )
          .bind(id, tid, r.disparador_tipo, r.disparador_valor, r.sugerido_producto_id, r.guion, r.prioridad, activa)
          .run(),
      );
      const fila = await obtener(id);
      if (!fila) throw noEncontrado("regla");
      return fila;
    },

    /**
     * Borrado real (la tabla no tiene soft-delete) junto con sus eventos, en UN batch: la FK de
     * `sugerencia_evento.regla_id` no deja huérfanos, y dejar los eventos sin su regla convertiría
     * la tabla de conversión en filas anónimas. Se devuelve cuántos eventos se llevó por delante
     * para que la pantalla lo pueda advertir ANTES de borrar.
     */
    async eliminar(id: string): Promise<{ eventos_borrados: number }> {
      await reglaPropia(id);
      const c = await withRetry(() =>
        db.prepare(`SELECT COUNT(*) AS n FROM sugerencia_evento WHERE regla_id = ?1`).bind(id).first<{ n: number }>(),
      );
      await withRetry(() =>
        db.batch([
          db.prepare(`DELETE FROM sugerencia_evento WHERE regla_id = ?1`).bind(id),
          db.prepare(`DELETE FROM regla_sugerencia WHERE id = ?1 AND tenant_id = ?2`).bind(id, tid),
        ]),
      );
      return { eventos_borrados: c?.n ?? 0 };
    },

    /** Cuántos eventos perdería un borrado (la pantalla lo pregunta antes de confirmar). */
    async contarEventos(id: string): Promise<number> {
      await reglaPropia(id);
      const c = await withRetry(() =>
        db.prepare(`SELECT COUNT(*) AS n FROM sugerencia_evento WHERE regla_id = ?1`).bind(id).first<{ n: number }>(),
      );
      return c?.n ?? 0;
    },

    /**
     * Registro de lo que pasó con la tarjeta. Llega por la cola offline al CERRAR la atención, con
     * el `client_uuid` de la venta cuando hubo venta (la cola es FIFO: la venta se envía primero,
     * así que acá ya existe). Sin venta —la persona se fue— los eventos igual se guardan: si solo
     * contáramos las atenciones que terminaron en compra, la conversión saldría inflada.
     */
    async registrarEventos(
      sucursalId: string,
      datos: { eventos: EventoEntrante[]; ventaClientUuid?: string | null; nowIso: string },
    ): Promise<{ registrados: number; ignorados: number; venta_id: string | null }> {
      const entrantes = datos.eventos.filter(
        (e) => typeof e?.id === "string" && e.id.trim() !== "" && typeof e.regla_id === "string" && RESULTADOS.has(e.resultado),
      );
      if (entrantes.length === 0) throw validacion("eventos requeridos (id, regla_id, resultado)");
      if (entrantes.length > MAX_EVENTOS_POR_OP) throw validacion(`máximo ${MAX_EVENTOS_POR_OP} eventos por envío`);

      // Filtro de aislamiento: solo sobreviven las reglas de MI tenant. Un id ajeno (o una regla
      // que el admin borró mientras la tarjeta estaba en pantalla) no escribe nada.
      const ids = [...new Set(entrantes.map((e) => e.regla_id))];
      const marcadores = ids.map((_, i) => `?${i + 2}`).join(", ");
      const propias = await withRetry(() =>
        db
          .prepare(`SELECT id FROM regla_sugerencia WHERE tenant_id = ?1 AND id IN (${marcadores})`)
          .bind(tid, ...ids)
          .all<{ id: string }>(),
      );
      const validas = new Set((propias.results ?? []).map((r) => r.id));
      const aInsertar = entrantes.filter((e) => validas.has(e.regla_id));
      if (aInsertar.length === 0) throw noEncontrado("regla");

      let ventaId: string | null = null;
      const clientUuid = datos.ventaClientUuid?.trim();
      if (clientUuid) {
        const v = await withRetry(() =>
          db
            .prepare(`SELECT id FROM venta WHERE client_uuid = ?1 AND sucursal_id = ?2`)
            .bind(clientUuid, sucursalId)
            .first<{ id: string }>(),
        );
        ventaId = v?.id ?? null; // Sin venta todavía (o rechazada): el evento vale igual, sin plata.
      }

      await withRetry(() =>
        db.batch(
          aInsertar.map((e) =>
            db
              .prepare(
                `INSERT INTO sugerencia_evento (id, sucursal_id, regla_id, venta_id, resultado, fecha_hora)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO NOTHING`,
              )
              .bind(e.id, sucursalId, e.regla_id, ventaId, e.resultado as ResultadoSugerencia, e.fecha_hora?.trim() || datos.nowIso),
          ),
        ),
      );
      return { registrados: aInsertar.length, ignorados: entrantes.length - aInsertar.length, venta_id: ventaId };
    },
  };
}
