import { useEffect, useState } from "react";
import { solesStrADm } from "@huayruro/shared";
import { useApi, mutar } from "../../lib/useApi";
import { solesDm } from "../../lib/money";
import { SelectorProducto, type ProductoRef } from "../../components/SelectorProducto";
import { Card, Button, Input, useToast } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// Fila del catálogo maestro nacional (B7): referencia SUSALUD/DIGEMID para el alta asistida.
type MaestroFila = {
  id: string;
  gtin: string | null;
  nombre: string;
  dci: string | null;
  concentracion: string | null;
  forma: string | null;
  laboratorio: string | null;
  presentacion: string | null;
  unidades_envase: number | null;
};

// Δ4: producto marcado como tratamiento crónico (insumo de la bandeja de reposición A2).
type ProductoCronico = { id: string; nombre: string; presentacion: string | null; principio_activo: string | null; dosis_diaria_default: number | null };

type Presentacion = { id: string; producto_id: string; nombre: string; factor_unidades: number; es_base: number };
type Precio = { presentacion_id: string; precio_sin_igv_dm: number; precio_total_dm: number };
type Sucursal = { id: string; nombre: string };

// Select nativo con el estilo del tema claro (no hay primitivo <Select> en el barrel).
const SELECT_CLS =
  "w-full box-border rounded-[9px] border border-line-input bg-field px-3 py-2.5 text-[13px] text-ink outline-none";

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
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <p className="text-[13px] text-ink-2">
        Da de alta un producto (búscalo en el catálogo nacional y ajusta solo el precio) o edita precios y
        presentaciones por sucursal.
      </p>

      <CrearProducto onCreado={(p) => setProducto(p)} />

      <Card className="gap-3">
        <h2 className="text-[13.5px] font-bold text-ink">Editar precios y presentaciones</h2>
        {esSuper && (
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={SELECT_CLS}>
            <option value="">— Elige la sucursal para los precios —</option>
            {(sucursales.data?.sucursales ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        )}
        {producto ? (
          <div className="flex items-center justify-between gap-2 rounded-[9px] border border-line bg-inset px-3 py-2.5">
            <span className="truncate text-[13px] font-semibold text-ink">{producto.nombre}</span>
            <button onClick={() => setProducto(null)} className="shrink-0 text-[12px] font-medium text-link hover:text-link-hover">
              cambiar
            </button>
          </div>
        ) : (
          <SelectorProducto onSelect={setProducto} placeholder="Buscar producto para editar..." />
        )}

        {producto && (esSuper ? sucursalEfectiva : true) ? (
          <EditorPrecios productoId={producto.id} esSuper={esSuper} sucursalId={sucursalEfectiva} />
        ) : producto && esSuper && !sucursalEfectiva ? (
          <p className="text-[13px] text-warn">Elige una sucursal para ver/editar precios.</p>
        ) : null}
      </Card>

      <Cronicos />
    </div>
  );
}

