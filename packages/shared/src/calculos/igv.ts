export const IGV_TASA = 0.18;

export type DesgloseIgv = {
  subtotal: number;
  igv: number;
  total: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function calcularTotalConIgv(precioSinIgv: number): DesgloseIgv {
  if (!Number.isFinite(precioSinIgv) || precioSinIgv < 0) {
    throw new RangeError(`precioSinIgv inválido: ${precioSinIgv}`);
  }
  const subtotal = round2(precioSinIgv);
  const igv = round2(subtotal * IGV_TASA);
  const total = round2(subtotal + igv);
  return { subtotal, igv, total };
}

export function calcularDesdeTotal(total: number): DesgloseIgv {
  if (!Number.isFinite(total) || total < 0) {
    throw new RangeError(`total inválido: ${total}`);
  }
  const subtotal = round2(total / (1 + IGV_TASA));
  const igv = round2(total - subtotal);
  return { subtotal, igv, total: round2(total) };
}

export function formatearSoles(monto: number): string {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
  }).format(monto);
}
