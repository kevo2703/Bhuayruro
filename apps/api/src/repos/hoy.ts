import { pctIdentificadas } from "@huayruro/shared";
import { fechaLocal, rangoDiaLima } from "../lib/fecha";
import { withRetry } from "./base";

// ============================================================
// "Hoy" (refresh visual del panel del dueño) — LECTURA agregada del día para la portada.
// admin_sucursal → SOLO su sucursal (cadena = null). super_admin → cadena + sus boticas del tenant.
// Todo agregado por día LOCAL Lima (date(fecha_hora,'-5 hours') / rangoDiaLima), dinero en enteros.
// Aislamiento: el alcance de sucursales SIEMPRE sale del tenant del actor (nunca de otro tenant); la
// lista cadena-wide filtra por tenant_id (patrón dashboardRepo.consolidado). Este repo NO toca audio
// (el "oído" se enriquece en la ruta vía repos/audio.ts, para respetar el VETO D-N5 y su test).
// ============================================================

const DIA_MS = 86_400_000;

// Horizontes fijos de "por vencer" del panel (ajustables aquí sin migración). No inventan esquema:
// solo eligen la ventana de conteo que muestra la portada.
const VENCE_URGENTE_DIAS = 90; // panorama de reposición (incluye ya vencidos)
const VENCE_30D = 30; // lo urgente

// Ventana del KPI "% de ventas identificadas" (A1). 30 días incluyendo hoy: la meta del plan es
// mensual (≥30 % el mes 1), y el dato de un solo día es demasiado ruidoso para decidir nada.
const IDENT_DIAS = 30;

// KPI A1: cuántas de las ventas del periodo salieron con cliente identificado. `pct` es null cuando no
// hubo ventas — un 0 % ahí se leería como "nadie se identificó" en vez de "no se vendió".
export type Identificadas = {
  ventas: number;
  identificadas: number;
  pct: number | null;
};

export type HoyBotica = {
  sucursal_id: string;
  nombre: string;
  ciudad: string | null; // sin columna → la UI lo rotula "próximamente"
  en_linea: boolean | null; // sin heartbeat → la UI lo rotula "próximamente"
  ventas_cent: number;
  num_tickets: number;
  ticket_promedio_cent: number;
  delta_pct_vs_tipico: number | null;
  serie_7d: number[];
  caja_ayer: { dif_cent: number; cuadro: boolean } | null;
  stock_bajo: number;
  identificadas_hoy: Identificadas;
  identificadas_30d: Identificadas;
};

export type HoyCadena = {
  ventas_cent: number;
  num_tickets: number;
  ticket_promedio_cent: number;
  pct_yape: number;
  delta_pct_vs_tipico: number | null;
  serie_7d: number[];
  reparto: { sucursal_id: string; nombre: string; pct: number }[];
  identificadas_hoy: Identificadas;
  identificadas_30d: Identificadas;
};

export type HoyOido = { frase: string | null; sucursal_nombre: string | null; cuando_iso: string };

export type HoyResumen = {
  fecha: string;
  revisado_2am: string | null;
  cadena: HoyCadena | null;
  boticas: HoyBotica[];
  atencion: {
    casos_abiertos: number;
    recepciones_pendientes: number;
    lotes_por_vencer: number;
    lotes_por_vencer_30d: number;
    caja_ayer_peor_dif_cent: number;
  };
  top_productos: { producto_id: string; nombre: string; unidades: number; total_cent: number }[];
  oido: HoyOido[];
};

const identificadas = (ventas: number, conCliente: number): Identificadas => ({
  ventas,
  identificadas: conCliente,
  pct: pctIdentificadas(conCliente, ventas),
});

const SIN_IDENTIFICADAS: Identificadas = { ventas: 0, identificadas: 0, pct: null };

// round((hoy - baseline)/baseline*100); baseline 0 → null (no inventamos delta sin base).
function delta(hoy: number, baseline: number): number | null {
  return baseline > 0 ? Math.round(((hoy - baseline) / baseline) * 100) : null;
}

