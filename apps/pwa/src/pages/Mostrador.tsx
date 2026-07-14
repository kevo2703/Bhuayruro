import { useCallback, useState } from "react";
import { uuidv7 } from "@huayruro/shared";
import { dbLocal } from "../lib/db-local";
import { encolar } from "../lib/cola";
import { flushAhora } from "../lib/useSyncPos";
import { useCatalogoVenta } from "../lib/useCatalogoVenta";
import { useCarrito, totalLineaCent } from "../lib/useCarrito";
import { useBarcodeScanner } from "../lib/useBarcodeScanner";
import { imprimirGuia, type GuiaVenta } from "../lib/impresora";
import { solesCent } from "../lib/money";
import { Buscador } from "../components/Buscador";
import { Carrito } from "../components/Carrito";
import { CobrarModal } from "../components/CobrarModal";
import { QuiebreModal } from "../components/QuiebreModal";
import { SenalesBandeja } from "../components/SenalesBandeja";
import { useSenales } from "../lib/useSenales";
import type { MetodoPago, ProductoVenta, SesionActiva } from "../lib/tipos";

type ToastState =
  | { kind: "none" }
  | { kind: "ok"; message: string }
  | { kind: "warn"; message: string }
  | { kind: "error"; message: string };

export function Mostrador({ sesion }: { sesion: SesionActiva }) {
  const catalogo = useCatalogoVenta(dbLocal);
  const carrito = useCarrito();
  const [showCobrar, setShowCobrar] = useState(false);
  const [showQuiebre, setShowQuiebre] = useState(false);
  const [showSenales, setShowSenales] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [toast, setToast] = useState<ToastState>({ kind: "none" });
  const [ultimaGuia, setUltimaGuia] = useState<GuiaVenta | null>(null);

  // Señales del audio (B10.2): solo si el operador tiene sucursal (el super no cobra en el mostrador).
  const { senales, confirmar: confirmarSenal, descartar: descartarSenal } = useSenales(!!sesion.sucursal);

  const flash = useCallback((t: ToastState, ms = 2200) => {
    setToast(t);
    if (t.kind !== "none") setTimeout(() => setToast({ kind: "none" }), ms);
  }, []);

  const agregar = useCallback(
    (p: ProductoVenta) => {
      carrito.agregar(p);
      flash({ kind: "warn", message: `Agregado: ${p.nombre}` }, 1000);
    },
    [carrito, flash],
  );

  // Lector de códigos de barras (HID): GTIN → producto de la cache local.
  useBarcodeScanner(
    useCallback(
      (gtin: string) => {
        const p = catalogo.porGtin(gtin);
        if (p) agregar(p);
        else flash({ kind: "warn", message: `Código ${gtin} no encontrado` });
      },
      [catalogo, agregar, flash],
    ),
  );

  const puedeVender = sesion.usuario.rol !== "super_admin"; // super_admin usa el admin, no el mostrador

  async function handleCobrar(metodo: MetodoPago, efectivoRecibidoCent: number | null) {
    if (!puedeVender) {
      flash({ kind: "error", message: "El super admin no cobra desde el mostrador" });
      return;
    }
    setCobrando(true);
    try {
      const clientUuid = uuidv7();
      const nowIso = new Date().toISOString();
      // Escribir SIEMPRE primero en la cola (§9); la UI confirma e imprime al toque desde datos locales.
      await encolar(dbLocal, "venta", {
        client_uuid: clientUuid,
        metodo_pago: metodo,
        items: carrito.items.map((it) => ({
          producto_id: it.producto.producto_id,
          presentacion_id: it.producto.presentacion_id,
          cantidad: it.cantidad,
          precio_sin_igv_unitario_dm: it.producto.precio_sin_igv_dm,
        })),
        fecha_hora_cliente: nowIso,
      });
      flushAhora();

      const guia: GuiaVenta = {
        sucursalNombre: sesion.sucursal?.nombre ?? "Botica Huayruro",
        sucursalDireccion: sesion.sucursal?.direccion ?? null,
        fechaHora: nowIso,
        clientUuid,
        items: carrito.items.map((it) => ({
          nombre: it.producto.nombre,
          presentacion: it.producto.presentacion_nombre,
          cantidad: it.cantidad,
          totalCent: totalLineaCent(it),
        })),
        subtotalSinIgvCent: carrito.totales.subtotal_sin_igv_cent,
        igvTotalCent: carrito.totales.igv_total_cent,
        totalCent: carrito.totales.total_cent,
        metodoPago: metodo,
        efectivoRecibidoCent: efectivoRecibidoCent,
        vueltoCent: efectivoRecibidoCent != null ? efectivoRecibidoCent - carrito.totales.total_cent : null,
      };
      setUltimaGuia(guia);
      void imprimirGuia(guia);

      flash({ kind: "ok", message: `Venta ${clientUuid.slice(-6)} · ${solesCent(guia.totalCent)}` }, 3500);
      carrito.limpiar();
      setShowCobrar(false);
    } catch (e) {
      flash({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setCobrando(false);
    }
  }

  // Apertura declarada del cajón sin venta (Δ3 'no_sale'): para dar vuelto / revisar. Offline vía la
  // misma cola. Alimenta el indicador EBR `cajon_sin_venta` (frecuencia por operador vs promedio).
  async function abrirCajon() {
    await encolar(dbLocal, "no_sale", { fecha_hora_cliente: new Date().toISOString() });
    flushAhora();
    flash({ kind: "ok", message: "Cajón abierto (sin venta)" }, 2500);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs text-ink-3 tabular-nums">
          {catalogo.listo ? `${catalogo.total} productos en cache` : "Cargando catálogo..."}
        </p>
        <div className="flex gap-2">
          {senales.length > 0 && (
            <button
              onClick={() => setShowSenales(true)}
              className="text-sm px-3 py-1.5 rounded-[9px] bg-info-soft border border-info/30 hover:bg-info-soft text-info-ink font-medium animate-pulse-dot"
              title="Señales detectadas por el audio del mostrador"
            >
              🎙️ {senales.length}
            </button>
          )}
          <button
            onClick={() => setShowQuiebre(true)}
            className="text-sm px-3 py-1.5 rounded-[9px] bg-warn-soft border border-warn-dot/30 hover:bg-warn-soft text-warn font-medium"
          >
            Quiebre
          </button>
          <button
            onClick={() => void abrirCajon()}
            className="text-sm px-3 py-1.5 rounded-[9px] bg-card border border-line-input text-ink-emph hover:bg-hover-btn"
            title="Registrar apertura del cajón sin una venta (dar vuelto, revisar)"
          >
            🔓 Cajón
          </button>
          <button
            onClick={() => ultimaGuia && void imprimirGuia({ ...ultimaGuia, reimpresion: true })}
            disabled={!ultimaGuia}
            className="text-sm px-3 py-1.5 rounded-[9px] bg-card border border-line-input text-ink-emph hover:bg-hover-btn disabled:opacity-40"
          >
            Reimprimir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
        <Buscador buscar={catalogo.buscar} onAgregar={agregar} />
        <Carrito
          items={carrito.items}
          totales={carrito.totales}
          onSetCantidad={carrito.setCantidad}
          onQuitar={carrito.quitar}
          onCobrar={() => setShowCobrar(true)}
          onLimpiar={carrito.limpiar}
          cobrando={cobrando}
        />
      </div>

      {showCobrar && (
        <CobrarModal totalCent={carrito.totales.total_cent} onConfirmar={handleCobrar} onCancelar={() => setShowCobrar(false)} />
      )}
      {showQuiebre && (
        <QuiebreModal
          buscar={catalogo.buscar}
          onListo={(m) => {
            flash({ kind: "ok", message: m });
            setShowQuiebre(false);
          }}
          onCancelar={() => setShowQuiebre(false)}
        />
      )}
      {showSenales && (
        <SenalesBandeja
          senales={senales}
          onConfirmar={confirmarSenal}
          onDescartar={descartarSenal}
          onListo={(m) => flash({ kind: "ok", message: m })}
          onError={(m) => flash({ kind: "error", message: m })}
          onCerrar={() => setShowSenales(false)}
        />
      )}

      {toast.kind !== "none" && <Toast state={toast} />}
    </div>
  );
}

function Toast({ state }: { state: Exclude<ToastState, { kind: "none" }> }) {
  // Conserva posición (abajo-centro) y las 3 variantes; colores migrados a tokens del contrato.
  const cls =
    state.kind === "ok"
      ? "bg-ok-soft text-ok"
      : state.kind === "warn"
        ? "bg-warn-soft text-warn"
        : "bg-accent-soft text-accent-ink";
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
      <div className={`px-4 py-3 rounded-[11px] font-medium border border-line shadow-[0_10px_30px_rgba(36,29,26,0.25)] ${cls}`}>
        {state.kind === "ok" ? "✓ " : state.kind === "error" ? "⚠ " : ""}
        {state.message}
      </div>
    </div>
  );
}
