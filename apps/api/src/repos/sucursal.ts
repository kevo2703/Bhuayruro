import { uuidv7 } from "@huayruro/shared";
import { esSuper } from "../lib/scope";
import { noEncontrado, validacion } from "../lib/errores";
import type { Actor } from "../types";
import { withRetry } from "./base";

export type SucursalFila = { id: string; nombre: string; direccion: string | null; activa: number; hora_apertura: string | null; hora_cierre: string | null };

// Aislamiento (plan §4.3): super_admin ve las sucursales del tenant; el resto SOLO la suya.
export function sucursalRepo(db: D1Database, actor: Actor) {
  return {
    async listar(): Promise<SucursalFila[]> {
      if (esSuper(actor)) {
        const r = await withRetry(() =>
          db
            .prepare(
              `SELECT id, nombre, direccion, activa, hora_apertura, hora_cierre FROM sucursal
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
            `SELECT id, nombre, direccion, activa, hora_apertura, hora_cierre FROM sucursal
             WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
          )
          .bind(actor.sucursalId, actor.tenantId)
          .all<SucursalFila>(),
      );
      return r.results;
    },

    // Crear sucursal (solo super; la ruta ya lo garantiza). Scoping por tenant del actor.
    async crear(input: { nombre: string; direccion: string | null; nowIso: string }): Promise<{ id: string }> {
      if (!input.nombre.trim()) throw validacion("nombre requerido");
      const id = uuidv7();
      await withRetry(() =>
        db
          .prepare(`INSERT INTO sucursal (id, tenant_id, nombre, direccion, activa, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)`)
          .bind(id, actor.tenantId, input.nombre.trim(), input.direccion, input.nowIso)
          .run(),
      );
      return { id };
    },

    // Editar sucursal (solo super). 404 si es de otro tenant.
    async actualizar(id: string, campos: { nombre?: string | undefined; direccion?: string | null | undefined; activa?: boolean | undefined }): Promise<void> {
      const fila = await withRetry(() =>
        db.prepare(`SELECT id FROM sucursal WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`).bind(id, actor.tenantId).first<{ id: string }>(),
      );
      if (!fila) throw noEncontrado("sucursal");
      await withRetry(() =>
        db
          .prepare(
            `UPDATE sucursal SET nombre = COALESCE(?2, nombre), direccion = COALESCE(?3, direccion),
               activa = COALESCE(?4, activa) WHERE id = ?1 AND tenant_id = ?5`,
          )
          .bind(id, campos.nombre?.trim() ?? null, campos.direccion ?? null, campos.activa === undefined ? null : campos.activa ? 1 : 0, actor.tenantId)
          .run(),
      );
    },

    // Fija el horario declarado de la sucursal (para el indicador EBR 'fuera de horario', B11.1). Permite
    // limpiar a NULL explícitamente (apagar el control de horario) — por eso no usa COALESCE. Solo super.
    async fijarHorario(id: string, horaApertura: string | null, horaCierre: string | null): Promise<void> {
      const fila = await withRetry(() =>
        db.prepare(`SELECT id FROM sucursal WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`).bind(id, actor.tenantId).first<{ id: string }>(),
      );
      if (!fila) throw noEncontrado("sucursal");
      await withRetry(() =>
        db
          .prepare(`UPDATE sucursal SET hora_apertura = ?2, hora_cierre = ?3 WHERE id = ?1 AND tenant_id = ?4`)
          .bind(id, horaApertura, horaCierre, actor.tenantId)
          .run(),
      );
    },
  };
}
