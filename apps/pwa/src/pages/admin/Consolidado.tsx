import { useState } from "react";
import { useApi, descargarCsv } from "../../lib/useApi";
import { solesCent } from "../../lib/money";
import { Cargando, ErrorMsg, Vacio, Tarjeta } from "../../components/Estados";
import { Button, Chip, Tabs, TabPill, TableHead, TableRow, Th, Td } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

type Resumen = { rango: string; boticas: { sucursal_id: string; sucursal: string; num_ventas: number; ventas_cent: number }[] };
type Faltante = { producto: { id: string; nombre: string }; por_botica: { sucursal: string; stock: number; minimo: number; quiebres_14d: number; sugerido: number }[]; sugerido_total: number };

const RANGOS = [
  { id: "hoy", label: "Hoy" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
];

const COLS_VENTAS = "1fr 90px 130px"; // Botica · Ventas · Total (mismo string en head y filas)

// Consolidado super (§4.3: ÚNICA vista cross-botica). Agregados por botica + faltantes + CSV del pedido.
export function Consolidado(_props: { sesion: SesionActiva }) {
  const [rango, setRango] = useState("7d");
  const resumen = useApi<Resumen>(`/consolidado/resumen?rango=${rango}`, [rango]);
  const faltantes = useApi<{ items: Faltante[] }>("/consolidado/faltantes");
  const [bajando, setBajando] = useState(false);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[18px] font-bold text-ink">Consolidado de la cadena</h1>
        <Tabs>
          {RANGOS.map((r) => (
            <TabPill key={r.id} active={rango === r.id} onClick={() => setRango(r.id)}>
              {r.label}
            </TabPill>
          ))}
        </Tabs>
      </div>

      <Tarjeta titulo="Ventas por botica">
        {resumen.cargando ? (
          <Cargando que="consolidado" />
        ) : resumen.error ? (
          <ErrorMsg msg={resumen.error} onReintentar={resumen.recargar} />
        ) : (resumen.data?.boticas.length ?? 0) === 0 ? (
          <Vacio>Sin boticas.</Vacio>
        ) : (
          <div>
            <TableHead cols={COLS_VENTAS}>
              <Th>Botica</Th>
              <Th align="right">Ventas</Th>
              <Th align="right">Total</Th>
            </TableHead>
            {resumen.data!.boticas.map((b) => (
              <TableRow key={b.sucursal_id} cols={COLS_VENTAS}>
                <Td className="truncate text-[13px] text-ink">{b.sucursal}</Td>
                <Td align="right" className="tabular-nums text-[13px] text-ink-2">{b.num_ventas}</Td>
                <Td align="right" className="font-mono tabular-nums text-[13px] text-ink">{solesCent(b.ventas_cent)}</Td>
              </TableRow>
            ))}
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        titulo="Faltantes consolidados"
        accion={
          <Button
            variant="outline"
            size="sm"
            disabled={bajando}
            onClick={async () => {
              setBajando(true);
              try {
                await descargarCsv("/consolidado/faltantes.csv", "faltantes-consolidado.csv");
              } finally {
                setBajando(false);
              }
            }}
          >
            {bajando ? "Generando…" : "Descargar CSV"}
          </Button>
        }
      >
        {faltantes.cargando ? (
          <Cargando que="faltantes" />
        ) : (faltantes.data?.items.length ?? 0) === 0 ? (
          <Vacio>Sin faltantes en la cadena.</Vacio>
        ) : (
          <div className="flex flex-col">
            {faltantes.data!.items.map((it) => (
              <div key={it.producto.id} className="flex flex-col gap-1 border-b border-line-row py-2.5 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-ink">{it.producto.nombre}</span>
                  <Chip variant="ok" className="shrink-0 font-mono tabular-nums">pedir {it.sugerido_total}</Chip>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-2">
                  {it.por_botica.map((b, i) => (
                    <span key={i} className="tabular-nums">
                      {b.sucursal}: {b.stock}/{b.minimo}
                      {b.quiebres_14d > 0 && ` · ${b.quiebres_14d}q`}
                      {" → "}
                      <b className="text-ink">{b.sugerido}</b>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
