import { useState } from "react";
import { DIAS_AVISO_MAX, DIAS_AVISO_MIN, fechaCorta } from "@huayruro/shared";
import { useApi, mutar } from "../../lib/useApi";
import { cuandoToca } from "../../lib/clientes";
import { navegar } from "../../lib/ruta";
import { Button, Card, Chip, EmptyState, SectionLabel, cn, useToast } from "../../components/ui";
import type { SesionActiva } from "../../lib/tipos";

// ============================================================
// A2 v1 — Bandeja de reposición de crónicos.
//
// Esta pantalla NO envía nada. Arma la lista del día y abre el WhatsApp de la botica con el mensaje
// ya escrito; quien atiende lo lee, lo ajusta si quiere y lo manda. El envío automático es P4b, y su
// permiso para existir es la tasa de respuesta que se mida con esto.
//
// Se usa desde el CELULAR (el WhatsApp de la botica vive en un teléfono), así que cada persona es una
// tarjeta con dos botones grandes y no una fila de tabla: a 390 px una tabla obliga a scrollear en
// horizontal justo cuando hay que tocar un botón.
//
// El orden es por urgencia: primero al que ya se le acabó. Si la bandeja no se miró ayer, esa gente
// no puede desaparecer sola.
// ============================================================

type Item = {
  referencia_tipo: "venta_item" | "tratamiento";
  referencia_id: string;
  producto_nombre: string;
  fecha_agotamiento: string;
  fecha_compra: string | null;
  dias_restantes: number;
};

type Fila = {
  cliente_id: string;
  cliente_nombre: string;
  dias_restantes: number;
  enlace: string;
  mensaje: string;
  items: Item[];
};

type Contactado = {
  cliente_id: string;
  cliente_nombre: string;
  productos: string[];
  enviado_at: string;
  operador_nombre: string | null;
  envio_ids: string[];
};

type Bandeja = {
  hoy: string;
  dias: number;
  filas: Fila[];
  sin_permiso: number;
  sin_numero: number;
  cronicos_marcados: number;
  ya_contactados: Contactado[];
};

type Sucursal = { id: string; nombre: string };

const selectCls = "rounded-[9px] border border-line-input bg-field px-3 py-2.5 text-[13px] text-ink outline-none";

const VENTANAS = Array.from({ length: DIAS_AVISO_MAX - DIAS_AVISO_MIN + 1 }, (_, i) => DIAS_AVISO_MIN + i);

const horaLegible = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" }).format(d);
};

