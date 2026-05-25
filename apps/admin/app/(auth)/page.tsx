import { getServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@huayruro/db";

type PerfilRow = {
  nombre: string;
  rol: UserRole;
  sucursal: { nombre: string } | { nombre: string }[] | null;
};

export default async function DashboardPage() {
  const supabase = await getServerClient();

  // RLS filtra automáticamente por tenant del usuario autenticado
  const [{ count: sucursalesCount }, { count: productosCount }, { data: perfil }] =
    await Promise.all([
      supabase.from("sucursal").select("*", { count: "exact", head: true }).is("deleted_at", null),
      supabase
        .from("producto_catalogo")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null),
      supabase
        .from("usuario_perfil")
        .select("nombre, rol, sucursal:sucursal_id(nombre)")
        .maybeSingle()
        .returns<PerfilRow>(),
    ]);

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        {perfil && (
          <p className="mt-1 opacity-70">
            Hola <strong>{perfil.nombre}</strong>
            <span className="ml-2 px-2 py-0.5 text-xs rounded bg-emerald-500/20 text-emerald-300">
              {perfil.rol}
            </span>
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white/5 rounded-lg p-4">
          <p className="text-sm opacity-60">Sucursales visibles</p>
          <p className="text-3xl font-bold mt-1">{sucursalesCount ?? 0}</p>
        </div>

        <div className="bg-white/5 rounded-lg p-4">
          <p className="text-sm opacity-60">Productos en catálogo</p>
          <p className="text-3xl font-bold mt-1">{productosCount ?? 0}</p>
        </div>

        <div className="bg-white/5 rounded-lg p-4">
          <p className="text-sm opacity-60">Sprint actual</p>
          <p className="text-3xl font-bold mt-1">2</p>
          <p className="text-xs opacity-50 mt-1">auth + catálogo + multi-tenant</p>
        </div>
      </div>

      <section className="mt-8 bg-white/5 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-2">Próximos pasos</h2>
        <ul className="text-sm opacity-80 space-y-1">
          <li>• CRUD de catálogo en /catalogo (lista + crear + editar)</li>
          <li>• Tests RLS visuales: login con cada rol y validar aislamiento</li>
          <li>• Sprint 3: flujo de venta core en la PWA</li>
        </ul>
      </section>
    </div>
  );
}
