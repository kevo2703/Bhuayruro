// Dinero en enteros — arreglo obligatorio #3 (plan §6). NO "mejorar" los redondeos.
//
// Representación:
//   - Unitarios (precio_sin_igv, igv_unitario, precio_total_unitario, precio_compra):
//     INTEGER en DIEZMILÉSIMAS de sol (_dm).  S/ 12.7119 → 127119
//   - Totales de línea y cabecera: INTEGER en CÉNTIMOS (_cent).  S/ 15.00 → 1500
//
// Redondeo = half-up (Postgres round() sobre numeric; todos los montos son positivos).
// `rndDiv(a,b)` = round(a/b) por aritmética entera exacta (sin depender de float).

const IGV_PORCENTAJE = 18;

function assertEnteroSeguro(n: number, etiqueta: string): void {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`${etiqueta} no es entero seguro: ${n}`);
  }
}

/** round(a / b) half-up, con a ≥ 0 y b > 0 enteros. Aritmética entera exacta. */
export function rndDiv(a: number, b: number): number {
  assertEnteroSeguro(a, "rndDiv.a");
  assertEnteroSeguro(b, "rndDiv.b");
  if (a < 0 || b <= 0) throw new RangeError(`rndDiv requiere a≥0 y b>0 (a=${a}, b=${b})`);
  const q = Math.floor(a / b);
  const r = a - q * b;
  return 2 * r >= b ? q + 1 : q;
}

export type ItemCalculo = {
  cantidad: number;
  precioSinIgvUnitarioDm: number;
  igvUnitarioDm: number;
  precioTotalUnitarioDm: number;
  lineaDm: number; // cantidad × precio, EXACTO (sin redondeo)
  subtotalSinIgvCent: number;
  igvSubtotalCent: number;
  totalCent: number;
};

/** Cálculo por ÍTEM (plan §6.2). `cantidad` entero ≥1, `precioSinIgvUnitarioDm` entero ≥0. */
export function calcularItem(cantidad: number, precioSinIgvUnitarioDm: number): ItemCalculo {
  assertEnteroSeguro(cantidad, "cantidad");
  assertEnteroSeguro(precioSinIgvUnitarioDm, "precioSinIgvUnitarioDm");
  if (cantidad < 1) throw new RangeError(`cantidad debe ser ≥1: ${cantidad}`);
  if (precioSinIgvUnitarioDm < 0) throw new RangeError(`precio_dm debe ser ≥0: ${precioSinIgvUnitarioDm}`);

  const precioDm = precioSinIgvUnitarioDm;
  const igvUnitarioDm = rndDiv(precioDm * IGV_PORCENTAJE, 100); // round(precio × 0.18, 4)
  const precioTotalUnitarioDm = rndDiv(precioDm * (100 + IGV_PORCENTAJE), 100); // round(precio × 1.18, 4)
  const lineaDm = cantidad * precioDm; // EXACTO
  assertEnteroSeguro(lineaDm, "lineaDm");
  const subtotalSinIgvCent = rndDiv(lineaDm, 100); // round(cant × precio, 2)
  const igvSubtotalCent = rndDiv(lineaDm * IGV_PORCENTAJE, 10000); // round(cant × precio × 0.18, 2)
  const totalCent = rndDiv(lineaDm * (100 + IGV_PORCENTAJE), 10000); // round(cant × precio × 1.18, 2)

  return {
    cantidad,
    precioSinIgvUnitarioDm: precioDm,
    igvUnitarioDm,
    precioTotalUnitarioDm,
    lineaDm,
    subtotalSinIgvCent,
    igvSubtotalCent,
    totalCent,
  };
}

export type CabeceraCalculo = {
  subtotalSinIgvCent: number;
  igvTotalCent: number;
  totalCent: number;
};

/**
 * Cálculo de CABECERA (plan §6.2). S = Σ lineaDm (entero exacto en diezmilésimas).
 * OJO: el total NO es round(S × 1.18) — es subtotal redondeado + IGV redondeado.
 * El IGV de cabecera se calcula sobre S SIN redondear.
 */
export function calcularCabeceraDesdeLineas(lineasDm: number[]): CabeceraCalculo {
  let S = 0;
  for (const l of lineasDm) {
    assertEnteroSeguro(l, "lineaDm");
    S += l;
  }
  assertEnteroSeguro(S, "S");
  const subtotalSinIgvCent = rndDiv(S, 100); // Postgres redondea el subtotal al castear a numeric(10,2)
  const igvTotalCent = rndDiv(S * IGV_PORCENTAJE, 10000); // round(S_soles × 0.18, 2) — sobre S SIN redondear
  const totalCent = subtotalSinIgvCent + igvTotalCent; // subtotal redondeado + IGV redondeado
  return { subtotalSinIgvCent, igvTotalCent, totalCent };
}

/** Conveniencia: cabecera a partir de una lista de ítems (cantidad × precioDm). */
export function calcularCabecera(items: { cantidad: number; precioSinIgvUnitarioDm: number }[]): CabeceraCalculo {
  const lineasDm = items.map((i) => {
    assertEnteroSeguro(i.cantidad, "cantidad");
    assertEnteroSeguro(i.precioSinIgvUnitarioDm, "precioSinIgvUnitarioDm");
    return i.cantidad * i.precioSinIgvUnitarioDm;
  });
  return calcularCabeceraDesdeLineas(lineasDm);
}

// ============ Conversión UI (sin float en la ruta de precisión de diezmilésimas) ============

/** "12.7119" → 127119 (diezmilésimas). Parseo por dígitos, sin parseFloat × 10000. */
export function solesStrADm(s: string): number {
  return parsearAEscala(s, 4);
}

/** "15.00" → 1500 (céntimos). Parseo por dígitos. */
export function solesStrACent(s: string): number {
  return parsearAEscala(s, 2);
}

function parsearAEscala(s: string, decimales: number): number {
  const limpio = s.trim();
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) throw new RangeError(`monto inválido: "${s}"`);
  const negativo = limpio.startsWith("-");
  const abs = negativo ? limpio.slice(1) : limpio;
  const [entera, frac = ""] = abs.split(".");
  if (frac.length > decimales) throw new RangeError(`"${s}" excede ${decimales} decimales`);
  const fracPad = (frac + "0".repeat(decimales)).slice(0, decimales);
  const valor = Number(entera) * 10 ** decimales + Number(fracPad || "0");
  assertEnteroSeguro(valor, "monto");
  return negativo ? -valor : valor;
}

/** 127119 → "12.7119". */
export function dmASolesStr(dm: number): string {
  return formatearEscala(dm, 4);
}

/** 1500 → "15.00". */
export function centASolesStr(cent: number): string {
  return formatearEscala(cent, 2);
}

function formatearEscala(valor: number, decimales: number): string {
  assertEnteroSeguro(valor, "valor");
  const negativo = valor < 0;
  const abs = Math.abs(valor);
  const escala = 10 ** decimales;
  const entera = Math.floor(abs / escala);
  const frac = abs - entera * escala;
  const s = `${entera}.${String(frac).padStart(decimales, "0")}`;
  return negativo ? `-${s}` : s;
}

/** Formatea CÉNTIMOS como moneda es-PE. S/ desde 1500 → "S/ 15.00". */
export function formatearSolesDesdeCent(cent: number): string {
  assertEnteroSeguro(cent, "cent");
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
  }).format(cent / 100);
}
