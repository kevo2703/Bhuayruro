import { uuidv7 } from "@huayruro/shared";
import { noEncontrado } from "../lib/errores";
import { withRetry } from "./base";

export type InventarioFila = {
  id: string;
  producto_id: string;
  stock_unidades: number;
  stock_minimo: number;
  updated_at: string;
};

// Inventario POR sucursal (stock en unidades base). La sucursal ya viene resuelta (lib/scope).
export function inventarioRepo(db: D1Database) {
  return {
    async listar(sucursalId: string, bajoMinimo = false): Promise<InventarioFila[]> {
      const sql = `SELECT id, producto_id, stock_unidades, stock_minimo, updated_at FROM inventario_local
                   WHERE sucursal_id = ?1 ${bajoMinimo ? "AND stock_unidades <= stock_minimo" : ""}
                   ORDER BY producto_id`;
      const r = await withRetry(() => db.prepare(sql).bind(sucursalId).all<InventarioFila>());
      return r.results;
    },

    // Ajuste por conteo físico, direccionado por inventario_id (direct id).
    // 404 si el inventario pertenece a otra sucursal (§4.4 #9).
    // sucursalId = null → super_admin (sin restricción). No-null → debe coincidir o 404.
    async ajustarPorId(
      inventarioId: string,
      sucursalId: string | null,
      nuevaCantidad: number,
      motivo: string,
      operadorId: string | null,
      nowIso: string,
    ): Promise<void> {
      const fila = await withRetry(() =>
        db
          .prepare(`SELECT sucursal_id, producto_id FROM inventario_local WHERE id = ?1`)
          .bind(inventarioId)
          .first<{ sucursal_id: string; producto_id: string }>(),
      );
      if (!fila || (sucursalId !== null && fila.sucursal_id !== sucursalId)) throw noEncontrado("inventario");

      const movId = uuidv7();
      const movUuid = uuidv7();
      await withRetry(() =>
        db.batch([
          db
            .prepare(`UPDATE inventario_local SET stock_unidades = ?2, updated_at = ?3 WHERE id = ?1`)
            .bind(inventarioId, nuevaCantidad, nowIso),
          db
            .prepare(
              `INSERT INTO movimiento_stock (id, client_uuid, sucursal_id, producto_id, tipo, cantidad, motivo, operador_id, fecha_hora)
               VALUES (?1, ?2, ?3, ?4, 'ajuste_inventario', ?5, ?6, ?7, ?8)`,
            )
            .bind(movId, movUuid, fila.sucursal_id, fila.producto_id, nuevaCantidad, motivo, operadorId, nowIso),
        ]),
      );
    },
  };
}
