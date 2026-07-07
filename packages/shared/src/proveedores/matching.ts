// Matching de una oferta de proveedor contra NUESTRO catálogo — B8.2. Módulo PURO (sin DB):
// el repo (apps/api/src/repos/comparador.ts) carga los datos y llama a `matchearOferta`; los
// tests dorados del comparador cubren esta lógica sin tocar la base.
//
// Pipeline por ítem, en orden, primero que pega gana (plan §6.2):
//   1. GTIN exacto contra codigo_barras del tenant → auto (1.0)
//   2. Alias aprendido del proveedor (producto_alias) → auto (1.0)
//   3. Nombre normalizado exacto → auto (0.95)
//   4. Fuzzy (token-set + guarda de concentración): ≥0.90 auto · 0.60–0.89 pendiente (top-3) · <0.60 manual
//
// La confirmación humana escribe `producto_alias` (aprende): el mes siguiente esa lista matchea sola.
import { normalizarNombre } from "../catalogo/normalizar";

export const UMBRAL_MATCH_AUTO = 0.9; // ≥ → match automático
export const UMBRAL_MATCH_PENDIENTE = 0.6; // ≥ (y < auto) → pendiente con sugerencias top-3; < → manual
export const SCORE_GTIN = 1.0;
export const SCORE_ALIAS = 1.0;
export const SCORE_NOMBRE_EXACTO = 0.95;
const FLOOR_SUGERENCIA = 0.4; // no ofrecer sugerencias por debajo de esto (ruido)
const MAX_SUGERENCIAS = 3;

// Palabras de EMPAQUE/FORMA de conteo que NO identifican al producto (después de normalizar: minúsculas
// sin tildes). Se descartan del matching de identidad para que "IBUPROFENO 400MG TAB CAJA X100" pegue
// con "Ibuprofeno 400 mg". Las formas que SÍ distinguen (jarabe/crema/gel/suspension) se conservan.
const RUIDO = new Set([
  "caja", "cajas", "cja", "cjs", "cjas", "blister", "blisters", "blist", "tira", "tiras",
  "fco", "frasco", "frascos", "und", "unid", "unidad", "unidades", "uni", "pack", "paquete",
  "paq", "display", "docena", "caja", "tab", "tabs", "tableta", "tabletas", "cap", "caps",
  "capsula", "capsulas", "comp", "comprimido", "comprimidos", "amp", "ampolla", "ampollas",
  "sob", "sobre", "sobres", "mcg", "por", "grageas", "gragea",
]);

// Unidades de medida → forma canónica (para la guarda de concentración).
const UNIDADES: Record<string, string> = { gr: "g", lt: "l", cc: "ml", ug: "mcg" };
// número (+ decimal) pegado o separado de una unidad → "400mg", "120ml", "1.5l". El orden de la
// alternancia pone las de 2+ letras antes que g/l para no cortar "mg"/"ml"/"kg" en "g"/"l".
const CONCENTRACION = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|gr|kg|ml|cc|lt|ui|%|g|l)(?![a-z])/g;

export type PerfilTexto = { alpha: Set<string>; conc: Set<string> };

/** Tokeniza un texto en identidad (palabras ≥3 letras, sin ruido de empaque) + concentraciones. */
export function tokenizar(texto: string): PerfilTexto {
  const s = normalizarNombre(texto);
  const conc = new Set<string>();
  let m: RegExpExecArray | null;
  CONCENTRACION.lastIndex = 0;
  while ((m = CONCENTRACION.exec(s))) {
    const num = m[1]!.replace(",", ".");
    const uni = UNIDADES[m[2]!] ?? m[2]!;
    conc.add(`${num}${uni}`);
  }
  const alpha = new Set<string>();
  for (const tk of s.match(/[a-z]+/g) ?? []) {
    if (tk.length >= 3 && !RUIDO.has(tk)) alpha.add(tk);
  }
  return { alpha, conc };
}

// Producto del tenant con su perfil precalculado (el repo lo arma UNA vez por producto y reusa).
export type ProductoIndexado = {
  producto_id: string;
  nombre: string;
  nombre_norm: string;
  identidad: Set<string>; // palabras de identidad (nombre + DCI/principio activo)
  lab: Set<string>; // palabras del laboratorio (bonus, nunca penaliza)
  conc: Set<string>; // concentraciones declaradas en nombre/DCI
};

/** Precalcula el perfil de un producto del catálogo del tenant. */
export function indexarProducto(p: {
  producto_id: string;
  nombre: string;
  dci?: string | null;
  laboratorio?: string | null;
}): ProductoIndexado {
  const identidadTexto = [p.nombre, p.dci ?? ""].join(" ");
  const perfil = tokenizar(identidadTexto);
  return {
    producto_id: p.producto_id,
    nombre: p.nombre,
    nombre_norm: normalizarNombre(p.nombre),
    identidad: perfil.alpha,
    lab: tokenizar(p.laboratorio ?? "").alpha,
    conc: perfil.conc,
  };
}

