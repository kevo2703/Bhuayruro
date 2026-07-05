import type { ReactNode } from "react";

export function Cargando({ que = "datos" }: { que?: string }) {
  return <p className="opacity-60 text-sm p-6 text-center">Cargando {que}...</p>;
}

export function ErrorMsg({ msg, onReintentar }: { msg: string; onReintentar?: () => void }) {
  return (
    <div className="p-6 text-center">
      <p className="text-red-400 text-sm">{msg}</p>
      {onReintentar && (
        <button onClick={onReintentar} className="mt-2 text-sm underline opacity-70">
          Reintentar
        </button>
      )}
    </div>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="opacity-50 text-sm p-6 text-center">{children}</p>;
}

export function Tarjeta({ titulo, children, accion }: { titulo: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="bg-white/5 rounded-lg border border-white/10">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <h2 className="font-semibold">{titulo}</h2>
        {accion}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
