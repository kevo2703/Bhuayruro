// Conversación del bot de Telegram de inventario — B9 (§7.2). Módulo PURO: máquina de estados
// chica (sin framework) + parsers de texto. NO toca DB, red ni Telegram. El orquestador
// (apps/api/src/repos/bot.ts) resuelve allowlist/dedup/OCR/persistencia y llama a `avanzar`.
//
// Regla de negocio D-N4: el bot registra lo que LLEGA. El flujo guiado captura, por caja:
//   producto → lote/vencimiento → precio unidad → blíster? → cantidad → ubicación → resumen
// y al confirmar produce un borrador que un admin aprueba en la web (bandeja §7.4).
//
// El bot NUNCA devuelve datos del sistema (precios/stock): solo conduce el alta (§7.1).

import { solesStrACent } from "../calculos/dinero";

// ── Tipos ──────────────────────────────────────────────────────────────────────
export type EstadoBot =
  | "inicio"
  | "producto"
  | "producto_ok"
  | "lote"
  | "lote_ok"
  | "precio"
  | "blister"
  | "cantidad"
  | "ubicacion"
  | "resumen";

export type BorradorBot = {
  producto_texto?: string;
  producto_id?: string; // si el orquestador lo cruza contra el catálogo del tenant
  maestro_id?: string; // referencia al catálogo maestro (informativo)
  gtin?: string;
  lote?: string;
  vencimiento?: string; // YYYY-MM-DD (día 01)
  precio_unidad_cent?: number;
  precio_blister_cent?: number;
  unidades_por_blister?: number;
  cantidad?: number;
  ubicacion?: string;
  fotos?: string[]; // claves R2
  confianza_ocr?: number;
};

export type BotonInline = { texto: string; data: string };
export type Respuesta = { texto: string; botones?: BotonInline[][] };

export type EntradaBot =
  | { tipo: "texto"; texto: string }
  | { tipo: "callback"; data: string };

export type AccionTerminal = "crear_borrador" | "descartar";

export type TransicionBot = {
  estado: EstadoBot;
  borrador: BorradorBot;
  respuesta: Respuesta | null;
  accion?: AccionTerminal;
  // El orquestador debe cruzar el producto contra el maestro (para GTIN/menos tipeo) antes de seguir.
  enriquecerProducto?: boolean;
};

// callback_data (Telegram limita a 1–64 bytes).
export const CB = { ok: "ok", editar: "editar", enviar: "enviar", descartar: "descartar" } as const;

// ── Textos (constantes: el orquestador reusa las "pista" para el fallback de foto ilegible) ──
export const PROMPT_PRODUCTO = "📷 Mándame una foto de la CAJA (que se vea el nombre y el laboratorio) o escribe el nombre del producto.";
export const PROMPT_LOTE = "📷 Foto del LOTE y VENCIMIENTO (el troquelado) o escríbelo así: LOTE / MM-AAAA (ej: A123 / 05-2027).";
export const PISTA_LOTE = "No lo entendí 😅 Escríbelo así: LOTE / MM-AAAA — por ejemplo: A123 / 05-2027.";
export const PROMPT_PRECIO = "💰 ¿Precio por unidad? (ej: 1.50)";
export const PROMPT_BLISTER = "¿Vendes por blíster? Escribe el precio y las unidades (ej: 12 x 10) o escribe *no*.";
export const PROMPT_CANTIDAD = "📦 ¿Cuántas unidades sueltas llegaron? (frascos / tabletas sueltas — un número, ej: 50)";
export const PROMPT_UBICACION = "📍 ¿Dónde va? (ej: estante 3, gaveta B)";

const btn = (texto: string, data: string): BotonInline => ({ texto, data });
const SI_NO: BotonInline[][] = [[btn("✅ Sí", CB.ok), btn("✏️ Corregir", CB.editar)]];

// ── Formato de dinero (puro, céntimos → "S/ X.XX") ──────────────────────────────
const soles = (cent: number): string => `S/ ${(cent / 100).toFixed(2)}`;

// ── Parsers de texto (puros, probados) ──────────────────────────────────────────

/** Comando "/algo arg" → {comando:"algo", arg}. Devuelve null si no empieza con "/". */
export function parseComando(texto: string): { comando: string; arg: string } | null {
  const t = texto.trim();
  if (!t.startsWith("/")) return null;
  const m = t.slice(1).match(/^(\w+)(?:@\w+)?\s*(.*)$/s); // ignora @NombreDelBot en grupos
  if (!m) return null;
  return { comando: m[1]!.toLowerCase(), arg: m[2]!.trim() };
}

