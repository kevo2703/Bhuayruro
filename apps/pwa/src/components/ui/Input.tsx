import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

// Base compartida por Input y Textarea (el color del placeholder llega del CSS global: ink-3-alt).
const BASE = "w-full box-border border border-line-input rounded-[9px] px-3 py-2.5 text-[13px] text-ink bg-field outline-none";

type InputProps = ComponentPropsWithoutRef<"input">;

// Input de texto del design system. Passthrough de props nativas (value, onChange, placeholder…).
export function Input({ className, type = "text", ...rest }: InputProps) {
  return <input type={type} className={cn(BASE, className)} {...rest} />;
}

type TextareaProps = ComponentPropsWithoutRef<"textarea">;

export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={cn(BASE, className)} {...rest} />;
}
