import type { EstadoSync } from "../lib/useEstadoSync";

// Banner permanente de estado de sincronización (§9). Colores: verde al día · ámbar pendientes ·
// rojo sin conexión / rechazadas. Recibe el estado ya derivado (useEstadoSync).
const COLORES: Record<EstadoSync["nivel"], string> = {
  ok: "#059669", // verde éxito
  pendiente: "#B45309", // ámbar aviso
  rechazada: "#DC2626", // rojo peligro
  offline: "#DC2626",
};

export function BannerSync({ estado }: { estado: EstadoSync }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: COLORES[estado.nivel],
        color: "#fff",
        fontSize: 13,
        fontWeight: 600,
        padding: "4px 12px",
        textAlign: "center",
      }}
    >
      {estado.texto}
    </div>
  );
}
