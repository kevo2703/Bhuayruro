import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { getToken } from "../lib/auth";

export type ProductoRef = { id: string; nombre: string };

// Buscador de producto contra el catálogo del server (GET /catalogo/productos?q=), para pantallas
// admin/operación (recepción, mínimos, precios). No filtra por precio → sirve para productos nuevos.
export function SelectorProducto({ onSelect, placeholder = "Buscar producto..." }: { onSelect: (p: ProductoRef) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ProductoRef[]>([]);
  const [cargando, setCargando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResultados([]);
      return;
    }
    timer.current = setTimeout(() => {
      setCargando(true);
      void apiRequest<{ productos: ProductoRef[] }>(`/catalogo/productos?q=${encodeURIComponent(q.trim())}`, { token: getToken() })
        .then((r) => setResultados(r.productos))
        .catch(() => setResultados([]))
        .finally(() => setCargando(false));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <div className="relative">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
      />
      {q.trim() && (
        <ul className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded bg-zinc-800 border border-white/10 shadow-xl divide-y divide-white/5">
          {cargando ? (
            <li className="p-2 text-sm opacity-60">Buscando...</li>
          ) : resultados.length === 0 ? (
            <li className="p-2 text-sm opacity-60">Sin resultados</li>
          ) : (
            resultados.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => {
                    onSelect(p);
                    setQ("");
                    setResultados([]);
                  }}
                  className="w-full text-left p-2 hover:bg-white/10 text-sm truncate"
                >
                  {p.nombre}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
