import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { navegar } from "../../lib/ruta";
import { Card, Button, SectionLabel, EmptyState, TableHead, TableRow, Th, Td, useToast, cn } from "../../components/ui";
import { SelectorProducto, type ProductoRef } from "../../components/SelectorProducto";
import { AudioPlayer } from "../../components/AudioPlayer";
import type { SesionActiva } from "../../lib/tipos";

// El oído — calidad y diccionario (Ajustes › detalle, B10.3, admin+). Restyle a tema claro; MISMO
// comportamiento y VETO D-N5: (1) ver la salud del audio por día, (2) enseñar el nombre correcto de
// los faltantes que no matchearon → aprende la corrección y re-matchea las señales pendientes,
// (3) curar el diccionario. Todo vocabulario del tenant, jamás personal.

type CalidadDia = {
  fecha: string;
  transcritos: number; procesados: number; errores: number; sin_habla: number;
  senales: number; senales_sin_match: number; senales_baja_conf: number;
};
type SinMatch = { id: string; nombre_detectado: string; confianza: number; created_at: string; frase: string | null; transcripcion: string | null; audio_id: string | null };
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
  const toast = useToast();

  const reporte = useApi<Reporte>(listo ? `/audio/calidad${qSuc ? `${qSuc}&` : "?"}dias=7` : null, [suc]);
  const correcciones = useApi<{ correcciones: Correccion[] }>(listo ? "/audio/correcciones" : null, [suc]);

  function recargar() {
    reporte.recargar();
    correcciones.recargar();
  }

  const selectCls = "w-full rounded-[9px] border border-line-input bg-field px-3 py-2.5 text-[13px] text-ink outline-none";

  return (
    <div className="flex max-w-[900px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] leading-relaxed text-ink-2">Salud del audio del mostrador y corrección de nombres que el sistema no reconoció. No graba conversaciones ni sirve para vigilar al personal.</p>
        <button onClick={() => navegar("catalogo-prueba")} className="self-start text-[12.5px] text-link underline">
          ¿Señales “sin match”? Carga el catálogo de prueba →
        </button>
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className={selectCls}>
          <option value="">— Elige una botica —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {!listo ? (
        <Card><EmptyState title="Elige una botica" subtitle="Selecciona arriba para ver su calidad de audio." /></Card>
      ) : (
        <>
          <ResumenDias r={reporte} />
          <SinMatchLista
            r={reporte}
            qSuc={qSuc}
            onEnsenado={(n) => { toast(n > 0 ? `Corrección aprendida y ${n} señal(es) actualizada(s).` : "Corrección aprendida."); recargar(); }}
            onError={(m) => toast(m)}
          />
          <CorreccionesLista c={correcciones} onBorrado={() => { toast("Corrección borrada."); recargar(); }} onError={(m) => toast(m)} />
          <ErroresLista r={reporte} />
          {esSuper && (
            <PurgaAudio
              onPurgado={(n, o) => { toast(`Audio purgado: ${n} grabación(es) y ${o} archivo(s) borrados.`); recargar(); }}
              onError={(m) => toast(m)}
            />
          )}
        </>
      )}
    </div>
  );
}

