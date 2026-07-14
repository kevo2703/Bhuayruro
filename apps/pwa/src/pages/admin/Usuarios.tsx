import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Card, Button, Input, SectionLabel, EmptyState, useToast, cn } from "../../components/ui";
import type { Rol, SesionActiva } from "../../lib/tipos";

// Usuarios y roles (Ajustes › detalle). Restyle a tema claro; MISMO comportamiento: listar (GET),
// crear (POST), activar/desactivar y reset de contraseña (PATCH). Scoping duro en el server: super
// elige rol+sucursal; admin_sucursal solo crea/edita operadores de SU sucursal.

type Usuario = { id: string; nombre: string; email: string; rol: string; sucursal_id: string | null; activo: number };
type Sucursal = { id: string; nombre: string };

const ROL_LABEL: Record<string, string> = {
  super_admin: "Dueño",
  admin_sucursal: "Encargado",
  operador: "Vendedor",
  lector_reportes: "Lector",
};

export function Usuarios({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const lista = useApi<{ usuarios: Usuario[] }>("/usuarios");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const [creando, setCreando] = useState(false);
  const toast = useToast();

  const sucNombre = (id: string | null): string | null => sucursales.data?.sucursales.find((s) => s.id === id)?.nombre ?? null;
  const rolAlcance = (u: Usuario): string =>
    u.rol === "super_admin" ? "Dueño · toda la cadena" : `${ROL_LABEL[u.rol] ?? u.rol}${sucNombre(u.sucursal_id) ? ` · ${sucNombre(u.sucursal_id)}` : ""}`;

  const items = lista.data?.usuarios ?? [];

  return (
    <div className="flex max-w-[820px] flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-2">Quién entra al panel y qué puede hacer. El dueño ve toda la cadena; el encargado, su botica.</p>
        <Button variant={creando ? "outline" : "primary"} size="sm" onClick={() => setCreando((v) => !v)}>
          {creando ? "Cerrar" : "Agregar usuario"}
        </Button>
      </div>

      {creando && (
        <CrearUsuario
          esSuper={esSuper}
          sucursales={sucursales.data?.sucursales ?? []}
          onListo={() => {
            setCreando(false);
            lista.recargar();
            toast("Usuario creado.");
          }}
        />
      )}

      <Card>
        {lista.cargando ? (
          <p className="py-4 text-center text-[13px] text-ink-3">Cargando usuarios…</p>
        ) : lista.error ? (
          <div className="py-4 text-center">
            <p className="text-[13px] text-accent-ink">{lista.error}</p>
            <button onClick={lista.recargar} className="mt-2 text-[12.5px] text-link underline">Reintentar</button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="Sin usuarios" subtitle="Agrega el primero con “Agregar usuario”." />
        ) : (
          <ul className="flex flex-col">
            {items.map((u) => (
              <FilaUsuario key={u.id} u={u} meta={rolAlcance(u)} onCambio={lista.recargar} onToast={toast} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function FilaUsuario({ u, meta, onCambio, onToast }: { u: Usuario; meta: string; onCambio: () => void; onToast: (m: string) => void }) {
  const [ocupado, setOcupado] = useState(false);

  async function toggleActivo() {
    setOcupado(true);
    try {
      await mutar(`/usuarios/${u.id}`, { method: "PATCH", body: { activo: u.activo !== 1 } });
      onToast(u.activo === 1 ? `${u.nombre} quedó inactivo.` : `${u.nombre} está activo.`);
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
      onToast("Contraseña actualizada.");
      onCambio();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 border-b border-line-row py-3 last:border-0">
      <div className="min-w-0">
        <p className={cn("truncate text-[13px] font-semibold", u.activo !== 1 ? "text-ink-3 line-through" : "text-ink")}>{u.nombre}</p>
        <p className="truncate text-[12px] text-ink-2">{u.email} · {meta}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          onClick={() => void resetPass()}
          disabled={ocupado}
          className="rounded-[8px] border border-line-input bg-card px-2.5 py-1 text-[12px] font-medium text-ink-emph transition-colors hover:bg-hover-btn disabled:opacity-50"
        >
          Contraseña
        </button>
        <button
          onClick={() => void toggleActivo()}
          disabled={ocupado}
          className={cn(
            "rounded-[8px] px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-50",
            u.activo === 1 ? "bg-accent-soft text-accent-ink hover:bg-accent-soft-2" : "bg-ok-soft text-ok hover:opacity-90",
          )}
        >
          {u.activo === 1 ? "Desactivar" : "Activar"}
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

  const selectCls = "rounded-[9px] border border-line-input bg-field px-3 py-2.5 text-[13px] text-ink outline-none disabled:opacity-50";

  return (
    <Card className="gap-3">
      <SectionLabel>Nuevo usuario</SectionLabel>
      <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
      <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" />
      <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Contraseña (mín. 8)" />
      {esSuper && (
        <div className="grid grid-cols-2 gap-2.5">
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} className={selectCls}>
            <option value="operador">Vendedor</option>
            <option value="admin_sucursal">Encargado</option>
            <option value="lector_reportes">Lector</option>
            <option value="super_admin">Dueño</option>
          </select>
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} disabled={rol === "super_admin"} className={selectCls}>
            <option value="">— Botica —</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
      )}
      {error && <p className="text-[12.5px] text-accent-ink">{error}</p>}
      <div>
        <Button onClick={() => void crear()} disabled={enviando}>
          {enviando ? "Creando…" : "Crear usuario"}
        </Button>
      </div>
    </Card>
  );
}
