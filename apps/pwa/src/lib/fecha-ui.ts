// Fechas para la UI (zona America/Lima). El server también usa Lima para caja/día.

const fmtLima = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" });

// Hoy (o +N días) en formato YYYY-MM-DD, zona Lima. Para filtros de vencimiento / caja.
export function ahoraFecha(diasAdelante = 0): string {
  return fmtLima.format(new Date(Date.now() + diasAdelante * 86_400_000));
}

// ISO → "05/07 14:32" legible es-PE (Lima).
export function fechaCorta(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
