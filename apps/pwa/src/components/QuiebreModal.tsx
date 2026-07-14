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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-surface/40 backdrop-blur p-4">
      <div className="w-full max-w-md bg-card border border-line rounded-[14px] p-6 shadow-[0_10px_30px_rgba(36,29,26,0.25)]">
        <h2 className="text-xl font-bold text-ink">Registrar quiebre</h2>
        <p className="text-xs text-ink-2 mt-1">Un producto que te pidieron y no había.</p>

        {elegido ? (
          <div className="mt-4 flex items-center justify-between bg-inset border border-line-inset rounded-[9px] p-3">
            <span className="font-medium truncate text-ink">{elegido.nombre}</span>
            <button onClick={() => setElegido(null)} className="text-xs underline text-ink-2">
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
              className="w-full px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
            />
            {resultados.length > 0 && (
              <ul className="mt-1 max-h-40 overflow-y-auto divide-y divide-line-row rounded-[9px] bg-inset border border-line-inset">
                {resultados.map((r) => (
                  <li key={r.producto_id}>
                    <button
                      onClick={() => {
                        setElegido(r);
                        setQ("");
                      }}
                      className="w-full text-left p-2 hover:bg-hover-btn text-sm truncate text-ink"
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
          <label className="block text-sm mb-1 text-ink-2">Nota (o nombre si no está en el catálogo)</label>
          <input
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="w-full px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
            placeholder="Ej. Paracetamol jarabe niños"
          />
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancelar}
            disabled={enviando}
            className="flex-1 py-2.5 rounded-[9px] bg-card border border-line-input text-ink-emph hover:bg-hover-btn text-sm disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => void registrar()}
            disabled={enviando || (!elegido && !descripcion.trim())}
            className="flex-1 py-2.5 rounded-[9px] bg-warn-dot hover:bg-warn text-white font-semibold disabled:opacity-30"
          >
            {enviando ? "Registrando..." : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
