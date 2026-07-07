// Parsers de VALORES de celda compartidos por el importador de catálogo (T-K4) y la ingesta
// de listas de proveedores (B8). Extraídos de catalogo/importar.ts SIN cambiar su comportamiento
// (los tests dorados del importador siguen cubriéndolos).
import { solesStrADm } from "../calculos/dinero";

export const limpiarMoneda = (s: string): string => s.replace(/s\/\.?/gi, "").replace(/\s/g, "").trim();

// S/ 100,000 por unidad (en diezmilésimas). Cota superior: evita que una errata (código pegado en la
// columna de precio) desborde Number.isSafeInteger en la conversión y tumbe el lote. Sobre esto → rechazo.
export const MAX_PRECIO_DM = 1_000_000_000;

/** "6,00" / "6.00" / "S/ 6.00" → diezmilésimas; null si es inválido, negativo o ambiguo. */
export function parseMonedaDm(raw: string): number | null {
  const s0 = limpiarMoneda(raw);
  if (!s0) return null;
  const tieneComa = s0.includes(",");
  const tienePunto = s0.includes(".");
  let s = s0;
  if (tieneComa && tienePunto) return null; // ambiguo (miles vs decimal): no adivinamos
  if (tieneComa) {
    // Coma como decimal es-PE SOLO con 1-2 dígitos ("12,50"). Con 3+ dígitos ("1,200") o varias
    // comas es ambiguo con separador de miles → se rechaza (no adivinamos y evitamos el error 1000x).
    const partes = s0.split(",");
    if (partes.length !== 2 || !/^\d{1,2}$/.test(partes[1]!)) return null;
    s = `${partes[0]}.${partes[1]}`;
  }
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  try {
    return solesStrADm(s);
  } catch {
    return null;
  }
}

/** entero ≥0; acepta "50" y "50.0"; null si inválido. */
export function parseEnteroNoNeg(raw: string): number | null {
  const s = raw.trim().replace(/\.0+$/, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

const SI = new Set(["si", "sí", "s", "1", "true", "verdadero", "x", "✓", "yes", "y"]);
const NO = new Set(["no", "n", "0", "false", "falso", "", "-"]);
/** sí/no → 1/0; null si no reconoce. */
export function parseBool(raw: string): 0 | 1 | null {
  const s = raw.trim().toLowerCase();
  if (SI.has(s)) return 1;
  if (NO.has(s)) return 0;
  return null;
}

/** YYYY-MM-DD | DD/MM/YYYY | DD-MM-YYYY → YYYY-MM-DD válido; null si inválido. */
export function parseFecha(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (mt) {
    y = +mt[1]!;
    m = +mt[2]!;
    d = +mt[3]!;
  } else {
    mt = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
    if (!mt) return null;
    d = +mt[1]!;
    m = +mt[2]!;
    y = +mt[3]!;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // Verifica que sea fecha real (rechaza 2026-02-31).
  const dt = new Date(`${iso}T00:00:00Z`);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return iso;
}

export const GTIN_RE = /^[0-9A-Za-z\-]{1,48}$/;

/** Cabecera de columna normalizada (sin tildes/espacios/separadores) para mapear sinónimos. */
export const normalizarHeader = (s: string): string =>
  s
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // quita tildes (combinantes NFD)
    .toLowerCase()
    .replace(/[\s_./\-]+/g, "") // colapsa separadores
    .trim();
