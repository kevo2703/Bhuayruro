import type { ReactNode } from "react";
import { cn } from "./cn";

type EmptyStateProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
};

// Estado vacío tranquilo: en este panel "nada pendiente" es una buena señal, no un error. Caja
// punteada + check verde suave (círculo ok-soft de 18px con punto ok-strong de 8px al centro).
export function EmptyState({ title, subtitle, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 border border-dashed border-line-empty rounded-[12px] p-[26px_20px] text-center",
        className,
      )}
    >
      <span className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-ok-soft">
        <span className="w-2 h-2 rounded-full bg-ok-strong" />
      </span>
      <span className="text-[13px] font-semibold text-ink-emph">{title}</span>
      {subtitle != null && <span className="text-[12px] text-ink-3">{subtitle}</span>}
    </div>
  );
}
