import {
  Card,
  StatCard,
  Chip,
  DeltaPill,
  ChainStackBar,
  MiniBarChart,
  SectionLabel,
  EmptyState,
  IconOido,
} from "../components/ui";
import { Cargando } from "../components/Estados";
import { navegar } from "../lib/ruta";
import { useApi } from "../lib/useApi";
import { solesCent } from "../lib/money";
import type { SesionActiva } from "../lib/tipos";

// Portada "Hoy" del panel del dueño (refresh visual). SOLO presentación: lee GET /hoy/resumen
// (requiereUsuario) y pinta atención + boticas + top vendido + oído. El backend ya resuelve el
// alcance por rol (super → cadena + sus boticas; admin/lector → su sucursal, cadena=null), así que
// la vista se ramifica por DATO (cadena !== null), no por un guard propio. Todo dato que aún no
// tiene backend (ciudad, estado en vivo) se rotula "próximamente"; jamás una cifra inventada.

type Caja = { dif_cent: number; cuadro: boolean };
type Botica = {
  sucursal_id: string;
  nombre: string;
  ciudad: string | null; // sin columna → "próximamente"
  en_linea: boolean | null; // sin heartbeat → "próximamente"
  ventas_cent: number;
  num_tickets: number;
  ticket_promedio_cent: number;
  delta_pct_vs_tipico: number | null;
  serie_7d: number[];
  caja_ayer: Caja | null;
  stock_bajo: number;
};
type Cadena = {
  ventas_cent: number;
  num_tickets: number;
  ticket_promedio_cent: number;
  pct_yape: number;
  delta_pct_vs_tipico: number | null;
  serie_7d: number[];
  reparto: { sucursal_id: string; nombre: string; pct: number }[];
};
type Oido = { frase: string | null; sucursal_nombre: string | null; cuando_iso: string };
type Resumen = {
  fecha: string;
  revisado_2am: string | null;
  cadena: Cadena | null;
  boticas: Botica[];
  atencion: {
    casos_abiertos: number;
    recepciones_pendientes: number;
    lotes_por_vencer: number;
    lotes_por_vencer_30d: number;
    caja_ayer_peor_dif_cent: number;
  };
  top_productos: { producto_id: string; nombre: string; unidades: number; total_cent: number }[];
  oido: Oido[];
};

// Monto de caja con signo antepuesto ("−S/ 18.50" / "+S/ 2.00" / "S/ 0.00"). El helper de money
// firma dentro del "S/ "; aquí lo sacamos afuera para leer la dirección de un vistazo.
function moneyFirmado(cent: number): string {
  if (cent < 0) return `−${solesCent(-cent)}`;
  if (cent > 0) return `+${solesCent(cent)}`;
  return solesCent(0);
}

// Hora corta es-PE ("11:20 am") en zona de Lima, estable en cualquier navegador (en-US emite
// "11:20 AM" de forma fija → sólo normalizamos AM/PM a minúsculas).
function horaCorta(iso: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Lima",
  });
  return dtf.format(new Date(iso)).replace(" AM", " am").replace(" PM", " pm");
}

// Saludo por hora real (es-PE correcto: "Buenos días", no "Buenas días").
function saludo(nombre: string): string {
  // Hora en zona de Lima (no la del navegador/servidor, que puede ser UTC → "buenas noches" de día).
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Lima" }).format(new Date()));
  const franja = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  const primer = nombre.trim().split(/\s+/)[0] ?? nombre;
  return `${franja}, ${primer}`;
}

// Píldora de variación desde el delta YA calculado por el backend. Reusa <DeltaPill> (única fuente
// de los umbrales ±5% y del formato del texto) alimentándola con un par sintético hoy/típico que
// reproduce exactamente ese entero: round(((100+d)-100)/100*100) === d. Si d es null, no hay base
// → no se muestra pill (no inventamos una variación).
function DeltaDePct({ d, onDark = false }: { d: number | null; onDark?: boolean }) {
  if (d === null) return null;
  return <DeltaPill hoy={100 + d} tipico={100} onDark={onDark} />;
}

// Chip de "Caja de ayer" honesto con el signo real: cuadró (ok) / faltó (danger, dif<0) /
// sobró (warn, dif>0) / sin cierre (neutral). No fuerza "faltó" sobre un sobrante.
function ChipCaja({ caja }: { caja: Caja | null }) {
  if (caja == null) return <Chip variant="neutral">Caja de ayer · sin cierre</Chip>;
  if (caja.cuadro) return <Chip variant="ok">Caja de ayer: cuadró</Chip>;
  if (caja.dif_cent < 0) return <Chip variant="danger">Caja de ayer: faltó {solesCent(-caja.dif_cent)}</Chip>;
  return <Chip variant="warn">Caja de ayer: sobró {solesCent(caja.dif_cent)}</Chip>;
}

