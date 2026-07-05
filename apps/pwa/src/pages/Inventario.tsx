import { useState } from "react";
import { useApi, mutar } from "../lib/useApi";
import { ahoraFecha } from "../lib/fecha-ui";
import { Cargando, ErrorMsg, Vacio } from "../components/Estados";
import type { SesionActiva } from "../lib/tipos";

type Fila = { id: string; producto_id: string; nombre: string; stock_unidades: number; stock_minimo: number; updated_at: string };
type Lote = { id: string; numero_lote: string; fecha_vencimiento: string; unidades: number; nombre: string };

// Inventario de MI sucursal (§8): stock/mínimo, ajuste por conteo (admin) y lotes por vencer.
export function Inventario({ sesion }: { sesion: SesionActiva }) {
  const [bajo, setBajo] = useState(false);
  const puedeEditar = sesion.usuario.rol === "admin_sucursal" || sesion.usuario.rol === "super_admin";
  const inv = useApi<{ inventario: Fila[] }>(`/inventario${bajo ? "?bajo_minimo=1" : ""}`, [bajo]);
  const lotes = useApi<{ lotes: Lote[] }>(`/inventario/lotes?vence_antes=${ahoraFecha(90)}`);
  const [editando, setEditando] = useState<{ id: string; producto_id: string; nombre: string; tipo: "conteo" | "minimo" } | null>(null);

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Inventario</h1>
        <label className="text-sm flex items-center gap-2 opacity-80">
          <input type="checkbox" checked={bajo} onChange={(e) => setBajo(e.target.checked)} /> Solo bajo mínimo
        </label>
      </div>

      <section className="bg-white/5 rounded-lg border border-white/10">
        {inv.cargando ? (
          <Cargando que="inventario" />
        ) : inv.error ? (
          <ErrorMsg msg={inv.error} onReintentar={inv.recargar} />
        ) : (inv.data?.inventario.length ?? 0) === 0 ? (
          <Vacio>Sin productos en inventario.</Vacio>
        ) : (
          <ul className="divide-y divide-white/5">
            {inv.data!.inventario.map((f) => (
              <li key={f.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{f.nombre}</p>
                  <p className="text-xs opacity-60">
                    mínimo {f.stock_minimo}
                    {f.stock_unidades <= f.stock_minimo && <span className="ml-2 text-red-400">bajo</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`font-mono ${f.stock_unidades <= f.stock_minimo ? "text-red-400" : ""}`}>{f.stock_unidades}</span>
                  {puedeEditar && (
                    <div className="flex gap-1">
                      <button onClick={() => setEditando({ id: f.id, producto_id: f.producto_id, nombre: f.nombre, tipo: "conteo" })} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                        conteo
                      </button>
                      <button onClick={() => setEditando({ id: f.id, producto_id: f.producto_id, nombre: f.nombre, tipo: "minimo" })} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                        mínimo
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white/5 rounded-lg border border-white/10">
        <header className="px-4 py-3 border-b border-white/10 font-semibold">Lotes por vencer (90 días)</header>
        {lotes.cargando ? (
          <Cargando que="lotes" />
        ) : (lotes.data?.lotes.length ?? 0) === 0 ? (
          <Vacio>Ningún lote vence en los próximos 90 días.</Vacio>
        ) : (
          <ul className="divide-y divide-white/5">
            {lotes.data!.lotes.map((l) => (
              <li key={l.id} className="p-3 flex items-center justify-between text-sm">
                <span className="truncate">{l.nombre} · lote {l.numero_lote}</span>
                <span className="opacity-70 shrink-0">{l.fecha_vencimiento} · {l.unidades} u.</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editando && (
        <EditarInventario
          {...editando}
          onCerrar={() => setEditando(null)}
          onListo={() => {
            setEditando(null);
            inv.recargar();
          }}
        />
      )}
    </div>
  );
}

function EditarInventario({ id, producto_id, nombre, tipo, onCerrar, onListo }: { id: string; producto_id: string; nombre: string; tipo: "conteo" | "minimo"; onCerrar: () => void; onListo: () => void }) {
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0) {
      setError("Cantidad entera ≥ 0");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      if (tipo === "conteo") {
        await mutar("/inventario/ajustes", { method: "POST", body: { inventario_id: id, cantidad: n, motivo: "conteo físico" } });
      } else {
        await mutar(`/inventario/${producto_id}/minimo`, { method: "PATCH", body: { stock_minimo: n } });
      }
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-white/10 rounded-lg p-6">
        <h2 className="font-bold">{tipo === "conteo" ? "Ajustar stock (conteo)" : "Fijar stock mínimo"}</h2>
        <p className="text-sm opacity-60 truncate mt-1">{nombre}</p>
        <input
          type="number"
          min={0}
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={tipo === "conteo" ? "Cantidad real contada" : "Nuevo mínimo"}
          className="mt-4 w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none focus:border-emerald-400"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex gap-3">
          <button onClick={onCerrar} disabled={enviando} className="flex-1 py-2 rounded hover:bg-white/5 text-sm">
            Cancelar
          </button>
          <button onClick={() => void guardar()} disabled={enviando} className="flex-1 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-40">
            {enviando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
