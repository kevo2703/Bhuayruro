import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { HuayruroDB, ProductoLocal, PresentacionLocal, PrecioLocal, CodigoLocal, StockCache } from "./db-local";
import { sinTildes } from "./sync";
import type { ProductoVenta } from "./tipos";

// Catálogo de venta desde Dexie (§11.1: useCatalogo REESCRITO — lee de la cache, no de la red →
// funciona offline). Carga el catálogo entero en memoria (cientos–pocos miles de SKU = trivial) y
// resuelve búsqueda + GTIN sin tocar IndexedDB por tecla. Δ1: cada producto expone sus
// presentaciones con su precio, para que el operador elija unidad/blíster/caja.

export type PresentacionVenta = {
  presentacion_id: string;
  presentacion_nombre: string;
  factor: number;
  precio_sin_igv_dm: number;
  precio_total_dm: number;
  es_base: boolean;
};

export type ResultadoBusqueda = {
  producto_id: string;
  nombre: string;
  presentacion_texto: string | null;
  laboratorio: string | null;
  principio_activo: string | null;
  requiere_receta: boolean;
  stock_cache: number | null;
  presentaciones: PresentacionVenta[]; // solo las que tienen precio vigente
};

type Cache = {
  productos: ProductoLocal[];
  presPorProducto: Map<string, PresentacionLocal[]>;
  precioPorClave: Map<string, PrecioLocal>; // `${producto_id}:${presentacion_id}`
  gtin: Map<string, CodigoLocal>;
  stock: Map<string, number>;
  nombreNorm: Map<string, string>; // id → nombre sin tildes (búsqueda)
};

function armarPresentaciones(
  producto: ProductoLocal,
  cache: Cache,
): PresentacionVenta[] {
  const pres = (cache.presPorProducto.get(producto.id) ?? [])
    .slice()
    .sort((a, b) => a.factor_unidades - b.factor_unidades);
  const out: PresentacionVenta[] = [];
  for (const p of pres) {
    const precio = cache.precioPorClave.get(`${producto.id}:${p.id}`);
    if (!precio) continue; // sin precio vigente no se puede vender
    out.push({
      presentacion_id: p.id,
      presentacion_nombre: p.nombre,
      factor: p.factor_unidades,
      precio_sin_igv_dm: precio.precio_sin_igv_dm,
      precio_total_dm: precio.precio_total_dm,
      es_base: p.es_base === 1,
    });
  }
  return out;
}

function aResultado(producto: ProductoLocal, cache: Cache): ResultadoBusqueda {
  return {
    producto_id: producto.id,
    nombre: producto.nombre,
    presentacion_texto: producto.presentacion,
    laboratorio: producto.laboratorio,
    principio_activo: producto.principio_activo,
    requiere_receta: false, // el catálogo local no cachea requiere_receta; el server lo valida al cobrar
    stock_cache: cache.stock.get(producto.id) ?? null,
    presentaciones: armarPresentaciones(producto, cache),
  };
}

// Construye un ProductoVenta (para el carrito) desde un resultado + la presentación elegida.
export function aProductoVenta(r: ResultadoBusqueda, pres: PresentacionVenta, gtin: string | null): ProductoVenta {
  return {
    producto_id: r.producto_id,
    nombre: r.nombre,
    presentacion_texto: r.presentacion_texto,
    laboratorio: r.laboratorio,
    principio_activo: r.principio_activo,
    requiere_receta: r.requiere_receta,
    presentacion_id: pres.presentacion_id,
    presentacion_nombre: pres.presentacion_nombre,
    factor: pres.factor,
    precio_sin_igv_dm: pres.precio_sin_igv_dm,
    precio_total_dm: pres.precio_total_dm,
    stock_cache: r.stock_cache,
    gtin,
  };
}

export function useCatalogoVenta(db: HuayruroDB): {
  buscar: (q: string, limite?: number) => ResultadoBusqueda[];
  porGtin: (gtin: string) => ProductoVenta | null;
  listo: boolean;
  total: number;
} {
  const datos = useLiveQuery(async () => {
    const [productos, presentaciones, precios, codigos, stock] = await Promise.all([
      db.productos.where("activo").equals(1).toArray(),
      db.presentaciones.toArray(),
      db.precios.toArray(),
      db.codigos.toArray(),
      db.stock_cache.toArray(),
    ]);
    return { productos, presentaciones, precios, codigos, stock };
  }, [db]);

  const cache = useMemo<Cache | null>(() => {
    if (!datos) return null;
    const presPorProducto = new Map<string, PresentacionLocal[]>();
    for (const p of datos.presentaciones) {
      const arr = presPorProducto.get(p.producto_id);
      if (arr) arr.push(p);
      else presPorProducto.set(p.producto_id, [p]);
    }
    const precioPorClave = new Map<string, PrecioLocal>();
    for (const pr of datos.precios) precioPorClave.set(`${pr.producto_id}:${pr.presentacion_id}`, pr);
    const gtin = new Map<string, CodigoLocal>();
    for (const c of datos.codigos) gtin.set(c.gtin, c);
    const stock = new Map<string, number>();
    for (const s of datos.stock as StockCache[]) stock.set(s.producto_id, s.stock_unidades);
    const nombreNorm = new Map<string, string>();
    for (const p of datos.productos) nombreNorm.set(p.id, sinTildes(p.nombre));
    return { productos: datos.productos, presPorProducto, precioPorClave, gtin, stock, nombreNorm };
  }, [datos]);

  return useMemo(() => {
    const listo = cache !== null;
    if (!cache) {
      return { buscar: () => [], porGtin: () => null, listo: false, total: 0 };
    }
    const nombreNorm = cache.nombreNorm;

    const buscar = (q: string, limite = 50): ResultadoBusqueda[] => {
      const termino = sinTildes(q.trim());
      let base: ProductoLocal[];
      if (!termino) {
        base = cache.productos.slice(0, limite);
      } else {
        // GTIN exacto primero (hot-path de tipeo del código).
        const porCodigo = cache.gtin.get(q.trim());
        const seed = porCodigo ? cache.productos.filter((p) => p.id === porCodigo.producto_id) : [];
        const resto = cache.productos.filter(
          (p) => p.id !== (porCodigo?.producto_id ?? "") && (nombreNorm.get(p.id) ?? "").includes(termino),
        );
        base = [...seed, ...resto].slice(0, limite);
      }
      return base.map((p) => aResultado(p, cache)).filter((r) => r.presentaciones.length > 0);
    };

    const porGtin = (gtin: string): ProductoVenta | null => {
      const cod = cache.gtin.get(gtin.trim());
      if (!cod) return null;
      const producto = cache.productos.find((p) => p.id === cod.producto_id);
      if (!producto) return null;
      const r = aResultado(producto, cache);
      // El código apunta a su presentación (Δ1: el GTIN de la caja ≠ el del blíster); si no, la base.
      const pres =
        (cod.presentacion_id ? r.presentaciones.find((x) => x.presentacion_id === cod.presentacion_id) : null) ??
        r.presentaciones.find((x) => x.es_base) ??
        r.presentaciones[0];
      if (!pres) return null;
      return aProductoVenta(r, pres, gtin.trim());
    };

    return { buscar, porGtin, listo, total: cache.productos.length };
  }, [cache]);
}
