import { useRef, useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Card, Button, Input, Chip, useToast } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// Catálogo de PRUEBA (B10.4.1, admin+). Promueve el catálogo maestro (SUSALUD — solo MEDICAMENTOS) a
// productos con 100u de stock, para que el matcher del audio tenga contra qué pegar durante el piloto.
// Es data de prueba: se carga por lotes (con barra de progreso) y se PURGA de un botón antes de cargar
// el catálogo real (T-K4). Aseo/perfumería NO están aquí (el maestro es solo medicamentos).

type Conteo = { productos_prueba: number; total_maestro: number };
type Pagina = { creados: number; omitidos: number; leidos: number; siguiente_desde: string | null; total_maestro: number };
type Sucursal = { id: string; nombre: string };
type Progreso = { creados: number; omitidos: number; leidos: number; total: number };

// Select nativo con el estilo del tema claro (no hay primitivo <Select> en el barrel).
const SELECT_CLS =
  "w-full box-border rounded-[9px] border border-line-input bg-field px-3 py-2.5 text-[13px] text-ink outline-none";

const CANT_PAGINA = 150; // productos por llamada (bajo el techo de subrequests del Worker)

export function CatalogoPrueba({ sesion }: { sesion: SesionActiva }) {
  const toast = useToast();
  const esSuper = sesion.usuario.rol === "super_admin";
  const [sucSel, setSucSel] = useState<string>("");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel : (sesion.usuario.sucursalId ?? "");
  const listo = !esSuper || !!suc;
  const qSuc = esSuper && suc ? `?sucursal_id=${suc}` : "";

  const conteo = useApi<Conteo>(listo ? `/catalogo/prueba/conteo${qSuc}` : null, [suc]);

  const [modo, setModo] = useState<"todo" | "n">("n");
  const [cantN, setCantN] = useState(2000);
  const [cargando, setCargando] = useState(false);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const cancelar = useRef(false);

  async function cargar() {
    setCargando(true);
    cancelar.current = false;
    const limite = modo === "todo" ? Infinity : Math.max(1, cantN);
    let desde = "";
    let creados = 0;
    let omitidos = 0;
    let leidos = 0;
    let total = conteo.data?.total_maestro ?? 0;
    try {
      // Sin `eslint-disable`: ESLint 9 ya permite `while (true)` (`checkLoops: allExceptWhileTrue`).
      while (true) {
        const r = await mutar<Pagina>(`/catalogo/prueba/cargar${qSuc}`, { method: "POST", body: { desde, cantidad: CANT_PAGINA } });
        creados += r.creados;
        omitidos += r.omitidos;
        leidos += r.leidos;
        total = r.total_maestro;
        setProgreso({ creados, omitidos, leidos, total });
        if (cancelar.current || !r.siguiente_desde || leidos >= limite) break;
        desde = r.siguiente_desde;
      }
      toast(`Listo: ${creados} producto(s) de prueba creado(s)${omitidos ? `, ${omitidos} ya existían` : ""}${cancelar.current ? " (cancelado)" : ""}.`);
    } catch (e) {
      toast(`Se detuvo: ${e instanceof Error ? e.message : String(e)}. Puedes reintentar — se retoma sin duplicar.`);
    } finally {
      setCargando(false);
      conteo.recargar();
    }
  }

  async function purgar() {
    if (!confirm("¿Purgar TODO el catálogo de prueba? Se borran los productos marcados como prueba (no el catálogo real).")) return;
    setCargando(true);
    try {
      const r = await mutar<{ productos: number }>("/catalogo/prueba/purgar", { method: "POST", body: {} });
      setProgreso(null);
      toast(`Purgado: ${r.productos} producto(s) de prueba borrados.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
      conteo.recargar();
    }
  }

  const total = conteo.data?.total_maestro ?? 0;
  const yaCargados = conteo.data?.productos_prueba ?? 0;
  const meta = modo === "todo" ? total : Math.min(cantN, total);
  const pct = progreso && meta > 0 ? Math.min(100, Math.round((progreso.leidos / Math.max(1, Math.min(meta, total))) * 100)) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Chip variant="neutral">piloto</Chip>
          <span className="text-[12px] text-ink-3">Herramienta avanzada del piloto</span>
        </div>
        <p className="text-[12px] text-ink-2">
          Sube el catálogo maestro de medicamentos con 100u de stock para que el audio del mostrador tenga
          contra qué reconocer productos durante el piloto. Es data de prueba: purgable antes del catálogo real.
        </p>
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className={SELECT_CLS}>
          <option value="">— Elige una sucursal —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {!listo ? (
        <p className="py-6 text-center text-[13px] text-ink-3">Elige una sucursal para cargar su catálogo de prueba.</p>
      ) : (
        <>
          <Card>
            <p className="text-[13px] text-ink">
              Productos de prueba cargados: <span className="font-semibold tabular-nums">{yaCargados.toLocaleString("es-PE")}</span>
              {" "}· Maestro disponible: <span className="font-semibold tabular-nums">{total.toLocaleString("es-PE")}</span> medicamentos
            </p>
            <p className="mt-1 text-[11px] text-ink-3">Aseo, perfumería y misceláneos no están en el maestro: van por el catálogo real o alta manual.</p>
          </Card>

          <Card className="gap-3">
            <h2 className="text-[13.5px] font-bold text-ink">Cargar</h2>
            <div className="flex flex-col gap-2 text-[13px] text-ink">
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-accent" checked={modo === "n"} onChange={() => setModo("n")} disabled={cargando} />
                Primeros
                <Input
                  type="number"
                  min={1}
                  max={total || 15181}
                  value={cantN}
                  onChange={(e) => setCantN(Math.max(1, Number(e.target.value) || 1))}
                  disabled={cargando || modo !== "n"}
                  className="w-24 tabular-nums"
                />
                medicamentos
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-accent" checked={modo === "todo"} onChange={() => setModo("todo")} disabled={cargando} />
                Todo el maestro (<span className="tabular-nums">{total.toLocaleString("es-PE")}</span>) — puede tardar varios minutos
              </label>
            </div>

            {progreso && (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-soft">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-[11px] tabular-nums text-ink-3">
                  {progreso.leidos.toLocaleString("es-PE")} leídos · {progreso.creados.toLocaleString("es-PE")} creados · {progreso.omitidos.toLocaleString("es-PE")} ya existían
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {!cargando ? (
                <Button onClick={() => void cargar()}>Cargar catálogo de prueba</Button>
              ) : (
                <Button variant="outline" onClick={() => { cancelar.current = true; }}>Detener</Button>
              )}
            </div>
          </Card>

          {esSuper && (
            <Card className="gap-2">
              <h2 className="text-[13.5px] font-bold text-accent-ink">Purgar</h2>
              <p className="text-[12px] text-ink-3">Borra todos los productos de prueba (no el catálogo real). Úsalo antes de cargar el catálogo real.</p>
              <Button variant="outline" size="sm" className="self-start" onClick={() => void purgar()} disabled={cargando}>
                Purgar catálogo de prueba
              </Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
