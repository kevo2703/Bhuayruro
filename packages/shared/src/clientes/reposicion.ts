// A2 v1 — Reposición de crónicos: el cálculo de "cuándo se le acaba" y el mensaje que se le manda.
//
// Vive en shared (puro, sin base ni red) por dos razones: el cálculo tiene que poder probarse contra
// casos borde sin levantar un Worker, y el TEXTO del mensaje es lo que S19 va a refinar con datos
// reales — conviene que esté en un solo lugar con tests que fijen su forma, y no repartido en la
// pantalla.
//
// LO QUE NO HACE: enviar. La v1 es asistida — genera el texto que se pre-carga en el WhatsApp de la
// botica (`enlaceWhatsapp` de ./whatsapp) y una persona decide si lo manda. El envío automático es
// P4b y su gate es la tasa de respuesta REAL de esto.

export const DIAS_AVISO_DEFAULT = 3;
export const DIAS_AVISO_MIN = 1;
export const DIAS_AVISO_MAX = 7;

// Cuánto atrás se sigue arrastrando a quien nunca fue contactado. Más allá de eso ya no es "le toca
// reponer" sino "hace rato que no viene", que es reactivación (A3) y se dice de otra manera.
export const MAX_ATRASO_DIAS = 60;

// Un tratamiento crónico razonable no dura más de esto; el corte acota la ventana de ventas que se
// mira hacia atrás (y de paso evita arrastrar el historial entero de la botica en cada consulta).
export const MAX_DIAS_TRATAMIENTO = 180;

const DIA_MS = 86_400_000;

/** Días entre dos fechas YYYY-MM-DD (negativo = la segunda ya pasó). NaN-safe: null si no parsean. */
export function diasEntre(desdeYmd: string, hastaYmd: string): number | null {
  const a = Date.parse(`${desdeYmd}T12:00:00.000Z`); // mediodía: nunca roza el borde de zona
  const b = Date.parse(`${hastaYmd}T12:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DIA_MS);
}

/**
 * Fecha en que se le acaba: lo que se llevó ÷ lo que toma por día, sumado al día que se lo llevó.
 * Se trunca a días enteros hacia abajo — si le alcanza para 9,8 días, el aviso sale al noveno; el
 * error tiene que caer del lado de avisar antes, no después.
 */
export function fechaAgotamiento(fechaInicioYmd: string, cantidad: number, dosisDiaria: number): string | null {
  if (!Number.isFinite(cantidad) || !Number.isFinite(dosisDiaria) || cantidad <= 0 || dosisDiaria <= 0) return null;
  const base = Date.parse(`${fechaInicioYmd}T12:00:00.000Z`);
  if (Number.isNaN(base)) return null;
  const dias = Math.floor(cantidad / dosisDiaria);
  if (dias > MAX_DIAS_TRATAMIENTO) return null; // dosis mal cargada (ej. 0,01/día): no se inventa una fecha a 5 años
  return new Date(base + dias * DIA_MS).toISOString().slice(0, 10);
}

/** "2026-07-29" → "29/07" (como lo escribe cualquiera en Perú). */
export function fechaCorta(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : ymd;
}

/**
 * Saludo según la hora de Lima. El mensaje se manda a mano en cualquier momento del día, así que un
 * "buenos días" fijo saldría mal media jornada. (Y en Perú se dice "buenos días", no "buen día".)
 */
export function saludoPeru(horaLima: number): string {
  const h = Number.isFinite(horaLima) ? Math.trunc(horaLima) : 12;
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

/** Primer nombre: el padrón guarda "María Quispe" y en un WhatsApp uno escribe "María". */
export function primerNombre(nombre: string): string {
  const t = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return t;
}

export type ItemReposicion = {
  producto_nombre: string;
  fecha_agotamiento: string; // YYYY-MM-DD
  fecha_compra: string | null; // YYYY-MM-DD de la venta que lo dispensó (null si viene de un seguimiento)
};

export type DatosMensaje = {
  nombreCliente: string;
  botica: string | null;
  items: ItemReposicion[];
  hoyYmd: string;
  horaLima: number;
};

const listar = (partes: string[]): string =>
  partes.length <= 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;

/**
 * El mensaje "de cuidado": saluda, dice DE DÓNDE sale el dato (lo que se llevó y cuándo) y ofrece
 * separarlo. La fecha concreta es lo que hace que no se lea como un mensaje masivo.
 *
 * Dos cosas que parecen detalle y no lo son:
 *   · Si la fecha YA PASÓ no se dice "le alcanza hasta el 20/07" — se dice que se le habría acabado.
 *     Afirmarle a alguien que le queda medicina cuando hace cinco días que no le queda es la forma
 *     más rápida de que deje de creerle a la botica.
 *   · Se usa "estaría / le alcanzaría", no "se le acaba": es una estimación hecha con lo que se
 *     llevó, no un dato que la botica pueda garantizar.
 */
export function mensajeReposicion(d: DatosMensaje): string {
  const nombre = primerNombre(d.nombreCliente);
  const saludo = `${saludoPeru(d.horaLima)}${nombre ? `, ${nombre}` : ""}.`;
  const deQuien = d.botica?.trim() ? ` Le escribo de ${d.botica.trim()}.` : "";

  const items = d.items.filter((i) => i.producto_nombre?.trim() && i.fecha_agotamiento);
  if (items.length === 0) return `${saludo}${deQuien}`;

  const compra = items.find((i) => i.fecha_compra)?.fecha_compra ?? null;
  const desde = compra ? `Por lo que llevó el ${fechaCorta(compra)}, ` : "Según lo que llevó, ";

  let cuerpo: string;
  if (items.length === 1) {
    const it = items[0]!;
    const dias = diasEntre(d.hoyYmd, it.fecha_agotamiento);
    cuerpo =
      dias !== null && dias < 0
        ? `${desde}su ${it.producto_nombre} se le habría acabado el ${fechaCorta(it.fecha_agotamiento)}.`
        : `${desde}su ${it.producto_nombre} le alcanzaría hasta el ${fechaCorta(it.fecha_agotamiento)} más o menos.`;
  } else {
    // Con dos o más se listan con su fecha cada uno: mezclarlos en una sola fecha sería inventarla.
    cuerpo = `${desde}sus tratamientos estarían por acabarse: ${listar(
      items.map((i) => `${i.producto_nombre} (hasta el ${fechaCorta(i.fecha_agotamiento)})`),
    )}.`;
  }

  const cierre =
    items.length === 1
      ? "¿Se lo separamos para que no se quede sin su tratamiento?"
      : "¿Se los separamos para que no se quede sin sus tratamientos?";

  return `${saludo}${deQuien}\n\n${cuerpo}\n\n${cierre}`;
}
