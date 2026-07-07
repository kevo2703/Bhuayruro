// Validador/mapeador puro de LISTAS DE PRECIOS de proveedores (droguerías) — B8.1.
// Toma el CSV/TSV crudo (Excel→copiar pega TSV; parseCsv detecta tab — D-N8) y devuelve
// ofertas listas para escribir en `lista_item` + rechazos + advertencias, SIN tocar la base.
// El matching contra el catálogo (GTIN→alias→nombre→fuzzy) es de B8.2 — aquí NO se matchea.
//
// Dinero: el precio del proveedor se guarda en CÉNTIMOS enteros (lista_item.precio_cent).
// Se aceptan máximo 2 decimales; 3+ decimales = rechazo (no redondeamos dinero en silencio).
import { parseCsv } from "../csv/parse";
import { GTIN_RE, MAX_PRECIO_DM, normalizarHeader, parseFecha, parseMonedaDm } from "../csv/valores";
import { normalizarNombre } from "../catalogo/normalizar";

export type ItemListaImportable = {
  fila: number; // fila de datos 1-based (sin contar la cabecera)
  textoOriginal: string; // descripción tal cual la droguería
  textoNorm: string;
  gtin: string | null;
  laboratorio: string | null;
  presentacionTexto: string | null; // "CAJA X 100"
  factorUnidades: number | null; // unidades base por unidad de venta del proveedor (parseado; NULL = la UI lo pide al matchear)
  precioCent: number; // precio de la unidad de venta del proveedor, en céntimos
  bonifCompra: number | null; // "10+1" → 10
  bonifGratis: number | null; // "10+1" → 1
  vencimiento: string | null; // YYYY-MM-DD (MM/YYYY → día 01, conservador para venc-corto)
};

export type FilaListaRechazada = { fila: number; texto: string; motivos: string[] };
export type AdvertenciaLista = { fila: number; texto: string; aviso: string };

export type ResultadoLista = {
  delimitador: string;
  columnasDetectadas: string[];
  columnasIgnoradas: string[];
  items: ItemListaImportable[];
  rechazadas: FilaListaRechazada[];
  advertencias: AdvertenciaLista[];
  resumen: {
    filas: number;
    validas: number;
    rechazadas: number;
    con_gtin: number;
    con_factor: number;
    con_bonif: number;
    con_vencimiento: number;
  };
};

// Error estructural (archivo vacío / faltan columnas obligatorias). El row-level va a `rechazadas`.
export class ErrorLista extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorLista";
  }
}

// ---- Columnas: canónica → sinónimos (normalizados sin tildes/espacios). Las listas reales de
// droguería traen de todo; "precio" aquí es SU precio de venta = NUESTRO costo. ----
const SINONIMOS_LISTA: Record<string, string[]> = {
  texto: ["producto", "descripcion", "nombre", "detalle", "articulo", "item", "nombreproducto", "descripcionproducto"],
  codigo_barras: ["codigobarras", "codigodebarras", "barras", "gtin", "ean", "codigo", "cod"],
  laboratorio: ["laboratorio", "lab", "marca", "fabricante"],
  presentacion_texto: ["presentacion", "envase", "empaque", "unidaddeventa", "unidadventa"],
  precio: ["precio", "costo", "preciocontado", "pfarma", "preciounitario", "preciounit", "pu", "importe", "precioventa", "preciofarmacia"],
  bonificacion: ["bonificacion", "bonif", "oferta", "promo", "promocion"],
  vencimiento: ["vencimiento", "vcto", "vto", "fv", "fechavenc", "fechavencimiento", "vence", "caducidad", "fechadevencimiento"],
};

// Umbral "vencimiento corto" (meses). Default de negocio; Kevin lo ratifica/ajusta en T-K13.
// La rotación de provincia es lenta: una oferta que vence pronto NO se elige sola (§6.3 del plan).
export const UMBRAL_VENC_CORTO_MESES = 8;

/** ¿El vencimiento cae antes de hoy + umbral? (comparación de strings ISO; sin Date flotante). */
export function esVencCorto(vencimiento: string, hoy: string, umbralMeses = UMBRAL_VENC_CORTO_MESES): boolean {
  const [y, m, d] = hoy.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + umbralMeses;
  const y2 = Math.floor(total / 12);
  const m2 = (total % 12) + 1;
  // Clampa el día al máximo del mes destino (31-oct + 8m → 30-jun, no "31-jun").
  const maxDia = new Date(Date.UTC(y2, m2, 0)).getUTCDate();
  const limite = `${y2}-${String(m2).padStart(2, "0")}-${String(Math.min(d, maxDia)).padStart(2, "0")}`;
  return vencimiento < limite;
}