// Δ4 — Tratamientos crónicos. Vive en Catálogo porque es un atributo del producto (qué se toma todos
// los días y cuánto), no de una botica: se marca una vez para toda la cadena.
//
// Es el insumo ÚNICO de la bandeja de reposición (A2): sin productos marcados acá, esa pantalla no
// puede calcular la fecha de agotamiento de nadie y nace vacía. Por eso la lista de marcados se ve
// entera de un vistazo — es una lista corta que se cura a mano (20–40 SKU) y hay que poder auditarla.
function Cronicos() {
  const toast = useToast();
  const lista = useApi<{ productos: ProductoCronico[] }>("/catalogo/cronicos");
  const [nuevo, setNuevo] = useState<ProductoRef | null>(null);
  const [dosis, setDosis] = useState("1");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productos = lista.data?.productos ?? [];

  async function marcar(id: string, esCronico: boolean, dosisDiaria: string | null, nombre: string) {
    setGuardando(true);
    setError(null);
    try {
      await mutar(`/catalogo/productos/${id}/cronico`, {
        method: "PUT",
        body: { es_cronico: esCronico, dosis_diaria: dosisDiaria === null ? null : Number(dosisDiaria.replace(",", ".")) },
      });
      toast(esCronico ? `${nombre}: marcado como crónico.` : `${nombre}: ya no es crónico.`);
      setNuevo(null);
      setDosis("1");
      lista.recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card className="gap-3">
      <h2 className="text-[13.5px] font-bold text-ink">Tratamientos crónicos</h2>
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        Los que la persona toma todos los días (presión, diabetes, anticonceptivos). Con la dosis diaria, el sistema sabe
        cuándo se le acaba y arma la <strong>bandeja de reposición</strong>. Sin esto, esa bandeja está vacía.
      </p>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">Producto</span>
          {nuevo ? (
            <div className="flex items-center justify-between gap-2 rounded-[9px] border border-line-input bg-field px-3 py-2">
              <span className="truncate text-[13px] text-ink">{nuevo.nombre}</span>
              <button onClick={() => setNuevo(null)} className="shrink-0 text-[12px] text-link underline">cambiar</button>
            </div>
          ) : (
            <SelectorProducto onSelect={setNuevo} placeholder="Buscar el producto a marcar…" />
          )}
        </label>
        {/* El ancho lo pone el contenedor: el primitivo Input trae `w-full` y `cn` no hace merge de
            utilidades, así que una clase de ancho en el propio input no gana. */}
        <label className="flex flex-col gap-1.5 sm:w-[110px]">
          <span className="text-[12px] font-semibold text-ink-2">Cuánto al día</span>
          <Input value={dosis} onChange={(e) => setDosis(e.target.value)} inputMode="decimal" placeholder="1" />
        </label>
        <Button onClick={() => void marcar(nuevo?.id ?? "", true, dosis, nuevo?.nombre ?? "")} disabled={!nuevo || !dosis.trim() || guardando}>
          {guardando ? "Guardando…" : "Marcar"}
        </Button>
      </div>
      <p className="text-[11.5px] text-ink-3">
        En unidades por día: 1 tableta diaria = <strong>1</strong>; dos veces al día = <strong>2</strong>; media al día ={" "}
        <strong>0.5</strong>.
      </p>

      {error && <p className="text-[12px] text-accent-ink">{error}</p>}

      {lista.cargando ? (
        <p className="py-2 text-[13px] text-ink-3">Cargando…</p>
      ) : productos.length === 0 ? (
        <p className="rounded-[9px] border border-dashed border-line-empty px-3 py-3 text-center text-[12.5px] text-ink-3">
          Todavía no marcaste ninguno.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-line-inset">
          {productos.map((p) => (
            <FilaCronico key={p.id} p={p} onGuardar={marcar} ocupado={guardando} />
          ))}
        </div>
      )}
    </Card>
  );
}

function FilaCronico({
  p,
  onGuardar,
  ocupado,
}: {
  p: ProductoCronico;
  onGuardar: (id: string, esCronico: boolean, dosis: string | null, nombre: string) => Promise<void>;
  ocupado: boolean;
}) {
  const original = String(p.dosis_diaria_default ?? "");
  const [dosis, setDosis] = useState(original);
  const sucio = dosis.trim() !== original;

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-ink">{p.nombre}</p>
        <p className="truncate text-[11.5px] text-ink-3">{p.principio_activo ?? p.presentacion ?? "—"}</p>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <div className="w-[74px]">
          <Input value={dosis} onChange={(e) => setDosis(e.target.value)} inputMode="decimal" className="text-center" aria-label={`Dosis diaria de ${p.nombre}`} />
        </div>
        <span className="whitespace-nowrap text-[12px] text-ink-3">al día</span>
        {sucio && (
          <Button size="sm" onClick={() => void onGuardar(p.id, true, dosis, p.nombre)} disabled={ocupado || !dosis.trim()}>
            Guardar
          </Button>
        )}
        <button
          onClick={() => void onGuardar(p.id, false, null, p.nombre)}
          disabled={ocupado}
          className="rounded-[8px] px-2 py-1 text-[12px] text-ink-3 hover:bg-hover-btn hover:text-accent-ink disabled:opacity-50"
          aria-label={`Quitar ${p.nombre} de crónicos`}
        >
          Quitar
        </button>
      </div>
    </div>
  );
}

