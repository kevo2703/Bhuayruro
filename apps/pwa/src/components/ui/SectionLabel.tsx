import type { ReactNode } from "react";
import { cn } from "./cn";

type SectionLabelProps = {
  children: ReactNode;
  // Slot opcional a la derecha (link "Ver su día →" o nota). Con él, el label se vuelve una fila
  // justify-between; sin él, es solo el label.
  right?: ReactNode;
  className?: string;
};

// Label de sección de contenido (uppercase 11/700, tracking amplio). El texto de la derecha va más
// apagado (11.5 text-ink-3-alt) para no competir con el label.
export function SectionLabel({ children, right, className }: SectionLabelProps) {
  const labelCls = "text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3";
  if (right === undefined) {
    return <div className={cn(labelCls, className)}>{children}</div>;
  }
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <span className={labelCls}>{children}</span>
      <span className="text-[11.5px] text-ink-3-alt">{right}</span>
    </div>
  );
}
