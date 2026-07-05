import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Cargando, ErrorMsg, Vacio } from "../../components/Estados";
import type { Rol, SesionActiva } from "../../lib/tipos";

type Usuario = { id: string; nombre: string; email: string; rol: string; sucursal_id: string | null; activo: number };
type Sucursal = { id: string; nombre: string };

const ROL_LABEL: Record<string, string> = { super_admin: "Super admin", admin_sucursal: "Administrador", operador: "Operador", lector_reportes: "Lector" };

export function Usuarios({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const lista = useApi<{ usuarios: Usuario[] }>("/usuarios");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const [creando, setCreando] = useState(false);

  return (
    <div className="max-w-2xl mx-auto w-full space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Usuarios</h1>
        <button onClick={() => setCreando((v) => !v)} className="text-sm px-3 py-1.5 rounded bg-emerald-500 text-black font-medium">
          {creando ? "Cerrar" : "+ Nuevo"}
        </button>
      </div>

      {creando && (
        <CrearUsuario
          esSuper={esSuper}
          sucursales={sucursales.data?.sucursales ?? []}
          onListo={() => {
            setCreando(false);
            lista.recargar();
          }}
        />
      )}

      <section className="bg-white/5 rounded-lg border border-white/10">
        {lista.cargando ? (
          <Cargando que="usuarios" />
        ) : lista.error ? (
          <ErrorMsg msg={lista.error} onReintentar={lista.recargar} />
        ) : (lista.data?.usuarios.length ?? 0) === 0 ? (
          <Vacio>Sin usuarios.</Vacio>
        ) : (
          <ul className="divide-y divide-white/5">
            {lista.data!.usuarios.map((u) => (
              <FilaUsuario key={u.id} u={u} onCambio={lista.recargar} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilaUsuario({ u, onCambio }: { u: Usuario; onCambio: () => void }) {
  const [ocupado, setOcupado] = useState(false);

  async function toggleActivo() {
    setOcupado(true);
    try {
      await mutar(`/usuarios/${u.id}`, { method: "PATCH", body: { activo: u.activo !== 1 } });
      onCambio();
    } finally {
      setOcupado(false);
    }
  }

  async function resetPass() {
    const nueva = window.prompt(`Nueva contraseña para ${u.nombre} (mín. 8):`);
    if (!nueva || nueva.length < 8) return;
    setOcupado(true);
    try {
      await mutar(`/usuarios/${u.id}`, { method: "PATCH", body: { password: nueva } });
      onCambio();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className={`font-medium truncate ${u.activo !== 1 ? "opacity-40 line-through" : ""}`}>{u.nombre}</p>
        <p className="text-xs opacity-60 truncate">{u.email} · {ROL_LABEL[u.rol] ?? u.rol}</p>
      </div>
      <div className="flex gap-1 shrink-0">
        <button onClick={() => void resetPass()} disabled={ocupado} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40">
          contraseña
        </button>
        <button onClick={() => void toggleActivo()} disabled={ocupado} className={`text-xs px-2 py-1 rounded disabled:opacity-40 ${u.activo === 1 ? "bg-red-500/20 text-red-300 hover:bg-red-500/30" : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"}`}>
          {u.activo === 1 ? "desactivar" : "activar"}
        </button>
      </div>
    </li>
  );
}

function CrearUsuario({ esSuper, sucursales, onListo }: { esSuper: boolean; sucursales: Sucursal[]; onListo: () => void }) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<Rol>("operador");
  const [sucursalId, setSucursalId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    if (!nombre.trim() || !email.trim() || password.length < 8) {
      setError("Nombre, email y contraseña (mín. 8) requeridos.");
      return;
    }
    if (esSuper && rol !== "super_admin" && !sucursalId) {
      setError("Elige una sucursal.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await mutar("/usuarios", {
        method: "POST",
        body: { nombre: nombre.trim(), email: email.trim(), password, rol: esSuper ? rol : "operador", sucursal_id: esSuper ? sucursalId || null : undefined },
      });
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-3">
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Contraseña (mín. 8)" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
      {esSuper && (
        <div className="grid grid-cols-2 gap-2">
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm">
            <option value="operador">Operador</option>
            <option value="admin_sucursal">Administrador</option>
            <option value="lector_reportes">Lector</option>
            <option value="super_admin">Super admin</option>
          </select>
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} disabled={rol === "super_admin"} className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm disabled:opacity-40">
            <option value="">— Sucursal —</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button onClick={() => void crear()} disabled={enviando} className="w-full py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-40">
        {enviando ? "Creando..." : "Crear usuario"}
      </button>
    </div>
  );
}
