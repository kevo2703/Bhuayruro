import { useApi } from "../../lib/useApi";
import { Cargando, ErrorMsg, Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

type Fila = { producto_id: string; nombre: string; stock: number; minimo: number; quiebres_14d: number; sugerido: number };

// Faltantes de MI botica (§8): stock<=mínimo O quiebres en 14 días, con cantidad sugerida.
export function Faltantes(_props: { sesion: SesionActiva }) {
  const { data, cargando, error, recargar } = useApi<{ faltantes: Fila[] }>("/faltantes");

  return (
    <div className="max-w-2xl mx-auto w-full space-y-4 overflow-y-auto">
      <h1 className="text-xl font-bold">Faltantes de mi botica</h1>
      <section className="bg-white/5 rounded-lg border border-white/10">
        {cargando ? (
          <Cargando que="faltantes" />
        ) : error ? (
          <ErrorMsg msg={error} onReintentar={recargar} />
        ) : (data?.faltantes.length ?? 0) === 0 ? (
          <Vacio>Sin faltantes. Todo por encima del mínimo.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs opacity-60 border-b border-white/10">
              <tr>
                <th className="text-left p-3">Producto</th>
                <th className="text-right p-3">Stock</th>
                <th className="text-right p-3">Mín.</th>
                <th className="text-right p-3">Quiebres 14d</th>
                <th className="text-right p-3">Sugerido</th>
              </tr>
            </thead>
            <tbody>
              {data!.faltantes.map((f) => (
                <tr key={f.producto_id} className="border-b border-white/5">
                  <td className="p-3 truncate max-w-[40vw]">{f.nombre}</td>
                  <td className={`p-3 text-right font-mono ${f.stock <= f.minimo ? "text-red-400" : ""}`}>{f.stock}</td>
                  <td className="p-3 text-right font-mono opacity-70">{f.minimo}</td>
                  <td className="p-3 text-right font-mono opacity-70">{f.quiebres_14d}</td>
                  <td className="p-3 text-right font-mono text-emerald-400">{f.sugerido}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
