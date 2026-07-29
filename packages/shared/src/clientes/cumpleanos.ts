// "Cumpleaños de la semana" (plan D1 §12: gesto comercial). La ventana se calcula ACÁ, en JS puro, y
// la consulta solo compara el `MM-DD` de `cliente.fecha_nacimiento` contra una lista corta: así no hay
// aritmética de fechas dentro del SQL y el filtro por sucursal sigue mandando en el plan de la query.

export const DIAS_SEMANA_CUMPLE = 7;
const MAX_DIAS = 31;
const DIA_MS = 86_400_000;

export type DiaCumple = {
  dia: string; // "MM-DD" tal como se compara contra fecha_nacimiento
  ymd: string; // el día concreto del calendario (para calcular qué edad cumple)
  offset: number; // 0 = hoy, 1 = mañana…
};

export function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

// Los `dias` días a partir de hoy (hoy incluido). Cruza el fin de año sin lógica extra porque avanza
// sobre el timestamp, no sobre el string ("12-30" → "01-01" sale solo).
export function ventanaCumpleanos(hoyYmd: string, dias: number = DIAS_SEMANA_CUMPLE): DiaCumple[] {
  const n = Math.min(Math.max(Math.trunc(dias) || DIAS_SEMANA_CUMPLE, 1), MAX_DIAS);
  const base = Date.parse(`${hoyYmd}T12:00:00.000Z`); // mediodía: nunca roza el borde de zona
  if (Number.isNaN(base)) return [];

  const salida: DiaCumple[] = [];
  for (let i = 0; i < n; i++) {
    const iso = new Date(base + i * DIA_MS).toISOString();
    const ymd = iso.slice(0, 10);
    const dia = iso.slice(5, 10);
    salida.push({ dia, ymd, offset: i });
    // Quien nació un 29 de febrero cumple el 28 en los años que no son bisiestos. Sin esta línea su
    // saludo desaparecería 3 de cada 4 años, que es justo el cliente al que más gracia le haría.
    if (dia === "02-28" && !esBisiesto(Number(ymd.slice(0, 4)))) salida.push({ dia: "02-29", ymd, offset: i });
  }
  return salida;
}

// Años que cumple EN ESA FECHA (no la edad de hoy). null si el año de nacimiento no es utilizable:
// mejor no decir nada que saludar con una edad inventada.
export function edadEnCumple(fechaNacimiento: string, ymdDelCumple: string): number | null {
  const nac = Number(fechaNacimiento.slice(0, 4));
  const cumple = Number(ymdDelCumple.slice(0, 4));
  if (!Number.isInteger(nac) || !Number.isInteger(cumple) || nac < 1900) return null;
  const edad = cumple - nac;
  return edad >= 0 && edad <= 130 ? edad : null;
}
