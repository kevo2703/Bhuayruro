import type { ReactNode } from "react";
import { solesCent, solesDm } from "../lib/money";
import { totalLineaCent, type CarritoItem, type CarritoTotales } from "../lib/useCarrito";

type Props = {
  items: CarritoItem[];
  totales: CarritoTotales;
  onSetCantidad: (presentacionId: string, cantidad: number) => void;
  onQuitar: (presentacionId: string) => void;
  onCobrar: () => void;
  onLimpiar: () => void;
  cobrando: boolean;
  /** A4: la tarjeta de venta cruzada. Va DENTRO del carrito, pegada al total (ver TarjetaSugerencia). */
  sugerencia?: ReactNode;
};

export function Carrito({ items, totales, onSetCantidad, onQuitar, onCobrar, onLimpiar, cobrando, sugerencia }: Props) {
  return (
    <section className="flex flex-col h-full min-h-0 bg-card border border-line rounded-[12px]">
      <header className="px-4 py-3 border-b border-line flex justify-between items-baseline">
        <h2 className="font-semibold text-ink">Venta en curso</h2>
        {items.length > 0 && (
          <button onClick={onLimpiar} className="text-xs text-ink-3 hover:text-ink-2 underline">
            Vaciar
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-6 text-center text-ink-3 text-sm">
            <p>Escanea un producto o tócalo del catálogo →</p>
          </div>
        ) : (
          <ul className="divide-y divide-line-row">
            {items.map((it) => (
              <li key={it.producto.presentacion_id} className="p-3">
                <div className="flex justify-between items-start">
                  <div className="min-w-0 pr-2">
                    <p className="font-medium truncate text-ink">{it.producto.nombre}</p>
                    <p className="text-xs text-ink-2 tabular-nums">
                      {it.producto.presentacion_nombre} · {solesDm(it.producto.precio_total_dm)} c/u
                    </p>
                  </div>
                  <button
                    onClick={() => onQuitar(it.producto.presentacion_id)}
                    className="w-11 h-11 flex items-center justify-center rounded-[9px] text-lg leading-none text-ink-3 hover:text-accent-ink hover:bg-hover-btn"
                    aria-label="Quitar del carrito"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSetCantidad(it.producto.presentacion_id, it.cantidad - 1)}
                      className="w-11 h-11 flex items-center justify-center rounded-[9px] text-lg leading-none bg-neutral-soft hover:bg-line text-ink"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={it.cantidad}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!isNaN(n)) onSetCantidad(it.producto.presentacion_id, n);
                      }}
                      className="w-14 h-11 text-center bg-field border border-line-input rounded-[9px] text-ink tabular-nums"
                    />
                    <button
                      onClick={() => onSetCantidad(it.producto.presentacion_id, it.cantidad + 1)}
                      className="w-11 h-11 flex items-center justify-center rounded-[9px] text-lg leading-none bg-neutral-soft hover:bg-line text-ink"
                    >
                      +
                    </button>
                  </div>
                  <p className="font-mono text-sm text-ink tabular-nums">{solesCent(totalLineaCent(it))}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sugerencia}

      <footer className="border-t border-line p-4 space-y-2">
        <div className="flex justify-between text-sm text-ink-2">
          <span>Subtotal sin IGV</span>
          <span className="font-mono tabular-nums">{solesCent(totales.subtotal_sin_igv_cent)}</span>
        </div>
        <div className="flex justify-between text-sm text-ink-2">
          <span>IGV 18%</span>
          <span className="font-mono tabular-nums">{solesCent(totales.igv_total_cent)}</span>
        </div>
        <div className="flex justify-between text-xl font-bold pt-2 text-ink">
          <span>Total</span>
          <span className="font-mono tabular-nums">{solesCent(totales.total_cent)}</span>
        </div>

        {/* `bg-ok` y no `bg-ok-strong`: blanco sobre el verde claro da 3,44:1 y el mínimo legible es
            4,5:1 — con el verde del sistema son 5,3:1. Es el botón que más se toca en toda la app y
            se toca con el local lleno; medido sobre lo rendido, no sobre la clase (S17). */}
        <button
          onClick={onCobrar}
          disabled={items.length === 0 || cobrando}
          className="w-full mt-2 py-3 rounded-[9px] bg-ok hover:opacity-90 active:opacity-90 text-white font-semibold tabular-nums disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {cobrando ? "Procesando..." : `Cobrar · ${solesCent(totales.total_cent)}`}
        </button>
      </footer>
    </section>
  );
}
