import { uuidv7 } from "@huayruro/shared";
import { noEncontrado, validacion } from "../lib/errores";
import { aTexto } from "../lib/texto";
import type { Actor, Rol } from "../types";
import { esSuper } from "../lib/scope";
import { withRetry } from "./base";

export function usuarioRepo(db: D1Database, actor: Actor) {
  return {
    async listar(): Promise<{ id: string; nombre: string; email: string; rol: string; sucursal_id: string | null; activo: number }[]> {
      // super: todos del tenant; admin: operadores de su sucursal (plan §4.3).
      if (actor.tipo === "usuario" && actor.rol === "super_admin") {
        const r = await withRetry(() =>
          db
            .prepare(`SELECT id, nombre, email, rol, sucursal_id, activo FROM usuario_perfil WHERE tenant_id = ?1 ORDER BY nombre`)
            .bind(actor.tenantId)
            .all<{ id: string; nombre: string; email: string; rol: string; sucursal_id: string | null; activo: number }>(),
        );
        return r.results;
      }
      const r = await withRetry(() =>
        db
          .prepare(`SELECT id, nombre, email, rol, sucursal_id, activo FROM usuario_perfil WHERE sucursal_id = ?1 ORDER BY nombre`)
          .bind(actor.sucursalId)
          .all<{ id: string; nombre: string; email: string; rol: string; sucursal_id: string | null; activo: number }>(),
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

    // PATCH (§8): activar/desactivar, reset password, y (super) cambiar rol/sucursal/nombre.
    // Scoping: admin_sucursal SOLO toca operadores de SU sucursal; recurso ajeno → 404.
    async actualizar(
      id: string,
      campos: { activo?: boolean; passwordHash?: string; rol?: Rol; sucursalId?: string | null; nombre?: string },
      nowIso: string,
    ): Promise<void> {
      const objetivo = await withRetry(() =>
        db
          .prepare(`SELECT id, tenant_id, sucursal_id, rol FROM usuario_perfil WHERE id = ?1`)
          .bind(id)
          .first<{ id: string; tenant_id: string; sucursal_id: string | null; rol: string }>(),
      );
      if (!objetivo || objetivo.tenant_id !== actor.tenantId) throw noEncontrado("usuario");
      if (!esSuper(actor)) {
        // admin_sucursal: solo operadores de su sucursal; no puede tocar roles.
        if (objetivo.sucursal_id !== actor.sucursalId || objetivo.rol !== "operador") throw noEncontrado("usuario");
        if (campos.rol !== undefined || campos.sucursalId !== undefined) throw validacion("no puedes cambiar rol ni sucursal");
      }
      await withRetry(() =>
        db
          .prepare(
            `UPDATE usuario_perfil SET
               activo = COALESCE(?2, activo),
               password_hash = COALESCE(?3, password_hash),
               rol = COALESCE(?4, rol),
               sucursal_id = CASE WHEN ?5 = 1 THEN ?6 ELSE sucursal_id END,
               nombre = COALESCE(?7, nombre),
               updated_at = ?8
             WHERE id = ?1 AND tenant_id = ?9`,
          )
          .bind(
            id,
            campos.activo === undefined ? null : campos.activo ? 1 : 0,
            campos.passwordHash ?? null,
            campos.rol ?? null,
            campos.sucursalId !== undefined ? 1 : 0,
            campos.sucursalId ?? null,
            campos.nombre ?? null,
            nowIso,
            actor.tenantId,
          )
          .run(),
      );
    },
  };
}

export function auditRepo(db: D1Database, actor: Actor) {
  return {
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

const CORTE_14D = () => new Date(Date.now() - 14 * 86_400_000).toISOString();
const sugerir = (minimo: number, stock: number) => Math.max(0, minimo * 2 - stock);

type FilaFaltante = { producto_id: string; nombre: string; sucursal_id: string; sucursal: string; stock: number; minimo: number; quiebres_14d: number };

export function faltantesRepo(db: D1Database, actor: Actor) {
  return {
    // Faltantes de MI botica (admin_sucursal): stock<=minimo O quiebres 14d, con sugerido.
    // "Cómo se supo" (origen): 'oido' si algún quiebre reciente nació del audio ambiente (client_uuid con
    // prefijo 'senal:', que fija audioSenalRepo.confirmar) · 'manual' si hubo quiebre reportado a mano ·
    // null si el faltante solo lo disparó el stock mínimo (no hubo reporte). Derivado SOLO de quiebre
    // (NO se lee audio_senal aquí → respeta el VETO D-N5 y su test). La frase del oído la enriquece la ruta.
    async miBotica(sucursalId: string): Promise<Record<string, unknown>[]> {
      const corte = CORTE_14D();
      const r = await withRetry(() =>
        db
          .prepare(
            `WITH candidatos AS (
               SELECT producto_id FROM inventario_local WHERE sucursal_id = ?1 AND stock_unidades <= stock_minimo
               UNION
               SELECT producto_id FROM quiebre WHERE sucursal_id = ?1 AND producto_id IS NOT NULL AND fecha_hora >= ?2
             )
             SELECT c.producto_id, p.nombre,
                    COALESCE(i.stock_unidades,0) AS stock, COALESCE(i.stock_minimo,0) AS minimo,
                    (SELECT COUNT(*) FROM quiebre q WHERE q.producto_id = c.producto_id AND q.sucursal_id = ?1 AND q.fecha_hora >= ?2) AS quiebres_14d,
                    (SELECT COUNT(*) FROM quiebre q WHERE q.producto_id = c.producto_id AND q.sucursal_id = ?1 AND q.fecha_hora >= ?2 AND q.client_uuid LIKE 'senal:%') AS oido_14d
             FROM candidatos c
             JOIN producto_catalogo p ON p.id = c.producto_id AND p.tenant_id = ?3 AND p.deleted_at IS NULL
             LEFT JOIN inventario_local i ON i.producto_id = c.producto_id AND i.sucursal_id = ?1
             ORDER BY p.nombre`,
          )
          .bind(sucursalId, corte, actor.tenantId)
          .all<{ producto_id: string; nombre: string; stock: number; minimo: number; quiebres_14d: number; oido_14d: number }>(),
      );
      return r.results.map((f) => {
        const origen = f.quiebres_14d === 0 ? null : f.oido_14d > 0 ? "oido" : "manual";
        return { ...f, sugerido: sugerir(f.minimo, f.stock), origen };
      });
    },

    // Consolidado cross-botica (SOLO super). ÚNICA operación cross-botica (plan §4.3). Un producto
    // es faltante en una botica si stock<=minimo O tuvo quiebres en 14 días. Solo cantidades.
    async _filas(): Promise<FilaFaltante[]> {
      const corte = CORTE_14D();
      const r = await withRetry(() =>
        db
          .prepare(
            `WITH candidatos AS (
               SELECT producto_id, sucursal_id FROM inventario_local WHERE stock_unidades <= stock_minimo
               UNION
               SELECT producto_id, sucursal_id FROM quiebre WHERE producto_id IS NOT NULL AND fecha_hora >= ?1
             )
             SELECT c.producto_id, p.nombre, c.sucursal_id, su.nombre AS sucursal,
                    COALESCE(i.stock_unidades,0) AS stock, COALESCE(i.stock_minimo,0) AS minimo,
                    (SELECT COUNT(*) FROM quiebre q WHERE q.producto_id = c.producto_id AND q.sucursal_id = c.sucursal_id AND q.fecha_hora >= ?1) AS quiebres_14d
             FROM candidatos c
             JOIN producto_catalogo p ON p.id = c.producto_id AND p.tenant_id = ?2 AND p.deleted_at IS NULL
             JOIN sucursal su ON su.id = c.sucursal_id AND su.tenant_id = ?2 AND su.deleted_at IS NULL
             LEFT JOIN inventario_local i ON i.producto_id = c.producto_id AND i.sucursal_id = c.sucursal_id
             ORDER BY p.nombre, su.nombre`,
          )
          .bind(corte, actor.tenantId)
          .all<FilaFaltante>(),
      );
      return r.results;
    },

    async consolidado(): Promise<{ generado: string; items: Record<string, unknown>[] }> {
      const filas = await this._filas();
      const porProducto = new Map<string, { producto: { id: string; nombre: string }; por_botica: unknown[]; sugerido_total: number }>();
      for (const f of filas) {
        const g =
          porProducto.get(f.producto_id) ??
          { producto: { id: f.producto_id, nombre: f.nombre }, por_botica: [], sugerido_total: 0 };
        const sugerido = sugerir(f.minimo, f.stock);
        g.por_botica.push({ sucursal: f.sucursal, stock: f.stock, minimo: f.minimo, quiebres_14d: f.quiebres_14d, sugerido });
        g.sugerido_total += sugerido;
        porProducto.set(f.producto_id, g);
      }
      return { generado: new Date().toISOString(), items: [...porProducto.values()] };
    },

    // CSV: una fila por producto×botica + fila TOTAL por producto (formato del pedido al distribuidor).
    async consolidadoCsv(): Promise<string> {
      const filas = await this._filas();
      // Neutraliza inyección de fórmulas CSV: una celda que empieza con = + - @ (o TAB/CR) se
      // ejecuta al abrir el .csv en Excel/Sheets. Prefijamos un apóstrofo antes de entrecomillar.
      const cel = (s: unknown) => {
        let v = aTexto(s);
        if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
        return `"${v.replace(/"/g, '""')}"`;
      };
      const lineas = ["producto,sucursal,stock,minimo,quiebres_14d,sugerido"];
      const totalPorProducto = new Map<string, { nombre: string; total: number }>();
      for (const f of filas) {
        const sug = sugerir(f.minimo, f.stock);
        lineas.push([cel(f.nombre), cel(f.sucursal), f.stock, f.minimo, f.quiebres_14d, sug].join(","));
        const t = totalPorProducto.get(f.producto_id) ?? { nombre: f.nombre, total: 0 };
        t.total += sug;
        totalPorProducto.set(f.producto_id, t);
      }
      for (const t of totalPorProducto.values()) {
        lineas.push([cel(t.nombre), cel("TOTAL"), "", "", "", t.total].join(","));
      }
      return lineas.join("\r\n");
    },
  };
}
