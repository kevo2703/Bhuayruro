import { useState } from "react";
import type { ReactNode } from "react";
import { useApi } from "../lib/useApi";
import { solesCent } from "../lib/money";
import { navegar } from "../lib/ruta";
import { Card, KpiCard, Chip, Tabs, TabPill, TableHead, TableRow, Th, Td, EmptyState } from "../components/ui";
import type { SesionActiva } from "../lib/tipos";

// "Ventas y caja" (refresh visual): funde el panel por botica + el consolidado de cadena bajo una sola
// vista con SUB-TABS DE SCOPE. El scoping lo impone el server (super manda ?sucursal_id / cadena vía
// consolidado/*; no-super clavado a su sede). SOLO presentación + wiring de datos reales; sin acciones.

// Subsets de lo que devuelven los endpoints (no importamos tipos del api; solo los campos que pinta la vista).
type HoyBotica = { sucursal_id: string; nombre: string; ventas_cent: number; num_tickets: number; ticket_promedio_cent: number };
type HoyCadena = { ventas_cent: number; num_tickets: number; ticket_promedio_cent: number; pct_yape: number };
type HoyResumen = { cadena: HoyCadena | null; boticas: HoyBotica[] };
type ResumenDia = { por_metodo: Record<string, number>; total_sistema_cent: number };
type SucursalItem = { id: string; nombre: string };
// /caja/cierres y /consolidado/cierres tienen formas distintas → un tipo laxo que cubre ambas y se normaliza.
type RawCierre = {
  id?: string;
  fecha: string;
  sucursal_id?: string;
  sucursal_nombre?: string;
  total_efectivo_cent?: number;
  total_yape_cent?: number;
  total_otros_cent?: number;
  total_sistema_cent?: number;
  diferencia_cent?: number;
  esperado_cent?: number;
  contado_cent?: number;
  yape_cent?: number;
  dif_cent?: number;
};
type VentaFeed = { id: string; fecha_hora: string; sucursal_nombre: string; items_resumen: string; metodo_pago: string; total_cent: number };

const METODO_LABEL: Record<string, string> = { efectivo: "Efectivo", yape: "Yape", plin: "Plin", tarjeta: "Tarjeta", transferencia: "Transferencia", otro: "Otro" };

const COLS_CIERRES = "100px 170px 1fr 1fr 1fr 190px";
const COLS_FEED = "70px 160px 1fr 100px 90px 150px";

// YYYY-MM-DD → "Sáb 11 jul" (es-PE, sin puntos/comas). Mediodía para no rozar el borde de zona.
function fechaCorta(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  const s = d.toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "").replace(",", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ISO → "4:28pm" (hora local Lima, mono en la tabla).
function horaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Lima" }).replace(/\s/g, "").toLowerCase();
}

// Resultado del cierre: dif=0 Cuadró (ok) / dif>0 Sobró (warn) / dif<0 Faltó (danger) + "ver caso →".
function resultadoCierre(dif: number): ReactNode {
  if (dif === 0) return <Chip variant="ok">Cuadró</Chip>;
  if (dif > 0) return <Chip variant="warn">Sobró {solesCent(dif)}</Chip>;
  return (
    <span className="inline-flex items-center gap-2">
      <Chip variant="danger">Faltó {solesCent(Math.abs(dif))}</Chip>
      <button type="button" onClick={() => navegar("casos")} className="text-[11.5px] font-medium text-link hover:text-link-hover hover:underline">
        ver caso →
      </button>
    </span>
  );
}

function LoadingInline({ que = "datos" }: { que?: string }) {
  return <p className="py-6 text-center text-[13px] text-ink-3">Cargando {que}…</p>;
}

function ErrorInline({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="py-6 text-center">
      <p className="text-[13px] text-accent-ink">{msg}</p>
      <button type="button" onClick={onRetry} className="mt-2 text-[12.5px] font-medium text-link hover:text-link-hover hover:underline">
        Reintentar
      </button>
    </div>
  );
}

