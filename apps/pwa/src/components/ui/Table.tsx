import type { ReactNode } from "react";
import { cn } from "./cn";

// Tabla por COMPOSICIÓN con CSS grid (design-system §7 "Table"), no un componente monolítico.
// Cada sección define su propio `cols` (grid-template-columns) y lo pasa TANTO al header como a
// cada fila, para que las columnas queden alineadas. El markup nombra roles de borde/texto.
//
// Uso:
//   const cols = "1.6fr 100px 160px 150px 90px 1.5fr"; // el mismo string en head y filas
//
//   <TableHead cols={cols}>
//     <Th>Producto</Th>
//     <Th align="right">Stock</Th>
//     <Th>Lote</Th>
//     <Th>Vence</Th>
//     <Th align="right">Días</Th>
//     <Th>Acción</Th>
//   </TableHead>
//
//   {filas.map((f) => (
//     <TableRow key={f.id} cols={cols} onClick={() => abrir(f)}>
//       <Td>{f.nombre}</Td>
//       <Td align="right" className="tabular-nums">{f.stock}</Td>   {/* toda cifra: tabular-nums */}
//       <Td className="font-mono text-[11.5px] text-ink-2">{f.lote}</Td>
//       <Td>{f.vence}</Td>
//       <Td align="right" className="tabular-nums">{f.dias}</Td>
//       <Td>{f.accion}</Td>
//     </TableRow>
//   ))}
//
// Th/Td son opcionales: puedes meter cualquier nodo como celda directa. Th aporta el estilo de
// label de header (11/700 uppercase). Td solo resuelve la alineación y pasa className.

type Align = "left" | "right" | "center";

const ALIGN: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

// Header de tabla: grid con el `cols` de la sección, línea inferior de cabecera.
export function TableHead({
  cols,
  children,
  className,
}: {
  cols: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="row"
      className={cn("grid gap-x-2.5 p-[8px_2px] border-b border-line-row-head", className)}
      style={{ gridTemplateColumns: cols }}
    >
      {children}
    </div>
  );
}

// Celda de header: label uppercase 11/700, tracking 0.06em, color de labels de tabla.
export function Th({
  align = "left",
  children,
  className,
}: {
  align?: Align;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      role="columnheader"
      className={cn(
        "text-[11px] font-bold tracking-[0.06em] uppercase text-ink-table",
        ALIGN[align],
        className,
      )}
    >
      {children}
    </span>
  );
}

// Fila de cuerpo: mismo grid que el header, centrada verticalmente, con línea divisoria de fila.
// Si recibe onClick se marca clicable (cursor-pointer).
export function TableRow({
  cols,
  children,
  onClick,
  className,
}: {
  cols: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      role="row"
      onClick={onClick}
      className={cn(
        "grid items-center gap-x-2.5 p-[7px_2px] border-b border-line-row",
        onClick && "cursor-pointer",
        className,
      )}
      style={{ gridTemplateColumns: cols }}
    >
      {children}
    </div>
  );
}

// Celda de cuerpo: resuelve la alineación y pasa className (el estilo de texto lo pone el caller:
// nombre 13/600, secundario 12.5/text-ink-2, cifras con tabular-nums, mono con font-mono, etc.).
export function Td({
  align = "left",
  children,
  className,
}: {
  align?: Align;
  children?: ReactNode;
  className?: string;
}) {
  return <div className={cn(ALIGN[align], className)}>{children}</div>;
}
