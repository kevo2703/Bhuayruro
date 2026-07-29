// KPI que gobierna la capacidad A entera del plan de expansión (§2 A1): **% de ventas identificadas**
// = ventas con `cliente_id` ÷ ventas completadas del periodo. Si este número no sube, A2 (reposición
// por WhatsApp) y A3 (RFM) no tienen combustible: por eso vive en el panel desde el día 1 de P1.
//
// Las metas las ratificó Kevin en la spec de S14. Viven acá —y no en la pantalla— porque el mismo
// umbral lo usan el semáforo del panel y cualquier lectura futura del backend.

export const META_IDENTIFICADAS = { mes1: 30, mes3: 50 } as const;

export type NivelIdentificadas = "sin_ventas" | "bajo" | "meta1" | "meta3";

// Porcentaje entero, o `null` si no hubo ventas. Sin denominador NO se inventa un 0 %: se leería como
// "nadie se identificó" cuando lo que pasó es que no se vendió nada (rotulado honesto del proyecto).
export function pctIdentificadas(identificadas: number, ventas: number): number | null {
  if (!Number.isFinite(ventas) || ventas <= 0) return null;
  const pct = Math.round((Math.max(identificadas, 0) / ventas) * 100);
  return Math.min(pct, 100);
}

export function nivelIdentificadas(pct: number | null): NivelIdentificadas {
  if (pct === null) return "sin_ventas";
  if (pct >= META_IDENTIFICADAS.mes3) return "meta3";
  if (pct >= META_IDENTIFICADAS.mes1) return "meta1";
  return "bajo";
}
