import { formatearSoles } from "@huayruro/shared";
import type { CarritoItem, CarritoTotales } from "../lib/useCarrito";

type Props = {
  items: CarritoItem[];
  totales: CarritoTotales;
  onSetCantidad: (productoId: string, cantidad: number) => void;
  onQuitar: (productoId: string) => void;
  onCobrar: () => void;
  onLimpiar: () => void;
  cobrando: boolean;
};

export function Carrito({
  items,
  totales,
  onSetCantidad,
  onQuitar,
  onCobrar,
  onLimpiar,
  cobrando,
}: Props) {
  return (
    <section className="flex flex-col h-full bg-white/5 rounded-lg">
      <header className="px-4 py-3 border-b border-white/10 flex justify-between items-baseline">
        <h2 className="font-semibold">Venta en curso</h2>
        {items.length > 0 && (
          <button onClick={onLimpiar} className="text-xs opacity-60 hover:opacity-100 underline">
            Vaciar
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-6 text-center opacity-50 text-sm">
            <p>Escaneá un producto o tocá del catálogo →</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {items.map((it) => (
              <li key={it.producto.id} className="p-3">
                <div className="flex justify-between items-start">
                  <div className="min-w-0 pr-2">
                    <p className="font-medium truncate">{it.producto.nombre}</p>
                    <p className="text-xs opacity-60">
                      {formatearSoles(it.producto.precio_total)} c/u
                    </p>
                  </div>
                  <button
                    onClick={() => onQuitar(it.producto.id)}
                    className="opacity-40 hover:opacity-100 text-sm"
                    aria-label="Quitar del carrito"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSetCantidad(it.producto.id, it.cantidad - 1)}
                      className="w-7 h-7 rounded bg-white/10 hover:bg-white/20"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={it.cantidad}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!isNaN(n)) onSetCantidad(it.producto.id, n);
                      }}
                      className="w-12 text-center bg-white/5 rounded py-1 text-sm"
                    />
                    <button
                      onClick={() => onSetCantidad(it.producto.id, it.cantidad + 1)}
                      className="w-7 h-7 rounded bg-white/10 hover:bg-white/20"
                    >
                      +
                    </button>
                  </div>
                  <p className="font-mono text-sm">
                    {formatearSoles(it.producto.precio_total * it.cantidad)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-white/10 p-4 space-y-2">
        <div className="flex justify-between text-sm opacity-70">
          <span>Subtotal sin IGV</span>
          <span className="font-mono">{formatearSoles(totales.subtotal_sin_igv)}</span>
        </div>
        <div className="flex justify-between text-sm opacity-70">
          <span>IGV 18%</span>
          <span className="font-mono">{formatearSoles(totales.igv)}</span>
        </div>
        <div className="flex justify-between text-xl font-bold pt-2">
          <span>Total</span>
          <span className="font-mono">{formatearSoles(totales.total)}</span>
        </div>

        <button
          onClick={onCobrar}
          disabled={items.length === 0 || cobrando}
          className="w-full mt-2 py-3 rounded bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {cobrando ? "Procesando..." : `Cobrar · ${formatearSoles(totales.total)}`}
        </button>
      </footer>
    </section>
  );
}
