import { useCallback, useEffect, useMemo, useState } from "react";
import { TEXTO_OPTIN_WHATSAPP, enlaceWhatsapp } from "@huayruro/shared";
import { useApi } from "../lib/useApi";
import { navegar } from "../lib/ruta";
import { solesCent } from "../lib/money";
import { diaMes, fechaDia, fechaDiaDeIso, ymdLima } from "../lib/fecha-ui";
import {
  actualizarCliente,
  buscarClientes,
  cerrarSeguimiento,
  cuandoCumple,
  cumpleanosSemana,
  eliminarCliente,
  listarClientes,
  nombreCorto,
  panelCliente,
  telefonoLegible,
  type Cliente,
  type Cumpleanero,
  type PanelCliente,
} from "../lib/clientes";
import { Button, Card, Chip, EmptyState, Input, SectionLabel, Textarea } from "../components/ui";
import type { SesionActiva } from "../lib/tipos";

// P1 — Clientes y Seguimiento (§12). El padrón de la botica: quién compra, para quién compra y qué hay
// que preguntarle la próxima vez.
//
// ROTULADO: acá se dice "Seguimiento", nunca "historia clínica" (§12). Y `lector_reportes` no llega a
// esta pantalla ni a sus endpoints: hay DNI, alergias y notas — datos personales y de salud.

type Sucursal = { id: string; nombre: string };

type Editable = {
  nombre: string;
  alias: string;
  celular: string;
  dni: string;
  fecha_nacimiento: string;
  alergias: string;
  notas: string;
  optin_whatsapp: boolean;
};

const soloDigitos = (s: string) => s.replace(/\D/g, "");

const editableDe = (c: PanelCliente["cliente"]): Editable => ({
  nombre: c.nombre,
  alias: c.alias ?? "",
  celular: c.whatsapp ?? c.telefono ?? "",
  dni: c.dni ?? "",
  fecha_nacimiento: c.fecha_nacimiento ?? "",
  alergias: c.alergias ?? "",
  notas: c.notas ?? "",
  optin_whatsapp: c.optin_whatsapp === 1,
});