const MEDIDAS = new Set(["ML", "MG", "MCG", "UG", "G", "GR", "KG", "L", "LT", "CC", "OZ", "UI", "%", "M", "CM", "MM"]);

/**
 * Extrae el factor de unidades (unidades base por unidad de venta) del texto de presentación
 * o de la descripción: "CAJA X 100 TAB", "X100", "CJA100", "BLÍSTER X 10". Descarta medidas
 * ("FCO X 120 ML" NO es factor 120) y decimales ("X 1.5 L"). null = no se pudo (la UI lo pedirá).
 */
export function parseFactorUnidades(texto: string): number | null {
  const t = texto.toUpperCase();
  const enRango = (n: number) => n >= 1 && n <= 10000;
  // "X 100" / "X100" / "×100" — la X no puede ser el final de otra palabra (FLEX100 no cuenta).
  const re = /(?<![A-Z0-9])[X×]\s*(\d{1,5})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const resto = t.slice(m.index + m[0].length);
    if (/^[.,]\d/.test(resto)) continue; // "X 1.5 L" → decimal, es medida
    const palabra = /^\s*([A-ZÁÉÍÓÚ%]+)/.exec(resto)?.[1] ?? "";
    if (MEDIDAS.has(palabra)) continue; // "X 120 ML" → medida, no conteo
    const n = Number(m[1]);
    if (enRango(n)) return n;
  }
  // "CJA100" / "CAJA 100" (sin X explícita)
  const cja = /(?:CJA|CAJA|CJ)\.?\s*[X×]?\s*(\d{1,5})(?![.,]?\d)/.exec(t);
  if (cja) {
    const n = Number(cja[1]);
    if (enRango(n)) return n;
  }
  // "100 TAB" / "100 CAPSULAS" / "100 UND"
  const suf = /(\d{1,5})\s*(?:TABLETAS?|TAB|CAPSULAS?|CAPS?|COMPRIMIDOS?|COMP|UNIDADES|UNID|UND|SOBRES?|SOB|AMPOLLAS?|AMP)\b/.exec(t);
  if (suf) {
    const n = Number(suf[1]);
    if (enRango(n)) return n;
  }
  return null;
}

/** "10+1" / "10 + 1" → {compra:10, gratis:1}; null si no reconoce. */
export function parseBonificacion(raw: string): { compra: number; gratis: number } | null {
  const m = /^(\d{1,4})\s*\+\s*(\d{1,3})$/.exec(raw.trim());
  if (!m) return null;
  const compra = Number(m[1]);
  const gratis = Number(m[2]);
  if (compra < 1 || gratis < 1) return null;
  return { compra, gratis };
}

