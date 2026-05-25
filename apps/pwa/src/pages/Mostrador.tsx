import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { ProductoCatalogo, Sucursal, UserRole } from "@huayruro/db";
import { formatearSoles } from "@huayruro/shared";

type Perfil = {
  nombre: string;
  rol: UserRole;
  sucursal: Sucursal | null;
};

type ProductoConPrecio = ProductoCatalogo & {
  precio_total: number | null;
  gtin: string | null;
};

type DataState =
  | { status: "loading" }
  | { status: "ready"; perfil: Perfil | null; productos: ProductoConPrecio[] }
  | { status: "error"; message: string };

type Props = {
  session: Session;
};

export function Mostrador({ session }: Props) {
  const [data, setData] = useState<DataState>({ status: "loading" });

  useEffect(() => {
    void (async () => {
      try {
        // 1. Mi perfil
        type PerfilRow = {
          nombre: string;
          rol: UserRole;
          sucursal: Sucursal | Sucursal[] | null;
        };

        const { data: perfilData, error: perfilErr } = await supabase
          .from("usuario_perfil")
          .select("nombre, rol, sucursal:sucursal_id(*)")
          .eq("id", session.user.id)
          .maybeSingle()
          .returns<PerfilRow>();

        if (perfilErr) {
          setData({ status: "error", message: `Perfil: ${perfilErr.message}` });
          return;
        }

        const perfil: Perfil | null = perfilData
          ? {
              nombre: perfilData.nombre,
              rol: perfilData.rol,
              sucursal: Array.isArray(perfilData.sucursal)
                ? (perfilData.sucursal[0] ?? null)
                : perfilData.sucursal,
            }
          : null;

        // 2. Productos del tenant + precio vigente + gtin
        type ProductoRow = ProductoCatalogo & {
          precio_local: { precio_total: number; sucursal_id: string }[];
          codigo_barras: { gtin: string }[];
        };

        const { data: prodData, error: prodErr } = await supabase
          .from("producto_catalogo")
          .select("*, precio_local!inner(precio_total, sucursal_id), codigo_barras(gtin)")
          .is("deleted_at", null)
          .is("precio_local.vigente_hasta", null)
          .returns<ProductoRow[]>();

        if (prodErr) {
          setData({ status: "error", message: `Productos: ${prodErr.message}` });
          return;
        }

        const productos: ProductoConPrecio[] = (prodData ?? []).map((p) => {
          const precios = p.precio_local;
          const codigos = p.codigo_barras;
          const precio =
            perfil?.sucursal != null
              ? (precios.find((pr) => pr.sucursal_id === perfil.sucursal!.id)?.precio_total ?? null)
              : (precios[0]?.precio_total ?? null);
          return {
            ...p,
            precio_total: precio,
            gtin: codigos[0]?.gtin ?? null,
          };
        });

        setData({ status: "ready", perfil, productos });
      } catch (e) {
        setData({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [session.user.id]);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <main className="min-h-screen p-6 max-w-3xl mx-auto">
      <header className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold">Botica Huayruro</h1>
          <p className="text-sm opacity-60">Mostrador · v0.1.0 · sprint 2</p>
        </div>
        <button
          onClick={() => void handleSignOut()}
          className="text-sm opacity-60 hover:opacity-100 underline"
        >
          Cerrar sesión
        </button>
      </header>

      {data.status === "loading" && <p className="opacity-60">Cargando...</p>}

      {data.status === "error" && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-300">
          <p className="font-semibold">Error</p>
          <p className="text-sm mt-1">{data.message}</p>
        </div>
      )}

      {data.status === "ready" && (
        <>
          <section className="bg-white/5 rounded-lg p-4 mb-6">
            <p className="text-sm opacity-70">Sesión activa</p>
            <p className="text-lg">
              <strong>{data.perfil?.nombre ?? session.user.email}</strong>
              {data.perfil?.rol && (
                <span className="ml-2 px-2 py-0.5 text-xs rounded bg-emerald-500/20 text-emerald-300">
                  {data.perfil.rol}
                </span>
              )}
            </p>
            {data.perfil?.sucursal && (
              <p className="text-sm opacity-70 mt-1">Sucursal: {data.perfil.sucursal.nombre}</p>
            )}
          </section>

          <section className="bg-white/5 rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-3">
              Catálogo visible <span className="opacity-50 text-sm">({data.productos.length})</span>
            </h2>
            {data.productos.length === 0 ? (
              <p className="text-sm opacity-60">
                No ves ningún producto. Posibles razones: RLS está filtrando o aún no se cargó el
                catálogo (sprint 2 día 1).
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {data.productos.map((p) => (
                  <li key={p.id} className="py-3 flex justify-between items-baseline">
                    <div>
                      <p className="font-medium">{p.nombre}</p>
                      <p className="text-xs opacity-60">
                        {p.presentacion ?? "—"} · {p.laboratorio ?? "—"}{" "}
                        {p.gtin && <span className="opacity-50">· {p.gtin}</span>}
                      </p>
                    </div>
                    <p className="text-right font-mono">
                      {p.precio_total != null ? formatearSoles(p.precio_total) : "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
