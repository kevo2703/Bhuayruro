import { getServerClient } from "@/lib/supabase/server";
import type { Sucursal } from "@huayruro/db";

export default async function SucursalesPage() {
  const supabase = await getServerClient();
  const { data: sucursales } = await supabase
    .from("sucursal")
    .select("*")
    .is("deleted_at", null)
    .order("nombre")
    .returns<Sucursal[]>();

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Sucursales</h1>
        <p className="text-sm opacity-60 mt-1">
          Solo super_admin ve todas. admin_sucursal ve la propia.
        </p>
      </header>

      <div className="bg-white/5 rounded-lg divide-y divide-white/5">
        {(sucursales ?? []).map((s) => (
          <div key={s.id} className="p-4 flex justify-between">
            <div>
              <p className="font-medium">{s.nombre}</p>
              <p className="text-xs opacity-60 mt-0.5">{s.direccion ?? "—"}</p>
            </div>
            <div className="text-right text-xs opacity-60">
              <p>{s.zona_horaria}</p>
              <p>{s.activa ? "✓ activa" : "inactiva"}</p>
            </div>
          </div>
        ))}
        {(sucursales ?? []).length === 0 && (
          <p className="p-6 opacity-60 text-center text-sm">No tenés sucursales visibles.</p>
        )}
      </div>
    </div>
  );
}
