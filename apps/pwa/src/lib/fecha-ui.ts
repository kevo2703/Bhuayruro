// Fechas para la UI (zona America/Lima). El server también usa Lima para caja/día.

const fmtLima = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" });

// Hoy (o +N días) en formato YYYY-MM-DD, zona Lima. Para filtros de vencimiento / caja.
export function ahoraFecha(diasAdelante = 0): string {
  return fmtLima.format(new Date(Date.now() + diasAdelante * 86_400_000));
}

// YYYY-MM-DD → "28/07". Fechas del padrón (nacimiento, control de un seguimiento): se leen como se
// escriben a mano en la botica, no en ISO.
export function diaMes(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return m && d ? `${d}/${m}` : ymd;
}

// YYYY-MM-DD → "28/07/1990".
export function fechaDia(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  return a && m && d ? `${d}/${m}/${a}` : ymd;
}

// ISO (UTC) → YYYY-MM-DD del día de LIMA. Los timestamps se guardan en UTC: a las 8 de la noche de
// Lima el UTC ya cambió de día, así que cortar el ISO a 10 caracteres fecha mal lo que pasó de noche.
export function ymdLima(iso: string): string {
  try {
    return fmtLima.format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

// ISO (UTC) → "28/07/2026" en día de Lima (constancias: consentimiento, compras).
export function fechaDiaDeIso(iso: string): string {
  return fechaDia(ymdLima(iso));
}

// ISO → "05/07 14:32" legible es-PE (Lima).
export function fechaCorta(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
