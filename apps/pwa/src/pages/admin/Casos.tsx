import { useState } from "react";
import { useApi, mutar } from "../../lib/useApi";
import { Cargando, ErrorMsg } from "../../components/Estados";
import { fechaCorta } from "../../lib/fecha-ui";
import { solesCent } from "../../lib/money";
import type { SesionActiva } from "../../lib/tipos";
import {
  Card,
  Chip,
  SeverityChip,
  type SeverityNivel,
  Tabs,
  TabPill,
  TableHead,
  TableRow,
  Th,
  Td,
  SectionLabel,
  EmptyState,
  Button,
  Input,
  useToast,
  cn,
} from "../../components/ui";

// B11 — Bandeja de casos (EBR determinista) + Espejo operativo (espejo de vendedores). El sistema INFORMA;
// el humano confirma/descarta — jamás sanción automática. Todo desde datos POS; el audio JAMÁS entra aquí
// (veto D-N5). Refresh visual: tema claro + reorg de IA (lista+detalle maestro-detalle, 3 sub-tabs).
// Comportamiento intacto: mismas llamadas useApi/mutar, mismos paths, mismo aislamiento por sucursal.

type Caso = {
  id: string; tipo: string; indicador: string; severidad: number; estado: string;
  evidencia: Record<string, unknown>; revisor_id: string | null; notas: string | null; created_at: string; resuelto_at: string | null;
};
type Conteos = { abiertos: number; resueltos: number };
type Operador = {
  operador_id: string; operador_nombre: string; ventas: number; total_cent: number; ticket_cent: number;
  ventas_por_hora: number; servicio_prom_seg: number | null; anuladas: number; tasa_anulacion: number;
  cajon_sin_venta: number; cierres: number; faltante_cent: number; dias_activos: number;
};
type ResumenEspejo = { dias: number; operadores: Operador[]; promedio: { ticket_cent: number; ventas_por_hora: number; servicio_prom_seg: number | null; tasa_anulacion: number; cajon_sin_venta: number } };
type Sucursal = { id: string; nombre: string };

const IND_LABEL: Record<string, string> = {
  cajon_sin_venta: "Cajón abierto sin venta",
  anulaciones: "Anulaciones repetidas",
  venta_bajo_precio: "Venta bajo precio",
  descuadre: "Descuadre de caja",
  stock_negativo: "Stock en negativo",
  fuera_horario: "Venta fuera de horario",
  merma_conteo: "Merma por conteo",
};

// "Qué suele significar": copy CONTEXTUAL no acusatorio por indicador. Es constante de UI (no dato, no
// endpoint) — orienta al dueño para conversar sin acusar. El de descuadre es el verbatim del prototipo.
const SIGNIFICADO: Record<string, string> = {
  descuadre:
    "Un descuadre chico y aislado suele ser un vuelto mal dado. Si se repite en la semana, o coincide con anulaciones cerca del cierre, conviene mirarlo con calma.",
  anulaciones:
    "Anular ventas es parte del trabajo, pero un ritmo muy por encima del resto de la botica a veces esconde ventas que no llegaron a la caja. Vale conversarlo sin acusar.",
  cajon_sin_venta:
    "Abrir el cajón sin registrar venta puede ser para dar vuelto o guardar sencillo. Si pasa mucho más que en el resto de la botica, conviene entender por qué.",
  venta_bajo_precio:
    "Cobrar por debajo del precio puede ser un descuento acordado o un error de dedo. Si se repite, revisa que el precio del sistema esté al día.",
  stock_negativo:
    "El stock en negativo casi siempre es una recepción que no se registró. Regístrala para que el inventario vuelva a cuadrar.",
  fuera_horario:
    "Una venta fuera del horario declarado puede ser una atención de última hora o un horario desactualizado. Si el horario cambió, actualízalo en Ajustes.",
  merma_conteo:
    "La diferencia de un conteo puede venir de una recepción mal contada, un vencimiento o una pérdida. No se atribuye a nadie: es para revisar el manejo del producto.",
};

