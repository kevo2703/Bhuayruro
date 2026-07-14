import type { ReactNode } from "react";
import { cn } from "./cn";

// Variantes de píldora: cada una resuelve su par bg/fg desde los tokens semánticos, así el markup
// nunca pega un hex. 'translucent' es la única sobre superficie oscura (barra de cadena).
export type ChipVariant = "ok" | "warn" | "danger" | "danger-solid" | "neutral" | "yape" | "info" | "translucent";

const VARIANTE: Record<ChipVariant, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-accent-soft text-accent-ink",
  "danger-solid": "bg-accent text-white",
  neutral: "bg-neutral-soft text-neutral",
  yape: "bg-yape-soft text-yape",
  info: "bg-info-soft text-info-ink",
  translucent: "bg-white/10 text-on-dark-3",
};

type ChipProps = {
  variant: ChipVariant;
  children: ReactNode;
  // `| undefined` explícito: exactOptionalPropertyTypes deja que DeltaPill reenvíe su className opcional.
  className?: string | undefined;
};

// Píldora de dato (Cuadró, Por aprobar, Faltó, Yape, Efectivo…). Radio full, 11.5/600.
export function Chip({ variant, children, className }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-[9px] py-[3px] text-[11.5px] font-semibold",
        VARIANTE[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

type DeltaPillProps = {
  hoy: number;
  tipico: number;
  onDark?: boolean;
  className?: string;
};

// Píldora de variación vs. lo típico. d = variación % redondeada; >+5% señala bueno (verde),
// <-5% señala bajo (ámbar), en medio es neutro. Sobre la barra oscura usa la variante translúcida.
// Guarda contra tipico=0 para no mostrar Infinity/NaN.
export function DeltaPill({ hoy, tipico, onDark, className }: DeltaPillProps) {
  const d = tipico === 0 ? 0 : Math.round(((hoy - tipico) / tipico) * 100);
  const variant: ChipVariant = onDark ? "translucent" : d > 5 ? "ok" : d < -5 ? "warn" : "neutral";
  return (
    <Chip variant={variant} className={className}>
      {d > 0 ? `+${d}` : d}% vs lo típico
    </Chip>
  );
}

// Severidad de un caso. Reusa el mapa de color de Chip pero con su propia tipografía (11/700
// uppercase con tracking), por eso no compone <Chip> (evita chocar dos utilidades de font-size).
export type SeverityNivel = "Crítico" | "Alto" | "Medio" | "Bajo";

const SEVERIDAD: Record<SeverityNivel, ChipVariant> = {
  Crítico: "danger-solid",
  Alto: "danger",
  Medio: "warn",
  Bajo: "neutral",
};

export function SeverityChip({ nivel, className }: { nivel: SeverityNivel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-[9px] py-[3px] text-[11px] font-bold uppercase tracking-[0.05em]",
        VARIANTE[SEVERIDAD[nivel]],
        className,
      )}
    >
      {nivel}
    </span>
  );
}
