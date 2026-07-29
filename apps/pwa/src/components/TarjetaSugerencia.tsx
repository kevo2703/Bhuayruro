import { useEffect, useRef } from "react";
import { solesDm } from "../lib/money";
import type { SugerenciaViva } from "../lib/useSugerencia";

// A4 — La tarjeta vive DENTRO del carrito, no en un modal ni en un toast: quien atiende la dice
// cuando le calce en la conversación, y mientras tanto no le tapa el total ni el botón de cobrar.
//
// Tono (veto §2 A4): el protagonista es el GUION, no el precio ni el nombre comercial. Nada de
// "¡Oferta!", nada de descuentos, nada de urgencia. Es el consejo del que atiende.
export function TarjetaSugerencia({ sugerencia, onAgregar, onDescartar }: {
  sugerencia: SugerenciaViva;
  onAgregar: () => void;
  onDescartar: () => void;
}) {
  const p = sugerencia.producto;
  const ref = useRef<HTMLDivElement>(null);

  // En el celular el carrito va DEBAJO del buscador, así que la tarjeta nacía fuera de pantalla: el
  // consejo aparecía justo cuando hay que decirlo y nadie lo veía. Se la trae a la vista al aparecer
  // (en escritorio el carrito ya está visible y esto no mueve nada).
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [sugerencia.reglaId]);

  return (
    <div ref={ref} className="m-3 rounded-[11px] border border-info/30 bg-info-soft p-3" data-testid="sugerencia">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-info-ink leading-snug">
          <span aria-hidden="true">💡 </span>
          {sugerencia.guion}
        </p>
        <button
          onClick={onDescartar}
          aria-label="Descartar sugerencia"
          className="shrink-0 w-11 h-11 -mt-2 -mr-2 flex items-center justify-center rounded-[9px] text-lg leading-none text-ink-3 hover:text-ink-2 hover:bg-hover-btn"
        >
          ×
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-ink-2 truncate">
          {p.nombre} · {p.presentacion_nombre} · <span className="tabular-nums">{solesDm(p.precio_total_dm)}</span>
        </p>
        <button
          onClick={onAgregar}
          className="shrink-0 min-h-11 px-3 rounded-[9px] bg-card border border-info/40 text-info-ink text-sm font-semibold hover:bg-hover-btn"
        >
          + Agregar
        </button>
      </div>
    </div>
  );
}
