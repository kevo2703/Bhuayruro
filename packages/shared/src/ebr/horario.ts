// Módulo PURO (sin imports, sin DB) para el indicador EBR 'venta fuera de horario' (B11.1).
// Lima es UTC-5 FIJO (sin DST) — igual que el resto del código (dashboard usa date(...,'-5 hours'),
// rangoDiaLima usa 05:00Z). El cruce de medianoche (apertura 14:30 → cierre 00:00/02:00) es la parte
// propensa a error, por eso vive aquí con test unitario.

const LIMA_OFFSET_MIN = 5 * 60; // UTC-5

/** Minutos-del-día [0,1440) en hora local Lima de un instante ISO-8601 UTC. null si la fecha es inválida. */
export function minutosLima(fechaHoraIso: string): number | null {
  const t = Date.parse(fechaHoraIso);
  if (Number.isNaN(t)) return null;
  const totalMin = Math.floor(t / 60000) - LIMA_OFFSET_MIN;
  return ((totalMin % 1440) + 1440) % 1440;
}

/** 'HH:MM' → minutos [0,1440). null si el formato no es válido. */
export function minutosDeHHMM(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * ¿La venta cae FUERA del horario declarado [apertura, cierre) en hora Lima?
 * - Soporta cierre que cruza medianoche (apertura 14:30, cierre 02:00 → intervalo 14:30..02:00).
 * - Cierre '00:00' se interpreta como fin del día (24:00), no como colapso a las 0.
 * - Si apertura/cierre son NULL/ inválidos, o apertura === cierre (24h), devuelve false: no se controla
 *   (cero falsos positivos hasta que la botica cargue su horario).
 */
export function estaFueraDeHorario(
  fechaHoraIso: string,
  apertura: string | null | undefined,
  cierre: string | null | undefined,
): boolean {
  const t = minutosLima(fechaHoraIso);
  const a = minutosDeHHMM(apertura);
  let c = minutosDeHHMM(cierre);
  if (t === null || a === null || c === null) return false;
  if (a === c) return false; // 24h / sin control
  if (c === 0) c = 1440; // cierre a medianoche = fin del día
  const dentro =
    a < c
      ? t >= a && t < c // mismo día: 08:00..20:00
      : t >= a || t < c; // cruza medianoche: 20:00..04:00
  return !dentro;
}
