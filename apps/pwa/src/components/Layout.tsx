import type { ReactNode } from "react";
import { useEstadoSync, type EstadoSync } from "../lib/useEstadoSync";
import { dbLocal } from "../lib/db-local";
import { useApi } from "../lib/useApi";
import { navegar, seccionDeRuta, SECCIONES, VISTAS, RUTAS_POS, type RutaId, type SeccionIcono } from "../lib/ruta";
import type { SesionActiva, Rol } from "../lib/tipos";
import {
  Sidebar,
  SidebarGroup,
  NavItem,
  SidebarSyncLine,
  UserCard,
  Topbar,
  SyncPill,
  ToastProvider,
  ToastStack,
  Logo,
  IconHoy,
  IconCasos,
  IconVentas,
  IconInventario,
  IconCompras,
  IconAjustes,
  type SyncTono,
} from "./ui";

type Props = {
  sesion: SesionActiva;
  rutaActual: RutaId;
  onSalir: () => void;
  children: ReactNode;
};

const ROL_LABEL: Record<Rol, string> = {
  super_admin: "Dueño",
  admin_sucursal: "Encargado",
  operador: "Vendedor",
  lector_reportes: "Lector",
};

const ICONOS: Record<SeccionIcono, (p: { size?: number }) => ReactNode> = {
  hoy: IconHoy,
  casos: IconCasos,
  ventas: IconVentas,
  inventario: IconInventario,
  compras: IconCompras,
  ajustes: IconAjustes,
};

// Título de la página en el topbar (por ruta; si no, cae al label de la sección).
const TITULOS: Partial<Record<RutaId, string>> = {
  hoy: "Hoy",
  casos: "Casos",
  dashboard: "Ventas y caja",
  caja: "Ventas y caja",
  consolidado: "Ventas y caja",
  inventario: "Inventario",
  "recepciones-pendientes": "Inventario",
  faltantes: "Inventario",
  conteo: "Inventario",
  pedido: "Compras",
  proveedores: "Compras",
  ajustes: "Ajustes",
  catalogo: "Catálogo",
  "importar-catalogo": "Importar catálogo",
  "catalogo-prueba": "Catálogo de prueba",
  usuarios: "Usuarios y roles",
  sucursales: "Boticas y horarios",
  grabadores: "Dispositivos",
  "audio-calidad": "El oído",
  mostrador: "Mostrador",
  recepcion: "Recepción",
};

