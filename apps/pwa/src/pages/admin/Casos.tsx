import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Cargando, ErrorMsg, Vacio } from "../../components/Estados";
import { fechaCorta } from "../../lib/fecha-ui";
import type { SesionActiva } from "../../lib/tipos";

// B11 — Bandeja de casos (EBR determinista) + pestaña "Personal" (espejo operativo). El sistema INFORMA;
// el admin confirma/descarta. Todo desde datos POS; el audio JAMÁS entra aquí (veto D-N5). Los clips de
// cámara (B11.3) llegan cuando se configure la cámara (T-K3): por ahora el caso queda listo para revisar.

type Caso = {
  id: string; tipo: string; indicador: string; severidad: number; estado: string;
  evidencia: Record<string, unknown>; revisor_id: string | null; notas: string | null; created_at: string; resuelto_at: string | null;
};
type Operador = {
  operador_id: string; operador_nombre: string; ventas: number; total_cent: number; ticket_cent: number;
  ventas_por_hora: number; servicio_prom_seg: number | null; anuladas: number; tasa_anulacion: number;
  cajon_sin_venta: number; cierres: number; faltante_cent: number; dias_activos: number;
};
type Espejo = { dias: number; operadores: Operador[]; promedio: { ticket_cent: number; ventas_por_hora: number; servicio_prom_seg: number | null; tasa_anulacion: number; cajon_sin_venta: number } };
type Sucursal = { id: string; nombre: string };

