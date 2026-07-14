import { useEffect, useMemo, useRef, useState } from "react";
import { uuidv7 } from "@huayruro/shared";
import { useApi, mutar } from "../../lib/useApi";
import { fechaCorta } from "../../lib/fecha-ui";
import { solesCent } from "../../lib/money";
import { cn, KpiCard, Card, Chip, Button, Input, TableHead, TableRow, Th, Td, EmptyState } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// P5 (C3) — Conteo de inventario. La persona cuenta físicamente el stock; si no cuadra, el sistema ajusta
// y valoriza la merma (que alimenta la bandeja de Casos → indicador merma_conteo). La hoja es CIEGA: NO
// muestra el stock del sistema mientras se cuenta (para no "cuadrar" al número → conteo honesto).

type Clase = "A" | "B" | "C";
type Sugerido = { inventario_id: string; producto_id: string; nombre: string; clase: Clase; ultimo_conteo: string | null };
type SugeridosResp = { hoy: string; total_universo: number; total_vencidos: number; sugeridos: Sugerido[] };
type Sesion = { id: string; created_at: string; items_contados: number; items_descuadrados: number; merma_valor_cent: number; exceso_valor_cent: number };
type Resumen = { dias: number; ira_pct: number | null; items_contados: number; items_exactos: number; merma_cent: number; sesiones: Sesion[] };
type InvFila = { id: string; producto_id: string; nombre: string; stock_unidades: number };
type Fila = { producto_id: string; nombre: string; clase?: Clase; contado: string };
type Resultado = { items_contados: number; items_descuadrados: number; merma_valor_cent: number; exceso_valor_cent: number; omitidos: string[]; idempotent: boolean };
type Sucursal = { id: string; nombre: string };
type DetItem = { producto_id: string; nombre: string; esperado: number; contado: number; diferencia: number; valor_merma_cent: number; motivo: string | null };
type Detalle = { sesion: Sesion & { notas: string | null }; items: DetItem[] };

// merma en soles: valor absoluto (el signo lo comunica el color/contexto).
const merma = (cent: number) => solesCent(Math.abs(cent));

const CLASE_BADGE: Record<Clase, string> = {
  A: "bg-abc-a/10 text-abc-a",
  B: "bg-abc-b/10 text-abc-b",
  C: "bg-abc-c/10 text-abc-c",
};

