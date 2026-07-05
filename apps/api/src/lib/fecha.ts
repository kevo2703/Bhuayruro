// Timestamps ISO-8601 UTC inyectados desde el Worker (plan §5.1): NO datetime('now'),
// para poder testear con reloj fijo. Todas las columnas *_at / fecha_hora usan esto.

export function ahoraIso(): string {
  return new Date().toISOString();
}

// Fecha YYYY-MM-DD en la zona de la sucursal (por defecto America/Lima) para cierre de caja.
export function fechaLocal(zona = "America/Lima", ahora: Date = new Date()): string {
  // en-CA da formato YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    ahora,
  );
}
