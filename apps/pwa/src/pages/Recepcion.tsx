import { useState } from "react";
import { uuidv7 } from "@huayruro/shared";
import { mutar } from "../lib/useApi";
import { ApiError } from "../lib/api";
import { SelectorProducto } from "../components/SelectorProducto";
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
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const setItem = (i: number, campo: keyof ItemForm, valor: string) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));

  const listos = items.filter((it) => it.producto_id && it.numero_lote.trim() && /^\d{4}-\d{2}-\d{2}$/.test(it.fecha_vencimiento) && Number(it.cantidad) >= 1);

  async function registrar() {
    if (listos.length === 0) {
      setMsg({ ok: false, texto: "Completa al menos un ítem (producto, lote, vencimiento y cantidad)." });
      return;
    }
    setEnviando(true);
    setMsg(null);
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
      setMsg({ ok: true, texto: `Recepción registrada (${listos.length} ítem(s)).` });
      setProveedor("");
      setObservaciones("");
      setItems([vacio()]);
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full space-y-4 overflow-y-auto">
      <h1 className="text-xl font-bold">Recepción de mercadería</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Proveedor (opcional)" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none focus:border-emerald-400" />
        <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Observaciones (opcional)" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none focus:border-emerald-400" />
      </div>

      <div className="space-y-3">
        {items.map((it, i) => (
          <div key={i} className="bg-white/5 rounded-lg border border-white/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-70">Ítem {i + 1}</span>
              {items.length > 1 && (
                <button onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} className="text-xs underline opacity-60">
                  quitar
                </button>
              )}
            </div>
            {it.producto_id ? (
              <div className="flex items-center justify-between bg-white/5 rounded p-2">
                <span className="font-medium truncate">{it.nombre}</span>
                <button onClick={() => setItem(i, "producto_id", "")} className="text-xs underline opacity-60">
                  cambiar
                </button>
              </div>
            ) : (
              <SelectorProducto onSelect={(p) => setItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, producto_id: p.id, nombre: p.nombre } : x)))} />
            )}
            <div className="grid grid-cols-3 gap-2">
              <input value={it.numero_lote} onChange={(e) => setItem(i, "numero_lote", e.target.value)} placeholder="N° lote" className="px-2 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
              <input type="date" value={it.fecha_vencimiento} onChange={(e) => setItem(i, "fecha_vencimiento", e.target.value)} className="px-2 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
              <input type="number" min={1} value={it.cantidad} onChange={(e) => setItem(i, "cantidad", e.target.value)} placeholder="Cantidad (u. base)" className="px-2 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => setItems((prev) => [...prev, vacio()])} className="text-sm px-3 py-2 rounded bg-white/5 border border-white/10 hover:bg-white/10">
          + Agregar ítem
        </button>
        <button onClick={() => void registrar()} disabled={enviando} className="text-sm px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-40">
          {enviando ? "Registrando..." : `Registrar recepción (${listos.length})`}
        </button>
      </div>

      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.texto}</p>}
    </div>
  );
}
