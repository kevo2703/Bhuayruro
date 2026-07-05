import { uuidv7 } from "@huayruro/shared";
import type { Actor, Rol } from "../types";
import { withRetry } from "./base";

export function usuarioRepo(db: D1Database, actor: Actor) {
  return {
    async listar(): Promise<{ id: string; nombre: string; email: string; rol: string; sucursal_id: string | null }[]> {
      // super: todos del tenant; admin: operadores de su sucursal (plan §4.3).
      if (actor.tipo === "usuario" && actor.rol === "super_admin") {
        const r = await withRetry(() =>
          db
            .prepare(`SELECT id, nombre, email, rol, sucursal_id FROM usuario_perfil WHERE tenant_id = ?1 ORDER BY nombre`)
            .bind(actor.tenantId)
            .all<{ id: string; nombre: string; email: string; rol: string; sucursal_id: string | null }>(),
        );
        return r.results;
      }
      const r = await withRetry(() =>
        db
          .prepare(`SELECT id, nombre, email, rol, sucursal_id FROM usuario_perfil WHERE sucursal_id = ?1 ORDER BY nombre`)
          .bind(actor.sucursalId)
          .all<{ id: string; nombre: string; email: string; rol: string; sucursal_id: string | null }>(),
      );
      return r.results;
    },

    async crear(input: {
      nombre: string;
      email: string;
      passwordHash: string;
      rol: Rol;
      sucursalId: string | null;
      nowIso: string;
    }): Promise<{ id: string }> {
      const id = uuidv7();
      await withRetry(() =>
        db
          .prepare(
            `INSERT INTO usuario_perfil (id, tenant_id, sucursal_id, rol, nombre, email, password_hash, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
          )
          .bind(id, actor.tenantId, input.sucursalId, input.rol, input.nombre, input.email, input.passwordHash, input.nowIso)
          .run(),
      );
      return { id };
    },
  };
}

export function auditRepo(db: D1Database, actor: Actor) {
  return {
    // Solo super_admin (la ruta ya lo garantiza). Scoping por tenant.
    async listar(limite = 100): Promise<Record<string, unknown>[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT id, sucursal_id, usuario_id, accion, recurso, recurso_id, fecha_hora
             FROM audit_log WHERE tenant_id = ?1 ORDER BY fecha_hora DESC LIMIT ?2`,
          )
          .bind(actor.tenantId, limite)
          .all(),
      );
      return r.results as Record<string, unknown>[];
    },
  };
}

export function faltantesRepo(db: D1Database, actor: Actor) {
  return {
    // Faltantes de MI botica (admin_sucursal).
    async miBotica(sucursalId: string): Promise<Record<string, unknown>[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT i.producto_id, p.nombre, i.stock_unidades, i.stock_minimo
             FROM inventario_local i JOIN producto_catalogo p ON p.id = i.producto_id
             WHERE i.sucursal_id = ?1 AND i.stock_unidades <= i.stock_minimo ORDER BY p.nombre`,
          )
          .bind(sucursalId)
          .all(),
      );
      return r.results as Record<string, unknown>[];
    },

    // Consolidado cross-botica (SOLO super_admin; la ruta lo garantiza). ÚNICA operación
    // cross-botica permitida (plan §4.3). Agregados por producto×sucursal, nunca ventas/precios.
    async consolidado(): Promise<{ generado: string; items: Record<string, unknown>[] }> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT i.producto_id, p.nombre, su.nombre AS sucursal, i.stock_unidades AS stock, i.stock_minimo AS minimo
             FROM inventario_local i
             JOIN producto_catalogo p ON p.id = i.producto_id
             JOIN sucursal su ON su.id = i.sucursal_id
             WHERE su.tenant_id = ?1 AND i.stock_unidades <= i.stock_minimo
             ORDER BY p.nombre, su.nombre`,
          )
          .bind(actor.tenantId)
          .all<{ producto_id: string; nombre: string; sucursal: string; stock: number; minimo: number }>(),
      );
      // Agrupar por producto (E10 refina con quiebres 14d + sugerido).
      const porProducto = new Map<string, Record<string, unknown>>();
      for (const f of r.results) {
        const g = (porProducto.get(f.producto_id) ?? { producto_id: f.producto_id, nombre: f.nombre, por_botica: [] }) as {
          producto_id: string;
          nombre: string;
          por_botica: unknown[];
        };
        g.por_botica.push({
          sucursal: f.sucursal,
          stock: f.stock,
          minimo: f.minimo,
          sugerido: Math.max(0, f.minimo * 2 - f.stock),
        });
        porProducto.set(f.producto_id, g);
      }
      return { generado: new Date().toISOString(), items: [...porProducto.values()] };
    },
  };
}
