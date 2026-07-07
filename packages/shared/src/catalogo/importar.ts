// Validador/mapeador puro del importador de catálogo (T-K4). Toma el CSV crudo y devuelve
// filas listas para escribir + rechazos con motivos + advertencias, SIN tocar la base.
// El endpoint del Worker es la autoridad: parsea aquí, y en dry-run devuelve este mismo reporte.
//
// Reglas de dinero (§6): el usuario llena el PRECIO AL PÚBLICO (con IGV); guardamos el sin_igv
// con `sinIgvDmDesdeVentaPublicaDm`. Stock SIEMPRE en unidades base. FEFO necesita lote+vencimiento.
import { sinIgvDmDesdeVentaPublicaDm, solesStrADm } from "../calculos/dinero";
import { parseCsv } from "../csv/parse";

export type LoteImportable = { numero: string; vencimiento: string }; // vencimiento YYYY-MM-DD
export type BlisterImportable = {
  nombre: string;
  factor: number; // >1, unidades base por blíster/caja
  gtin: string | null;
  precioSinIgvDm: number | null;
  precioVentaPublicaDm: number | null;
};

export type ProductoImportable = {
  fila: number; // fila de datos 1-based (sin contar la cabecera)
  nombre: string;
  nombreNorm: string; // nombre normalizado (dedup de productos sin código)
  gtin: string | null;
  laboratorio: string | null;
  principioActivo: string | null;
  categoria: string | null;
  presentacionTexto: string | null;
  requiereReceta: 0 | 1;
  esCronico: 0 | 1;
  precioCompraDm: number | null;
  precioSinIgvDm: number; // derivado del PVP con IGV
  precioVentaPublicaDm: number; // lo que puso el usuario (para el preview)
  stockInicial: number; // ≥0
  stockMinimo: number; // ≥0
  lote: LoteImportable | null;
  blister: BlisterImportable | null;
};

export type FilaRechazada = { fila: number; nombre: string; motivos: string[] };
export type Advertencia = { fila: number; nombre: string; texto: string };

export type ResultadoValidacion = {
  delimitador: string;
  columnasDetectadas: string[];
  columnasIgnoradas: string[];
  validas: ProductoImportable[];
  rechazadas: FilaRechazada[];
  advertencias: Advertencia[];
  resumen: { filas: number; validas: number; rechazadas: number; con_lote: number; con_blister: number; sin_codigo: number };
};

// Error estructural (archivo vacío / faltan columnas obligatorias). El row-level va a `rechazadas`.
export class ErrorImportacion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorImportacion";
  }
}

// ---- Columnas: canónica → sinónimos aceptados (normalizados sin tildes/espacios) ----
const SINONIMOS: Record<string, string[]> = {
  nombre: ["nombre", "producto", "descripcion", "nombreproducto", "detalle"],
  codigo_barras: ["codigobarras", "codigodebarras", "barras", "gtin", "ean", "codigo", "cod"],
  laboratorio: ["laboratorio", "lab", "marca", "fabricante"],
  principio_activo: ["principioactivo", "principio", "activo", "componente"],
  categoria: ["categoria", "rubro", "clase", "familia"],
  presentacion_texto: ["presentacion", "presentaciontexto", "forma"],
  requiere_receta: ["requiererecetamedica", "requierereceta", "receta", "conreceta"],
  es_cronico: ["escronico", "cronico", "tratamientocronico"],
  precio_compra: ["preciocompra", "compra", "costo", "preciodecompra", "preciocosto"],
  precio_venta: ["precioventa", "venta", "precio", "pvp", "preciodeventa", "preciopublico", "precioalpublico"],
  stock_inicial: ["stockinicial", "stock", "cantidad", "existencia", "inventario"],
  stock_minimo: ["stockminimo", "minimo", "stockmin", "min"],
  numero_lote: ["numerolote", "lote", "nlote", "numerodelote"],
  fecha_vencimiento: ["fechavencimiento", "vencimiento", "vence", "caducidad", "expira", "fechavence"],
  blister_nombre: ["blisternombre", "blister", "presentacion2", "presentacionblister", "empaque"],
  blister_factor: ["blisterfactor", "factor", "factorblister", "unidadesblister", "unidadesporblister"],
  blister_precio_venta: ["blisterprecioventa", "precioblister", "ventablister", "preciopublicoblister"],
  blister_codigo_barras: ["blistercodigobarras", "barrasblister", "gtinblister", "codigoblister"],
};

const normalizarHeader = (s: string): string =>
  s
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // quita tildes (combinantes NFD)
    .toLowerCase()
    .replace(/[\s_./\-]+/g, "") // colapsa separadores
    .trim();

// ---- Parsers de valores ----
const limpiarMoneda = (s: string): string => s.replace(/s\/\.?/gi, "").replace(/\s/g, "").trim();

