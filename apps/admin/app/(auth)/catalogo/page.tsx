import Link from "next/link";
import { getServerClient } from "@/lib/supabase/server";
import { formatearSoles } from "@huayruro/shared";

type ProductoRow = {
  id: string;
  nombre: string;
  presentacion: string | null;
  laboratorio: string | null;
  categoria: string | null;
  requiere_receta: boolean;
  activo: boolean;
  codigo_barras: { gtin: string }[];
  precio_local: { precio_total: number; sucursal_id: string }[];
};

export default async function CatalogoPage() {
  const supabase = await getServerClient();

  const { data, error } = await supabase
    .from("producto_catalogo")
    .select(
      "id, nombre, presentacion, laboratorio, categoria, requiere_receta, activo, codigo_barras(gtin), precio_local(precio_total, sucursal_id)",
    )
    .is("deleted_at", null)
    .is("precio_local.vigente_hasta", null)
    .order("nombre")
    .returns<ProductoRow[]>();

  return (
    <div>
      <header className="mb-6 flex justify-between items-baseline">
        <div>
          <h1 className="text-3xl font-bold">Catálogo</h1>
          <p className="text-sm opacity-60 mt-1">
            Productos visibles según tu rol y sucursal {data ? `· ${data.length}` : ""}
          </p>
        </div>
        <Link
          href="/catalogo/nuevo"
          className="px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-medium"
        >
          + Nuevo producto
        </Link>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-300 mb-4">
          Error: {error.message}
        </div>
      )}

      {data && data.length === 0 && (
        <div className="bg-white/5 rounded-lg p-8 text-center">
          <p className="opacity-60">Catálogo vacío todavía.</p>
          <Link href="/catalogo/nuevo" className="text-emerald-400 underline mt-2 inline-block">
            Crear primer producto
          </Link>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="bg-white/5 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 font-medium">Presentación</th>
                <th className="px-4 py-3 font-medium">GTIN</th>
                <th className="px-4 py-3 font-medium text-right">Precio</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.map((p) => {
                const gtin = p.codigo_barras[0]?.gtin ?? "—";
                const precio = p.precio_local[0]?.precio_total ?? null;
                return (
                  <tr key={p.id} className="hover:bg-white/5 transition">
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.nombre}</p>
                      <p className="text-xs opacity-50">
                        {p.laboratorio ?? "—"} · {p.categoria ?? "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3 opacity-70">{p.presentacion ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs opacity-70">{gtin}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {precio != null ? formatearSoles(precio) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {p.requiere_receta && (
                        <span className="px-2 py-0.5 text-xs rounded bg-amber-500/20 text-amber-300 mr-1">
                          receta
                        </span>
                      )}
                      {p.activo ? (
                        <span className="px-2 py-0.5 text-xs rounded bg-emerald-500/20 text-emerald-300">
                          activo
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs rounded bg-white/10">inactivo</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/catalogo/${p.id}`}
                        className="text-emerald-400 hover:underline text-xs"
                      >
                        Editar
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
