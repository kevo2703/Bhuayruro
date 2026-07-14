import { useEffect } from "react";
import { useApi } from "../../lib/useApi";
import { Card, Chip, TableHead, TableRow, Th, Td, EmptyState } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// Faltantes de MI botica (§8): stock<=mínimo O quiebres en 14 días. La ruta enriquece cada fila con
// `origen` ('oido'|'manual'|null) y, para los de oído, la `frase` que lo disparó (mono, no acusatoria).
type Origen = "oido" | "manual" | null;
type Fila = { producto_id: string; nombre: string; stock: number; minimo: number; quiebres_14d: number; sugerido: number; origen: Origen; frase?: string | null };

// "Cómo se supo": el oído del mostrador (rojo), reportado a mano, o solo por debajo del mínimo.
function comoSeSupo(origen: Origen) {
  if (origen === "oido") return <Chip variant="danger">El oído</Chip>;
  if (origen === "manual") return <Chip variant="neutral">Registrado a mano</Chip>;
  return <Chip variant="neutral">Bajo mínimo</Chip>;
}

export function Faltantes({ onCount, sucursalId }: { sesion: SesionActiva; onCount?: (n: number) => void; sucursalId?: string }) {
  const { data, cargando, error, recargar } = useApi<{ faltantes: Fila[] }>(sucursalId ? `/faltantes?sucursal_id=${sucursalId}` : "/faltantes", [sucursalId]);
  useEffect(() => {
    if (data) onCount?.(data.faltantes.length);
  }, [data, onCount]);

  const cols = "2fr 200px 200px";

  return (
    <Card className="gap-3">
      <p className="text-[12.5px] text-ink-2">Lo que se acabó o se pidió y no había. Viene del oído del mostrador o de lo que se anota a mano.</p>
      {cargando ? (
        <p className="p-6 text-center text-[13px] text-ink-3">Cargando faltantes…</p>
      ) : error ? (
        <div className="p-6 text-center">
          <p className="text-[13px] text-accent-ink">{error}</p>
          <button onClick={recargar} className="mt-2 text-[12.5px] text-link underline">Reintentar</button>
        </div>
      ) : (data?.faltantes.length ?? 0) === 0 ? (
        <EmptyState title="Sin faltantes" subtitle="Todo por encima del mínimo." />
      ) : (
        <div>
          <TableHead cols={cols}>
            <Th>Producto</Th>
            <Th>Cómo se supo</Th>
            <Th>Acción</Th>
          </TableHead>
          {data!.faltantes.map((f) => (
            <TableRow key={f.producto_id} cols={cols}>
              <Td className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-ink">{f.nombre}</p>
                {f.origen === "oido" && f.frase && <p className="truncate font-mono text-[11.5px] text-ink-3-alt">"{f.frase}"</p>}
              </Td>
              <Td>{comoSeSupo(f.origen)}</Td>
              <Td>
                <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
                  Pasar a pedido
                  <Chip variant="neutral" className="opacity-70">próximamente</Chip>
                </span>
              </Td>
            </TableRow>
          ))}
        </div>
      )}
    </Card>
  );
}
