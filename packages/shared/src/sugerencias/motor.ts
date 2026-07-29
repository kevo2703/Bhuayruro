import { normalizarNombre } from "../catalogo/normalizar";

// ============================================================
// A4 — Venta cruzada por reglas en el POS (plan de expansión §2 A4).
//
// Módulo PURO a propósito: el motor corre en el mostrador contra la cache Dexie, sin red. En hora
// punta una sugerencia que espera un round-trip llega cuando la persona ya se fue, así que la
// decisión de qué recomendar no puede depender del servidor.
//
// VETO §2 A4 (ratificado por Kevin en la spec de S15): suena a CONSEJO del que atiende, nunca a
// sobreventa, y **máximo UNA sugerencia por venta**. El tope vive acá y no en la pantalla: es una
// regla del producto, no un detalle de UI — y así los tests lo pueden defender.
// ============================================================

export const TOPE_SUGERENCIAS_POR_VENTA = 1;

export const DISPARADORES = ["producto", "categoria", "principio_activo"] as const;
export type DisparadorTipo = (typeof DISPARADORES)[number];

export const RESULTADOS_SUGERENCIA = ["mostrada", "aceptada", "rechazada"] as const;
export type ResultadoSugerencia = (typeof RESULTADOS_SUGERENCIA)[number];

/** Tope del guion: es una frase que se dice en voz alta, no un párrafo que se lee. */
export const MAX_GUION = 220;
export const MAX_DISPARADOR_VALOR = 120;

export type ReglaSugerencia = {
  id: string;
  disparador_tipo: DisparadorTipo;
  disparador_valor: string;
  sugerido_producto_id: string;
  guion: string;
  prioridad: number;
};

/** Lo mínimo que el motor necesita del producto que acaba de entrar al carrito. */
export type ProductoDisparador = {
  producto_id: string;
  categoria: string | null;
  principio_activo: string | null;
};

export type ContextoSugerencia = {
  /** Productos que ya están en el carrito: no se recomienda lo que la persona ya se lleva. */
  productosEnCarrito: string[];
  /**
   * Stock local por producto. `null` = la cache todavía no cargó (no se sabe) y entonces NO se
   * bloquea nada; con la cache lista, un producto sin stock queda fuera. Recomendar lo que no se
   * puede entregar es peor que no recomendar nada.
   */
  stockPorProducto: Record<string, number> | null;
  /** Reglas ya mostradas en esta atención — no se repite un consejo que la persona ya escuchó. */
  reglasYaMostradas?: string[];
};

const norm = (s: string | null | undefined): string => (s ? normalizarNombre(s) : "");

/**
 * ¿Este producto dispara esta regla?
 *
 * `producto` compara el id tal cual (es un UUID, no texto de humano). `categoria` y
 * `principio_activo` comparan por CONTENIDO normalizado: en el catálogo real el principio activo
 * viene con la concentración pegada ("Ibuprofeno 400 mg"), así que una regla escrita "ibuprofeno"
 * tiene que pegar igual — pedir igualdad exacta obligaría a curar una regla por concentración.
 */
export function disparaRegla(r: ReglaSugerencia, p: ProductoDisparador): boolean {
  if (r.disparador_tipo === "producto") return r.disparador_valor.trim() === p.producto_id;
  const valor = norm(r.disparador_valor);
  if (!valor) return false;
  const campo = r.disparador_tipo === "categoria" ? norm(p.categoria) : norm(p.principio_activo);
  return campo.length > 0 && campo.includes(valor);
}

/**
 * Elige LA sugerencia (una sola) para el producto que se acaba de agregar, o `null` si no hay
 * ninguna que valga la pena. Determinista: prioridad DESC y luego id ASC, para que el mismo carrito
 * dé el mismo consejo en dos equipos distintos.
 */
export function elegirSugerencia(
  reglas: ReglaSugerencia[],
  disparador: ProductoDisparador,
  ctx: ContextoSugerencia,
): ReglaSugerencia | null {
  const yaMostradas = new Set(ctx.reglasYaMostradas ?? []);
  const enCarrito = new Set(ctx.productosEnCarrito);

  const candidatas = reglas.filter((r) => {
    if (yaMostradas.has(r.id)) return false;
    if (!disparaRegla(r, disparador)) return false;
    // Sugerir el mismo producto que la disparó no es un consejo, es un eco.
    if (r.sugerido_producto_id === disparador.producto_id) return false;
    if (enCarrito.has(r.sugerido_producto_id)) return false;
    if (ctx.stockPorProducto && (ctx.stockPorProducto[r.sugerido_producto_id] ?? 0) <= 0) return false;
    return true;
  });

  if (candidatas.length === 0) return null;
  const ordenadas = candidatas.slice().sort((a, b) => b.prioridad - a.prioridad || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return ordenadas[0] ?? null;
}

// ---- Validación compartida (el formulario del admin y el endpoint dicen lo MISMO) ----

export type ReglaEntrante = {
  disparador_tipo: string;
  disparador_valor: string;
  sugerido_producto_id: string;
  guion: string;
  prioridad?: number;
};

export type ReglaValidada = {
  disparador_tipo: DisparadorTipo;
  disparador_valor: string;
  sugerido_producto_id: string;
  guion: string;
  prioridad: number;
};

/** Devuelve el error legible (es-PE) o `null` si la regla es válida. */
export function errorDeRegla(r: ReglaEntrante): string | null {
  if (!DISPARADORES.includes(r.disparador_tipo as DisparadorTipo)) {
    return "disparador_tipo debe ser producto, categoria o principio_activo";
  }
  const valor = (r.disparador_valor ?? "").trim();
  if (!valor) return "el disparador no puede estar vacío";
  if (valor.length > MAX_DISPARADOR_VALOR) return `el disparador no puede pasar de ${MAX_DISPARADOR_VALOR} caracteres`;
  if (!(r.sugerido_producto_id ?? "").trim()) return "falta el producto que se sugiere";
  const guion = (r.guion ?? "").trim();
  if (!guion) return "el guion es obligatorio: es la frase que se dice en voz alta";
  if (guion.length > MAX_GUION) return `el guion no puede pasar de ${MAX_GUION} caracteres`;
  if (r.disparador_tipo === "producto" && valor === r.sugerido_producto_id.trim()) {
    return "una regla no puede sugerir el mismo producto que la dispara";
  }
  return null;
}

/** Normaliza una regla ya validada (recorta y fija la prioridad en un entero). */
export function normalizarRegla(r: ReglaEntrante): ReglaValidada {
  const p = Number(r.prioridad);
  return {
    disparador_tipo: r.disparador_tipo as DisparadorTipo,
    disparador_valor: r.disparador_valor.trim().slice(0, MAX_DISPARADOR_VALOR),
    sugerido_producto_id: r.sugerido_producto_id.trim(),
    guion: r.guion.trim().slice(0, MAX_GUION),
    prioridad: Number.isFinite(p) ? Math.trunc(p) : 0,
  };
}

// ---- Conversión (la tablita que sirve para PODAR reglas) ----

export type ConversionRegla = { mostradas: number; aceptadas: number };

/**
 * Conversión de una regla en porcentaje entero, o `null` si nunca se mostró. Sin denominador NO se
 * inventa un 0 %: se leería como "no convierte" cuando lo que pasó es que nadie la vio todavía
 * (mismo criterio que el KPI de identificadas de S14).
 */
export function pctConversion(c: ConversionRegla): number | null {
  if (!Number.isFinite(c.mostradas) || c.mostradas <= 0) return null;
  return Math.min(Math.round((Math.max(c.aceptadas, 0) / c.mostradas) * 100), 100);
}