const IND_LABEL: Record<string, string> = {
  cajon_sin_venta: "Cajón sin venta",
  anulaciones: "Anulaciones anómalas",
  venta_bajo_precio: "Venta bajo precio",
  descuadre: "Descuadre de caja",
  stock_negativo: "Stock negativo",
  fuera_horario: "Venta fuera de horario",
  merma_conteo: "Merma por conteo",
};
const soles = (cent: number) => `S/${(cent / 100).toFixed(2)}`;
const servicio = (s: number | null) => (s === null ? "—" : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
const badgeSev = (n: number) =>
  n >= 3 ? "bg-red-500/20 text-red-300" : n >= 2 ? "bg-amber-500/20 text-amber-300" : "bg-white/10 text-white/60";

export function Casos({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [sucSel, setSucSel] = useState<string>("");
  const [tab, setTab] = useState<"casos" | "personal">("casos");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel : (sesion.usuario.sucursalId ?? "");
  const listo = !esSuper || !!suc;
  const qSuc = esSuper && suc ? `?sucursal_id=${suc}` : "";

  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const ok = (texto: string) => setAviso({ tipo: "ok", texto });
  const err = (texto: string) => setAviso({ tipo: "error", texto });

  return (
    <div className="max-w-3xl mx-auto w-full space-y-4 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">🚩 Casos</h1>
        <p className="text-xs opacity-60">Excepciones que el sistema detecta solo con los números del POS. Tú confirmas o descartas — nunca se sanciona automático.</p>
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm">
          <option value="">— Elige una sucursal —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      <div className="flex gap-1 text-sm">
        <button onClick={() => setTab("casos")} className={`px-3 py-1.5 rounded ${tab === "casos" ? "bg-white/15 font-semibold" : "opacity-60 hover:bg-white/5"}`}>Bandeja</button>
        <button onClick={() => setTab("personal")} className={`px-3 py-1.5 rounded ${tab === "personal" ? "bg-white/15 font-semibold" : "opacity-60 hover:bg-white/5"}`}>Personal</button>
      </div>

      {aviso && (
        <p className={`text-sm rounded p-2 border ${aviso.tipo === "error" ? "text-red-300 bg-red-500/10 border-red-500/30" : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"}`}>{aviso.texto}</p>
      )}

      {!listo ? (
        <Vacio>Elige una sucursal para ver sus casos.</Vacio>
      ) : tab === "casos" ? (
        <Bandeja qSuc={qSuc} sucKey={suc} onOk={ok} onErr={err} />
      ) : (
        <Personal qSuc={qSuc} sucKey={suc} />
      )}
    </div>
  );
}

function Bandeja({ qSuc, sucKey, onOk, onErr }: { qSuc: string; sucKey: string; onOk: (m: string) => void; onErr: (m: string) => void }) {
  const [estado, setEstado] = useState<"abierto" | "todos">("abierto");
  const q = `${qSuc}${qSuc ? "&" : "?"}estado=${estado}`;
  const casos = useApi<{ casos: Caso[] }>(`/casos${q}`, [sucKey, estado]);
  const items = casos.data?.casos ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 text-xs">
          <button onClick={() => setEstado("abierto")} className={`px-2 py-1 rounded ${estado === "abierto" ? "bg-white/15" : "opacity-60"}`}>Abiertos</button>
          <button onClick={() => setEstado("todos")} className={`px-2 py-1 rounded ${estado === "todos" ? "bg-white/15" : "opacity-60"}`}>Todos</button>
        </div>
        <button onClick={casos.recargar} className="text-xs opacity-60 hover:opacity-100">↻ recargar</button>
      </div>

      {casos.cargando ? (
        <Cargando que="casos" />
      ) : casos.error ? (
        <ErrorMsg msg={casos.error} onReintentar={casos.recargar} />
      ) : items.length === 0 ? (
        <Vacio>Sin casos {estado === "abierto" ? "abiertos" : ""}. 👌</Vacio>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <CasoCard key={c.id} c={c} qSuc={qSuc} onResuelto={(m) => { onOk(m); casos.recargar(); }} onError={onErr} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CasoCard({ c, qSuc, onResuelto, onError }: { c: Caso; qSuc: string; onResuelto: (m: string) => void; onError: (m: string) => void }) {
  const [notas, setNotas] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const resumen = (c.evidencia?.resumen as string | undefined) ?? IND_LABEL[c.indicador] ?? c.indicador;
  const abierto = c.estado === "abierto";

  async function resolver(accion: "confirmar" | "descartar") {
    setOcupado(true);
    try {
      await mutar(`/casos/${c.id}/${accion}${qSuc}`, { method: "POST", body: { notas: notas.trim() || undefined } });
      onResuelto(accion === "confirmar" ? "Caso confirmado." : "Caso descartado.");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="rounded border border-white/10 bg-white/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badgeSev(c.severidad)}`}>SEV {c.severidad}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 opacity-80">{c.tipo === "perdida" ? "Pérdida" : "Personal"}</span>
            <span className="text-xs font-semibold">{IND_LABEL[c.indicador] ?? c.indicador}</span>
          </div>
          <p className="text-sm mt-1">{resumen}</p>
          <p className="text-[11px] opacity-40 mt-0.5">{fechaCorta(c.created_at)} · {c.estado}{c.revisor_id ? " · revisado" : ""}</p>
        </div>
      </div>
      {/* B11.3: el clip de cámara se habilita cuando se configure la Hikvision (T-K3). */}
      <p className="text-[11px] opacity-30 mt-1">🎥 Clip de cámara: disponible al configurar la cámara (T-K3).</p>
      {abierto && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Nota (opcional)" className="flex-1 min-w-[8rem] px-2 py-1 rounded bg-black/20 border border-white/10 outline-none text-xs" />
          <button onClick={() => void resolver("confirmar")} disabled={ocupado} className="text-xs px-3 py-1 rounded bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 disabled:opacity-40">Confirmar</button>
          <button onClick={() => void resolver("descartar")} disabled={ocupado} className="text-xs px-3 py-1 rounded hover:bg-white/10 disabled:opacity-40">Descartar</button>
        </div>
      )}
      {!abierto && c.notas && <p className="text-[11px] opacity-60 mt-1 italic">“{c.notas}”</p>}
    </li>
  );
}

function Personal({ qSuc, sucKey }: { qSuc: string; sucKey: string }) {
  const [dias, setDias] = useState(30);
  const q = `${qSuc}${qSuc ? "&" : "?"}dias=${dias}`;
  const espejo = useApi<Espejo>(`/casos/espejo${q}`, [sucKey, dias]);
  const d = espejo.data;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs opacity-60">Por operador vs el promedio de esta botica. Informa; no sanciona.</p>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="text-xs px-2 py-1 rounded bg-white/5 border border-white/10 outline-none">
          <option value={7}>7 días</option>
          <option value={30}>30 días</option>
        </select>
      </div>

      {espejo.cargando ? (
        <Cargando que="espejo" />
      ) : espejo.error ? (
        <ErrorMsg msg={espejo.error} onReintentar={espejo.recargar} />
      ) : !d || d.operadores.length === 0 ? (
        <Vacio>Sin ventas de operadores en el periodo.</Vacio>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="opacity-60 text-left bg-white/5">
              <tr>
                <th className="py-1.5 px-2">Operador</th>
                <th className="py-1.5 px-2 text-right">Ventas</th>
                <th className="py-1.5 px-2 text-right">Ticket</th>
                <th className="py-1.5 px-2 text-right">V/hora</th>
                <th className="py-1.5 px-2 text-right">Servicio</th>
                <th className="py-1.5 px-2 text-right">Anul.</th>
                <th className="py-1.5 px-2 text-right">Cajón</th>
                <th className="py-1.5 px-2 text-right">Faltante</th>
              </tr>
            </thead>
            <tbody>
              {d.operadores.map((o) => (
                <tr key={o.operador_id} className="border-t border-white/5">
                  <td className="py-1.5 px-2 font-medium">{o.operador_nombre}</td>
                  <td className="py-1.5 px-2 text-right">{o.ventas}</td>
                  <td className="py-1.5 px-2 text-right">{soles(o.ticket_cent)}</td>
                  <td className="py-1.5 px-2 text-right">{o.ventas_por_hora.toFixed(1)}</td>
                  <td className="py-1.5 px-2 text-right">{servicio(o.servicio_prom_seg)}</td>
                  <td className={`py-1.5 px-2 text-right ${o.tasa_anulacion > d.promedio.tasa_anulacion * 1.5 && o.anuladas > 0 ? "text-amber-300" : ""}`}>{o.anuladas} ({(o.tasa_anulacion * 100).toFixed(0)}%)</td>
                  <td className={`py-1.5 px-2 text-right ${o.cajon_sin_venta > d.promedio.cajon_sin_venta * 1.5 && o.cajon_sin_venta > 0 ? "text-amber-300" : ""}`}>{o.cajon_sin_venta}</td>
                  <td className={`py-1.5 px-2 text-right ${o.faltante_cent < 0 ? "text-red-300" : "opacity-50"}`}>{o.faltante_cent < 0 ? soles(o.faltante_cent) : "—"}</td>
                </tr>
              ))}
              <tr className="border-t border-white/20 opacity-70">
                <td className="py-1.5 px-2 italic">Promedio botica</td>
                <td className="py-1.5 px-2 text-right">—</td>
                <td className="py-1.5 px-2 text-right">{soles(d.promedio.ticket_cent)}</td>
                <td className="py-1.5 px-2 text-right">{d.promedio.ventas_por_hora.toFixed(1)}</td>
                <td className="py-1.5 px-2 text-right">{servicio(d.promedio.servicio_prom_seg)}</td>
                <td className="py-1.5 px-2 text-right">{(d.promedio.tasa_anulacion * 100).toFixed(0)}%</td>
                <td className="py-1.5 px-2 text-right">{d.promedio.cajon_sin_venta.toFixed(1)}</td>
                <td className="py-1.5 px-2 text-right">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
