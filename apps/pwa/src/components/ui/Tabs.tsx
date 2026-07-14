import type { ReactNode } from "react";
import { cn } from "./cn";

// Tabs-píldora del panel (design-system §7 "Tabs/TabPill"). Fila de píldoras donde una está
// activa. El markup nombra ROLES (bg-ink-surface-2 / bg-card / border-line-input), nunca hex.
//
// Uso:
//   <Tabs>
//     <TabPill active={tab === "revisar"} onClick={() => setTab("revisar")}>Por revisar (5)</TabPill>
//     <TabPill active={tab === "hechos"} onClick={() => setTab("hechos")}>Ya resueltos</TabPill>
//   </Tabs>
//
// El contador ("Por revisar (5)") va dentro del children — el componente no lo formatea.

export function Tabs({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex gap-2", className)}>{children}</div>;
}

export function TabPill({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "px-[14px] py-[7px] rounded-full text-[13px] font-semibold border transition-colors",
        // Activa: píldora oscura (surface-2) con texto claro. Inactiva: tarjeta clara con borde de input.
        active
          ? "bg-ink-surface-2 text-on-dark border-ink-surface-2"
          : "bg-card text-nav-inactive border-line-input hover:bg-hover-btn",
        className,
      )}
    >
      {children}
    </button>
  );
}
