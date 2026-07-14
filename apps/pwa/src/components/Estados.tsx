import type { ReactNode } from "react";
import { Button, EmptyState } from "./ui";

// Estados compartidos del panel (tema claro, tono tranquilo). API PÚBLICA INTACTA
// (Cargando / ErrorMsg / Vacio / Tarjeta): muchas páginas los importan; solo cambia el estilo.

export function Cargando({ que = "datos" }: { que?: string }) {
  return <p className="p-6 text-center text-[13px] text-ink-3">Cargando {que}…</p>;
}

export function ErrorMsg({ msg, onReintentar }: { msg: string; onReintentar?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      <p className="text-[13px] text-accent-ink">{msg}</p>
      {onReintentar && (
        <Button variant="outline" size="sm" onClick={onReintentar}>
          Reintentar
        </Button>
      )}
    </div>
  );
}

// Vacío = buena señal en este panel: reusa el look de EmptyState (caja punteada + check verde).
export function Vacio({ children }: { children: ReactNode }) {
  return <EmptyState title={children} />;
}

export function Tarjeta({ titulo, children, accion }: { titulo: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="flex flex-col rounded-[12px] border border-line bg-card">
      <header className="flex items-center justify-between border-b border-line-row px-[20px] py-[14px]">
        <h2 className="text-[13.5px] font-bold text-ink">{titulo}</h2>
        {accion}
      </header>
      <div className="p-[18px_20px]">{children}</div>
    </section>
  );
}