// S/ 100,000 por unidad (en diezmilésimas). Cota superior: evita que una errata (código pegado en la
// columna de precio) desborde Number.isSafeInteger en la conversión y tumbe el lote. Sobre esto → rechazo.
const MAX_PRECIO_DM = 1_000_000_000;

/** "6,00" / "6.00" / "S/ 6.00" → diezmilésimas; null si es inválido, negativo o ambiguo. */
function parseMonedaDm(raw: string): number | null {
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
function parseEnteroNoNeg(raw: string): number | null {
  const s = raw.trim().replace(/\.0+$/, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

const SI = new Set(["si", "sí", "s", "1", "true", "verdadero", "x", "✓", "yes", "y"]);
const NO = new Set(["no", "n", "0", "false", "falso", "", "-"]);
/** sí/no → 1/0; null si no reconoce. */
function parseBool(raw: string): 0 | 1 | null {
  const s = raw.trim().toLowerCase();
  if (SI.has(s)) return 1;
  if (NO.has(s)) return 0;
  return null;
}

/** YYYY-MM-DD | DD/MM/YYYY | DD-MM-YYYY → YYYY-MM-DD válido; null si inválido. */
function parseFecha(raw: string): string | null {
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

const GTIN_RE = /^[0-9A-Za-z\-]{1,48}$/;
const recorta = (s: string, max = 200): string => s.slice(0, max);
const nuloSiVacio = (s: string): string | null => (s.trim() ? recorta(s.trim()) : null);

/** Nombre normalizado (minúsculas, sin tildes, espacios colapsados) para detectar duplicados
 * de productos SIN código de barras (misma hoja re-importada). */
export const normalizarNombre = (s: string): string =>
  s
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Valida y mapea un CSV de catálogo. Lanza `ErrorImportacion` en fallos estructurales.
 * `opciones.hoy` (YYYY-MM-DD) habilita la advertencia de vencimiento en el pasado.
 */
export function validarCatalogoCsv(textoCsv: string, opciones: { hoy?: string } = {}): ResultadoValidacion {
  const { delimitador, filas, comillasSinCerrar } = parseCsv(textoCsv);
  if (comillasSinCerrar) {
    throw new ErrorImportacion(
      "El archivo tiene comillas sin cerrar (un valor con comilla sin escapar). Revísalo: podría estar tragándose filas.",
    );
  }
  if (filas.length === 0) throw new ErrorImportacion("El archivo está vacío.");
  const cabecera = filas[0]!;

  // Mapea cada cabecera a su clave canónica.
  const idx: Partial<Record<string, number>> = {};
  const columnasDetectadas: string[] = [];
  const columnasIgnoradas: string[] = [];
  cabecera.forEach((h, i) => {
    const norm = normalizarHeader(h);
    const canon = Object.keys(SINONIMOS).find((k) => SINONIMOS[k]!.includes(norm));
    if (canon && idx[canon] === undefined) {
      idx[canon] = i;
      columnasDetectadas.push(canon);
    } else if (canon && idx[canon] !== undefined && h.trim()) {
      columnasIgnoradas.push(`${h.trim()} (columna repetida de "${canon}", se ignora)`);
    } else if (!canon && h.trim()) {
      columnasIgnoradas.push(h.trim());
    }
  });

  if (idx.nombre === undefined) throw new ErrorImportacion('Falta la columna obligatoria "nombre".');
  if (idx.precio_venta === undefined) throw new ErrorImportacion('Falta la columna obligatoria "precio_venta".');
  if (filas.length === 1) throw new ErrorImportacion("El archivo solo tiene cabecera, sin filas de datos.");

  const celda = (row: string[], key: string): string => {
    const i = idx[key];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const validas: ProductoImportable[] = [];
  const rechazadas: FilaRechazada[] = [];
  const advertencias: Advertencia[] = [];

  for (let f = 1; f < filas.length; f++) {
    const row = filas[f]!;
    const filaNum = f; // 1-based sobre datos
    const motivos: string[] = [];
    const nombre = celda(row, "nombre");
    const advs: string[] = [];

    if (!nombre) motivos.push("nombre vacío");

    // precio de venta al público (obligatorio, con IGV)
    const pvpRaw = celda(row, "precio_venta");
    const pvpDm = parseMonedaDm(pvpRaw);
    if (pvpRaw === "") motivos.push("precio_venta vacío");
    else if (pvpDm === null) motivos.push(`precio_venta inválido: "${pvpRaw}"`);
    else if (pvpDm <= 0) motivos.push("precio_venta debe ser mayor a 0");
    else if (pvpDm > MAX_PRECIO_DM) motivos.push(`precio_venta demasiado alto (máx S/100,000): "${pvpRaw}"`);

    // precio de compra (opcional)
    const compraRaw = celda(row, "precio_compra");
    let compraDm: number | null = null;
    if (compraRaw !== "") {
      compraDm = parseMonedaDm(compraRaw);
      if (compraDm === null) motivos.push(`precio_compra inválido: "${compraRaw}"`);
      else if (compraDm > MAX_PRECIO_DM) motivos.push(`precio_compra demasiado alto (máx S/100,000): "${compraRaw}"`);
    }

    // código de barras base (opcional)
    const gtinRaw = celda(row, "codigo_barras");
    let gtin: string | null = null;
    if (gtinRaw !== "") {
      if (!GTIN_RE.test(gtinRaw)) motivos.push(`código de barras inválido: "${gtinRaw}"`);
      else gtin = gtinRaw;
    }

    // stock (opcional, default 0)
    const stockRaw = celda(row, "stock_inicial");
    let stockInicial = 0;
    if (stockRaw !== "") {
      const n = parseEnteroNoNeg(stockRaw);
      if (n === null) motivos.push(`stock_inicial inválido: "${stockRaw}"`);
      else stockInicial = n;
    }
    const minRaw = celda(row, "stock_minimo");
    let stockMinimo = 0;
    if (minRaw !== "") {
      const n = parseEnteroNoNeg(minRaw);
      if (n === null) motivos.push(`stock_minimo inválido: "${minRaw}"`);
      else stockMinimo = n;
    }

    // flags (opcionales; inválido → advertencia + default 0)
    const recetaRaw = celda(row, "requiere_receta");
    let requiereReceta: 0 | 1 = 0;
    if (recetaRaw !== "") {
      const b = parseBool(recetaRaw);
      if (b === null) advs.push(`requiere_receta no reconocido ("${recetaRaw}") → asumido No`);
      else requiereReceta = b;
    }
    const cronicoRaw = celda(row, "es_cronico");
    let esCronico: 0 | 1 = 0;
    if (cronicoRaw !== "") {
      const b = parseBool(cronicoRaw);
      if (b === null) advs.push(`es_cronico no reconocido ("${cronicoRaw}") → asumido No`);
      else esCronico = b;
    }

    // lote (numero_lote + fecha_vencimiento: ambos o ninguno)
    const loteRaw = celda(row, "numero_lote");
    const vencRaw = celda(row, "fecha_vencimiento");
    let lote: LoteImportable | null = null;
    if (loteRaw !== "" || vencRaw !== "") {
      if (loteRaw === "" || vencRaw === "") {
        motivos.push("lote requiere número Y fecha de vencimiento (ambos)");
      } else {
        const venc = parseFecha(vencRaw);
        if (venc === null) motivos.push(`fecha_vencimiento inválida: "${vencRaw}" (usa AAAA-MM-DD o DD/MM/AAAA)`);
        else {
          lote = { numero: recorta(loteRaw, 60), vencimiento: venc };
          if (opciones.hoy && venc < opciones.hoy) advs.push(`lote vencido (${venc})`);
        }
      }
    }

    // blíster (blister_nombre + blister_factor: ambos o ninguno)
    const bNombre = celda(row, "blister_nombre");
    const bFactorRaw = celda(row, "blister_factor");
    const bPvpRaw = celda(row, "blister_precio_venta");
    const bGtinRaw = celda(row, "blister_codigo_barras");
    let blister: BlisterImportable | null = null;
    if (bNombre !== "" || bFactorRaw !== "") {
      if (bNombre === "" || bFactorRaw === "") {
        motivos.push("blíster requiere nombre Y factor (ambos)");
      } else {
        const factor = parseEnteroNoNeg(bFactorRaw);
        if (factor === null || factor < 2) motivos.push(`blister_factor debe ser un entero ≥2: "${bFactorRaw}"`);
        let bPvp: number | null = null;
        if (bPvpRaw !== "") {
          bPvp = parseMonedaDm(bPvpRaw);
          if (bPvp === null || bPvp <= 0) motivos.push(`blister_precio_venta inválido: "${bPvpRaw}"`);
          else if (bPvp > MAX_PRECIO_DM) motivos.push(`blister_precio_venta demasiado alto: "${bPvpRaw}"`);
        }
        let bGtin: string | null = null;
        if (bGtinRaw !== "") {
          if (!GTIN_RE.test(bGtinRaw)) motivos.push(`blister_codigo_barras inválido: "${bGtinRaw}"`);
          else if (gtin && bGtinRaw === gtin) motivos.push("blister_codigo_barras igual al código base");
          else bGtin = bGtinRaw;
        }
        if (factor !== null && factor >= 2 && !motivos.some((m) => m.startsWith("blister") || m.startsWith("blíster"))) {
          blister = {
            nombre: recorta(bNombre, 60),
            factor,
            gtin: bGtin,
            precioSinIgvDm: bPvp !== null ? sinIgvDmDesdeVentaPublicaDm(bPvp) : null,
            precioVentaPublicaDm: bPvp,
          };
        }
      }
    }

    if (motivos.length > 0) {
      rechazadas.push({ fila: filaNum, nombre: nombre || "(sin nombre)", motivos });
      continue;
    }

    // Advertencia de lote-sin-stock: se importa el producto pero sin lote.
    if (lote && stockInicial === 0) {
      advs.push("lote sin stock inicial: se importa el producto sin lote");
      lote = null;
    }

    validas.push({
      fila: filaNum,
      nombre: recorta(nombre),
      nombreNorm: normalizarNombre(nombre),
      gtin,
      laboratorio: nuloSiVacio(celda(row, "laboratorio")),
      principioActivo: nuloSiVacio(celda(row, "principio_activo")),
      categoria: nuloSiVacio(celda(row, "categoria")),
      presentacionTexto: nuloSiVacio(celda(row, "presentacion_texto")),
      requiereReceta,
      esCronico,
      precioCompraDm: compraDm,
      precioSinIgvDm: sinIgvDmDesdeVentaPublicaDm(pvpDm!),
      precioVentaPublicaDm: pvpDm!,
      stockInicial,
      stockMinimo,
      lote,
      blister,
    });
    for (const t of advs) advertencias.push({ fila: filaNum, nombre: nombre || "(sin nombre)", texto: t });
  }

  // Dedup DENTRO del archivo: por GTIN (UNIQUE global en la base) y, para productos SIN código,
  // por nombre normalizado (evita crear dos productos idénticos si el usuario repite la fila).
  const vistos = new Map<string, number>(); // gtin → primera fila que lo usó
  const nombresSinCod = new Map<string, number>(); // nombreNorm → primera fila (solo filas sin gtin)
  const sobrevivientes: ProductoImportable[] = [];
  for (const p of validas) {
    const conflictos: string[] = [];
    for (const g of [p.gtin, p.blister?.gtin ?? null]) {
      if (!g) continue;
      const primero = vistos.get(g);
      if (primero !== undefined) conflictos.push(`código de barras "${g}" repetido (ya en fila ${primero})`);
      else vistos.set(g, p.fila);
    }
    if (!p.gtin) {
      const primero = nombresSinCod.get(p.nombreNorm);
      if (primero !== undefined) conflictos.push(`producto sin código repetido en el archivo (ya en fila ${primero})`);
      else nombresSinCod.set(p.nombreNorm, p.fila);
    }
    if (conflictos.length > 0) rechazadas.push({ fila: p.fila, nombre: p.nombre, motivos: conflictos });
    else sobrevivientes.push(p);
  }

  rechazadas.sort((a, b) => a.fila - b.fila);

  return {
    delimitador,
    columnasDetectadas,
    columnasIgnoradas,
    validas: sobrevivientes,
    rechazadas,
    advertencias,
    resumen: {
      filas: filas.length - 1,
      validas: sobrevivientes.length,
      rechazadas: rechazadas.length,
      con_lote: sobrevivientes.filter((p) => p.lote).length,
      con_blister: sobrevivientes.filter((p) => p.blister).length,
      sin_codigo: sobrevivientes.filter((p) => !p.gtin).length,
    },
  };
}

// ---- Plantilla CSV descargable (cabecera + 2 filas de ejemplo) ----
export const COLUMNAS_PLANTILLA = [
  "nombre",
  "codigo_barras",
  "laboratorio",
  "principio_activo",
  "categoria",
  "presentacion_texto",
  "requiere_receta",
  "es_cronico",
  "precio_compra",
  "precio_venta",
  "stock_inicial",
  "stock_minimo",
  "numero_lote",
  "fecha_vencimiento",
  "blister_nombre",
  "blister_factor",
  "blister_precio_venta",
  "blister_codigo_barras",
] as const;

export const PLANTILLA_CSV = [
  COLUMNAS_PLANTILLA.join(","),
  // Ejemplo 1: con blíster + lote (reemplaza estas filas por tu catálogo real).
  'Ibuprofeno 400 mg,7501234500001,Genérico,Ibuprofeno 400 mg,Antiinflamatorio,Tableta unidad,no,no,0.90,1.80,100,20,L-2405,2027-03-31,Blíster x10,10,17.00,7501234500018',
  // Ejemplo 2: simple, sin blíster ni lote.
  'Paracetamol 500 mg,7501234500002,Genérico,Paracetamol 500 mg,Analgésico,Tableta unidad,no,no,0.75,1.50,200,30,,,,,,',
  "",
].join("\r\n");
