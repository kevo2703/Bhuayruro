import { useRef, useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Vacio } from "../../components/Estados";
import type { SesionActiva } from "../../lib/tipos";

// Catálogo de PRUEBA (B10.4.1, admin+). Promueve el catálogo maestro (SUSALUD — solo MEDICAMENTOS) a
// productos con 100u de stock, para que el matcher del audio tenga contra qué pegar durante el piloto.
// Es data de prueba: se carga por lotes (con barra de progreso) y se PURGA de un botón antes de cargar
// el catálogo real (T-K4). Aseo/perfumería NO están aquí (el maestro es solo medicamentos).

type Conteo = { productos_prueba: number; total_maestro: number };
type Pagina = { creados: number; omitidos: number; leidos: number; siguiente_desde: string | null; total_maestro: number };
type Sucursal = { id: string; nombre: string };
type Progreso = { creados: number; omitidos: number; leidos: number; total: number };

const CANT_PAGINA = 150; // productos por llamada (bajo el techo de subrequests del Worker)

export function CatalogoPrueba({ sesion }: { sesion: SesionActiva }) {
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
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const cancelar = useRef(false);
  const ok = (texto: string) => setAviso({ tipo: "ok", texto });
  const err = (texto: string) => setAviso({ tipo: "error", texto });

  async function cargar() {
    setCargando(true);
    setAviso(null);
    cancelar.current = false;
    const limite = modo === "todo" ? Infinity : Math.max(1, cantN);
    let desde = "";
    let creados = 0;
    let omitidos = 0;
    let leidos = 0;
    let total = conteo.data?.total_maestro ?? 0;
    try {
      // eslint-disable-next-line no-constant-condition
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
      ok(`Listo: ${creados} producto(s) de prueba creado(s)${omitidos ? `, ${omitidos} ya existían` : ""}${cancelar.current ? " (cancelado)" : ""}.`);
    } catch (e) {
      err(`Se detuvo: ${e instanceof Error ? e.message : String(e)}. Puedes reintentar — se retoma sin duplicar.`);
    } finally {
      setCargando(false);
      conteo.recargar();
    }
  }

  async function purgar() {
    if (!confirm("¿Purgar TODO el catálogo de prueba? Se borran los productos marcados como prueba (no el catálogo real).")) return;
    setCargando(true);
    setAviso(null);
    try {
      const r = await mutar<{ productos: number }>("/catalogo/prueba/purgar", { method: "POST", body: {} });
      setProgreso(null);
      ok(`Purgado: ${r.productos} producto(s) de prueba borrados.`);
    } catch (e) {
      err(e instanceof Error ? e.message : String(e));
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
    <div className="max-w-2xl mx-auto w-full space-y-4 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">🧪 Catálogo de prueba</h1>
        <p className="text-xs opacity-60">
          Sube el catálogo maestro de medicamentos con 100u de stock para que el audio del mostrador tenga
          contra qué reconocer productos durante el piloto. Es data de prueba: purgable antes del catálogo real.
        </p>
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm">
          <option value="">— Elige una sucursal —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {aviso && (
        <p className={`text-sm rounded p-2 border ${aviso.tipo === "error" ? "text-red-300 bg-red-500/10 border-red-500/30" : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"}`}>
          {aviso.texto}
        </p>
      )}

      {!listo ? (
        <Vacio>Elige una sucursal para cargar su catálogo de prueba.</Vacio>
      ) : (
        <>
          <section className="bg-white/5 rounded-lg border border-white/10 p-3 text-sm">
            <p>
              Productos de prueba cargados: <span className="font-semibold">{yaCargados.toLocaleString("es-PE")}</span>
              {" "}· Maestro disponible: <span className="font-semibold">{total.toLocaleString("es-PE")}</span> medicamentos
            </p>
            <p className="text-[11px] opacity-50 mt-1">Aseo, perfumería y misceláneos no están en el maestro: van por el catálogo real o alta manual.</p>
          </section>

          <section className="bg-white/5 rounded-lg border border-white/10 p-3 space-y-3">
            <h2 className="text-sm font-semibold">Cargar</h2>
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={modo === "n"} onChange={() => setModo("n")} disabled={cargando} />
                Primeros
                <input
                  type="number"
                  min={1}
                  max={total || 15181}
                  value={cantN}
                  onChange={(e) => setCantN(Math.max(1, Number(e.target.value) || 1))}
                  disabled={cargando || modo !== "n"}
                  className="w-24 px-2 py-1 rounded bg-white/5 border border-white/10 outline-none"
                />
                medicamentos
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={modo === "todo"} onChange={() => setModo("todo")} disabled={cargando} />
                Todo el maestro ({total.toLocaleString("es-PE")}) — puede tardar varios minutos
              </label>
            </div>

            {progreso && (
              <div>
                <div className="h-2 rounded bg-white/10 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[11px] opacity-60 mt-1">
                  {progreso.leidos.toLocaleString("es-PE")} leídos · {progreso.creados.toLocaleString("es-PE")} creados · {progreso.omitidos.toLocaleString("es-PE")} ya existían
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {!cargando ? (
                <button onClick={() => void cargar()} className="px-4 py-2 rounded bg-emerald-500 text-black text-sm font-semibold hover:bg-emerald-400">
                  Cargar catálogo de prueba
                </button>
              ) : (
                <button onClick={() => { cancelar.current = true; }} className="px-4 py-2 rounded border border-white/20 text-sm hover:bg-white/10">
                  Detener
                </button>
              )}
            </div>
          </section>

          {esSuper && (
            <section className="bg-red-500/5 rounded-lg border border-red-500/20 p-3">
              <h2 className="text-sm font-semibold text-red-200">Purgar</h2>
              <p className="text-xs opacity-60 mb-2">Borra todos los productos de prueba (no el catálogo real). Úsalo antes de cargar el catálogo real.</p>
              <button onClick={() => void purgar()} disabled={cargando} className="text-xs px-3 py-1.5 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-40">
                Purgar catálogo de prueba
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
