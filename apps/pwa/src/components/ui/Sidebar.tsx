// Chrome del sidebar (238px). API por composición:
//
//   <Sidebar footer={<>
//              <SidebarSyncLine dot="offline" text="…" animated />
//              <UserCard initials="ÁR" name="Álvaro R." role="Dueño" />
//            </>}>
//     <SidebarGroup label="Tu cadena">
//       <NavItem icon={<IconHoy />} label="Hoy" active onClick={…} />
//       <NavItem icon={<IconCasos />} label="Casos" badge={{ texto: "5", variant: "danger" }} onClick={…} />
//     </SidebarGroup>
//     <SidebarGroup label="Administrar"> … </SidebarGroup>
//   </Sidebar>
//
// `children` = grupos + ítems (área scrolleable); `footer` = pie fijo (sync + usuario).
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Logo } from "./Logo";

export function Sidebar({
  children,
  footer,
  titulo = "Botica Huayruro",
  className,
}: {
  children: ReactNode;
  footer?: ReactNode;
  titulo?: string;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "flex h-screen w-[238px] flex-none flex-col border-r border-line-chrome bg-sidebar",
        className,
      )}
    >
      {/* Marca — logo + nombre. padding 20/24/18 */}
      <div className="flex items-center gap-2.5 px-6 pt-5 pb-[18px]">
        <Logo size={28} />
        <span className="text-[15px] font-bold text-ink">{titulo}</span>
      </div>

      {/* Nav scrolleable */}
      <nav className="min-h-0 flex-1 overflow-y-auto pb-2">{children}</nav>

      {/* Pie fijo (sync + usuario) */}
      {footer}
    </aside>
  );
}

// Grupo con label uppercase. El primer grupo no lleva separación superior.
export function SidebarGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-3.5 first:mt-0", className)}>
      <div className="mx-6 mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-sidebar-group">
        {label}
      </div>
      {children}
    </div>
  );
}

type NavBadge = { texto: string; variant?: "danger" | "dark" };

// Badge a la derecha del ítem (contador de Casos / Inventario).
function NavItemBadge({ texto, variant = "danger" }: NavBadge) {
  return (
    <span
      className={cn(
        "flex-none rounded-full px-1.5 py-px text-[10.5px] font-bold tabular-nums",
        variant === "danger" ? "bg-accent text-white" : "bg-ink-surface-2 text-on-dark",
      )}
    >
      {texto}
    </span>
  );
}

export function NavItem({
  icon,
  label,
  active = false,
  onClick,
  badge,
  className,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: NavBadge;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "mx-3 my-px flex w-[calc(100%-24px)] items-center gap-2.5 rounded-[9px] px-3 py-[9px] text-left transition-colors duration-[120ms]",
        active ? "bg-nav-active hover:bg-nav-active-hover" : "hover:bg-hover-nav",
        className,
      )}
    >
      {/* La marca (ícono) toma el rojo en activo, el neutro en inactivo */}
      <span className={cn("flex flex-none items-center", active ? "text-accent" : "text-neutral-dot")}>
        {icon}
      </span>
      <span className={cn("text-[13.5px] font-semibold", active ? "text-accent-ink" : "text-nav-inactive")}>
        {label}
      </span>
      {badge && (
        <>
          <span className="flex-1" />
          <NavItemBadge {...badge} />
        </>
      )}
    </button>
  );
}

// Línea de sincronización del pie. `animated` prende el pulso (offline sin conexión).
export function SidebarSyncLine({
  dot,
  text,
  animated = false,
  className,
}: {
  dot: "online" | "offline";
  text: string;
  animated?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-6 mb-3 flex items-center gap-2 border-t border-line-chrome-2 pt-3.5",
        className,
      )}
    >
      <span
        className={cn(
          "h-2 w-2 flex-none rounded-full",
          dot === "offline" ? "bg-accent" : "bg-ok-strong",
          animated && "animate-pulse-dot",
        )}
        aria-hidden="true"
      />
      <span className="text-[11.5px] font-medium text-ink-2">{text}</span>
    </div>
  );
}

// Tarjeta de usuario del pie (avatar de iniciales + nombre + rol).
export function UserCard({
  initials,
  name,
  role,
  onClick,
  className,
}: {
  initials: string;
  name: string;
  role: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mx-4 mb-4 flex w-[calc(100%-32px)] items-center gap-2.5 rounded-[10px] px-2 py-2.5 text-left transition-colors hover:bg-hover-user",
        className,
      )}
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-avatar text-xs font-bold text-accent-ink">
        {initials}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-semibold text-ink">{name}</span>
        <span className="truncate text-[11px] text-ink-3">{role}</span>
      </span>
    </button>
  );
}