export function Dashboard({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [scopeId, setScopeId] = useState<string | null>(null); // null = "Toda la cadena" (solo super)
  const scopeCadena = esSuper && scopeId === null;

  // Un solo /hoy/resumen: trae cadena (super, con pct_yape) + todas las boticas del alcance
  // (venta/tickets/ticket-prom). admin/lector → cadena=null + [su botica].
  const resumen = useApi<HoyResumen>("/hoy/resumen");
  // Tabs de scope (solo super): "Toda la cadena" + una por sucursal (orden del server).
  const sucursales = useApi<{ sucursales: SucursalItem[] }>(esSuper ? "/sucursales" : null);

  // %Yape por botica NO viene en /hoy por botica → se deriva de /caja/dia (yape/total de HOY).
  const cajaDiaPath = scopeCadena ? null : esSuper ? `/caja/dia?sucursal_id=${scopeId}` : `/caja/dia`;
  const cajaDia = useApi<ResumenDia>(cajaDiaPath);
  // Cierres: cadena → /consolidado/cierres (super); botica → /caja/cierres (ahora trae sucursal_nombre).
  const cierresPath = scopeCadena ? "/consolidado/cierres" : esSuper ? `/caja/cierres?sucursal_id=${scopeId}` : `/caja/cierres`;
  const cierres = useApi<{ cierres: RawCierre[] }>(cierresPath);
  // Feed: super sin sucursal_id = cadena; con sucursal_id = esa; admin/lector = suya.
  const ventasPath = scopeCadena ? "/ventas" : esSuper ? `/ventas?sucursal_id=${scopeId}` : `/ventas`;
  const feed = useApi<{ ventas: VentaFeed[] }>(ventasPath);

  const boticas = resumen.data?.boticas ?? [];
  const cadena = resumen.data?.cadena ?? null;
  const boticaSel = esSuper ? (scopeId ? boticas.find((b) => b.sucursal_id === scopeId) : undefined) : boticas[0];

  const ventasCent = scopeCadena ? cadena?.ventas_cent ?? 0 : boticaSel?.ventas_cent ?? 0;
  const tickets = scopeCadena ? cadena?.num_tickets ?? 0 : boticaSel?.num_tickets ?? 0;
  const ticketProm = scopeCadena ? cadena?.ticket_promedio_cent ?? 0 : boticaSel?.ticket_promedio_cent ?? 0;

  // %Yape: cadena real de /hoy; botica derivado de /caja/dia (null si no hay ventas hoy → "próximamente").
  let yapeNode: ReactNode;
  if (scopeCadena) {
    yapeNode = `${cadena?.pct_yape ?? 0}%`;
  } else if (cajaDia.cargando) {
    yapeNode = <span className="text-[15px] font-medium text-ink-3">…</span>;
  } else {
    const total = cajaDia.data?.total_sistema_cent ?? 0;
    const y = cajaDia.data?.por_metodo?.["yape"] ?? 0;
    yapeNode = total > 0 ? `${Math.round((y / total) * 100)}%` : <span className="text-[15px] font-medium text-ink-3">Próximamente</span>;
  }
  const kpi = (v: ReactNode): ReactNode => (resumen.cargando ? "…" : v);

  const cierreRows = (cierres.data?.cierres ?? []).map((c) => {
    const dif = c.dif_cent ?? c.diferencia_cent ?? 0;
    return {
      key: c.id ?? `${c.fecha}-${c.sucursal_id ?? ""}`,
      fecha: c.fecha,
      botica: c.sucursal_nombre ?? "—",
      esperado: c.esperado_cent ?? c.total_sistema_cent ?? 0,
      contado: c.contado_cent ?? (c.total_efectivo_cent ?? 0) + (c.total_yape_cent ?? 0) + (c.total_otros_cent ?? 0),
      yape: c.yape_cent ?? c.total_yape_cent ?? 0,
      dif,
    };
  });
  const ventasRows = feed.data?.ventas ?? [];

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Scope: filtra TODA la vista. Solo el super (cadena) elige; el resto ve solo su botica → sin tabs. */}
      {esSuper && (
        <Tabs className="flex-wrap">
          <TabPill active={scopeCadena} onClick={() => setScopeId(null)}>
            Toda la cadena
          </TabPill>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <TabPill key={s.id} active={scopeId === s.id} onClick={() => setScopeId(s.id)}>
              {s.nombre}
            </TabPill>
          ))}
        </Tabs>
      )}

      {/* 4 KPIs del scope */}
      {resumen.error ? (
        <Card>
          <ErrorInline msg={resumen.error} onRetry={resumen.recargar} />
        </Card>
      ) : (
        <div className="grid grid-cols-4 gap-[14px]">
          <KpiCard label="Ventas de hoy" value={kpi(solesCent(ventasCent))} />
          <KpiCard label="Tickets" value={kpi(String(tickets))} />
          <KpiCard label="Ticket promedio" value={kpi(solesCent(ticketProm))} />
          <KpiCard label="Cobrado por Yape" value={kpi(yapeNode)} />
        </div>
      )}

      {/* Cierres de caja */}
      <Card>
        <h2 className="text-[13.5px] font-bold text-ink">Cierres de caja</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-2">Cada cierre compara el efectivo que debía haber con lo que se contó. El de hoy aparece cuando cada botica cierre.</p>
        {cierres.cargando ? (
          <LoadingInline que="cierres" />
        ) : cierres.error ? (
          <ErrorInline msg={cierres.error} onRetry={cierres.recargar} />
        ) : cierreRows.length === 0 ? (
          <EmptyState className="mt-3" title="Aún no hay cierres" subtitle="El de hoy aparece cuando cada botica cierre su caja." />
        ) : (
          <div className="mt-3">
            <TableHead cols={COLS_CIERRES}>
              <Th>Fecha</Th>
              <Th>Botica</Th>
              <Th align="right">Efectivo esperado</Th>
              <Th align="right">Efectivo contado</Th>
              <Th align="right">Yape</Th>
              <Th>Resultado</Th>
            </TableHead>
            {cierreRows.map((r) => (
              <TableRow key={r.key} cols={COLS_CIERRES}>
                <Td className="text-[12.5px] text-ink-2">{fechaCorta(r.fecha)}</Td>
                <Td className="truncate text-[13px] font-semibold text-ink">{r.botica}</Td>
                <Td align="right" className="tabular-nums text-[13px] text-ink">{solesCent(r.esperado)}</Td>
                <Td align="right" className="tabular-nums text-[13px] text-ink">{solesCent(r.contado)}</Td>
                <Td align="right" className="tabular-nums text-[13px] text-ink-2">{solesCent(r.yape)}</Td>
                <Td>{resultadoCierre(r.dif)}</Td>
              </TableRow>
            ))}
          </div>
        )}
      </Card>

      {/* Últimas ventas (feed) */}
      <Card>
        <h2 className="text-[13.5px] font-bold text-ink">Últimas ventas</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-2">Cada venta del mostrador queda registrada, con o sin internet.</p>
        {feed.cargando ? (
          <LoadingInline que="ventas" />
        ) : feed.error ? (
          <ErrorInline msg={feed.error} onRetry={feed.recargar} />
        ) : ventasRows.length === 0 ? (
          <EmptyState className="mt-3" title="Sin ventas todavía" subtitle="Las ventas del mostrador aparecen aquí apenas se registran." />
        ) : (
          <>
            <div className="mt-3">
              <TableHead cols={COLS_FEED}>
                <Th>Hora</Th>
                <Th>Botica</Th>
                <Th>Ítems</Th>
                <Th>Medio</Th>
                <Th align="right">Total</Th>
                <Th>Sync</Th>
              </TableHead>
              {ventasRows.map((v) => (
                <TableRow key={v.id} cols={COLS_FEED}>
                  <Td className="font-mono text-[11.5px] text-ink-2">{horaCorta(v.fecha_hora)}</Td>
                  <Td className="truncate text-[13px] font-semibold text-ink">{v.sucursal_nombre}</Td>
                  <Td className="overflow-hidden truncate text-[12.5px] text-ink-2">{v.items_resumen || "—"}</Td>
                  <Td>
                    <Chip variant={v.metodo_pago === "yape" ? "yape" : "neutral"}>{METODO_LABEL[v.metodo_pago] ?? v.metodo_pago}</Chip>
                  </Td>
                  <Td align="right" className="tabular-nums text-[13px] text-ink">{solesCent(v.total_cent)}</Td>
                  <Td>
                    <Chip variant="neutral">Sincronizada</Chip>
                  </Td>
                </TableRow>
              ))}
            </div>
            {/* La cola offline es local del equipo del mostrador; el panel lee online → todo lo listado ya llegó al server. */}
            <p className="mt-2.5 text-[11.5px] text-ink-3-alt">
              Todo lo que ves aquí ya llegó al servidor. “Por sincronizar” es un estado del equipo del mostrador; verlo por equipo en el panel, próximamente.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
