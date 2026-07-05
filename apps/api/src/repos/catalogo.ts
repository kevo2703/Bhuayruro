import { calcularItem, uuidv7 } from "@huayruro/shared";
import { negocio, noEncontrado } from "../lib/errores";
import type { Actor } from "../types";
import { withRetry } from "./base";

export type ProductoFila = {
  id: string;
  nombre: string;
  laboratorio: string | null;
  categoria: string | null;
  requiere_receta: number;
};

export type PresentacionFila = {
  id: string;
  producto_id: string;
  nombre: string;
  factor_unidades: number;
  es_base: number;
};

// Resultado del hot-path del escáner: producto + presentación (Δ1) + precio vigente de MI sucursal.
export type BarcodeResultado = {
  producto_id: string;
  nombre: string;
  presentacion_texto: string | null;
  requiere_receta: number;
  presentacion_id: string;
  presentacion_nombre: string;
  factor_unidades: number;
  precio_sin_igv_dm: number | null;
  precio_total_dm: number | null;
};

// Delta para Dexie (§8 GET /api/catalogo/sync): todo lo cambiado desde `desde`.
export type SyncDelta = {
  server_time: string;
  productos: (ProductoFila & { presentacion: string | null; principio_activo: string | null; activo: number; deleted_at: string | null; updated_at: string })[];
  presentaciones: PresentacionFila[];
  codigos: { gtin: string; producto_id: string; presentacion_id: string | null }[];
  precios: { producto_id: string; presentacion_id: string; precio_sin_igv_dm: number; igv_dm: number; precio_total_dm: number; vigente_desde: string; vigente_hasta: string | null }[];
};

const EPOCA = "1970-01-01T00:00:00.000Z";
const textoFts = (p: { nombre: string; principio_activo?: string | null; laboratorio?: string | null; categoria?: string | null }) =>
  [p.nombre, p.principio_activo, p.laboratorio, p.categoria].filter(Boolean).join(" ");

