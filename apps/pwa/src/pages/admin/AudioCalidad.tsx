import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Cargando, ErrorMsg, Vacio } from "../../components/Estados";
import { SelectorProducto, type ProductoRef } from "../../components/SelectorProducto";
import type { SesionActiva } from "../../lib/tipos";

// Panel de calidad del audio del A10 (B10.3, admin+). Tres trabajos: (1) ver la salud del audio por día
// (transcritos/errores/sin voz/señales), (2) enseñar el nombre correcto de los faltantes que no
// matchearon el catálogo → alimenta las correcciones aprendidas y re-matchea las señales pendientes,
// (3) curar el diccionario de correcciones. Todo es vocabulario del tenant, jamás personal (VETO D-N5).

type CalidadDia = {
  fecha: string;
  transcritos: number; procesados: number; errores: number; sin_habla: number;
  senales: number; senales_sin_match: number; senales_baja_conf: number;
};
type SinMatch = { id: string; nombre_detectado: string; confianza: number; created_at: string };
type ErrorReciente = { id: string; error_detalle: string | null; created_at: string };
type Reporte = { dias: CalidadDia[]; sin_match: SinMatch[]; errores: ErrorReciente[] };
type Correccion = { id: string; texto_norm: string; producto_id: string; producto_nombre: string | null; veces: number; updated_at: string };
type Sucursal = { id: string; nombre: string };

