import { cn } from "./cn";

// Mini-gráficos del panel (design-system §7 "MiniBarChart" + barra apilada de cadena).
// Ambos nombran roles de color (bg-accent / bg-mini-bar / bg-stack-1|2|3), nunca hex.

// Mini-barras de 7 días (ej. venta diaria). La ÚLTIMA barra (hoy) va en acento rojo; el resto en
// el neutro cálido. Altura de cada barra = max(4, round(v/max*34))px dentro de una fila de 36px.
//
//   <MiniBarChart data={[120, 98, 140, 110, 160, 132, 178]} />
export function MiniBarChart({ data, className }: { data: number[]; className?: string }) {
  if (data.length === 0) return null;
  // max >= 1 evita división por cero cuando todas las cifras son 0.
  const max = Math.max(...data, 1);
  const ultima = data.length - 1;

  return (
    <div className={cn("flex items-end gap-1 h-9", className)}>
      {data.map((v, i) => (
        <div
          key={i}
          className={cn("flex-1 rounded-t-[3px] rounded-b-[1px]", i === ultima ? "bg-accent" : "bg-mini-bar")}
          style={{ height: Math.max(4, Math.round((v / max) * 34)) }}
        />
      ))}
    </div>
  );
}

// Barra apilada de reparto por botica (la de la barra oscura de cadena en Hoy). Cada segmento lleva
// su ancho en % y un tono de la escala rojo-clavel (stack-1/2/3). El track es blanco translúcido
// porque vive sobre la superficie oscura (ink-surface).
//
//   <ChainStackBar segments={[{ pct: 57.5, tono: "1" }, { pct: 25.1, tono: "2" }, { pct: 17.4, tono: "3" }]} />
type Tono = "1" | "2" | "3";

const STACK: Record<Tono, string> = {
  "1": "bg-stack-1",
  "2": "bg-stack-2",
  "3": "bg-stack-3",
};

export function ChainStackBar({
  segments,
  className,
}: {
  segments: { pct: number; tono: Tono }[];
  className?: string;
}) {
  return (
    <div className={cn("flex h-2.5 rounded-full overflow-hidden bg-white/8", className)}>
      {segments.map((s, i) => (
        <div key={i} className={STACK[s.tono]} style={{ width: `${s.pct}%` }} />
      ))}
    </div>
  );
}
