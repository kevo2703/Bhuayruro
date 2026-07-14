import { useState } from "react";
import { solesStrACent } from "@huayruro/shared";
import { useApi, mutar } from "../../lib/useApi";
import { solesCent } from "../../lib/money";
import { navegar } from "../../lib/ruta";
import { Card, Button, Input, Textarea, Chip, SectionLabel, EmptyState, TableHead, TableRow, Th, Td } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// Proveedores (droguerías) + ingesta de listas de precios (B8.1) + matching contra el catálogo (B8.2).
// Patrón UX: subir/pegar → PREVISUALIZAR → confirmar; luego matchear → confirmar/descartar los dudosos.
// El REFRESH solo cambia la PRESENTACIÓN (tema claro + primitivos); las llamadas y el flujo son los mismos.

type Proveedor = {
  id: string;
  nombre: string;
  ruc: string | null;
  contacto: string | null;
  monto_minimo_cent: number;
  flete_cent: number;
  dias_entrega: number | null;
  activo: number;
  listas: number;
};

type Lista = {
  id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  etiqueta: string;
  fecha_lista: string;
  filas_total: number;
  filas_match: number;
  estado: string;
  created_at: string;
};

type ItemPreview = {
  fila: number;
  textoOriginal: string;
  gtin: string | null;
  presentacionTexto: string | null;
  factorUnidades: number | null;
  precioCent: number;
  bonifCompra: number | null;
  bonifGratis: number | null;
  vencimiento: string | null;
};

type PreviewLista = {
  dry_run: true;
  delimitador: string;
  columnas_detectadas: string[];
  columnas_ignoradas: string[];
  resumen: { filas: number; validas: number; rechazadas: number; con_gtin: number; con_factor: number; con_bonif: number; con_vencimiento: number };
  muestra: ItemPreview[];
  rechazadas: { fila: number; texto: string; motivos: string[] }[];
  advertencias: { fila: number; texto: string; aviso: string }[];
};

// Parse de soles de la UI → céntimos SIN floats (dinero §6). null = inválido.
const aCent = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (t === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  try {
    return solesStrACent(t);
  } catch {
    return null;
  }
};

const COLS_PREVIEW = "1.6fr 90px 70px 80px 80px"; // Producto · Precio · ×Unid. · Bonif. · Vence

