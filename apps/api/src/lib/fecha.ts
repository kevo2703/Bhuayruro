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

// Hora del día (0-23) en la zona de la sucursal. La usa el saludo del mensaje de reposición (A2):
// el mensaje se manda a mano en cualquier momento, así que un "buenos días" fijo saldría mal media
// jornada.
export function horaLocal(zona = "America/Lima", ahora: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: zona, hour: "2-digit", hour12: false }).format(ahora);
  const n = Number(h);
  return Number.isFinite(n) ? n % 24 : 12;
}

// Rango [inicio, fin) en ISO-UTC de un día YYYY-MM-DD de America/Lima (UTC-5 fijo, sin DST).
// Sirve para filtrar `fecha_hora` (ISO-UTC) por día local en el cierre/resumen de caja.
export function rangoDiaLima(fecha: string): { inicio: string; fin: string } {
  const inicio = `${fecha}T05:00:00.000Z`; // 00:00 Lima = 05:00 UTC
  const fin = new Date(new Date(inicio).getTime() + 86_400_000).toISOString();
  return { inicio, fin };
}
