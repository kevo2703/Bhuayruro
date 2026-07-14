import { useEffect, useMemo, useState } from "react";
import { useApi, mutar, descargarCsv } from "../../lib/useApi";
import { solesCent } from "../../lib/money";
import { navegar } from "../../lib/ruta";
import { Card, Button, Input, Chip, SectionLabel, EmptyState, TableHead, TableRow, Th, Td, useToast } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// Compras (B8.4): faltantes → editar → comparar combos (1–2 proveedores) → guardar → CSV por proveedor.
// La comparación por unidad base, la bonificación y la consolidación exacta las resuelve el server.
// El REFRESH solo cambia la PRESENTACIÓN: la cabecera "arma" el pedido con el mismo GET /pedidos/base
// + POST /pedidos/comparar, y muestra el mejor combo por droguería. El ahorro se lee del array `combos`
// que ya devuelve el motor (delta de totales reales, misma cobertura); lo que no tiene backend
// (destino/ciudad, ahorro por línea, tip de flete, envío por WhatsApp) se rotula "próximamente".

type Necesidad = { producto_id: string; nombre: string; unidades_base: number };
type Renglon = {
  producto_id: string;
  nombre?: string;
  producto_nombre?: string;
  unidades_base: number;
  unidades_prov: number;
  factor_unidades: number;
  precio_cent: number;
  renglon_cent: number;
  venc_corto?: number;
};
type ProvEnCombo = {
  id: string;
  nombre: string;
  monto_minimo_cent: number;
  flete_cent: number;
  subtotal_cent: number;
  cumple_minimo: boolean;
  faltan_minimo_cent: number;
  renglones: Renglon[];
};
type Combo = {
  proveedor_ids: string[];
  proveedores: ProvEnCombo[];
  cubiertos: number;
  sin_cubrir: { producto_id: string; nombre: string }[];
  cobertura: number;
  total_cent: number;
  valido: boolean;
};
type ComboTop = Combo & { delta_cent: number };
// El motor devuelve `combos` (completo, incluye singles) + `top3` (con delta vs el #1). Se consumen ambos.
type Comparacion = {
  combos: Combo[];
  top3: ComboTop[];
  sin_oferta: { producto_id: string; nombre: string }[];
  proveedores_evaluados: number;
  venc_corto_disponibles: { producto_id: string; nombre: string }[];
};

type ListaFrescura = { id: string; proveedor_id: string; proveedor_nombre: string; created_at: string; fecha_lista: string };

const COLS = "1.7fr 130px 130px 110px"; // Producto · Cantidad · Precio · Subtotal (design-system §6)

