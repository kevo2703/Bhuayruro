import { useLiveQuery } from "dexie-react-hooks";
import type { HuayruroDB, ProductoLocal, PresentacionLocal, PrecioLocal } from "./db-local";
import { sinTildes } from "./sync";

// Lectura del catálogo desde Dexie (§11.1: useCatalogo REESCRITO — lee de Dexie, no de la red).
// El sync en background (sync.ts) mantiene la cache; aquí solo se lee → funciona offline.

export type ItemCatalogo = ProductoLocal & {
  presentaciones: PresentacionLocal[];
  precioBase: PrecioLocal | null;
};

// Búsqueda local sin tildes (equivalente cliente al FTS5 remove_diacritics) + por GTIN.
export async function buscarLocal(db: HuayruroDB, q: string, limite = 50): Promise<ProductoLocal[]> {
  const termino = sinTildes(q.trim());
  if (!termino) return db.productos.where("activo").equals(1).limit(limite).toArray();

  // GTIN exacto tiene prioridad (hot-path del escáner).
  const porCodigo = await db.codigos.where("gtin").equals(q.trim()).first();
  if (porCodigo) {
    const p = await db.productos.get(porCodigo.producto_id);
    if (p) return [p];
  }
  const todos = await db.productos.where("activo").equals(1).toArray();
  return todos.filter((p) => sinTildes(p.nombre).includes(termino)).slice(0, limite);
}

// Producto + presentaciones + precio base, listo para el carrito.
export async function detalleLocal(db: HuayruroDB, productoId: string): Promise<ItemCatalogo | null> {
  const p = await db.productos.get(productoId);
  if (!p) return null;
  const presentaciones = await db.presentaciones.where("producto_id").equals(productoId).toArray();
  const base = presentaciones.find((x) => x.es_base === 1) ?? presentaciones[0] ?? null;
  const precioBase = base ? ((await db.precios.get(`${productoId}:${base.id}`)) ?? null) : null;
  return { ...p, presentaciones, precioBase };
}

// Hook reactivo: re-ejecuta la búsqueda cuando cambia la cache o el término.
export function useCatalogoLocal(db: HuayruroDB, q: string): ProductoLocal[] {
  return useLiveQuery(() => buscarLocal(db, q), [db, q], []) ?? [];
}