export function Clientes({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const esAdmin = esSuper || sesion.usuario.rol === "admin_sucursal";
  const [sucSel, setSucSel] = useState<string>("");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel || null : null; // no-super: la sucursal sale de su sesión, no del query
  const listo = !esSuper || !!sucSel;

  const [q, setQ] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [cumples, setCumples] = useState<Cumpleanero[]>([]);

  // Padrón: búsqueda si hay término, listado paginado si no.
  useEffect(() => {
    if (!listo) return;
    const ctrl = new AbortController();
    setCargandoLista(true);
    setErrorLista(null);
    const termino = q.trim();
    const t = setTimeout(() => {
      const pedido = termino
        ? buscarClientes(termino, ctrl.signal, suc).then((clientes) => ({ clientes, siguiente_cursor: null }))
        : listarClientes({ suc }, ctrl.signal);
      pedido
        .then((r) => {
          if (ctrl.signal.aborted) return;
          setLista(r.clientes);
          setCursor(r.siguiente_cursor);
        })
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) setErrorLista(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setCargandoLista(false);
        });
    }, termino ? 250 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, suc, listo]);

  useEffect(() => {
    if (!listo) return;
    let vivo = true;
    cumpleanosSemana(7, suc)
      .then((r) => {
        if (vivo) setCumples(r.cumpleanos);
      })
      .catch(() => {
        /* la lista de cumpleaños no es crítica: si falla, la pantalla sigue sirviendo */
      });
    return () => {
      vivo = false;
    };
  }, [suc, listo]);

  const masPadron = useCallback(async () => {
    if (!cursor) return;
    setCargandoLista(true);
    try {
      const r = await listarClientes({ cursor, suc });
      setLista((prev) => [...prev, ...r.clientes]);
      setCursor(r.siguiente_cursor);
    } catch (e) {
      setErrorLista(e instanceof Error ? e.message : String(e));
    } finally {
      setCargandoLista(false);
    }
  }, [cursor, suc]);

  const recargarLista = useCallback(() => setQ((x) => `${x}`), []); // fuerza el efecto sin cambiar el filtro

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-ink-2">
        Quién compra en la botica, para quién compra y qué le toca preguntarle la próxima vez que venga.
      </p>

      {esSuper && (
        <select
          value={sucSel}
          onChange={(e) => {
            setSucSel(e.target.value);
            setElegido(null);
          }}
          className="w-full max-w-xs rounded-[9px] border border-line-input bg-field px-3 py-2 text-[13px] text-ink outline-none"
        >
          <option value="">— Elige una botica —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      )}

      {!listo ? (
        <EmptyState title="Elige una botica" subtitle="El padrón de clientes es de cada botica: la misma persona en dos boticas son dos registros." />
      ) : (
        <>
          {/* A2: la bandeja vive del lado del mostrador (se usa desde el celular), pero quien mira el
              padrón desde el escritorio tiene que poder llegar a ella sin saberse la dirección. */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => navegar("reposiciones")}
              className="text-[12.5px] font-medium text-link underline hover:text-link-hover"
            >
              💊 Ver a quién le toca reponer →
            </button>
          </div>

          <Cumpleanos cumples={cumples} onVer={setElegido} />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,380px)_1fr] items-start gap-4">
            <Card>
              <SectionLabel>Padrón</SectionLabel>
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre, celular o DNI…"
                className="mt-2"
              />
              {errorLista && <p className="mt-2 text-[12px] text-accent-ink">{errorLista}</p>}
              {cargandoLista && lista.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-3">Cargando…</p>
              ) : lista.length === 0 ? (
                <EmptyState
                  className="mt-3"
                  title={q.trim() ? "Nadie con ese dato" : "Todavía no hay clientes"}
                  subtitle={q.trim() ? "Prueba con el celular o parte del nombre." : "Se dan de alta en el mostrador, al cobrar."}
                />
              ) : (
                <ul className="mt-2 divide-y divide-line-row">
                  {lista.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => setElegido(c.id)}
                        className={`flex w-full items-center justify-between gap-2 px-1 py-2.5 text-left transition-colors hover:bg-hover-btn ${
                          elegido === c.id ? "bg-inset" : ""
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-semibold text-ink">{nombreCorto(c)}</span>
                          <span className="block truncate text-[12px] text-ink-2">
                            {c.telefono ? telefonoLegible(c.telefono) : "sin celular"}
                            {c.dni ? ` · DNI ${c.dni}` : ""}
                          </span>
                        </span>
                        {c.optin_whatsapp === 1 && <Chip variant="ok">WhatsApp</Chip>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {cursor && (
                <Button variant="outline" size="sm" className="mt-3 self-start" onClick={() => void masPadron()} disabled={cargandoLista}>
                  Ver más
                </Button>
              )}
            </Card>

            {elegido ? (
              <Ficha
                key={elegido}
                clienteId={elegido}
                suc={suc}
                esAdmin={esAdmin}
                onCerrado={() => setElegido(null)}
                onCambio={recargarLista}
              />
            ) : (
              <Card>
                <EmptyState title="Elige a alguien de la lista" subtitle="Vas a ver sus compras, para quién compra y su seguimiento." />
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Cumpleanos({ cumples, onVer }: { cumples: Cumpleanero[]; onVer: (id: string) => void }) {
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>🎂 Cumpleaños de la semana</SectionLabel>
        <span className="text-[12px] text-ink-3">Un saludo cuesta cero y se acuerdan.</span>
      </div>
      {cumples.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-ink-2">Nadie cumple años esta semana.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {cumples.map((c) => (
            <button
              key={c.id}
              onClick={() => onVer(c.id)}
              className="rounded-[9px] border border-line-input bg-card px-3 py-2 text-left transition-colors hover:bg-hover-btn"
            >
              <span className="block text-[13px] font-semibold text-ink">
                {c.dias_para === 0 ? "🎉 " : ""}
                {nombreCorto(c)}
              </span>
              <span className="block text-[11.5px] text-ink-2">
                {cuandoCumple(c.dias_para)}
                {c.edad !== null ? ` · cumple ${c.edad}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

// Ficha del cliente: perfil + seguimiento abierto + la línea de tiempo de compras y seguimientos.
function Ficha({
  clienteId,
  suc,
  esAdmin,
  onCerrado,
  onCambio,
}: {
  clienteId: string;
  suc: string | null;
  esAdmin: boolean;
  onCerrado: () => void;
  onCambio: () => void;
}) {
  const [panel, setPanel] = useState<PanelCliente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Editable | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmaBorrar, setConfirmaBorrar] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setCargando(true);
    panelCliente(clienteId, ctrl.signal, suc)
      .then((p) => {
        if (ctrl.signal.aborted) return;
        setPanel(p);
        setForm(editableDe(p.cliente));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false);
      });
    return () => ctrl.abort();
  }, [clienteId, suc, recarga]);

  // Compras y seguimientos en una sola línea de tiempo, lo más reciente arriba.
  const linea = useMemo(() => {
    if (!panel) return [];
    const compras = panel.compras.map((c) => ({
      key: `v-${c.id}`,
      fecha: c.fecha_hora,
      dia: ymdLima(c.fecha_hora), // el día que se vivió en la botica, no el UTC
      tipo: "compra" as const,
      texto: solesCent(c.total_cent),
      detalle: c.estado === "anulada" ? "anulada" : null,
    }));
    const seguimientos = panel.tratamientos.map((t) => ({
      key: `t-${t.id}`,
      fecha: `${t.fecha_inicio}T12:00:00.000Z`,
      dia: t.fecha_inicio,
      tipo: "seguimiento" as const,
      texto: t.descripcion,
      detalle: t.familiar_nombre ? `para ${t.familiar_nombre}` : null,
    }));
    return [...compras, ...seguimientos].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  }, [panel]);

  async function guardar() {
    if (!form || !panel) return;
    setGuardando(true);
    setError(null);
    try {
      const celular = soloDigitos(form.celular);
      const actualizado = await actualizarCliente(
        panel.cliente.id,
        {
          nombre: form.nombre,
          alias: form.alias.trim() || null,
          telefono: celular || null,
          whatsapp: celular || null,
          dni: soloDigitos(form.dni) || null,
          fecha_nacimiento: form.fecha_nacimiento || null,
          alergias: form.alergias.trim() || null,
          notas: form.notas.trim() || null,
          optin_whatsapp: form.optin_whatsapp && celular.length > 0,
        },
        suc,
      );
      setPanel((p) => (p ? { ...p, cliente: actualizado } : p));
      setForm(editableDe(actualizado));
      setEditando(false);
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!panel) return;
    setGuardando(true);
    try {
      await eliminarCliente(panel.cliente.id, suc);
      onCambio();
      onCerrado();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGuardando(false);
    }
  }

  async function cerrarSeg(tratamientoId: string) {
    if (!panel) return;
    try {
      await cerrarSeguimiento(panel.cliente.id, tratamientoId, suc);
      setRecarga((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (cargando && !panel) {
    return (
      <Card>
        <p className="py-8 text-center text-[13px] text-ink-3">Cargando ficha…</p>
      </Card>
    );
  }
  if (!panel || !form) {
    return (
      <Card>
        <p className="py-8 text-center text-[13px] text-accent-ink">{error ?? "No se pudo cargar la ficha."}</p>
      </Card>
    );
  }

  const c = panel.cliente;
  const wa = c.optin_whatsapp === 1 ? enlaceWhatsapp(c.whatsapp ?? c.telefono) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-ink">{c.nombre}</h2>
            <p className="text-[12.5px] text-ink-2">
              {c.alias ? `“${c.alias}” · ` : ""}
              {c.telefono ? telefonoLegible(c.telefono) : "sin celular"}
              {c.dni ? ` · DNI ${c.dni}` : ""}
              {c.fecha_nacimiento ? ` · nació el ${fechaDia(c.fecha_nacimiento)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded-[9px] border border-ok/30 bg-ok-soft px-3.5 py-2 text-[13px] font-semibold text-ok"
              >
                Escribirle por WhatsApp
              </a>
            ) : (
              <span className="text-[12px] text-ink-3">
                {c.whatsapp || c.telefono ? "No aceptó avisos por WhatsApp" : "Sin WhatsApp registrado"}
              </span>
            )}
            {esAdmin && !editando && (
              <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
                Editar
              </Button>
            )}
          </div>
        </div>

        {c.alergias && (
          <p className="mt-2 rounded-[9px] bg-accent-soft px-3 py-2 text-[12.5px] font-semibold text-accent-ink">⚠️ Alergias: {c.alergias}</p>
        )}
        {c.notas && <p className="mt-2 text-[12.5px] text-ink-2">{c.notas}</p>}
        {c.optin_whatsapp === 1 && c.optin_whatsapp_texto && (
          <p className="mt-2 text-[11.5px] text-ink-3">
            Aceptó el {c.optin_whatsapp_at ? fechaDiaDeIso(c.optin_whatsapp_at) : "—"}: “{c.optin_whatsapp_texto}”
          </p>
        )}
        {panel.familiares.length > 0 && (
          <p className="mt-2 text-[12.5px] text-ink-2">Compra también para: {panel.familiares.map((f) => f.nombre).join(", ")}</p>
        )}

        {editando && (
          <div className="mt-4 border-t border-line-row pt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Nombre">
                <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              </Campo>
              <Campo label="Cómo le dicen (alias)">
                <Input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} />
              </Campo>
              <Campo label="Celular / WhatsApp">
                <Input value={form.celular} onChange={(e) => setForm({ ...form, celular: e.target.value })} inputMode="numeric" />
              </Campo>
              <Campo label="DNI">
                <Input value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value })} inputMode="numeric" />
              </Campo>
              <Campo label="Cumpleaños">
                <Input type="date" value={form.fecha_nacimiento} onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })} />
              </Campo>
              <Campo label="Alergias">
                <Input value={form.alergias} onChange={(e) => setForm({ ...form, alergias: e.target.value })} />
              </Campo>
            </div>
            <Campo label="Notas" className="mt-3">
              <Textarea rows={2} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
            </Campo>
            <label className="mt-3 flex items-start gap-2.5 text-[12.5px] text-ink-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-ok"
                checked={form.optin_whatsapp}
                disabled={!form.celular.trim()}
                onChange={(e) => setForm({ ...form, optin_whatsapp: e.target.checked })}
              />
              <span>
                Acepta que le escriban por WhatsApp — “{TEXTO_OPTIN_WHATSAPP}”
                <span className="block text-[11.5px] text-ink-3">Al marcarlo se guarda la fecha y esta frase; al desmarcarlo se borran ambas.</span>
              </span>
            </label>
            {error && <p className="mt-3 text-[12px] text-accent-ink">{error}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={() => void guardar()} disabled={guardando || !form.nombre.trim()}>
                {guardando ? "Guardando…" : "Guardar cambios"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setForm(editableDe(c));
                  setEditando(false);
                  setError(null);
                }}
                disabled={guardando}
              >
                Cancelar
              </Button>
              <span className="flex-1" />
              {confirmaBorrar ? (
                <>
                  <span className="text-[12px] text-ink-2">¿Seguro? Sus compras quedan en el histórico.</span>
                  <Button variant="primary" onClick={() => void borrar()} disabled={guardando}>
                    Sí, borrar
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmaBorrar(false)} disabled={guardando}>
                    No
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setConfirmaBorrar(true)} disabled={guardando}>
                  Borrar cliente
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SectionLabel>Seguimiento abierto ({panel.tratamientos.length})</SectionLabel>
        {panel.tratamientos.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-ink-2">Nada pendiente. Los seguimientos se registran en el mostrador, al cobrar.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {panel.tratamientos.map((t) => (
              <li key={t.id} className="rounded-[11px] border border-line-inset bg-inset p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-ink">
                      {t.descripcion}
                      {t.familiar_nombre ? <span className="font-normal text-ink-2"> — para {t.familiar_nombre}</span> : ""}
                    </p>
                    <p className="text-[12px] text-ink-2">
                      Desde el {fechaDia(t.fecha_inicio)} · hace {t.dias_transcurridos} {t.dias_transcurridos === 1 ? "día" : "días"}
                      {t.fecha_toca ? ` · toca preguntarle el ${fechaDia(t.fecha_toca)}` : " · sin fecha de control"}
                    </p>
                    {t.indicacion_seguimiento && <p className="mt-1 text-[12.5px] italic text-ink">“{t.indicacion_seguimiento}”</p>}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void cerrarSeg(t.id)}>
                    Ya le pregunté
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionLabel>Línea de tiempo</SectionLabel>
        {linea.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-ink-2">Todavía no hay compras ni seguimientos registrados a su nombre.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {linea.map((e) => (
              <li key={e.key} className="flex items-center gap-2.5 border-b border-line-row py-1.5 last:border-0">
                <span className="w-[52px] flex-none font-mono text-[11.5px] text-ink-3">{diaMes(e.dia)}</span>
                <Chip variant={e.tipo === "compra" ? "neutral" : "info"}>{e.tipo === "compra" ? "compra" : "seguimiento"}</Chip>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {e.texto}
                  {e.detalle ? <span className="text-ink-2"> · {e.detalle}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Campo({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[12px] font-semibold text-ink-2">{label}</span>
      {children}
    </label>
  );
}
