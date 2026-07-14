import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "outline" | "done" | "tip";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
};

// Solo colores/bordes por variante; el tamaño de texto y el peso se resuelven aparte para no
// apilar dos utilidades del mismo eje (font-size/weight) sobre el botón.
const VARIANTE: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  outline: "bg-card border border-line-input text-ink-emph hover:bg-hover-btn",
  done: "bg-done-bg text-done-fg cursor-default", // "enviado ✓": deshabilitado visual
  tip: "bg-card border border-tip-border text-ok hover:bg-tip-hover", // "Agregar" dentro de un tip
};

// Botón del design system. Passthrough de props nativas (onClick, disabled, type…). El 'tip' fija
// su propio 12/700; el resto sigue el tamaño (13.5 default, 12.5 en 'sm').
export function Button({ variant = "primary", size = "md", className, type = "button", children, ...rest }: ButtonProps) {
  const textSize = variant === "tip" ? "text-[12px]" : size === "sm" ? "text-[12.5px]" : "text-[13.5px]";
  const weight = variant === "tip" ? "font-bold" : "font-semibold";
  const padding = size === "sm" ? "px-4 py-2" : "px-[18px] py-[10px]";
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[9px] transition-colors disabled:opacity-60",
        padding,
        textSize,
        weight,
        VARIANTE[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
