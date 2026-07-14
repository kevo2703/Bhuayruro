import { useState } from "react";
import type { ReactNode } from "react";
import { solesStrACent } from "@huayruro/shared";
import { useApi, mutar } from "../lib/useApi";
import { ahoraFecha } from "../lib/fecha-ui";
import { solesCent } from "../lib/money";
import { cn, Card, Input, Button, Chip, EmptyState, TableHead, TableRow, Th, Td } from "../components/ui";
import type { SesionActiva } from "../lib/tipos";

// Cierre de caja del día (restyle al tema claro). SOLO presentación: mismas llamadas (/caja/dia,
// POST /caja/cierres), mismos guards (cerrar = admin+), mismo cálculo server (esperado + diferencia).

type ResumenDia = { fecha: string; por_metodo: Record<string, number>; total_sistema_cent: number; num_ventas: number };
type Cierre = { id: string; fecha: string; total_efectivo_cent: number; total_yape_cent: number; total_otros_cent: number; total_sistema_cent: number; diferencia_cent: number; cerrado_at: string };

const aCent = (s: string): number => {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 0;
  try {
    return solesStrACent(t);
  } catch {
    return 0;
  }
};

const METODO_LABEL: Record<string, string> = { efectivo: "Efectivo", yape: "Yape", plin: "Plin", tarjeta: "Tarjeta", transferencia: "Transferencia", otro: "Otro" };

const COLS = "110px 1fr 1fr 1fr 150px";

// Resultado del cierre (chip). Sin link "ver caso": esta vista la usa también el vendedor (POS) y Casos es admin+.
function resultadoCierre(dif: number): ReactNode {
  if (dif === 0) return <Chip variant="ok">Cuadró</Chip>;
  if (dif > 0) return <Chip variant="warn">Sobró {solesCent(dif)}</Chip>;
  return <Chip variant="danger">Faltó {solesCent(Math.abs(dif))}</Chip>;
}

