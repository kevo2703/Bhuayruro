import type { EstadoSync } from "../lib/useEstadoSync";
import { cn } from "./ui";

// Banner permanente de estado de sincronización (§9). El Layout YA NO lo usa (ahora hay SyncPill en
// el topbar); se conserva compilable para quien lo siga importando. API sin cambios: recibe el
// estado ya derivado (useEstadoSync). Tema claro, roles del contrato — nunca hex.
const TONO: Record<EstadoSync["nivel"], { caja: string; punto: string }> = {
  ok: { caja: "bg-ok-soft text-ok", punto: "bg-ok-strong" },
  pendiente: { caja: "bg-warn-soft text-warn", punto: "bg-warn-dot" },
  rechazada: { caja: "bg-accent-soft text-accent-ink", punto: "bg-accent" },
  offline: { caja: "bg-accent-soft text-accent-ink", punto: "bg-accent animate-pulse-dot" },
};

export function BannerSync({ estado }: { estado: EstadoSync }) {
  const t = TONO[estado.nivel];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center justify-center gap-[7px] px-3 py-1.5 text-[13px] font-semibold", t.caja)}
    >
      <span className={cn("h-2 w-2 flex-none rounded-full", t.punto)} aria-hidden="true" />
      {estado.texto}
    </div>
  );
}
