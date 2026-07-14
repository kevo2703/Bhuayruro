import { uuidv7 } from "@huayruro/shared";
import { conflicto } from "../lib/errores";
import { rangoDiaLima } from "../lib/fecha";
import { withRetry } from "./base";

const esUnique = (e: unknown): boolean => /UNIQUE constraint failed/i.test(String(e));

export type ResumenDia = {
  fecha: string;
  por_metodo: Record<string, number>;
  total_sistema_cent: number;
  num_ventas: number;
};

// Caja por sucursal (§8). Los totales del día salen de ventas 'completada' filtradas por día LOCAL
// (America/Lima), calculados por el server — nunca los envía el cliente.
export function cajaRepo(db: D1Database) {
  return {
    async resumenDia(sucursalId: string, fecha: string): Promise<ResumenDia> {
      const { inicio, fin } = rangoDiaLima(fecha);
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT metodo_pago, SUM(total_cent) AS total, COUNT(*) AS n FROM venta
             WHERE sucursal_id = ?1 AND estado = 'completada' AND fecha_hora >= ?2 AND fecha_hora < ?3
             GROUP BY metodo_pago`,
          )
          .bind(sucursalId, inicio, fin)
          .all<{ metodo_pago: string; total: number; n: number }>(),
      );
      const por_metodo: Record<string, number> = {};
      let total = 0;
      let num = 0;
      for (const f of r.results) {
        por_metodo[f.metodo_pago] = f.total;
        total += f.total;
        num += f.n;
      }
      return { fecha, por_metodo, total_sistema_cent: total, num_ventas: num };
    },

    // Cierre del día: el server calcula total_sistema y diferencia; UNIQUE(sucursal,fecha) → 409.
    async cerrar(input: {
      sucursalId: string;
      fecha: string;
      totalEfectivoCent: number;
      totalYapeCent: number;
      totalOtrosCent: number;
      observaciones: string | null;
      cerradoPor: string | null;
      nowIso: string;
    }): Promise<{ id: string; total_sistema_cent: number; diferencia_cent: number }> {
      const resumen = await this.resumenDia(input.sucursalId, input.fecha);
      const totalSistema = resumen.total_sistema_cent;
      const contado = input.totalEfectivoCent + input.totalYapeCent + input.totalOtrosCent;
      const diferencia = contado - totalSistema;
      const id = uuidv7();
      try {
        await withRetry(() =>
          db
            .prepare(
              `INSERT INTO cierre_caja (id, sucursal_id, fecha, total_efectivo_cent, total_yape_cent, total_otros_cent,
                                        total_sistema_cent, diferencia_cent, observaciones, cerrado_por, cerrado_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
            )
            .bind(id, input.sucursalId, input.fecha, input.totalEfectivoCent, input.totalYapeCent, input.totalOtrosCent,
              totalSistema, diferencia, input.observaciones, input.cerradoPor, input.nowIso)
            .run(),
        );
      } catch (e) {
        if (esUnique(e)) throw conflicto("el cierre de caja de ese día ya existe");
        throw e;
      }
      return { id, total_sistema_cent: totalSistema, diferencia_cent: diferencia };
    },

    async historial(sucursalId: string, mes?: string): Promise<Record<string, unknown>[]> {
      // Aditivo: se agrega s.nombre AS sucursal_nombre (no rompe el contrato: solo suma un campo).
      const cols = `c.id, c.fecha, c.total_efectivo_cent, c.total_yape_cent, c.total_otros_cent, c.total_sistema_cent, c.diferencia_cent, c.cerrado_at, s.nombre AS sucursal_nombre`;
      const stmt = mes
        ? db.prepare(`SELECT ${cols} FROM cierre_caja c JOIN sucursal s ON s.id = c.sucursal_id WHERE c.sucursal_id = ?1 AND c.fecha LIKE ?2 ORDER BY c.fecha DESC`).bind(sucursalId, `${mes}%`)
        : db.prepare(`SELECT ${cols} FROM cierre_caja c JOIN sucursal s ON s.id = c.sucursal_id WHERE c.sucursal_id = ?1 ORDER BY c.fecha DESC LIMIT 60`).bind(sucursalId);
      const r = await withRetry(() => stmt.all());
      return r.results as Record<string, unknown>[];
    },

    // Consolidado de cierres de TODAS las boticas del tenant (SOLO super; la ruta lo exige). Últimas ~3
    // semanas. Aislamiento por tenant_id (patrón dashboardRepo.consolidado). Orden: fecha↓, sucursal.
    async consolidadoCierres(tenantId: string, desdeYmd: string): Promise<{
      cierres: { fecha: string; sucursal_id: string; sucursal_nombre: string; esperado_cent: number; contado_cent: number; yape_cent: number; dif_cent: number }[];
    }> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT c.fecha, c.sucursal_id, s.nombre AS sucursal_nombre,
                    c.total_sistema_cent AS esperado_cent,
                    (c.total_efectivo_cent + c.total_yape_cent + c.total_otros_cent) AS contado_cent,
                    c.total_yape_cent AS yape_cent,
                    c.diferencia_cent AS dif_cent
             FROM cierre_caja c JOIN sucursal s ON s.id = c.sucursal_id AND s.deleted_at IS NULL
             WHERE s.tenant_id = ?1 AND c.fecha >= ?2
             ORDER BY c.fecha DESC, s.nombre`,
          )
          .bind(tenantId, desdeYmd)
          .all<{ fecha: string; sucursal_id: string; sucursal_nombre: string; esperado_cent: number; contado_cent: number; yape_cent: number; dif_cent: number }>(),
      );
      return { cierres: r.results ?? [] };
    },
  };
}
