// Píldora de estado de sincronización. Hoy el estado es device-local (esta PC);
// el estado por-botica es 'próximamente', así que el texto lo arma quien la usa.
import { cn } from "./cn";

export type SyncTono = "online" | "offline" | "pendiente";

// Cada tono resuelve su par caja(bg/fg) + punto desde roles del contrato — nunca hex.
const TONOS: Record<SyncTono, { caja: string; punto: string }> = {
  online: { caja: "bg-ok-soft text-ok", punto: "bg-ok-strong" },
  offline: { caja: "bg-accent-soft text-accent-ink", punto: "bg-accent animate-pulse-dot" },
  pendiente: { caja: "bg-warn-soft text-warn", punto: "bg-warn-dot" },
};

export function SyncPill({
  tono,
  texto,
  className,
}: {
  tono: SyncTono;
  texto: string;
  className?: string;
}) {
  const v = TONOS[tono];
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-[7px] rounded-full px-[13px] py-1.5 text-xs font-semibold",
        v.caja,
        className,
      )}
    >
      <span className={cn("h-2 w-2 flex-none rounded-full", v.punto)} aria-hidden="true" />
      {texto}
    </span>
  );
}
