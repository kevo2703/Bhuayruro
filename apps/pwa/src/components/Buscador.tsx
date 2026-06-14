import { useMemo, useState } from "react";
import { formatearSoles } from "@huayruro/shared";
import type { CatalogoProducto } from "../lib/useCatalogo";

type Props = {
  productos: CatalogoProducto[];
  onAgregar: (producto: CatalogoProducto) => void;
};

export function Buscador({ productos, onAgregar }: Props) {
  const [query, setQuery] = useState("");

  const filtrados = useMemo(() => {
    if (!query.trim()) return productos.slice(0, 50);
    const q = query.toLowerCase();
    return productos
      .filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          (p.principio_activo?.toLowerCase().includes(q) ?? false) ||
          (p.gtin?.includes(q) ?? false),
      )
      .slice(0, 50);
  }, [productos, query]);

  return (
    <section className="bg-white/5 rounded-lg flex flex-col h-full">
      <div className="p-3 border-b border-white/10">
        <input
          type="search"
          placeholder="Buscar por nombre, principio activo o código..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
        />
        <p className="mt-1 text-xs opacity-50">
          O escaneá un código de barras (auto-detecta el lector).
        </p>
      </div>

      <ul className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtrados.length === 0 ? (
          <li className="p-6 text-center opacity-50 text-sm">Sin resultados.</li>
        ) : (
          filtrados.map((p) => (
            <li
              key={p.id}
              className="p-3 hover:bg-white/5 cursor-pointer flex justify-between items-center"
              onClick={() => onAgregar(p)}
            >
              <div className="min-w-0 pr-3">
                <p className="font-medium truncate">{p.nombre}</p>
                <p className="text-xs opacity-60 truncate">
                  {p.presentacion ?? "—"} · {p.laboratorio ?? "—"}
                  {p.requiere_receta && (
                    <span className="ml-1 px-1 py-0 text-[10px] rounded bg-amber-500/20 text-amber-300">
                      receta
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono">{formatearSoles(p.precio_total)}</p>
                {p.stock_unidades != null && (
                  <p
                    className={`text-xs ${
                      p.stock_unidades <= 5 ? "text-red-400" : "opacity-50"
                    }`}
                  >
                    stock: {p.stock_unidades}
                  </p>
                )}
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