const tipoLabel = (t: string) => (t === "perdida" ? "Pérdida" : "Personal");

// El dato trae 3 niveles de severidad (1|2|3); el matiz Crítico/Alto para el nivel 3 lo da el TIPO
// (una pérdida es más crítica que una señal de personal) — no se inventa un 4º nivel.
function nivelSeveridad(severidad: number, tipo: string): SeverityNivel {
  if (severidad >= 3) return tipo === "perdida" ? "Crítico" : "Alto";
  if (severidad === 2) return "Medio";
  return "Bajo";
}

const SEV_DOT: Record<SeverityNivel, string> = {
  Crítico: "bg-accent",
  Alto: "bg-dot-alto",
  Medio: "bg-sev-medio-dot",
  Bajo: "bg-neutral-dot",
};
const SEV_FG: Record<SeverityNivel, string> = {
  Crítico: "text-accent-ink",
  Alto: "text-accent-ink",
  Medio: "text-warn",
  Bajo: "text-neutral-2",
};

function estadoTag(estado: string): { texto: string; cls: string } | null {
  if (estado === "confirmado") return { texto: "Confirmado", cls: "text-accent-ink" };
  if (estado === "descartado") return { texto: "Descartado", cls: "text-neutral-2" };
  if (estado === "autocerrado") return { texto: "Cerrado solo", cls: "text-neutral-2" };
  return null;
}

// Líneas de EVIDENCIA: solo campos que el indicador SÍ persiste en `evidencia`. Nunca se fabrica el
// desglose rico del mock; se renderiza lo que existe. Montos con money.ts (céntimos → soles es-PE).
function evidenciaLineas(c: Caso): string[] {
  const ev = c.evidencia ?? {};
  const num = (k: string): number | null => (typeof ev[k] === "number" ? (ev[k] as number) : null);
  const str = (k: string): string | null => (typeof ev[k] === "string" ? (ev[k] as string) : null);
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const out: string[] = [];
  switch (c.indicador) {
    case "descuadre": {
      const dif = num("diferencia_cent");
      if (dif !== null) out.push(`Faltante de caja: ${solesCent(Math.abs(dif))}`);
      const dias = Array.isArray(ev.dias) ? ev.dias.length : null;
      const total = num("total_cent");
      if (dias !== null) out.push(`${dias} días con faltante en 30 días`);
      if (total !== null) out.push(`Total del periodo: ${solesCent(Math.abs(total))}`);
      const fecha = str("fecha");
      if (fecha) out.push(`Fecha: ${fecha}`);
      break;
    }
    case "anulaciones": {
      const anul = num("anuladas");
      const ventas = num("ventas");
      const tasa = num("tasa");
      const prom = num("tasa_promedio_botica");
      if (anul !== null && ventas !== null) out.push(`${anul} de ${ventas} ventas anuladas${tasa !== null ? ` (${pct(tasa)})` : ""}`);
      if (prom !== null) out.push(`Promedio de la botica: ${pct(prom)}`);
      break;
    }
    case "cajon_sin_venta": {
      const eventos = num("eventos");
      const prom = num("promedio_botica");
      const fecha = str("fecha");
      if (eventos !== null) out.push(`${eventos} aperturas de cajón sin venta`);
      if (prom !== null) out.push(`Promedio de la botica: ${prom.toFixed(1)}`);
      if (fecha) out.push(`Fecha: ${fecha}`);
      break;
    }
    case "venta_bajo_precio": {
      const lineas = num("lineas");
      const dif = num("diferencia_cent");
      if (lineas !== null) out.push(`${lineas} líneas cobradas bajo precio`);
      if (dif !== null) out.push(`Por debajo del precio: ${solesCent(dif)}`);
      if (Array.isArray(ev.ejemplos)) {
        for (const e of (ev.ejemplos as Array<Record<string, unknown>>).slice(0, 4)) {
          const p = typeof e.producto === "string" ? e.producto : null;
          const cant = typeof e.cantidad === "number" ? e.cantidad : null;
          if (p) out.push(`· ${p}${cant !== null ? ` ×${cant}` : ""}`);
        }
      }
      break;
    }
    case "stock_negativo": {
      const p = str("producto");
      const stock = num("stock");
      if (p && stock !== null) out.push(`${p}: stock ${stock}`);
      break;
    }
    case "fuera_horario": {
      const total = num("total");
      const horario = str("horario");
      if (total !== null) out.push(`${total} venta(s) fuera de horario`);
      if (horario) out.push(`Horario declarado: ${horario}`);
      break;
    }
    case "merma_conteo": {
      const merma = num("merma_cent") ?? num("valor_cent");
      if (merma !== null) out.push(`Merma valorizada: ${solesCent(Math.abs(merma))}`);
      const fecha = str("fecha");
      if (fecha) out.push(`Fecha: ${fecha}`);
      const ses = num("sesiones");
      if (ses !== null) out.push(`Faltante en ${ses} conteos distintos`);
      if (Array.isArray(ev.faltantes)) {
        for (const f of (ev.faltantes as Array<Record<string, unknown>>).slice(0, 4)) {
          const p = typeof f.producto === "string" ? f.producto : null;
          const u = typeof f.unidades === "number" ? f.unidades : null;
          if (p) out.push(`· ${p}${u !== null ? ` (${u} u)` : ""}`);
        }
      }
      break;
    }
  }
  return out;
}

