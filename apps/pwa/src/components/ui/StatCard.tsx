import type { ReactNode } from "react";
import { cn } from "./cn";

// Tipo del punto-icono de la StatCard: señala la urgencia (rojo = pérdida/atención dura,
// ámbar = pendiente por revisar) sin que el markup nombre un color. Todos miden 8px.
export type StatIcon = "rombo-rojo" | "cuadro-ambar" | "circulo-ambar" | "circulo-rojo";

const ICONO: Record<StatIcon, string> = {
  "rombo-rojo": "rounded-[2px] rotate-45 bg-accent",
  "cuadro-ambar": "rounded-[2px] bg-warn-dot",
  "circulo-ambar": "rounded-full bg-warn-dot",
  "circulo-rojo": "rounded-full bg-accent",
};

type StatCardProps = {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  icon: StatIcon;
  onClick?: () => void;
  // Permite pintar el número (ej. text-accent-ink para cifras negativas). Si se pasa, reemplaza
  // al text-ink por defecto para no chocar dos utilidades de color sobre el mismo elemento.
  numberClassName?: string;
  className?: string;
};

// Tarjeta de "Necesita tu atención": clicable, con punto-icono de urgencia, número grande y
// subtítulo. El hover eleva 1px + borde/sombra cálidos (transición del design system).
export function StatCard({ label, value, subtitle, icon, onClick, numberClassName, className }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1.5 bg-card border border-line rounded-[12px] p-[16px_18px] cursor-pointer transition-all",
        "hover:border-line-hover hover:shadow-[0_6px_18px_rgba(36,29,26,0.07)] hover:-translate-y-px",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("w-2 h-2 flex-none", ICONO[icon])} />
        <span className="text-[12px] font-semibold text-ink-2">{label}</span>
      </div>
      <span className={cn("text-[26px] font-bold tracking-[-0.01em] tabular-nums", numberClassName ?? "text-ink")}>{value}</span>
      {subtitle != null && <span className="text-[12px] text-ink-3">{subtitle}</span>}
    </div>
  );
}

type KpiCardProps = {
  label: string;
  value: ReactNode;
  className?: string;
};

// Variante para los KPIs de Ventas: misma superficie, pero SIN punto ni hover, con número 24/700.
export function KpiCard({ label, value, className }: KpiCardProps) {
  return (
    <div className={cn("flex flex-col gap-1.5 bg-card border border-line rounded-[12px] p-[16px_18px]", className)}>
      <span className="text-[12px] font-semibold text-ink-2">{label}</span>
      <span className="text-[24px] font-bold tracking-[-0.01em] tabular-nums text-ink">{value}</span>
    </div>
  );
}
