import { useEffect, useMemo, useState } from "react";
import { useApi, mutar, descargarCsv } from "../../lib/useApi";
import { solesCent } from "../../lib/money";
import { Cargando, Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

// Motor del pedido (B8.4): faltantes → editar → comparar combos (1–2 proveedores) → guardar → CSV.
// La comparación por unidad base, la bonificación y la consolidación exacta las resuelve el server.

type Necesidad = { producto_id: string; nombre: string; unidades_base: number };
type Renglon = { producto_id: string; producto_nombre?: string; nombre?: string; unidades_base: number; unidades_prov: number; precio_cent: number; venc_corto?: number };
type ProvEnCombo = { id: string; nombre: string; monto_minimo_cent: number; flete_cent: number; subtotal_cent: number; cumple_minimo: boolean; faltan_minimo_cent: number; renglones: Renglon[] };
type Combo = { proveedor_ids: string[]; proveedores: ProvEnCombo[]; cubiertos: number; sin_cubrir: { producto_id: string; nombre: string }[]; cobertura: number; total_cent: number; valido: boolean; delta_cent: number };
type Comparacion = { top3: Combo[]; sin_oferta: { producto_id: string; nombre: string }[]; proveedores_evaluados: number; venc_corto_disponibles: { producto_id: string; nombre: string }[] };

export function Pedido({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const sucursales = useApi<{ sucursales: { id: string; nombre: string }[] }>(esSuper ? "/sucursales" : null);
  const [sucId, setSucId] = useState<string | null>(null);
  useEffect(() => {
    if (esSuper && sucId === null && sucursales.data?.sucursales.length) setSucId(sucursales.data.sucursales[0]!.id);
  }, [esSuper, sucId, sucursales.data]);

  const q = esSuper ? (sucId ? `?sucursal_id=${sucId}` : null) : "";
  const base = useApi<{ necesidades: Necesidad[] }>(q === null ? null : `/pedidos/base${q}`, [q]);

  const [items, setItems] = useState<Necesidad[]>([]);
  useEffect(() => {
    if (base.data) setItems(base.data.necesidades);
  }, [base.data]);

  const [aceptar, setAceptar] = useState<Set<string>>(new Set());
  const [comp, setComp] = useState<Comparacion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<{ id: string; proveedores: { id: string; nombre: string }[] } | null>(null);

  const necesidadesValidas = useMemo(() => items.filter((i) => i.unidades_base > 0), [items]);

  async function comparar(aceptarSet = aceptar) {
    setOcupado(true);
    setError(null);
    setGuardado(null);
    try {
      const r = await mutar<Comparacion>(`/pedidos/comparar`, { method: "POST", body: { items: necesidadesValidas, aceptar_venc_corto: [...aceptarSet] } });
      setComp(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function guardar(combo: Combo) {
    setOcupado(true);
    setError(null);
    try {
      const sufijo = esSuper && sucId ? `?sucursal_id=${sucId}` : "";
      const r = await mutar<{ id: string }>(`/pedidos${sufijo}`, {
        method: "POST",
        body: { items: necesidadesValidas, aceptar_venc_corto: [...aceptar], proveedor_ids: combo.proveedor_ids },
      });
      setGuardado({ id: r.id, proveedores: combo.proveedores.map((p) => ({ id: p.id, nombre: p.nombre })) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  function alternarAceptar(pid: string) {
    const s = new Set(aceptar);
    if (s.has(pid)) s.delete(pid);
    else s.add(pid);
    setAceptar(s);
    void comparar(s);
  }

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">Armar pedido</h1>
        <p className="text-sm opacity-60 mt-1">Parte de tus faltantes, compara tus droguerías (por unidad, con bonificación y flete) y arma la orden más barata en 1–2 proveedores.</p>
      </div>

      {esSuper && (
        <select value={sucId ?? ""} onChange={(e) => setSucId(e.target.value)} className="px-3 py-2 rounded bg-white/5 border border-white/10 text-sm">
          {sucursales.data?.sucursales.map((s) => (
            <option key={s.id} value={s.id} className="bg-neutral-800">{s.nombre}</option>
          ))}
        </select>
      )}

      <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
        <h2 className="font-semibold text-sm">Necesidades (editable)</h2>
        {base.cargando ? (
          <Cargando que="faltantes" />
        ) : items.length === 0 ? (
          <Vacio>Sin faltantes. Ajusta los mínimos en Inventario o agrega productos.</Vacio>
        ) : (
          <ul className="text-sm divide-y divide-white/5">
            {items.map((it, i) => (
              <li key={it.producto_id} className="py-1.5 flex items-center justify-between gap-2">
                <span className="truncate max-w-[55vw]">{it.nombre}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    min={0}
                    value={it.unidades_base}
                    onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, unidades_base: Math.max(0, Number(e.target.value) || 0) } : x)))}
                    className="w-20 px-2 py-1 rounded bg-white/5 border border-white/10 text-sm text-right font-mono"
                  />
                  <span className="text-xs opacity-50">u.</span>
                  <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="text-xs text-red-300/70 hover:text-red-300">✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <AgregarNecesidad yaEn={new Set(items.map((i) => i.producto_id))} onAgregar={(n) => setItems((xs) => [...xs, n])} />
        <button onClick={() => void comparar()} disabled={ocupado || necesidadesValidas.length === 0} className="w-full mt-2 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40">
          {ocupado ? "Comparando..." : `Comparar droguerías (${necesidadesValidas.length} producto/s)`}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {comp && (
        <section className="space-y-3">
          {comp.venc_corto_disponibles.length > 0 && (
            <div className="bg-amber-500/10 rounded-lg border border-amber-500/30 p-3 text-sm space-y-1">
              <p className="font-medium text-amber-300">Ofertas de vencimiento corto (no se eligen solas):</p>
              {comp.venc_corto_disponibles.map((v) => (
                <label key={v.producto_id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={aceptar.has(v.producto_id)} onChange={() => alternarAceptar(v.producto_id)} />
                  aceptar venc. corto de <b>{v.nombre}</b>
                </label>
              ))}
            </div>
          )}

          {comp.sin_oferta.length > 0 && (
            <p className="text-xs text-amber-400">Sin oferta en ninguna droguería: {comp.sin_oferta.map((s) => s.nombre).join(", ")}. (Cárgalas o matchea sus listas.)</p>
          )}

          {comp.top3.length === 0 ? (
            <Vacio>Ninguna droguería con listas matcheadas cubre estos productos. Ve a Proveedores → Matchear.</Vacio>
          ) : (
            <>
              <h2 className="font-semibold text-sm">Mejores combos ({comp.top3.length})</h2>
              {comp.top3.map((combo, idx) => (
                <ComboCard key={combo.proveedor_ids.join()} combo={combo} idx={idx} onGuardar={() => void guardar(combo)} ocupado={ocupado} />
              ))}
            </>
          )}
        </section>
      )}

      {guardado && (
        <section className="bg-emerald-500/10 rounded-lg border border-emerald-500/30 p-4 space-y-2 text-sm">
          <p className="font-semibold text-emerald-300">✅ Pedido guardado. Descarga la orden de cada droguería:</p>
          <div className="flex flex-wrap gap-2">
            {guardado.proveedores.map((p) => (
              <button
                key={p.id}
                onClick={() => void descargarCsv(`/pedidos/${guardado.id}/csv?proveedor_id=${p.id}`, `pedido-${p.nombre.replace(/\s+/g, "-").toLowerCase()}.csv`)}
                className="text-xs px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-medium"
              >
                📄 CSV {p.nombre}
              </button>
            ))}
          </div>
          <p className="text-xs opacity-60">El envío a la droguería (WhatsApp/llamada) lo haces tú con ese archivo.</p>
        </section>
      )}
    </div>
  );
}

function AgregarNecesidad({ yaEn, onAgregar }: { yaEn: Set<string>; onAgregar: (n: Necesidad) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const busq = useApi<{ productos: { id: string; nombre: string }[] }>(abierto && q.trim().length >= 2 ? `/catalogo/productos?q=${encodeURIComponent(q.trim())}` : null, [q]);
  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 mt-1">＋ agregar producto</button>
    );
  }
  return (
    <div className="mt-1 space-y-1">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto del catálogo…" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-sm" autoFocus />
      {busq.data && (
        <ul className="max-h-40 overflow-y-auto text-sm divide-y divide-white/5">
          {busq.data.productos.filter((p) => !yaEn.has(p.id)).map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onAgregar({ producto_id: p.id, nombre: p.nombre, unidades_base: 10 });
                  setQ("");
                  setAbierto(false);
                }}
                className="w-full text-left py-1.5 px-2 hover:bg-white/5 rounded"
              >
                ＋ {p.nombre}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => setAbierto(false)} className="text-xs underline opacity-60">cerrar</button>
    </div>
  );
}

function ComboCard({ combo, idx, onGuardar, ocupado }: { combo: Combo; idx: number; onGuardar: () => void; ocupado: boolean }) {
  const rango = ["Mejor opción", "Alternativa 2", "Alternativa 3"][idx] ?? `Opción ${idx + 1}`;
  return (
    <div className={`rounded-lg border p-4 space-y-2 ${idx === 0 ? "bg-emerald-500/5 border-emerald-500/40" : "bg-white/5 border-white/10"}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{rango}</span>
          <span className="ml-2 text-xs opacity-60">{combo.proveedores.length} droguería(s) · cobertura {Math.round(combo.cobertura * 100)}%</span>
          {!combo.valido && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">no llega a un mínimo</span>}
        </div>
        <div className="text-right">
          <div className="font-bold font-mono">{solesCent(combo.total_cent)}</div>
          {idx > 0 && combo.delta_cent > 0 && <div className="text-xs text-amber-400">+{solesCent(combo.delta_cent)}</div>}
        </div>
      </div>

      {combo.proveedores.map((p) => (
        <div key={p.id} className="border-t border-white/10 pt-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{p.nombre}</span>
            <span className="font-mono text-xs opacity-70">
              {solesCent(p.subtotal_cent)} + flete {solesCent(p.flete_cent)}
              {!p.cumple_minimo && <span className="text-amber-400"> · faltan {solesCent(p.faltan_minimo_cent)} p/ mínimo</span>}
            </span>
          </div>
          <ul className="text-xs opacity-70 mt-1 space-y-0.5">
            {p.renglones.map((r) => (
              <li key={r.producto_id} className="flex justify-between">
                <span className="truncate max-w-[45vw]">{r.nombre ?? r.producto_nombre} × {r.unidades_prov}{r.venc_corto ? " ⚠️" : ""}</span>
                <span className="font-mono">{solesCent(r.precio_cent)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {combo.sin_cubrir.length > 0 && (
        <p className="text-xs text-amber-400/80">No cubre: {combo.sin_cubrir.map((s) => s.nombre).join(", ")}</p>
      )}

      <button onClick={onGuardar} disabled={ocupado} className="w-full mt-1 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40">
        Guardar este pedido
      </button>
    </div>
  );
}
