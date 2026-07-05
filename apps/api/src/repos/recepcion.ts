import { uuidv7 } from "@huayruro/shared";
import { negocio } from "../lib/errores";
import { withRetry } from "./base";

export type ItemRecepcion = {
  productoId: string;
  numeroLote: string;
  fechaVencimiento: string; // YYYY-MM-DD
  cantidad: number; // unidades base, entero ≥1
};

export type RegistrarRecepcionInput = {
  clientUuid: string;
  sucursalId: string;
  tenantId: string;
  operadorId: string | null;
  proveedor: string | null;
  observaciones: string | null;
  items: ItemRecepcion[];
  nowIso: string;
};

// §8 POST /api/recepciones — idempotente por client_uuid. Igual que la venta, todo el efecto
// (upsert de lote + inventario + kardex + audit) va guardado por EXISTS(recepcion id=?recId):
// si la recepción ya existía (mismo client_uuid), ① no inserta y el resto no-opea → cero doble stock.
export function recepcionRepo(db: D1Database) {
  return {
    async registrar(input: RegistrarRecepcionInput): Promise<{ recepcionId: string; idempotent: boolean }> {
      const recId = uuidv7();

      // Dedupe de ítems por (producto, numero_lote, vencimiento) sumando cantidades (evita 2 filas de lote).
      const agg = new Map<string, ItemRecepcion>();
      for (const it of input.items) {
        const k = `${it.productoId}|${it.numeroLote}|${it.fechaVencimiento}`;
        const prev = agg.get(k);
        if (prev) prev.cantidad += it.cantidad;
        else agg.set(k, { ...it });
      }
      const items = [...agg.values()];
      const productos = [...new Set(items.map((i) => i.productoId))];

      // Validar que cada producto pertenece al catálogo del tenant (evita recepciones colgadas).
      for (const pid of productos) {
        const p = await withRetry(() =>
          db.prepare(`SELECT id FROM producto_catalogo WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`).bind(pid, input.tenantId).first<{ id: string }>(),
        );
        if (!p) throw negocio(`producto inexistente: ${pid}`);
      }

      // Pre-paso idempotente (siempre seguro): asegurar la fila de inventario de cada producto.
      await withRetry(() =>
        db.batch(
          productos.map((pid) =>
            db
              .prepare(
                `INSERT INTO inventario_local (id, sucursal_id, producto_id, stock_unidades, stock_minimo, updated_at)
                 VALUES (?1, ?2, ?3, 0, 0, ?4) ON CONFLICT (sucursal_id, producto_id) DO NOTHING`,
              )
              .bind(uuidv7(), input.sucursalId, pid, input.nowIso),
          ),
        ),
      );
      const invIds = new Map<string, string>();
      for (const pid of productos) {
        const inv = await withRetry(() =>
          db.prepare(`SELECT id FROM inventario_local WHERE sucursal_id = ?1 AND producto_id = ?2`).bind(input.sucursalId, pid).first<{ id: string }>(),
        );
        invIds.set(pid, inv!.id);
      }

      // Pre-lectura del lote existente por (inventario, numero, vencimiento) → sumar vs insertar.
      const loteExistente = new Map<string, string | null>();
      for (const it of items) {
        const invId = invIds.get(it.productoId)!;
        const l = await withRetry(() =>
          db
            .prepare(`SELECT id FROM lote WHERE inventario_id = ?1 AND numero_lote = ?2 AND fecha_vencimiento = ?3 LIMIT 1`)
            .bind(invId, it.numeroLote, it.fechaVencimiento)
            .first<{ id: string }>(),
        );
        loteExistente.set(`${it.productoId}|${it.numeroLote}|${it.fechaVencimiento}`, l?.id ?? null);
      }

      // Batch guardado por EXISTS(recepcion id=?recId) — mismo patrón de idempotencia que la venta.
      const stmts: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO recepcion (id, client_uuid, sucursal_id, proveedor, observaciones, operador_id, fecha_hora)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT (client_uuid) DO NOTHING`,
          )
          .bind(recId, input.clientUuid, input.sucursalId, input.proveedor, input.observaciones, input.operadorId, input.nowIso),
      ];
      for (const it of items) {
        const invId = invIds.get(it.productoId)!;
        const loteId = loteExistente.get(`${it.productoId}|${it.numeroLote}|${it.fechaVencimiento}`) ?? null;
        if (loteId) {
          // mismo número+vencimiento → suma (?3 = recId).
          stmts.push(
            db
              .prepare(
                `UPDATE lote SET unidades = unidades + ?2, updated_at = ?4 WHERE id = ?1
                 AND EXISTS (SELECT 1 FROM recepcion WHERE id = ?3)`,
              )
              .bind(loteId, it.cantidad, recId, input.nowIso),
          );
        } else {
          stmts.push(
            db
              .prepare(
                `INSERT INTO lote (id, inventario_id, numero_lote, fecha_vencimiento, unidades, proveedor, fecha_recepcion, created_at, updated_at)
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7 WHERE EXISTS (SELECT 1 FROM recepcion WHERE id = ?8)`,
              )
              .bind(uuidv7(), invId, it.numeroLote, it.fechaVencimiento, it.cantidad, input.proveedor, input.nowIso, recId),
          );
        }
        stmts.push(
          db
            .prepare(
              `UPDATE inventario_local SET stock_unidades = stock_unidades + ?2, updated_at = ?4 WHERE id = ?1
               AND EXISTS (SELECT 1 FROM recepcion WHERE id = ?3)`,
            )
            .bind(invId, it.cantidad, recId, input.nowIso),
        );
        stmts.push(
          db
            .prepare(
              `INSERT INTO movimiento_stock (id, client_uuid, sucursal_id, producto_id, lote_id, tipo, cantidad, referencia_id, operador_id, fecha_hora)
               SELECT ?1, ?2, ?3, ?4, ?5, 'recepcion', ?6, ?7, ?8, ?9 WHERE EXISTS (SELECT 1 FROM recepcion WHERE id = ?7)`,
            )
            .bind(uuidv7(), uuidv7(), input.sucursalId, it.productoId, loteId, it.cantidad, recId, input.operadorId, input.nowIso),
        );
      }
      stmts.push(
        db
          .prepare(
            `INSERT INTO audit_log (id, tenant_id, sucursal_id, usuario_id, accion, recurso, recurso_id, datos_despues, fecha_hora)
             SELECT ?1, ?2, ?3, ?4, 'recepcion_registrada', 'recepcion', ?5, ?6, ?7 WHERE EXISTS (SELECT 1 FROM recepcion WHERE id = ?5)`,
          )
          .bind(uuidv7(), input.tenantId, input.sucursalId, input.operadorId, recId, JSON.stringify({ items: items.length, proveedor: input.proveedor }), input.nowIso),
      );

      await withRetry(() => db.batch(stmts));

      const fila = await withRetry(() =>
        db.prepare(`SELECT id FROM recepcion WHERE client_uuid = ?1`).bind(input.clientUuid).first<{ id: string }>(),
      );
      return { recepcionId: fila!.id, idempotent: fila!.id !== recId };
    },
  };
}
