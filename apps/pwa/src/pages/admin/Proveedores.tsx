import { useState, type ReactNode } from "react";
import { solesStrACent } from "@huayruro/shared";
import { useApi, mutar } from "../../lib/useApi";
import { solesCent } from "../../lib/money";
import { Cargando, Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

// Proveedores (droguerías) + ingesta de listas de precios (B8.1). Mismo patrón UX del
// importador de catálogo: subir/pegar → PREVISUALIZAR → confirmar. El matching de las ofertas
// contra nuestro catálogo (B8.2) y el armado del pedido (B8.3) llegan en la siguiente sesión.

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

export function Proveedores(_props: { sesion: SesionActiva }) {
  const provs = useApi<{ proveedores: Proveedor[] }>("/proveedores");
  const listas = useApi<{ listas: Lista[] }>("/proveedores/listas");
  const [subiendoA, setSubiendoA] = useState<Proveedor | null>(null);

  const recargar = () => {
    provs.recargar();
    listas.recargar();
  };

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">Proveedores</h1>
        <p className="text-sm opacity-60 mt-1">
          Tus droguerías con su monto mínimo y flete, y sus listas de precios. Con las listas cargadas, el comparador armará el pedido más barato.
        </p>
      </div>

      <NuevoProveedor onCreado={recargar} />

      {provs.cargando ? (
        <Cargando que="proveedores" />
      ) : (provs.data?.proveedores.length ?? 0) === 0 ? (
        <Vacio>Sin proveedores todavía. Crea la primera droguería arriba.</Vacio>
      ) : (
        <ul className="space-y-3">
          {provs.data!.proveedores.map((p) => (
            <FilaProveedor key={p.id} p={p} onCambio={recargar} onSubirLista={() => setSubiendoA(p)} />
          ))}
        </ul>
      )}

      {subiendoA && <SubirLista proveedor={subiendoA} onCerrar={() => setSubiendoA(null)} onCargada={recargar} />}

      <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
        <h2 className="font-semibold text-sm">Listas cargadas</h2>
        {listas.cargando ? (
          <Cargando que="listas" />
        ) : (listas.data?.listas.length ?? 0) === 0 ? (
          <Vacio>Ninguna lista todavía.</Vacio>
        ) : (
          <ul className="text-sm divide-y divide-white/5">
            {listas.data!.listas.map((l) => (
              <li key={l.id} className="py-2 flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{l.proveedor_nombre}</span> · {l.etiqueta}
                  <span className="block text-xs opacity-60">
                    {l.fecha_lista} · {l.filas_total} ofertas · {l.filas_match} matcheadas
                  </span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${l.estado === "matcheada" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 opacity-80"}`}>
                  {l.estado === "borrador" ? "por matchear" : l.estado}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs opacity-50">El matching contra tu catálogo y el armado del pedido se activan en la siguiente actualización.</p>
      </section>
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
    <section className="bg-white/5 rounded-lg border border-white/10 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Nueva droguería</h2>
        <button onClick={() => setAbierto((v) => !v)} className="text-sm px-3 py-1.5 rounded bg-emerald-500 text-black font-medium">
          {abierto ? "Cerrar" : "+ Crear"}
        </button>
      </div>
      {abierto && (
        <div className="mt-3 space-y-2">
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre *" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input value={f.ruc} onChange={(e) => setF({ ...f, ruc: e.target.value })} placeholder="RUC" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm font-mono" />
            <input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} placeholder="Contacto (tel/WhatsApp)" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
            <input value={f.minimo} onChange={(e) => setF({ ...f, minimo: e.target.value })} inputMode="decimal" placeholder="Monto mínimo S/ (ej. 500)" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm font-mono" />
            <input value={f.flete} onChange={(e) => setF({ ...f, flete: e.target.value })} inputMode="decimal" placeholder="Flete estimado S/ (ej. 25)" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm font-mono" />
            <input value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} type="number" min={0} placeholder="Días de entrega" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={() => void crear()} disabled={enviando} className="py-2 px-4 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40">
            {enviando ? "Creando..." : "Crear droguería"}
          </button>
        </div>
      )}
    </section>
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
    <li className={`bg-white/5 rounded-lg border border-white/10 p-4 space-y-2 ${p.activo ? "" : "opacity-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{p.nombre}</span>
          {p.ruc && <span className="text-xs opacity-50 ml-2 font-mono">RUC {p.ruc}</span>}
          {!p.activo && <span className="text-xs ml-2 px-2 py-0.5 rounded bg-white/10">inactiva</span>}
          <span className="block text-xs opacity-60 mt-0.5">
            Mínimo {solesCent(p.monto_minimo_cent)} · Flete {solesCent(p.flete_cent)}
            {p.dias_entrega !== null ? ` · Entrega ${p.dias_entrega} día(s)` : ""}
            {p.contacto ? ` · 📞 ${p.contacto}` : ""} · {p.listas} lista(s)
          </span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onSubirLista} className="text-sm px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-medium">
            📄 Subir lista
          </button>
          <button onClick={() => setEditando((v) => !v)} className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">
            {editando ? "Cerrar" : "Editar"}
          </button>
        </div>
      </div>
      {editando && (
        <div className="space-y-2 pt-2 border-t border-white/10">
          <div className="grid grid-cols-2 gap-2">
            <input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} placeholder="Contacto" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
            <input value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} type="number" min={0} placeholder={`Días entrega (${p.dias_entrega ?? "—"})`} className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
            <input value={f.minimo} onChange={(e) => setF({ ...f, minimo: e.target.value })} inputMode="decimal" placeholder={`Mínimo S/ (hoy ${solesCent(p.monto_minimo_cent)})`} className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm font-mono" />
            <input value={f.flete} onChange={(e) => setF({ ...f, flete: e.target.value })} inputMode="decimal" placeholder={`Flete S/ (hoy ${solesCent(p.flete_cent)})`} className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm font-mono" />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void guardar()} disabled={ocupado} className="text-sm px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-40">
              {ocupado ? "..." : "Guardar"}
            </button>
            <button onClick={() => void alternarActivo()} disabled={ocupado} className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">
              {p.activo ? "Desactivar" : "Reactivar"}
            </button>
          </div>
        </div>
      )}
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
    if (!etiqueta.trim()) return setError("Ponle una etiqueta (ej. \"julio 2026\")");
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
    <section className="bg-white/5 rounded-lg border border-emerald-500/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Subir lista de {proveedor.nombre}</h2>
        <button onClick={onCerrar} className="text-xs underline opacity-60">cerrar</button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder='Etiqueta * (ej. "julio 2026")' className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
        <input value={fecha} onChange={(e) => setFecha(e.target.value)} type="date" className="px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
      </div>

      <label className="block">
        <span className="text-xs opacity-60">Sube el CSV de la droguería…</span>
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void leerArchivo(f);
          }}
          className="mt-1 block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-emerald-500 file:text-black file:font-medium"
        />
        {nombreArchivo && <span className="text-xs opacity-60">Archivo: {nombreArchivo}</span>}
      </label>
      <details open={!nombreArchivo}>
        <summary className="text-xs opacity-60 cursor-pointer">…o copia y pega desde Excel (funciona tal cual)</summary>
        <textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setNombreArchivo(null);
            setPreview(null);
            setResultado(null);
          }}
          rows={6}
          placeholder={"producto\tpresentacion\tprecio\tbonificacion\tvencimiento"}
          className="mt-2 w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-xs font-mono"
        />
      </details>

      <button
        onClick={() => void previsualizar()}
        disabled={!csv.trim() || ocupado !== ""}
        className="w-full py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40"
      >
        {ocupado === "preview" ? "Analizando..." : "Previsualizar"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Chip tono="ok">{preview.resumen.validas} ofertas</Chip>
            {preview.resumen.rechazadas > 0 && <Chip tono="mal">{preview.resumen.rechazadas} rechazadas</Chip>}
            <Chip tono="neutro">{preview.resumen.con_factor} con factor detectado</Chip>
            {preview.resumen.con_bonif > 0 && <Chip tono="info">{preview.resumen.con_bonif} con bonificación</Chip>}
            {preview.resumen.con_vencimiento > 0 && <Chip tono="neutro">{preview.resumen.con_vencimiento} con vencimiento</Chip>}
            {preview.resumen.con_gtin > 0 && <Chip tono="neutro">{preview.resumen.con_gtin} con código</Chip>}
          </div>
          {preview.columnas_ignoradas.length > 0 && <p className="text-xs text-amber-400">Columnas ignoradas: {preview.columnas_ignoradas.join(", ")}</p>}
          {preview.resumen.validas > preview.resumen.con_factor && (
            <p className="text-xs opacity-70">
              A {preview.resumen.validas - preview.resumen.con_factor} oferta(s) no les detecté las unidades por caja/blíster: se confirman una sola vez al matchear (el sistema lo recuerda).
            </p>
          )}

          {preview.rechazadas.length > 0 && (
            <ul className="text-xs space-y-1 max-h-32 overflow-y-auto">
              {preview.rechazadas.map((r) => (
                <li key={r.fila} className="bg-red-500/10 rounded px-2 py-1">
                  <b>Fila {r.fila}</b> {r.texto}: {r.motivos.join("; ")}
                </li>
              ))}
            </ul>
          )}
          {preview.advertencias.length > 0 && (
            <ul className="text-xs space-y-0.5 max-h-24 overflow-y-auto opacity-80">
              {preview.advertencias.map((a, i) => (
                <li key={i}>Fila {a.fila} {a.texto}: {a.aviso}</li>
              ))}
            </ul>
          )}

          {preview.muestra.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="opacity-60 text-left">
                  <tr>
                    <th className="py-1 pr-2">Producto</th>
                    <th className="py-1 pr-2 text-right">Precio</th>
                    <th className="py-1 pr-2 text-right">×Unid.</th>
                    <th className="py-1 pr-2">Bonif.</th>
                    <th className="py-1">Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.muestra.map((m) => (
                    <tr key={m.fila} className="border-t border-white/5">
                      <td className="py-1 pr-2">{m.textoOriginal}</td>
                      <td className="py-1 pr-2 text-right font-mono">{solesCent(m.precioCent)}</td>
                      <td className="py-1 pr-2 text-right">{m.factorUnidades ?? "?"}</td>
                      <td className="py-1 pr-2">{m.bonifCompra ? `${m.bonifCompra}+${m.bonifGratis}` : "—"}</td>
                      <td className="py-1 opacity-70">{m.vencimiento ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.resumen.validas > preview.muestra.length && (
                <p className="text-xs opacity-50 mt-1">…y {preview.resumen.validas - preview.muestra.length} más.</p>
              )}
            </div>
          )}

          <button
            onClick={() => void confirmar()}
            disabled={preview.resumen.validas === 0 || ocupado !== ""}
            className="w-full py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40"
          >
            {ocupado === "commit" ? "Cargando..." : `Cargar ${preview.resumen.validas} oferta(s)`}
          </button>
        </div>
      )}

      {resultado && (
        <div className="bg-emerald-500/10 rounded border border-emerald-500/30 p-3 text-sm">
          ✅ Lista cargada: {resultado.insertadas} ofertas. El matching contra tu catálogo llega en la siguiente actualización.
        </div>
      )}
    </section>
  );
}

function Chip({ tono, children }: { tono: "ok" | "mal" | "info" | "neutro"; children: ReactNode }) {
  const c = {
    ok: "bg-emerald-500/20 text-emerald-300",
    mal: "bg-red-500/20 text-red-300",
    info: "bg-sky-500/20 text-sky-300",
    neutro: "bg-white/10 opacity-80",
  }[tono];
  return <span className={`px-2 py-0.5 rounded ${c}`}>{children}</span>;
}
