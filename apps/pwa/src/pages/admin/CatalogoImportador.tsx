import { useState } from "react";
import { useApi, mutar, descargarCsv } from "../../lib/useApi";
import { solesDm } from "../../lib/money";
import { Card, Button, Textarea, Chip, EmptyState, TableHead, TableRow, Th, Td, useToast } from "../../components/ui";
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

// Select nativo con el estilo del tema claro (no hay primitivo <Select> en el barrel).
const SELECT_CLS =
  "w-full box-border rounded-[9px] border border-line-input bg-field px-3 py-2.5 text-[13px] text-ink outline-none";
const TABLA_COLS = "minmax(160px,1.6fr) 120px 90px 64px 150px 130px";

export function CatalogoImportador({ sesion }: { sesion: SesionActiva }) {
  const toast = useToast();
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
      toast(`Importación completada: ${r.creados} creado(s)${r.agregados ? `, ${r.agregados} agregado(s)` : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado("");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <p className="text-[13px] text-ink-2">
        Carga tu lista de productos desde una hoja (CSV). El precio de venta es <b className="font-semibold text-ink">lo que cobras al cliente</b> (IGV incluido).
      </p>

      {/* Sucursal (super) */}
      {esSuper && (
        <Card className="gap-2">
          <label className="text-[13px] font-semibold text-ink">1. Sucursal destino</label>
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={SELECT_CLS}>
            <option value="">— Elige la sucursal donde cargar precio y stock —</option>
            {(sucursales.data?.sucursales ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </Card>
      )}

      {/* Plantilla + carga */}
      <Card className="gap-3">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[13px] font-semibold text-ink">{esSuper ? "2." : "1."} Tu archivo</label>
          <Button variant="outline" size="sm" onClick={() => void descargarCsv("/catalogo/importar/plantilla", "plantilla-catalogo-huayruro.csv")}>
            ⬇ Descargar plantilla CSV
          </Button>
        </div>
        <label className="block">
          <span className="text-[12px] text-ink-3">Sube tu CSV (guárdalo como “CSV UTF-8” desde Excel):</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void leerArchivo(f);
            }}
            className="mt-1 block w-full text-[13px] text-ink-2 file:mr-3 file:rounded-[9px] file:border-0 file:bg-accent file:px-3 file:py-1.5 file:font-medium file:text-white hover:file:bg-accent-hover"
          />
          {nombreArchivo && <span className="text-[12px] text-ink-3">Archivo: {nombreArchivo}</span>}
        </label>
        <details>
          <summary className="cursor-pointer text-[12px] text-ink-3">…o pega el contenido</summary>
          <Textarea
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setNombreArchivo(null);
              setPreview(null);
              setResultado(null);
            }}
            rows={6}
            placeholder="nombre,precio_venta,stock_inicial..."
            className="mt-2 font-mono text-[12px]"
          />
        </details>
        <Button onClick={() => void previsualizar()} disabled={!listo || ocupado !== ""} className="w-full justify-center">
          {ocupado === "preview" ? "Analizando..." : "Previsualizar"}
        </Button>
        {esSuper && !sucursalEfectiva && csv.trim() && <p className="text-[12px] text-warn">Elige la sucursal destino arriba.</p>}
        {error && <p className="text-[13px] text-accent-ink">{error}</p>}
      </Card>

      {/* Previsualización */}
      {preview && (
        <Card className="gap-3">
          <h2 className="text-[13.5px] font-bold text-ink">Previsualización <span className="font-medium text-ink-3">(nada se ha guardado todavía)</span></h2>
          <div className="flex flex-wrap gap-2">
            <Chip variant="ok">{preview.resumen.validas} válidas</Chip>
            <Chip variant="ok">{preview.resumen.nuevos} nuevos</Chip>
            {preview.resumen.ya_en_catalogo > 0 && <Chip variant="info">{preview.resumen.ya_en_catalogo} ya en catálogo</Chip>}
            {preview.resumen.rechazadas > 0 && <Chip variant="danger">{preview.resumen.rechazadas} rechazadas</Chip>}
            {preview.resumen.con_lote > 0 && <Chip variant="neutral">{preview.resumen.con_lote} con lote</Chip>}
            {preview.resumen.con_blister > 0 && <Chip variant="neutral">{preview.resumen.con_blister} con blíster</Chip>}
          </div>
          {preview.columnas_ignoradas.length > 0 && (
            <p className="text-[12px] text-warn">Columnas ignoradas: {preview.columnas_ignoradas.join(", ")}</p>
          )}
          {preview.resumen.sin_codigo > 0 && (
            <p className="text-[12px] text-ink-2">
              {preview.resumen.sin_codigo} producto(s) sin código de barras: se detectan duplicados por nombre (agrégales código para mayor precisión).
            </p>
          )}

          {preview.rechazadas.length > 0 && (
            <div>
              <p className="mb-1 text-[12px] font-semibold text-accent-ink">Rechazadas ({preview.rechazadas.length}):</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {preview.rechazadas.map((r) => (
                  <li key={r.fila} className="rounded-[8px] bg-accent-soft px-2 py-1 text-[12px] text-accent-ink">
                    <b>Fila {r.fila}</b> {r.nombre}: {r.motivos.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview.advertencias.length > 0 && (
            <div>
              <p className="mb-1 text-[12px] font-semibold text-warn">Avisos ({preview.advertencias.length}):</p>
              <ul className="max-h-28 space-y-0.5 overflow-y-auto text-[12px] text-ink-2">
                {preview.advertencias.map((a, i) => (
                  <li key={i}>Fila {a.fila} {a.nombre}: {a.texto}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.ya_en_catalogo.length > 0 && (
            <p className="text-[12px] text-ink-2">
              Ya en el catálogo (se agregarán a esta sucursal si aún no la vende): {preview.ya_en_catalogo.map((y) => y.nombre).slice(0, 8).join(", ")}
              {preview.ya_en_catalogo.length > 8 ? "…" : ""}
            </p>
          )}

          {preview.muestra.length > 0 && (
            <div className="overflow-x-auto">
              <TableHead cols={TABLA_COLS}>
                <Th>Producto</Th>
                <Th>Barras</Th>
                <Th align="right">Venta</Th>
                <Th align="right">Stock</Th>
                <Th>Lote/Venc.</Th>
                <Th>Blíster</Th>
              </TableHead>
              {preview.muestra.map((m) => (
                <TableRow key={m.fila} cols={TABLA_COLS}>
                  <Td className="text-[13px] text-ink">{m.nombre}</Td>
                  <Td className="font-mono text-[11.5px] text-ink-2">{m.gtin ?? "—"}</Td>
                  <Td align="right" className="font-mono text-[12.5px] tabular-nums text-ink">{solesDm(m.precio_venta_publico_dm)}</Td>
                  <Td align="right" className="text-[12.5px] tabular-nums text-ink">{m.stock}</Td>
                  <Td className="text-[12px] text-ink-2">{m.lote ? `${m.lote.numero} · ${m.lote.vencimiento}` : "—"}</Td>
                  <Td className="text-[12px] text-ink-2">{m.blister ? `${m.blister.nombre} ×${m.blister.factor}` : "—"}</Td>
                </TableRow>
              ))}
              {preview.resumen.validas > preview.muestra.length && (
                <p className="mt-1 text-[12px] text-ink-3">…y {preview.resumen.validas - preview.muestra.length} más.</p>
              )}
            </div>
          )}

          <Button onClick={() => void importar()} disabled={preview.resumen.validas === 0 || ocupado !== ""} className="w-full justify-center">
            {ocupado === "commit" ? "Importando..." : `Importar ${preview.resumen.validas} producto(s)`}
          </Button>
        </Card>
      )}

      {/* Resultado del commit */}
      {resultado && (
        <div className="flex flex-col gap-2 rounded-[12px] border border-ok bg-ok-soft p-[18px_20px]">
          <h2 className="text-[13.5px] font-bold text-ink">Importación completada</h2>
          <div className="flex flex-wrap gap-2">
            <Chip variant="ok">{resultado.creados} creados</Chip>
            {resultado.agregados > 0 && <Chip variant="info">{resultado.agregados} agregados a la sucursal</Chip>}
            {resultado.omitidos > 0 && <Chip variant="neutral">{resultado.omitidos} ya existían</Chip>}
            {resultado.fallidos.length > 0 && <Chip variant="danger">{resultado.fallidos.length} fallidos</Chip>}
          </div>
          {resultado.fallidos.length > 0 && (
            <ul className="space-y-1 text-[12px] text-accent-ink">
              {resultado.fallidos.map((f) => (
                <li key={f.fila}>Fila {f.fila} {f.nombre}: {f.error}</li>
              ))}
            </ul>
          )}
          {resultado.notas.length > 0 && (
            <ul className="space-y-0.5 text-[12px] text-ink-2">
              {resultado.notas.map((n, i) => (
                <li key={i}>Fila {n.fila} {n.nombre}: {n.nota}</li>
              ))}
            </ul>
          )}
          <p className="text-[12px] text-ink-3">El mostrador mostrará los productos tras el próximo sync (o al recargar la app en la caja).</p>
        </div>
      )}

      {esSuper && <PurgaDemo />}
    </div>
  );
}

// Purga del catálogo demo (seed sintético) — solo super, con confirmación.
function PurgaDemo() {
  const toast = useToast();
  const conteo = useApi<{ productos: number }>("/catalogo/demo/conteo");
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = conteo.data?.productos ?? 0;

  async function purgar() {
    setOcupado(true);
    setError(null);
    try {
      const r = await mutar<{ productos: number }>("/catalogo/demo/purgar", { method: "POST", body: {} });
      toast(`Se eliminaron ${r.productos} productos demo.`);
      setConfirmar(false);
      conteo.recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="gap-2">
      <h2 className="text-[13.5px] font-bold text-ink">Catálogo de demostración (seed)</h2>
      {conteo.cargando ? (
        <p className="text-[13px] text-ink-3">Revisando…</p>
      ) : n === 0 ? (
        <EmptyState title="No hay catálogo de demostración" subtitle="Tu catálogo está limpio para operar." />
      ) : (
        <>
          <p className="text-[13px] text-ink-2">Hay <b className="font-semibold text-ink">{n}</b> productos de demostración (datos sintéticos del piloto). Elimínalos antes de operar con tu catálogo real.</p>
          {!confirmar ? (
            <Button variant="outline" size="sm" className="self-start" onClick={() => setConfirmar(true)}>
              Eliminar catálogo demo
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-warn">¿Seguro? Esto borra los {n} productos demo.</span>
              <Button size="sm" onClick={() => void purgar()} disabled={ocupado}>
                {ocupado ? "Eliminando..." : "Sí, eliminar"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmar(false)}>Cancelar</Button>
            </div>
          )}
        </>
      )}
      {error && <p className="text-[13px] text-accent-ink">{error}</p>}
    </Card>
  );
}
