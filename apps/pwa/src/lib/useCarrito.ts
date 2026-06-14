import { useCallback, useMemo, useState } from "react";
import type { CatalogoProducto } from "./useCatalogo";

export type CarritoItem = {
  producto: CatalogoProducto;
  cantidad: number;
};

export type CarritoTotales = {
  subtotal_sin_igv: number;
  igv: number;
  total: number;
  cantidad_items: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function useCarrito() {
  const [items, setItems] = useState<CarritoItem[]>([]);

  const agregar = useCallback((producto: CatalogoProducto, cantidad = 1) => {
    setItems((prev) => {
      const existing = prev.find((it) => it.producto.id === producto.id);
      if (existing) {
        return prev.map((it) =>
          it.producto.id === producto.id ? { ...it, cantidad: it.cantidad + cantidad } : it,
        );
      }
      return [...prev, { producto, cantidad }];
    });
  }, []);

  const quitar = useCallback((productoId: string) => {
    setItems((prev) => prev.filter((it) => it.producto.id !== productoId));
  }, []);

  const setCantidad = useCallback((productoId: string, cantidad: number) => {
    if (cantidad <= 0) {
      setItems((prev) => prev.filter((it) => it.producto.id !== productoId));
      return;
    }
    setItems((prev) =>
      prev.map((it) => (it.producto.id === productoId ? { ...it, cantidad } : it)),
    );
  }, []);

  const limpiar = useCallback(() => {
    setItems([]);
  }, []);

  const totales: CarritoTotales = useMemo(() => {
    const subtotal_sin_igv = items.reduce(
      (acc, it) => acc + it.cantidad * it.producto.precio_sin_igv,
      0,
    );
    const total = items.reduce((acc, it) => acc + it.cantidad * it.producto.precio_total, 0);
    return {
      subtotal_sin_igv: round2(subtotal_sin_igv),
      igv: round2(total - subtotal_sin_igv),
      total: round2(total),
      cantidad_items: items.reduce((acc, it) => acc + it.cantidad, 0),
    };
  }, [items]);

  return { items, agregar, quitar, setCantidad, limpiar, totales };
}
