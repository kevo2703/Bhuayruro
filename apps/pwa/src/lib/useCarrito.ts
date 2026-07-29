import { useCallback, useMemo, useState } from "react";
import { calcularCabeceraDesdeLineas, calcularItem } from "@huayruro/shared";
import { inicioTrasAgregar, inicioTrasQuitar } from "./atencion";
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

// Δ2: `items` y `atencionInicio` viven en UN solo estado porque el reloj es función de los ítems
// (arranca con el primero, se descarta al vaciar). Separarlos abriría la puerta a que se desincronicen.
type EstadoCarrito = { items: CarritoItem[]; atencionInicio: string | null };

export function useCarrito() {
  const [estado, setEstado] = useState<EstadoCarrito>({ items: [], atencionInicio: null });
  const items = estado.items;

  const agregar = useCallback((producto: ProductoVenta, cantidad = 1) => {
    // El timestamp se toma FUERA del updater: React puede reejecutarlo (StrictMode) y el reloj de la
    // atención no puede depender de cuántas veces corrió una función pura.
    const ahora = new Date().toISOString();
    setEstado((prev) => {
      const k = clave(producto);
      const existe = prev.items.find((it) => clave(it.producto) === k);
      const items = existe
        ? prev.items.map((it) => (clave(it.producto) === k ? { ...it, cantidad: it.cantidad + cantidad } : it))
        : [...prev.items, { producto, cantidad }];
      return { items, atencionInicio: inicioTrasAgregar(prev.items.length, prev.atencionInicio, ahora) };
    });
  }, []);

  const quitar = useCallback((presentacionId: string) => {
    setEstado((prev) => {
      const items = prev.items.filter((it) => it.producto.presentacion_id !== presentacionId);
      return { items, atencionInicio: inicioTrasQuitar(items.length, prev.atencionInicio) };
    });
  }, []);

  const setCantidad = useCallback((presentacionId: string, cantidad: number) => {
    setEstado((prev) => {
      const items =
        cantidad <= 0
          ? prev.items.filter((it) => it.producto.presentacion_id !== presentacionId)
          : prev.items.map((it) => (it.producto.presentacion_id === presentacionId ? { ...it, cantidad: Math.floor(cantidad) } : it));
      return { items, atencionInicio: inicioTrasQuitar(items.length, prev.atencionInicio) };
    });
  }, []);

  const limpiar = useCallback(() => setEstado({ items: [], atencionInicio: null }), []);

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

  return { items, agregar, quitar, setCantidad, limpiar, totales, atencionInicio: estado.atencionInicio };
}

// Total de línea (céntimos) para mostrar en el carrito.
export function totalLineaCent(it: CarritoItem): number {
  return calcularItem(it.cantidad, it.producto.precio_sin_igv_dm).totalCent;
}
