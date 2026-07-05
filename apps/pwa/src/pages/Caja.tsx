import { useState } from "react";
import { solesStrACent } from "@huayruro/shared";
import { useApi, mutar } from "../lib/useApi";
import { ahoraFecha } from "../lib/fecha-ui";
import { solesCent } from "../lib/money";
import { Cargando, ErrorMsg, Vacio } from "../components/Estados";
import type { SesionActiva } from "../lib/tipos";

type ResumenDia = { fecha: string; por_metodo: Record<string, number>; total_sistema_cent: number; num_ventas: number };
type Cierre = { id: string; fecha: string; total_efectivo_cent: number; total_yape_cent: number; total_otros_cent: number; total_sistema_cent: number; diferencia_cent: number; cerrado_at: string };

const aCent = (s: string): number => {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 0;
  try {
    return solesStrACent(t);
  } catch {
    return 0;
  }
};

const METODO_LABEL: Record<string, string> = { efectivo: "Efectivo", yape: "Yape", plin: "Plin", tarjeta: "Tarjeta", transferencia: "Transferencia", otro: "Otro" };

export function Caja({ sesion }: { sesion: SesionActiva }) {
  const [fecha, setFecha] = useState(ahoraFecha());
  const puedeCerrar = sesion.usuario.rol === "admin_sucursal" || sesion.usuario.rol === "super_admin";
  const dia = useApi<ResumenDia>(`/caja/dia?fecha=${fecha}`, [fecha]);
  const historial = useApi<{ cierres: Cierre[] }>(`/caja/cierres`);

  const [efectivo, setEfectivo] = useState("");
  const [yape, setYape] = useState("");
  const [otros, setOtros] = useState("");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const contadoCent = aCent(efectivo) + aCent(yape) + aCent(otros);
  const sistemaCent = dia.data?.total_sistema_cent ?? 0;
  const difPreview = contadoCent - sistemaCent;

  async function cerrar() {
    setEnviando(true);
    setMsg(null);
    try {
      const r = await mutar<{ diferencia_cent: number }>("/caja/cierres", {
        method: "POST",
        body: { fecha, total_efectivo_cent: aCent(efectivo), total_yape_cent: aCent(yape), total_otros_cent: aCent(otros), observaciones: obs.trim() || null },
      });
      setMsg({ ok: true, texto: `Caja cerrada. Diferencia: ${solesCent(r.diferencia_cent)}` });
      setEfectivo("");
      setYape("");
      setOtros("");
      setObs("");
      historial.recargar();
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Caja</h1>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="px-3 py-1.5 rounded bg-white/5 border border-white/10 outline-none text-sm" />
      </div>

      <section className="bg-white/5 rounded-lg border border-white/10 p-4">
        {dia.cargando ? (
          <Cargando que="caja" />
        ) : dia.error ? (
          <ErrorMsg msg={dia.error} onReintentar={dia.recargar} />
        ) : (
          <>
            <p className="text-sm opacity-60">{dia.data!.num_ventas} venta(s) completadas</p>
            <ul className="mt-2 space-y-1">
              {Object.entries(dia.data!.por_metodo).map(([m, cent]) => (
                <li key={m} className="flex justify-between text-sm">
                  <span className="opacity-80">{METODO_LABEL[m] ?? m}</span>
                  <span className="font-mono">{solesCent(cent)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-white/10 flex justify-between font-bold">
              <span>Total sistema</span>
              <span className="font-mono">{solesCent(sistemaCent)}</span>
            </div>
          </>
        )}
      </section>

      {puedeCerrar && (
        <section className="bg-white/5 rounded-lg border border-white/10 p-4 space-y-3">
          <h2 className="font-semibold">Cerrar caja del día</h2>
          <div className="grid grid-cols-3 gap-2">
            <Campo label="Efectivo" value={efectivo} onChange={setEfectivo} />
            <Campo label="Yape/Plin" value={yape} onChange={setYape} />
            <Campo label="Otros" value={otros} onChange={setOtros} />
          </div>
          <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observaciones (opcional)" className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 outline-none text-sm" />
          <div className="flex items-center justify-between text-sm">
            <span className="opacity-70">Contado {solesCent(contadoCent)} · Sistema {solesCent(sistemaCent)}</span>
            <span className={`font-mono ${difPreview === 0 ? "opacity-70" : difPreview > 0 ? "text-emerald-400" : "text-red-400"}`}>
              {difPreview >= 0 ? "Sobrante" : "Faltante"}: {solesCent(Math.abs(difPreview))}
            </span>
          </div>
          <button onClick={() => void cerrar()} disabled={enviando} className="w-full py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-40">
            {enviando ? "Cerrando..." : "Cerrar caja"}
          </button>
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.texto}</p>}
        </section>
      )}

      <section className="bg-white/5 rounded-lg border border-white/10">
        <header className="px-4 py-3 border-b border-white/10 font-semibold">Cierres recientes</header>
        {historial.cargando ? (
          <Cargando que="historial" />
        ) : (historial.data?.cierres.length ?? 0) === 0 ? (
          <Vacio>Aún no hay cierres.</Vacio>
        ) : (
          <ul className="divide-y divide-white/5">
            {historial.data!.cierres.map((c) => (
              <li key={c.id} className="p-3 flex items-center justify-between text-sm">
                <span>{c.fecha}</span>
                <span className="opacity-70">sistema {solesCent(c.total_sistema_cent)}</span>
                <span className={`font-mono ${c.diferencia_cent === 0 ? "opacity-70" : c.diferencia_cent > 0 ? "text-emerald-400" : "text-red-400"}`}>{solesCent(c.diferencia_cent)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Campo({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-sm">
      <span className="opacity-70">{label}</span>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" className="mt-1 w-full px-2 py-2 rounded bg-white/5 border border-white/10 outline-none font-mono text-sm" />
    </label>
  );
}
