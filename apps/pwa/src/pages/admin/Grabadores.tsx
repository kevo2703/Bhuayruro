import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Card, Button, Input, SectionLabel, EmptyState, useToast, cn } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// Dispositivos conectados / grabadores del A10 (Ajustes › detalle, B10.1 §8). Restyle a tema claro;
// MISMO comportamiento: el admin crea un grabador y recibe su token EN CLARO una sola vez → lo pega
// en la grabadora del teléfono (`#/grabadora`). Kill-switch por grabador. El estado en vivo (en
// línea/batería) NO tiene telemetría en el modelo: solo se muestra encendido/apagado (el kill-switch).

type Dispositivo = { id: string; nombre: string; activo: number; sucursal_id: string; created_at: string };
type Sucursal = { id: string; nombre: string };

const urlGrabadora = () => `${window.location.origin}/#/grabadora`;

export function Grabadores({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [sucSel, setSucSel] = useState<string>("");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel : (sesion.usuario.sucursalId ?? "");
  const q = esSuper && suc ? `?sucursal_id=${suc}` : "";
  const lista = useApi<{ dispositivos: Dispositivo[] }>(!esSuper || suc ? `/dispositivos${q}` : null, [suc]);
  const toast = useToast();

  const [creando, setCreando] = useState(false);
  const [tokenNuevo, setTokenNuevo] = useState<{ nombre: string; token: string } | null>(null);

  const items = lista.data?.dispositivos ?? [];
  const selectCls = "w-full rounded-[9px] border border-line-input bg-field px-3 py-2.5 text-[13px] text-ink outline-none";

  return (
    <div className="flex max-w-[820px] flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-ink-2">Teléfonos A10 que graban en el mostrador (asistencia operativa). Cada uno usa su propio token.</p>
        {(!esSuper || suc) && (
          <Button variant={creando ? "outline" : "primary"} size="sm" onClick={() => { setCreando((v) => !v); setTokenNuevo(null); }}>
            {creando ? "Cerrar" : "Nuevo grabador"}
          </Button>
        )}
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className={selectCls}>
          <option value="">— Elige una botica —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {tokenNuevo && <TokenNuevo dato={tokenNuevo} onCerrar={() => setTokenNuevo(null)} onToast={toast} />}

      {creando && (!esSuper || suc) && (
        <CrearGrabador
          sucursalQuery={q}
          onCreado={(d) => {
            setCreando(false);
            setTokenNuevo({ nombre: d.nombre, token: d.token });
            lista.recargar();
          }}
        />
      )}

      {esSuper && !suc ? (
        <Card><EmptyState title="Elige una botica" subtitle="Selecciona arriba para ver sus grabadores." /></Card>
      ) : (
        <Card>
          {lista.cargando ? (
            <p className="py-4 text-center text-[13px] text-ink-3">Cargando grabadores…</p>
          ) : lista.error ? (
            <div className="py-4 text-center">
              <p className="text-[13px] text-accent-ink">{lista.error}</p>
              <button onClick={lista.recargar} className="mt-2 text-[12.5px] text-link underline">Reintentar</button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="Sin grabadores" subtitle="Crea uno con “Nuevo grabador”." />
          ) : (
            <ul className="flex flex-col">
              {items.map((d) => (
                <FilaGrabador key={d.id} d={d} sucursalQuery={q} onCambio={lista.recargar} onToast={toast} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <p className="text-[12px] leading-relaxed text-ink-3">
        Para instalar: en el A10 abre <span className="font-mono text-ink-2">{urlGrabadora()}</span>, pega el token, toca “Iniciar” una vez y deja el teléfono enchufado con la pantalla encendida.
      </p>
    </div>
  );
}

function TokenNuevo({ dato, onCerrar, onToast }: { dato: { nombre: string; token: string }; onCerrar: () => void; onToast: (m: string) => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(dato.token);
      setCopiado(true);
      onToast("Token copiado.");
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin permiso de portapapeles: el usuario copia a mano */
    }
  }
  return (
    <Card className="gap-2 border-tip-border bg-ok-soft">
      <p className="text-[13px] font-semibold text-ok">Token de “{dato.nombre}” — cópialo AHORA</p>
      <p className="text-[12px] text-ink-2">Solo se muestra esta vez. Pégalo en la grabadora del A10. Si lo pierdes, crea otro grabador.</p>
      <div className="break-all rounded-[8px] border border-line-inset bg-inset p-2 font-mono text-[12px] text-ink-strong">{dato.token}</div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void copiar()}>{copiado ? "✓ Copiado" : "Copiar token"}</Button>
        <Button variant="outline" size="sm" onClick={onCerrar}>Listo</Button>
      </div>
    </Card>
  );
}

function CrearGrabador({ sucursalQuery, onCreado }: { sucursalQuery: string; onCreado: (d: { id: string; nombre: string; token: string }) => void }) {
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function crear() {
    setEnviando(true);
    setError(null);
    try {
      const d = await mutar<{ id: string; nombre: string; token: string }>(`/dispositivos${sucursalQuery}`, { method: "POST", body: { nombre: nombre.trim() || "Grabador A10" } });
      onCreado(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Card className="gap-3">
      <SectionLabel>Nuevo grabador</SectionLabel>
      <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej. Mostrador VES)" />
      {error && <p className="text-[12.5px] text-accent-ink">{error}</p>}
      <div>
        <Button onClick={() => void crear()} disabled={enviando}>
          {enviando ? "Creando…" : "Crear grabador y generar token"}
        </Button>
      </div>
    </Card>
  );
}

function FilaGrabador({ d, sucursalQuery, onCambio, onToast }: { d: Dispositivo; sucursalQuery: string; onCambio: () => void; onToast: (m: string) => void }) {
  const [ocupado, setOcupado] = useState(false);
  async function toggle() {
    setOcupado(true);
    try {
      await mutar(`/dispositivos/${d.id}${sucursalQuery}`, { method: "PATCH", body: { activo: d.activo !== 1 } });
      onToast(d.activo === 1 ? `${d.nombre} apagado.` : `${d.nombre} encendido.`);
      onCambio();
    } finally {
      setOcupado(false);
    }
  }
  return (
    <li className="flex items-center justify-between gap-3 border-b border-line-row py-3 last:border-0">
      <div className="min-w-0">
        <p className={cn("truncate text-[13px] font-semibold", d.activo !== 1 ? "text-ink-3 line-through" : "text-ink")}>{d.nombre}</p>
        <p className="truncate text-[12px] text-ink-2">{d.activo === 1 ? "encendido" : "apagado"} · desde {d.created_at.slice(0, 10)}</p>
      </div>
      <button
        onClick={() => void toggle()}
        disabled={ocupado}
        className={cn(
          "shrink-0 rounded-[8px] px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-50",
          d.activo === 1 ? "bg-accent-soft text-accent-ink hover:bg-accent-soft-2" : "bg-ok-soft text-ok hover:opacity-90",
        )}
      >
        {d.activo === 1 ? "Apagar" : "Encender"}
      </button>
    </li>
  );
}
