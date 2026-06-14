import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerClient } from "@/lib/supabase/server";
import { formatearSoles } from "@huayruro/shared";
import { EditarProductoForm } from "./EditarProductoForm";

type ProductoRow = {
  id: string;
  tenant_id: string;
  nombre: string;
  presentacion: string | null;
  laboratorio: string | null;
  principio_activo: string | null;
  categoria: string | null;
  requiere_receta: boolean;
  activo: boolean;
  created_at: string;
  updated_at: string;
  codigo_barras: { id: string; gtin: string }[];
  precio_local: {
    id: string;
    precio_total: number;
    precio_compra: number | null;
    sucursal: { nombre: string } | { nombre: string }[] | null;
  }[];
};

export default async function EditarProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerClient();

  const { data: producto } = await supabase
    .from("producto_catalogo")
    .select(
      "id, tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta, activo, created_at, updated_at, codigo_barras(id, gtin), precio_local!inner(id, precio_total, precio_compra, sucursal:sucursal_id(nombre))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .is("precio_local.vigente_hasta", null)
    .maybeSingle()
    .returns<ProductoRow>();

  if (!producto) {
    notFound();
  }

  const precioVigente = producto.precio_local[0]?.precio_total ?? null;

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <Link href="/catalogo" className="text-sm opacity-60 hover:opacity-100">
          ← Volver al catálogo
        </Link>
        <h1 className="text-3xl font-bold mt-2">{producto.nombre}</h1>
        <p className="text-sm opacity-60 mt-1">
          ID {producto.id.slice(0, 8)}... · Creado{" "}
          {new Date(producto.created_at).toLocaleDateString("es-PE")}
        </p>
      </header>

      <section className="mb-6 bg-white/5 rounded-lg p-4">
        <h2 className="text-sm font-semibold opacity-70 mb-3">Precios vigentes por sucursal</h2>
        <div className="space-y-1.5">
          {producto.precio_local.map((p) => {
            const sucNombre = Array.isArray(p.sucursal)
              ? (p.sucursal[0]?.nombre ?? "—")
              : (p.sucursal?.nombre ?? "—");
            return (
              <div key={p.id} className="flex justify-between text-sm">
                <span className="opacity-80">{sucNombre}</span>
                <span className="font-mono">
                  {formatearSoles(p.precio_total)}
                  {p.precio_compra != null && (
                    <span className="ml-2 text-xs opacity-50">
                      (compra {formatearSoles(p.precio_compra)})
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {producto.precio_local.length === 0 && (
            <p className="text-sm opacity-60">Sin precios vigentes visibles.</p>
          )}
        </div>
      </section>

      <EditarProductoForm
        producto={{
          id: producto.id,
          nombre: producto.nombre,
          presentacion: producto.presentacion ?? "",
          laboratorio: producto.laboratorio ?? "",
          principio_activo: producto.principio_activo ?? "",
          categoria: producto.categoria ?? "",
          requiere_receta: producto.requiere_receta,
          activo: producto.activo,
        }}
        precioActualTotal={precioVigente}
        gtin={producto.codigo_barras[0]?.gtin ?? null}
      />
    </div>
  );
}
