// Provisión de dispositivos A10 grabadores (B10.1 §8). El admin crea el dispositivo en la web y
// pega el token en la grabadora del teléfono. El token se muestra UNA vez (solo se guarda su hash,
// como las sesiones — plan §4.2). El kill-switch `activo` corta la grabación sin borrar el dispositivo.
// Todo scoped por tenant (JOIN sucursal); un admin solo ve/gestiona su sucursal, el super las del tenant.

import { uuidv7 } from "@huayruro/shared";
import { noEncontrado } from "../lib/errores";
import type { Actor } from "../types";
import { withRetry } from "./base";

export type DispositivoVista = { id: string; nombre: string; activo: number; sucursal_id: string; created_at: string };

export function dispositivoRepo(db: D1Database, actor: Actor) {
  return {
    // Alta de un grabador. `sucursalId` ya viene resuelto/validado por la ruta (del tenant del actor).
    async crear(p: { sucursalId: string; nombre: string; tokenHash: string; nowIso: string }): Promise<{ id: string }> {
      const id = uuidv7();
      await withRetry(() =>
        db
          .prepare(
            `INSERT INTO dispositivo (id, sucursal_id, tipo, nombre, token_hash, activo, created_at)
             VALUES (?1, ?2, 'a10_grabador', ?3, ?4, 1, ?5)`,
          )
          .bind(id, p.sucursalId, p.nombre, p.tokenHash, p.nowIso)
          .run(),
      );
      return { id };
    },

    // Grabadores de una sucursal (del tenant del actor). NUNCA devuelve el token_hash.
    async listar(sucursalId: string): Promise<DispositivoVista[]> {
      const { results } = await withRetry(() =>
        db
          .prepare(
            `SELECT d.id, d.nombre, d.activo, d.sucursal_id, d.created_at
             FROM dispositivo d JOIN sucursal su ON su.id = d.sucursal_id
             WHERE su.tenant_id = ?1 AND d.sucursal_id = ?2 AND d.tipo = 'a10_grabador'
             ORDER BY d.created_at DESC`,
          )
          .bind(actor.tenantId, sucursalId)
          .all<DispositivoVista>(),
      );
      return results ?? [];
    },

    // Kill-switch. Fail-closed: si el dispositivo no es del tenant/sucursal del actor → 404.
    async activar(id: string, activo: boolean, sucursalId: string): Promise<void> {
      const res = await withRetry(() =>
        db
          .prepare(
            `UPDATE dispositivo SET activo = ?3
             WHERE id = ?1 AND sucursal_id = ?2 AND sucursal_id IN (SELECT id FROM sucursal WHERE tenant_id = ?4) AND tipo = 'a10_grabador'`,
          )
          .bind(id, sucursalId, activo ? 1 : 0, actor.tenantId)
          .run(),
      );
      if ((res.meta?.changes ?? 0) === 0) throw noEncontrado("dispositivo");
    },
  };
}