function ResumenDias({ r }: { r: ReturnType<typeof useApi<Reporte>> }) {
  const cols = "minmax(84px,1.3fr) repeat(6, minmax(52px,1fr))";
  const dias = r.data?.dias ?? [];
  return (
    <Card>
      <SectionLabel>Resumen · 7 días</SectionLabel>
      <div className="mt-2">
        {r.cargando ? (
          <p className="p-4 text-center text-[13px] text-ink-3">Cargando reporte…</p>
        ) : r.error ? (
          <div className="p-4 text-center">
            <p className="text-[13px] text-accent-ink">{r.error}</p>
            <button onClick={r.recargar} className="mt-2 text-[12.5px] text-link underline">Reintentar</button>
          </div>
        ) : dias.length === 0 ? (
          <EmptyState title="Sin datos de audio todavía" subtitle="Aparecerán cuando la grabadora del A10 empiece a enviar." />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[520px]">
              <TableHead cols={cols}>
                <Th>Día</Th>
                <Th align="right">Transcritos</Th>
                <Th align="right">Errores</Th>
                <Th align="right">Sin voz</Th>
                <Th align="right">Señales</Th>
                <Th align="right">Sin match</Th>
                <Th align="right">Baja conf.</Th>
              </TableHead>
              {dias.map((d, i) => (
                <TableRow key={d.fecha} cols={cols}>
                  <Td className={cn("text-[13px]", i === 0 ? "font-semibold text-ink" : "text-ink-2")}>{i === 0 ? `${d.fecha} (hoy)` : d.fecha}</Td>
                  <Td align="right" className="text-[13px] tabular-nums text-ink">{d.transcritos}</Td>
                  <Td align="right" className={cn("text-[13px] tabular-nums", d.errores > 0 ? "font-semibold text-accent-ink" : "text-ink-3")}>{d.errores}</Td>
                  <Td align="right" className="text-[13px] tabular-nums text-ink-3">{d.sin_habla}</Td>
                  <Td align="right" className="text-[13px] tabular-nums text-ink">{d.senales}</Td>
                  <Td align="right" className={cn("text-[13px] tabular-nums", d.senales_sin_match > 0 ? "font-semibold text-warn" : "text-ink-3")}>{d.senales_sin_match}</Td>
                  <Td align="right" className="text-[13px] tabular-nums text-ink-3">{d.senales_baja_conf}</Td>
                </TableRow>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function SinMatchLista({ r, qSuc, onEnsenado, onError }: { r: ReturnType<typeof useApi<Reporte>>; qSuc: string; onEnsenado: (n: number) => void; onError: (m: string) => void }) {
  const items = r.data?.sin_match ?? [];
  return (
    <Card>
      <SectionLabel>Nombres sin reconocer</SectionLabel>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">Faltantes que el audio oyó pero no calzaron ningún producto. Asígnales el correcto: el sistema lo aprende para la próxima.</p>
      {items.length === 0 ? (
        <div className="mt-3"><EmptyState title="Nada pendiente de reconocer" subtitle="Todo lo que oyó calzó con un producto." /></div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((s) => (
            <FilaSinMatch key={s.id} s={s} qSuc={qSuc} onEnsenado={onEnsenado} onError={onError} />
          ))}
        </ul>
      )}
    </Card>
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
    <li className="rounded-[8px] border border-line-inset bg-inset p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[13px] font-semibold text-ink-strong">“{s.nombre_detectado}”</p>
          <p className="text-[11.5px] text-ink-3">{Math.round(s.confianza * 100)}% seguro · {s.created_at.slice(0, 16).replace("T", " ")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAbierto((v) => !v)} disabled={ocupado}>
          {abierto ? "Cerrar" : "Asignar producto"}
        </Button>
      </div>
      {/* Contexto + audio (B10.4.2/3): la frase oída y el chunk para corroborar antes de asignar. */}
      {s.frase && <p className="mt-1.5 border-l-2 border-line-input pl-2 text-[11.5px] italic text-ink-2">“{s.frase}”</p>}
      {s.audio_id && <div className="mt-1.5"><AudioPlayer audioId={s.audio_id} /></div>}
      {abierto && (
        <div className="mt-2">
          <SelectorProducto onSelect={(p) => void asignar(p)} placeholder="Buscar el producto correcto..." />
        </div>
      )}
    </li>
  );
}

function CorreccionesLista({ c, onBorrado, onError }: { c: ReturnType<typeof useApi<{ correcciones: Correccion[] }>>; onBorrado: () => void; onError: (m: string) => void }) {
  async function borrar(id: string) {
    try {
      await mutar(`/audio/correcciones/${id}`, { method: "DELETE" });
      onBorrado();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }
  const items = c.data?.correcciones ?? [];
  return (
    <Card>
      <SectionLabel>Diccionario · {c.cargando ? "…" : items.length >= 200 ? "200+" : items.length} término{items.length === 1 ? "" : "s"} aprendido{items.length === 1 ? "" : "s"}</SectionLabel>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">Lo que el sistema ya sabe: forma oída → producto. Borra una si quedó mal.</p>
      {c.cargando ? (
        <p className="mt-3 p-2 text-center text-[13px] text-ink-3">Cargando correcciones…</p>
      ) : items.length === 0 ? (
        <div className="mt-3"><EmptyState title="Aún no hay correcciones" subtitle="Se aprenden al asignar productos a las señales sin reconocer." /></div>
      ) : (
        <ul className="mt-3 flex flex-col">
          {items.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 border-b border-line-row py-2 text-[13px] last:border-0">
              <span className="min-w-0 truncate">
                <span className="font-mono text-ink-2">“{x.texto_norm}”</span> <span className="text-ink-3">→</span> {x.producto_nombre ?? <span className="text-ink-3">(producto eliminado)</span>}
                {x.veces > 1 && <span className="text-[11.5px] text-ink-3"> ·{x.veces}×</span>}
              </span>
              <button onClick={() => void borrar(x.id)} className="shrink-0 rounded-[8px] px-2.5 py-1 text-[12px] font-semibold text-accent-ink transition-colors hover:bg-accent-soft">
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ErroresLista({ r }: { r: ReturnType<typeof useApi<Reporte>> }) {
  const items = r.data?.errores ?? [];
  if (items.length === 0) return null;
  return (
    <Card>
      <SectionLabel>Errores recientes</SectionLabel>
      <ul className="mt-2 flex flex-col gap-1 text-[12px]">
        {items.map((e) => (
          <li key={e.id} className="flex justify-between gap-2">
            <span className="truncate text-accent-ink">{e.error_detalle ?? "error"}</span>
            <span className="shrink-0 text-ink-3">{e.created_at.slice(0, 16).replace("T", " ")}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Purga TODA la grabación de audio del tenant (salvaguarda LPDP — se usa al cerrar la prueba de 3
// meses). Destructiva e irreversible → doble confirmación. No toca los quiebres reales ya registrados.
function PurgaAudio({ onPurgado, onError }: { onPurgado: (n: number, o: number) => void; onError: (m: string) => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function purgar() {
    setOcupado(true);
    try {
      const r = await mutar<{ grabaciones: number; objetos_r2: number }>("/audio/purgar", { method: "POST", body: {} });
      setConfirmando(false);
      onPurgado(r.grabaciones ?? 0, r.objetos_r2 ?? 0);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="border-line-sel">
      <SectionLabel>Cerrar la prueba — purgar el audio</SectionLabel>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
        Borra TODAS las grabaciones de audio (archivos + señales). Los quiebres ya registrados se conservan.
        Úsalo al terminar el piloto (Ley 29733: el audio del mostrador puede tener datos de salud).
      </p>
      <div className="mt-3">
        {!confirmando ? (
          <button onClick={() => setConfirmando(true)} className="rounded-[9px] border border-line-sel px-3.5 py-2 text-[12.5px] font-semibold text-accent-ink transition-colors hover:bg-accent-soft">
            Purgar todo el audio…
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-accent-ink">¿Seguro? Esto no se puede deshacer.</span>
            <Button size="sm" onClick={() => void purgar()} disabled={ocupado}>{ocupado ? "Purgando…" : "Sí, purgar"}</Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmando(false)} disabled={ocupado}>Cancelar</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
