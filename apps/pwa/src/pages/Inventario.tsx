import { useCallback, useEffect, useState } from "react";
import { useApi, mutar } from "../lib/useApi";
import { ahoraFecha } from "../lib/fecha-ui";
import {
  cn,
  Card,
  Tabs,
  TabPill,
  TableHead,
  TableRow,
  Th,
  Td,
  EmptyState,
  Button,
  Input,
  useToast,
} from "../components/ui";
import { RecepcionesPendientes } from "./admin/RecepcionesPendientes";
import { Faltantes } from "./admin/Faltantes";
import { ConteoInventario } from "./admin/ConteoInventario";
import type { SesionActiva } from "../lib/tipos";

type Fila = { id: string; producto_id: string; nombre: string; stock_unidades: number; stock_minimo: number; updated_at: string; cobertura_dias?: number | null };
type Lote = { id: string; numero_lote: string; fecha_vencimiento: string; unidades: number; nombre: string };
type TabId = "recepciones" | "porvencer" | "faltantes" | "stockbajo" | "conteo";

// Inventario como CONTENEDOR CON TABS (screens-target §4). Reusa las sub-páginas admin (que también
// se restilizan y siguen funcionando standalone por su hash) y aloja aquí "Por vencer" y "Stock bajo"
// (endpoints requiereUsuario = TODOS). Las tabs admin (Recepciones/Faltantes/Conteo) se ocultan por rol.
export function Inventario({ sesion }: { sesion: SesionActiva }) {
  const esAdmin = sesion.usuario.rol === "admin_sucursal" || sesion.usuario.rol === "super_admin";
  const esSuper = sesion.usuario.rol === "super_admin";
  const tabs: { id: TabId; label: string; admin: boolean }[] = [
    { id: "recepciones", label: "Recepciones", admin: true },
    { id: "porvencer", label: "Por vencer", admin: false },
    { id: "faltantes", label: "Faltantes", admin: true },
    { id: "stockbajo", label: "Stock bajo", admin: false },
    { id: "conteo", label: "Conteo de inventario", admin: true },
  ];
  const visibles = tabs.filter((t) => esAdmin || !t.admin);
  const [tab, setTab] = useState<TabId>(esAdmin ? "recepciones" : "porvencer");
  // Contadores de tab: los reporta cada sub-página al cargar sus datos (cero fetches nuevos; el número
  // coincide exactamente con lo mostrado y se refresca si el super cambia de sucursal).
  const [nRecep, setNRecep] = useState<number | null>(null);
  const [nFalt, setNFalt] = useState<number | null>(null);
  const [nVenc, setNVenc] = useState<number | null>(null);
  const [nStock, setNStock] = useState<number | null>(null);
  const onRecep = useCallback((n: number) => setNRecep(n), []);
  const onFalt = useCallback((n: number) => setNFalt(n), []);
  const onVenc = useCallback((n: number) => setNVenc(n), []);
  const onStock = useCallback((n: number) => setNStock(n), []);

  // El super no tiene una botica fija: elige una para las pestañas per-sucursal (Por vencer / Faltantes
  // / Stock bajo). El admin usa la suya (sin param). Recepciones y Conteo traen su propio selector.
  const sucursales = useApi<{ sucursales: { id: string; nombre: string }[] }>(esSuper ? "/sucursales" : null);
  const [sucId, setSucId] = useState("");
  useEffect(() => {
    const primera = sucursales.data?.sucursales[0]?.id;
    if (esSuper && !sucId && primera) setSucId(primera);
  }, [esSuper, sucId, sucursales.data]);
  const sucSel = esSuper ? sucId : "";
  const superListo = !esSuper || !!sucId;

  const conteo = (id: TabId) =>
    id === "recepciones" ? nRecep : id === "faltantes" ? nFalt : id === "porvencer" ? nVenc : id === "stockbajo" ? nStock : null;

  return (
    <div className="flex flex-col gap-[18px]">
      <Tabs className="flex-wrap">
        {visibles.map((t) => {
          const n = conteo(t.id);
          return (
            <TabPill key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {n != null ? ` (${n})` : ""}
            </TabPill>
          );
        })}
      </Tabs>

      {esSuper && (tab === "porvencer" || tab === "faltantes" || tab === "stockbajo") && sucursales.data && (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-2">Botica:</span>
          <select
            value={sucId}
            onChange={(e) => setSucId(e.target.value)}
            className="rounded-[9px] border border-line-input bg-field px-3 py-1.5 text-[13px] text-ink outline-none"
          >
            {sucursales.data.sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {tab === "recepciones" && esAdmin && <RecepcionesPendientes sesion={sesion} onCount={onRecep} />}
      {tab === "porvencer" && (superListo ? <PorVencerTab onCount={onVenc} sucursalId={sucSel} /> : <Cargando que="boticas" />)}
      {tab === "faltantes" && esAdmin && (superListo ? <Faltantes sesion={sesion} onCount={onFalt} sucursalId={sucSel} /> : <Cargando que="boticas" />)}
      {tab === "stockbajo" && (superListo ? <StockBajoTab sesion={sesion} onCount={onStock} sucursalId={sucSel} /> : <Cargando que="boticas" />)}
      {tab === "conteo" && esAdmin && <ConteoInventario sesion={sesion} />}
    </div>
  );
}

// ── Estados de carga/error compartidos (tokens claros; sin el Estados.tsx del tema viejo) ──
function Cargando({ que }: { que: string }) {
  return <p className="p-6 text-center text-[13px] text-ink-3">Cargando {que}…</p>;
}
function ErrorInline({ msg, onReintentar }: { msg: string; onReintentar: () => void }) {
  return (
    <div className="p-6 text-center">
      <p className="text-[13px] text-accent-ink">{msg}</p>
      <button onClick={onReintentar} className="mt-2 text-[12.5px] text-link underline">
        Reintentar
      </button>
    </div>
  );
}

// ── Fechas / vencimiento ──
function fmtFecha(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}
function diasHasta(ymd: string): number | null {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return null;
  const [hy, hm, hd] = ahoraFecha().split("-");
  if (!hy || !hm || !hd) return null;
  const hoy = Date.UTC(Number(hy), Number(hm) - 1, Number(hd));
  const vence = Date.UTC(Number(y), Number(m) - 1, Number(d));
  return Math.round((vence - hoy) / 86_400_000);
}
function etiquetaDias(d: number): { texto: string; cls: string } {
  if (d < 0) return { texto: "vencido", cls: "text-accent-ink" };
  return { texto: `en ${d} ${d === 1 ? "día" : "días"}`, cls: d <= 30 ? "text-accent-ink" : "text-warn" };
}

// ── Tab: Por vencer (GET /inventario/lotes) ──
// Ventana de fetch = 90 días (se preserva el path actual). "en N días": rojo ≤30, ámbar si no.
// "Sugerencia" del prototipo es heurística sin backend → columna omitida (no se inventa).
function PorVencerTab({ onCount, sucursalId }: { onCount?: (n: number) => void; sucursalId?: string }) {
  const lotes = useApi<{ lotes: Lote[] }>(`/inventario/lotes?vence_antes=${ahoraFecha(90)}${sucursalId ? `&sucursal_id=${sucursalId}` : ""}`, [sucursalId]);
  const cols = "2fr 120px 1.4fr 90px";
  const nLotes = lotes.data?.lotes.length;
  useEffect(() => {
    if (nLotes != null) onCount?.(nLotes);
  }, [nLotes, onCount]);
  return (
    <Card className="gap-3">
      <p className="text-[12.5px] text-ink-2">Lotes que vencen en los próximos 90 días. Mejor moverlos antes que perderlos.</p>
      {lotes.cargando ? (
        <Cargando que="lotes" />
      ) : lotes.error ? (
        <ErrorInline msg={lotes.error} onReintentar={lotes.recargar} />
      ) : (lotes.data?.lotes.length ?? 0) === 0 ? (
        <EmptyState title="Nada por vencer" subtitle="Ningún lote vence en los próximos 90 días." />
      ) : (
        <div className="overflow-x-auto">
          <TableHead cols={cols}>
            <Th>Producto</Th>
            <Th>Lote</Th>
            <Th>Vence</Th>
            <Th align="right">Unidades</Th>
          </TableHead>
          {lotes.data!.lotes.map((l) => {
            const d = diasHasta(l.fecha_vencimiento);
            const et = d == null ? null : etiquetaDias(d);
            return (
              <TableRow key={l.id} cols={cols}>
                <Td className="text-[13px] font-semibold text-ink truncate">{l.nombre}</Td>
                <Td className="font-mono text-[11.5px] text-ink-2">{l.numero_lote}</Td>
                <Td>
                  <span className="text-[12.5px] text-ink-emph tabular-nums">{fmtFecha(l.fecha_vencimiento)}</span>
                  {et && <span className={cn("ml-2 text-[11.5px] font-semibold", et.cls)}>{et.texto}</span>}
                </Td>
                <Td align="right" className="text-[13px] text-ink tabular-nums">{l.unidades}</Td>
              </TableRow>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Tab: Stock bajo (GET /inventario?bajo_minimo=1) ──
// "cobertura_dias" es real (aditivo del repo). "Botica" (per-sucursal) y "Nota" (heurística) sin
// backing → columnas omitidas. Admin/super conservan el ajuste inline (conteo/mínimo) con sus mutar.
function StockBajoTab({ sesion, onCount, sucursalId }: { sesion: SesionActiva; onCount?: (n: number) => void; sucursalId?: string }) {
  const puedeEditar = sesion.usuario.rol === "admin_sucursal" || sesion.usuario.rol === "super_admin";
  // "Ver todo el inventario" (solo admin): alcanza y ajusta el mínimo / consulta el stock de un
  // producto que HOY está por encima de su mínimo (capacidad de la vista de inventario completa). El
  // contador de la pestaña sigue siendo el nº bajo mínimo (la alerta), no el total.
  const [verTodos, setVerTodos] = useState(false);
  const sucQ = sucursalId ? `sucursal_id=${sucursalId}` : "";
  const inv = useApi<{ inventario: Fila[] }>(
    verTodos ? `/inventario${sucQ ? `?${sucQ}` : ""}` : `/inventario?bajo_minimo=1${sucQ ? `&${sucQ}` : ""}`,
    [verTodos, sucursalId],
  );
  const [editando, setEditando] = useState<{ id: string; producto_id: string; nombre: string; tipo: "conteo" | "minimo" } | null>(null);
  const cols = puedeEditar ? "2fr 90px 90px 150px 150px" : "2fr 100px 100px 160px";
  const nInv = inv.data?.inventario.length;
  useEffect(() => {
    if (!verTodos && nInv != null) onCount?.(nInv); // el badge de la pestaña = nº bajo mínimo
  }, [verTodos, nInv, onCount]);

  return (
    <Card className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-ink-2">
          {verTodos
            ? "Todo el inventario. Ajusta el mínimo o el conteo de cualquier producto."
            : "Productos por debajo de su mínimo. La cobertura estima cuántos días aguantan al ritmo de venta actual."}
        </p>
        {puedeEditar && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
            <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} />
            Ver todo el inventario
          </label>
        )}
      </div>
      {inv.cargando ? (
        <Cargando que="inventario" />
      ) : inv.error ? (
        <ErrorInline msg={inv.error} onReintentar={inv.recargar} />
      ) : (inv.data?.inventario.length ?? 0) === 0 ? (
        <EmptyState title="Todo por encima del mínimo" subtitle="Ningún producto está bajo su stock mínimo." />
      ) : (
        <div className="overflow-x-auto">
          <TableHead cols={cols}>
            <Th>Producto</Th>
            <Th align="right">Quedan</Th>
            <Th align="right">Mínimo</Th>
            <Th>Cobertura</Th>
            {puedeEditar && <Th align="right">Ajustar</Th>}
          </TableHead>
          {inv.data!.inventario.map((f) => (
            <TableRow key={f.id} cols={cols}>
              <Td className="text-[13px] font-semibold text-ink truncate">{f.nombre}</Td>
              <Td align="right" className="text-[13px] text-accent-ink tabular-nums">{f.stock_unidades}</Td>
              <Td align="right" className="text-[13px] text-ink-2 tabular-nums">{f.stock_minimo}</Td>
              <Td className={cn("text-[12.5px] font-semibold tabular-nums", coberturaCls(f.cobertura_dias))}>{coberturaTexto(f.cobertura_dias)}</Td>
              {puedeEditar && (
                <Td align="right">
                  <div className="inline-flex gap-1.5">
                    <button onClick={() => setEditando({ id: f.id, producto_id: f.producto_id, nombre: f.nombre, tipo: "conteo" })} className="rounded-full border border-line-input bg-card px-2.5 py-1 text-[11.5px] font-semibold text-ink-emph hover:bg-hover-btn">
                      Conteo
                    </button>
                    <button onClick={() => setEditando({ id: f.id, producto_id: f.producto_id, nombre: f.nombre, tipo: "minimo" })} className="rounded-full border border-line-input bg-card px-2.5 py-1 text-[11.5px] font-semibold text-ink-emph hover:bg-hover-btn">
                      Mínimo
                    </button>
                  </div>
                </Td>
              )}
            </TableRow>
          ))}
        </div>
      )}

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
    </Card>
  );
}

function coberturaCls(d: number | null | undefined): string {
  if (d == null) return "text-ink-2";
  if (d <= 2) return "text-accent-ink";
  if (d <= 4) return "text-warn";
  return "text-ink-2";
}
function coberturaTexto(d: number | null | undefined): string {
  if (d == null) return "—";
  return `~${d} ${d === 1 ? "día" : "días"}`;
}

// Ajuste puntual (conteo físico / fijar mínimo) — mismas mutaciones y guards de rol que el build.
// Overlay sobrio sobre scrim tenue (el sistema no tiene modales; se resuelve con surface/card).
function EditarInventario({ id, producto_id, nombre, tipo, onCerrar, onListo }: { id: string; producto_id: string; nombre: string; tipo: "conteo" | "minimo"; onCerrar: () => void; onListo: () => void }) {
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

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
        toast("Stock ajustado por conteo.");
      } else {
        await mutar(`/inventario/${producto_id}/minimo`, { method: "PATCH", body: { stock_minimo: n } });
        toast("Mínimo actualizado.");
      }
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-surface/40 p-4">
      <Card className="w-full max-w-sm gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-ink">{tipo === "conteo" ? "Ajustar stock (conteo)" : "Fijar stock mínimo"}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2 truncate">{nombre}</p>
        </div>
        <Input
          type="number"
          min={0}
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={tipo === "conteo" ? "Cantidad real contada" : "Nuevo mínimo"}
          className="text-right tabular-nums"
        />
        {error && <p className="text-[12.5px] text-accent-ink">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 justify-center" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" className="flex-1 justify-center" onClick={() => void guardar()} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
