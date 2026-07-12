import { useEffect, useMemo, useRef, useState } from "react";
import { uuidv7 } from "@huayruro/shared";
import { useApi, mutar } from "../../lib/useApi";
import { Cargando, ErrorMsg, Vacio } from "../../components/Estados";
import { fechaCorta } from "../../lib/fecha-ui";
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

const soles = (cent: number) => `S/${(Math.abs(cent) / 100).toFixed(2)}`;
const badgeClase = (c?: Clase) => (c === "A" ? "bg-emerald-500/20 text-emerald-300" : c === "B" ? "bg-sky-500/20 text-sky-300" : "bg-white/10 text-white/50");

export function ConteoInventario({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [sucSel, setSucSel] = useState<string>("");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel : (sesion.usuario.sucursalId ?? "");
  const listo = !esSuper || !!suc;
  const qSuc = esSuper && suc ? `?sucursal_id=${suc}` : "";

  return (
    <div className="max-w-3xl mx-auto w-full space-y-4 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">🔢 Conteo de inventario</h1>
        <p className="text-xs opacity-60">Cuenta lo que hay en el anaquel y anótalo. Si no cuadra con el sistema, se ajusta solo y la diferencia queda registrada como posible pérdida.</p>
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm">
          <option value="">— Elige una sucursal —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {!listo ? <Vacio>Elige una sucursal para contar su inventario.</Vacio> : <Panel key={suc} qSuc={qSuc} />}
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

  return (
    <div className="space-y-4">
      {/* Resumen: IRA + merma del periodo */}
      {resumen.data && (
        <section className="grid grid-cols-3 gap-2">
          <Metrica etiqueta="Exactitud (IRA)" valor={resumen.data.ira_pct === null ? "—" : `${resumen.data.ira_pct}%`} nota={`${resumen.data.items_contados} items · 30 d`} />
          <Metrica etiqueta="Merma detectada" valor={soles(resumen.data.merma_cent)} nota="últimos 30 días" alerta={resumen.data.merma_cent < 0} />
          <Metrica etiqueta="Último conteo" valor={resumen.data.sesiones[0] ? fechaCorta(resumen.data.sesiones[0].created_at).slice(0, 5) : "—"} nota={resumen.data.sesiones[0] ? `${resumen.data.sesiones[0].items_contados} items` : "sin conteos"} />
        </section>
      )}

      {resultado && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <p className="font-semibold text-emerald-300">Conteo guardado ✓</p>
          <p className="opacity-80 mt-0.5">
            {resultado.items_contados} contados · {resultado.items_descuadrados} descuadrados
            {resultado.merma_valor_cent < 0 && <> · merma <span className="text-red-300">{soles(resultado.merma_valor_cent)}</span></>}
            {resultado.exceso_valor_cent > 0 && <> · sobrante <span className="text-emerald-300">{soles(resultado.exceso_valor_cent)}</span></>}
          </p>
          {resultado.items_descuadrados > 0 && <p className="text-[11px] opacity-60 mt-1">El stock ya se ajustó. Si la merma fue grande o se repite, verás un caso en 🚩 Casos.</p>}
          <button onClick={() => setResultado(null)} className="mt-2 text-xs opacity-60 hover:opacity-100">cerrar</button>
        </div>
      )}

      {aviso && (
        <p className={`text-sm rounded p-2 border ${aviso.tipo === "error" ? "text-red-300 bg-red-500/10 border-red-500/30" : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"}`}>{aviso.texto}</p>
      )}

      {/* Agregar un producto suelto (conteo libre) */}
      <section className="space-y-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Agregar otro producto a contar…"
          className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm focus:border-emerald-400"
        />
        {candidatos.length > 0 && (
          <ul className="rounded border border-white/10 bg-zinc-900 divide-y divide-white/5">
            {candidatos.map((p) => (
              <li key={p.producto_id}>
                <button onClick={() => agregar(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-white/5">{p.nombre}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Hoja de conteo (ciega: sin el stock del sistema) */}
      <section className="bg-white/5 rounded-lg border border-white/10">
        <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="font-semibold text-sm">Hoja de conteo {sugeridos.data && <span className="opacity-50 font-normal">({sugeridos.data.total_vencidos} sugeridos hoy)</span>}</span>
          {contadas.length > 0 && <span className="text-xs opacity-60">{contadas.length} anotados</span>}
        </header>

        {sugeridos.cargando ? (
          <Cargando que="lista de conteo" />
        ) : sugeridos.error ? (
          <ErrorMsg msg={sugeridos.error} onReintentar={sugeridos.recargar} />
        ) : hoja.length === 0 ? (
          <Vacio>Nada pendiente de contar hoy. Agrega un producto arriba para contarlo igual.</Vacio>
        ) : (
          <ul className="divide-y divide-white/5">
            {hoja.map((f) => (
              <li key={f.producto_id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  {f.clase && <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badgeClase(f.clase)}`}>{f.clase}</span>}
                  <span className="text-sm truncate">{f.nombre}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={f.contado}
                    onChange={(e) => setContado(f.producto_id, e.target.value)}
                    placeholder="contar"
                    className="w-24 px-2 py-1 rounded bg-black/20 border border-white/10 outline-none text-sm text-right focus:border-emerald-400"
                  />
                  <button onClick={() => quitar(f.producto_id)} className="text-xs opacity-40 hover:opacity-100" title="quitar de la hoja">✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {hoja.length > 0 && (
          <div className="p-3 border-t border-white/10">
            <button
              onClick={() => void guardar()}
              disabled={enviando || contadas.length === 0}
              className="w-full py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm disabled:opacity-40"
            >
              {enviando ? "Guardando…" : `Guardar conteo (${contadas.length})`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Metrica({ etiqueta, valor, nota, alerta }: { etiqueta: string; valor: string; nota: string; alerta?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] opacity-50">{etiqueta}</p>
      <p className={`text-lg font-bold ${alerta ? "text-red-300" : ""}`}>{valor}</p>
      <p className="text-[10px] opacity-40">{nota}</p>
    </div>
  );
}