const interseccion = (a: Set<string>, b: Set<string>): number => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
};

/**
 * Puntaje 0..1 de que la oferta describe al producto. Directional coverage (¿está toda la identidad
 * del producto en la oferta?) + precisión (¿la oferta no trae palabras ajenas sin explicar? — el
 * laboratorio del producto se considera "explicado", nunca penaliza). Guarda de concentración:
 * si ambos declaran concentración y NO comparten ninguna, se acota a manual (400mg ≠ 600mg).
 */
export function puntajeOferta(oferta: PerfilTexto, prod: ProductoIndexado): number {
  if (prod.identidad.size === 0) return 0;
  const inter = interseccion(prod.identidad, oferta.alpha);
  const coverage = inter / prod.identidad.size;
  // palabras de la oferta que no son identidad del producto NI su laboratorio
  let extra = 0;
  for (const t of oferta.alpha) if (!prod.identidad.has(t) && !prod.lab.has(t)) extra++;
  const precision = inter + extra === 0 ? 0 : inter / (inter + extra);
  let score = 0.6 * coverage + 0.4 * precision;
  // Guarda de concentración: misma droga, distinta dosis = producto distinto → no auto.
  if (prod.conc.size > 0 && oferta.conc.size > 0 && interseccion(prod.conc, oferta.conc) === 0) {
    score = Math.min(score, 0.55);
  }
  return score < 0 ? 0 : score > 1 ? 1 : score;
}

export type Sugerencia = { producto_id: string; nombre: string; score: number };

export type ResultadoMatch = {
  metodo: "gtin" | "alias" | "nombre_exacto" | "fuzzy" | null;
  producto_id: string | null;
  score: number;
  estado: "auto" | "pendiente"; // 'auto' = producto_id fijo; 'pendiente' = requiere ojo humano
  sugerencias: Sugerencia[]; // top-3 para la UI cuando el resultado no es auto
};

export type OfertaParaMatch = {
  gtin: string | null;
  texto_norm: string; // ya normalizado en la ingesta (misma normalizarNombre)
  texto_original: string;
};

export type IndicesMatch = {
  productos: ProductoIndexado[];
  gtinAProducto: Map<string, string>; // gtin → producto_id (codigo_barras del tenant)
  aliasAProducto: Map<string, string>; // texto_norm → producto_id (producto_alias del proveedor)
};

/**
 * Matchea UNA oferta contra el catálogo del tenant (pipeline completo). Puro: recibe los índices ya
 * cargados. Devuelve el desenlace listo para persistir en lista_item + sugerencias para la revisión.
 */
export function matchearOferta(oferta: OfertaParaMatch, idx: IndicesMatch): ResultadoMatch {
  // 1. GTIN exacto
  if (oferta.gtin) {
    const pid = idx.gtinAProducto.get(oferta.gtin);
    if (pid) return { metodo: "gtin", producto_id: pid, score: SCORE_GTIN, estado: "auto", sugerencias: [] };
  }
  // 2. Alias aprendido del proveedor
  const alias = idx.aliasAProducto.get(oferta.texto_norm);
  if (alias) return { metodo: "alias", producto_id: alias, score: SCORE_ALIAS, estado: "auto", sugerencias: [] };
  // 3. Nombre normalizado exacto
  const exacto = idx.productos.find((p) => p.nombre_norm === oferta.texto_norm);
  if (exacto) return { metodo: "nombre_exacto", producto_id: exacto.producto_id, score: SCORE_NOMBRE_EXACTO, estado: "auto", sugerencias: [] };

  // 4. Fuzzy: puntúa contra todos y ordena.
  const perfil = tokenizar(oferta.texto_original);
  const puntuados = idx.productos
    .map((p) => ({ producto_id: p.producto_id, nombre: p.nombre, score: puntajeOferta(perfil, p) }))
    .sort((a, b) => b.score - a.score);

  const mejor = puntuados[0];
  const sugerencias = puntuados.filter((s) => s.score >= FLOOR_SUGERENCIA).slice(0, MAX_SUGERENCIAS);

  if (mejor && mejor.score >= UMBRAL_MATCH_AUTO) {
    return { metodo: "fuzzy", producto_id: mejor.producto_id, score: mejor.score, estado: "auto", sugerencias: [] };
  }
  if (mejor && mejor.score >= UMBRAL_MATCH_PENDIENTE) {
    return { metodo: "fuzzy", producto_id: mejor.producto_id, score: mejor.score, estado: "pendiente", sugerencias };
  }
  // <0.60 → manual: sin producto asignado, pero ofrecemos sugerencias si hay algo razonable.
  return { metodo: null, producto_id: null, score: mejor?.score ?? 0, estado: "pendiente", sugerencias };
}
