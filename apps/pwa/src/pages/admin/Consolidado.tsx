import { useState } from "react";
import { useApi, descargarCsv } from "../../lib/useApi";
import { solesCent } from "../../lib/money";
import { Cargando, ErrorMsg, Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

type Resumen = { rango: string; boticas: { sucursal_id: string; sucursal: string; num_ventas: number; ventas_cent: number }[] };
type Faltante = { producto: { id: string; nombre: string }; por_botica: { sucursal: string; stock: number; minimo: number; quiebres_14d: number; sugerido: number }[]; sugerido_total: number };

const RANGOS = [
  { id: "hoy", label: "Hoy" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
];

// Consolidado super (§4.3: ÚNICA vista cross-botica). Agregados por botica + faltantes + CSV del pedido.
export function Consolidado(_props: { sesion: SesionActiva }) {
  const [rango, setRango] = useState("7d");
  const resumen = useApi<Resumen>(`/consolidado/resumen?rango=${rango}`, [rango]);
  const faltantes = useApi<{ items: Faltante[] }>("/consolidado/faltantes");
  const [bajando, setBajando] = useState(false);

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Consolidado de la cadena</h1>
        <div className="flex gap-1">
          {RANGOS.map((r) => (
            <button key={r.id} onClick={() => setRango(r.id)} className={`px-3 py-1.5 rounded text-sm ${rango === r.id ? "bg-emerald-500 text-black font-medium" : "bg-white/5 hover:bg-white/10"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <section className="bg-white/5 rounded-lg border border-white/10">
        <header className="px-4 py-3 border-b border-white/10 font-semibold">Ventas por botica</header>
        {resumen.cargando ? (
          <Cargando que="consolidado" />
        ) : resumen.error ? (
          <ErrorMsg msg={resumen.error} onReintentar={resumen.recargar} />
        ) : (resumen.data?.boticas.length ?? 0) === 0 ? (
          <Vacio>Sin boticas.</Vacio>
        ) : (
          <ul className="divide-y divide-white/5">
            {resumen.data!.boticas.map((b) => (
              <li key={b.sucursal_id} className="p-3 flex justify-between text-sm">
                <span>{b.sucursal}</span>
                <span className="opacity-70">{b.num_ventas} ventas · <span className="font-mono">{solesCent(b.ventas_cent)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white/5 rounded-lg border border-white/10">
        <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="font-semibold">Faltantes consolidados</span>
          <button
            onClick={async () => {
              setBajando(true);
              try {
                await descargarCsv("/consolidado/faltantes.csv", "faltantes-consolidado.csv");
              } finally {
                setBajando(false);
              }
            }}
            className="text-sm px-3 py-1.5 rounded bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-300"
          >
            {bajando ? "Generando..." : "Descargar CSV"}
          </button>
        </header>
        {faltantes.cargando ? (
          <Cargando que="faltantes" />
        ) : (faltantes.data?.items.length ?? 0) === 0 ? (
          <Vacio>Sin faltantes en la cadena.</Vacio>
        ) : (
          <ul className="divide-y divide-white/5">
            {faltantes.data!.items.map((it) => (
              <li key={it.producto.id} className="p-3">
                <div className="flex justify-between">
                  <span className="font-medium truncate pr-2">{it.producto.nombre}</span>
                  <span className="text-emerald-400 font-mono shrink-0">pedir {it.sugerido_total}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs opacity-70">
                  {it.por_botica.map((b, i) => (
                    <span key={i}>
                      {b.sucursal}: {b.stock}/{b.minimo}
                      {b.quiebres_14d > 0 && ` · ${b.quiebres_14d}q`}
                      {" → "}
                      <b>{b.sugerido}</b>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
