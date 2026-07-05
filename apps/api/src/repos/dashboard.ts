import { fechaLocal, rangoDiaLima } from "../lib/fecha";
import { withRetry } from "./base";

// Dashboards (§8). Todo agregado por sucursal (nunca mezcla detalle entre boticas). El margen es
// ESTIMADO v1: usa el precio_compra vigente (no el del momento de la venta) y 0 si falta —
// documentado y ajustable. Fechas por día LOCAL Lima (UTC-5, sin DST): date(fecha_hora,'-5 hours').

export type Rango = "hoy" | "7d" | "30d";

function ventana(rango: Rango): { inicio: string; fin: string } {
  const hoy = fechaLocal();
  const fin = new Date().toISOString();
  const dias = rango === "hoy" ? 1 : rango === "7d" ? 7 : 30;
  const inicioHoy = rangoDiaLima(hoy).inicio;
  const inicio = new Date(new Date(inicioHoy).getTime() - (dias - 1) * 86_400_000).toISOString();
  return { inicio, fin };
}

export function dashboardRepo(db: D1Database) {
  return {
    async resumen(sucursalId: string, rango: Rango): Promise<Record<string, unknown>> {
      const { inicio, fin } = ventana(rango);
      const res = await withRetry(() =>
        db.batch([
          db
            .prepare(
              `SELECT COUNT(*) AS n, COALESCE(SUM(total_cent),0) AS total FROM venta
               WHERE sucursal_id = ?1 AND estado = 'completada' AND fecha_hora >= ?2 AND fecha_hora < ?3`,
            )
            .bind(sucursalId, inicio, fin),
          db
            .prepare(
              `SELECT date(fecha_hora,'-5 hours') AS dia, COUNT(*) AS n, SUM(total_cent) AS total FROM venta
               WHERE sucursal_id = ?1 AND estado = 'completada' AND fecha_hora >= ?2 AND fecha_hora < ?3
               GROUP BY dia ORDER BY dia`,
            )
            .bind(sucursalId, inicio, fin),
          db
            .prepare(
              `SELECT vi.producto_id, p.nombre, SUM(vi.cantidad) AS unidades, SUM(vi.total_cent) AS total_cent
               FROM venta_item vi JOIN venta v ON v.id = vi.venta_id JOIN producto_catalogo p ON p.id = vi.producto_id
               WHERE v.sucursal_id = ?1 AND v.estado = 'completada' AND v.fecha_hora >= ?2 AND v.fecha_hora < ?3
               GROUP BY vi.producto_id ORDER BY total_cent DESC LIMIT 8`,
            )
            .bind(sucursalId, inicio, fin),
          db.prepare(`SELECT COUNT(*) AS n FROM quiebre WHERE sucursal_id = ?1 AND fecha_hora >= ?2`).bind(sucursalId, inicio),
          db.prepare(`SELECT COUNT(*) AS n FROM inventario_local WHERE sucursal_id = ?1 AND stock_unidades <= stock_minimo`).bind(sucursalId),
          db
            .prepare(
              `SELECT COALESCE(SUM(vi.subtotal_sin_igv_cent),0) AS ingreso,
                      COALESCE(SUM(CASE WHEN pl.precio_compra_dm IS NOT NULL
                        THEN CAST(ROUND(vi.cantidad_presentacion * pl.precio_compra_dm / 100.0) AS INTEGER) ELSE 0 END),0) AS costo,
                      SUM(CASE WHEN pl.precio_compra_dm IS NULL THEN 1 ELSE 0 END) AS sin_costo
               FROM venta_item vi JOIN venta v ON v.id = vi.venta_id
               LEFT JOIN precio_local pl ON pl.producto_id = vi.producto_id AND pl.presentacion_id = vi.presentacion_id
                 AND pl.sucursal_id = ?1 AND pl.vigente_hasta IS NULL
               WHERE v.sucursal_id = ?1 AND v.estado = 'completada' AND v.fecha_hora >= ?2 AND v.fecha_hora < ?3`,
            )
            .bind(sucursalId, inicio, fin),
        ]),
      );
      const cab = (res[0]!.results[0] ?? { n: 0, total: 0 }) as { n: number; total: number };
      const margen = (res[5]!.results[0] ?? { ingreso: 0, costo: 0, sin_costo: 0 }) as { ingreso: number; costo: number; sin_costo: number };
      return {
        rango,
        ventas_cent: cab.total,
        num_ventas: cab.n,
        ticket_promedio_cent: cab.n > 0 ? Math.round(cab.total / cab.n) : 0,
        por_dia: res[1]!.results,
        top_productos: res[2]!.results,
        quiebres: ((res[3]!.results[0] ?? { n: 0 }) as { n: number }).n,
        stock_bajo: ((res[4]!.results[0] ?? { n: 0 }) as { n: number }).n,
        margen_estimado_cent: margen.ingreso - margen.costo,
        margen_parcial: margen.sin_costo > 0, // faltan precios de compra en algunas líneas
      };
    },

    // Consolidado por botica (SOLO super): agregados lado a lado, nunca detalle mezclado (§4.3).
    async consolidado(tenantId: string, rango: Rango): Promise<Record<string, unknown>> {
      const { inicio, fin } = ventana(rango);
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT s.id AS sucursal_id, s.nombre AS sucursal, COUNT(v.id) AS num_ventas, COALESCE(SUM(v.total_cent),0) AS ventas_cent
             FROM sucursal s
             LEFT JOIN venta v ON v.sucursal_id = s.id AND v.estado = 'completada' AND v.fecha_hora >= ?2 AND v.fecha_hora < ?3
             WHERE s.tenant_id = ?1 AND s.deleted_at IS NULL
             GROUP BY s.id ORDER BY ventas_cent DESC`,
          )
          .bind(tenantId, inicio, fin)
          .all(),
      );
      return { rango, boticas: r.results };
    },
  };
}
