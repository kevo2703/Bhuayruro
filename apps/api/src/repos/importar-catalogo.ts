// Repo del importador de catálogo (T-K4). Escribe UN producto por batch (atómico: todo-o-nada),
// reutilizando la aritmética de dinero (§6) y el patrón de escritura del seed §5.6.
// Tres desenlaces por fila:
//   - 'creado'              → producto nuevo (no existía por GTIN) con presentación/precio/stock/lote
//   - 'agregado_a_sucursal' → el producto ya existe en el catálogo (compartido a nivel tenant) y esta
//                             sucursal aún no lo vendía → se le agrega precio (+ inventario/lote) aquí
//   - 'omitido_existente'   → ya existe Y esta sucursal ya tiene inventario → no se toca (idempotente)
import { calcularItem, normalizarNombre, uuidv7, type ProductoImportable } from "@huayruro/shared";
import type { Actor } from "../types";
import { withRetry } from "./base";

// Marcadores del seed SINTÉTICO §5.6 (ids fijos + timestamp de generación). Los productos reales
// llevan uuidv7 (prefijo por tiempo, nunca "30000000-…") y created_at de la importación.
const SEED_TS = "2026-07-04T00:00:00.000Z";
const SEED_ID_PREFIX = "30000000-0000-7000-8000-%";

export type DesenlaceFila = { estado: "creado" | "agregado_a_sucursal" | "omitido_existente"; nota?: string };

