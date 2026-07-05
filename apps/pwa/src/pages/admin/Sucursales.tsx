import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Cargando, ErrorMsg, Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

type Sucursal = { id: string; nombre: string; direccion: string | null; activa: number };

export function Sucursales({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const lista = useApi<{ sucursales: Sucursal[] }>("/sucursales");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full space-y-4 overflow-y-auto">
      <h1 className="text-xl font-bold">Sucursales</h1>

      {esSuper && (
        <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
            <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección (opcional)" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={() => void crear()} disabled={enviando || !nombre.trim()} className="py-2 px-4 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40">
            {enviando ? "Creando..." : "Crear sucursal"}
          </button>
        </div>
      )}

      <section className="bg-white/5 rounded-lg border border-white/10">
        {lista.cargando ? (
          <Cargando que="sucursales" />
        ) : lista.error ? (
          <ErrorMsg msg={lista.error} onReintentar={lista.recargar} />
        ) : (lista.data?.sucursales.length ?? 0) === 0 ? (
          <Vacio>Sin sucursales.</Vacio>
        ) : (
          <ul className="divide-y divide-white/5">
            {lista.data!.sucursales.map((s) => (
              <FilaSucursal key={s.id} s={s} esSuper={esSuper} onCambio={lista.recargar} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilaSucursal({ s, esSuper, onCambio }: { s: Sucursal; esSuper: boolean; onCambio: () => void }) {
  const [ocupado, setOcupado] = useState(false);

  async function toggle() {
    setOcupado(true);
    try {
      await mutar(`/sucursales/${s.id}`, { method: "PATCH", body: { activa: s.activa !== 1 } });
      onCambio();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className={`font-medium truncate ${s.activa !== 1 ? "opacity-40" : ""}`}>{s.nombre}</p>
        <p className="text-xs opacity-60 truncate">{s.direccion ?? "—"}</p>
      </div>
      {esSuper && (
        <button onClick={() => void toggle()} disabled={ocupado} className={`text-xs px-2 py-1 rounded shrink-0 disabled:opacity-40 ${s.activa === 1 ? "bg-red-500/20 text-red-300 hover:bg-red-500/30" : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"}`}>
          {s.activa === 1 ? "desactivar" : "activar"}
        </button>
      )}
    </li>
  );
}