function iniciales(nombre: string): string {
  // Solo tokens que empiezan con letra (evita que "Kevin (super)" rinda "K(").
  const tokens = nombre.trim().split(/\s+/).filter((t) => /\p{L}/u.test(t.charAt(0)));
  const a = tokens[0]?.[0] ?? "";
  const b = tokens.length > 1 ? (tokens[tokens.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || "?";
}

// EstadoSync (device-local, real) → SyncPill del topbar. El estado EN VIVO por-botica es
// "próximamente" (no hay heartbeat), así que la píldora refleja SOLO este equipo, con honestidad.
function pill(estado: EstadoSync): { tono: SyncTono; texto: string } {
  if (estado.nivel === "rechazada") return { tono: "offline", texto: `${estado.rechazadas} venta(s) rechazada(s) — revisar` };
  if (estado.nivel === "offline") return { tono: "offline", texto: estado.pendientes > 0 ? `Sin conexión · ${estado.pendientes} guardadas en este equipo` : "Sin conexión — las ventas se guardan igual" };
  if (estado.nivel === "pendiente") return { tono: "pendiente", texto: `${estado.pendientes} por sincronizar` };
  return { tono: "online", texto: "Este equipo está en línea" };
}

function fechaLarga(): string {
  const s = new Date().toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const sinComa = s.replace(",", "");
  return sinComa.charAt(0).toUpperCase() + sinComa.slice(1);
}

type HoyBadges = { atencion?: { casos_abiertos?: number; recepciones_pendientes?: number }; boticas?: unknown[] };

export function Layout({ sesion, rutaActual, onSalir, children }: Props) {
  const estado = useEstadoSync(dbLocal);
  const esPos = sesion.usuario.rol === "operador" || RUTAS_POS.includes(rutaActual);
  return esPos ? (
    <PosShell sesion={sesion} rutaActual={rutaActual} onSalir={onSalir} estado={estado}>
      {children}
    </PosShell>
  ) : (
    <PanelShell sesion={sesion} rutaActual={rutaActual} onSalir={onSalir} estado={estado}>
      {children}
    </PanelShell>
  );
}

// ---- Panel de escritorio (dueño / encargado / lector): Sidebar 238 + Topbar 60 ----
function PanelShell({ sesion, rutaActual, onSalir, estado, children }: Props & { estado: EstadoSync }) {
  const rol = sesion.usuario.rol;
  const secciones = SECCIONES.filter((s) => s.roles.includes(rol));
  const cadena = secciones.filter((s) => s.grupo === "cadena");
  const admin = secciones.filter((s) => s.grupo === "admin");
  const activa = seccionDeRuta(rutaActual);
  const p = pill(estado);

  // Badges del sidebar desde el resumen del dueño (cadena para super, su botica para encargado).
  const { data } = useApi<HoyBadges>("/hoy/resumen");
  const nCasos = data?.atencion?.casos_abiertos ?? 0;
  const nRecep = data?.atencion?.recepciones_pendientes ?? 0;
  const badgeDe = (b: "casos" | "recepciones" | undefined): { texto: string; variant?: "danger" | "dark" } | undefined => {
    if (b === "casos" && nCasos > 0) return { texto: String(nCasos), variant: "danger" };
    if (b === "recepciones" && nRecep > 0) return { texto: String(nRecep), variant: "dark" };
    return undefined;
  };

  const ini = iniciales(sesion.usuario.nombre);
  // Alcance real: el super ve el nº de boticas de SU tenant (de /hoy/resumen), no una cifra fija.
  const nBoticas = data?.boticas?.length ?? 0;
  const alcance =
    rol === "super_admin"
      ? nBoticas > 0
        ? `${nBoticas} ${nBoticas === 1 ? "botica" : "boticas"}`
        : "Cadena"
      : (sesion.sucursal?.nombre ?? "Cadena");
  const sideDot = estado.online && estado.nivel !== "rechazada" ? "online" : "offline";
  const sideText = estado.nivel === "ok" ? "Este equipo al día" : estado.nivel === "pendiente" ? `${estado.pendientes} por sincronizar` : estado.nivel === "rechazada" ? `${estado.rechazadas} rechazada(s)` : "Sin conexión";

  const items = (s: (typeof secciones)[number]) => {
    const Ico = ICONOS[s.icono];
    const b = badgeDe(s.badge);
    return (
      <NavItem
        key={s.id}
        icon={<Ico />}
        label={s.label}
        active={activa?.id === s.id}
        onClick={() => navegar(s.ruta)}
        {...(b ? { badge: b } : {})}
      />
    );
  };

  return (
    <ToastProvider>
      <div className="flex h-screen w-full min-w-[1200px] overflow-hidden bg-app text-ink">
        <Sidebar
          footer={
            <>
              <SidebarSyncLine dot={sideDot} text={sideText} animated={!estado.online} />
              <UserCard initials={ini} name={sesion.usuario.nombre} role={`${ROL_LABEL[rol]} · ${alcance}`} />
              <button
                type="button"
                onClick={onSalir}
                className="mx-6 mb-4 -mt-1 self-start text-[11.5px] font-medium text-ink-3 transition-colors hover:text-accent-ink"
              >
                Cerrar sesión
              </button>
            </>
          }
        >
          <SidebarGroup label="Tu cadena">{cadena.map(items)}</SidebarGroup>
          {admin.length > 0 && <SidebarGroup label="Administrar">{admin.map(items)}</SidebarGroup>}
        </Sidebar>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            title={TITULOS[rutaActual] ?? activa?.label ?? ""}
            date={fechaLarga()}
            right={<SyncPill tono={p.tono} texto={p.texto} />}
            initials={ini}
          />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1150px] px-7 pt-[26px] pb-[70px]">{children}</div>
          </main>
        </div>
      </div>
      <ToastStack />
    </ToastProvider>
  );
}

// ---- Shell POS (vendedor / rutas mostrador·recepción): mobile/touch-first, sin sidebar de escritorio ----
function PosShell({ sesion, rutaActual, onSalir, estado, children }: Props & { estado: EstadoSync }) {
  const rol = sesion.usuario.rol;
  const vistas = VISTAS.filter((v) => v.grupo === "pos" && v.roles.includes(rol));
  const p = pill(estado);
  const puedeVolver = rol === "admin_sucursal" || rol === "super_admin";

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-app text-ink">
        <header className="flex flex-none items-center gap-2.5 border-b border-line-chrome bg-topbar px-4 py-2.5">
          <Logo size={24} />
          <span className="text-[14px] font-bold text-ink">Botica Huayruro</span>
          <span className="flex-1" />
          <SyncPill
            tono={p.tono}
            texto={estado.nivel === "rechazada" ? p.texto : p.tono === "online" ? "En línea" : p.tono === "pendiente" ? `${estado.pendientes} en cola` : "Sin conexión"}
          />
          <button type="button" onClick={onSalir} className="min-h-[44px] px-2 text-[13px] font-medium text-ink-2 hover:text-accent-ink">
            Salir
          </button>
        </header>

        <nav className="flex flex-none flex-wrap gap-1.5 border-b border-line-chrome bg-topbar px-3 py-2">
          {vistas.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => navegar(v.id)}
              className={
                "inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition-colors " +
                (rutaActual === v.id ? "border-ink-surface-2 bg-ink-surface-2 text-on-dark" : "border-line-input bg-card text-nav-inactive hover:bg-hover-nav")
              }
            >
              <span aria-hidden="true">{v.icono}</span>
              {v.label}
            </button>
          ))}
          {puedeVolver && (
            <button
              type="button"
              onClick={() => navegar("hoy")}
              className="ml-auto inline-flex min-h-[44px] flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-line-input bg-card px-3.5 text-[13px] font-semibold text-nav-inactive hover:bg-hover-nav"
            >
              ← Panel
            </button>
          )}
        </nav>

        <main className="flex-1 p-3">{children}</main>
      </div>
      <ToastStack />
    </ToastProvider>
  );
}
