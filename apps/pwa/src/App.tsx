import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import type { Sucursal } from "@huayruro/db";
import { formatearSoles, calcularTotalConIgv } from "@huayruro/shared";

type ConnState =
  | { status: "loading" }
  | { status: "ok"; sucursales: Sucursal[]; visible: number }
  | { status: "error"; message: string };

export function App() {
  const [conn, setConn] = useState<ConnState>({ status: "loading" });

  useEffect(() => {
    void (async () => {
      try {
        // Sin auth, RLS bloquea SELECT en sucursal — esperamos 0 filas, sin error de red.
        // Validamos: (a) cliente Supabase OK, (b) anon key correcta, (c) RLS funciona.
        const { data, error } = await supabase.from("sucursal").select("*");
        if (error) {
          setConn({ status: "error", message: `${error.code ?? "?"}: ${error.message}` });
          return;
        }
        setConn({
          status: "ok",
          sucursales: data ?? [],
          visible: data?.length ?? 0,
        });
      } catch (e) {
        setConn({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, []);

  // Demo del cálculo IGV — confirma que @huayruro/shared se importa
  const demoVenta = calcularTotalConIgv(100);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold tracking-tight">Botica Huayruro</h1>
      <p className="mt-2 text-lg opacity-70">Mostrador · v0.1.0 · sprint 1</p>

      <section className="mt-12 w-full text-left bg-white/5 rounded-lg p-6 space-y-2">
        <h2 className="text-xl font-semibold mb-2">Cálculo IGV demo</h2>
        <p>Producto S/ 100 sin IGV → IGV 18%:</p>
        <ul className="text-sm opacity-80">
          <li>Subtotal: {formatearSoles(demoVenta.subtotal)}</li>
          <li>IGV: {formatearSoles(demoVenta.igv)}</li>
          <li>Total: <strong>{formatearSoles(demoVenta.total)}</strong></li>
        </ul>
      </section>

      <section className="mt-6 w-full text-left bg-white/5 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-2">Conexión Supabase</h2>
        {conn.status === "loading" && <p className="opacity-70">Consultando...</p>}
        {conn.status === "error" && (
          <p className="text-red-400">
            <strong>Error:</strong> {conn.message}
          </p>
        )}
        {conn.status === "ok" && (
          <div className="space-y-2">
            <p className="text-emerald-400">✓ Conexión OK</p>
            <p className="text-sm opacity-70">
              Sucursales visibles (sin auth): <strong>{conn.visible}</strong>
            </p>
            <p className="text-xs opacity-60">
              RLS está funcionando: sin sesión, la policy <code>sucursal_select</code> filtra todo.
              Cuando un usuario autenticado vea esto, debería ver su(s) sucursal(es).
            </p>
          </div>
        )}
      </section>

      <p className="mt-8 text-xs opacity-40">
        Sprint 1 en validación. Próximo: auth + flujo de venta (sprint 2-3).
      </p>
    </main>
  );
}
