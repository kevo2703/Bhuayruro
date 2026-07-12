// Módulo PURO (sin imports, sin DB) para el conteo cíclico de inventario (P5 / plan expansión §4 C3).
// La clasificación ABC y la cadencia de conteo son la parte con criterio de negocio, por eso viven aquí
// con test unitario; el repo (apps/api) solo aporta los datos (valor de venta, último conteo).
//
// ABC (plan §4 C3): se rankea cada SKU por su VALOR DE VENTA en la ventana → los de más valor se cuentan
// más seguido. A = top 20% (semanal), B = siguiente 30% (mensual), C = el resto (trimestral). Un SKU sin
// ventas cae siempre a C aunque haya pocos productos y el percentil lo alcanzara.

export type ClaseABC = "A" | "B" | "C";

// Cada cuántos días "toca" contar un SKU según su clase (plan §4 C3).
export const CADENCIA_DIAS: Record<ClaseABC, number> = { A: 7, B: 30, C: 90 };

// Cortes de percentil de SKU por valor de venta descendente. A: top 20%; B: hasta el 50% acumulado; C: resto.
export const ABC_CORTE = { A: 0.2, B: 0.5 } as const;

/**
 * Clasifica cada producto en A/B/C por su valor de venta (mayor = más crítico → se cuenta más seguido).
 * Determinista: ordena por valor DESC y desempata por productoId ASC. `valorCent ≤ 0` ⇒ siempre C.
 */
export function clasificarABC(items: { productoId: string; valorCent: number }[]): Map<string, ClaseABC> {
  const orden = [...items].sort(
    (a, b) => b.valorCent - a.valorCent || (a.productoId < b.productoId ? -1 : a.productoId > b.productoId ? 1 : 0),
  );
  const n = orden.length;
  const out = new Map<string, ClaseABC>();
  orden.forEach((it, i) => {
    if (it.valorCent <= 0) {
      out.set(it.productoId, "C"); // sin rotación → nunca "crítico", cae a trimestral
      return;
    }
    const p = n > 0 ? i / n : 1; // percentil [0,1)
    out.set(it.productoId, p < ABC_CORTE.A ? "A" : p < ABC_CORTE.B ? "B" : "C");
  });
  return out;
}

/** ¿Este SKU ya "toca" contarse? Nunca contado ⇒ sí; si no, cuando pasó ≥ su cadencia. */
export function conteoVencido(clase: ClaseABC, ultimoConteoYmd: string | null, hoyYmd: string): boolean {
  if (!ultimoConteoYmd) return true;
  return diasEntreYmd(ultimoConteoYmd, hoyYmd) >= CADENCIA_DIAS[clase];
}

/** Días calendario entre dos fechas YYYY-MM-DD (mediodía UTC → inmune a bordes de zona). 0 si inválidas. */
export function diasEntreYmd(desdeYmd: string, hastaYmd: string): number {
  const a = Date.parse(`${desdeYmd}T12:00:00.000Z`);
  const b = Date.parse(`${hastaYmd}T12:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// Orden de prioridad de clase para armar la lista sugerida del día (A primero).
export const PRIORIDAD_CLASE: Record<ClaseABC, number> = { A: 0, B: 1, C: 2 };
