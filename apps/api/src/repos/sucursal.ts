import { esSuper } from "../lib/scope";
import type { Actor } from "../types";
import { withRetry } from "./base";

export type SucursalFila = { id: string; nombre: string; direccion: string | null; activa: number };

// Aislamiento (plan §4.3): super_admin ve las sucursales del tenant; el resto SOLO la suya.
export function sucursalRepo(db: D1Database, actor: Actor) {
  return {
    async listar(): Promise<SucursalFila[]> {
      if (esSuper(actor)) {
        const r = await withRetry(() =>
          db
            .prepare(
              `SELECT id, nombre, direccion, activa FROM sucursal
               WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY nombre`,
            )
            .bind(actor.tenantId)
            .all<SucursalFila>(),
        );
        return r.results;
      }
      if (!actor.sucursalId) return [];
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT id, nombre, direccion, activa FROM sucursal
             WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
          )
          .bind(actor.sucursalId, actor.tenantId)
          .all<SucursalFila>(),
      );
      return r.results;
    },
  };
}
