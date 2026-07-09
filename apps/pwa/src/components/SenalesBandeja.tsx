import { useState } from "react";
import type { Senal } from "../lib/useSenales";

type Props = {
  senales: Senal[];
  onConfirmar: (id: string) => Promise<void>;
  onDescartar: (id: string) => Promise<void>;
  onListo: (mensaje: string) => void;
  onError: (mensaje: string) => void;
  onCerrar: () => void;
};

// Bandeja de señales del audio (B10.2 §8). Faltantes ("no hay X" oído en el mostrador) → confirmar
// crea un quiebre real que alimenta los faltantes/pedidos. Ventas posibles → confirmar deja constancia.
// SKU/nombre SIEMPRE vienen de la D1 (nunca del modelo); el operador tiene la última palabra.
export function SenalesBandeja({ senales, onConfirmar, onDescartar, onListo, onError, onCerrar }: Props) {
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function accion(id: string, fn: (id: string) => Promise<void>, msgOk: string) {
    setOcupado(id);
    try {
      await fn(id);
      onListo(msgOk);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4">
      <div className="w-full max-w-lg bg-zinc-900 border border-white/10 rounded-lg p-6 shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">🎙️ Señales del mostrador</h2>
          <button onClick={onCerrar} className="text-sm underline opacity-70">
            cerrar
          </button>
        </div>
        <p className="text-xs opacity-60 mt-1">
          Detectadas por el audio. Confirma para dejar constancia; descarta si no aplica.
        </p>

        {senales.length === 0 ? (
          <p className="mt-6 text-center text-sm opacity-60 py-8">No hay señales pendientes.</p>
        ) : (
          <ul className="mt-4 space-y-3 overflow-y-auto pr-1">
            {senales.map((s) => {
              const it = s.items[0];
              const esFaltante = s.tipo === "faltante";
              return (
                <li key={s.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${esFaltante ? "bg-amber-500/20 text-amber-300" : "bg-sky-500/20 text-sky-300"}`}>
                      {esFaltante ? "Faltante" : "Venta posible"}
                    </span>
                    {it && <span className="text-[11px] opacity-50">{Math.round(it.confianza * 100)}% seguro</span>}
                  </div>

                  <p className="font-medium">
                    {it?.producto_nombre ?? it?.nombre_detectado ?? "—"}
                    {it && !it.producto_nombre && <span className="text-xs opacity-50"> (sin match en catálogo)</span>}
                  </p>
                  {s.items.length > 1 && (
                    <p className="text-xs opacity-60 mt-0.5">y {s.items.length - 1} producto(s) más</p>
                  )}

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => void accion(s.id, onConfirmar, esFaltante ? "Quiebre registrado" : "Señal confirmada")}
                      disabled={ocupado === s.id}
                      className="flex-1 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold disabled:opacity-40"
                    >
                      {ocupado === s.id ? "..." : esFaltante ? "Confirmar quiebre" : "Confirmar"}
                    </button>
                    <button
                      onClick={() => void accion(s.id, onDescartar, "Señal descartada")}
                      disabled={ocupado === s.id}
                      className="px-3 py-2 rounded hover:bg-white/10 border border-white/10 text-sm disabled:opacity-40"
                    >
                      Descartar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
