import { useState } from "react";
import { solesStrADm } from "@huayruro/shared";
import { useApi, mutar } from "../../lib/useApi";
import { solesDm } from "../../lib/money";
import { SelectorProducto, type ProductoRef } from "../../components/SelectorProducto";
import { Cargando, Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

type Presentacion = { id: string; producto_id: string; nombre: string; factor_unidades: number; es_base: number };
type Precio = { presentacion_id: string; precio_sin_igv_dm: number; precio_total_dm: number };
type Sucursal = { id: string; nombre: string };

const aDm = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null;
  try {
    return solesStrADm(t);
  } catch {
    return null;
  }
};

// Formularios de catálogo (§11.1): crear producto (+ presentación base), agregar presentaciones
// (Δ1: blíster/caja con factor) y fijar precios por sucursal.
export function CatalogoForm({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [producto, setProducto] = useState<ProductoRef | null>(null);
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const [sucursalId, setSucursalId] = useState("");
  const sucursalEfectiva = esSuper ? sucursalId : sesion.usuario.sucursalId ?? "";

  return (
    <div className="max-w-2xl mx-auto w-full space-y-5 overflow-y-auto">
      <h1 className="text-xl font-bold">Catálogo</h1>

      <CrearProducto onCreado={(p) => setProducto(p)} />

      <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-3">
        <h2 className="font-semibold">Editar precios y presentaciones</h2>
        {esSuper && (
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm">
            <option value="">— Elige la sucursal para los precios —</option>
            {(sucursales.data?.sucursales ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        )}
        {producto ? (
          <div className="flex items-center justify-between bg-white/5 rounded p-2">
            <span className="font-medium truncate">{producto.nombre}</span>
            <button onClick={() => setProducto(null)} className="text-xs underline opacity-60">cambiar</button>
          </div>
        ) : (
          <SelectorProducto onSelect={setProducto} placeholder="Buscar producto para editar..." />
        )}

        {producto && (esSuper ? sucursalEfectiva : true) ? (
          <EditorPrecios productoId={producto.id} esSuper={esSuper} sucursalId={sucursalEfectiva} />
        ) : producto && esSuper && !sucursalEfectiva ? (
          <p className="text-sm text-amber-400">Elige una sucursal para ver/editar precios.</p>
        ) : null}
      </section>
    </div>
  );
}

function CrearProducto({ onCreado }: { onCreado: (p: ProductoRef) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ nombre: "", presentacion: "", laboratorio: "", principio_activo: "", categoria: "", requiere_receta: false });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    if (!f.nombre.trim()) {
      setError("Nombre requerido");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const r = await mutar<{ id: string }>("/catalogo/productos", { method: "POST", body: f });
      onCreado({ id: r.id, nombre: f.nombre.trim() });
      setF({ nombre: "", presentacion: "", laboratorio: "", principio_activo: "", categoria: "", requiere_receta: false });
      setAbierto(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="bg-white/5 rounded-lg border border-white/10 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Nuevo producto</h2>
        <button onClick={() => setAbierto((v) => !v)} className="text-sm px-3 py-1.5 rounded bg-emerald-500 text-black font-medium">
          {abierto ? "Cerrar" : "+ Crear"}
        </button>
      </div>
      {abierto && (
        <div className="mt-3 space-y-2">
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre *" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input value={f.presentacion} onChange={(e) => setF({ ...f, presentacion: e.target.value })} placeholder="Presentación (texto)" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
            <input value={f.laboratorio} onChange={(e) => setF({ ...f, laboratorio: e.target.value })} placeholder="Laboratorio" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
            <input value={f.principio_activo} onChange={(e) => setF({ ...f, principio_activo: e.target.value })} placeholder="Principio activo" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
            <input value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} placeholder="Categoría" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm opacity-80">
            <input type="checkbox" checked={f.requiere_receta} onChange={(e) => setF({ ...f, requiere_receta: e.target.checked })} /> Requiere receta
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={() => void crear()} disabled={enviando} className="py-2 px-4 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40">
            {enviando ? "Creando..." : "Crear (con presentación base)"}
          </button>
        </div>
      )}
    </section>
  );
}

function EditorPrecios({ productoId, esSuper, sucursalId }: { productoId: string; esSuper: boolean; sucursalId: string }) {
  const q = esSuper && sucursalId ? `?sucursal_id=${sucursalId}` : "";
  const pres = useApi<{ presentaciones: Presentacion[] }>(`/catalogo/productos/${productoId}/presentaciones`, [productoId]);
  const precios = useApi<{ precios: Precio[] }>(`/precios?producto_id=${productoId}${esSuper && sucursalId ? `&sucursal_id=${sucursalId}` : ""}`, [productoId, sucursalId]);
  const [nuevaPres, setNuevaPres] = useState({ nombre: "", factor: "" });
  const recargar = () => {
    pres.recargar();
    precios.recargar();
  };

  const precioDe = (presId: string) => precios.data?.precios.find((p) => p.presentacion_id === presId) ?? null;

  async function agregarPresentacion() {
    const factor = Number(nuevaPres.factor);
    if (!nuevaPres.nombre.trim() || !Number.isInteger(factor) || factor < 1) return;
    await mutar(`/catalogo/productos/${productoId}/presentaciones`, { method: "POST", body: { nombre: nuevaPres.nombre.trim(), factor_unidades: factor } });
    setNuevaPres({ nombre: "", factor: "" });
    recargar();
  }

  if (pres.cargando) return <Cargando que="presentaciones" />;

  return (
    <div className="space-y-3">
      {(pres.data?.presentaciones.length ?? 0) === 0 ? (
        <Vacio>Sin presentaciones.</Vacio>
      ) : (
        <ul className="space-y-2">
          {pres.data!.presentaciones.map((p) => (
            <FilaPrecio key={p.id} pres={p} precio={precioDe(p.id)} productoId={productoId} q={q} onGuardado={recargar} />
          ))}
        </ul>
      )}
      <div className="flex gap-2 items-center pt-2 border-t border-white/10">
        <input value={nuevaPres.nombre} onChange={(e) => setNuevaPres({ ...nuevaPres, nombre: e.target.value })} placeholder="Presentación (blíster x10)" className="flex-1 px-2 py-1.5 rounded bg-white/5 border border-white/10 outline-none text-sm" />
        <input value={nuevaPres.factor} onChange={(e) => setNuevaPres({ ...nuevaPres, factor: e.target.value })} type="number" min={1} placeholder="factor" className="w-20 px-2 py-1.5 rounded bg-white/5 border border-white/10 outline-none text-sm" />
        <button onClick={() => void agregarPresentacion()} className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">+ Presentación</button>
      </div>
    </div>
  );
}

function FilaPrecio({ pres, precio, productoId, q, onGuardado }: { pres: Presentacion; precio: Precio | null; productoId: string; q: string; onGuardado: () => void }) {
  const [venta, setVenta] = useState("");
  const [compra, setCompra] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const dmVenta = aDm(venta);
    if (dmVenta === null) {
      setError("Precio de venta inválido (ej. 12.50)");
      return;
    }
    const dmCompra = compra.trim() ? aDm(compra) : null;
    if (compra.trim() && dmCompra === null) {
      setError("Precio de compra inválido");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await mutar(`/precios${q}`, {
        method: "POST",
        body: { producto_id: productoId, presentacion_id: pres.id, precio_sin_igv_dm: dmVenta, precio_compra_dm: dmCompra ?? undefined },
      });
      setVenta("");
      setCompra("");
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <li className="bg-white/5 rounded p-2">
      <div className="flex items-center justify-between text-sm">
        <span>
          {pres.nombre} <span className="opacity-50">(×{pres.factor_unidades})</span>
        </span>
        <span className="font-mono opacity-70">{precio ? solesDm(precio.precio_total_dm) : "sin precio"}</span>
      </div>
      <div className="mt-2 flex gap-2 items-center">
        <input value={venta} onChange={(e) => setVenta(e.target.value)} inputMode="decimal" placeholder="Venta s/IGV" className="flex-1 px-2 py-1.5 rounded bg-white/5 border border-white/10 outline-none text-sm font-mono" />
        <input value={compra} onChange={(e) => setCompra(e.target.value)} inputMode="decimal" placeholder="Compra (opc.)" className="flex-1 px-2 py-1.5 rounded bg-white/5 border border-white/10 outline-none text-sm font-mono" />
        <button onClick={() => void guardar()} disabled={guardando} className="text-sm px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-40">
          {guardando ? "..." : "Fijar"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </li>
  );
}