export function Reposiciones({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [sucSel, setSucSel] = useState("");
  const [dias, setDias] = useState(3);
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel : (sesion.usuario.sucursalId ?? "");
  const qSuc = esSuper && suc ? `&sucursal_id=${suc}` : "";
  const bandeja = useApi<Bandeja>(!esSuper || suc ? `/marketing/reposiciones-hoy?dias=${dias}${qSuc}` : null, [suc, dias]);
  const toast = useToast();

  const b = bandeja.data;

  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[620px] text-[13px] leading-relaxed text-ink-2">
          A quién se le está por acabar su tratamiento, según lo que se llevó y cuánto toma por día. El mensaje se abre
          escrito en el WhatsApp de la botica — <strong>nada se manda solo</strong>.
        </p>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          Avisar con
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className={selectCls} aria-label="Días de anticipación">
            {VENTANAS.map((d) => (
              <option key={d} value={d}>{d} {d === 1 ? "día" : "días"} de anticipación</option>
            ))}
          </select>
        </label>
      </div>

      {esSuper && (
        <select value={sucSel} onChange={(e) => setSucSel(e.target.value)} className={cn(selectCls, "w-full")} aria-label="Botica">
          <option value="">— Elige una botica —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {esSuper && !suc ? (
        <Card><EmptyState title="Elige una botica" subtitle="Los clientes y sus tratamientos son de cada botica." /></Card>
      ) : (
        <>
          <Card className="gap-3">
            <SectionLabel right={b ? <span className="tabular-nums">{b.filas.length} {b.filas.length === 1 ? "persona" : "personas"}</span> : null}>
              Les toca reponer
            </SectionLabel>

            {bandeja.cargando ? (
              <p className="py-4 text-center text-[13px] text-ink-3">Armando la lista…</p>
            ) : bandeja.error ? (
              <div className="py-4 text-center">
                <p className="text-[13px] text-accent-ink">{bandeja.error}</p>
                <button onClick={bandeja.recargar} className="mt-2 text-[12.5px] text-link underline">Reintentar</button>
              </div>
            ) : !b ? null : b.filas.length === 0 ? (
              b.cronicos_marcados === 0 ? (
                // El vacío honesto: la bandeja no está vacía porque no haya gente, sino porque nadie
                // marcó todavía qué productos son de tratamiento diario.
                <div className="flex flex-col items-center gap-2">
                  <EmptyState
                    className="w-full"
                    title="Todavía no hay productos marcados como crónicos"
                    subtitle="Sin eso no se puede saber cuándo se le acaba a nadie. Marca los que se toman todos los días (losartán, metformina, anticonceptivos…) con su dosis."
                  />
                  <Button size="sm" onClick={() => navegar("catalogo")}>Marcar productos en Catálogo</Button>
                </div>
              ) : (
                <EmptyState
                  title="Hoy no le toca a nadie"
                  subtitle={`Nadie termina su tratamiento en los próximos ${b.dias} ${b.dias === 1 ? "día" : "días"}. Hay ${b.cronicos_marcados} ${b.cronicos_marcados === 1 ? "producto marcado" : "productos marcados"} como crónicos.`}
                />
              )
            ) : (
              <div className="flex flex-col gap-2.5">
                {b.filas.map((f) => (
                  <FilaPersona key={f.cliente_id} f={f} onCambio={bandeja.recargar} onToast={toast} />
                ))}
              </div>
            )}

            {b && (b.sin_permiso > 0 || b.sin_numero > 0) && (
              <p className="rounded-[9px] bg-warn-soft px-3 py-2 text-[12px] leading-relaxed text-warn">
                {b.sin_permiso > 0 && (
                  <>
                    A <strong>{b.sin_permiso}</strong> {b.sin_permiso === 1 ? "persona más le toca" : "personas más les toca"} reponer, pero{" "}
                    {b.sin_permiso === 1 ? "no aceptó" : "no aceptaron"} que se le escriba por WhatsApp. Se le pide el permiso la próxima vez que venga.{" "}
                  </>
                )}
                {b.sin_numero > 0 && (
                  <>
                    Y {b.sin_numero === 1 ? "hay 1 con el número mal cargado" : `hay ${b.sin_numero} con el número mal cargado`}: se corrige en su ficha, en Clientes.
                  </>
                )}
              </p>
            )}

            <p className="text-[12px] leading-relaxed text-ink-3">
              La fecha sale de lo que se llevó dividido entre la dosis diaria del producto — es una estimación, no un dato
              del médico. Solo aparece quien <strong>aceptó</strong> que le escriban. Marcar “ya le escribí” lo saca de la
              lista para que no reciba el mismo mensaje dos veces; si vuelve a comprar, vuelve a aparecer.
            </p>
          </Card>

          {b && b.ya_contactados.length > 0 && <YaContactados filas={b.ya_contactados} onCambio={bandeja.recargar} onToast={toast} />}
        </>
      )}
    </div>
  );
}

function FilaPersona({ f, onCambio, onToast }: { f: Fila; onCambio: () => void; onToast: (m: string) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const atrasado = f.dias_restantes < 0;
  const hoyMismo = f.dias_restantes === 0;

  async function marcar() {
    setOcupado(true);
    try {
      await mutar("/marketing/reposiciones/contactado", {
        method: "POST",
        body: {
          cliente_id: f.cliente_id,
          referencias: f.items.map((i) => ({ tipo: i.referencia_tipo, id: i.referencia_id })),
          mensaje: f.mensaje,
        },
      });
      onToast(`Anotado: ya le escribiste a ${f.cliente_nombre}.`);
      onCambio();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className={cn("rounded-[11px] border p-3", atrasado ? "border-accent-soft-2 bg-accent-soft/40" : "border-line-inset bg-inset")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-bold text-ink">{f.cliente_nombre}</p>
            <Chip variant={atrasado ? "danger" : hoyMismo ? "warn" : "neutral"}>
              {atrasado ? `se le acabó ${cuandoToca(-f.dias_restantes)}` : `se le acaba ${cuandoToca(-f.dias_restantes)}`}
            </Chip>
          </div>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {f.items.map((i) => (
              <li key={`${i.referencia_tipo}-${i.referencia_id}`} className="text-[12.5px] leading-snug text-ink-2">
                <span className="font-semibold text-ink">{i.producto_nombre}</span> — hasta el {fechaCorta(i.fecha_agotamiento)}
                {i.fecha_compra ? ` · lo llevó el ${fechaCorta(i.fecha_compra)}` : " · seguimiento anotado en el mostrador"}
              </li>
            ))}
          </ul>
          <button onClick={() => setAbierto((v) => !v)} className="mt-1.5 text-[12px] text-link underline">
            {abierto ? "ocultar el mensaje" : "ver el mensaje que se va a abrir"}
          </button>
          {abierto && (
            <p className="mt-1.5 whitespace-pre-line rounded-[9px] border border-line-input bg-card px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
              {f.mensaje}
            </p>
          )}
        </div>

        {/* Botones grandes y separados: esto se toca desde el celular, con el local lleno. */}
        <div className="flex flex-none gap-2 sm:flex-col">
          <a
            href={f.enlace}
            target="_blank"
            rel="noopener noreferrer"
            // `bg-ok` y no `bg-ok-strong`: el blanco sobre el verde claro da 3,4:1 y no llega al
            // mínimo legible (4,5:1). Con el verde del sistema son 5,3:1 — medido, no estimado.
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-ok px-4 py-2.5 text-[13px] font-semibold text-white hover:opacity-90 sm:flex-none"
          >
            Abrir WhatsApp
          </a>
          <Button variant="outline" onClick={() => void marcar()} disabled={ocupado} className="min-h-[44px] flex-1 justify-center sm:flex-none">
            {ocupado ? "Anotando…" : "Ya le escribí"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Lo que ya se hizo hoy, con deshacer: el botón vive al lado del enlace y un tap de más pasa. */
function YaContactados({ filas, onCambio, onToast }: { filas: Contactado[]; onCambio: () => void; onToast: (m: string) => void }) {
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function deshacer(f: Contactado) {
    setOcupado(f.cliente_id);
    try {
      await mutar("/marketing/reposiciones/contactado", { method: "DELETE", body: { ids: f.envio_ids } });
      onToast(`${f.cliente_nombre} vuelve a la lista.`);
      onCambio();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Card className="gap-2">
      <SectionLabel right={<span className="tabular-nums">{filas.length}</span>}>Ya les escribiste hoy</SectionLabel>
      <div className="flex flex-col divide-y divide-line-inset">
        {filas.map((f) => (
          <div key={f.cliente_id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{f.cliente_nombre}</p>
              <p className="truncate text-[12px] text-ink-3">
                {f.productos.join(", ")} · {horaLegible(f.enviado_at)}
                {f.operador_nombre ? ` · ${f.operador_nombre}` : ""}
              </p>
            </div>
            <button
              onClick={() => void deshacer(f)}
              disabled={ocupado === f.cliente_id}
              className="flex-none rounded-[8px] px-2.5 py-1 text-[12px] font-semibold text-ink-3 hover:bg-hover-btn hover:text-accent-ink disabled:opacity-50"
            >
              {ocupado === f.cliente_id ? "…" : "Deshacer"}
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}
