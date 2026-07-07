import { useState, type ReactNode } from "react";
import { useApi, mutar, descargarCsv } from "../../lib/useApi";
import { solesDm } from "../../lib/money";
import { Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

// Importador de catálogo en lote (T-K4): baja la plantilla, sube/pega el CSV, PREVISUALIZA
// (qué entra / qué se rechaza y por qué / duplicados por código de barras), y confirma. El catálogo
// es compartido a nivel tenant; precio/stock/lote entran a la sucursal elegida.

type Sucursal = { id: string; nombre: string };
type FilaPreview = {
  fila: number;
  nombre: string;
  gtin: string | null;
  precio_venta_publico_dm: number;
  precio_sin_igv_dm: number;
  precio_compra_dm: number | null;
  stock: number;
  minimo: number;
  lote: { numero: string; vencimiento: string } | null;
  blister: { nombre: string; factor: number; precio_venta_publico_dm: number | null } | null;
};
type Rechazada = { fila: number; nombre: string; motivos: string[] };
type Advertencia = { fila: number; nombre: string; texto: string };
type Preview = {
  dry_run: true;
  sucursal_id: string;
  delimitador: string;
  columnas_detectadas: string[];
  columnas_ignoradas: string[];
  resumen: { filas: number; validas: number; rechazadas: number; con_lote: number; con_blister: number; sin_codigo: number; ya_en_catalogo: number; nuevos: number };
  muestra: FilaPreview[];
  ya_en_catalogo: { fila: number; nombre: string; gtin: string | null }[];
  rechazadas: Rechazada[];
  advertencias: Advertencia[];
};
type Commit = {
  dry_run: false;
  creados: number;
  agregados: number;
  omitidos: number;
  fallidos: { fila: number; nombre: string; error: string }[];
  notas: { fila: number; nombre: string; nota: string }[];
  rechazadas: Rechazada[];
};

export function CatalogoImportador({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const [sucursalId, setSucursalId] = useState("");
  const sucursalEfectiva = esSuper ? sucursalId : sesion.usuario.sucursalId ?? "";

  const [csv, setCsv] = useState("");
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resultado, setResultado] = useState<Commit | null>(null);
  const [ocupado, setOcupado] = useState<"" | "preview" | "commit">("");
  const [error, setError] = useState<string | null>(null);

  const query = esSuper && sucursalEfectiva ? `?sucursal_id=${sucursalEfectiva}` : "";
  const listo = csv.trim().length > 0 && (!esSuper || !!sucursalEfectiva);

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
    setResultado(null);
    try {
      const r = await mutar<Preview>(`/catalogo/importar${query ? query + "&" : "?"}dry_run=1`, { method: "POST", body: { csv } });
      setPreview(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado("");
    }
  }

  async function importar() {
    if (!preview) return;
    setOcupado("commit");
    setError(null);
    try {
      const r = await mutar<Commit>(`/catalogo/importar${query}`, { method: "POST", body: { csv } });
      setResultado(r);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado("");
    }
  }

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">Importar catálogo</h1>
        <p className="text-sm opacity-60 mt-1">
          Carga tu lista de productos desde una hoja (CSV). El precio de venta es <b>lo que cobras al cliente</b> (IGV incluido).
        </p>
      </div>

      {/* Sucursal (super) */}
      {esSuper && (
        <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
          <label className="text-sm font-semibold">1. Sucursal destino</label>
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm">
            <option value="">— Elige la sucursal donde cargar precio y stock —</option>
            {(sucursales.data?.sucursales ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </section>
      )}

      {/* Plantilla + carga */}
      <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-semibold">{esSuper ? "2." : "1."} Tu archivo</label>
          <button
            onClick={() => void descargarCsv("/catalogo/importar/plantilla", "plantilla-catalogo-huayruro.csv")}
            className="text-xs px-3 py-1.5 rounded bg-white/10 hover:bg-white/20"
          >
            ⬇ Descargar plantilla CSV
          </button>
        </div>
        <label className="block">
          <span className="text-xs opacity-60">Sube tu CSV (guárdalo como “CSV UTF-8” desde Excel):</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void leerArchivo(f);
            }}
            className="mt-1 block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-emerald-500 file:text-black file:font-medium"
          />
          {nombreArchivo && <span className="text-xs opacity-60">Archivo: {nombreArchivo}</span>}
        </label>
        <details>
          <summary className="text-xs opacity-60 cursor-pointer">…o pega el contenido</summary>
          <textarea
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setNombreArchivo(null);
              setPreview(null);
              setResultado(null);
            }}
            rows={6}
            placeholder="nombre,precio_venta,stock_inicial..."
            className="mt-2 w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-xs font-mono"
          />
        </details>
        <button
          onClick={() => void previsualizar()}
          disabled={!listo || ocupado !== ""}
          className="w-full py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40"
        >
          {ocupado === "preview" ? "Analizando..." : "Previsualizar"}
        </button>
        {esSuper && !sucursalEfectiva && csv.trim() && <p className="text-xs text-amber-400">Elige la sucursal destino arriba.</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {/* Previsualización */}
      {preview && (
        <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-3">
          <h2 className="font-semibold text-sm">Previsualización (nada se ha guardado todavía)</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <Chip tono="ok">{preview.resumen.validas} válidas</Chip>
            <Chip tono="ok">{preview.resumen.nuevos} nuevos</Chip>
            {preview.resumen.ya_en_catalogo > 0 && <Chip tono="info">{preview.resumen.ya_en_catalogo} ya en catálogo</Chip>}
            {preview.resumen.rechazadas > 0 && <Chip tono="mal">{preview.resumen.rechazadas} rechazadas</Chip>}
            {preview.resumen.con_lote > 0 && <Chip tono="neutro">{preview.resumen.con_lote} con lote</Chip>}
            {preview.resumen.con_blister > 0 && <Chip tono="neutro">{preview.resumen.con_blister} con blíster</Chip>}
          </div>
          {preview.columnas_ignoradas.length > 0 && (
            <p className="text-xs text-amber-400">Columnas ignoradas: {preview.columnas_ignoradas.join(", ")}</p>
          )}
          {preview.resumen.sin_codigo > 0 && (
            <p className="text-xs opacity-70">
              {preview.resumen.sin_codigo} producto(s) sin código de barras: se detectan duplicados por nombre (agrégales código para mayor precisión).
            </p>
          )}

          {preview.rechazadas.length > 0 && (
            <div className="text-xs">
              <p className="font-semibold text-red-400 mb-1">Rechazadas ({preview.rechazadas.length}):</p>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {preview.rechazadas.map((r) => (
                  <li key={r.fila} className="bg-red-500/10 rounded px-2 py-1">
                    <b>Fila {r.fila}</b> {r.nombre}: {r.motivos.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview.advertencias.length > 0 && (
            <div className="text-xs">
              <p className="font-semibold text-amber-400 mb-1">Avisos ({preview.advertencias.length}):</p>
              <ul className="space-y-0.5 max-h-28 overflow-y-auto opacity-80">
                {preview.advertencias.map((a, i) => (
                  <li key={i}>Fila {a.fila} {a.nombre}: {a.texto}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.ya_en_catalogo.length > 0 && (
            <p className="text-xs opacity-70">
              Ya en el catálogo (se agregarán a esta sucursal si aún no la vende): {preview.ya_en_catalogo.map((y) => y.nombre).slice(0, 8).join(", ")}
              {preview.ya_en_catalogo.length > 8 ? "…" : ""}
            </p>
          )}

          {preview.muestra.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="opacity-60 text-left">
                  <tr>
                    <th className="py-1 pr-2">Producto</th>
                    <th className="py-1 pr-2">Barras</th>
                    <th className="py-1 pr-2 text-right">Venta</th>
                    <th className="py-1 pr-2 text-right">Stock</th>
                    <th className="py-1 pr-2">Lote/Venc.</th>
                    <th className="py-1">Blíster</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.muestra.map((m) => (
                    <tr key={m.fila} className="border-t border-white/5">
                      <td className="py-1 pr-2">{m.nombre}</td>
                      <td className="py-1 pr-2 font-mono opacity-70">{m.gtin ?? "—"}</td>
                      <td className="py-1 pr-2 text-right font-mono">{solesDm(m.precio_venta_publico_dm)}</td>
                      <td className="py-1 pr-2 text-right">{m.stock}</td>
                      <td className="py-1 pr-2 opacity-70">{m.lote ? `${m.lote.numero} · ${m.lote.vencimiento}` : "—"}</td>
                      <td className="py-1 opacity-70">{m.blister ? `${m.blister.nombre} ×${m.blister.factor}` : "—"}</td>
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
            onClick={() => void importar()}
            disabled={preview.resumen.validas === 0 || ocupado !== ""}
            className="w-full py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40"
          >
            {ocupado === "commit" ? "Importando..." : `Importar ${preview.resumen.validas} producto(s)`}
          </button>
        </section>
      )}

      {/* Resultado del commit */}
      {resultado && (
        <section className="bg-emerald-500/10 rounded-lg border border-emerald-500/30 p-4 space-y-2">
          <h2 className="font-semibold text-sm">✅ Importación completada</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <Chip tono="ok">{resultado.creados} creados</Chip>
            {resultado.agregados > 0 && <Chip tono="info">{resultado.agregados} agregados a la sucursal</Chip>}
            {resultado.omitidos > 0 && <Chip tono="neutro">{resultado.omitidos} ya existían</Chip>}
            {resultado.fallidos.length > 0 && <Chip tono="mal">{resultado.fallidos.length} fallidos</Chip>}
          </div>
          {resultado.fallidos.length > 0 && (
            <ul className="text-xs space-y-1 text-red-300">
              {resultado.fallidos.map((f) => (
                <li key={f.fila}>Fila {f.fila} {f.nombre}: {f.error}</li>
              ))}
            </ul>
          )}
          {resultado.notas.length > 0 && (
            <ul className="text-xs space-y-0.5 opacity-70">
              {resultado.notas.map((n, i) => (
                <li key={i}>Fila {n.fila} {n.nombre}: {n.nota}</li>
              ))}
            </ul>
          )}
          <p className="text-xs opacity-60">El mostrador mostrará los productos tras el próximo sync (o al recargar la app en la caja).</p>
        </section>
      )}

      {esSuper && <PurgaDemo />}
    </div>
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

// Purga del catálogo demo (seed sintético) — solo super, con confirmación.
function PurgaDemo() {
  const conteo = useApi<{ productos: number }>("/catalogo/demo/conteo");
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = conteo.data?.productos ?? 0;

  async function purgar() {
    setOcupado(true);
    setError(null);
    try {
      const r = await mutar<{ productos: number }>("/catalogo/demo/purgar", { method: "POST", body: {} });
      setMsg(`Se eliminaron ${r.productos} productos demo.`);
      setConfirmar(false);
      conteo.recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-2">
      <h2 className="font-semibold text-sm">Catálogo de demostración (seed)</h2>
      {conteo.cargando ? (
        <Vacio>Revisando…</Vacio>
      ) : n === 0 ? (
        <p className="text-sm opacity-60">No hay catálogo demo. {msg}</p>
      ) : (
        <>
          <p className="text-sm opacity-70">Hay <b>{n}</b> productos de demostración (datos sintéticos del piloto). Elimínalos antes de operar con tu catálogo real.</p>
          {!confirmar ? (
            <button onClick={() => setConfirmar(true)} className="text-sm px-3 py-1.5 rounded bg-red-500/80 hover:bg-red-500 text-white font-medium">
              Eliminar catálogo demo
            </button>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="text-sm text-amber-300">¿Seguro? Esto borra los {n} productos demo.</span>
              <button onClick={() => void purgar()} disabled={ocupado} className="text-sm px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-40">
                {ocupado ? "Eliminando..." : "Sí, eliminar"}
              </button>
              <button onClick={() => setConfirmar(false)} className="text-sm px-3 py-1.5 rounded bg-white/10">Cancelar</button>
            </div>
          )}
        </>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}
