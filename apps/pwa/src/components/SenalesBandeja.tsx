import { useState } from "react";
import type { Senal } from "../lib/useSenales";
import { SelectorProducto, type ProductoRef } from "./SelectorProducto";

type Props = {
  senales: Senal[];
  onConfirmar: (id: string, productoId?: string) => Promise<void>;
  onDescartar: (id: string) => Promise<void>;
  onListo: (mensaje: string) => void;
  onError: (mensaje: string) => void;
  onCerrar: () => void;
};

// Bandeja de señales del audio (B10.2 + contexto/reproductor/feedback de B10.4). Faltantes ("no hay X"
// oído en el mostrador) → confirmar crea un quiebre real que alimenta los faltantes/pedidos; si el
// match salió mal, "Corregir" deja elegir el producto correcto (va al quiebre Y se aprende). Ventas
// posibles → confirmar deja constancia para el QA, NO registra una venta (esa se cobra en el Mostrador).
// SKU/nombre SIEMPRE vienen de la D1; el contexto (frase + audio) hace la confirmación accionable.
export function SenalesBandeja({ senales, onConfirmar, onDescartar, onListo, onError, onCerrar }: Props) {
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function accion(id: string, fn: () => Promise<void>, msgOk: string) {
    setOcupado(id);
    try {
      await fn();
      onListo(msgOk);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-surface/40 backdrop-blur p-4">
      <div className="w-full max-w-lg bg-card border border-line rounded-[14px] p-6 shadow-[0_10px_30px_rgba(36,29,26,0.25)] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink">🎙️ Señales del mostrador</h2>
          <button onClick={onCerrar} className="inline-flex min-h-11 items-center px-2 text-sm underline text-ink-2">
            cerrar
          </button>
        </div>
        <p className="text-xs text-ink-2 mt-1">
          Detectadas por el audio. Escucha y corrobora; confirma para dejar constancia, o descarta si no aplica.
        </p>

        {senales.length === 0 ? (
          <p className="mt-6 text-center text-sm text-ink-3 py-8">No hay señales pendientes.</p>
        ) : (
          <ul className="mt-4 space-y-3 overflow-y-auto pr-1">
            {senales.map((s) => (
              <FilaSenal key={s.id} s={s} ocupado={ocupado === s.id} onConfirmar={onConfirmar} onDescartar={onDescartar} accion={accion} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilaSenal({
  s,
  ocupado,
  onConfirmar,
  onDescartar,
  accion,
}: {
  s: Senal;
  ocupado: boolean;
  onConfirmar: (id: string, productoId?: string) => Promise<void>;
  onDescartar: (id: string) => Promise<void>;
  accion: (id: string, fn: () => Promise<void>, msgOk: string) => Promise<void>;
}) {
  const [corregir, setCorregir] = useState(false);
  const [verTodo, setVerTodo] = useState(false);
  const it = s.items[0];
  const esFaltante = s.tipo === "faltante";

  return (
    <li className="rounded-[11px] border border-line-inset bg-inset p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs px-2 py-0.5 rounded-full ${esFaltante ? "bg-warn-soft text-warn" : "bg-info-soft text-info-ink"}`}>
          {esFaltante ? "Faltante" : "Venta posible"}
        </span>
        {it && <span className="text-[11px] text-ink-3 tabular-nums">{Math.round(it.confianza * 100)}% seguro</span>}
      </div>

      <p className="font-medium text-ink">
        {it?.producto_nombre ?? it?.nombre_detectado ?? "—"}
        {it && !it.producto_nombre && <span className="text-xs text-ink-3"> (sin match en catálogo)</span>}
      </p>
      {s.items.length > 1 && <p className="text-xs text-ink-2 mt-0.5">y {s.items.length - 1} producto(s) más</p>}

      {/* Contexto (B10.4.2): la frase oída + transcripción completa a demanda. */}
      {s.frase && <p className="text-xs italic text-ink-strong mt-1 border-l-2 border-line-input pl-2">“{s.frase}”</p>}
      {s.transcripcion && s.transcripcion.trim() !== (s.frase ?? "").trim() && (
        <button onClick={() => setVerTodo((v) => !v)} className="text-xs underline text-ink-2 mt-1 min-h-11 inline-flex items-center">
          {verTodo ? "ocultar" : "ver transcripción completa"}
        </button>
      )}
      {verTodo && s.transcripcion && (
        <p className="text-[11px] text-ink-strong mt-1 bg-inset border border-line-inset rounded-[9px] p-2 whitespace-pre-wrap">{s.transcripcion}</p>
      )}

      {/* El reproductor de audio vive en el panel admin (#/audio-calidad, admin+); aquí, en el Mostrador,
          va operador+ → solo contexto de texto (frase + transcripción), sin audio. */}

      {/* Aclaración horneada (B10.4.4): confirmar una venta posible NO registra una venta. */}
      {!esFaltante && (
        <p className="text-[11px] text-ink-2 mt-2">
          Confirmar deja constancia para el QA — <span className="font-medium text-ink">no registra la venta</span> (esa se cobra en el Mostrador).
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void accion(s.id, () => onConfirmar(s.id), esFaltante ? "Quiebre registrado" : "Señal confirmada")}
          disabled={ocupado}
          className="flex-1 py-2.5 rounded-[9px] bg-ok-strong hover:bg-ok text-white text-sm font-semibold disabled:opacity-40"
        >
          {ocupado ? "..." : esFaltante ? "Confirmar quiebre" : "Confirmar"}
        </button>
        {esFaltante && (
          <button
            onClick={() => setCorregir((v) => !v)}
            disabled={ocupado}
            className="px-3 py-2.5 rounded-[9px] border border-info/30 text-info-ink hover:bg-info-soft text-sm disabled:opacity-40"
          >
            {corregir ? "Cancelar" : "Corregir"}
          </button>
        )}
        <button
          onClick={() => void accion(s.id, () => onDescartar(s.id), "Señal descartada")}
          disabled={ocupado}
          className="px-3 py-2.5 rounded-[9px] bg-card border border-line-input text-ink-emph hover:bg-hover-btn text-sm disabled:opacity-40"
        >
          Descartar
        </button>
      </div>

      {/* Corregir el producto (B10.4.4): elige el correcto → quiebre + corrección aprendida. */}
      {corregir && esFaltante && (
        <div className="mt-2">
          <p className="text-[11px] text-ink-2 mb-1">Elige el producto correcto: va al quiebre y el sistema aprende el nombre.</p>
          <SelectorProducto
            placeholder="Buscar el producto correcto..."
            onSelect={(p: ProductoRef) => {
              setCorregir(false);
              void accion(s.id, () => onConfirmar(s.id, p.id), "Quiebre registrado y nombre aprendido");
            }}
          />
        </div>
      )}
    </li>
  );
}