// Catálogo COMPARTIDO a nivel tenant (identidad de producto; plan D3/§4.3).
// El scoping de precios/stock es por sucursal (se resuelve en lib/scope y se pasa ya validado).
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

    // Presentaciones activas de un producto (para el selector Δ1 online; offline sale de Dexie).
    async presentaciones(productoId: string): Promise<PresentacionFila[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT pr.id, pr.producto_id, pr.nombre, pr.factor_unidades, pr.es_base
             FROM presentacion pr JOIN producto_catalogo p ON p.id = pr.producto_id
             WHERE pr.producto_id = ?1 AND pr.activa = 1 AND p.tenant_id = ?2 AND p.deleted_at IS NULL
             ORDER BY pr.factor_unidades`,
          )
          .bind(productoId, actor.tenantId)
          .all<PresentacionFila>(),
      );
      return r.results;
    },

    // Hot-path del escáner (§8 GET /api/catalogo/barcode/:gtin). Precio vigente de MI sucursal.
    async porGtin(gtin: string, sucursalId: string): Promise<BarcodeResultado | null> {
      return withRetry(() =>
        db
          .prepare(
            `SELECT p.id AS producto_id, p.nombre, p.presentacion AS presentacion_texto, p.requiere_receta,
                    pr.id AS presentacion_id, pr.nombre AS presentacion_nombre, pr.factor_unidades,
                    pl.precio_sin_igv_dm, pl.precio_total_dm
             FROM codigo_barras cb
             JOIN producto_catalogo p ON p.id = cb.producto_id
             JOIN presentacion pr ON pr.id = COALESCE(cb.presentacion_id, (
               SELECT id FROM presentacion WHERE producto_id = p.id AND es_base = 1 AND activa = 1 LIMIT 1))
             LEFT JOIN precio_local pl ON pl.producto_id = p.id AND pl.presentacion_id = pr.id
               AND pl.sucursal_id = ?2 AND pl.vigente_hasta IS NULL
             WHERE cb.gtin = ?1 AND p.tenant_id = ?3 AND p.deleted_at IS NULL
             LIMIT 1`,
          )
          .bind(gtin, sucursalId, actor.tenantId)
          .first<BarcodeResultado>(),
      );
    },

    // Delta para Dexie. `desde` ISO; vacío → sync completo. Incluye tombstones (deleted_at).
    async sync(sucursalId: string, desde: string | null): Promise<SyncDelta> {
      const d = desde && desde.trim() ? desde : EPOCA;
      const res = await withRetry(() =>
        db.batch([
          db
            .prepare(
              `SELECT id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta, activo, deleted_at, updated_at
               FROM producto_catalogo WHERE tenant_id = ?1 AND updated_at > ?2 ORDER BY updated_at`,
            )
            .bind(actor.tenantId, d),
          db
            .prepare(
              `SELECT pr.id, pr.producto_id, pr.nombre, pr.factor_unidades, pr.es_base
               FROM presentacion pr JOIN producto_catalogo p ON p.id = pr.producto_id
               WHERE p.tenant_id = ?1 AND pr.created_at > ?2`,
            )
            .bind(actor.tenantId, d),
          db
            .prepare(
              `SELECT cb.gtin, cb.producto_id, cb.presentacion_id
               FROM codigo_barras cb JOIN producto_catalogo p ON p.id = cb.producto_id
               WHERE p.tenant_id = ?1 AND cb.created_at > ?2`,
            )
            .bind(actor.tenantId, d),
          db
            .prepare(
              `SELECT producto_id, presentacion_id, precio_sin_igv_dm, igv_dm, precio_total_dm, vigente_desde, vigente_hasta
               FROM precio_local WHERE sucursal_id = ?1 AND created_at > ?2`,
            )
            .bind(sucursalId, d),
        ]),
      );
      return {
        server_time: new Date().toISOString(),
        productos: res[0]!.results as SyncDelta["productos"],
        presentaciones: res[1]!.results as PresentacionFila[],
        codigos: res[2]!.results as SyncDelta["codigos"],
        precios: res[3]!.results as SyncDelta["precios"],
      };
    },

    // Crea producto + fila FTS + presentación base, TODO en el mismo batch (§8: mantiene producto_fts).
    async crear(input: {
      nombre: string;
      presentacion: string | null;
      laboratorio: string | null;
      principio_activo: string | null;
      categoria: string | null;
      requiere_receta: number;
      nowIso: string;
    }): Promise<{ id: string; presentacion_base_id: string }> {
      const id = uuidv7();
      const presId = uuidv7();
      await withRetry(() =>
        db.batch([
          db
            .prepare(
              `INSERT INTO producto_catalogo (id, tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
            )
            .bind(id, actor.tenantId, input.nombre, input.presentacion, input.laboratorio, input.principio_activo, input.categoria, input.requiere_receta, input.nowIso),
          db.prepare(`INSERT INTO producto_fts (producto_id, texto) VALUES (?1, ?2)`).bind(id, textoFts(input)),
          db
            .prepare(`INSERT INTO presentacion (id, producto_id, nombre, factor_unidades, es_base, created_at) VALUES (?1, ?2, 'unidad', 1, 1, ?3)`)
            .bind(presId, id, input.nowIso),
        ]),
      );
      return { id, presentacion_base_id: presId };
    },

    // Edita producto + reindexa FTS en el mismo batch. 404 si es de otro tenant.
    async actualizar(id: string, campos: {
      nombre?: string | undefined; presentacion?: string | null | undefined; laboratorio?: string | null | undefined;
      principio_activo?: string | null | undefined; categoria?: string | null | undefined; requiere_receta?: number | undefined;
    }, nowIso: string): Promise<void> {
      const actual = await withRetry(() =>
        db
          .prepare(`SELECT id, nombre, laboratorio, principio_activo, categoria FROM producto_catalogo WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`)
          .bind(id, actor.tenantId)
          .first<{ id: string; nombre: string; laboratorio: string | null; principio_activo: string | null; categoria: string | null }>(),
      );
      if (!actual) throw noEncontrado("producto");
      const merged = {
        nombre: campos.nombre ?? actual.nombre,
        laboratorio: campos.laboratorio ?? actual.laboratorio,
        principio_activo: campos.principio_activo ?? actual.principio_activo,
        categoria: campos.categoria ?? actual.categoria,
      };
      await withRetry(() =>
        db.batch([
          db
            .prepare(
              `UPDATE producto_catalogo SET
                 nombre = COALESCE(?2, nombre), presentacion = COALESCE(?3, presentacion),
                 laboratorio = COALESCE(?4, laboratorio), principio_activo = COALESCE(?5, principio_activo),
                 categoria = COALESCE(?6, categoria), requiere_receta = COALESCE(?7, requiere_receta), updated_at = ?8
               WHERE id = ?1 AND tenant_id = ?9`,
            )
            .bind(id, campos.nombre ?? null, campos.presentacion ?? null, campos.laboratorio ?? null, campos.principio_activo ?? null, campos.categoria ?? null, campos.requiere_receta ?? null, nowIso, actor.tenantId),
          db.prepare(`DELETE FROM producto_fts WHERE producto_id = ?1`).bind(id),
          db.prepare(`INSERT INTO producto_fts (producto_id, texto) VALUES (?1, ?2)`).bind(id, textoFts(merged)),
        ]),
      );
    },

    // Soft-delete: marca deleted_at y saca la fila de FTS (deja de matchear). 404 si es ajeno.
    async eliminar(id: string, nowIso: string): Promise<void> {
      const existe = await withRetry(() =>
        db.prepare(`SELECT id FROM producto_catalogo WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`).bind(id, actor.tenantId).first<{ id: string }>(),
      );
      if (!existe) throw noEncontrado("producto");
      await withRetry(() =>
        db.batch([
          db.prepare(`UPDATE producto_catalogo SET deleted_at = ?2, activo = 0, updated_at = ?2 WHERE id = ?1 AND tenant_id = ?3`).bind(id, nowIso, actor.tenantId),
          db.prepare(`DELETE FROM producto_fts WHERE producto_id = ?1`).bind(id),
        ]),
      );
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
    // sucursalId = null → super_admin (sin restricción). Edición en sitio (sin versionar).
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
    },

    // Versión nueva de precio (§8 POST /api/precios): cierra el vigente (vigente_hasta=now) y crea
    // uno nuevo, TODO en un batch. igv_dm/precio_total_dm derivados con la aritmética exacta del §6.
    async crearVersion(input: {
      productoId: string;
      sucursalId: string;
      presentacionId: string;
      precioSinIgvDm: number;
      precioCompraDm: number | null;
      nowIso: string;
    }): Promise<{ id: string }> {
      // La presentación debe pertenecer al producto (evita precios colgados de otro SKU).
      const pres = await withRetry(() =>
        db.prepare(`SELECT id FROM presentacion WHERE id = ?1 AND producto_id = ?2 AND activa = 1`).bind(input.presentacionId, input.productoId).first<{ id: string }>(),
      );
      if (!pres) throw negocio("la presentación no pertenece al producto");
      const calc = calcularItem(1, input.precioSinIgvDm);
      const id = uuidv7();
      await withRetry(() =>
        db.batch([
          db
            .prepare(
              `UPDATE precio_local SET vigente_hasta = ?4
               WHERE producto_id = ?1 AND sucursal_id = ?2 AND presentacion_id = ?3 AND vigente_hasta IS NULL`,
            )
            .bind(input.productoId, input.sucursalId, input.presentacionId, input.nowIso),
          db
            .prepare(
              `INSERT INTO precio_local (id, producto_id, sucursal_id, presentacion_id, precio_compra_dm, precio_sin_igv_dm, igv_dm, precio_total_dm, vigente_desde, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
            )
            .bind(id, input.productoId, input.sucursalId, input.presentacionId, input.precioCompraDm, input.precioSinIgvDm, calc.igvUnitarioDm, calc.precioTotalUnitarioDm, input.nowIso),
        ]),
      );
      return { id };
    },
  };
}
