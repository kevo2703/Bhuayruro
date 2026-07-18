// Set de íconos de nav — SVG 12px inline. Todos pintan por `currentColor`, así que
// el color lo pone quien los usa (p. ej. text-accent en activo, text-neutral-dot en inactivo).
// Escalables por `size` (default 12); className passthrough.
import type { ReactNode } from "react";
import { cn } from "./cn";

type IconProps = { size?: number; className?: string };

// Envoltura común: viewBox 0 0 12 12, color heredado por currentColor.
function Icon({ size = 12, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
      className={cn("flex-none", className)}
    >
      {children}
    </svg>
  );
}

// Hoy — círculo simple.
export function IconHoy(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="6" r="5" />
    </Icon>
  );
}

// Casos — rombo (rect girado 45°).
export function IconCasos(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="6" height="6" rx="1.2" transform="rotate(45 6 6)" />
    </Icon>
  );
}

// Ventas — tres barras verticales 5/9/7.
export function IconVentas(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1" y="7" width="2" height="5" rx="0.5" />
      <rect x="5" y="3" width="2" height="9" rx="0.5" />
      <rect x="9" y="5" width="2" height="7" rx="0.5" />
    </Icon>
  );
}

// Inventario — dos cajones apilados.
export function IconInventario(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1.5" y="2.2" width="9" height="3.1" rx="1" />
      <rect x="1.5" y="6.7" width="9" height="3.1" rx="1" />
    </Icon>
  );
}

// Compras — dos círculos superpuestos (el segundo, atenuado).
export function IconCompras(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="4.6" cy="6" r="3.4" />
      <circle cx="8.4" cy="7.2" r="2.6" opacity="0.55" />
    </Icon>
  );
}

// Ajustes — anillo atenuado + núcleo.
export function IconAjustes(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="6" r="5" opacity="0.35" />
      <circle cx="6" cy="6" r="2.4" />
    </Icon>
  );
}

// Oído (audio) — equalizer de tres barras 4/8/3.
export function IconOido(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1" y="8" width="2" height="4" rx="0.5" />
      <rect x="5" y="4" width="2" height="8" rx="0.5" />
      <rect x="9" y="9" width="2" height="3" rx="0.5" />
    </Icon>
  );
}

// Mapa — plano plegado en tres paneles.
export function IconMapa(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1 3 L4 2 L4 10 L1 11 Z" />
      <path d="M4.7 2 L7.3 3 L7.3 11 L4.7 10 Z" />
      <path d="M8 3 L11 2 L11 10 L8 11 Z" />
    </Icon>
  );
}

// Mostrador (POS) — toldo + cuerpo de tienda.
export function IconMostrador(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1" y="1.5" width="10" height="2.5" rx="1" />
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" />
    </Icon>
  );
}
