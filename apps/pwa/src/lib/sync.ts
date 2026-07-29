import { apiRequest } from "./api";
import type { HuayruroDB, ReglaLocal } from "./db-local";

// Sync de catálogo (pull, §9): trae el delta desde el último sync y lo aplica a Dexie, con
// tombstones. Lecturas del POS = Dexie (funciona offline). Primer arranque = sync completo.

type SyncDelta = {
  server_time: string;
  productos: {
    id: string; nombre: string; presentacion: string | null; laboratorio: string | null;
    principio_activo: string | null; categoria: string | null; activo: number; deleted_at: string | null; updated_at: string;
  }[];
  presentaciones: { id: string; producto_id: string; nombre: string; factor_unidades: number; es_base: number }[];
  codigos: { gtin: string; producto_id: string; presentacion_id: string | null }[];
  precios: { producto_id: string; presentacion_id: string; precio_sin_igv_dm: number; precio_total_dm: number; vigente_desde: string }[];
};

const META_ULTIMO_SYNC = "ultimo_sync_catalogo";

export async function sincronizarCatalogo(db: HuayruroDB, getToken: () => string | null): Promise<{ aplicados: number }> {
  const desde = ((await db.meta.get(META_ULTIMO_SYNC))?.valor as string | undefined) ?? "";
  const delta = await apiRequest<SyncDelta>(`/catalogo/sync?desde=${encodeURIComponent(desde)}`, { token: getToken() });

  const vivos = delta.productos.filter((p) => !p.deleted_at);
  const muertos = delta.productos.filter((p) => p.deleted_at).map((p) => p.id);

  await db.transaction("rw", [db.productos, db.presentaciones, db.codigos, db.precios, db.meta], async () => {
    if (vivos.length) {
      await db.productos.bulkPut(
        vivos.map((p) => ({
          id: p.id, nombre: p.nombre, presentacion: p.presentacion, laboratorio: p.laboratorio,
          principio_activo: p.principio_activo, categoria: p.categoria, activo: p.activo, updated_at: p.updated_at,
        })),
      );
    }
    if (delta.presentaciones.length) await db.presentaciones.bulkPut(delta.presentaciones);
    if (delta.codigos.length) await db.codigos.bulkPut(delta.codigos);
    if (delta.precios.length) {
      await db.precios.bulkPut(
        delta.precios.map((pr) => ({ id: `${pr.producto_id}:${pr.presentacion_id}`, ...pr })),
      );
    }
    // Tombstones: purgar productos borrados y sus dependientes.
    for (const id of muertos) {
      await db.productos.delete(id);
      await db.presentaciones.where("producto_id").equals(id).delete();
      await db.codigos.where("producto_id").equals(id).delete();
      await db.precios.where("producto_id").equals(id).delete();
    }
    await db.meta.put({ clave: META_ULTIMO_SYNC, valor: delta.server_time });
  });

  return { aplicados: delta.productos.length + delta.presentaciones.length + delta.codigos.length + delta.precios.length };
}

// Sync de stock (informativo, §9 stock_cache): trae el inventario de MI sucursal y actualiza la
// cache. El stock se muestra con sello de hora; la verdad la impone el server al vender.
type InventarioResp = { inventario: { producto_id: string; stock_unidades: number; stock_minimo: number; updated_at: string }[] };

export async function sincronizarStock(db: HuayruroDB, getToken: () => string | null): Promise<{ aplicados: number }> {
  const r = await apiRequest<InventarioResp>("/inventario", { token: getToken() });
  if (r.inventario.length) {
    await db.stock_cache.bulkPut(
      r.inventario.map((i) => ({
        producto_id: i.producto_id,
        stock_unidades: i.stock_unidades,
        stock_minimo: i.stock_minimo,
        updated_at: i.updated_at,
      })),
    );
  }
  return { aplicados: r.inventario.length };
}

// Sync de reglas de venta cruzada (A4). Son de tenant y son poquísimas: se reemplaza la tabla
// entera en cada pull, así una regla apagada o borrada por el admin desaparece del mostrador sin
// necesidad de tombstones. Si falla (sin red), el motor sigue con las reglas que ya tenía.
type ReglasResp = { reglas: ReglaLocal[] };

export async function sincronizarReglas(db: HuayruroDB, getToken: () => string | null): Promise<{ reglas: number }> {
  const r = await apiRequest<ReglasResp>("/sugerencias/reglas", { token: getToken() });
  await db.transaction("rw", db.reglas, async () => {
    await db.reglas.clear();
    if (r.reglas.length) await db.reglas.bulkPut(r.reglas);
  });
  return { reglas: r.reglas.length };
}

// Normaliza para búsqueda local sin tildes (equivalente en cliente al remove_diacritics de FTS5).
export const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
