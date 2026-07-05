import { useState } from "react";
import { useApi } from "../lib/useApi";
import { solesCent } from "../lib/money";
import { Cargando, ErrorMsg } from "../components/Estados";
import type { SesionActiva } from "../lib/tipos";

type Resumen = {
  rango: string;
  ventas_cent: number;
  num_ventas: number;
  ticket_promedio_cent: number;
  por_dia: { dia: string; n: number; total: number }[];
  top_productos: { producto_id: string; nombre: string; unidades: number; total_cent: number }[];
  quiebres: number;
  stock_bajo: number;
  margen_estimado_cent: number;
  margen_parcial: boolean;
};

const RANGOS: { id: string; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
];

export function Dashboard({ sesion }: { sesion: SesionActiva }) {
  const [rango, setRango] = useState("7d");
  const esSuper = sesion.usuario.rol === "super_admin";
  // El super no tiene sucursal fija → su panel es el consolidado; aquí ve el panel por botica solo
  // si elige una (no implementado el selector aquí) → mostramos aviso y lo mandamos a Consolidado.
  const { data, cargando, error, recargar } = useApi<Resumen>(esSuper ? null : `/dashboard/resumen?rango=${rango}`, [rango]);
  const maxDia = Math.max(1, ...(data?.por_dia.map((d) => d.total) ?? [1]));

  if (esSuper) {
    return (
      <div className="max-w-2xl mx-auto w-full">
        <h1 className="text-xl font-bold">Panel</h1>
        <p className="mt-3 opacity-70 text-sm">Como super admin, revisa el rendimiento por botica en la pestaña <b>Consolidado</b>.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Panel · {sesion.sucursal?.nombre ?? ""}</h1>
        <div className="flex gap-1">
          {RANGOS.map((r) => (
            <button key={r.id} onClick={() => setRango(r.id)} className={`px-3 py-1.5 rounded text-sm ${rango === r.id ? "bg-emerald-500 text-black font-medium" : "bg-white/5 hover:bg-white/10"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {cargando ? (
        <Cargando que="panel" />
      ) : error ? (
        <ErrorMsg msg={error} onReintentar={recargar} />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Kpi label="Ventas" valor={solesCent(data.ventas_cent)} />
            <Kpi label="N° ventas" valor={String(data.num_ventas)} />
            <Kpi label="Ticket prom." valor={solesCent(data.ticket_promedio_cent)} />
            <Kpi label="Margen est." valor={solesCent(data.margen_estimado_cent)} nota={data.margen_parcial ? "faltan costos" : undefined} />
            <Kpi label="Quiebres" valor={String(data.quiebres)} alerta={data.quiebres > 0} />
            <Kpi label="Stock bajo" valor={String(data.stock_bajo)} alerta={data.stock_bajo > 0} />
          </div>

          <section className="bg-white/5 rounded-lg border border-white/10 p-4">
            <h2 className="font-semibold mb-3">Venta por día</h2>
            {data.por_dia.length === 0 ? (
              <p className="opacity-50 text-sm">Sin ventas en el rango.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.por_dia.map((d) => (
                  <li key={d.dia} className="flex items-center gap-2 text-xs">
                    <span className="w-16 opacity-60 shrink-0">{d.dia.slice(5)}</span>
                    <div className="flex-1 bg-white/5 rounded h-4 overflow-hidden">
                      <div className="h-full bg-emerald-500/70" style={{ width: `${(d.total / maxDia) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right font-mono shrink-0">{solesCent(d.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white/5 rounded-lg border border-white/10 p-4">
            <h2 className="font-semibold mb-3">Top productos</h2>
            {data.top_productos.length === 0 ? (
              <p className="opacity-50 text-sm">Sin datos.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {data.top_productos.map((p) => (
                  <li key={p.producto_id} className="py-2 flex justify-between text-sm">
                    <span className="truncate pr-2">{p.nombre}</span>
                    <span className="opacity-70 shrink-0">{p.unidades} u · {solesCent(p.total_cent)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Kpi({ label, valor, nota, alerta }: { label: string; valor: string; nota?: string | undefined; alerta?: boolean | undefined }) {
  return (
    <div className={`rounded-lg border p-3 ${alerta ? "border-red-500/40 bg-red-500/5" : "border-white/10 bg-white/5"}`}>
      <p className="text-xs opacity-60">{label}</p>
      <p className="text-lg font-bold font-mono mt-0.5">{valor}</p>
      {nota && <p className="text-[10px] opacity-50">{nota}</p>}
    </div>
  );
}