export function Casos({ sesion }: { sesion: SesionActiva }) {
  const esSuper = sesion.usuario.rol === "super_admin";
  const [sucSel, setSucSel] = useState<string>("");
  const [tab, setTab] = useState<"revisar" | "resueltos" | "espejo">("revisar");
  const sucursales = useApi<{ sucursales: Sucursal[] }>(esSuper ? "/sucursales" : null);
  const suc = esSuper ? sucSel : (sesion.usuario.sucursalId ?? "");
  const listo = !esSuper || !!suc;
  const qSuc = esSuper && suc ? `?sucursal_id=${suc}` : "";
  const boticaNombre = esSuper
    ? (sucursales.data?.sucursales.find((s) => s.id === suc)?.nombre ?? "")
    : (sesion.sucursal?.nombre ?? "");

  // Conteos para las pestañas (siempre disponibles, incluso en el tab Espejo). Se recargan tras cada acción.
  const conteo = useApi<Conteos>(listo ? `/casos/conteo${qSuc}` : null, [suc]);
  const nRev = conteo.data?.abiertos ?? 0;
  const nRes = conteo.data?.resueltos ?? 0;

  return (
    <div className="flex flex-col gap-[18px]">
      <p className="max-w-[720px] text-[13.5px] leading-[1.5] text-ink-2">
        Cada noche el sistema revisa las ventas, la caja y el stock. Cuando algo se sale de lo normal, lo levanta aquí.{" "}
        <span className="font-semibold text-ink-emph">Tú confirmas o descartas — nada se sanciona solo.</span>
      </p>

      {esSuper && (
        <select
          value={sucSel}
          onChange={(e) => setSucSel(e.target.value)}
          className="w-full max-w-xs rounded-[9px] border border-line-input bg-field px-3 py-2.5 text-[13px] text-ink outline-none"
        >
          <option value="">— Elige una sucursal —</option>
          {(sucursales.data?.sucursales ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      <Tabs>
        <TabPill active={tab === "revisar"} onClick={() => setTab("revisar")}>Por revisar ({nRev})</TabPill>
        <TabPill active={tab === "resueltos"} onClick={() => setTab("resueltos")}>Resueltos ({nRes})</TabPill>
        <TabPill active={tab === "espejo"} onClick={() => setTab("espejo")}>Espejo de vendedores</TabPill>
      </Tabs>

      {!listo ? (
        <EmptyState title="Elige una sucursal para ver sus casos." />
      ) : tab === "espejo" ? (
        <Espejo qSuc={qSuc} sucKey={suc} boticaNombre={boticaNombre} />
      ) : (
        <Bandeja
          estado={tab === "revisar" ? "abierto" : "resueltos"}
          qSuc={qSuc}
          sucKey={suc}
          boticaNombre={boticaNombre}
          onCambio={conteo.recargar}
        />
      )}
    </div>
  );
}

function Bandeja({ estado, qSuc, sucKey, boticaNombre, onCambio }: {
  estado: "abierto" | "resueltos"; qSuc: string; sucKey: string; boticaNombre: string; onCambio: () => void;
}) {
  const q = `${qSuc}${qSuc ? "&" : "?"}estado=${estado}`;
  const casos = useApi<{ casos: Caso[]; conteos: Conteos }>(`/casos${q}`, [sucKey, estado]);
  const items = casos.data?.casos ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const sel = items.find((c) => c.id === selId) ?? items[0] ?? null;

  if (casos.cargando) return <Cargando que="casos" />;
  if (casos.error) return <ErrorMsg msg={casos.error} onReintentar={casos.recargar} />;
  if (items.length === 0) {
    return estado === "abierto" ? (
      <EmptyState title="Nada por revisar" subtitle="El sistema vuelve a revisar esta noche a las 2:00 am." />
    ) : (
      <EmptyState title="Nada por aquí" subtitle="Los casos que confirmes o descartes quedarán en esta lista." />
    );
  }

  return (
    <div className="grid grid-cols-[400px_1fr] items-start gap-4">
      <ul className="flex flex-col gap-2">
        {items.map((c) => (
          <CasoCard key={c.id} c={c} boticaNombre={boticaNombre} activo={sel?.id === c.id} onClick={() => setSelId(c.id)} />
        ))}
      </ul>
      {sel && (
        <Detalle
          key={sel.id}
          c={sel}
          qSuc={qSuc}
          boticaNombre={boticaNombre}
          onResuelto={() => { casos.recargar(); onCambio(); }}
        />
      )}
    </div>
  );
}

function CasoCard({ c, boticaNombre, activo, onClick }: {
  c: Caso; boticaNombre: string; activo: boolean; onClick: () => void;
}) {
  const nivel = nivelSeveridad(c.severidad, c.tipo);
  const tag = estadoTag(c.estado);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full rounded-[12px] border p-[12px_14px] text-left transition-colors",
          activo ? "border-line-sel bg-card" : "border-line bg-transparent hover:bg-card",
        )}
      >
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 flex-none rounded-full", SEV_DOT[nivel])} />
          <span className={cn("text-[11px] font-bold uppercase tracking-[0.05em]", SEV_FG[nivel])}>{nivel}</span>
          {tag && <span className={cn("ml-auto text-[11px] font-semibold", tag.cls)}>{tag.texto}</span>}
        </div>
        <p className="mt-1.5 text-[13.5px] font-semibold text-ink">{IND_LABEL[c.indicador] ?? c.indicador}</p>
        <p className="mt-0.5 text-[12px] text-ink-3">
          {tipoLabel(c.tipo)}{boticaNombre ? ` · ${boticaNombre}` : ""} · {fechaCorta(c.created_at)}
        </p>
      </button>
    </li>
  );
}

function Detalle({ c, qSuc, boticaNombre, onResuelto }: {
  c: Caso; qSuc: string; boticaNombre: string; onResuelto: () => void;
}) {
  const toast = useToast();
  const [notas, setNotas] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const nivel = nivelSeveridad(c.severidad, c.tipo);
  const lineas = evidenciaLineas(c);
  const resumen = typeof c.evidencia.resumen === "string" ? c.evidencia.resumen : (IND_LABEL[c.indicador] ?? c.indicador);
  const abierto = c.estado === "abierto";

  async function accion(kind: "confirmar" | "descartar" | "reabrir") {
    setOcupado(true);
    try {
      const opts = kind === "reabrir"
        ? { method: "POST" as const }
        : { method: "POST" as const, body: { notas: notas.trim() || undefined } };
      await mutar(`/casos/${c.id}/${kind}${qSuc}`, opts);
      if (kind === "confirmar") toast("Caso confirmado. Quedó anotado en el historial.");
      else if (kind === "descartar") toast("Caso descartado. Todo en orden.");
      else toast("El caso volvió a Por revisar.");
      onResuelto();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card size="lg" className="min-w-0 gap-3">
      <div className="flex items-center gap-2">
        <SeverityChip nivel={nivel} />
        <Chip variant="neutral">{tipoLabel(c.tipo)}</Chip>
      </div>
      <h2 className="text-[18px] font-bold leading-[1.3] tracking-[-0.01em] text-ink">{IND_LABEL[c.indicador] ?? c.indicador}</h2>
      <p className="text-[12.5px] text-ink-3">{boticaNombre ? `${boticaNombre} · ` : ""}{fechaCorta(c.created_at)}</p>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Qué pasó</SectionLabel>
        <p className="text-[13.5px] leading-[1.5] text-ink-strong">{resumen}</p>
      </div>

      {lineas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Evidencia</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {lineas.map((l, i) => (
              <p key={i} className="rounded-[8px] border border-line-inset bg-inset px-3 py-2 font-mono text-[12px] text-ink-strong">{l}</p>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Qué suele significar</SectionLabel>
        <p className="rounded-[10px] bg-inset-2 px-[14px] py-[11px] text-[13px] leading-[1.5] text-ink-emph">
          {SIGNIFICADO[c.indicador] ?? "Revisa este caso con calma antes de decidir."}
        </p>
      </div>

      <div className="mt-1 border-t border-line-row pt-3">
        {abierto ? (
          <div className="flex flex-col gap-2.5">
            <Input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Escribe una nota si quieres (ej.: hablé con Teodoro, fue un vuelto mal dado)"
              disabled={ocupado}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void accion("confirmar")} disabled={ocupado}>Confirmar caso</Button>
              <Button variant="outline" onClick={() => void accion("descartar")} disabled={ocupado}>Descartar, todo en orden</Button>
            </div>
            <p className="text-[11.5px] text-ink-3-alt">
              Confirmar no sanciona a nadie: deja el caso anotado para que lo converses con el encargado.
            </p>
          </div>
        ) : (
          <Resuelto c={c} ocupado={ocupado} onDeshacer={() => void accion("reabrir")} />
        )}
      </div>
    </Card>
  );
}

function Resuelto({ c, ocupado, onDeshacer }: { c: Caso; ocupado: boolean; onDeshacer: () => void }) {
  const conf = c.estado === "confirmado";
  const auto = c.estado === "autocerrado";
  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn("rounded-[10px] px-[14px] py-3", conf ? "bg-accent-soft" : "bg-neutral-soft")}>
        <p className={cn("text-[13px] font-bold", conf ? "text-accent-ink" : "text-ink-emph")}>
          {conf ? "Confirmaste este caso" : auto ? "Se cerró solo por antigüedad" : "Lo descartaste — todo en orden"}
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-2">
          {conf
            ? "Quedó en el historial para conversarlo con el encargado."
            : auto
              ? "El sistema cierra los casos sin resolver a los 14 días."
              : "No hacía falta ninguna acción."}
        </p>
        {c.notas && <p className="mt-1.5 text-[12.5px] italic text-ink-2">Tu nota: “{c.notas}”</p>}
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={onDeshacer} disabled={ocupado}>Deshacer</Button>
      </div>
    </div>
  );
}

function Espejo({ qSuc, sucKey, boticaNombre }: { qSuc: string; sucKey: string; boticaNombre: string }) {
  const [dias, setDias] = useState(30);
  const q = `${qSuc}${qSuc ? "&" : "?"}dias=${dias}`;
  const espejo = useApi<ResumenEspejo>(`/casos/espejo${q}`, [sucKey, dias]);
  const d = espejo.data;
  const cols = "170px 150px 1fr 100px 110px 110px";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[640px] text-[13px] leading-[1.5] text-ink-2">
          Compara a cada vendedor <span className="font-semibold text-ink-emph">solo con el promedio de su propia botica</span> (la línea vertical). Es información para conversar mejor, no para sancionar.
        </p>
        <Tabs>
          <TabPill active={dias === 7} onClick={() => setDias(7)}>7 días</TabPill>
          <TabPill active={dias === 30} onClick={() => setDias(30)}>30 días</TabPill>
        </Tabs>
      </div>

      {espejo.cargando ? (
        <Cargando que="espejo" />
      ) : espejo.error ? (
        <ErrorMsg msg={espejo.error} onReintentar={espejo.recargar} />
      ) : !d || d.operadores.length === 0 ? (
        <EmptyState title="Sin ventas de vendedores en este periodo" subtitle="Aparecerá aquí cuando haya ventas registradas." />
      ) : (
        <Card size="lg" className="min-w-0">
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <TableHead cols={cols}>
                <Th>Vendedor</Th>
                <Th>Botica</Th>
                <Th>Ventas por turno (100 = promedio)</Th>
                <Th align="right">Ticket prom.</Th>
                <Th align="right">Anulaciones</Th>
                <Th align="right">Descuentos</Th>
              </TableHead>
              {d.operadores.map((o) => {
                const base = d.promedio.ventas_por_hora;
                const idx = base > 0 ? Math.round((o.ventas_por_hora / base) * 100) : 100;
                const anulAlta = o.tasa_anulacion > d.promedio.tasa_anulacion * 1.5 && o.anuladas > 0;
                return (
                  <TableRow key={o.operador_id} cols={cols}>
                    <Td className="text-[13px] font-semibold text-ink">{o.operador_nombre}</Td>
                    <Td className="text-[12.5px] text-ink-2">{boticaNombre || "—"}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-neutral-soft">
                          <div className="h-full rounded-full bg-espejo-bar" style={{ width: `${Math.min(100, Math.max(0, (idx / 125) * 100))}%` }} />
                          <div className="absolute top-0 h-full w-[2px] bg-espejo-mark" style={{ left: "80%" }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-ink-2">{idx}</span>
                      </div>
                    </Td>
                    <Td align="right" className="text-[13px] tabular-nums text-ink">{solesCent(o.ticket_cent)}</Td>
                    <Td align="right" className={cn("text-[13px] tabular-nums", anulAlta ? "font-semibold text-accent-ink" : "text-ink")}>
                      {(o.tasa_anulacion * 100).toFixed(1)}%{anulAlta ? " · alto" : ""}
                    </Td>
                    <Td align="right" className="text-[12.5px] text-ink-3">—</Td>
                  </TableRow>
                );
              })}
              <TableRow cols={cols}>
                <Td className="text-[12.5px] italic text-ink-2">Promedio de la botica</Td>
                <Td className="text-[12.5px] text-ink-3">{boticaNombre || "—"}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-neutral-soft">
                      <div className="absolute top-0 h-full w-[2px] bg-espejo-mark" style={{ left: "80%" }} />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-ink-2">100</span>
                  </div>
                </Td>
                <Td align="right" className="text-[13px] italic tabular-nums text-ink-2">{solesCent(d.promedio.ticket_cent)}</Td>
                <Td align="right" className="text-[13px] italic tabular-nums text-ink-2">{(d.promedio.tasa_anulacion * 100).toFixed(1)}%</Td>
                <Td align="right" className="text-[12.5px] text-ink-3">—</Td>
              </TableRow>
            </div>
          </div>
          <p className="mt-3 text-[11.5px] text-ink-3-alt">
            Promedios de los últimos {d.dias} días, calculados por botica para no comparar boticas distintas. La columna <span className="font-semibold">Descuentos</span> se conecta próximamente.
          </p>
        </Card>
      )}
    </div>
  );
}