/** Fecha de lista de proveedor: además de los formatos del importador acepta "MM/YYYY" → día 01. */
export function parseFechaVenc(raw: string): string | null {
  const s = raw.trim();
  const completa = parseFecha(s);
  if (completa) return completa;
  const m = /^(\d{1,2})[/-](\d{4})$/.exec(s);
  if (!m) return null;
  const mes = Number(m[1]);
  const y = Number(m[2]);
  if (mes < 1 || mes > 12 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mes).padStart(2, "0")}-01`;
}

const recorta = (s: string, max = 300): string => s.slice(0, max);

/**
 * Valida y mapea la lista de un proveedor. Lanza `ErrorLista` en fallos estructurales.
 * Columnas obligatorias: descripción del producto y precio.
 */
export function validarListaCsv(textoCsv: string): ResultadoLista {
  const { delimitador, filas, comillasSinCerrar } = parseCsv(textoCsv);
  if (comillasSinCerrar) {
    throw new ErrorLista("El archivo tiene comillas sin cerrar (un valor con comilla sin escapar). Revísalo: podría estar tragándose filas.");
  }
  if (filas.length === 0) throw new ErrorLista("El archivo está vacío.");
  const cabecera = filas[0]!;

  const idx: Partial<Record<string, number>> = {};
  const columnasDetectadas: string[] = [];
  const columnasIgnoradas: string[] = [];
  cabecera.forEach((h, i) => {
    const norm = normalizarHeader(h);
    const canon = Object.keys(SINONIMOS_LISTA).find((k) => SINONIMOS_LISTA[k]!.includes(norm));
    if (canon && idx[canon] === undefined) {
      idx[canon] = i;
      columnasDetectadas.push(canon);
    } else if (canon && idx[canon] !== undefined && h.trim()) {
      columnasIgnoradas.push(`${h.trim()} (columna repetida de "${canon}", se ignora)`);
    } else if (!canon && h.trim()) {
      columnasIgnoradas.push(h.trim());
    }
  });

  if (idx.texto === undefined) throw new ErrorLista('Falta la columna del producto (acepto "producto" o "descripción").');
  if (idx.precio === undefined) throw new ErrorLista('Falta la columna obligatoria "precio" (o "costo").');
  if (filas.length === 1) throw new ErrorLista("El archivo solo tiene cabecera, sin filas de datos.");

  const celda = (row: string[], key: string): string => {
    const i = idx[key];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const items: ItemListaImportable[] = [];
  const rechazadas: FilaListaRechazada[] = [];
  const advertencias: AdvertenciaLista[] = [];
  const vistosNorm = new Map<string, number>(); // textoNorm → primera fila (duplicado = advertencia, no rechazo)

  for (let f = 1; f < filas.length; f++) {
    const row = filas[f]!;
    const filaNum = f;
    const motivos: string[] = [];
    const texto = celda(row, "texto");
    if (!texto) motivos.push("descripción vacía");

    // precio (obligatorio; máx 2 decimales — céntimos exactos, sin redondeo silencioso)
    const precioRaw = celda(row, "precio");
    let precioCent = 0;
    if (precioRaw === "") motivos.push("precio vacío");
    else {
      const dm = parseMonedaDm(precioRaw);
      if (dm === null) motivos.push(`precio inválido: "${precioRaw}"`);
      else if (dm <= 0) motivos.push("precio debe ser mayor a 0");
      else if (dm > MAX_PRECIO_DM) motivos.push(`precio demasiado alto (máx S/100,000): "${precioRaw}"`);
      else if (dm % 100 !== 0) motivos.push(`precio con más de 2 decimales: "${precioRaw}" (usa céntimos exactos)`);
      else precioCent = dm / 100;
    }

    if (motivos.length > 0) {
      rechazadas.push({ fila: filaNum, texto: texto || "(sin descripción)", motivos });
      continue;
    }

    // código de barras (opcional; inválido → aviso y se descarta, la fila vive por el texto)
    const gtinRaw = celda(row, "codigo_barras");
    let gtin: string | null = null;
    if (gtinRaw !== "") {
      if (GTIN_RE.test(gtinRaw)) gtin = gtinRaw;
      else advertencias.push({ fila: filaNum, texto, aviso: `código de barras raro ("${gtinRaw}") → se ignora, matcheo por nombre` });
    }

    // bonificación (opcional; no reconocida → aviso y sin bonif)
    const bonifRaw = celda(row, "bonificacion");
    let bonif: { compra: number; gratis: number } | null = null;
    if (bonifRaw !== "" && !/^(no|-|0)$/i.test(bonifRaw)) {
      bonif = parseBonificacion(bonifRaw);
      if (!bonif) advertencias.push({ fila: filaNum, texto, aviso: `bonificación no reconocida ("${bonifRaw}") → se ignora (formato: 10+1)` });
    }

    // vencimiento (opcional; no reconocido → aviso y sin fecha)
    const vencRaw = celda(row, "vencimiento");
    let vencimiento: string | null = null;
    if (vencRaw !== "" && !/^(no|-)$/i.test(vencRaw)) {
      vencimiento = parseFechaVenc(vencRaw);
      if (!vencimiento) advertencias.push({ fila: filaNum, texto, aviso: `vencimiento no reconocido ("${vencRaw}") → se ignora (usa AAAA-MM-DD, DD/MM/AAAA o MM/AAAA)` });
    }

    const presentacionTexto = celda(row, "presentacion_texto") || null;
    const textoNorm = normalizarNombre(texto);
    const primera = vistosNorm.get(textoNorm);
    if (primera !== undefined) advertencias.push({ fila: filaNum, texto, aviso: `producto repetido en la lista (ya en fila ${primera}); se cargan ambas ofertas` });
    else vistosNorm.set(textoNorm, filaNum);

    items.push({
      fila: filaNum,
      textoOriginal: recorta(texto),
      textoNorm: recorta(textoNorm),
      gtin,
      laboratorio: celda(row, "laboratorio") ? recorta(celda(row, "laboratorio"), 120) : null,
      presentacionTexto: presentacionTexto ? recorta(presentacionTexto, 120) : null,
      factorUnidades: parseFactorUnidades(presentacionTexto ? `${presentacionTexto} ${texto}` : texto),
      precioCent,
      bonifCompra: bonif?.compra ?? null,
      bonifGratis: bonif?.gratis ?? null,
      vencimiento,
    });
  }

  return {
    delimitador,
    columnasDetectadas,
    columnasIgnoradas,
    items,
    rechazadas,
    advertencias,
    resumen: {
      filas: filas.length - 1,
      validas: items.length,
      rechazadas: rechazadas.length,
      con_gtin: items.filter((i) => i.gtin).length,
      con_factor: items.filter((i) => i.factorUnidades !== null).length,
      con_bonif: items.filter((i) => i.bonifCompra !== null).length,
      con_vencimiento: items.filter((i) => i.vencimiento !== null).length,
    },
  };
}