export function ConteoInventario({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [sucSel, setSucSel] = useState<string>("");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel : (sesion.usuario.sucursalId ?? "");
  const listo = !esSuper || !!suc;
  const qSuc = esSuper && suc ? `?sucursal_id=${suc}` : "";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-ink-2">
        Cuenta lo que hay en el anaquel y anótalo. Si no cuadra con el sistema, se ajusta solo y la diferencia queda registrada como posible pérdida.
      </p>

      {esSuper && (
        <select
          value={sucSel}
          onChange={(e) => setSucSel(e.target.value)}
          className="w-full max-w-xs rounded-[9px] border border-line-input bg-field px-3 py-2 text-[13px] text-ink outline-none"
        >
          <option value="">— Elige una sucursal —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {!listo ? <EmptyState title="Elige una sucursal" subtitle="Selecciona una botica para contar su inventario." /> : <Panel key={suc} qSuc={qSuc} />}
    </div>
  );
}

function Panel({ qSuc }: { qSuc: string }) {
  const resumen = useApi<Resumen>(`/conteos/resumen${qSuc}`);
  const sugeridos = useApi<SugeridosResp>(`/conteos/sugeridos${qSuc}`);
  const inv = useApi<{ inventario: InvFila[] }>(`/inventario${qSuc}`);

  const [hoja, setHoja] = useState<Fila[]>([]);
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  // El client_uuid identifica ESTE conteo (una hoja): se acuña UNA vez y se reusa en cada reintento, para
  // que el UNIQUE(client_uuid) del backend dedupe de verdad (un doble-tap NO crea dos sesiones ni duplica
  // la merma). Se renueva solo tras un guardado exitoso, para la siguiente hoja.
  const [clientUuid, setClientUuid] = useState(() => uuidv7());
  const enviandoRef = useRef(false); // guardia SÍNCRONA: cierra la ventana entre el clic y el re-render deshabilitado

  // Arranca la hoja con la lista sugerida del día (sin cuentas).
  useEffect(() => {
    if (sugeridos.data) setHoja(sugeridos.data.sugeridos.map((s) => ({ producto_id: s.producto_id, nombre: s.nombre, clase: s.clase, contado: "" })));
  }, [sugeridos.data]);

  const enHoja = useMemo(() => new Set(hoja.map((f) => f.producto_id)), [hoja]);
  const candidatos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    return (inv.data?.inventario ?? []).filter((p) => !enHoja.has(p.producto_id) && p.nombre.toLowerCase().includes(q)).slice(0, 8);
  }, [busca, inv.data, enHoja]);

  const setContado = (productoId: string, v: string) => setHoja((h) => h.map((f) => (f.producto_id === productoId ? { ...f, contado: v } : f)));
  const agregar = (p: InvFila) => {
    setHoja((h) => [{ producto_id: p.producto_id, nombre: p.nombre, contado: "" }, ...h]);
    setBusca("");
  };
  const quitar = (productoId: string) => setHoja((h) => h.filter((f) => f.producto_id !== productoId));

  const contadas = hoja.filter((f) => f.contado.trim() !== "");

  async function guardar() {
    const items: { producto_id: string; contado: number }[] = [];
    for (const f of contadas) {
      const n = Number(f.contado);
      if (!Number.isInteger(n) || n < 0) {
        setAviso({ tipo: "error", texto: `Cantidad inválida en "${f.nombre}" (entero ≥ 0).` });
        return;
      }
      items.push({ producto_id: f.producto_id, contado: n });
    }
    if (items.length === 0) {
      setAviso({ tipo: "error", texto: "Anota al menos un producto contado." });
      return;
    }
    if (enviandoRef.current) return; // doble-tap: el segundo clic se descarta antes de disparar otro request
    enviandoRef.current = true;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await mutar<Resultado>(`/conteos${qSuc}`, { method: "POST", body: { client_uuid: clientUuid, items } });
      setResultado(r);
      setHoja([]);
      setClientUuid(uuidv7()); // hoja siguiente = conteo nuevo
      resumen.recargar();
      sugeridos.recargar();
    } catch (e) {
      // Se conserva el mismo client_uuid: un reintento del MISMO conteo dedupe en el backend.
      setAviso({ tipo: "error", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const primeraSesion = resumen.data?.sesiones[0];

  return (
    <div className="flex flex-col gap-4">
      {/* Resumen: IRA + merma del periodo */}
      {resumen.data && (
        <section className="grid grid-cols-3 gap-3.5">
          <KpiCard label="Exactitud (IRA)" value={resumen.data.ira_pct === null ? "—" : `${resumen.data.ira_pct}%`} />
          <KpiCard label="Merma detectada" value={<span className={resumen.data.merma_cent < 0 ? "text-accent-ink" : undefined}>{merma(resumen.data.merma_cent)}</span>} />
          <KpiCard label="Último conteo" value={primeraSesion ? fechaCorta(primeraSesion.created_at).slice(0, 5) : "—"} />
        </section>
      )}

      {resultado && (
        <div className="rounded-[10px] border border-line bg-ok-soft p-3 text-[12.5px]">
          <p className="text-[13px] font-bold text-ok">Conteo guardado ✓</p>
          <p className="mt-0.5 text-ink-emph tabular-nums">
            {resultado.items_contados} contados · {resultado.items_descuadrados} descuadrados
            {resultado.merma_valor_cent < 0 && <> · merma <span className="font-semibold text-accent-ink">{merma(resultado.merma_valor_cent)}</span></>}
            {resultado.exceso_valor_cent > 0 && <> · sobrante <span className="font-semibold text-ok">{merma(resultado.exceso_valor_cent)}</span></>}
          </p>
          {resultado.items_descuadrados > 0 && <p className="mt-1 text-[11.5px] text-ink-3">El stock ya se ajustó. Si la merma fue grande o se repite, verás un caso en Casos.</p>}
          <button onClick={() => setResultado(null)} className="mt-2 text-[11.5px] text-ink-3 hover:text-ink">cerrar</button>
        </div>
      )}

      {aviso && (
        <p className={cn("rounded-[10px] border border-line p-2.5 text-[12.5px]", aviso.tipo === "error" ? "bg-accent-soft text-accent-ink" : "bg-ok-soft text-ok")}>{aviso.texto}</p>
      )}

      {/* Agregar un producto suelto (conteo libre) */}
      <section className="flex flex-col gap-2">
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Agregar otro producto a contar…" />
        {candidatos.length > 0 && (
          <ul className="overflow-hidden rounded-[10px] border border-line bg-card">
            {candidatos.map((p) => (
              <li key={p.producto_id} className="border-b border-line-row last:border-b-0">
                <button onClick={() => agregar(p)} className="w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-hover-btn">{p.nombre}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Hoja de conteo (ciega: sin el stock del sistema) */}
      <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-card">
        <header className="flex items-center justify-between border-b border-line-row-head px-4 py-3">
          <span className="text-[13.5px] font-bold text-ink">Hoja de conteo {sugeridos.data && <span className="font-normal text-ink-3">({sugeridos.data.total_vencidos} sugeridos hoy)</span>}</span>
          {contadas.length > 0 && <span className="text-[12px] text-ink-3 tabular-nums">{contadas.length} anotados</span>}
        </header>

        {sugeridos.cargando ? (
          <p className="p-6 text-center text-[13px] text-ink-3">Cargando lista de conteo…</p>
        ) : sugeridos.error ? (
          <div className="p-6 text-center">
            <p className="text-[13px] text-accent-ink">{sugeridos.error}</p>
            <button onClick={sugeridos.recargar} className="mt-2 text-[12.5px] text-link underline">Reintentar</button>
          </div>
        ) : hoja.length === 0 ? (
          <div className="p-4"><EmptyState title="Nada pendiente de contar hoy" subtitle="Agrega un producto arriba para contarlo igual." /></div>
        ) : (
          <ul>
            {hoja.map((f) => (
              <li key={f.producto_id} className="flex items-center justify-between gap-3 border-b border-line-row px-4 py-2.5 last:border-b-0">
                <div className="flex min-w-0 items-center gap-2">
                  {f.clase && <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", CLASE_BADGE[f.clase])}>{f.clase}</span>}
                  <span className="truncate text-[13px] text-ink">{f.nombre}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={f.contado}
                    onChange={(e) => setContado(f.producto_id, e.target.value)}
                    placeholder="contar"
                    className="w-24 rounded-[9px] border border-line-input bg-field px-2 py-1 text-right text-[13px] text-ink tabular-nums outline-none"
                  />
                  <button onClick={() => quitar(f.producto_id)} className="text-[13px] text-ink-3 hover:text-accent-ink" title="quitar de la hoja">✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {hoja.length > 0 && (
          <div className="border-t border-line-row p-3">
            <Button variant="primary" className="w-full justify-center" onClick={() => void guardar()} disabled={enviando || contadas.length === 0}>
              {enviando ? "Guardando…" : `Guardar conteo (${contadas.length})`}
            </Button>
          </div>
        )}
      </div>

      {/* Conteos recientes (resumen.sesiones) + detalle por línea */}
      {(resumen.data?.sesiones.length ?? 0) > 0 && (
        <Card className="gap-3">
          <p className="text-[12.5px] text-ink-2">Conteos recientes de esta botica. Ábrelos para ver el detalle por producto.</p>
          <div>
            <TableHead cols={SES_COLS}>
              <Th>Fecha</Th>
              <Th align="right">Ítems</Th>
              <Th align="right">Diferencias</Th>
              <Th align="right">Merma</Th>
              <Th>Estado</Th>
            </TableHead>
            {resumen.data!.sesiones.map((s) => (
              <TableRow key={s.id} cols={SES_COLS} onClick={() => setDetalleId(s.id)}>
                <Td className="text-[12.5px] text-ink-emph tabular-nums">{fechaCorta(s.created_at)}</Td>
                <Td align="right" className="text-[13px] text-ink tabular-nums">{s.items_contados}</Td>
                <Td align="right" className="text-[13px] text-ink-2 tabular-nums">{s.items_descuadrados}</Td>
                <Td align="right" className={cn("text-[13px] tabular-nums", s.merma_valor_cent < 0 ? "text-accent-ink" : "text-ink-2")}>{s.merma_valor_cent < 0 ? merma(s.merma_valor_cent) : "—"}</Td>
                <Td><Chip variant="ok">Cerrado</Chip></Td>
              </TableRow>
            ))}
          </div>
        </Card>
      )}

      {detalleId && <DetalleConteo id={detalleId} qSuc={qSuc} onCerrar={() => setDetalleId(null)} />}
    </div>
  );
}

const SES_COLS = "1.2fr 90px 120px 120px 110px";
const DET_COLS = "2fr 90px 90px 110px 120px 1fr";

// Detalle por línea de una sesión (GET /conteos/:id). Aquí SÍ se muestra el stock del sistema:
// el conteo ya cerró y esta vista es para el dueño/encargado (la ceguera es solo mientras se cuenta).
function DetalleConteo({ id, qSuc, onCerrar }: { id: string; qSuc: string; onCerrar: () => void }) {
  const det = useApi<Detalle>(`/conteos/${id}${qSuc}`);
  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13.5px] font-bold text-ink">Detalle del conteo</h3>
        <button onClick={onCerrar} className="text-[12px] text-ink-3 hover:text-ink">cerrar</button>
      </div>
      {det.cargando ? (
        <p className="p-4 text-center text-[13px] text-ink-3">Cargando detalle…</p>
      ) : det.error ? (
        <div className="p-4 text-center">
          <p className="text-[13px] text-accent-ink">{det.error}</p>
          <button onClick={det.recargar} className="mt-2 text-[12.5px] text-link underline">Reintentar</button>
        </div>
      ) : !det.data ? null : (
        <div>
          <TableHead cols={DET_COLS}>
            <Th>Producto</Th>
            <Th align="right">Sistema</Th>
            <Th align="right">Contado</Th>
            <Th align="right">Diferencia</Th>
            <Th align="right">Valor</Th>
            <Th>Motivo</Th>
          </TableHead>
          {det.data.items.map((it) => (
            <TableRow key={it.producto_id} cols={DET_COLS}>
              <Td className="truncate text-[13px] font-semibold text-ink">{it.nombre}</Td>
              <Td align="right" className="text-[13px] text-ink-2 tabular-nums">{it.esperado}</Td>
              <Td align="right" className="text-[13px] text-ink tabular-nums">{it.contado}</Td>
              <Td align="right" className={cn("text-[13px] font-semibold tabular-nums", it.diferencia < 0 ? "text-accent-ink" : it.diferencia > 0 ? "text-warn" : "text-ink-2")}>
                {it.diferencia > 0 ? `+${it.diferencia}` : it.diferencia}
              </Td>
              <Td align="right" className={cn("text-[12.5px] tabular-nums", it.valor_merma_cent < 0 ? "text-accent-ink" : "text-ink-2")}>{it.valor_merma_cent !== 0 ? merma(it.valor_merma_cent) : "—"}</Td>
              <Td className="text-[12.5px] text-ink-3">{it.motivo ?? "—"}</Td>
            </TableRow>
          ))}
        </div>
      )}
    </Card>
  );
}
