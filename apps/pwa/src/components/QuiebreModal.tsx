import { useMemo, useState } from "react";
import { uuidv7 } from "@huayruro/shared";
import { dbLocal } from "../lib/db-local";
import { encolar } from "../lib/cola";
import { flushAhora } from "../lib/useSyncPos";
import type { ResultadoBusqueda } from "../lib/useCatalogoVenta";

type Props = {
  buscar: (q: string) => ResultadoBusqueda[];
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
};

// Quiebre = producto que un cliente pidió y no había (§8 POST /api/quiebres). Botón rápido,
// funciona offline vía la misma cola idempotente. Se puede anclar a un producto del catálogo o
// dejar solo la descripción libre (algo que ni siquiera está en el catálogo).
export function QuiebreModal({ buscar, onListo, onCancelar }: Props) {
  const [q, setQ] = useState("");
  const [elegido, setElegido] = useState<ResultadoBusqueda | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const resultados = useMemo(() => (q.trim() && !elegido ? buscar(q).slice(0, 6) : []), [q, elegido, buscar]);

  async function registrar() {
    if (!elegido && !descripcion.trim()) return;
    setEnviando(true);
    try {
      await encolar(dbLocal, "quiebre", {
        client_uuid: uuidv7(),
        producto_id: elegido?.producto_id ?? null,
        descripcion_libre: descripcion.trim() || elegido?.nombre || null,
        fecha_hora_cliente: new Date().toISOString(),
      });
      flushAhora();
      onListo("Quiebre registrado");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-lg p-6 shadow-xl">
        <h2 className="text-xl font-bold">Registrar quiebre</h2>
        <p className="text-xs opacity-60 mt-1">Un producto que te pidieron y no había.</p>

        {elegido ? (
          <div className="mt-4 flex items-center justify-between bg-white/5 rounded p-3">
            <span className="font-medium truncate">{elegido.nombre}</span>
            <button onClick={() => setElegido(null)} className="text-xs underline opacity-70">
              cambiar
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <input
              type="search"
              autoFocus
              placeholder="Buscar producto (opcional)..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
            />
            {resultados.length > 0 && (
              <ul className="mt-1 max-h-40 overflow-y-auto divide-y divide-white/5 rounded bg-white/5">
                {resultados.map((r) => (
                  <li key={r.producto_id}>
                    <button
                      onClick={() => {
                        setElegido(r);
                        setQ("");
                      }}
                      className="w-full text-left p-2 hover:bg-white/10 text-sm truncate"
                    >
                      {r.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-3">
          <label className="block text-sm mb-1 opacity-80">Nota (o nombre si no está en el catálogo)</label>
          <input
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
            placeholder="Ej. Paracetamol jarabe niños"
          />
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onCancelar} disabled={enviando} className="flex-1 py-2.5 rounded hover:bg-white/5 text-sm disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={() => void registrar()}
            disabled={enviando || (!elegido && !descripcion.trim())}
            className="flex-1 py-2.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold disabled:opacity-30"
          >
            {enviando ? "Registrando..." : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
