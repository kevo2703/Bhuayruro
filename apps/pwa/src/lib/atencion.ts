// Δ2 — "tiempo de servicio": desde que el carrito deja de estar vacío hasta que se cobra.
//
// El backend acepta e inserta `venta.atencion_inicio` desde S2 y el espejo operativo (B11.2) calcula
// con él `servicio_prom_seg`… pero el Mostrador nunca lo mandaba, así que esa métrica salía SIEMPRE
// null. Estas dos funciones son toda la regla, aparte para poder probarlas sin montar el hook:
//
//   · el reloj arranca con el PRIMER ítem (no al abrir la pantalla: el vendedor puede tenerla abierta
//     media hora sin nadie enfrente);
//   · si el carrito se vacía —se quitó todo o se limpió— el reloj se descarta y el siguiente ítem
//     arranca una atención nueva.

// Inicio tras AGREGAR un ítem: si el carrito venía vacío, empieza a contar ahora.
export function inicioTrasAgregar(itemsPrevios: number, inicioPrevio: string | null, ahoraIso: string): string | null {
  return itemsPrevios === 0 || inicioPrevio === null ? ahoraIso : inicioPrevio;
}

// Inicio tras QUITAR o cambiar cantidades: sin ítems no hay atención en curso.
export function inicioTrasQuitar(itemsRestantes: number, inicioPrevio: string | null): string | null {
  return itemsRestantes === 0 ? null : inicioPrevio;
}
