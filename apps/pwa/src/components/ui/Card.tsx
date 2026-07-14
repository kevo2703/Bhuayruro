import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

type CardProps = ComponentPropsWithoutRef<"div"> & {
  size?: "md" | "lg";
};

// Superficie base de tarjetas/paneles: bg blanco sobre borde cálido, sin sombra (el sistema es
// plano y se apoya en el borde). 'lg' es para paneles grandes (barra de cadena, detalle de caso,
// cabecera del pedido, espejo) con radio y padding mayores. Passthrough de className/onClick/etc.
export function Card({ size = "md", className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "flex flex-col bg-card border border-line",
        size === "lg" ? "rounded-[14px] p-[20px_24px]" : "rounded-[12px] p-[18px_20px]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