export function Caja({ sesion }: { sesion: SesionActiva }) {
  const [fecha, setFecha] = useState(ahoraFecha());
  const puedeCerrar = sesion.usuario.rol === "admin_sucursal" || sesion.usuario.rol === "super_admin";
  const dia = useApi<ResumenDia>(`/caja/dia?fecha=${fecha}`, [fecha]);
  const historial = useApi<{ cierres: Cierre[] }>(`/caja/cierres`);

  const [efectivo, setEfectivo] = useState("");
  const [yape, setYape] = useState("");
  const [otros, setOtros] = useState("");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const contadoCent = aCent(efectivo) + aCent(yape) + aCent(otros);
  const sistemaCent = dia.data?.total_sistema_cent ?? 0;
  const difPreview = contadoCent - sistemaCent;

  async function cerrar() {
    setEnviando(true);
    setMsg(null);
    try {
      const r = await mutar<{ diferencia_cent: number }>("/caja/cierres", {
        method: "POST",
        body: { fecha, total_efectivo_cent: aCent(efectivo), total_yape_cent: aCent(yape), total_otros_cent: aCent(otros), observaciones: obs.trim() || null },
      });
      setMsg({ ok: true, texto: `Caja cerrada. Diferencia: ${solesCent(r.diferencia_cent)}` });
      setEfectivo("");
      setYape("");
      setOtros("");
      setObs("");
      historial.recargar();
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setEnviando(false);
    }
  }

  const cierres = historial.data?.cierres ?? [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-[18px]">
      <div className="flex items-center justify-between">
        <h1 className="text-[16.5px] font-bold tracking-[-0.01em] text-ink">Caja</h1>
        <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-auto text-[13px]" />
      </div>

      {/* Resumen del día (sistema) */}
      <Card>
        <h2 className="mb-2 text-[13.5px] font-bold text-ink">Resumen del día</h2>
        {dia.cargando ? (
          <p className="py-4 text-center text-[13px] text-ink-3">Cargando caja…</p>
        ) : dia.error ? (
          <div className="py-4 text-center">
            <p className="text-[13px] text-accent-ink">{dia.error}</p>
            <button type="button" onClick={dia.recargar} className="mt-2 text-[12.5px] font-medium text-link hover:text-link-hover hover:underline">
              Reintentar
            </button>
          </div>
        ) : (
          <>
            <p className="text-[12.5px] text-ink-2">{dia.data!.num_ventas} venta(s) completadas</p>
            <ul className="mt-2 flex flex-col gap-1">
              {Object.entries(dia.data!.por_metodo).map(([m, cent]) => (
                <li key={m} className="flex justify-between text-[13px]">
                  <span className="text-ink-2">{METODO_LABEL[m] ?? m}</span>
                  <span className="tabular-nums text-ink">{solesCent(cent)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between border-t border-line-row pt-3 text-[13px] font-bold">
              <span className="text-ink">Total sistema</span>
              <span className="tabular-nums text-ink">{solesCent(sistemaCent)}</span>
            </div>
          </>
        )}
      </Card>

      {/* Cerrar caja del día (admin+) */}
      {puedeCerrar && (
        <Card>
          <h2 className="mb-3 text-[13.5px] font-bold text-ink">Cerrar caja del día</h2>
          <div className="grid grid-cols-3 gap-2">
            <Campo label="Efectivo" value={efectivo} onChange={setEfectivo} />
            <Campo label="Yape/Plin" value={yape} onChange={setYape} />
            <Campo label="Otros" value={otros} onChange={setOtros} />
          </div>
          <Input className="mt-3" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observaciones (opcional)" />
          <div className="mt-3 flex items-center justify-between text-[13px]">
            <span className="text-ink-2">
              Contado <span className="tabular-nums">{solesCent(contadoCent)}</span> · Sistema <span className="tabular-nums">{solesCent(sistemaCent)}</span>
            </span>
            <span className={cn("font-semibold tabular-nums", difPreview === 0 ? "text-ink-3" : difPreview > 0 ? "text-ok" : "text-accent-ink")}>
              {difPreview >= 0 ? "Sobrante" : "Faltante"}: {solesCent(Math.abs(difPreview))}
            </span>
          </div>
          <Button variant="primary" onClick={() => void cerrar()} disabled={enviando} className="mt-3 w-full justify-center">
            {enviando ? "Cerrando…" : "Cerrar caja"}
          </Button>
          {msg && <p className={cn("mt-2 text-[13px]", msg.ok ? "text-ok" : "text-accent-ink")}>{msg.texto}</p>}
        </Card>
      )}

      {/* Cierres recientes (de esta botica) */}
      <Card>
        <h2 className="text-[13.5px] font-bold text-ink">Cierres recientes</h2>
        {historial.cargando ? (
          <p className="py-6 text-center text-[13px] text-ink-3">Cargando historial…</p>
        ) : cierres.length === 0 ? (
          <EmptyState className="mt-3" title="Aún no hay cierres" subtitle="Cierra la caja del día para verlo aquí." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <TableHead cols={COLS}>
              <Th>Fecha</Th>
              <Th align="right">Efectivo esperado</Th>
              <Th align="right">Efectivo contado</Th>
              <Th align="right">Yape</Th>
              <Th>Resultado</Th>
            </TableHead>
            {cierres.map((c) => {
              const contado = c.total_efectivo_cent + c.total_yape_cent + c.total_otros_cent;
              return (
                <TableRow key={c.id} cols={COLS}>
                  <Td className="text-[12.5px] text-ink-2">{c.fecha}</Td>
                  <Td align="right" className="tabular-nums text-[13px] text-ink">{solesCent(c.total_sistema_cent)}</Td>
                  <Td align="right" className="tabular-nums text-[13px] text-ink">{solesCent(contado)}</Td>
                  <Td align="right" className="tabular-nums text-[13px] text-ink-2">{solesCent(c.total_yape_cent)}</Td>
                  <Td>{resultadoCierre(c.diferencia_cent)}</Td>
                </TableRow>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Campo({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" className="tabular-nums" />
    </label>
  );
}