// Tarjeta por botica: venta del día, variación, mini-chart 7d, meta de tickets, caja de ayer y
// stock bajo. Estado en vivo = "próximamente" (sin heartbeat, sin punto verde/rojo falso).
function BoticaCard({ b }: { b: Botica }) {
  return (
    <Card className="gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-bold text-ink">{b.nombre}</span>
          <span className="text-[11.5px] text-ink-3-alt">{b.ciudad ?? "Ciudad · próximamente"}</span>
        </div>
        <span className="whitespace-nowrap text-[11px] text-ink-3-alt">En vivo · próximamente</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-[24px] font-bold tracking-[-0.01em] tabular-nums text-ink">{solesCent(b.ventas_cent)}</span>
        <DeltaDePct d={b.delta_pct_vs_tipico} />
      </div>
      <MiniBarChart data={b.serie_7d} />
      <span className="text-[12px] text-ink-3">
        {b.num_tickets} tickets · ticket promedio {solesCent(b.ticket_promedio_cent)}
      </span>
      <div className="flex items-center justify-between gap-2 border-t border-line-hoy pt-3">
        <ChipCaja caja={b.caja_ayer} />
        <span className="whitespace-nowrap text-[12px] tabular-nums text-ink-3">{b.stock_bajo} con stock bajo</span>
      </div>
      <span
        onClick={() => navegar("dashboard")}
        className="cursor-pointer self-start text-[12.5px] font-semibold text-link hover:underline"
      >
        Ver su día →
      </span>
    </Card>
  );
}

