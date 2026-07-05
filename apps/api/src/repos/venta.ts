import type { CabeceraCalculo } from "@huayruro/shared";
import { conflicto, noEncontrado } from "../lib/errores";
import { esSuper } from "../lib/scope";
import type { Actor } from "../types";
import { withRetry } from "./base";

export type VentaResumen = {
  id: string;
  client_uuid: string;
  sucursal_id: string;
  estado: string;
  subtotal_sin_igv_cent: number;
  igv_total_cent: number;
  total_cent: number;
  metodo_pago: string;
  fecha_hora: string;
};

type MetodoPago = "efectivo" | "yape" | "plin" | "tarjeta" | "transferencia" | "otro";

// ⚠️ S1 MINIMAL: solo inserta la CABECERA de la venta para probar aislamiento (E4).
// El batch atómico completo (FEFO cascada + venta_item + venta_item_lote + movimiento +
// audit, §7.3 TAL CUAL) se implementa en S2/E6 y REEMPLAZA este método.
export function ventaRepo(db: D1Database) {
  return {
    async crearCabeceraMinima(input: {
      vId: string;
      clientUuid: string;
      sucursalId: string;
      operadorId: string | null;
      nowIso: string;
      cab: CabeceraCalculo;
      metodoPago: MetodoPago;
      observaciones: string | null;
      fechaHoraCliente: string | null;
    }): Promise<{ ventaId: string; idempotent: boolean; resumen: VentaResumen }> {
      await withRetry(() =>
        db
          .prepare(
            `INSERT INTO venta (id, client_uuid, sucursal_id, operador_id, fecha_hora, fecha_hora_cliente,
                                subtotal_sin_igv_cent, igv_total_cent, total_cent, metodo_pago,
                                observaciones, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?5, ?5)
             ON CONFLICT (client_uuid) DO NOTHING`,
          )
          .bind(
            input.vId,
            input.clientUuid,
            input.sucursalId,
            input.operadorId,
            input.nowIso,
            input.fechaHoraCliente,
            input.cab.subtotalSinIgvCent,
            input.cab.igvTotalCent,
            input.cab.totalCent,
            input.metodoPago,
            input.observaciones,
          )
          .run(),
      );
      const resumen = await withRetry(() =>
        db
          .prepare(
            `SELECT id, client_uuid, sucursal_id, estado, subtotal_sin_igv_cent, igv_total_cent, total_cent, metodo_pago, fecha_hora
             FROM venta WHERE client_uuid = ?1`,
          )
          .bind(input.clientUuid)
          .first<VentaResumen>(),
      );
      if (!resumen) throw conflicto("no se pudo registrar la venta");
      return { ventaId: resumen.id, idempotent: resumen.id !== input.vId, resumen };
    },

    async obtener(id: string, actor: Actor): Promise<VentaResumen | null> {
      const base = `SELECT v.id, v.client_uuid, v.sucursal_id, v.estado, v.subtotal_sin_igv_cent, v.igv_total_cent,
                           v.total_cent, v.metodo_pago, v.fecha_hora
                    FROM venta v JOIN sucursal s ON s.id = v.sucursal_id WHERE v.id = ?1`;
      if (esSuper(actor)) {
        return withRetry(() => db.prepare(`${base} AND s.tenant_id = ?2`).bind(id, actor.tenantId).first<VentaResumen>());
      }
      return withRetry(() =>
        db.prepare(`${base} AND v.sucursal_id = ?2`).bind(id, actor.sucursalId).first<VentaResumen>(),
      );
    },

    // ⚠️ S1 MINIMAL: marca anulada sin reponer lotes/stock. La reposición del §7.6 es S2/E6.
    async anularMinima(id: string, actor: Actor, motivo: string, nowIso: string): Promise<void> {
      const existente = await this.obtener(id, actor);
      if (!existente) throw noEncontrado("venta");
      if (existente.estado === "anulada") throw conflicto("la venta ya está anulada");
      await withRetry(() =>
        db
          .prepare(
            `UPDATE venta SET estado = 'anulada', anulada_motivo = ?2, updated_at = ?3
             WHERE id = ?1 AND estado = 'completada'`,
          )
          .bind(id, motivo, nowIso)
          .run(),
      );
    },
  };
}
