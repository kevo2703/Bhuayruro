// Logo de Botica Huayruro: la semilla de huayruro (círculo rojo con su mancha negra).
// El acento entra por `currentColor` (base text-accent, sobrescribible vía className);
// la mancha usa el ink fijo. NO se altera el trazo — solo se re-escala por `size`.
import { cn } from "./cn";

export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className={cn("text-accent", className)}
    >
      {/* semilla — círculo grande del acento */}
      <circle cx="14" cy="14" r="12" fill="currentColor" />
      {/* mancha negra, arriba-izquierda */}
      <circle cx="9.8" cy="10.6" r="5" className="fill-ink" />
    </svg>
  );
}
