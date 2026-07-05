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
    <section className="bg-white/5 rounded-lg flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-white/10">
        <input
          type="search"
          placeholder="Buscar por nombre o código..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
        />
        <p className="mt-1 text-xs opacity-50">O escanea un código de barras (auto-detecta el lector).</p>
      </div>

      <ul className="flex-1 overflow-y-auto divide-y divide-white/5">
        {resultados.length === 0 ? (
          <li className="p-6 text-center opacity-50 text-sm">Sin resultados.</li>
        ) : (
          resultados.map((r) => (
            <li key={r.producto_id} className="p-3">
              <p className="font-medium truncate">{r.nombre}</p>
              <p className="text-xs opacity-60 truncate">
                {r.presentacion_texto ?? "—"} · {r.laboratorio ?? "—"}
                {r.stock_cache != null && (
                  <span className={`ml-2 ${r.stock_cache <= 5 ? "text-red-400" : "opacity-70"}`}>stock: {r.stock_cache}</span>
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.presentaciones.map((pres) => (
                  <button
                    key={pres.presentacion_id}
                    onClick={() => onAgregar(aProductoVenta(r, pres, null))}
                    className="px-2.5 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/30 text-sm flex items-center gap-2"
                  >
                    <span>{pres.presentacion_nombre}</span>
                    <span className="font-mono text-emerald-300">{solesDm(pres.precio_total_dm)}</span>
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