export function Pedido({ sesion }: { sesion: SesionActiva }) {
  const toast = useToast();
  const esSuper = sesion.usuario.rol === "super_admin";
  const sucursales = useApi<{ sucursales: { id: string; nombre: string }[] }>(esSuper ? "/sucursales" : null);
  const [sucId, setSucId] = useState<string | null>(null);
  useEffect(() => {
    if (esSuper && sucId === null && sucursales.data?.sucursales.length) setSucId(sucursales.data.sucursales[0]!.id);
  }, [esSuper, sucId, sucursales.data]);

  const q = esSuper ? (sucId ? `?sucursal_id=${sucId}` : null) : "";
  const base = useApi<{ necesidades: Necesidad[] }>(q === null ? null : `/pedidos/base${q}`, [q]);
  // Días de entrega por droguería (dato real que no viaja en /comparar) y frescura de listas.
  const provs = useApi<{ proveedores: { id: string; dias_entrega: number | null }[] }>("/proveedores");
  const listas = useApi<{ listas: ListaFrescura[] }>("/proveedores/listas");
  const diasPorProv = useMemo(
    () => new Map((provs.data?.proveedores ?? []).map((p): [string, number | null] => [p.id, p.dias_entrega])),
    [provs.data],
  );

  const [items, setItems] = useState<Necesidad[]>([]);
  const [aceptar, setAceptar] = useState<Set<string>>(new Set());
  const [comp, setComp] = useState<Comparacion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<{ id: string; proveedores: { id: string; nombre: string }[] } | null>(null);
  const [armadoDe, setArmadoDe] = useState<string | null>(null);

  const necesidadesValidas = useMemo(() => items.filter((i) => i.unidades_base > 0), [items]);

  useEffect(() => {
    if (base.data) {
      setItems(base.data.necesidades);
      setComp(null);
      setGuardado(null);
      setError(null);
    }
  }, [base.data]);

  async function ejecutarComparar(necs: Necesidad[], aceptarSet: Set<string>) {
    setOcupado(true);
    setError(null);
    setGuardado(null);
    try {
      const r = await mutar<Comparacion>(`/pedidos/comparar`, { method: "POST", body: { items: necs, aceptar_venc_corto: [...aceptarSet] } });
      setComp(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  // Auto-arma el pedido sugerido al cargar los faltantes (mismo POST /pedidos/comparar). Una vez por
  // botica; re-armar tras editar es manual (botón Recalcular) para no disparar POSTs en cada tecla.
  useEffect(() => {
    if (!base.data || q === null || armadoDe === q) return;
    const necs = base.data.necesidades.filter((n) => n.unidades_base > 0);
    setArmadoDe(q);
    if (necs.length > 0) void ejecutarComparar(necs, aceptar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.data, q, armadoDe]);

  function comparar(aceptarSet = aceptar) {
    void ejecutarComparar(necesidadesValidas, aceptarSet);
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
      toast("Pedido guardado. Descarga la orden de cada droguería abajo.");
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
    comparar(s);
  }

  const mejor = comp?.top3[0];
  // Ahorro HONESTO: la droguería única (combo de 1 proveedor) más barata que cubre lo mismo y llega a
  // su mínimo, menos el mejor combo. Totales reales del payload; sin single comparable → "próximamente".
  const singleComparable = useMemo(() => {
    if (!comp || !mejor) return undefined;
    return comp.combos
      .filter((c) => c.proveedores.length === 1 && c.valido && c.cubiertos >= mejor.cubiertos)
      .sort((a, b) => a.total_cent - b.total_cent)[0];
  }, [comp, mejor]);
  const ahorroCent = singleComparable && mejor ? singleComparable.total_cent - mejor.total_cent : null;

  return (
    <div className="flex flex-col gap-4">
      {esSuper && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">Botica del pedido</span>
          <select
            value={sucId ?? ""}
            onChange={(e) => setSucId(e.target.value)}
            className="rounded-[9px] border border-line-input bg-field px-3 py-2 text-[13px] text-ink outline-none"
          >
            {sucursales.data?.sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* a) Cabecera del pedido */}
      <Card size="lg" className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[520px]">
            <h2 className="text-[16px] font-bold tracking-[-0.01em] text-ink">Pedido sugerido de la semana</h2>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-ink-2">
              Se arma con tus faltantes y las listas de precios de tus droguerías. A cada una le toca lo que le sale más barato, en 1–2
              proveedores.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {mejor ? (
              <>
                <span className="text-[26px] font-bold tracking-[-0.01em] tabular-nums text-ink">{solesCent(mejor.total_cent)}</span>
                {ahorroCent != null && ahorroCent > 0 ? (
                  <Chip variant="ok">Ahorras {solesCent(ahorroCent)} frente a una sola droguería</Chip>
                ) : (
                  <span className="text-[11.5px] text-ink-3">Ahorro frente a una sola droguería: próximamente</span>
                )}
              </>
            ) : ocupado ? (
              <span className="text-[13px] text-ink-2">Armando el pedido…</span>
            ) : (
              <span className="text-[13px] text-ink-3">—</span>
            )}
          </div>
        </div>

        {mejor && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="primary" disabled={ocupado} onClick={() => guardar(mejor)}>
              Guardar pedido
            </Button>
            <Button variant="outline" onClick={() => navegar("proveedores")}>
              Gestionar droguerías y listas
            </Button>
            <span className="text-[11.5px] text-ink-3">Envío por WhatsApp: próximamente · por ahora descarga la orden de cada droguería.</span>
          </div>
        )}

        {error && <p className="text-[13px] text-accent-ink">{error}</p>}
      </Card>

      {/* Ofertas de vencimiento corto (opt-in) + sin oferta */}
      {comp && comp.venc_corto_disponibles.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-warn-soft bg-warn-soft/40 p-[18px_20px]">
          <p className="text-[12.5px] font-semibold text-warn">Ofertas de vencimiento corto (no se eligen solas):</p>
          {comp.venc_corto_disponibles.map((v) => (
            <label key={v.producto_id} className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={aceptar.has(v.producto_id)} onChange={() => alternarAceptar(v.producto_id)} />
              aceptar venc. corto de <b className="text-ink">{v.nombre}</b>
            </label>
          ))}
        </div>
      )}
      {comp && comp.sin_oferta.length > 0 && (
        <p className="text-[12px] text-warn">
          Sin oferta en ninguna droguería: {comp.sin_oferta.map((s) => s.nombre).join(", ")}. (Cárgalas o matchéalas en Proveedores.)
        </p>
      )}

      {/* b) Un bloque por droguería (mejor combo) */}
      {q === null ? (
        <EmptyState title="Elige una botica" subtitle="El pedido se arma por botica." />
      ) : base.cargando ? (
        <p className="p-6 text-center text-[13px] text-ink-3">Cargando faltantes…</p>
      ) : items.length === 0 ? (
        <EmptyState title="Sin faltantes" subtitle="Ajusta los mínimos en Inventario o agrega productos abajo para armar un pedido." />
      ) : ocupado && !comp ? (
        <p className="p-6 text-center text-[13px] text-ink-3">Comparando droguerías…</p>
      ) : comp && comp.top3.length === 0 ? (
        <EmptyState
          title="Ninguna lista cubre estos productos"
          subtitle="Ve a Proveedores → Matchear para cruzar las listas de tus droguerías con tu catálogo."
        />
      ) : mejor ? (
        <>
          <SectionLabel>El pedido, por droguería</SectionLabel>
          {mejor.proveedores.map((p) => (
            <BloqueDroguería key={p.id} p={p} dias={diasPorProv.get(p.id) ?? null} />
          ))}
          {mejor.sin_cubrir.length > 0 && (
            <p className="text-[12px] text-warn">No cubre: {mejor.sin_cubrir.map((s) => s.nombre).join(", ")}</p>
          )}
          {comp && comp.top3.length > 1 && <Alternativas top3={comp.top3} ocupado={ocupado} onUsar={guardar} />}
        </>
      ) : null}

      {/* Descargas de la orden (tras guardar) — CSV por droguería, flujo real */}
      {guardado && (
        <div className="flex flex-col gap-2 rounded-[12px] border border-ok bg-ok-soft/50 p-[18px_20px]">
          <p className="text-[13px] font-bold text-ok">Pedido guardado. Descarga la orden de cada droguería:</p>
          <div className="flex flex-wrap gap-2">
            {guardado.proveedores.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                size="sm"
                onClick={() =>
                  void descargarCsv(`/pedidos/${guardado.id}/csv?proveedor_id=${p.id}`, `pedido-${p.nombre.replace(/\s+/g, "-").toLowerCase()}.csv`)
                }
              >
                Descargar CSV · {p.nombre}
              </Button>
            ))}
          </div>
          <p className="text-[11.5px] text-ink-3">El envío a la droguería (WhatsApp/llamada) lo haces tú con ese archivo.</p>
        </div>
      )}

      {/* Necesidades editables (paso preservado, colapsado) */}
      <details className="group">
        <summary className="cursor-pointer list-none text-[12.5px] font-semibold text-link hover:text-link-hover">
          Ajustar lo que se pedirá ({necesidadesValidas.length} producto/s) ▾
        </summary>
        <Card className="mt-2 gap-2">
          {items.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">Sin faltantes. Agrega un producto del catálogo abajo.</p>
          ) : (
            <ul className="divide-y divide-line-row">
              {items.map((it, i) => (
                <li key={it.producto_id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="max-w-[55%] truncate text-[13px] text-ink">{it.nombre}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={it.unidades_base}
                      onChange={(e) =>
                        setItems((xs) => xs.map((x, j) => (j === i ? { ...x, unidades_base: Math.max(0, Number(e.target.value) || 0) } : x)))
                      }
                      className="w-20 text-right font-mono tabular-nums"
                    />
                    <span className="text-[11.5px] text-ink-3">u.</span>
                    <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="text-[13px] text-accent-ink/70 hover:text-accent-ink">
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <AgregarNecesidad yaEn={new Set(items.map((i) => i.producto_id))} onAgregar={(n) => setItems((xs) => [...xs, n])} />
          <Button variant="primary" disabled={ocupado || necesidadesValidas.length === 0} onClick={() => comparar()} className="mt-1 self-start">
            {ocupado ? "Recalculando…" : "Recalcular pedido"}
          </Button>
        </Card>
      </details>

      {/* c) Listas de precios (frescura) */}
      <ListasPrecios cargando={listas.cargando} listas={listas.data?.listas ?? []} />
    </div>
  );
}

// Un bloque por droguería: cabecera (nombre + mínimo/flete real + subtotal) + tabla de líneas.
function BloqueDroguería({ p, dias }: { p: ProvEnCombo; dias: number | null }) {
  return (
    <Card className="gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line-hoy pb-3">
        <div>
          <div className="text-[14.5px] font-bold text-ink">{p.nombre}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">{dias != null ? `Entrega en ${dias} día(s)` : "Entrega: próximamente"}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {p.cumple_minimo ? (
              <Chip variant="ok">Mínimo {solesCent(p.monto_minimo_cent)} ✓</Chip>
            ) : (
              <Chip variant="warn">Faltan {solesCent(p.faltan_minimo_cent)} para el mínimo {solesCent(p.monto_minimo_cent)}</Chip>
            )}
            <span className="text-[11.5px] text-ink-3">Flete {solesCent(p.flete_cent)}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-table">Subtotal</div>
          <div className="text-[16px] font-bold tabular-nums text-ink">{solesCent(p.subtotal_cent)}</div>
        </div>
      </div>

      <TableHead cols={COLS}>
        <Th>Producto</Th>
        <Th align="right">Cantidad</Th>
        <Th align="right">Precio</Th>
        <Th align="right">Subtotal</Th>
      </TableHead>
      {p.renglones.map((r) => (
        <TableRow key={r.producto_id} cols={COLS}>
          <Td className="truncate text-[13px] font-semibold text-ink">
            {r.nombre ?? r.producto_nombre}
            {r.venc_corto ? <span className="ml-1 text-warn">· venc. corto</span> : null}
          </Td>
          <Td align="right" className="text-[12.5px] tabular-nums text-ink-2">
            {r.unidades_prov} × {r.factor_unidades}
          </Td>
          <Td align="right" className="font-mono text-[12.5px] tabular-nums text-ink-emph">
            {solesCent(r.precio_cent)}
          </Td>
          <Td align="right" className="font-mono text-[13px] tabular-nums text-ink">
            {solesCent(r.renglon_cent)}
          </Td>
        </TableRow>
      ))}
      <p className="text-[11.5px] text-ink-3">Por qué esta droguería y el ahorro por línea: próximamente.</p>
    </Card>
  );
}

// Alternativas (combos 2/3): total + cuánto más caro vs el mejor + usar esa opción (preserva la elección).
function Alternativas({ top3, ocupado, onUsar }: { top3: ComboTop[]; ocupado: boolean; onUsar: (c: ComboTop) => void }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-[12.5px] font-semibold text-link hover:text-link-hover">
        Otras opciones ({top3.length - 1}) ▾
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {top3.slice(1).map((c) => (
          <Card key={c.proveedor_ids.join()}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-ink">{c.proveedores.map((p) => p.nombre).join(" + ")}</div>
                <div className="mt-0.5 text-[12px] text-ink-3">
                  {c.proveedores.length} droguería(s) · cobertura {Math.round(c.cobertura * 100)}%
                  {c.delta_cent > 0 ? ` · +${solesCent(c.delta_cent)} vs el mejor` : ""}
                  {!c.valido ? " · no llega a un mínimo" : ""}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[14px] font-bold tabular-nums text-ink">{solesCent(c.total_cent)}</span>
                <Button variant="outline" size="sm" disabled={ocupado} onClick={() => onUsar(c)}>
                  Usar esta opción
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </details>
  );
}

// Listas de precios con frescura: última lista por droguería + chip al día (≤14 días) / vieja.
function ListasPrecios({ cargando, listas }: { cargando: boolean; listas: ListaFrescura[] }) {
  const ultimaPorProv = useMemo(() => {
    const m = new Map<string, ListaFrescura>();
    for (const l of listas) {
      const prev = m.get(l.proveedor_id);
      if (!prev || Date.parse(l.created_at || l.fecha_lista) > Date.parse(prev.created_at || prev.fecha_lista)) m.set(l.proveedor_id, l);
    }
    return [...m.values()];
  }, [listas]);

  return (
    <Card className="gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[13.5px] font-bold text-ink">Listas de precios</div>
          <p className="mt-0.5 text-[12.5px] text-ink-2">El pedido sugerido es tan bueno como estas listas. Mantenlas frescas.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navegar("proveedores")}>
          Subir lista
        </Button>
      </div>
      {cargando ? (
        <p className="p-4 text-center text-[13px] text-ink-3">Cargando listas…</p>
      ) : ultimaPorProv.length === 0 ? (
        <EmptyState title="Sin listas todavía" subtitle="Sube la lista de precios de una droguería en Proveedores." />
      ) : (
        <ul className="divide-y divide-line-row">
          {ultimaPorProv.map((l) => {
            const dias = diasDesde(l.created_at || l.fecha_lista);
            const vieja = dias > 14;
            return (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <span className="text-[13px] font-semibold text-ink">{l.proveedor_nombre}</span>
                  <span className="ml-2 text-[12px] text-ink-3">actualizada {haceTexto(dias)}</span>
                </div>
                {vieja ? <Chip variant="warn">vieja — pídele la nueva</Chip> : <Chip variant="ok">al día</Chip>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function AgregarNecesidad({ yaEn, onAgregar }: { yaEn: Set<string>; onAgregar: (n: Necesidad) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const busq = useApi<{ productos: { id: string; nombre: string }[] }>(
    abierto && q.trim().length >= 2 ? `/catalogo/productos?q=${encodeURIComponent(q.trim())}` : null,
    [q],
  );
  if (!abierto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)} className="self-start">
        ＋ agregar producto
      </Button>
    );
  }
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto del catálogo…" autoFocus />
      {busq.data && (
        <ul className="max-h-40 divide-y divide-line-row overflow-y-auto">
          {busq.data.productos
            .filter((p) => !yaEn.has(p.id))
            .map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => {
                    onAgregar({ producto_id: p.id, nombre: p.nombre, unidades_base: 10 });
                    setQ("");
                    setAbierto(false);
                  }}
                  className="w-full rounded-[8px] px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover-btn"
                >
                  ＋ {p.nombre}
                </button>
              </li>
            ))}
        </ul>
      )}
      <button onClick={() => setAbierto(false)} className="text-[12px] text-ink-3 underline">
        cerrar
      </button>
    </div>
  );
}

// Tiempo relativo (frescura de listas). ISO/fecha → días transcurridos.
function diasDesde(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
function haceTexto(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "hace 1 día";
  return `hace ${dias} días`;
}
