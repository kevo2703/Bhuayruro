import { uuidv7 } from "@huayruro/shared";
import { withRetry } from "./base";

// Eventos de caja (Δ3). Registra la apertura DECLARADA del cajón sin una venta ('no_sale') — el operador
// abre para dar vuelto / revisar. Idempotente por client_uuid (funciona offline vía la misma cola del POS).
// Alimenta el indicador EBR `cajon_sin_venta` (repos/casos.ts). El evento fraude-proof `apertura_sin_venta`
// (sensor físico del cajón, T-K1) entra por el mismo indicador cuando exista el hardware.
export function eventoCajaRepo(db: D1Database) {
  return {
    async registrarNoSale(input: {
      clientUuid: string;
      sucursalId: string;
      operadorId: string | null;
      motivo: string | null;
      nowIso: string;
    }): Promise<{ id: string; idempotent: boolean }> {
      const id = uuidv7();
      await withRetry(() =>
        db
          .prepare(
            `INSERT INTO evento_caja (id, client_uuid, sucursal_id, operador_id, tipo, motivo, fecha_hora)
             VALUES (?1, ?2, ?3, ?4, 'no_sale', ?5, ?6) ON CONFLICT (client_uuid) DO NOTHING`,
          )
          .bind(id, input.clientUuid, input.sucursalId, input.operadorId, input.motivo, input.nowIso)
          .run(),
      );
      const fila = await withRetry(() =>
        db.prepare(`SELECT id FROM evento_caja WHERE client_uuid = ?1`).bind(input.clientUuid).first<{ id: string }>(),
      );
      return { id: fila?.id ?? id, idempotent: (fila?.id ?? id) !== id };
    },
  };
}
