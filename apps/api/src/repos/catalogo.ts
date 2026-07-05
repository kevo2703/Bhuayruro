import { calcularItem } from "@huayruro/shared";
import { noEncontrado } from "../lib/errores";
import type { Actor } from "../types";
import { withRetry } from "./base";

export type ProductoFila = {
  id: string;
  nombre: string;
  laboratorio: string | null;
  categoria: string | null;
  requiere_receta: number;
};

// Catálogo COMPARTIDO a nivel tenant (identidad de producto; plan D3/§4.3).
export function productoRepo(db: D1Database, actor: Actor) {
  return {
    async listar(q?: string): Promise<ProductoFila[]> {
      if (q && q.trim()) {
        // Búsqueda FTS5 sin tildes (remove_diacritics). Prefijo para autocompletar.
        const termino = q.trim().replace(/["']/g, " ") + "*";
        const r = await withRetry(() =>
          db
            .prepare(
              `SELECT p.id, p.nombre, p.laboratorio, p.categoria, p.requiere_receta
               FROM producto_fts f JOIN producto_catalogo p ON p.id = f.producto_id
               WHERE producto_fts MATCH ?1 AND p.tenant_id = ?2 AND p.deleted_at IS NULL
               ORDER BY rank LIMIT 50`,
            )
            .bind(termino, actor.tenantId)
            .all<ProductoFila>(),
        );
        return r.results;
      }
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT id, nombre, laboratorio, categoria, requiere_receta
             FROM producto_catalogo WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY nombre LIMIT 200`,
          )
          .bind(actor.tenantId)
          .all<ProductoFila>(),
      );
      return r.results;
    },
  };
}

export type PrecioFila = {
  id: string;
  producto_id: string;
  sucursal_id: string;
  presentacion_id: string;
  precio_sin_igv_dm: number;
  igv_dm: number;
  precio_total_dm: number;
  vigente_desde: string;
};

// Precios POR sucursal. La sucursal objetivo ya viene resuelta y validada (lib/scope).
export function precioRepo(db: D1Database) {
  return {
    async listar(sucursalId: string, productoId?: string): Promise<PrecioFila[]> {
      const sql = `SELECT id, producto_id, sucursal_id, presentacion_id, precio_sin_igv_dm, igv_dm, precio_total_dm, vigente_desde
                   FROM precio_local WHERE sucursal_id = ?1 AND vigente_hasta IS NULL
                   ${productoId ? "AND producto_id = ?2" : ""} ORDER BY producto_id`;
      const stmt = productoId ? db.prepare(sql).bind(sucursalId, productoId) : db.prepare(sql).bind(sucursalId);
      const r = await withRetry(() => stmt.all<PrecioFila>());
      return r.results;
    },

    // PATCH por id (direct id): 404 si el precio pertenece a otra sucursal (§4.4 #9).
    // sucursalId = null → super_admin (sin restricción).
    async actualizarPorId(id: string, sucursalId: string | null, nuevoPrecioSinIgvDm: number): Promise<void> {
      const fila = await withRetry(() =>
        db.prepare(`SELECT sucursal_id FROM precio_local WHERE id = ?1`).bind(id).first<{ sucursal_id: string }>(),
      );
      if (!fila || (sucursalId !== null && fila.sucursal_id !== sucursalId)) throw noEncontrado("precio");
      const calc = calcularItem(1, nuevoPrecioSinIgvDm);
      await withRetry(() =>
        db
          .prepare(`UPDATE precio_local SET precio_sin_igv_dm = ?2, igv_dm = ?3, precio_total_dm = ?4 WHERE id = ?1`)
          .bind(id, nuevoPrecioSinIgvDm, calc.igvUnitarioDm, calc.precioTotalUnitarioDm)
          .run(),
      );
      // Nota E5: la versión completa cierra el vigente (vigente_hasta) y crea uno nuevo (§8 POST /api/precios).
    },
  };
}