export function AudioCalidad({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [sucSel, setSucSel] = useState<string>("");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel : (sesion.usuario.sucursalId ?? "");
  const listo = !esSuper || !!suc;
  const qSuc = esSuper && suc ? `?sucursal_id=${suc}` : "";

  const reporte = useApi<Reporte>(listo ? `/audio/calidad${qSuc ? `${qSuc}&` : "?"}dias=7` : null, [suc]);
  const correcciones = useApi<{ correcciones: Correccion[] }>(listo ? "/audio/correcciones" : null, [suc]);

  const [aviso, setAviso] = useState<string | null>(null);

  function recargar() {
    reporte.recargar();
    correcciones.recargar();
  }

  return (
    <div className="max-w-3xl mx-auto w-full space-y-4 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">📈 Calidad del audio</h1>
        <p className="text-xs opacity-60">Salud del audio del mostrador y corrección de nombres que el sistema no reconoció.</p>
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm">
          <option value="">— Elige una sucursal —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {aviso && <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded p-2">{aviso}</p>}

      {!listo ? (
        <Vacio>Elige una sucursal para ver su calidad de audio.</Vacio>
      ) : (
        <>
          <ResumenDias r={reporte} />
          <SinMatchLista
            r={reporte}
            qSuc={qSuc}
            onEnsenado={(n) => { setAviso(n > 0 ? `Corrección aprendida y ${n} señal(es) actualizada(s).` : "Corrección aprendida."); recargar(); }}
            onError={(m) => setAviso(m)}
          />
          <CorreccionesLista c={correcciones} onBorrado={() => { setAviso("Corrección borrada."); recargar(); }} />
          <ErroresLista r={reporte} />
        </>
      )}
    </div>
  );
}

function ResumenDias({ r }: { r: ReturnType<typeof useApi<Reporte>> }) {
  return (
    <section className="bg-white/5 rounded-lg border border-white/10 p-3">
      <h2 className="text-sm font-semibold mb-2">Resumen (7 días)</h2>
      {r.cargando ? (
        <Cargando que="reporte" />
      ) : r.error ? (
        <ErrorMsg msg={r.error} onReintentar={r.recargar} />
      ) : (r.data?.dias.length ?? 0) === 0 ? (
        <Vacio>Sin datos de audio todavía.</Vacio>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="opacity-60 text-left">
              <tr>
                <th className="py-1 pr-2">Día</th>
                <th className="py-1 px-2 text-right">Transcritos</th>
                <th className="py-1 px-2 text-right">Errores</th>
                <th className="py-1 px-2 text-right">Sin voz</th>
                <th className="py-1 px-2 text-right">Señales</th>
                <th className="py-1 px-2 text-right">Sin match</th>
                <th className="py-1 pl-2 text-right">Baja conf.</th>
              </tr>
            </thead>
            <tbody>
              {r.data!.dias.map((d, i) => (
                <tr key={d.fecha} className={`border-t border-white/5 ${i === 0 ? "font-semibold" : ""}`}>
                  <td className="py-1 pr-2">{i === 0 ? `${d.fecha} (hoy)` : d.fecha}</td>
                  <td className="py-1 px-2 text-right">{d.transcritos}</td>
                  <td className={`py-1 px-2 text-right ${d.errores > 0 ? "text-red-300" : ""}`}>{d.errores}</td>
                  <td className="py-1 px-2 text-right opacity-70">{d.sin_habla}</td>
                  <td className="py-1 px-2 text-right">{d.senales}</td>
                  <td className={`py-1 px-2 text-right ${d.senales_sin_match > 0 ? "text-amber-300" : ""}`}>{d.senales_sin_match}</td>
                  <td className="py-1 pl-2 text-right opacity-70">{d.senales_baja_conf}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SinMatchLista({ r, qSuc, onEnsenado, onError }: { r: ReturnType<typeof useApi<Reporte>>; qSuc: string; onEnsenado: (n: number) => void; onError: (m: string) => void }) {
  const items = r.data?.sin_match ?? [];
  return (
    <section className="bg-white/5 rounded-lg border border-white/10 p-3">
      <h2 className="text-sm font-semibold">Nombres sin reconocer</h2>
      <p className="text-xs opacity-60 mb-2">Faltantes que el audio oyó pero no calzaron ningún producto. Asígnales el correcto: el sistema lo aprende para la próxima.</p>
      {items.length === 0 ? (
        <Vacio>Nada pendiente de reconocer. 👌</Vacio>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <FilaSinMatch key={s.id} s={s} qSuc={qSuc} onEnsenado={onEnsenado} onError={onError} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilaSinMatch({ s, qSuc, onEnsenado, onError }: { s: SinMatch; qSuc: string; onEnsenado: (n: number) => void; onError: (m: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function asignar(p: ProductoRef) {
    setOcupado(true);
    try {
      const r = await mutar<{ senales_actualizadas: number }>(`/audio/correcciones${qSuc}`, { method: "POST", body: { texto: s.nombre_detectado, producto_id: p.id } });
      setAbierto(false);
      onEnsenado(r.senales_actualizadas ?? 0);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="rounded border border-white/10 bg-black/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">“{s.nombre_detectado}”</p>
          <p className="text-[11px] opacity-50">{Math.round(s.confianza * 100)}% seguro · {s.created_at.slice(0, 16).replace("T", " ")}</p>
        </div>
        <button onClick={() => setAbierto((v) => !v)} disabled={ocupado} className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 shrink-0 disabled:opacity-40">
          {abierto ? "Cerrar" : "Asignar producto"}
        </button>
      </div>
      {abierto && (
        <div className="mt-2">
          <SelectorProducto onSelect={(p) => void asignar(p)} placeholder="Buscar el producto correcto..." />
        </div>
      )}
    </li>
  );
}

function CorreccionesLista({ c, onBorrado }: { c: ReturnType<typeof useApi<{ correcciones: Correccion[] }>>; onBorrado: () => void }) {
  async function borrar(id: string) {
    try {
      await mutar(`/audio/correcciones/${id}`, { method: "DELETE" });
      onBorrado();
    } catch {
      /* si falla, el recargar del padre no corre; el usuario reintenta */
    }
  }
  const items = c.data?.correcciones ?? [];
  return (
    <section className="bg-white/5 rounded-lg border border-white/10 p-3">
      <h2 className="text-sm font-semibold">Correcciones aprendidas</h2>
      <p className="text-xs opacity-60 mb-2">Lo que el sistema ya sabe: forma oída → producto. Borra una si quedó mal.</p>
      {c.cargando ? (
        <Cargando que="correcciones" />
      ) : items.length === 0 ? (
        <Vacio>Aún no hay correcciones. Se aprenden al confirmar o asignar productos.</Vacio>
      ) : (
        <ul className="divide-y divide-white/5">
          {items.map((x) => (
            <li key={x.id} className="py-1.5 flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-mono opacity-70">“{x.texto_norm}”</span> → {x.producto_nombre ?? <span className="opacity-40">(producto eliminado)</span>}
                {x.veces > 1 && <span className="text-[11px] opacity-50"> ·{x.veces}×</span>}
              </span>
              <button onClick={() => void borrar(x.id)} className="text-xs px-2 py-1 rounded text-red-300 hover:bg-red-500/20 shrink-0">borrar</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ErroresLista({ r }: { r: ReturnType<typeof useApi<Reporte>> }) {
  const items = r.data?.errores ?? [];
  if (items.length === 0) return null;
  return (
    <section className="bg-white/5 rounded-lg border border-white/10 p-3">
      <h2 className="text-sm font-semibold mb-2">Errores recientes</h2>
      <ul className="space-y-1 text-xs">
        {items.map((e) => (
          <li key={e.id} className="flex justify-between gap-2 text-red-300/80">
            <span className="truncate">{e.error_detalle ?? "error"}</span>
            <span className="opacity-50 shrink-0">{e.created_at.slice(0, 16).replace("T", " ")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
