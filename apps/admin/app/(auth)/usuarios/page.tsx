import { getServerClient } from "@/lib/supabase/server";

type UsuarioRow = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  sucursal: { nombre: string } | { nombre: string }[] | null;
};

export default async function UsuariosPage() {
  const supabase = await getServerClient();

  const { data: usuarios, error } = await supabase
    .from("usuario_perfil")
    .select("id, nombre, email, rol, activo, sucursal:sucursal_id(nombre)")
    .eq("activo", true)
    .order("nombre")
    .returns<UsuarioRow[]>();

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Usuarios</h1>
        <p className="text-sm opacity-60 mt-1">
          Para crear un usuario nuevo: invitar desde Supabase Dashboard → Authentication → Users +
          insertar fila en usuario_perfil. Próximo sprint: UI propia.
        </p>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-300 mb-4">
          {error.message}
        </div>
      )}

      <div className="bg-white/5 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Sucursal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {(usuarios ?? []).map((u) => {
              const sucursalNombre = Array.isArray(u.sucursal)
                ? (u.sucursal[0]?.nombre ?? "—")
                : (u.sucursal?.nombre ?? "—");
              return (
                <tr key={u.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">{u.nombre}</td>
                  <td className="px-4 py-3 opacity-80">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        u.rol === "super_admin"
                          ? "bg-amber-500/20 text-amber-300"
                          : u.rol === "admin_sucursal"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-white/10"
                      }`}
                    >
                      {u.rol}
                    </span>
                  </td>
                  <td className="px-4 py-3 opacity-80">{sucursalNombre}</td>
                </tr>
              );
            })}
            {(usuarios ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 opacity-60 text-center">
                  No hay usuarios todavía. Creá uno desde Supabase Dashboard + corré el script
                  scripts/seed-usuarios.sql.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