export function Hoy({ sesion }: { sesion: SesionActiva }) {
  const { data, cargando, error, recargar } = useApi<Resumen>("/hoy/resumen");

  if (cargando) return <Cargando que="tu día" />;
  if (error || !data)
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-[13px] text-ink-2">No se pudo cargar tu día.</p>
        <button type="button" onClick={recargar} className="text-[12.5px] text-link hover:underline">
          Reintentar
        </button>
      </div>
    );

  const { cadena, boticas, atencion, top_productos, oido } = data;
  const esSuper = cadena !== null;
  const sujeto = esSuper ? "La cadena" : "Tu botica";

  // Línea de resumen dinámica desde `atencion` (singular/plural correcto; verbo concuerda con el
  // total de pendientes). Sin pendientes → cierre tranquilo.
  const casos = atencion.casos_abiertos;
  const recep = atencion.recepciones_pendientes;
  const partes: string[] = [];
  if (casos > 0) partes.push(`${casos} ${casos === 1 ? "caso por revisar" : "casos por revisar"}`);
  if (recep > 0) partes.push(`${recep} ${recep === 1 ? "recepción por aprobar" : "recepciones por aprobar"}`);
  const linea =
    partes.length === 0
      ? `${sujeto} vende con normalidad y no hay nada pendiente de tu lado.`
      : `${sujeto} vende con normalidad. Te ${casos + recep === 1 ? "espera" : "esperan"} ${partes.join(" y ")}.`;

  // StatCard "Caja de ayer": peor descuadre + nombre de la botica que no cuadró (dato real).
  const peor = atencion.caja_ayer_peor_dif_cent;
  const hayCierres = boticas.some((b) => b.caja_ayer !== null);
  const boticaPeor = peor < 0 ? boticas.find((b) => b.caja_ayer && b.caja_ayer.dif_cent === peor) : undefined;
  const subCaja = !hayCierres
    ? "Sin cierres de ayer todavía"
    : peor < 0
      ? `${boticaPeor?.nombre ?? "Una botica"} no cuadró · revísalo`
      : "Todas cuadraron ayer";

  const d30 = atencion.lotes_por_vencer_30d;
  const sola = boticas[0]; // admin: su única botica

  return (
    <div className="flex flex-col gap-[26px]">
      {/* a) Saludo + resumen */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[23px] font-bold tracking-[-0.015em] text-ink">{saludo(sesion.usuario.nombre)}</h2>
        <p className="text-[14px] text-ink-2">{linea}</p>
      </div>

      {/* b) Necesita tu atención */}
      <section className="flex flex-col gap-3">
        <SectionLabel right="El sistema revisa cada madrugada">Necesita tu atención</SectionLabel>
        <div className="grid grid-cols-4 gap-3.5">
          <StatCard
            icon="rombo-rojo"
            label="Casos por revisar"
            value={casos}
            subtitle={casos > 0 ? "Confírmalos o descártalos" : "Nada por revisar hoy"}
            onClick={() => navegar("casos")}
          />
          <StatCard
            icon="cuadro-ambar"
            label="Recepciones por aprobar"
            value={recep}
            subtitle={recep > 0 ? "Llegaron por el asistente de Telegram" : "Nada por aprobar"}
            onClick={() => navegar("inventario")}
          />
          <StatCard
            icon="circulo-ambar"
            label="Lotes por vencer"
            value={atencion.lotes_por_vencer}
            subtitle={d30 > 0 ? `${d30} ${d30 === 1 ? "vence" : "vencen"} en menos de 30 días` : "Ninguno urgente (30 días)"}
            onClick={() => navegar("inventario")}
          />
          <StatCard
            icon="circulo-rojo"
            label="Caja de ayer"
            value={moneyFirmado(peor)}
            subtitle={subCaja}
            onClick={() => navegar("casos")}
            {...(peor < 0 ? { numberClassName: "text-accent-ink" } : {})}
          />
        </div>
      </section>

      {/* c) Tus boticas, hoy */}
      <section className="flex flex-col gap-3.5">
        <SectionLabel
          right={
            <button type="button" onClick={() => navegar("dashboard")} className="text-link hover:underline">
              Ver ventas y caja →
            </button>
          }
        >
          {esSuper ? `Tus ${boticas.length} ${boticas.length === 1 ? "botica" : "boticas"}, hoy` : "Tu botica, hoy"}
        </SectionLabel>

        {/* Barra oscura de cadena (solo super). */}
        {cadena !== null && (
          <div className="flex items-center gap-7 rounded-[14px] bg-ink-surface p-[20px_24px]">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-on-dark-2">Cadena · hoy</span>
              <div className="flex items-center gap-2.5">
                <span className="text-[30px] font-bold tracking-[-0.01em] tabular-nums text-on-dark">
                  {solesCent(cadena.ventas_cent)}
                </span>
                <DeltaDePct d={cadena.delta_pct_vs_tipico} onDark />
              </div>
              <span className="text-[11.5px] text-on-dark-2">
                {cadena.num_tickets} tickets · ticket promedio {solesCent(cadena.ticket_promedio_cent)} ·{" "}
                {cadena.pct_yape}% cobrado por Yape
              </span>
            </div>
            <div className="flex w-[380px] shrink-0 flex-col gap-2">
              <ChainStackBar
                segments={cadena.reparto.map((r, i) => ({ pct: r.pct, tono: String(Math.min(i + 1, 3)) as "1" | "2" | "3" }))}
              />
              <span className="text-[11.5px] text-on-dark-2">
                {cadena.reparto.length > 0
                  ? cadena.reparto.map((r) => `${r.nombre} ${r.pct}%`).join(" · ")
                  : "Aún sin ventas hoy"}
              </span>
            </div>
          </div>
        )}

        {/* Tarjetas por botica: grid de 3 para super; una prominente para admin. */}
        {esSuper ? (
          boticas.length > 0 ? (
            <div className="grid grid-cols-3 gap-3.5">
              {boticas.map((b) => (
                <BoticaCard key={b.sucursal_id} b={b} />
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-ink-3">Aún no hay boticas con ventas hoy.</p>
          )
        ) : sola ? (
          <div className="max-w-[420px]">
            <BoticaCard b={sola} />
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">Sin datos de tu botica hoy.</p>
        )}
      </section>

      {/* d) Lo más vendido + El oído */}
      <section className="grid grid-cols-[1.15fr_1fr] items-start gap-3.5">
        <Card className="gap-2">
          <span className="text-[13.5px] font-bold text-ink">Lo más vendido hoy{esSuper ? " en la cadena" : ""}</span>
          {top_productos.length === 0 ? (
            <EmptyState title="Todavía sin ventas hoy" subtitle="Cuando entren ventas, aquí verás lo más pedido." />
          ) : (
            <div className="flex flex-col">
              {top_productos.map((p, i) => (
                <div key={p.producto_id} className="flex items-center gap-3 border-b border-line-hoy py-2 last:border-0">
                  <span className="w-4 font-mono text-[12px] tabular-nums text-neutral-dot">{i + 1}</span>
                  <span className="flex-1 truncate text-[13.5px] font-medium text-ink">{p.nombre}</span>
                  <span className="whitespace-nowrap text-[12px] tabular-nums text-ink-3">{p.unidades} unid.</span>
                  <span className="w-[74px] text-right text-[13px] font-semibold tabular-nums text-ink">
                    {solesCent(p.total_cent)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="gap-3">
          <div className="flex items-center gap-2">
            <IconOido size={14} className="text-accent" />
            <span className="text-[13.5px] font-bold text-ink">El oído de la botica, hoy</span>
          </div>
          <p className="text-[12px] leading-[1.5] text-ink-2">
            El teléfono del mostrador reconoce frases como "no hay…" o "se acabó…" y las anota como faltantes. No graba
            conversaciones.
          </p>
          {oido.length === 0 ? (
            <EmptyState title="Hoy el oído no anotó faltantes" subtitle="Escucha frases como “no hay…” en el mostrador." />
          ) : (
            <div className="flex flex-col gap-2">
              {oido.map((o, i) => (
                <div key={i} className="flex flex-col gap-1 rounded-[9px] border border-line-inset bg-inset p-[10px_12px]">
                  <span className="font-mono text-[12px] text-ink-strong">“{o.frase ?? "faltante anotado"}”</span>
                  <span className="text-[11px] text-ink-3-alt">
                    {o.sucursal_nombre ?? "—"} · {horaCorta(o.cuando_iso)} · anotado como faltante
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => navegar("inventario")}
            className="self-start text-[12.5px] text-link hover:underline"
          >
            Ver todos los faltantes →
          </button>
        </Card>
      </section>
    </div>
  );
}
