import { withRetry } from "./base";

// ============================================================
// B11.2 — Espejo operativo (plan expansión §3 B1). Panel "Personal": métricas por operador calculadas
// 100% de datos POS (venta + Δ2 tiempo de servicio + Δ3 cajón + cierre de caja), comparadas contra el
// promedio de la MISMA botica (nunca ranking cross-botica — aislamiento). INFORMA; jamás sanciona: los
// umbrales que abren caso viven en repos/casos.ts (tipo 'personal'), un humano decide.
//
// VETO D-N5: el audio NUNCA entra aquí (ni una tabla de audio). Lo verifica veto-audio.test.ts.
// ============================================================

export type OperadorEspejo = {
  operador_id: string;
  operador_nombre: string;
  ventas: number;
  total_cent: number;
  ticket_cent: number;
  ventas_por_hora: number;
  servicio_prom_seg: number | null; // Δ2: atencion_inicio → cobro; null si no se capturó
  anuladas: number;
  tasa_anulacion: number;
  cajon_sin_venta: number; // Δ3
  cierres: number;
  faltante_cent: number; // suma de diferencias negativas de caja atribuidas al operador
  primera_venta: string | null;
  ultima_venta: string | null;
  dias_activos: number;
};

export type ResumenEspejo = {
  dias: number;
  operadores: OperadorEspejo[];
  promedio: {
    ticket_cent: number;
    ventas_por_hora: number;
    servicio_prom_seg: number | null;
    tasa_anulacion: number;
    cajon_sin_venta: number;
  };
};

const prom = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function espejoRepo(db: D1Database) {
  return {
    async personal(sucursalId: string, dias: number, ahoraIso = new Date().toISOString()): Promise<ResumenEspejo> {
      const fin = ahoraIso;
      const inicio = new Date(Date.parse(ahoraIso) - dias * 86_400_000).toISOString();

      const res = await withRetry(() =>
        db.batch([
          // Ventas por operador: volumen, ticket, tiempo de servicio (Δ2), anulaciones, presencia. Días/horas
          // activas por día LOCAL Lima (date/strftime con -5 horas) para que "ventas por hora" sea real.
          db
            .prepare(
              `SELECT v.operador_id AS operador_id, u.nombre AS operador_nombre,
                      SUM(CASE WHEN v.estado='completada' THEN 1 ELSE 0 END) AS ventas,
                      SUM(CASE WHEN v.estado='completada' THEN v.total_cent ELSE 0 END) AS total_cent,
                      SUM(CASE WHEN v.estado='anulada' THEN 1 ELSE 0 END) AS anuladas,
                      COUNT(*) AS registros,
                      AVG(CASE WHEN v.estado='completada' AND v.atencion_inicio IS NOT NULL
                           THEN (julianday(v.fecha_hora)-julianday(v.atencion_inicio))*86400.0 END) AS servicio_prom_seg,
                      MIN(CASE WHEN v.estado='completada' THEN v.fecha_hora END) AS primera,
                      MAX(CASE WHEN v.estado='completada' THEN v.fecha_hora END) AS ultima,
                      COUNT(DISTINCT CASE WHEN v.estado='completada' THEN date(v.fecha_hora,'-5 hours') END) AS dias_activos,
                      COUNT(DISTINCT CASE WHEN v.estado='completada' THEN strftime('%Y-%m-%d %H', datetime(v.fecha_hora,'-5 hours')) END) AS horas_activas
               FROM venta v JOIN usuario_perfil u ON u.id = v.operador_id
               WHERE v.sucursal_id = ?1 AND v.fecha_hora >= ?2 AND v.fecha_hora < ?3
               GROUP BY v.operador_id`,
            )
            .bind(sucursalId, inicio, fin),
          db
            .prepare(
              `SELECT operador_id, COUNT(*) AS n FROM evento_caja
               WHERE sucursal_id = ?1 AND tipo IN ('no_sale','apertura_sin_venta')
                 AND operador_id IS NOT NULL AND fecha_hora >= ?2 AND fecha_hora < ?3
               GROUP BY operador_id`,
            )
            .bind(sucursalId, inicio, fin),
          db
            .prepare(
              `SELECT cerrado_por AS operador_id, COUNT(*) AS cierres,
                      SUM(CASE WHEN diferencia_cent < 0 THEN diferencia_cent ELSE 0 END) AS faltante_cent
               FROM cierre_caja
               WHERE sucursal_id = ?1 AND cerrado_por IS NOT NULL AND cerrado_at >= ?2 AND cerrado_at < ?3
               GROUP BY cerrado_por`,
            )
            .bind(sucursalId, inicio, fin),
        ]),
      );
      const ventas = res[0]!;
      const cajon = res[1]!;
      const caja = res[2]!;

      const cajonPorOp = new Map<string, number>();
      for (const r of cajon.results as { operador_id: string; n: number }[]) cajonPorOp.set(r.operador_id, r.n);
      const cajaPorOp = new Map<string, { cierres: number; faltante: number }>();
      for (const r of caja.results as { operador_id: string; cierres: number; faltante_cent: number }[]) {
        cajaPorOp.set(r.operador_id, { cierres: r.cierres, faltante: r.faltante_cent ?? 0 });
      }

      const operadores: OperadorEspejo[] = (ventas.results as Array<{
        operador_id: string; operador_nombre: string; ventas: number; total_cent: number; anuladas: number;
        registros: number; servicio_prom_seg: number | null; primera: string | null; ultima: string | null;
        dias_activos: number; horas_activas: number;
      }>).map((v) => {
        const caj = cajaPorOp.get(v.operador_id);
        const ticket = v.ventas > 0 ? Math.round(v.total_cent / v.ventas) : 0;
        const porHora = v.horas_activas > 0 ? v.ventas / v.horas_activas : 0;
        const tasa = v.registros > 0 ? v.anuladas / v.registros : 0;
        return {
          operador_id: v.operador_id,
          operador_nombre: v.operador_nombre,
          ventas: v.ventas,
          total_cent: v.total_cent,
          ticket_cent: ticket,
          ventas_por_hora: Number(porHora.toFixed(2)),
          servicio_prom_seg: v.servicio_prom_seg === null ? null : Math.round(v.servicio_prom_seg),
          anuladas: v.anuladas,
          tasa_anulacion: Number(tasa.toFixed(3)),
          cajon_sin_venta: cajonPorOp.get(v.operador_id) ?? 0,
          cierres: caj?.cierres ?? 0,
          faltante_cent: caj?.faltante ?? 0,
          primera_venta: v.primera,
          ultima_venta: v.ultima,
          dias_activos: v.dias_activos,
        };
      });

      // Promedios de la botica (solo operadores con ventas para el ticket/servicio/porHora).
      const conVentas = operadores.filter((o) => o.ventas > 0);
      const servicios = conVentas.map((o) => o.servicio_prom_seg).filter((s): s is number => s !== null);
      return {
        dias,
        operadores: operadores.sort((a, b) => b.ventas - a.ventas),
        promedio: {
          ticket_cent: Math.round(prom(conVentas.map((o) => o.ticket_cent))),
          ventas_por_hora: Number(prom(conVentas.map((o) => o.ventas_por_hora)).toFixed(2)),
          servicio_prom_seg: servicios.length ? Math.round(prom(servicios)) : null,
          tasa_anulacion: Number(prom(operadores.map((o) => o.tasa_anulacion)).toFixed(3)),
          cajon_sin_venta: Number(prom(operadores.map((o) => o.cajon_sin_venta)).toFixed(2)),
        },
      };
    },
  };
}
