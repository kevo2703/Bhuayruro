import { useMemo, useState } from "react";
import { solesDm } from "../lib/money";
import { aProductoVenta, type ResultadoBusqueda } from "../lib/useCatalogoVenta";
import type { ProductoVenta } from "../lib/tipos";

type Props = {
  buscar: (q: string) => ResultadoBusqueda[];
  onAgregar: (pv: ProductoVenta) => void;
};

// Búsqueda local (Dexie, sin tildes + GTIN) + selección de presentación (Δ1). Cada producto muestra
// una fila por presentación con precio; si solo tiene una, toda la fila la agrega.
export function Buscador({ buscar, onAgregar }: Props) {
  const [query, setQuery] = useState("");
  const resultados = useMemo(() => buscar(query), [buscar, query]);

  return (
    <section className="bg-card border border-line rounded-[12px] flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-line">
        <input
          type="search"
          placeholder="Buscar por nombre o código..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
        />
        <p className="mt-1 text-xs text-ink-3">O escanea un código de barras (auto-detecta el lector).</p>
      </div>

      <ul className="flex-1 overflow-y-auto divide-y divide-line-row">
        {resultados.length === 0 ? (
          <li className="p-6 text-center text-ink-3 text-sm">Sin resultados.</li>
        ) : (
          resultados.map((r) => (
            <li key={r.producto_id} className="p-3">
              <p className="font-medium truncate text-ink">{r.nombre}</p>
              <p className="text-xs text-ink-2 truncate">
                {r.presentacion_texto ?? "—"} · {r.laboratorio ?? "—"}
                {r.stock_cache != null && (
                  <span className={`ml-2 tabular-nums ${r.stock_cache <= 5 ? "text-accent-ink" : "text-ink-3"}`}>stock: {r.stock_cache}</span>
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.presentaciones.map((pres) => (
                  <button
                    key={pres.presentacion_id}
                    onClick={() => onAgregar(aProductoVenta(r, pres, null))}
                    className="min-h-11 px-3 rounded-[9px] bg-ok-soft hover:bg-tip-hover border border-tip-border text-sm flex items-center gap-2"
                  >
                    <span className="text-ink">{pres.presentacion_nombre}</span>
                    <span className="font-mono text-ok tabular-nums">{solesDm(pres.precio_total_dm)}</span>
                  </button>
                ))}
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
