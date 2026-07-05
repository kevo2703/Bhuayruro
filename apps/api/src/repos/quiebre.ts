import { uuidv7 } from "@huayruro/shared";
import { withRetry } from "./base";

// Quiebres (§8 POST /api/quiebres): producto pedido que no había. Idempotente por client_uuid
// (funciona offline vía la cola). Alimenta el consolidado de faltantes (quiebres 14 días).
export function quiebreRepo(db: D1Database) {
  return {
    async registrar(input: {
      clientUuid: string;
      sucursalId: string;
      operadorId: string | null;
      productoId: string | null;
      gtinConsultado: string | null;
      descripcionLibre: string | null;
      nowIso: string;
    }): Promise<{ id: string; idempotent: boolean }> {
      const id = uuidv7();
      await withRetry(() =>
        db
          .prepare(
            `INSERT INTO quiebre (id, client_uuid, sucursal_id, operador_id, producto_id, gtin_consultado, descripcion_libre, fecha_hora)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (client_uuid) DO NOTHING`,
          )
          .bind(id, input.clientUuid, input.sucursalId, input.operadorId, input.productoId, input.gtinConsultado, input.descripcionLibre, input.nowIso)
          .run(),
      );
      const fila = await withRetry(() =>
        db.prepare(`SELECT id FROM quiebre WHERE client_uuid = ?1`).bind(input.clientUuid).first<{ id: string }>(),
      );
      return { id: fila?.id ?? id, idempotent: (fila?.id ?? id) !== id };
    },

    async listar(sucursalId: string, dias = 30): Promise<Record<string, unknown>[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT q.id, q.producto_id, p.nombre, q.gtin_consultado, q.descripcion_libre, q.fecha_hora
             FROM quiebre q LEFT JOIN producto_catalogo p ON p.id = q.producto_id
             WHERE q.sucursal_id = ?1 AND q.fecha_hora >= ?2 ORDER BY q.fecha_hora DESC LIMIT 200`,
          )
          .bind(sucursalId, new Date(Date.now() - dias * 86_400_000).toISOString())
          .all(),
      );
      return r.results as Record<string, unknown>[];
    },
  };
}