export function importarCatalogoRepo(db: D1Database, actor: Actor) {
  const tenantId = actor.tenantId;
  return {
    // GTINs que ya existen en el catálogo del tenant → { productoId, basePresId } (para adjuntar).
    async gtinsExistentes(gtins: string[]): Promise<Map<string, { productoId: string; basePresId: string }>> {
      const mapa = new Map<string, { productoId: string; basePresId: string }>();
      const unicos = [...new Set(gtins.filter(Boolean))];
      for (let i = 0; i < unicos.length; i += 100) {
        const trozo = unicos.slice(i, i + 100);
        const placeholders = trozo.map((_, j) => `?${j + 2}`).join(",");
        const r = await withRetry(() =>
          db
            .prepare(
              `SELECT cb.gtin AS gtin, cb.producto_id AS producto_id,
                      (SELECT id FROM presentacion WHERE producto_id = cb.producto_id AND es_base = 1 ORDER BY activa DESC LIMIT 1) AS base_pres_id
               FROM codigo_barras cb
               JOIN producto_catalogo p ON p.id = cb.producto_id
               WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL AND cb.gtin IN (${placeholders})`,
            )
            .bind(tenantId, ...trozo)
            .all<{ gtin: string; producto_id: string; base_pres_id: string | null }>(),
        );
        for (const fila of r.results) {
          if (fila.base_pres_id) mapa.set(fila.gtin, { productoId: fila.producto_id, basePresId: fila.base_pres_id });
        }
      }
      return mapa;
    },

    // Productos del tenant que coinciden por NOMBRE (exacto) → { productoId, basePresId }. Sirve para
    // detectar duplicados de productos SIN código de barras al re-importar la misma hoja (dedup por nombre).
    async nombresExistentes(nombres: string[]): Promise<Map<string, { productoId: string; basePresId: string }>> {
      const mapa = new Map<string, { productoId: string; basePresId: string }>();
      const unicos = [...new Set(nombres.filter(Boolean))];
      for (let i = 0; i < unicos.length; i += 100) {
        const trozo = unicos.slice(i, i + 100);
        const placeholders = trozo.map((_, j) => `?${j + 2}`).join(",");
        const r = await withRetry(() =>
          db
            .prepare(
              `SELECT p.id AS producto_id, p.nombre AS nombre,
                      (SELECT id FROM presentacion WHERE producto_id = p.id AND es_base = 1 ORDER BY activa DESC LIMIT 1) AS base_pres_id
               FROM producto_catalogo p
               WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL AND p.nombre IN (${placeholders})`,
            )
            .bind(tenantId, ...trozo)
            .all<{ producto_id: string; nombre: string; base_pres_id: string | null }>(),
        );
        for (const fila of r.results) {
          if (fila.base_pres_id) mapa.set(normalizarNombre(fila.nombre), { productoId: fila.producto_id, basePresId: fila.base_pres_id });
        }
      }
      return mapa;
    },

    // Importa una fila validada de forma atómica. `existentes` = salida de gtinsExistentes.
    async importarUno(
      p: ProductoImportable,
      opts: { sucursalId: string; hoy: string; nowIso: string },
      existe: { productoId: string; basePresId: string } | undefined,
    ): Promise<DesenlaceFila> {
      const { sucursalId, hoy, nowIso } = opts;
      const precioBase = calcularItem(1, p.precioSinIgvDm);

      if (existe) {
        // Producto compartido ya en el catálogo. ¿Esta sucursal ya lo vende?
        const inv = await withRetry(() =>
          db.prepare(`SELECT id FROM inventario_local WHERE sucursal_id = ?1 AND producto_id = ?2`).bind(sucursalId, existe.productoId).first<{ id: string }>(),
        );
        if (inv) return { estado: "omitido_existente" };

        const invId = uuidv7();
        const precioId = uuidv7();
        const stmts: D1PreparedStatement[] = [
          db
            .prepare(`INSERT INTO inventario_local (id, sucursal_id, producto_id, stock_unidades, stock_minimo, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
            .bind(invId, sucursalId, existe.productoId, p.stockInicial, p.stockMinimo, nowIso),
          db
            .prepare(
              `INSERT INTO precio_local (id, producto_id, sucursal_id, presentacion_id, precio_compra_dm, precio_sin_igv_dm, igv_dm, precio_total_dm, vigente_desde, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
            )
            .bind(precioId, existe.productoId, sucursalId, existe.basePresId, p.precioCompraDm, p.precioSinIgvDm, precioBase.igvUnitarioDm, precioBase.precioTotalUnitarioDm, nowIso),
        ];
        if (p.lote && p.stockInicial > 0) {
          stmts.push(
            db
              .prepare(`INSERT INTO lote (id, inventario_id, numero_lote, fecha_vencimiento, unidades, proveedor, fecha_recepcion, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?7)`)
              .bind(uuidv7(), invId, p.lote.numero, p.lote.vencimiento, p.stockInicial, hoy, nowIso),
          );
        }
        await withRetry(() => db.batch(stmts));
        return { estado: "agregado_a_sucursal", ...(p.blister ? { nota: "blíster ignorado (el producto ya existía)" } : {}) };
      }

      // Producto NUEVO: catálogo + presentación(es) + código(s) + inventario + precio(s) + lote, en un batch.
      const prodId = uuidv7();
      const basePresId = uuidv7();
      const blisterPresId = p.blister ? uuidv7() : null;
      const invId = uuidv7();
      const textoFts = [p.nombre, p.principioActivo, p.laboratorio, p.categoria].filter(Boolean).join(" ");

      const stmts: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO producto_catalogo (id, tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta, es_cronico, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
          )
          .bind(prodId, tenantId, p.nombre, p.presentacionTexto, p.laboratorio, p.principioActivo, p.categoria, p.requiereReceta, p.esCronico, nowIso),
        db.prepare(`INSERT INTO producto_fts (producto_id, texto) VALUES (?1, ?2)`).bind(prodId, textoFts),
        db.prepare(`INSERT INTO presentacion (id, producto_id, nombre, factor_unidades, es_base, created_at) VALUES (?1, ?2, 'unidad', 1, 1, ?3)`).bind(basePresId, prodId, nowIso),
      ];
      if (p.blister && blisterPresId) {
        stmts.push(
          db.prepare(`INSERT INTO presentacion (id, producto_id, nombre, factor_unidades, es_base, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)`).bind(blisterPresId, prodId, p.blister.nombre, p.blister.factor, nowIso),
        );
      }
      if (p.gtin) {
        stmts.push(
          db.prepare(`INSERT INTO codigo_barras (id, producto_id, presentacion_id, gtin, es_unidad, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)`).bind(uuidv7(), prodId, basePresId, p.gtin, nowIso),
        );
      }
      if (p.blister?.gtin && blisterPresId) {
        stmts.push(
          db.prepare(`INSERT INTO codigo_barras (id, producto_id, presentacion_id, gtin, es_unidad, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)`).bind(uuidv7(), prodId, blisterPresId, p.blister.gtin, nowIso),
        );
      }
      stmts.push(
        db.prepare(`INSERT INTO inventario_local (id, sucursal_id, producto_id, stock_unidades, stock_minimo, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(invId, sucursalId, prodId, p.stockInicial, p.stockMinimo, nowIso),
      );
      if (p.lote && p.stockInicial > 0) {
        stmts.push(
          db.prepare(`INSERT INTO lote (id, inventario_id, numero_lote, fecha_vencimiento, unidades, proveedor, fecha_recepcion, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?7)`).bind(uuidv7(), invId, p.lote.numero, p.lote.vencimiento, p.stockInicial, hoy, nowIso),
        );
      }
      stmts.push(
        db
          .prepare(
            `INSERT INTO precio_local (id, producto_id, sucursal_id, presentacion_id, precio_compra_dm, precio_sin_igv_dm, igv_dm, precio_total_dm, vigente_desde, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
          )
          .bind(uuidv7(), prodId, sucursalId, basePresId, p.precioCompraDm, p.precioSinIgvDm, precioBase.igvUnitarioDm, precioBase.precioTotalUnitarioDm, nowIso),
      );
      if (p.blister && blisterPresId && p.blister.precioSinIgvDm !== null) {
        const precioBlister = calcularItem(1, p.blister.precioSinIgvDm);
        stmts.push(
          db
            .prepare(
              `INSERT INTO precio_local (id, producto_id, sucursal_id, presentacion_id, precio_compra_dm, precio_sin_igv_dm, igv_dm, precio_total_dm, vigente_desde, created_at)
               VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?8)`,
            )
            .bind(uuidv7(), prodId, sucursalId, blisterPresId, p.blister.precioSinIgvDm, precioBlister.igvUnitarioDm, precioBlister.precioTotalUnitarioDm, nowIso),
        );
      }

      await withRetry(() => db.batch(stmts));
      return { estado: "creado" };
    },

    // Cuenta los productos del seed SINTÉTICO del tenant (para el aviso de purga).
    async contarSeedDemo(): Promise<number> {
      const r = await withRetry(() =>
        db
          .prepare(`SELECT COUNT(*) AS n FROM producto_catalogo WHERE tenant_id = ?1 AND created_at = ?2 AND id LIKE ?3`)
          .bind(tenantId, SEED_TS, SEED_ID_PREFIX)
          .first<{ n: number }>(),
      );
      return r?.n ?? 0;
    },

    // Purga SOLO el catálogo del seed sintético (lote/inventario/precio/código/presentación/fts/producto),
    // en orden de FK. NO toca ventas/movimientos: si un producto demo tiene ventas ligadas, la FK aborta
    // el batch y el error sube (nunca borra historial de ventas en silencio).
    async purgarSeedDemo(): Promise<{ productos: number }> {
      const antes = await this.contarSeedDemo();
      if (antes === 0) return { productos: 0 };
      // Subconsulta reutilizable: ids de productos demo del tenant.
      const demoIds = `SELECT id FROM producto_catalogo WHERE tenant_id = ?1 AND created_at = ?2 AND id LIKE ?3`;
      const b = (sql: string) => db.prepare(sql).bind(tenantId, SEED_TS, SEED_ID_PREFIX);
      await withRetry(() =>
        db.batch([
          b(`DELETE FROM lote WHERE inventario_id IN (SELECT id FROM inventario_local WHERE producto_id IN (${demoIds}))`),
          b(`DELETE FROM inventario_local WHERE producto_id IN (${demoIds})`),
          b(`DELETE FROM precio_local WHERE producto_id IN (${demoIds})`),
          b(`DELETE FROM codigo_barras WHERE producto_id IN (${demoIds})`),
          b(`DELETE FROM presentacion WHERE producto_id IN (${demoIds})`),
          b(`DELETE FROM producto_fts WHERE producto_id IN (${demoIds})`),
          b(`DELETE FROM producto_catalogo WHERE tenant_id = ?1 AND created_at = ?2 AND id LIKE ?3`),
        ]),
      );
      return { productos: antes };
    },
  };
}
