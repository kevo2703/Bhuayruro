import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Card, Button, Input, Chip, SectionLabel, EmptyState, useToast, cn } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// Boticas y horarios (Ajustes › detalle). Restyle a tema claro; MISMO comportamiento: listar (GET),
// crear (POST, super), activar/desactivar y fijar horario (PATCH, super). El horario alimenta la
// detección 'fuera de horario' (Casos); limpiar = NULL explícito (apaga el control, sin COALESCE).

type Sucursal = { id: string; nombre: string; direccion: string | null; activa: number; hora_apertura: string | null; hora_cierre: string | null };

export function Sucursales({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const lista = useApi<{ sucursales: Sucursal[] }>("/sucursales");
  const toast = useToast();
  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    if (!nombre.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      await mutar("/sucursales", { method: "POST", body: { nombre: nombre.trim(), direccion: direccion.trim() } });
      setNombre("");
      setDireccion("");
      lista.recargar();
      toast("Botica creada.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  const items = lista.data?.sucursales ?? [];

  return (
    <div className="flex max-w-[820px] flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-2">
        Las ventas fuera de horario se marcan como caso. Si un horario cambió, actualízalo aquí para no generar falsas alarmas.
      </p>

      {esSuper && (
        <Card className="gap-3">
          <SectionLabel>Nueva botica</SectionLabel>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
            <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección (opcional)" />
          </div>
          {error && <p className="text-[12.5px] text-accent-ink">{error}</p>}
          <div>
            <Button onClick={() => void crear()} disabled={enviando || !nombre.trim()}>
              {enviando ? "Creando…" : "Crear botica"}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        {lista.cargando ? (
          <p className="py-4 text-center text-[13px] text-ink-3">Cargando boticas…</p>
        ) : lista.error ? (
          <div className="py-4 text-center">
            <p className="text-[13px] text-accent-ink">{lista.error}</p>
            <button onClick={lista.recargar} className="mt-2 text-[12.5px] text-link underline">Reintentar</button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="Sin boticas" subtitle="Crea la primera para empezar." />
        ) : (
          <ul className="flex flex-col">
            {items.map((s) => (
              <FilaSucursal key={s.id} s={s} esSuper={esSuper} onCambio={lista.recargar} onToast={toast} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function FilaSucursal({ s, esSuper, onCambio, onToast }: { s: Sucursal; esSuper: boolean; onCambio: () => void; onToast: (m: string) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [apertura, setApertura] = useState(s.hora_apertura ?? "");
  const [cierre, setCierre] = useState(s.hora_cierre ?? "");

  async function toggle() {
    setOcupado(true);
    try {
      await mutar(`/sucursales/${s.id}`, { method: "PATCH", body: { activa: s.activa !== 1 } });
      onToast(s.activa === 1 ? `${s.nombre} quedó inactiva.` : `${s.nombre} está activa.`);
      onCambio();
    } finally {
      setOcupado(false);
    }
  }

  // Persiste el horario. Acepta valores explícitos para "limpiar" (el estado de React aún no está
  // actualizado en el mismo tick, así que pasarlos como argumento evita guardar el valor viejo).
  async function guardarHorario(a = apertura, c = cierre) {
    setOcupado(true);
    try {
      await mutar(`/sucursales/${s.id}`, { method: "PATCH", body: { hora_apertura: a, hora_cierre: c } });
      onToast(a && c ? "Horario guardado." : "Horario apagado.");
      onCambio();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  const timeCls = "rounded-[9px] border border-line-input bg-field px-2.5 py-1.5 text-[13px] tabular-nums text-ink outline-none";

  return (
    <li className="flex flex-col gap-2.5 border-b border-line-row py-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("truncate text-[13px] font-semibold", s.activa !== 1 ? "text-ink-3" : "text-ink")}>{s.nombre}</p>
          <p className="truncate text-[12px] text-ink-2">{s.direccion ?? "—"}</p>
        </div>
        {esSuper ? (
          <button
            onClick={() => void toggle()}
            disabled={ocupado}
            className={cn(
              "shrink-0 rounded-[8px] px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-50",
              s.activa === 1 ? "bg-accent-soft text-accent-ink hover:bg-accent-soft-2" : "bg-ok-soft text-ok hover:opacity-90",
            )}
          >
            {s.activa === 1 ? "Desactivar" : "Activar"}
          </button>
        ) : (
          <Chip variant={s.activa === 1 ? "ok" : "neutral"}>{s.activa === 1 ? "Activa" : "Inactiva"}</Chip>
        )}
      </div>
      {esSuper && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
          <span className="text-ink-3">Horario (para detectar ventas fuera de hora):</span>
          <input type="time" value={apertura} onChange={(e) => setApertura(e.target.value)} className={timeCls} />
          <span className="text-ink-3">a</span>
          <input type="time" value={cierre} onChange={(e) => setCierre(e.target.value)} className={timeCls} />
          <Button variant="outline" size="sm" onClick={() => void guardarHorario()} disabled={ocupado}>Guardar</Button>
          {(apertura || cierre) && (
            <button
              onClick={() => { setApertura(""); setCierre(""); void guardarHorario("", ""); }}
              disabled={ocupado}
              className="text-[12px] text-ink-3 underline transition-colors hover:text-accent-ink disabled:opacity-50"
            >
              limpiar
            </button>
          )}
        </div>
      )}
    </li>
  );
}
