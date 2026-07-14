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
  cobertura_dias?: number | null; // aditivo: días de stock a la velocidad de venta (null si no rota)
};

// Ventana de velocidad de venta para la cobertura (días de stock). 30 días da una velocidad estable.
const VENTANA_VELOCIDAD_DIAS = 30;
const TROZO_VELOCIDAD = 90; // gotcha D1: ≤100 binds/query

// Inventario POR sucursal (stock en unidades base). La sucursal ya viene resuelta (lib/scope).
export function inventarioRepo(db: D1Database) {
  return {
    async listar(sucursalId: string, bajoMinimo = false): Promise<InventarioFila[]> {
      const sql = `SELECT i.id, i.producto_id, p.nombre, i.stock_unidades, i.stock_minimo, i.updated_at
                   FROM inventario_local i JOIN producto_catalogo p ON p.id = i.producto_id
                   WHERE i.sucursal_id = ?1 AND p.deleted_at IS NULL ${bajoMinimo ? "AND i.stock_unidades <= i.stock_minimo" : ""}
                   ORDER BY p.nombre LIMIT 500`;
      const r = await withRetry(() => db.prepare(sql).bind(sucursalId).all<InventarioFila>());
      const filas = r.results;

      // Cobertura (días de stock) para la lista de stock bajo: stock / velocidad_diaria, donde
      // velocidad = unidades base vendidas del producto en la sucursal en los últimos 30 días / 30.
      // Si velocidad = 0 (no rotó) → null (no inventamos cobertura infinita). Aditivo.
      if (bajoMinimo && filas.length > 0) {
        const desde = new Date(Date.now() - VENTANA_VELOCIDAD_DIAS * 86_400_000).toISOString();
        const productoIds = filas.map((f) => f.producto_id);
        const vendidas = new Map<string, number>();
        for (let i = 0; i < productoIds.length; i += TROZO_VELOCIDAD) {
          const grupo = productoIds.slice(i, i + TROZO_VELOCIDAD);
          const ph = grupo.map((_, j) => `?${j + 3}`).join(",");
          const v = await withRetry(() =>
            db
              .prepare(
                `SELECT vi.producto_id AS producto_id, COALESCE(SUM(vi.cantidad),0) AS unidades
                 FROM venta_item vi JOIN venta v ON v.id = vi.venta_id
                 WHERE v.sucursal_id = ?1 AND v.estado = 'completada' AND v.fecha_hora >= ?2 AND vi.producto_id IN (${ph})
                 GROUP BY vi.producto_id`,
              )
              .bind(sucursalId, desde, ...grupo)
              .all<{ producto_id: string; unidades: number }>(),
          );
          for (const row of v.results ?? []) vendidas.set(row.producto_id, row.unidades);
        }
        for (const f of filas) {
          const velocidad = (vendidas.get(f.producto_id) ?? 0) / VENTANA_VELOCIDAD_DIAS;
          f.cobertura_dias = velocidad > 0 ? Math.round(f.stock_unidades / velocidad) : null;
        }
      }
      return filas;
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
