import { useCallback, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useCatalogo, useProductoByGtin, type CatalogoProducto } from "../lib/useCatalogo";
import { useCarrito } from "../lib/useCarrito";
import { useBarcodeScanner } from "../lib/useBarcodeScanner";
import { uuidv4 } from "../lib/uuid";
import { Buscador } from "../components/Buscador";
import { Carrito } from "../components/Carrito";
import { CobrarModal } from "../components/CobrarModal";
import type { MetodoPago, RegistrarVentaInput, RegistrarVentaOutput } from "@huayruro/db";

type Props = {
  session: Session;
};

type ToastState =
  | { kind: "none" }
  | { kind: "ok"; venta_id: string; total: number }
  | { kind: "warn"; message: string }
  | { kind: "error"; message: string };

export function Mostrador({ session }: Props) {
  const catalogo = useCatalogo(session);
  const carrito = useCarrito();
  const [showCobrarModal, setShowCobrarModal] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [toast, setToast] = useState<ToastState>({ kind: "none" });

  const productos = catalogo.status === "ready" ? catalogo.productos : [];
  const gtinIndex = useProductoByGtin(productos);
  const perfil = catalogo.status === "ready" ? catalogo.perfil : null;

  const agregar = useCallback(
    (p: CatalogoProducto) => {
      carrito.agregar(p);
      setToast({ kind: "warn", message: `Agregado: ${p.nombre}` });
      setTimeout(() => setToast({ kind: "none" }), 1200);
    },
    [carrito],
  );

  // Listener del lector de códigos de barras
  useBarcodeScanner(
    useCallback(
      (gtin: string) => {
        const producto = gtinIndex.get(gtin);
        if (producto) {
          agregar(producto);
        } else {
          setToast({ kind: "warn", message: `GTIN ${gtin} no encontrado` });
          setTimeout(() => setToast({ kind: "none" }), 2000);
        }
      },
      [gtinIndex, agregar],
    ),
  );

  async function handleCobrar(metodo: MetodoPago) {
    if (!perfil?.sucursal?.id) {
      setToast({ kind: "error", message: "No tenés sucursal asignada" });
      return;
    }

    setCobrando(true);
    try {
      const payload: RegistrarVentaInput = {
        client_uuid: uuidv4(),
        sucursal_id: perfil.sucursal.id,
        metodo_pago: metodo,
        items: carrito.items.map((it) => ({
          producto_id: it.producto.id,
          cantidad: it.cantidad,
          precio_sin_igv_unitario: it.producto.precio_sin_igv,
        })),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("registrar_venta", { payload });

      if (error) {
        setToast({ kind: "error", message: `Error: ${error.message}` });
        return;
      }

      const result = data as unknown as RegistrarVentaOutput;
      setToast({ kind: "ok", venta_id: result.venta_id, total: result.total });
      carrito.limpiar();
      setShowCobrarModal(false);
      setTimeout(() => setToast({ kind: "none" }), 4000);
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCobrando(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  if (catalogo.status === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="opacity-60">Cargando catálogo...</p>
      </main>
    );
  }

  if (catalogo.status === "error") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6">
        <p className="text-red-400 font-semibold">Error cargando catálogo</p>
        <p className="text-sm opacity-70 mt-1">{catalogo.message}</p>
        <button onClick={() => void handleSignOut()} className="mt-4 text-sm underline opacity-60">
          Cerrar sesión
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col p-4">
      <header className="flex justify-between items-center mb-4 px-2">
        <div>
          <h1 className="text-xl font-bold">Botica Huayruro</h1>
          <p className="text-xs opacity-60">
            {perfil?.sucursal?.nombre ?? "—"} · {perfil?.nombre ?? session.user.email}
          </p>
        </div>
        <button
          onClick={() => void handleSignOut()}
          className="text-sm opacity-60 hover:opacity-100 underline"
        >
          Salir
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
        <Buscador productos={productos} onAgregar={agregar} />
        <Carrito
          items={carrito.items}
          totales={carrito.totales}
          onSetCantidad={carrito.setCantidad}
          onQuitar={carrito.quitar}
          onCobrar={() => setShowCobrarModal(true)}
          onLimpiar={carrito.limpiar}
          cobrando={cobrando}
        />
      </div>

      {showCobrarModal && (
        <CobrarModal
          total={carrito.totales.total}
          onConfirmar={handleCobrar}
          onCancelar={() => setShowCobrarModal(false)}
        />
      )}

      {toast.kind === "ok" && (
        <Toast color="emerald">
          ✓ Venta registrada: {toast.venta_id.slice(0, 8)} · S/ {toast.total.toFixed(2)}
        </Toast>
      )}
      {toast.kind === "warn" && <Toast color="amber">{toast.message}</Toast>}
      {toast.kind === "error" && <Toast color="red">⚠ {toast.message}</Toast>}
    </main>
  );
}

function Toast({ children, color }: { children: React.ReactNode; color: "emerald" | "amber" | "red" }) {
  const bg =
    color === "emerald"
      ? "bg-emerald-500/90 text-black"
      : color === "amber"
        ? "bg-amber-500/90 text-black"
        : "bg-red-500/90 text-white";
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
      <div className={`px-4 py-3 rounded-lg font-medium shadow-xl ${bg}`}>{children}</div>
    </div>
  );
}
