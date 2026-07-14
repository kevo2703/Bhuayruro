import { useState } from "react";
import { useApi } from "../../lib/useApi";
import { navegar } from "../../lib/ruta";
import { Card, Button, Chip, SectionLabel, IconOido, cn } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// Overview de Ajustes (IA nueva): una pantalla con tarjetas que resumen y enlazan a las páginas de
// detalle (catálogo · usuarios · boticas · dispositivos · el oído). SOLO lee (useApi); toda mutación
// vive en las páginas de detalle. Los conteos/estado sin backend NO se inventan: se rotulan sobrio.

type Usuario = { id: string; nombre: string; email: string; rol: string; sucursal_id: string | null; activo: number };
type Sucursal = { id: string; nombre: string; direccion: string | null; activa: number; hora_apertura: string | null; hora_cierre: string | null };
type Dispositivo = { id: string; nombre: string; activo: number; sucursal_id: string; created_at: string };
type CalidadDia = { fecha: string; senales: number; senales_sin_match: number };
type Correccion = { id: string; texto_norm: string; producto_nombre: string | null };

const ROL_LABEL: Record<string, string> = {
  super_admin: "Dueño",
  admin_sucursal: "Encargado",
  operador: "Vendedor",
  lector_reportes: "Lector",
};

const miles = (n: number) => n.toLocaleString("es-PE");
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const horario = (s: Sucursal): string | null => {
  const a = hhmm(s.hora_apertura);
  const b = hhmm(s.hora_cierre);
  return a && b ? `${a} – ${b}` : null;
};

