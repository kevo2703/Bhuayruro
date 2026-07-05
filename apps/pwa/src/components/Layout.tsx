import type { ReactNode } from "react";
import { useEstadoSync } from "../lib/useEstadoSync";
import { dbLocal } from "../lib/db-local";
import { BannerSync } from "./BannerSync";
import { navegar, VISTAS, type RutaId } from "../lib/ruta";
import type { SesionActiva } from "../lib/tipos";

type Props = {
  sesion: SesionActiva;
  rutaActual: RutaId;
  onSalir: () => void;
  children: ReactNode;
};

const ROL_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin_sucursal: "Administrador",
  operador: "Operador",
  lector_reportes: "Lector",
};

export function Layout({ sesion, rutaActual, onSalir, children }: Props) {
  const estado = useEstadoSync(dbLocal);
  const visibles = VISTAS.filter((v) => v.roles.includes(sesion.usuario.rol));

  return (
    <div className="min-h-screen flex flex-col">
      <BannerSync estado={estado} />

      <header className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="min-w-0">
          <h1 className="font-bold leading-tight truncate">Botica Huayruro</h1>
          <p className="text-xs opacity-60 truncate">
            {sesion.sucursal?.nombre ?? "Cadena"} · {sesion.usuario.nombre} · {ROL_LABEL[sesion.usuario.rol]}
          </p>
        </div>
        <button onClick={onSalir} className="text-sm opacity-60 hover:opacity-100 underline shrink-0">
          Salir
        </button>
      </header>

      <nav className="flex gap-1 overflow-x-auto px-2 py-2 border-b border-white/10 shrink-0">
        {visibles.map((v) => (
          <button
            key={v.id}
            onClick={() => navegar(v.id)}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap transition ${
              rutaActual === v.id ? "bg-emerald-500 text-black font-medium" : "hover:bg-white/10 opacity-80"
            }`}
          >
            <span className="mr-1">{v.icono}</span>
            {v.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 min-h-0 p-4 flex flex-col">{children}</main>
    </div>
  );
}
