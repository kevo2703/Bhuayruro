import { uuidv7 } from "@huayruro/shared";
import { noEncontrado } from "../lib/errores";
import { withRetry } from "./base";

export type InventarioFila = {
  id: string;
  producto_id: string;
  nombre: string;
  stock_unidades: number;
  stock_minimo: number;
  updated_at: string;
};

// Inventario POR sucursal (stock en unidades base). La sucursal ya viene resuelta (lib/scope).
export function inventarioRepo(db: D1Database) {
  return {
    async listar(sucursalId: string, bajoMinimo = false): Promise<InventarioFila[]> {
      const sql = `SELECT i.id, i.producto_id, p.nombre, i.stock_unidades, i.stock_minimo, i.updated_at
                   FROM inventario_local i JOIN producto_catalogo p ON p.id = i.producto_id
                   WHERE i.sucursal_id = ?1 AND p.deleted_at IS NULL ${bajoMinimo ? "AND i.stock_unidades <= i.stock_minimo" : ""}
                   ORDER BY p.nombre LIMIT 500`;
      const r = await withRetry(() => db.prepare(sql).bind(sucursalId).all<InventarioFila>());
      return r.results;
    },

    // Alertas de vencimiento (§8 GET /api/inventario/lotes?vence_antes=). Solo lotes con stock.
    async lotesPorVencer(sucursalId: string, venceAntes?: string): Promise<Record<string, unknown>[]> {
      const filtro = venceAntes ? "AND l.fecha_vencimiento <= ?2" : "";
      const stmt = venceAntes
        ? db.prepare(
            `SELECT l.id, l.numero_lote, l.fecha_vencimiento, l.unidades, i.producto_id, p.nombre
             FROM lote l JOIN inventario_local i ON i.id = l.inventario_id JOIN producto_catalogo p ON p.id = i.producto_id
             WHERE i.sucursal_id = ?1 AND l.unidades > 0 ${filtro} ORDER BY l.fecha_vencimiento ASC`,
          ).bind(sucursalId, venceAntes)
        : db.prepare(
            `SELECT l.id, l.numero_lote, l.fecha_vencimiento, l.unidades, i.producto_id, p.nombre
             FROM lote l JOIN inventario_local i ON i.id = l.inventario_id JOIN producto_catalogo p ON p.id = i.producto_id
             WHERE i.sucursal_id = ?1 AND l.unidades > 0 ORDER BY l.fecha_vencimiento ASC LIMIT 200`,
          ).bind(sucursalId);
      const r = await withRetry(() => stmt.all());
      return r.results as Record<string, unknown>[];
    },

    // Fija el stock mínimo de un producto en MI sucursal (§8 PATCH /inventario/:productoId/minimo).
    async fijarMinimo(productoId: string, sucursalId: string, minimo: number, nowIso: string): Promise<void> {
      const r = await withRetry(() =>
        db
          .prepare(`UPDATE inventario_local SET stock_minimo = ?3, updated_at = ?4 WHERE producto_id = ?1 AND sucursal_id = ?2`)
          .bind(productoId, sucursalId, minimo, nowIso)
          .run(),
      );
      if (!r.meta.changes) throw noEncontrado("inventario");
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
