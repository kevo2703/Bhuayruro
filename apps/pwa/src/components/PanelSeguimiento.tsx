import { useCallback, useEffect, useState } from "react";
import { solesCent } from "../lib/money";
import {
  cerrarSeguimiento,
  cuandoCumple,
  cuandoToca,
  nombreCorto,
  panelCliente,
  telefonoLegible,
  type Cumpleanero,
  type PanelCliente,
  type SeguimientoPendiente,
} from "../lib/clientes";

type Props = {
  clienteId: string | null;
  pendientes: SeguimientoPendiente[];
  cumpleanos: Cumpleanero[];
  recargaToken: number; // cambia cuando se registró un seguimiento nuevo → recarga el panel
  onAsignarId: (clienteId: string) => void;
  onQuitar: () => void;
  onRegistrarSeguimiento: (clienteId: string, nombre: string) => void;
  onCambio: () => void; // avisa al padre que las listas quedaron viejas
  onError: (mensaje: string) => void;
};

// Panel de Seguimiento del Mostrador (§12). Dos estados:
//   · SIN cliente → a quién le toca preguntar hoy + cumpleaños de la semana.
//   · CON cliente → su ficha de mostrador: qué se llevó, para quién, qué hay que preguntarle.
//
// P3 (cámara) NO necesita tocar este componente: reconocer un rostro es llamar a `onAsignarId` con el
// cliente vinculado — el mismo camino que usa "asignar" a mano hoy. Por eso el panel recibe un id y se
// carga solo, en vez de esperar que se lo pasen desde el cobro.
export function PanelSeguimiento({
  clienteId,
  pendientes,
  cumpleanos,
  recargaToken,
  onAsignarId,
  onQuitar,
  onRegistrarSeguimiento,
  onCambio,
  onError,
}: Props) {
  const [panel, setPanel] = useState<PanelCliente | null>(null);
  const [cargando, setCargando] = useState(false);
  const [cerrando, setCerrando] = useState<string | null>(null);

  useEffect(() => {
    if (!clienteId) {
      setPanel(null);
      return;
    }
    const ctrl = new AbortController();
    setCargando(true);
    panelCliente(clienteId, ctrl.signal)
      .then((p) => {
        if (!ctrl.signal.aborted) setPanel(p);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) onError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false);
      });
    return () => ctrl.abort();
    // `onError` es estable en el Mostrador (useCallback); recargaToken fuerza el refresco tras registrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, recargaToken]);

  const cerrar = useCallback(
    async (cliente: string, tratamiento: string) => {
      setCerrando(tratamiento);
      try {
        await cerrarSeguimiento(cliente, tratamiento);
        setPanel((p) => (p ? { ...p, tratamientos: p.tratamientos.filter((t) => t.id !== tratamiento) } : p));
        onCambio();
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setCerrando(null);
      }
    },
    [onCambio, onError],
  );

  if (clienteId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Encabezado titulo="Seguimiento" accion={{ texto: "quitar cliente", onClick: onQuitar }} />
        {cargando && !panel ? (
          <p className="py-6 text-center text-[13px] text-ink-3">Cargando…</p>
        ) : !panel ? (
          <p className="py-6 text-center text-[13px] text-ink-3">No se pudo cargar la ficha.</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            <div className="rounded-[11px] border border-line-inset bg-inset p-3">
              <p className="text-[15px] font-bold text-ink">{nombreCorto(panel.cliente)}</p>
              <p className="text-[12px] text-ink-2">
                {panel.cliente.telefono ? telefonoLegible(panel.cliente.telefono) : "sin celular"}
                {panel.cliente.optin_whatsapp === 1 ? " · ✅ acepta WhatsApp" : ""}
              </p>
              {panel.cliente.alergias && (
                <p className="mt-1.5 rounded-[7px] bg-accent-soft px-2 py-1 text-[12px] font-semibold text-accent-ink">
                  ⚠️ Alergias: {panel.cliente.alergias}
                </p>
              )}
              {panel.familiares.length > 0 && (
                <p className="mt-1.5 text-[12px] text-ink-2">
                  Compra también para: {panel.familiares.map((f) => f.nombre).join(", ")}
                </p>
              )}
            </div>

            <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
              Seguimiento abierto ({panel.tratamientos.length})
            </p>
            {panel.tratamientos.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-ink-2">Nada pendiente. Al cobrar puedes registrar uno en dos toques.</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {panel.tratamientos.map((t) => (
                  <li key={t.id} className="rounded-[11px] border border-line-inset bg-card p-3">
                    <p className="text-[13.5px] font-semibold text-ink">
                      {t.descripcion}
                      {t.familiar_nombre ? <span className="font-normal text-ink-2"> — para {t.familiar_nombre}</span> : ""}
                    </p>
                    <p className="text-[12px] text-ink-2">
                      Se lo llevó hace {t.dias_transcurridos} {t.dias_transcurridos === 1 ? "día" : "días"}
                      {t.fecha_toca ? ` · toca preguntarle ${cuandoToca(diasDeAtraso(t))}` : ""}
                    </p>
                    {t.indicacion_seguimiento && (
                      <p className="mt-1 text-[12.5px] italic text-ink">“{t.indicacion_seguimiento}”</p>
                    )}
                    <button
                      onClick={() => void cerrar(panel.cliente.id, t.id)}
                      disabled={cerrando === t.id}
                      className="mt-2 min-h-11 w-full rounded-[9px] border border-ok/30 bg-ok-soft px-3 py-1.5 text-[13px] font-semibold text-ok disabled:opacity-40"
                    >
                      {cerrando === t.id ? "Cerrando…" : "Ya le pregunté"}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {panel.compras.length > 0 && (
              <>
                <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Últimas compras</p>
                <ul className="mt-1 space-y-1">
                  {panel.compras.slice(0, 5).map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-[12.5px] text-ink-2">
                      <span>{fechaCorta(c.fecha_hora)}</span>
                      <span className="tabular-nums text-ink">{solesCent(c.total_cent)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <button
          onClick={() => panel && onRegistrarSeguimiento(panel.cliente.id, nombreCorto(panel.cliente))}
          disabled={!panel}
          className="mt-3 min-h-11 w-full rounded-[9px] border border-line-input bg-card py-2.5 text-[13.5px] font-semibold text-ink-emph hover:bg-hover-btn disabled:opacity-40"
        >
          + Registrar seguimiento
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Encabezado titulo="Seguimiento" />
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Hay que preguntarles ({pendientes.length})</p>
        {pendientes.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-ink-2">Nadie pendiente por ahora.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {pendientes.map((p) => (
              <li key={p.tratamiento_id} className="rounded-[11px] border border-line-inset bg-inset p-3">
                <p className="text-[13.5px] font-semibold text-ink">{p.cliente_nombre}</p>
                <p className="text-[12px] text-ink-2">
                  {p.descripcion}
                  {p.familiar_nombre ? ` — para ${p.familiar_nombre}` : ""} · le tocaba {cuandoToca(p.dias_de_atraso)}
                </p>
                {p.indicacion_seguimiento && <p className="mt-1 text-[12.5px] italic text-ink">“{p.indicacion_seguimiento}”</p>}
                <button
                  onClick={() => onAsignarId(p.cliente_id)}
                  className="mt-2 min-h-11 w-full rounded-[9px] border border-line-input bg-card px-3 py-1.5 text-[13px] font-semibold text-link hover:bg-hover-btn"
                >
                  Ver su ficha
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Cumpleaños de la semana ({cumpleanos.length})</p>
        {cumpleanos.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-ink-2">Ninguno esta semana.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {cumpleanos.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-[9px] bg-inset px-2.5 py-2">
                <span className="min-w-0 truncate text-[13px] text-ink">
                  {c.dias_para === 0 ? "🎂 " : ""}
                  {nombreCorto(c)}
                  {c.edad !== null ? <span className="text-ink-2"> · {c.edad} años</span> : null}
                </span>
                <span className="flex-none text-[12px] font-semibold text-ink-2">{cuandoCumple(c.dias_para)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Encabezado({ titulo, accion }: { titulo: string; accion?: { texto: string; onClick: () => void } }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[14px] font-bold text-ink">{titulo}</h2>
      {accion && (
        <button onClick={accion.onClick} className="inline-flex min-h-11 items-center px-1 text-[12px] underline text-ink-2">
          {accion.texto}
        </button>
      )}
    </div>
  );
}

// Días de atraso de UN seguimiento, con lo que ya trae el server: `dias_transcurridos` (inicio → hoy)
// menos la duración estimada (inicio → fecha_toca). Positivo = ya le tocaba; negativo = falta.
// No se calcula "hoy" en el cliente a propósito: el día que manda es el de Lima que resolvió el server.
function diasDeAtraso(t: { fecha_inicio: string; fecha_toca: string | null; dias_transcurridos: number }): number {
  if (!t.fecha_toca) return 0;
  const inicio = Date.parse(`${t.fecha_inicio}T12:00:00.000Z`);
  const toca = Date.parse(`${t.fecha_toca}T12:00:00.000Z`);
  if (Number.isNaN(inicio) || Number.isNaN(toca)) return 0;
  return t.dias_transcurridos - Math.round((toca - inicio) / 86_400_000);
}

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "short", timeZone: "America/Lima" }).replace(/\./g, "");
}