/** Precio en soles → céntimos (>0). Acepta "1.50" y "1,50". null si inválido o ≤0. */
export function parsePrecioSoles(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  let cent: number;
  try {
    cent = solesStrACent(t);
  } catch {
    return null;
  }
  return cent > 0 ? cent : null;
}

/** Cantidad de unidades: primer entero ≥1 del texto ("50", "50 unidades"). null si no hay. */
export function parseCantidad(s: string): number | null {
  const m = s.trim().match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Blíster: "no" → {tipo:"no"}; "12 x 10" → {tipo:"si", precioCent, unidades}. null si inválido. */
export function parseBlister(s: string): { tipo: "no" } | { tipo: "si"; precioCent: number; unidades: number } | null {
  const t = s.trim().toLowerCase();
  if (/^no?$/.test(t) || t === "ninguno" || t === "nel") return { tipo: "no" };
  // "12 x 10", "12.50 × 10", "s/12 x 10"
  const m = t.replace(/s\/\s*/g, "").match(/^(\d+(?:[.,]\d{1,2})?)\s*[x×]\s*(\d+)$/);
  if (!m) return null;
  const precioCent = parsePrecioSoles(m[1]!);
  const unidades = Number(m[2]);
  if (precioCent === null || !Number.isInteger(unidades) || unidades < 1) return null;
  return { tipo: "si", precioCent, unidades };
}

const MESES_OK = (mm: number) => mm >= 1 && mm <= 12;
const anioLargo = (yy: string): number => (yy.length === 2 ? 2000 + Number(yy) : Number(yy));

/**
 * Lote + vencimiento desde texto de troquelado. Acepta separador "/" o espacio y varios formatos
 * de fecha: MM-AAAA, MM/AAAA, MM-AA, AAAA-MM. Devuelve {lote, vencimiento:"YYYY-MM-01"} o null.
 */
export function parseLoteVenc(s: string): { lote: string; vencimiento: string } | null {
  // Quita SOLO etiquetas de varias letras (no "l"/"v" sueltas: se comerían el prefijo de un lote real como "L9").
  const limpio = s.trim().replace(/\b(lote|lot)\s*[:.]?/gi, " ").replace(/\b(vence|venc|vto|exp|caduca)\s*[:.]?/gi, " ");
  // Busca la fecha: AAAA-MM  |  MM(-|/| )AAAA/AA
  let anio: number | null = null;
  let mes: number | null = null;
  let fechaSpan: [number, number] | null = null;

  const isoM = limpio.match(/(20\d{2})[-/](\d{1,2})/);
  const mmYY = limpio.match(/(\d{1,2})[-/](\d{4}|\d{2})/);
  if (isoM) {
    anio = Number(isoM[1]);
    mes = Number(isoM[2]);
    fechaSpan = [isoM.index!, isoM.index! + isoM[0].length];
  } else if (mmYY) {
    mes = Number(mmYY[1]);
    anio = anioLargo(mmYY[2]!);
    fechaSpan = [mmYY.index!, mmYY.index! + mmYY[0].length];
  }
  if (anio === null || mes === null || !MESES_OK(mes)) return null;

  // El lote = lo que queda al quitar la fecha (primer token alfanumérico de ≥2 chars).
  const resto = (limpio.slice(0, fechaSpan![0]) + " " + limpio.slice(fechaSpan![1])).trim();
  const loteM = resto.match(/[A-Za-z0-9]{2,}/);
  if (!loteM) return null;
  const vencimiento = `${anio}-${String(mes).padStart(2, "0")}-01`;
  return { lote: loteM[0].toUpperCase(), vencimiento };
}

// ── Resumen del borrador para el paso final ─────────────────────────────────────
export function resumenBorrador(b: BorradorBot): string {
  const lineas = [
    `📦 *Resumen de lo que llegó*`,
    `• Producto: ${b.producto_texto ?? "—"}`,
    `• Lote: ${b.lote ?? "—"} · vence ${b.vencimiento ? b.vencimiento.slice(0, 7) : "—"}`,
    `• Precio unidad: ${b.precio_unidad_cent != null ? soles(b.precio_unidad_cent) : "—"}`,
  ];
  if (b.precio_blister_cent != null && b.unidades_por_blister != null) {
    lineas.push(`• Blíster: ${soles(b.precio_blister_cent)} × ${b.unidades_por_blister} u`);
  }
  lineas.push(`• Cantidad: ${b.cantidad ?? "—"} unidades`);
  lineas.push(`• Ubicación: ${b.ubicacion ?? "—"}`);
  return lineas.join("\n");
}

const resumenTransicion = (borrador: BorradorBot): TransicionBot => ({
  estado: "resumen",
  borrador,
  respuesta: {
    texto: `${resumenBorrador(borrador)}\n\n¿Lo envío a aprobación?`,
    botones: [[btn("✅ Enviar a aprobación", CB.enviar), btn("❌ Descartar", CB.descartar)]],
  },
});

// ── Máquina de estados ──────────────────────────────────────────────────────────

const AYUDA_INICIO =
  "Hola 👋 Escribe /nuevo para registrar lo que llegó, o /lote para repetir la última caja igual.";

/**
 * Avanza la conversación. Puro y determinista: dado (estado, borrador, entrada) devuelve la
 * transición. Los comandos /nuevo /lote /cancelar se atienden en cualquier estado. La entrada de
 * foto la resuelve el orquestador (OCR → texto), así que aquí solo llegan texto y callback.
 */
export function avanzar(
  estado: EstadoBot,
  borrador: BorradorBot,
  entrada: EntradaBot,
  ctx?: { ultimoProducto?: { producto_texto: string; gtin?: string; maestro_id?: string } },
): TransicionBot {
  // Comandos globales (solo en entradas de texto).
  if (entrada.tipo === "texto") {
    const cmd = parseComando(entrada.texto);
    if (cmd) {
      if (cmd.comando === "nuevo") {
        return { estado: "producto", borrador: {}, respuesta: { texto: PROMPT_PRODUCTO } };
      }
      if (cmd.comando === "cancelar") {
        return { estado: "inicio", borrador: {}, respuesta: { texto: "Listo, lo cancelé. Escribe /nuevo cuando quieras 👍" } };
      }
      if (cmd.comando === "lote") {
        const ult = ctx?.ultimoProducto;
        if (!ult) {
          return { estado: "inicio", borrador: {}, respuesta: { texto: "Todavía no registraste una caja. Empieza con /nuevo." } };
        }
        const nb: BorradorBot = { producto_texto: ult.producto_texto };
        if (ult.gtin) nb.gtin = ult.gtin;
        if (ult.maestro_id) nb.maestro_id = ult.maestro_id;
        return { estado: "lote", borrador: nb, respuesta: { texto: `Repetimos *${ult.producto_texto}*.\n${PROMPT_LOTE}` } };
      }
      // /vincular u otro comando desconocido: lo maneja el orquestador o se ignora aquí.
      return { estado, borrador, respuesta: { texto: AYUDA_INICIO } };
    }
  }

  switch (estado) {
    case "inicio":
      return { estado: "inicio", borrador, respuesta: { texto: AYUDA_INICIO } };

    case "producto": {
      if (entrada.tipo !== "texto") return quedarse(estado, borrador, PROMPT_PRODUCTO);
      const nombre = entrada.texto.trim();
      if (nombre.length < 2) return quedarse(estado, borrador, PROMPT_PRODUCTO);
      const nb = { ...borrador, producto_texto: nombre };
      return { estado: "producto_ok", borrador: nb, respuesta: { texto: `Entendí: *${nombre}*\n¿Es correcto?`, botones: SI_NO } };
    }

    case "producto_ok": {
      if (entrada.tipo === "callback") {
        if (entrada.data === CB.ok) {
          return { estado: "lote", borrador, respuesta: { texto: PROMPT_LOTE }, enriquecerProducto: true };
        }
        if (entrada.data === CB.editar) {
          return { estado: "producto", borrador, respuesta: { texto: "Escribe el nombre correcto del producto:" } };
        }
      }
      // Si escribe en vez de tocar el botón, lo tomamos como corrección del nombre.
      if (entrada.tipo === "texto" && entrada.texto.trim().length >= 2) {
        const nb = { ...borrador, producto_texto: entrada.texto.trim() };
        return { estado: "producto_ok", borrador: nb, respuesta: { texto: `Entendí: *${nb.producto_texto}*\n¿Es correcto?`, botones: SI_NO } };
      }
      return quedarse(estado, borrador, "Toca ✅ Sí o ✏️ Corregir.");
    }

    case "lote": {
      if (entrada.tipo !== "texto") return quedarse(estado, borrador, PISTA_LOTE);
      const lv = parseLoteVenc(entrada.texto);
      if (!lv) return quedarse(estado, borrador, PISTA_LOTE);
      const nb = { ...borrador, lote: lv.lote, vencimiento: lv.vencimiento };
      return { estado: "lote_ok", borrador: nb, respuesta: { texto: `Lote *${lv.lote}*, vence *${lv.vencimiento.slice(0, 7)}* — ¿correcto?`, botones: SI_NO } };
    }

    case "lote_ok": {
      if (entrada.tipo === "callback") {
        if (entrada.data === CB.ok) return { estado: "precio", borrador, respuesta: { texto: PROMPT_PRECIO } };
        if (entrada.data === CB.editar) return { estado: "lote", borrador, respuesta: { texto: PROMPT_LOTE } };
      }
      if (entrada.tipo === "texto") {
        const lv = parseLoteVenc(entrada.texto);
        if (lv) {
          const nb = { ...borrador, lote: lv.lote, vencimiento: lv.vencimiento };
          return { estado: "lote_ok", borrador: nb, respuesta: { texto: `Lote *${lv.lote}*, vence *${lv.vencimiento.slice(0, 7)}* — ¿correcto?`, botones: SI_NO } };
        }
      }
      return quedarse(estado, borrador, "Toca ✅ Sí o ✏️ Corregir.");
    }

    case "precio": {
      if (entrada.tipo !== "texto") return quedarse(estado, borrador, PROMPT_PRECIO);
      const cent = parsePrecioSoles(entrada.texto);
      if (cent === null) return quedarse(estado, borrador, "Escribe el precio por unidad en soles, ej: 1.50");
      return { estado: "blister", borrador: { ...borrador, precio_unidad_cent: cent }, respuesta: { texto: PROMPT_BLISTER } };
    }

    case "blister": {
      if (entrada.tipo !== "texto") return quedarse(estado, borrador, PROMPT_BLISTER);
      const b = parseBlister(entrada.texto);
      if (!b) return quedarse(estado, borrador, "Escribe el precio y las unidades del blíster, ej: 12 x 10 (o escribe *no*).");
      const nb: BorradorBot = { ...borrador };
      if (b.tipo === "si") {
        nb.precio_blister_cent = b.precioCent;
        nb.unidades_por_blister = b.unidades;
      } else {
        delete nb.precio_blister_cent;
        delete nb.unidades_por_blister;
      }
      return { estado: "cantidad", borrador: nb, respuesta: { texto: PROMPT_CANTIDAD } };
    }

    case "cantidad": {
      if (entrada.tipo !== "texto") return quedarse(estado, borrador, PROMPT_CANTIDAD);
      const n = parseCantidad(entrada.texto);
      if (n === null) return quedarse(estado, borrador, "Dime cuántas unidades llegaron con un número, ej: 50");
      return { estado: "ubicacion", borrador: { ...borrador, cantidad: n }, respuesta: { texto: PROMPT_UBICACION } };
    }

    case "ubicacion": {
      if (entrada.tipo !== "texto") return quedarse(estado, borrador, PROMPT_UBICACION);
      const u = entrada.texto.trim();
      if (u.length < 1) return quedarse(estado, borrador, PROMPT_UBICACION);
      return resumenTransicion({ ...borrador, ubicacion: u });
    }

    case "resumen": {
      if (entrada.tipo === "callback") {
        if (entrada.data === CB.enviar) {
          return { estado: "inicio", borrador, accion: "crear_borrador", respuesta: { texto: "✅ ¡Enviado! Lo aprueba el admin en la web 👍\n\n/nuevo para otro producto · /lote para otra caja igual." } };
        }
        if (entrada.data === CB.descartar) {
          return { estado: "inicio", borrador: {}, accion: "descartar", respuesta: { texto: "❌ Descartado. Escribe /nuevo para empezar de nuevo." } };
        }
      }
      return quedarse(estado, borrador, "Toca ✅ Enviar a aprobación o ❌ Descartar.");
    }
  }
}

const quedarse = (estado: EstadoBot, borrador: BorradorBot, texto: string): TransicionBot => ({ estado, borrador, respuesta: { texto } });