export function Proveedores(_props: { sesion: SesionActiva }) {
  const provs = useApi<{ proveedores: Proveedor[] }>("/proveedores");
  const listas = useApi<{ listas: Lista[] }>("/proveedores/listas");
  const [subiendoA, setSubiendoA] = useState<Proveedor | null>(null);
  const [revisando, setRevisando] = useState<Lista | null>(null);

  const recargar = () => {
    provs.recargar();
    listas.recargar();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-[560px]">
          <h2 className="text-[16px] font-bold tracking-[-0.01em] text-ink">Droguerías y listas de precios</h2>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-ink-2">
            Tus droguerías con su monto mínimo y flete, y sus listas de precios. Con las listas cargadas y matcheadas, el comparador arma el
            pedido más barato.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navegar("pedido")}>
          Ir a Compras
        </Button>
      </div>

      <NuevoProveedor onCreado={recargar} />

      <SectionLabel>Tus droguerías</SectionLabel>
      {provs.cargando ? (
        <p className="p-6 text-center text-[13px] text-ink-3">Cargando proveedores…</p>
      ) : (provs.data?.proveedores.length ?? 0) === 0 ? (
        <EmptyState title="Sin proveedores todavía" subtitle="Crea la primera droguería arriba." />
      ) : (
        <ul className="flex flex-col gap-3">
          {provs.data!.proveedores.map((p) => (
            <FilaProveedor key={p.id} p={p} onCambio={recargar} onSubirLista={() => setSubiendoA(p)} />
          ))}
        </ul>
      )}

      {subiendoA && <SubirLista proveedor={subiendoA} onCerrar={() => setSubiendoA(null)} onCargada={recargar} />}

      <Card className="gap-2">
        <SectionLabel>Listas cargadas</SectionLabel>
        {listas.cargando ? (
          <p className="p-4 text-center text-[13px] text-ink-3">Cargando listas…</p>
        ) : (listas.data?.listas.length ?? 0) === 0 ? (
          <EmptyState title="Ninguna lista todavía" subtitle="Sube la lista de precios de una droguería arriba." />
        ) : (
          <ul className="divide-y divide-line-row">
            {listas.data!.listas.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <span className="text-[13px] font-semibold text-ink">{l.proveedor_nombre}</span>
                  <span className="text-[13px] text-ink-2"> · {l.etiqueta}</span>
                  <span className="block text-[12px] text-ink-3">
                    {l.fecha_lista} · {l.filas_total} ofertas · {l.filas_match} matcheadas
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {l.estado === "matcheada" ? <Chip variant="ok">matcheada</Chip> : <Chip variant="neutral">por matchear</Chip>}
                  <Button variant="outline" size="sm" onClick={() => setRevisando(l)}>
                    Matchear
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11.5px] text-ink-3">
          Con las listas matcheadas, ve a <b className="text-ink-2">Compras</b> para armar la orden más barata por proveedor.
        </p>
      </Card>

      {revisando && <RevisarMatching lista={revisando} onCerrar={() => setRevisando(null)} onCambio={recargar} />}
    </div>
  );
}

// ---- Revisión del matching de una lista (B8.2): matchea y resuelve los dudosos ----

type Sugerencia = { producto_id: string; nombre: string; score: number };
type Pendiente = {
  id: string;
  texto_original: string;
  precio_cent: number;
  factor_unidades: number | null;
  bonif_compra: number | null;
  bonif_gratis: number | null;
  vencimiento: string | null;
  venc_corto: number;
  score: number;
  sugerencias: Sugerencia[];
};
type ResultadoMatch = { resumen: { total: number; auto: number; pendiente: number; sin_match: number }; pendientes: Pendiente[] };

function RevisarMatching({ lista, onCerrar, onCambio }: { lista: Lista; onCerrar: () => void; onCambio: () => void }) {
  const [res, setRes] = useState<ResultadoMatch | null>(null);
  const [pend, setPend] = useState<Pendiente[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function matchear() {
    setCargando(true);
    setError(null);
    try {
      const r = await mutar<ResultadoMatch>(`/proveedores/listas/${lista.id}/matchear`, { method: "POST", body: {} });
      setRes(r);
      setPend(r.pendientes);
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  async function resolver(item: Pendiente, accion: "confirmar" | "descartar", productoId?: string) {
    try {
      if (accion === "confirmar") {
        if (!productoId) return;
        await mutar(`/proveedores/listas/items/${item.id}/confirmar`, { method: "POST", body: { producto_id: productoId } });
      } else {
        await mutar(`/proveedores/listas/items/${item.id}/descartar`, { method: "POST", body: {} });
      }
      setPend((xs) => xs.filter((x) => x.id !== item.id));
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-bold text-ink">
          Matching de {lista.proveedor_nombre} · {lista.etiqueta}
        </h3>
        <button onClick={onCerrar} className="text-[12px] text-ink-3 underline">
          cerrar
        </button>
      </div>

      {!res ? (
        <Button variant="primary" disabled={cargando} onClick={() => void matchear()} className="self-start">
          {cargando ? "Matcheando…" : "Ejecutar matching contra mi catálogo"}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant="ok">{res.resumen.auto} automáticas</Chip>
          {res.resumen.pendiente > 0 && <Chip variant="info">{res.resumen.pendiente} por confirmar</Chip>}
          {res.resumen.sin_match > 0 && <Chip variant="neutral">{res.resumen.sin_match} sin coincidencia</Chip>}
          <Button variant="outline" size="sm" onClick={() => void matchear()}>
            re-matchear
          </Button>
        </div>
      )}
      {error && <p className="text-[13px] text-accent-ink">{error}</p>}

      {res && pend.length === 0 && <EmptyState title="Nada pendiente" subtitle="Ya puedes armar el pedido en Compras." />}

      {pend.map((item) => (
        <ItemDudoso key={item.id} item={item} onResolver={resolver} />
      ))}
    </Card>
  );
}

function ItemDudoso({ item, onResolver }: { item: Pendiente; onResolver: (i: Pendiente, a: "confirmar" | "descartar", pid?: string) => void }) {
  const [buscando, setBuscando] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-[9px] border border-line bg-inset p-3">
      <div>
        <span className="text-[13px] font-semibold text-ink">{item.texto_original}</span>
        <span className="block text-[12px] text-ink-3">
          {solesCent(item.precio_cent)}
          {item.factor_unidades ? ` · ×${item.factor_unidades}` : " · sin factor"}
          {item.bonif_compra ? ` · bonif ${item.bonif_compra}+${item.bonif_gratis}` : ""}
          {item.venc_corto ? " · venc. corto" : ""}
          {item.score > 0 ? ` · parecido ${Math.round(item.score * 100)}%` : ""}
        </span>
      </div>
      {item.sugerencias.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.sugerencias.map((s) => (
            <Button key={s.producto_id} variant="outline" size="sm" onClick={() => onResolver(item, "confirmar", s.producto_id)}>
              ✓ {s.nombre} <span className="text-ink-3">({Math.round(s.score * 100)}%)</span>
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setBuscando((v) => !v)}>
          {buscando ? "cerrar búsqueda" : "buscar otro producto"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onResolver(item, "descartar")}>
          no lo vendo (descartar)
        </Button>
      </div>
      {buscando && <BuscarProductoInline onElegir={(pid) => onResolver(item, "confirmar", pid)} />}
    </div>
  );
}

function BuscarProductoInline({ onElegir }: { onElegir: (productoId: string) => void }) {
  const [q, setQ] = useState("");
  const busq = useApi<{ productos: { id: string; nombre: string; laboratorio: string | null }[] }>(
    q.trim().length >= 2 ? `/catalogo/productos?q=${encodeURIComponent(q.trim())}` : null,
    [q],
  );
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del producto de tu catálogo…" autoFocus />
      {busq.data && busq.data.productos.length > 0 && (
        <ul className="max-h-40 divide-y divide-line-row overflow-y-auto">
          {busq.data.productos.map((p) => (
            <li key={p.id}>
              <button onClick={() => onElegir(p.id)} className="w-full rounded-[8px] px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover-btn">
                {p.nombre}
                {p.laboratorio && <span className="ml-2 text-[12px] text-ink-3">{p.laboratorio}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && busq.data && busq.data.productos.length === 0 && !busq.cargando && (
        <p className="text-[12px] text-ink-3">Sin resultados. Quizá aún no está en tu catálogo.</p>
      )}
    </div>
  );
}

function NuevoProveedor({ onCreado }: { onCreado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ nombre: "", ruc: "", contacto: "", minimo: "", flete: "", dias: "" });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    const minimo = aCent(f.minimo);
    const flete = aCent(f.flete);
    if (!f.nombre.trim()) return setError("Nombre requerido");
    if (minimo === null) return setError("Monto mínimo inválido (ej. 500.00)");
    if (flete === null) return setError("Flete inválido (ej. 25.00)");
    const dias = f.dias.trim() === "" ? null : Number(f.dias);
    if (dias !== null && (!Number.isInteger(dias) || dias < 0)) return setError("Días de entrega inválidos");
    setEnviando(true);
    setError(null);
    try {
      await mutar("/proveedores", {
        method: "POST",
        body: { nombre: f.nombre.trim(), ruc: f.ruc.trim(), contacto: f.contacto.trim(), monto_minimo_cent: minimo, flete_cent: flete, dias_entrega: dias ?? undefined },
      });
      setF({ nombre: "", ruc: "", contacto: "", minimo: "", flete: "", dias: "" });
      setAbierto(false);
      onCreado();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13.5px] font-bold text-ink">Nueva droguería</h3>
        <Button variant={abierto ? "outline" : "primary"} size="sm" onClick={() => setAbierto((v) => !v)}>
          {abierto ? "Cerrar" : "+ Crear"}
        </Button>
      </div>
      {abierto && (
        <div className="space-y-2">
          <Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre *" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={f.ruc} onChange={(e) => setF({ ...f, ruc: e.target.value })} placeholder="RUC" className="font-mono" />
            <Input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} placeholder="Contacto (tel/WhatsApp)" />
            <Input value={f.minimo} onChange={(e) => setF({ ...f, minimo: e.target.value })} inputMode="decimal" placeholder="Monto mínimo S/ (ej. 500)" className="font-mono" />
            <Input value={f.flete} onChange={(e) => setF({ ...f, flete: e.target.value })} inputMode="decimal" placeholder="Flete estimado S/ (ej. 25)" className="font-mono" />
            <Input value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} type="number" min={0} placeholder="Días de entrega" />
          </div>
          {error && <p className="text-[13px] text-accent-ink">{error}</p>}
          <Button variant="primary" disabled={enviando} onClick={() => void crear()} className="self-start">
            {enviando ? "Creando…" : "Crear droguería"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function FilaProveedor({ p, onCambio, onSubirLista }: { p: Proveedor; onCambio: () => void; onSubirLista: () => void }) {
  const [editando, setEditando] = useState(false);
  const [f, setF] = useState({ contacto: p.contacto ?? "", minimo: "", flete: "", dias: p.dias_entrega?.toString() ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    const minimo = f.minimo.trim() === "" ? undefined : aCent(f.minimo);
    const flete = f.flete.trim() === "" ? undefined : aCent(f.flete);
    if (minimo === null || flete === null) return setError("Montos inválidos (ej. 500.00)");
    const dias = f.dias.trim() === "" ? null : Number(f.dias);
    if (dias !== null && (!Number.isInteger(dias) || dias < 0)) return setError("Días inválidos");
    setOcupado(true);
    setError(null);
    try {
      await mutar(`/proveedores/${p.id}`, {
        method: "PATCH",
        body: { contacto: f.contacto.trim() || null, monto_minimo_cent: minimo, flete_cent: flete, dias_entrega: dias },
      });
      setEditando(false);
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function alternarActivo() {
    setOcupado(true);
    try {
      await mutar(`/proveedores/${p.id}`, { method: "PATCH", body: { activo: p.activo !== 1 } });
      onCambio();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li>
      <Card className={p.activo ? "gap-2" : "gap-2 opacity-60"}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="text-[13.5px] font-bold text-ink">{p.nombre}</span>
            {p.ruc && <span className="ml-2 font-mono text-[12px] text-ink-3">RUC {p.ruc}</span>}
            {!p.activo && <Chip variant="neutral" className="ml-2">inactiva</Chip>}
            <span className="mt-0.5 block text-[12px] text-ink-3">
              Mínimo {solesCent(p.monto_minimo_cent)} · Flete {solesCent(p.flete_cent)}
              {p.dias_entrega !== null ? ` · Entrega ${p.dias_entrega} día(s)` : ""}
              {p.contacto ? ` · ${p.contacto}` : ""} · {p.listas} lista(s)
            </span>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="primary" size="sm" onClick={onSubirLista}>
              Subir lista
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditando((v) => !v)}>
              {editando ? "Cerrar" : "Editar"}
            </Button>
          </div>
        </div>
        {editando && (
          <div className="space-y-2 border-t border-line-hoy pt-2">
            <div className="grid grid-cols-2 gap-2">
              <Input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} placeholder="Contacto" />
              <Input value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} type="number" min={0} placeholder={`Días entrega (${p.dias_entrega ?? "—"})`} />
              <Input value={f.minimo} onChange={(e) => setF({ ...f, minimo: e.target.value })} inputMode="decimal" placeholder={`Mínimo S/ (hoy ${solesCent(p.monto_minimo_cent)})`} className="font-mono" />
              <Input value={f.flete} onChange={(e) => setF({ ...f, flete: e.target.value })} inputMode="decimal" placeholder={`Flete S/ (hoy ${solesCent(p.flete_cent)})`} className="font-mono" />
            </div>
            {error && <p className="text-[13px] text-accent-ink">{error}</p>}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" disabled={ocupado} onClick={() => void guardar()}>
                {ocupado ? "…" : "Guardar"}
              </Button>
              <Button variant="outline" size="sm" disabled={ocupado} onClick={() => void alternarActivo()}>
                {p.activo ? "Desactivar" : "Reactivar"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </li>
  );
}

function SubirLista({ proveedor, onCerrar, onCargada }: { proveedor: Proveedor; onCerrar: () => void; onCargada: () => void }) {
  const hoyLocal = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD (solo default de UI)
  const [csv, setCsv] = useState("");
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [etiqueta, setEtiqueta] = useState("");
  const [fecha, setFecha] = useState(hoyLocal);
  const [preview, setPreview] = useState<PreviewLista | null>(null);
  const [resultado, setResultado] = useState<{ insertadas: number } | null>(null);
  const [ocupado, setOcupado] = useState<"" | "preview" | "commit">("");
  const [error, setError] = useState<string | null>(null);

  async function leerArchivo(file: File) {
    setNombreArchivo(file.name);
    setCsv(await file.text());
    setPreview(null);
    setResultado(null);
    setError(null);
  }

  async function previsualizar() {
    setOcupado("preview");
    setError(null);
    try {
      setPreview(await mutar<PreviewLista>(`/proveedores/${proveedor.id}/listas?dry_run=1`, { method: "POST", body: { csv } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado("");
    }
  }

  async function confirmar() {
    if (!etiqueta.trim()) return setError('Ponle una etiqueta (ej. "julio 2026")');
    setOcupado("commit");
    setError(null);
    try {
      const r = await mutar<{ insertadas: number }>(`/proveedores/${proveedor.id}/listas`, {
        method: "POST",
        body: { csv, etiqueta: etiqueta.trim(), fecha_lista: fecha },
      });
      setResultado(r);
      setPreview(null);
      onCargada();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado("");
    }
  }

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13.5px] font-bold text-ink">Subir lista de {proveedor.nombre}</h3>
        <button onClick={onCerrar} className="text-[12px] text-ink-3 underline">
          cerrar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder='Etiqueta * (ej. "julio 2026")' />
        <Input value={fecha} onChange={(e) => setFecha(e.target.value)} type="date" />
      </div>

      <label className="block">
        <span className="text-[12px] text-ink-3">Sube el CSV de la droguería…</span>
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void leerArchivo(file);
          }}
          className="mt-1 block w-full text-[13px] text-ink file:mr-3 file:rounded-[8px] file:border-0 file:bg-accent file:px-3 file:py-1.5 file:font-medium file:text-white"
        />
        {nombreArchivo && <span className="text-[12px] text-ink-3">Archivo: {nombreArchivo}</span>}
      </label>
      <details open={!nombreArchivo}>
        <summary className="cursor-pointer text-[12px] text-ink-3">…o copia y pega desde Excel (funciona tal cual)</summary>
        <Textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setNombreArchivo(null);
            setPreview(null);
            setResultado(null);
          }}
          rows={6}
          placeholder={"producto\tpresentacion\tprecio\tbonificacion\tvencimiento"}
          className="mt-2 font-mono text-[12px]"
        />
      </details>

      <Button variant="primary" disabled={!csv.trim() || ocupado !== ""} onClick={() => void previsualizar()} className="self-start">
        {ocupado === "preview" ? "Analizando…" : "Previsualizar"}
      </Button>
      {error && <p className="text-[13px] text-accent-ink">{error}</p>}

      {preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Chip variant="ok">{preview.resumen.validas} ofertas</Chip>
            {preview.resumen.rechazadas > 0 && <Chip variant="danger">{preview.resumen.rechazadas} rechazadas</Chip>}
            <Chip variant="neutral">{preview.resumen.con_factor} con factor detectado</Chip>
            {preview.resumen.con_bonif > 0 && <Chip variant="info">{preview.resumen.con_bonif} con bonificación</Chip>}
            {preview.resumen.con_vencimiento > 0 && <Chip variant="neutral">{preview.resumen.con_vencimiento} con vencimiento</Chip>}
            {preview.resumen.con_gtin > 0 && <Chip variant="neutral">{preview.resumen.con_gtin} con código</Chip>}
          </div>
          {preview.columnas_ignoradas.length > 0 && <p className="text-[12px] text-warn">Columnas ignoradas: {preview.columnas_ignoradas.join(", ")}</p>}
          {preview.resumen.validas > preview.resumen.con_factor && (
            <p className="text-[12px] text-ink-2">
              A {preview.resumen.validas - preview.resumen.con_factor} oferta(s) no les detecté las unidades por caja/blíster: se confirman una
              sola vez al matchear (el sistema lo recuerda).
            </p>
          )}

          {preview.rechazadas.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {preview.rechazadas.map((r) => (
                <li key={r.fila} className="rounded-[8px] bg-accent-soft px-2 py-1 text-[12px] text-accent-ink">
                  <b>Fila {r.fila}</b> {r.texto}: {r.motivos.join("; ")}
                </li>
              ))}
            </ul>
          )}
          {preview.advertencias.length > 0 && (
            <ul className="max-h-24 space-y-0.5 overflow-y-auto text-[12px] text-ink-3">
              {preview.advertencias.map((a, i) => (
                <li key={i}>
                  Fila {a.fila} {a.texto}: {a.aviso}
                </li>
              ))}
            </ul>
          )}

          {preview.muestra.length > 0 && (
            <div className="overflow-x-auto">
              <TableHead cols={COLS_PREVIEW}>
                <Th>Producto</Th>
                <Th align="right">Precio</Th>
                <Th align="right">×Unid.</Th>
                <Th>Bonif.</Th>
                <Th>Vence</Th>
              </TableHead>
              {preview.muestra.map((m) => (
                <TableRow key={m.fila} cols={COLS_PREVIEW}>
                  <Td className="truncate text-[12.5px] text-ink">{m.textoOriginal}</Td>
                  <Td align="right" className="font-mono text-[12.5px] tabular-nums text-ink-emph">
                    {solesCent(m.precioCent)}
                  </Td>
                  <Td align="right" className="text-[12.5px] tabular-nums text-ink-2">
                    {m.factorUnidades ?? "?"}
                  </Td>
                  <Td className="text-[12.5px] text-ink-2">{m.bonifCompra ? `${m.bonifCompra}+${m.bonifGratis}` : "—"}</Td>
                  <Td className="text-[12.5px] text-ink-3">{m.vencimiento ?? "—"}</Td>
                </TableRow>
              ))}
              {preview.resumen.validas > preview.muestra.length && (
                <p className="mt-1 text-[12px] text-ink-3">…y {preview.resumen.validas - preview.muestra.length} más.</p>
              )}
            </div>
          )}

          <Button variant="primary" disabled={preview.resumen.validas === 0 || ocupado !== ""} onClick={() => void confirmar()} className="self-start">
            {ocupado === "commit" ? "Cargando…" : `Cargar ${preview.resumen.validas} oferta(s)`}
          </Button>
        </div>
      )}

      {resultado && (
        <div className="rounded-[10px] border border-ok bg-ok-soft/50 p-3 text-[13px] text-ok">
          Lista cargada: {resultado.insertadas} ofertas. Arriba, en “Listas cargadas”, tócala en <b>Matchear</b> para cruzarla con tu catálogo.
        </div>
      )}
    </Card>
  );
}
