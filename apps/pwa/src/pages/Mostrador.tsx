import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ClienteModal } from "../components/ClienteModal";
import { PanelSeguimiento } from "../components/PanelSeguimiento";
import { TarjetaSugerencia } from "../components/TarjetaSugerencia";
import { TratamientoModal, type ItemVendido } from "../components/TratamientoModal";
import { useSenales } from "../lib/useSenales";
import { useSeguimientoMostrador } from "../lib/useSeguimiento";
import { useSugerencia } from "../lib/useSugerencia";
import { nombreCorto, type Cliente } from "../lib/clientes";
import type { MetodoPago, ProductoVenta, SesionActiva } from "../lib/tipos";

type ToastState =
  | { kind: "none" }
  | { kind: "ok"; message: string }
  | { kind: "warn"; message: string }
  | { kind: "error"; message: string };

// Lo que queda pendiente de registrar apenas se cobró: el cliente al que se le vendió y qué se llevó.
type SeguimientoPorRegistrar = { clienteId: string; nombre: string; items: ItemVendido[]; clientUuid: string };

export function Mostrador({ sesion }: { sesion: SesionActiva }) {
  const catalogo = useCatalogoVenta(dbLocal);
  const carrito = useCarrito();
  const [showCobrar, setShowCobrar] = useState(false);
  const [showQuiebre, setShowQuiebre] = useState(false);
  const [showSenales, setShowSenales] = useState(false);
  const [showCliente, setShowCliente] = useState(false);
  const [showSeguimiento, setShowSeguimiento] = useState(false);
  const [cobrando, setCobrando] = useState(false);
  const [toast, setToast] = useState<ToastState>({ kind: "none" });
  const [ultimaGuia, setUltimaGuia] = useState<GuiaVenta | null>(null);

  // P1: cliente asignado a la venta en curso (§12 / expansión A1). Se limpia al cobrar: la siguiente
  // persona en la cola es otra. El id vive acá y NO en el carrito porque también se puede asignar sin
  // nada en el carrito (para consultar su seguimiento antes de vender).
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [clienteIdPanel, setClienteIdPanel] = useState<string | null>(null);
  const [recargaPanel, setRecargaPanel] = useState(0);
  const [porRegistrar, setPorRegistrar] = useState<SeguimientoPorRegistrar | null>(null);

  const conSucursal = !!sesion.sucursal;
  // Señales del audio (B10.2): solo si el operador tiene sucursal (el super no cobra en el mostrador).
  const { senales, confirmar: confirmarSenal, descartar: descartarSenal } = useSenales(conSucursal);
  const seguimiento = useSeguimientoMostrador(conSucursal);
  // A4 (venta cruzada): motor LOCAL sobre las reglas cacheadas. Máximo UNA tarjeta por venta.
  const sugerencia = useSugerencia(conSucursal);

  const flash = useCallback((t: ToastState, ms = 2200) => {
    setToast(t);
    if (t.kind !== "none") setTimeout(() => setToast({ kind: "none" }), ms);
  }, []);

  const alError = useCallback((m: string) => flash({ kind: "error", message: m }, 3500), [flash]);

  const agregar = useCallback(
    (p: ProductoVenta) => {
      carrito.agregar(p);
      flash({ kind: "warn", message: `Agregado: ${p.nombre}` }, 1000);
      // El consejo se evalúa con el producto que ACABA de entrar; el carrito de `carrito.items`
      // todavía no lo tiene (el estado se aplica en el próximo render), así que se suma a mano para
      // que la regla no pueda sugerir algo que ya está en la venta.
      sugerencia.evaluar(
        { producto_id: p.producto_id, categoria: p.categoria, principio_activo: p.principio_activo },
        [...carrito.items.map((it) => it.producto.producto_id), p.producto_id],
        catalogo.stockPorProducto,
        catalogo.porProductoId,
      );
    },
    [carrito, flash, sugerencia, catalogo],
  );

  // Un tap la agrega al carrito (y ese producto ya no puede volver a dispararse: `yaMostrada` cerró
  // el cupo de la venta). El otro tap la descarta. Los dos se miden.
  const aceptarSugerencia = useCallback(() => {
    const p = sugerencia.viva?.producto;
    if (!p) return;
    carrito.agregar(p);
    sugerencia.responder("aceptada");
    flash({ kind: "ok", message: `Agregado: ${p.nombre}` }, 1500);
  }, [sugerencia, carrito, flash]);

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

  // Badge del panel: a cuántos ya les tocaba y cuántos cumplen HOY (lo accionable de este minuto).
  const porSeguirHoy = useMemo(() => seguimiento.pendientes.filter((p) => p.dias_de_atraso >= 0).length, [seguimiento.pendientes]);
  const cumplenHoy = useMemo(() => seguimiento.cumpleanos.filter((c) => c.dias_para === 0).length, [seguimiento.cumpleanos]);
  const avisos = porSeguirHoy + cumplenHoy;

  const asignar = useCallback((c: Cliente) => {
    setCliente(c);
    setClienteIdPanel(c.id);
    setShowCliente(false);
  }, []);

  const quitarCliente = useCallback(() => {
    setCliente(null);
    setClienteIdPanel(null);
  }, []);

  // A4: el carrito vacío = atención terminada, se haya cobrado o no. Si la persona se fue sin
  // comprar, lo mostrado y lo rechazado se manda igual — contar solo las ventas cerradas dejaría la
  // conversión inflada. Tras cobrar el buffer ya se vació, así que acá no vuelve a disparar.
  const cerrarSugerencia = sugerencia.cerrar;
  const carritoVacio = carrito.items.length === 0;
  useEffect(() => {
    if (carritoVacio) void cerrarSugerencia(null);
  }, [carritoVacio, cerrarSugerencia]);

  async function handleCobrar(metodo: MetodoPago, efectivoRecibidoCent: number | null) {
    if (!puedeVender) {
      flash({ kind: "error", message: "El super admin no cobra desde el mostrador" });
      return;
    }
    setCobrando(true);
    try {
      const clientUuid = uuidv7();
      const nowIso = new Date().toISOString();
      const itemsVendidos: ItemVendido[] = carrito.items.map((it) => ({
        producto_id: it.producto.producto_id,
        nombre: it.producto.nombre,
      }));
      const clienteVenta = cliente;
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
        // Δ2: desde cuándo se está atendiendo a esta persona (primer ítem del carrito). Sin esto el
        // espejo operativo no puede calcular el tiempo de servicio y lo reportaba siempre vacío.
        atencion_inicio: carrito.atencionInicio,
        // A1: la venta queda con nombre y apellido si se identificó al cliente. El server valida que
        // sea de ESTA botica antes de insertar (404 si no) — acá no se manda nada más.
        cliente_id: clienteVenta?.id ?? null,
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

      // A4: la atención se cierra CON el client_uuid de la venta y DESPUÉS de encolarla — la cola es
      // FIFO, así que el server ya tiene la venta cuando llegan los eventos y puede enlazar el
      // `venta_id`. Sin ese enlace la tabla de conversión no podría medir soles reales.
      await sugerencia.cerrar(clientUuid);

      flash({ kind: "ok", message: `Venta ${clientUuid.slice(-6)} · ${solesCent(guia.totalCent)}` }, 3500);
      carrito.limpiar();
      setShowCobrar(false);
      quitarCliente();

      // Con cliente identificado, el seguimiento se ofrece en el acto: es el momento en que quien
      // atiende todavía se acuerda de para quién era y qué le dijo.
      if (clienteVenta && itemsVendidos.length > 0) {
        setPorRegistrar({ clienteId: clienteVenta.id, nombre: nombreCorto(clienteVenta), items: itemsVendidos, clientUuid });
      }
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

  const panel = (
    <PanelSeguimiento
      clienteId={clienteIdPanel}
      pendientes={seguimiento.pendientes}
      cumpleanos={seguimiento.cumpleanos}
      recargaToken={recargaPanel}
      onAsignarId={(id) => {
        setClienteIdPanel(id);
        setShowSeguimiento(true);
      }}
      onQuitar={quitarCliente}
      onRegistrarSeguimiento={(id, nombre) =>
        // Sin venta recién cobrada: se ofrece lo que haya en el carrito y, si no hay nada, se escribe
        // a mano ("otra cosa"). Sirve para registrar lo que se llevó alguien que ya pasó por caja.
        setPorRegistrar({
          clienteId: id,
          nombre,
          items: carrito.items.map((it) => ({ producto_id: it.producto.producto_id, nombre: it.producto.nombre })),
          clientUuid: "",
        })
      }
      onCambio={seguimiento.recargar}
      onError={alError}
    />
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <p className="text-xs text-ink-3 tabular-nums">
          {catalogo.listo ? `${catalogo.total} productos en cache` : "Cargando catálogo..."}
        </p>
        <div className="flex gap-2 flex-wrap">
          {conSucursal &&
            (cliente ? (
              <span className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-[9px] bg-ok-soft border border-ok/30 text-ok font-semibold">
                👤 {nombreCorto(cliente)}
                <button onClick={quitarCliente} aria-label="Quitar cliente" className="text-ok/80 hover:text-ok">
                  ✕
                </button>
              </span>
            ) : (
              <button
                onClick={() => setShowCliente(true)}
                className="text-sm px-3 py-1.5 rounded-[9px] bg-card border border-line-input text-ink-emph hover:bg-hover-btn font-medium"
                title="Identificar al cliente de esta venta"
              >
                👤 Cliente
              </button>
            ))}
          {conSucursal && (
            <button
              onClick={() => setShowSeguimiento(true)}
              className={`xl:hidden text-sm px-3 py-1.5 rounded-[9px] font-medium border ${
                avisos > 0 ? "bg-info-soft border-info/30 text-info-ink" : "bg-card border-line-input text-ink-emph hover:bg-hover-btn"
              }`}
              title="A quién le toca seguimiento y quién cumple años"
            >
              🗓️ Seguimiento{avisos > 0 ? ` ${avisos}` : ""}
            </button>
          )}
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 flex-1 min-h-0">
        <Buscador buscar={catalogo.buscar} onAgregar={agregar} />
        <Carrito
          items={carrito.items}
          totales={carrito.totales}
          onSetCantidad={carrito.setCantidad}
          onQuitar={carrito.quitar}
          onCobrar={() => setShowCobrar(true)}
          onLimpiar={carrito.limpiar}
          cobrando={cobrando}
          sugerencia={
            sugerencia.viva && (
              <TarjetaSugerencia
                sugerencia={sugerencia.viva}
                onAgregar={aceptarSugerencia}
                onDescartar={() => sugerencia.responder("rechazada")}
              />
            )
          }
        />
        {/* Panel lateral de Seguimiento: columna propia en escritorio; en el celular se abre a pantalla
            completa desde el botón, para no robarle sitio al carrito en hora punta. */}
        {conSucursal && (
          <aside className="hidden xl:flex min-h-0 flex-col rounded-[14px] border border-line bg-card p-4">{panel}</aside>
        )}
      </div>

      {showCobrar && (
        <CobrarModal totalCent={carrito.totales.total_cent} onConfirmar={handleCobrar} onCancelar={() => setShowCobrar(false)} />
      )}
      {showCliente && <ClienteModal onAsignar={asignar} onCerrar={() => setShowCliente(false)} />}
      {showSeguimiento && conSucursal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-surface/40 backdrop-blur p-0 sm:p-4 xl:hidden">
          <div className="w-full sm:max-w-md bg-card border border-line rounded-t-[14px] sm:rounded-[14px] p-5 shadow-[0_10px_30px_rgba(36,29,26,0.25)] max-h-[85vh] flex flex-col">
            <div className="flex justify-end">
              <button onClick={() => setShowSeguimiento(false)} className="inline-flex min-h-11 items-center px-2 text-sm underline text-ink-2">
                cerrar
              </button>
            </div>
            <div className="min-h-0 flex-1">{panel}</div>
          </div>
        </div>
      )}
      {porRegistrar && (
        <TratamientoModal
          clienteId={porRegistrar.clienteId}
          clienteNombre={porRegistrar.nombre}
          items={porRegistrar.items}
          clientUuidVenta={porRegistrar.clientUuid || null}
          onListo={(m) => {
            flash({ kind: "ok", message: m }, 3000);
            setPorRegistrar(null);
            setRecargaPanel((n) => n + 1);
            seguimiento.recargar();
          }}
          onCerrar={() => setPorRegistrar(null)}
        />
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