const FORM_VACIO = { nombre: "", presentacion: "", laboratorio: "", principio_activo: "", categoria: "", requiere_receta: false, codigo_barras: "" };

function CrearProducto({ onCreado }: { onCreado: (p: ProductoRef) => void }) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState(FORM_VACIO);
  const [desdeMaestro, setDesdeMaestro] = useState<MaestroFila | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Alta asistida (B7.4): elegir del maestro precarga el form; todo queda editable.
  function precargar(m: MaestroFila) {
    setF({
      ...f,
      nombre: [m.nombre, m.concentracion].filter(Boolean).join(" "),
      presentacion: m.presentacion ? `${m.presentacion}${m.unidades_envase && m.unidades_envase > 1 ? ` x${m.unidades_envase}` : ""}` : f.presentacion,
      laboratorio: m.laboratorio ?? "",
      principio_activo: [m.dci, m.concentracion].filter(Boolean).join(" "),
      codigo_barras: m.gtin ?? "",
    });
    setDesdeMaestro(m);
  }

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
      toast(`Producto "${f.nombre.trim()}" creado.`);
      setF(FORM_VACIO);
      setDesdeMaestro(null);
      setAbierto(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="gap-0">
      <div className="flex items-center justify-between">
        <h2 className="text-[13.5px] font-bold text-ink">Nuevo producto</h2>
        <Button variant="outline" size="sm" onClick={() => setAbierto((v) => !v)}>
          {abierto ? "Cerrar" : "+ Crear"}
        </Button>
      </div>
      {abierto && (
        <div className="mt-3 space-y-2">
          <BuscadorMaestro onElegir={precargar} />
          {desdeMaestro && (
            <p className="rounded-[9px] bg-info-soft px-3 py-1.5 text-[12px] text-info-ink">
              Precargado del catálogo nacional{desdeMaestro.gtin ? ` · GTIN ${desdeMaestro.gtin}` : ""} — revisa y ajusta lo que quieras.
            </p>
          )}
          <Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre *" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={f.presentacion} onChange={(e) => setF({ ...f, presentacion: e.target.value })} placeholder="Presentación (texto)" />
            <Input value={f.laboratorio} onChange={(e) => setF({ ...f, laboratorio: e.target.value })} placeholder="Laboratorio" />
            <Input value={f.principio_activo} onChange={(e) => setF({ ...f, principio_activo: e.target.value })} placeholder="Principio activo" />
            <Input value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} placeholder="Categoría" />
          </div>
          <Input value={f.codigo_barras} onChange={(e) => setF({ ...f, codigo_barras: e.target.value })} placeholder="Código de barras (opcional; el escáner lo usará)" className="font-mono" />
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" className="accent-accent" checked={f.requiere_receta} onChange={(e) => setF({ ...f, requiere_receta: e.target.checked })} /> Requiere receta
          </label>
          {error && <p className="text-[12px] text-accent-ink">{error}</p>}
          <Button onClick={() => void crear()} disabled={enviando}>
            {enviando ? "Creando..." : "Crear (con presentación base)"}
          </Button>
        </div>
      )}
    </Card>
  );
}

