import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Cargando, ErrorMsg, Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

// Panel admin de grabadores del A10 (B10.1 §8). Aquí el admin crea un grabador y recibe su token EN
// CLARO una sola vez → lo pega en la grabadora del teléfono (`#/grabadora`). Kill-switch por grabador.

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

  const [creando, setCreando] = useState(false);
  const [tokenNuevo, setTokenNuevo] = useState<{ nombre: string; token: string } | null>(null);

  return (
    <div className="max-w-2xl mx-auto w-full space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">🎙️ Grabadores</h1>
          <p className="text-xs opacity-60">Teléfonos A10 que graban en el mostrador (asistencia operativa).</p>
        </div>
        {(!esSuper || suc) && (
          <button onClick={() => { setCreando((v) => !v); setTokenNuevo(null); }} className="text-sm px-3 py-1.5 rounded bg-emerald-500 text-black font-medium">
            {creando ? "Cerrar" : "+ Nuevo"}
          </button>
        )}
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm">
          <option value="">— Elige una sucursal —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {tokenNuevo && <TokenNuevo dato={tokenNuevo} onCerrar={() => setTokenNuevo(null)} />}

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
        <Vacio>Elige una sucursal para ver sus grabadores.</Vacio>
      ) : (
        <section className="bg-white/5 rounded-lg border border-white/10">
          {lista.cargando ? (
            <Cargando que="grabadores" />
          ) : lista.error ? (
            <ErrorMsg msg={lista.error} onReintentar={lista.recargar} />
          ) : (lista.data?.dispositivos.length ?? 0) === 0 ? (
            <Vacio>Sin grabadores. Crea uno con “+ Nuevo”.</Vacio>
          ) : (
            <ul className="divide-y divide-white/5">
              {lista.data!.dispositivos.map((d) => (
                <FilaGrabador key={d.id} d={d} sucursalQuery={q} onCambio={lista.recargar} />
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-xs opacity-50">
        Para instalar: en el A10 abre <span className="font-mono">{urlGrabadora()}</span>, pega el token, toca “Iniciar” una vez y deja el teléfono enchufado con la pantalla encendida.
      </p>
    </div>
  );
}

function TokenNuevo({ dato, onCerrar }: { dato: { nombre: string; token: string }; onCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(dato.token);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin permiso de portapapeles: el usuario copia a mano */
    }
  }
  return (
    <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-lg p-4 space-y-2">
      <p className="text-sm font-semibold text-emerald-300">Token de “{dato.nombre}” — cópialo AHORA</p>
      <p className="text-xs opacity-70">Solo se muestra esta vez. Pégalo en la grabadora del A10. Si lo pierdes, crea otro grabador.</p>
      <div className="font-mono text-xs break-all bg-black/40 rounded p-2 border border-white/10">{dato.token}</div>
      <div className="flex gap-2">
        <button onClick={() => void copiar()} className="text-sm px-3 py-1.5 rounded bg-emerald-500 text-black font-medium">
          {copiado ? "✓ Copiado" : "Copiar token"}
        </button>
        <button onClick={onCerrar} className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">Listo</button>
      </div>
    </div>
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
    <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-3">
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej. Mostrador VES)" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button onClick={() => void crear()} disabled={enviando} className="w-full py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-40">
        {enviando ? "Creando..." : "Crear grabador y generar token"}
      </button>
    </div>
  );
}

function FilaGrabador({ d, sucursalQuery, onCambio }: { d: Dispositivo; sucursalQuery: string; onCambio: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  async function toggle() {
    setOcupado(true);
    try {
      await mutar(`/dispositivos/${d.id}${sucursalQuery}`, { method: "PATCH", body: { activo: d.activo !== 1 } });
      onCambio();
    } finally {
      setOcupado(false);
    }
  }
  return (
    <li className="p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className={`font-medium truncate ${d.activo !== 1 ? "opacity-40 line-through" : ""}`}>{d.nombre}</p>
        <p className="text-xs opacity-60 truncate">{d.activo === 1 ? "activo" : "apagado"} · desde {d.created_at.slice(0, 10)}</p>
      </div>
      <button onClick={() => void toggle()} disabled={ocupado} className={`text-xs px-2 py-1 rounded shrink-0 disabled:opacity-40 ${d.activo === 1 ? "bg-red-500/20 text-red-300 hover:bg-red-500/30" : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"}`}>
        {d.activo === 1 ? "apagar" : "encender"}
      </button>
    </li>
  );
}
