import { useCallback, useMemo, useState } from "react";
import { calcularCabeceraDesdeLineas, calcularItem } from "@huayruro/shared";
import type { ProductoVenta } from "./tipos";

// §11.1: aritmética en CÉNTIMOS/DIEZMILÉSIMAS de packages/shared (§6), NO floats con round2.
// La cabecera del carrito es idéntica a la que calcula el server (mismo módulo compartido).

export type CarritoItem = {
  producto: ProductoVenta;
  cantidad: number; // unidades de la PRESENTACIÓN (entero ≥1); base = cantidad × factor
};

export type CarritoTotales = {
  subtotal_sin_igv_cent: number;
  igv_total_cent: number;
  total_cent: number;
  cantidad_items: number;
};

// La clave de línea es la presentación (Δ1: el mismo producto en unidad y en caja = 2 líneas).
const clave = (p: ProductoVenta) => p.presentacion_id;

export function useCarrito() {
  const [items, setItems] = useState<CarritoItem[]>([]);

  const agregar = useCallback((producto: ProductoVenta, cantidad = 1) => {
    setItems((prev) => {
      const k = clave(producto);
      const existe = prev.find((it) => clave(it.producto) === k);
      if (existe) {
        return prev.map((it) => (clave(it.producto) === k ? { ...it, cantidad: it.cantidad + cantidad } : it));
      }
      return [...prev, { producto, cantidad }];
    });
  }, []);

  const quitar = useCallback((presentacionId: string) => {
    setItems((prev) => prev.filter((it) => it.producto.presentacion_id !== presentacionId));
  }, []);

  const setCantidad = useCallback((presentacionId: string, cantidad: number) => {
    setItems((prev) => {
      if (cantidad <= 0) return prev.filter((it) => it.producto.presentacion_id !== presentacionId);
      return prev.map((it) => (it.producto.presentacion_id === presentacionId ? { ...it, cantidad: Math.floor(cantidad) } : it));
    });
  }, []);

  const limpiar = useCallback(() => setItems([]), []);

  const totales: CarritoTotales = useMemo(() => {
    const lineasDm = items.map((it) => it.cantidad * it.producto.precio_sin_igv_dm);
    const cab = lineasDm.length ? calcularCabeceraDesdeLineas(lineasDm) : { subtotalSinIgvCent: 0, igvTotalCent: 0, totalCent: 0 };
    return {
      subtotal_sin_igv_cent: cab.subtotalSinIgvCent,
      igv_total_cent: cab.igvTotalCent,
      total_cent: cab.totalCent,
      cantidad_items: items.reduce((acc, it) => acc + it.cantidad, 0),
    };
  }, [items]);

  return { items, agregar, quitar, setCantidad, limpiar, totales };
}

// Total de línea (céntimos) para mostrar en el carrito.
export function totalLineaCent(it: CarritoItem): number {
  return calcularItem(it.cantidad, it.producto.precio_sin_igv_dm).totalCent;
}
