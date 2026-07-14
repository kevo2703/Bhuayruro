import { useState } from "react";
import { uuidv7 } from "@huayruro/shared";
import { mutar } from "../lib/useApi";
import { ApiError } from "../lib/api";
import { SelectorProducto } from "../components/SelectorProducto";
import { Card, Button, Input, SectionLabel, useToast, cn } from "../components/ui";
import type { SesionActiva } from "../lib/tipos";

type ItemForm = { producto_id: string; nombre: string; numero_lote: string; fecha_vencimiento: string; cantidad: string };

const vacio = (): ItemForm => ({ producto_id: "", nombre: "", numero_lote: "", fecha_vencimiento: "", cantidad: "" });

// Recepción de mercadería (§8 POST /api/recepciones). Idempotente por client_uuid: reenviar la
// misma recepción no duplica stock (upsert de lote por número+vencimiento).
export function Recepcion(_props: { sesion: SesionActiva }) {
  const [proveedor, setProveedor] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState<ItemForm[]>([vacio()]);
  const [enviando, setEnviando] = useState(false);
  const toast = useToast();

  const setItem = (i: number, campo: keyof ItemForm, valor: string) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));

  const listos = items.filter((it) => it.producto_id && it.numero_lote.trim() && /^\d{4}-\d{2}-\d{2}$/.test(it.fecha_vencimiento) && Number(it.cantidad) >= 1);

  async function registrar() {
    if (listos.length === 0) {
      toast("Completa al menos un ítem (producto, lote, vencimiento y cantidad).");
      return;
    }
    setEnviando(true);
    try {
      await mutar("/recepciones", {
        method: "POST",
        body: {
          client_uuid: uuidv7(),
          proveedor: proveedor.trim() || null,
          observaciones: observaciones.trim() || null,
          items: listos.map((it) => ({
            producto_id: it.producto_id,
            numero_lote: it.numero_lote.trim(),
            fecha_vencimiento: it.fecha_vencimiento,
            cantidad: Number(it.cantidad),
          })),
        },
      });
      toast(`Recepción registrada (${listos.length} ítem(s)).`);
      setProveedor("");
      setObservaciones("");
      setItems([vacio()]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  // POS táctil: inputs y botones de acción con altura de toque ≥44px.
  const campo = "min-h-[44px]";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <h1 className="text-[18px] font-bold text-ink">Recepción de mercadería</h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Proveedor (opcional)" className={campo} />
        <Input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Observaciones (opcional)" className={campo} />
      </div>

      <div className="space-y-3">
        {items.map((it, i) => (
          <Card key={i} className="gap-2.5">
            <div className="flex items-center justify-between">
              <SectionLabel>Ítem {i + 1}</SectionLabel>
              {items.length > 1 && (
                <button
                  onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                  className="-mr-1 px-2 py-1.5 text-[12.5px] font-medium text-ink-3 underline transition-colors hover:text-accent-ink"
                >
                  quitar
                </button>
              )}
            </div>
            {it.producto_id ? (
              <div className="flex items-center justify-between gap-2 rounded-[9px] border border-line bg-inset p-2.5">
                <span className="truncate text-[13px] font-semibold text-ink">{it.nombre}</span>
                <button
                  onClick={() => setItem(i, "producto_id", "")}
                  className="-mr-1 shrink-0 px-2 py-1.5 text-[12.5px] font-medium text-ink-3 underline transition-colors hover:text-accent-ink"
                >
                  cambiar
                </button>
              </div>
            ) : (
              <SelectorProducto onSelect={(p) => setItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, producto_id: p.id, nombre: p.nombre } : x)))} />
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Input value={it.numero_lote} onChange={(e) => setItem(i, "numero_lote", e.target.value)} placeholder="N° lote" className={cn(campo, "col-span-2 sm:col-span-1")} />
              <Input type="date" value={it.fecha_vencimiento} onChange={(e) => setItem(i, "fecha_vencimiento", e.target.value)} className={campo} />
              <Input type="number" min={1} value={it.cantidad} onChange={(e) => setItem(i, "cantidad", e.target.value)} placeholder="Cantidad (u. base)" className={campo} />
            </div>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button variant="outline" onClick={() => setItems((prev) => [...prev, vacio()])} className={cn(campo, "justify-center")}>
          + Agregar ítem
        </Button>
        <Button variant="primary" onClick={() => void registrar()} disabled={enviando} className={cn(campo, "justify-center sm:flex-1")}>
          {enviando ? "Registrando…" : `Registrar recepción (${listos.length})`}
        </Button>
      </div>
    </div>
  );
}
