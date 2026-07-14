// Chrome del topbar (60px): título → punto separador → fecha → spacer → slot derecho
// (típicamente <SyncPill>) → avatar de usuario. `initials` cablea el <Avatar> del final.
import type { ReactNode } from "react";
import { cn } from "./cn";

export function Topbar({
  title,
  date,
  right,
  initials,
  className,
}: {
  title: string;
  date?: string;
  right?: ReactNode;
  initials?: string;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-[60px] flex-none items-center gap-3.5 border-b border-line-chrome bg-topbar px-7",
        className,
      )}
    >
      <h1 className="text-[16.5px] font-bold tracking-[-0.01em] text-ink">{title}</h1>
      {date && (
        <>
          <span className="h-1 w-1 flex-none rounded-full bg-dot-topbar" aria-hidden="true" />
          <span className="text-[13px] tabular-nums text-ink-date">{date}</span>
        </>
      )}
      <span className="flex-1" />
      {right}
      {initials && <Avatar initials={initials} />}
    </header>
  );
}

// Avatar de iniciales (rojo suave). Escalable por `size` (default 34); la cifra va 12.5/700.
export function Avatar({
  initials,
  size = 34,
  className,
}: {
  initials: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-full bg-avatar font-bold text-accent-ink",
        className,
      )}
      style={{ width: size, height: size, fontSize: 12.5 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