// YYYY-MM-DD Lima desplazado en días (mediodía UTC para no rozar el borde de zona).
function ymdMasDias(ymd: string, dias: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00.000Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

export function hoyRepo(db: D1Database) {
  return {
    async resumen(opts: { tenantId: string; esSuper: boolean; sucursalId: string | null; nowIso: string }): Promise<HoyResumen> {
      const hoyYmd = fechaLocal("America/Lima", new Date(opts.nowIso));
      const { inicio: hoyIni, fin: hoyFin } = rangoDiaLima(hoyYmd);
      const serieIni = new Date(Date.parse(hoyIni) - 6 * DIA_MS).toISOString(); // 7 días incluyendo hoy
      const base14Ini = new Date(Date.parse(hoyIni) - 14 * DIA_MS).toISOString(); // 14 días EXCLUYENDO hoy
      const ayerYmd = fechaLocal("America/Lima", new Date(Date.parse(hoyIni) - DIA_MS));
      const lim30 = ymdMasDias(hoyYmd, VENCE_30D);
      const lim90 = ymdMasDias(hoyYmd, VENCE_URGENTE_DIAS);
      const identIni = new Date(Date.parse(hoyIni) - (IDENT_DIAS - 1) * DIA_MS).toISOString(); // 30 días CON hoy

      const vacia = (): HoyResumen => ({
        fecha: hoyYmd,
        revisado_2am: null, // sin tabla de última corrida del Cron EBR → no derivable de forma fiable
        cadena: opts.esSuper
          ? {
              ventas_cent: 0, num_tickets: 0, ticket_promedio_cent: 0, pct_yape: 0, delta_pct_vs_tipico: null,
              serie_7d: new Array(7).fill(0), reparto: [],
              identificadas_hoy: SIN_IDENTIFICADAS, identificadas_30d: SIN_IDENTIFICADAS,
            }
          : null,
        boticas: [],
        atencion: { casos_abiertos: 0, recepciones_pendientes: 0, lotes_por_vencer: 0, lotes_por_vencer_30d: 0, caja_ayer_peor_dif_cent: 0 },
        top_productos: [],
        oido: [],
      });

      // ---- Alcance de sucursales (con nombre) — SIEMPRE del tenant del actor (aislamiento). ----
      const sucursales = opts.esSuper
        ? (await withRetry(() => db.prepare(`SELECT id, nombre FROM sucursal WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY nombre`).bind(opts.tenantId).all<{ id: string; nombre: string }>())).results
        : opts.sucursalId
          ? (await withRetry(() => db.prepare(`SELECT id, nombre FROM sucursal WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`).bind(opts.sucursalId, opts.tenantId).all<{ id: string; nombre: string }>())).results
          : [];
      const ids = sucursales.map((s) => s.id);
      if (ids.length === 0) return vacia();

      const ph = ids.map((_, i) => `?${i + 1}`).join(",");
      const n = ids.length;
      const p = (...extra: unknown[]) => [...ids, ...extra]; // binds: sucursales + ventana

      const res = await withRetry(() =>
        db.batch([
          // [0] hoy por sucursal: tickets, total, yape
          db.prepare(`SELECT sucursal_id, COUNT(*) AS n, COALESCE(SUM(total_cent),0) AS total,
                        COALESCE(SUM(CASE WHEN metodo_pago='yape' THEN total_cent ELSE 0 END),0) AS yape
                      FROM venta WHERE sucursal_id IN (${ph}) AND estado='completada' AND fecha_hora >= ?${n + 1} AND fecha_hora < ?${n + 2}
                      GROUP BY sucursal_id`).bind(...p(hoyIni, hoyFin)),
          // [1] serie 7d por sucursal y día
          db.prepare(`SELECT sucursal_id, date(fecha_hora,'-5 hours') AS dia, COALESCE(SUM(total_cent),0) AS total
                      FROM venta WHERE sucursal_id IN (${ph}) AND estado='completada' AND fecha_hora >= ?${n + 1} AND fecha_hora < ?${n + 2}
                      GROUP BY sucursal_id, dia`).bind(...p(serieIni, hoyFin)),
          // [2] baseline 14d (excluye hoy) por sucursal
          db.prepare(`SELECT sucursal_id, COALESCE(SUM(total_cent),0) AS total
                      FROM venta WHERE sucursal_id IN (${ph}) AND estado='completada' AND fecha_hora >= ?${n + 1} AND fecha_hora < ?${n + 2}
                      GROUP BY sucursal_id`).bind(...p(base14Ini, hoyIni)),
          // [3] stock bajo por sucursal
          db.prepare(`SELECT sucursal_id, COUNT(*) AS n FROM inventario_local WHERE sucursal_id IN (${ph}) AND stock_unidades <= stock_minimo GROUP BY sucursal_id`).bind(...ids),
          // [4] cierre de ayer por sucursal
          db.prepare(`SELECT sucursal_id, diferencia_cent FROM cierre_caja WHERE sucursal_id IN (${ph}) AND fecha = ?${n + 1}`).bind(...p(ayerYmd)),
          // [5] casos abiertos (cadena-wide en alcance)
          db.prepare(`SELECT COUNT(*) AS n FROM caso WHERE sucursal_id IN (${ph}) AND estado='abierto'`).bind(...ids),
          // [6] recepciones pendientes (bandeja del bot)
          db.prepare(`SELECT COUNT(*) AS n FROM recepcion_borrador WHERE sucursal_id IN (${ph}) AND estado='pendiente'`).bind(...ids),
          // [7] lotes por vencer (horizonte amplio) + [8] a 30 días
          db.prepare(`SELECT COUNT(*) AS n FROM lote l JOIN inventario_local i ON i.id=l.inventario_id WHERE i.sucursal_id IN (${ph}) AND l.unidades>0 AND l.fecha_vencimiento <= ?${n + 1}`).bind(...p(lim90)),
          db.prepare(`SELECT COUNT(*) AS n FROM lote l JOIN inventario_local i ON i.id=l.inventario_id WHERE i.sucursal_id IN (${ph}) AND l.unidades>0 AND l.fecha_vencimiento <= ?${n + 1}`).bind(...p(lim30)),
          // [9] peor faltante de caja de ayer (más negativo)
          db.prepare(`SELECT MIN(diferencia_cent) AS peor FROM cierre_caja WHERE sucursal_id IN (${ph}) AND fecha = ?${n + 1}`).bind(...p(ayerYmd)),
          // [10] top 5 productos de hoy (cadena si super, sucursal si admin)
          db.prepare(`SELECT vi.producto_id, p.nombre, SUM(vi.cantidad) AS unidades, SUM(vi.total_cent) AS total_cent
                      FROM venta_item vi JOIN venta v ON v.id=vi.venta_id JOIN producto_catalogo p ON p.id=vi.producto_id
                      WHERE v.sucursal_id IN (${ph}) AND v.estado='completada' AND v.fecha_hora >= ?${n + 1} AND v.fecha_hora < ?${n + 2}
                      GROUP BY vi.producto_id ORDER BY total_cent DESC LIMIT 5`).bind(...p(hoyIni, hoyFin)),
          // [11] KPI A1 "% de ventas identificadas" por sucursal, en UNA pasada para las dos ventanas
          // (30 días y hoy). Es un AGREGADO: cuenta cuántas ventas traen cliente, sin tocar el padrón —
          // por eso puede vivir en /hoy/resumen, que también lee `lector_reportes`.
          db.prepare(`SELECT sucursal_id,
                             COUNT(*) AS n30,
                             COALESCE(SUM(CASE WHEN cliente_id IS NOT NULL THEN 1 ELSE 0 END),0) AS ident30,
                             COALESCE(SUM(CASE WHEN fecha_hora >= ?${n + 3} THEN 1 ELSE 0 END),0) AS n_hoy,
                             COALESCE(SUM(CASE WHEN fecha_hora >= ?${n + 3} AND cliente_id IS NOT NULL THEN 1 ELSE 0 END),0) AS ident_hoy
                      FROM venta WHERE sucursal_id IN (${ph}) AND estado='completada' AND fecha_hora >= ?${n + 1} AND fecha_hora < ?${n + 2}
                      GROUP BY sucursal_id`).bind(...p(identIni, hoyFin, hoyIni)),
        ]),
      );

      const hoyFilas = res[0]!.results as { sucursal_id: string; n: number; total: number; yape: number }[];
      const serieFilas = res[1]!.results as { sucursal_id: string; dia: string; total: number }[];
      const baseFilas = res[2]!.results as { sucursal_id: string; total: number }[];
      const stockFilas = res[3]!.results as { sucursal_id: string; n: number }[];
      const cajaFilas = res[4]!.results as { sucursal_id: string; diferencia_cent: number }[];
      const identFilas = res[11]!.results as { sucursal_id: string; n30: number; ident30: number; n_hoy: number; ident_hoy: number }[];
      const identPor = new Map(identFilas.map((f) => [f.sucursal_id, f]));

      const hoyPor = new Map(hoyFilas.map((f) => [f.sucursal_id, f]));
      const basePor = new Map(baseFilas.map((f) => [f.sucursal_id, f.total]));
      const stockPor = new Map(stockFilas.map((f) => [f.sucursal_id, f.n]));
      const cajaPor = new Map(cajaFilas.map((f) => [f.sucursal_id, f.diferencia_cent]));
      const seriePor = new Map<string, Map<string, number>>();
      for (const f of serieFilas) {
        const m = seriePor.get(f.sucursal_id) ?? new Map<string, number>();
        m.set(f.dia, f.total);
        seriePor.set(f.sucursal_id, m);
      }

      // Etiquetas de los 7 días (hoy-6 … hoy).
      const dias7 = Array.from({ length: 7 }, (_, i) => ymdMasDias(hoyYmd, i - 6));

      const boticas: HoyBotica[] = sucursales.map((s) => {
        const h = hoyPor.get(s.id);
        const total = h?.total ?? 0;
        const num = h?.n ?? 0;
        const baseline = (basePor.get(s.id) ?? 0) / 14;
        const serieMap = seriePor.get(s.id);
        const cajaDif = cajaPor.get(s.id);
        const ident = identPor.get(s.id);
        return {
          sucursal_id: s.id,
          nombre: s.nombre,
          ciudad: null,
          en_linea: null,
          ventas_cent: total,
          num_tickets: num,
          ticket_promedio_cent: num > 0 ? Math.round(total / num) : 0,
          delta_pct_vs_tipico: delta(total, baseline),
          serie_7d: dias7.map((d) => serieMap?.get(d) ?? 0),
          caja_ayer: cajaDif === undefined ? null : { dif_cent: cajaDif, cuadro: cajaDif === 0 },
          stock_bajo: stockPor.get(s.id) ?? 0,
          identificadas_hoy: identificadas(ident?.n_hoy ?? 0, ident?.ident_hoy ?? 0),
          identificadas_30d: identificadas(ident?.n30 ?? 0, ident?.ident30 ?? 0),
        };
      });

      // ---- Cadena (solo super): agregados de todas SUS boticas. ----
      let cadena: HoyCadena | null = null;
      if (opts.esSuper) {
        const total = boticas.reduce((a, b) => a + b.ventas_cent, 0);
        const num = boticas.reduce((a, b) => a + b.num_tickets, 0);
        const yape = hoyFilas.reduce((a, f) => a + f.yape, 0);
        const baseChain = baseFilas.reduce((a, f) => a + f.total, 0) / 14;
        // Serie cadena = suma por día a través de las boticas (mismos 7 índices de día).
        const serieChain = dias7.map((_d, di) => boticas.reduce((a, b) => a + (b.serie_7d[di] ?? 0), 0));
        cadena = {
          ventas_cent: total,
          num_tickets: num,
          ticket_promedio_cent: num > 0 ? Math.round(total / num) : 0,
          pct_yape: total > 0 ? Math.round((yape / total) * 100) : 0,
          delta_pct_vs_tipico: delta(total, baseChain),
          serie_7d: serieChain,
          reparto: boticas.map((b) => ({ sucursal_id: b.sucursal_id, nombre: b.nombre, pct: total > 0 ? Math.round((b.ventas_cent / total) * 100) : 0 })),
          // El KPI de la cadena se recompone sumando numeradores y denominadores, NO promediando los
          // porcentajes de cada botica: un promedio de porcentajes le daría el mismo peso a la botica
          // que hizo 3 ventas que a la que hizo 300.
          identificadas_hoy: identificadas(
            identFilas.reduce((a, f) => a + f.n_hoy, 0),
            identFilas.reduce((a, f) => a + f.ident_hoy, 0),
          ),
          identificadas_30d: identificadas(
            identFilas.reduce((a, f) => a + f.n30, 0),
            identFilas.reduce((a, f) => a + f.ident30, 0),
          ),
        };
      }

      const cnt = (i: number) => ((res[i]!.results[0] ?? { n: 0 }) as { n: number }).n;
      const peor = ((res[9]!.results[0] ?? { peor: null }) as { peor: number | null }).peor ?? 0;

      return {
        fecha: hoyYmd,
        revisado_2am: null,
        cadena,
        boticas,
        atencion: {
          casos_abiertos: cnt(5),
          recepciones_pendientes: cnt(6),
          lotes_por_vencer: cnt(7),
          lotes_por_vencer_30d: cnt(8),
          caja_ayer_peor_dif_cent: peor,
        },
        top_productos: res[10]!.results as { producto_id: string; nombre: string; unidades: number; total_cent: number }[],
        oido: [], // lo llena la ruta con repos/audio.ts (VETO D-N5: el SQL de audio_senal vive solo ahí)
      };
    },
  };
}