export function Ajustes({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";

  // Tenant-wide (funcionan para dueño y encargado por igual).
  const catConteo = useApi<{ activos: number }>("/catalogo/conteo");
  const maestro = useApi<{ total: number }>("/maestro/conteo");
  const usuarios = useApi<{ usuarios: Usuario[] }>("/usuarios");
  const sucursales = useApi<{ sucursales: Sucursal[] }>("/sucursales");
  const correcciones = useApi<{ correcciones: Correccion[] }>("/audio/correcciones");

  // Dispositivos y el oído son POR BOTICA en el server (sucursalVerificada): el encargado usa la suya;
  // el dueño elige una (default = la primera). Los demás datos siguen siendo de toda la cadena.
  const [sucSel, setSucSel] = useState("");
  const primeraSuc = sucursales.data?.sucursales[0]?.id ?? "";
  const sucScope = esSuper ? (sucSel || primeraSuc) : (sesion.usuario.sucursalId ?? "");
  const listoScope = !esSuper || !!sucScope;
  const qSuc = esSuper && sucScope ? `?sucursal_id=${sucScope}` : "";
  const dispositivos = useApi<{ dispositivos: Dispositivo[] }>(listoScope ? `/dispositivos${qSuc}` : null, [sucScope]);
  const audio = useApi<{ dias: CalidadDia[] }>(listoScope ? `/audio/calidad${qSuc ? `${qSuc}&` : "?"}dias=7` : null, [sucScope]);

  const sucNombre = (id: string | null): string | null => sucursales.data?.sucursales.find((s) => s.id === id)?.nombre ?? null;
  const rolAlcance = (u: Usuario): string =>
    u.rol === "super_admin" ? "Dueño · toda la cadena" : `${ROL_LABEL[u.rol] ?? u.rol}${sucNombre(u.sucursal_id) ? ` · ${sucNombre(u.sucursal_id)}` : ""}`;

  // El oído: % de señales útiles (reconocidas / total) derivado de los 7 días.
  const dias = audio.data?.dias ?? [];
  const senales = dias.reduce((a, d) => a + d.senales, 0);
  const sinMatch = dias.reduce((a, d) => a + d.senales_sin_match, 0);
  const reconocidas = Math.max(0, senales - sinMatch);
  const pct = senales > 0 ? Math.round((reconocidas / senales) * 100) : null;

  const us = usuarios.data?.usuarios ?? [];
  const usVisibles = us.slice(0, 6);
  const usResto = us.length - usVisibles.length;
  const sucs = sucursales.data?.sucursales ?? [];
  const disp = dispositivos.data?.dispositivos ?? [];
  const dicc = correcciones.data?.correcciones ?? [];

  return (
    <div className="flex flex-col gap-3.5">
      {esSuper && sucs.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-2">Dispositivos y el oído de:</span>
          <select
            value={sucScope}
            onChange={(e) => setSucSel(e.target.value)}
            className="rounded-[9px] border border-line-input bg-field px-3 py-1.5 text-[13px] text-ink outline-none"
          >
            {sucs.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 items-start gap-3.5">
        {/* Catálogo de productos */}
        <Card>
          <SectionLabel>Catálogo de productos</SectionLabel>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="text-[24px] font-bold tracking-[-0.01em] tabular-nums text-ink">
              {catConteo.cargando ? "…" : catConteo.error ? "—" : miles(catConteo.data?.activos ?? 0)}
            </span>
            <span className="text-[13px] font-medium text-ink-2">productos activos</span>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
            Para dar de alta uno nuevo, búscalo en el catálogo nacional{maestro.data ? ` de ${miles(maestro.data.total)} medicamentos` : ""} (con nombre, presentación y registro) y ajusta solo el precio.
          </p>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => navegar("catalogo")}>Abrir catálogo</Button>
          </div>
        </Card>

        {/* Usuarios y roles */}
        <Card>
          <SectionLabel>Usuarios y roles</SectionLabel>
          {usuarios.cargando ? (
            <p className="mt-2 text-[12.5px] text-ink-3">Cargando usuarios…</p>
          ) : usuarios.error ? (
            <p className="mt-2 text-[12.5px] text-accent-ink">{usuarios.error}</p>
          ) : (
            <ul className="mt-1.5 flex flex-col">
              {usVisibles.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 border-b border-line-row py-2 last:border-0">
                  <div className="min-w-0">
                    <p className={cn("truncate text-[13px] font-semibold", u.activo !== 1 ? "text-ink-3 line-through" : "text-ink")}>{u.nombre}</p>
                    <p className="truncate text-[12px] text-ink-2">{rolAlcance(u)}</p>
                  </div>
                  {u.activo !== 1 && <Chip variant="neutral">inactivo</Chip>}
                </li>
              ))}
            </ul>
          )}
          {usResto > 0 && <p className="mt-1.5 text-[12px] text-ink-3">y {usResto} usuario{usResto === 1 ? "" : "s"} más</p>}
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => navegar("usuarios")}>Agregar usuario</Button>
          </div>
        </Card>

        {/* Boticas y horarios */}
        <Card>
          <SectionLabel>Boticas y horarios</SectionLabel>
          {sucursales.cargando ? (
            <p className="mt-2 text-[12.5px] text-ink-3">Cargando boticas…</p>
          ) : sucursales.error ? (
            <p className="mt-2 text-[12.5px] text-accent-ink">{sucursales.error}</p>
          ) : (
            <ul className="mt-1.5 flex flex-col">
              {sucs.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 border-b border-line-row py-2 last:border-0">
                  <span className={cn("truncate text-[13px] font-semibold", s.activa !== 1 ? "text-ink-3" : "text-ink")}>{s.nombre}</span>
                  {horario(s) ? (
                    <span className="shrink-0 text-[12.5px] tabular-nums text-ink-2">{horario(s)}</span>
                  ) : (
                    <span className="shrink-0 text-[12px] text-ink-3">sin horario</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
            Las ventas fuera de horario se marcan como caso. Si un horario cambió, actualízalo aquí para no generar falsas alarmas.
          </p>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => navegar("sucursales")}>Abrir boticas y horarios</Button>
          </div>
        </Card>

        {/* Dispositivos conectados */}
        <Card>
          <SectionLabel>Dispositivos conectados</SectionLabel>
          {!listoScope ? (
            <p className="mt-2 text-[12.5px] text-ink-3">Elige una botica arriba para ver sus dispositivos.</p>
          ) : dispositivos.cargando ? (
            <p className="mt-2 text-[12.5px] text-ink-3">Cargando dispositivos…</p>
          ) : dispositivos.error ? (
            <p className="mt-2 text-[12.5px] text-accent-ink">{dispositivos.error}</p>
          ) : disp.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink-3">Aún no hay dispositivos en esta botica.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col">
              {disp.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 border-b border-line-row py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">{d.nombre}</p>
                    <p className="truncate text-[12px] text-ink-2">{sucNombre(d.sucursal_id) ?? "—"}</p>
                  </div>
                  <Chip variant="neutral">próximamente</Chip>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
            El estado en vivo (en línea, batería, apagado) llegará con la telemetría de los equipos.
          </p>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => navegar("grabadores")}>Ver dispositivos</Button>
          </div>
        </Card>

        {/* El oído — calidad y diccionario (ancho completo) */}
        <Card className="col-span-2">
          <div className="flex items-center gap-2">
            <IconOido size={14} className="text-accent" />
            <SectionLabel>El oído — calidad y diccionario</SectionLabel>
          </div>
          <div className="mt-3 grid grid-cols-2 items-start gap-6">
            {/* Izquierda: calidad de la semana */}
            <div>
              <p className="text-[22px] font-bold tracking-[-0.01em] tabular-nums text-ink">
                {!listoScope ? "—" : audio.cargando ? "…" : pct === null ? "Sin señales esta semana" : `${pct}% de señales útiles esta semana`}
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-soft">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct ?? 0}%` }} />
              </div>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
                {reconocidas} frase{reconocidas === 1 ? "" : "s"} reconocida{reconocidas === 1 ? "" : "s"} de {senales} señal{senales === 1 ? "" : "es"} esta semana. Cada vez que confirmas o descartas una señal, el oído aprende.
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
                Solo reconoce frases de faltante ("no hay…", "se acabó…"). No graba conversaciones ni sirve para vigilar al personal.
              </p>
            </div>
            {/* Derecha: diccionario */}
            <div>
              <p className="text-[13px] font-semibold text-ink">
                Diccionario · {correcciones.cargando ? "…" : dicc.length >= 200 ? "200+" : dicc.length} término{dicc.length === 1 ? "" : "s"} aprendido{dicc.length === 1 ? "" : "s"}
              </p>
              {dicc.length === 0 && !correcciones.cargando ? (
                <p className="mt-2 text-[12px] text-ink-3">Aún no hay términos. Se aprenden al asignar productos a las señales sin reconocer.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {dicc.slice(0, 3).map((x) => (
                    <li key={x.id} className="rounded-[8px] border border-line-inset bg-inset px-2.5 py-1.5 font-mono text-[12px] text-ink-strong">
                      "{x.texto_norm}" → {x.producto_nombre ?? <span className="text-ink-3">(producto eliminado)</span>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => navegar("audio-calidad")}>Revisar diccionario</Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