// Buscador contra el catálogo maestro nacional (15,181 productos DIGEMID/SUSALUD). Para aseo,
// galénicos y misceláneas (que NO están en el maestro) simplemente se llena el form a mano.
function BuscadorMaestro({ onElegir }: { onElegir: (m: MaestroFila) => void }) {
  const [q, setQ] = useState("");
  const [qLista, setQLista] = useState(""); // valor "asentado" tras el debounce
  const [mostrar, setMostrar] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setQLista(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const busqueda = useApi<{ resultados: MaestroFila[] }>(
    qLista.length >= 3 ? `/maestro/buscar?q=${encodeURIComponent(qLista)}` : null,
    [qLista],
  );
  const resultados = busqueda.data?.resultados ?? [];

  return (
    <div className="space-y-1 rounded-[9px] border border-line-inset bg-inset p-2">
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setMostrar(true);
        }}
        placeholder="🔎 Buscar en el catálogo nacional (medicinas con registro sanitario)..."
      />
      {qLista.length >= 3 && mostrar && (
        <div className="max-h-52 overflow-y-auto">
          {busqueda.cargando ? (
            <p className="px-2 py-1 text-[12px] text-ink-3">Buscando…</p>
          ) : resultados.length === 0 ? (
            <p className="px-2 py-1 text-[12px] text-ink-3">Sin resultados en el maestro (si es aseo/galénico, llena el form a mano).</p>
          ) : (
            <ul className="divide-y divide-line-row">
              {resultados.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => {
                      onElegir(m);
                      setMostrar(false);
                    }}
                    className="w-full rounded-[9px] px-2 py-1.5 text-left hover:bg-hover-btn"
                  >
                    <span className="text-[13px] font-semibold text-ink">{[m.nombre, m.concentracion].filter(Boolean).join(" ")}</span>
                    <span className="block text-[12px] text-ink-3">
                      {[m.laboratorio, m.presentacion, m.unidades_envase && m.unidades_envase > 1 ? `x${m.unidades_envase}` : null, m.gtin ? `GTIN ${m.gtin}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
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

  if (pres.cargando) return <p className="py-4 text-center text-[13px] text-ink-3">Cargando presentaciones…</p>;

  return (
    <div className="space-y-3">
      {(pres.data?.presentaciones.length ?? 0) === 0 ? (
        <p className="text-[13px] text-ink-3">Sin presentaciones.</p>
      ) : (
        <ul className="space-y-2">
          {pres.data!.presentaciones.map((p) => (
            <FilaPrecio key={p.id} pres={p} precio={precioDe(p.id)} productoId={productoId} q={q} onGuardado={recargar} />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <Input value={nuevaPres.nombre} onChange={(e) => setNuevaPres({ ...nuevaPres, nombre: e.target.value })} placeholder="Presentación (blíster x10)" className="flex-1" />
        <Input value={nuevaPres.factor} onChange={(e) => setNuevaPres({ ...nuevaPres, factor: e.target.value })} type="number" min={1} placeholder="factor" className="w-20 tabular-nums" />
        <Button variant="outline" size="sm" onClick={() => void agregarPresentacion()}>+ Presentación</Button>
      </div>
    </div>
  );
}

function FilaPrecio({ pres, precio, productoId, q, onGuardado }: { pres: Presentacion; precio: Precio | null; productoId: string; q: string; onGuardado: () => void }) {
  const toast = useToast();
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
      toast(`Precio de "${pres.nombre}" fijado.`);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <li className="rounded-[9px] border border-line bg-inset px-3 py-2.5">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-ink">
          {pres.nombre} <span className="text-ink-3">(×{pres.factor_unidades})</span>
        </span>
        <span className="font-mono tabular-nums text-ink-2">{precio ? solesDm(precio.precio_total_dm) : "sin precio"}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input value={venta} onChange={(e) => setVenta(e.target.value)} inputMode="decimal" placeholder="Venta s/IGV" className="flex-1 font-mono tabular-nums" />
        <Input value={compra} onChange={(e) => setCompra(e.target.value)} inputMode="decimal" placeholder="Compra (opc.)" className="flex-1 font-mono tabular-nums" />
        <Button onClick={() => void guardar()} disabled={guardando} size="sm">
          {guardando ? "..." : "Fijar"}
        </Button>
      </div>
      {error && <p className="mt-1 text-[12px] text-accent-ink">{error}</p>}
    </li>
  );
}
