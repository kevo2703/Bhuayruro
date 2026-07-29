import { useEffect, useState } from "react";
import { dbLocal } from "../lib/db-local";
import { agregarFamiliar, crearTratamiento, panelCliente, type Familiar } from "../lib/clientes";

export type ItemVendido = { producto_id: string; nombre: string };

type Props = {
  clienteId: string;
  clienteNombre: string;
  items: ItemVendido[];
  clientUuidVenta: string | null; // para colgar el seguimiento a la venta cuando la cola la confirme
  onListo: (mensaje: string) => void;
  onCerrar: () => void;
};

// Días típicos de control en mostrador. Son los que se tocan de un dedo; cualquier otro caso se edita
// después desde la ficha del cliente (no vale la pena un teclado numérico en hora punta).
const DIAS = [3, 5, 7, 15] as const;
const DIAS_DEFECTO = 5;

// "Seguimiento en 2 taps" del §12: *Ibuprofeno → para el hijo → preguntar en ~5 días*. Con un solo
// producto en la venta y el titular como destinatario, guardar es literalmente elegir los días y
// confirmar; todo lo demás ya viene resuelto.
//
// El `venta_id` NO se pide: se busca en la cola local por el client_uuid de la venta recién cobrada. Si
// la cola todavía no la confirmó (sin red), el seguimiento se guarda igual sin venta — el dato que
// importa es qué se llevó y qué hay que preguntarle, no el número de ticket.
export function TratamientoModal({ clienteId, clienteNombre, items, clientUuidVenta, onListo, onCerrar }: Props) {
  const [productoId, setProductoId] = useState<string | null>(items.length === 1 ? (items[0]?.producto_id ?? null) : null);
  const [descripcionLibre, setDescripcionLibre] = useState("");
  const [familiares, setFamiliares] = useState<Familiar[]>([]);
  const [familiarId, setFamiliarId] = useState<string | null>(null); // null = para el titular
  const [nuevoFamiliar, setNuevoFamiliar] = useState("");
  const [mostrarNuevoFamiliar, setMostrarNuevoFamiliar] = useState(false);
  const [dias, setDias] = useState<number>(DIAS_DEFECTO);
  const [indicacion, setIndicacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    panelCliente(clienteId, ctrl.signal)
      .then((p) => {
        if (!ctrl.signal.aborted) setFamiliares(p.familiares);
      })
      .catch(() => {
        /* sin familiares cargados igual se puede registrar para el titular */
      });
    return () => ctrl.abort();
  }, [clienteId]);

  const elegido = items.find((i) => i.producto_id === productoId) ?? null;
  const descripcion = elegido?.nombre ?? descripcionLibre.trim();

  async function agregarPersona() {
    const nombre = nuevoFamiliar.trim();
    if (!nombre) return;
    try {
      const f = await agregarFamiliar(clienteId, nombre);
      setFamiliares((prev) => [...prev, f]);
      setFamiliarId(f.id);
      setNuevoFamiliar("");
      setMostrarNuevoFamiliar(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function guardar() {
    if (!descripcion) return;
    setGuardando(true);
    setError(null);
    try {
      let ventaId: string | null = null;
      if (clientUuidVenta) {
        const op = await dbLocal.cola_ops.get(clientUuidVenta);
        ventaId = op?.venta_id ?? null;
      }
      await crearTratamiento(clienteId, {
        descripcion,
        familiar_id: familiarId,
        venta_id: ventaId,
        producto_id: productoId,
        duracion_dias: dias,
        indicacion_seguimiento: indicacion.trim() || null,
      });
      const paraQuien = familiarId ? familiares.find((f) => f.id === familiarId)?.nombre : null;
      onListo(`Seguimiento guardado${paraQuien ? ` (para ${paraQuien})` : ""} · se pregunta en ${dias} días`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-surface/40 backdrop-blur p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-card border border-line rounded-t-[14px] sm:rounded-[14px] p-5 sm:p-6 shadow-[0_10px_30px_rgba(36,29,26,0.25)] max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink">Seguimiento</h2>
          <button onClick={onCerrar} className="inline-flex min-h-11 items-center px-2 text-sm underline text-ink-2">
            ahora no
          </button>
        </div>
        <p className="text-xs text-ink-2 mt-1">
          Para acordarte de preguntarle a <b className="text-ink">{clienteNombre}</b> cómo le fue.
        </p>

        <div className="mt-3 flex-1 overflow-y-auto">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">¿Qué se llevó?</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {items.map((i) => (
              <Chip key={i.producto_id} activo={productoId === i.producto_id} onClick={() => setProductoId(i.producto_id)}>
                {i.nombre}
              </Chip>
            ))}
            <Chip activo={productoId === null} onClick={() => setProductoId(null)}>
              otra cosa
            </Chip>
          </div>
          {productoId === null && (
            <input
              type="text"
              value={descripcionLibre}
              onChange={(e) => setDescripcionLibre(e.target.value)}
              placeholder="¿Qué se llevó?"
              className="mt-2 w-full min-h-11 px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
            />
          )}

          <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-3">¿Para quién?</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Chip activo={familiarId === null} onClick={() => setFamiliarId(null)}>
              Para {clienteNombre.split(" ")[0]}
            </Chip>
            {familiares.map((f) => (
              <Chip key={f.id} activo={familiarId === f.id} onClick={() => setFamiliarId(f.id)}>
                {f.nombre}
                {f.relacion ? ` (${f.relacion})` : ""}
              </Chip>
            ))}
            {!mostrarNuevoFamiliar && (
              <Chip activo={false} onClick={() => setMostrarNuevoFamiliar(true)}>
                + otra persona
              </Chip>
            )}
          </div>
          {mostrarNuevoFamiliar && (
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                type="text"
                value={nuevoFamiliar}
                onChange={(e) => setNuevoFamiliar(e.target.value)}
                placeholder="Su hijo, su mamá…"
                className="flex-1 min-h-11 px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
              />
              <button
                onClick={() => void agregarPersona()}
                disabled={!nuevoFamiliar.trim()}
                className="min-h-11 px-4 rounded-[9px] bg-card border border-line-input text-ink-emph text-sm disabled:opacity-40"
              >
                Agregar
              </button>
            </div>
          )}

          <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-3">¿En cuántos días le preguntas?</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {DIAS.map((d) => (
              <Chip key={d} activo={dias === d} onClick={() => setDias(d)}>
                {d} días
              </Chip>
            ))}
          </div>

          <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-3">¿Qué le vas a preguntar? (opcional)</p>
          <input
            type="text"
            value={indicacion}
            onChange={(e) => setIndicacion(e.target.value)}
            placeholder="Si le bajó la fiebre"
            className="mt-1 w-full min-h-11 px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-ink"
          />

          {error && <p className="mt-3 text-xs text-accent-ink">{error}</p>}
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 min-h-11 py-2.5 rounded-[9px] bg-card border border-line-input text-ink-emph hover:bg-hover-btn text-sm disabled:opacity-50"
          >
            Ahora no
          </button>
          <button
            onClick={() => void guardar()}
            disabled={guardando || !descripcion}
            className="flex-1 min-h-11 py-2.5 rounded-[9px] bg-ok text-white font-semibold disabled:opacity-30"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
        activo ? "border-ok bg-ok-soft text-ok" : "border-line-input bg-card text-ink-2 hover:bg-hover-btn"
      }`}
    >
      {children}
    </button>
  );
}
