import { calcularCabeceraDesdeLineas, calcularItem, uuidv7 } from "@huayruro/shared";
import type { ItemCalculo } from "@huayruro/shared";
import { conflicto, negocio, noEncontrado } from "../lib/errores";
import { esSuper } from "../lib/scope";
import type { Actor } from "../types";
import { withRetry } from "./base";

export type VentaResumen = {
  id: string;
  client_uuid: string;
  sucursal_id: string;
  estado: string;
  subtotal_sin_igv_cent: number;
  igv_total_cent: number;
  total_cent: number;
  metodo_pago: string;
  fecha_hora: string;
};

type MetodoPago = "efectivo" | "yape" | "plin" | "tarjeta" | "transferencia" | "otro";

export type ItemVentaInput = {
  productoId: string;
  presentacionId?: string | null; // Δ1: si falta, se resuelve la presentación base (factor 1)
  cantidad: number; // cantidad de la PRESENTACIÓN (entero ≥1); base = cantidad × factor
  precioSinIgvUnitarioDm: number; // snapshot del cliente (precio de la presentación)
};

export type RegistrarVentaInput = {
  clientUuid: string;
  sucursalId: string;
  operadorId: string | null;
  tenantId: string;
  metodoPago: MetodoPago;
  items: ItemVentaInput[];
  observaciones: string | null;
  fechaHoraCliente: string | null;
  atencionInicio: string | null;
  clienteId: string | null;
  nowIso: string;
  ip: string | null;
  userAgent: string | null;
};

export type RegistrarVentaResultado = {
  ventaId: string;
  idempotent: boolean;
  resumen: VentaResumen;
  advertencias: string[];
};

type Asignacion = { vilId: string; loteId: string; unidades: number };

type ItemProc = {
  itemId: string;
  productoId: string;
  presentacionId: string;
  factor: number;
  cantidadPresentacion: number;
  cantidadBase: number;
  precioDm: number;
  calc: ItemCalculo;
  asignaciones: Asignacion[];
};

// Detecta el aborto del batch por el CHECK (unidades >= 0) de `lote` — contención FEFO (§7.4).
const esCheckLote = (e: unknown): boolean => /CHECK constraint failed/i.test(String(e));

export function ventaRepo(db: D1Database) {
  return {
    // ============================================================
    // §7 — Venta atómica, idempotente y con FEFO (arreglos #1, #2, #3).
    // TODO el efecto vive en UN db.batch() con guardas EXISTS(venta id=?vId) — si la venta ya
    // existía (mismo client_uuid), ① no inserta (?vId nuevo ≠ existente) y el resto no-opea.
    // ============================================================
    async registrarVenta(input: RegistrarVentaInput): Promise<RegistrarVentaResultado> {
      const vId = uuidv7();
      const advertencias: string[] = [];

      // ---- Fase 1: resolver presentación (Δ1), factor, precio vigente y montos (§6.2). ----
      const items: ItemProc[] = [];
      for (const it of input.items) {
        const pres = it.presentacionId
          ? await withRetry(() =>
              db
                .prepare(
                  `SELECT pr.id, pr.factor_unidades FROM presentacion pr
                   JOIN producto_catalogo p ON p.id = pr.producto_id
                   WHERE pr.id = ?1 AND pr.producto_id = ?2 AND pr.activa = 1 AND p.tenant_id = ?3 AND p.deleted_at IS NULL`,
                )
                .bind(it.presentacionId, it.productoId, input.tenantId)
                .first<{ id: string; factor_unidades: number }>(),
            )
          : await withRetry(() =>
              db
                .prepare(
                  `SELECT pr.id, pr.factor_unidades FROM presentacion pr
                   JOIN producto_catalogo p ON p.id = pr.producto_id
                   WHERE pr.producto_id = ?1 AND pr.es_base = 1 AND pr.activa = 1 AND p.tenant_id = ?2 AND p.deleted_at IS NULL
                   LIMIT 1`,
                )
                .bind(it.productoId, input.tenantId)
                .first<{ id: string; factor_unidades: number }>(),
            );
        if (!pres) throw negocio(`producto o presentación inexistente: ${it.productoId}`);

        // Advertencia si el snapshot difiere del precio vigente (nunca bloquea — §7.1).
        const vigente = await withRetry(() =>
          db
            .prepare(
              `SELECT precio_sin_igv_dm FROM precio_local
               WHERE producto_id = ?1 AND sucursal_id = ?2 AND presentacion_id = ?3 AND vigente_hasta IS NULL`,
            )
            .bind(it.productoId, input.sucursalId, pres.id)
            .first<{ precio_sin_igv_dm: number }>(),
        );
        if (vigente && vigente.precio_sin_igv_dm !== it.precioSinIgvUnitarioDm) {
          advertencias.push(
            `precio distinto al vigente en ${it.productoId} (cobrado ${it.precioSinIgvUnitarioDm}, vigente ${vigente.precio_sin_igv_dm})`,
          );
        }

        items.push({
          itemId: uuidv7(),
          productoId: it.productoId,
          presentacionId: pres.id,
          factor: pres.factor_unidades,
          cantidadPresentacion: it.cantidad,
          cantidadBase: it.cantidad * pres.factor_unidades,
          precioDm: it.precioSinIgvUnitarioDm,
          calc: calcularItem(it.cantidad, it.precioSinIgvUnitarioDm),
          asignaciones: [],
        });
      }

      // Cabecera: S = Σ lineaDm (§6.2). El total NO es round(S×1.18) — subtotal + IGV redondeados.
      const cab = calcularCabeceraDesdeLineas(items.map((i) => i.calc.lineaDm));

      // Cantidad base agregada por producto (para inventario/movimiento; un producto puede repetirse).
      const baseAgg = new Map<string, number>();
      for (const it of items) baseAgg.set(it.productoId, (baseAgg.get(it.productoId) ?? 0) + it.cantidadBase);

      // ---- Fase 2: lazo con reintento por CHECK de lote (§7.4): releer FEFO → rearmar → batch. ----
      let degradado = false;
      for (let intento = 0; intento < 4; intento++) {
        const usarLotes = intento < 3;
        for (const it of items) it.asignaciones = [];

        if (usarLotes) {
          await this._asignarFefo(items, input.sucursalId);
        } else {
          degradado = true; // 4.º intento: se degrada a venta sin descuento por lote (§7.4).
        }

        try {
          await withRetry(() => db.batch(construirBatch(db, { vId, cab, items, baseAgg, input })));
          break; // batch OK (o no-op idempotente) → salir del lazo
        } catch (e) {
          if (esCheckLote(e) && intento < 3) continue; // contención FEFO → releer y reintentar
          throw e;
        }
      }
      if (degradado) advertencias.push("venta registrada sin descuento por lote (contención de stock)");

      // ---- Fase 3: leer el estado real (idempotencia por client_uuid). ----
      const resumen = await withRetry(() =>
        db
          .prepare(
            `SELECT id, client_uuid, sucursal_id, estado, subtotal_sin_igv_cent, igv_total_cent, total_cent, metodo_pago, fecha_hora
             FROM venta WHERE client_uuid = ?1`,
          )
          .bind(input.clientUuid)
          .first<VentaResumen>(),
      );
      if (!resumen) throw conflicto("no se pudo registrar la venta");
      return { ventaId: resumen.id, idempotent: resumen.id !== vId, resumen, advertencias };
    },

    // Asignación FEFO en cascada por producto (lectura fresca), repartida entre los ítems del producto.
    async _asignarFefo(items: ItemProc[], sucursalId: string): Promise<void> {
      const porProducto = new Map<string, ItemProc[]>();
      for (const it of items) {
        const arr = porProducto.get(it.productoId);
        if (arr) arr.push(it);
        else porProducto.set(it.productoId, [it]);
      }
      for (const [productoId, itemsProd] of porProducto) {
        const lotes = await withRetry(() =>
          db
            .prepare(
              `SELECT l.id, l.unidades FROM lote l JOIN inventario_local i ON i.id = l.inventario_id
               WHERE i.sucursal_id = ?1 AND i.producto_id = ?2 AND l.unidades > 0
               ORDER BY l.fecha_vencimiento ASC, l.id ASC`,
            )
            .bind(sucursalId, productoId)
            .all<{ id: string; unidades: number }>(),
        );
        const pool = lotes.results.map((l) => ({ loteId: l.id, disp: l.unidades }));
        for (const it of itemsProd) {
          let resta = it.cantidadBase;
          for (const p of pool) {
            if (resta <= 0) break;
            if (p.disp <= 0) continue;
            const toma = Math.min(resta, p.disp);
            it.asignaciones.push({ vilId: uuidv7(), loteId: p.loteId, unidades: toma });
            p.disp -= toma;
            resta -= toma;
          }
          // Remanente sin lote (mercadería no loteada) es NORMAL: solo descuento agregado (§7.2.3).
        }
      }
    },

    async obtener(id: string, actor: Actor): Promise<VentaResumen | null> {
      const base = `SELECT v.id, v.client_uuid, v.sucursal_id, v.estado, v.subtotal_sin_igv_cent, v.igv_total_cent,
                           v.total_cent, v.metodo_pago, v.fecha_hora
                    FROM venta v JOIN sucursal s ON s.id = v.sucursal_id WHERE v.id = ?1`;
      if (esSuper(actor)) {
        return withRetry(() => db.prepare(`${base} AND s.tenant_id = ?2`).bind(id, actor.tenantId).first<VentaResumen>());
      }
      return withRetry(() =>
        db.prepare(`${base} AND v.sucursal_id = ?2`).bind(id, actor.sucursalId).first<VentaResumen>(),
      );
    },

    // Detalle completo (ítems) para reimprimir la guía (§8 GET /api/ventas/:id).
    async obtenerDetalle(id: string, actor: Actor): Promise<{ venta: VentaResumen; items: Record<string, unknown>[] } | null> {
      const venta = await this.obtener(id, actor);
      if (!venta) return null;
      const items = await withRetry(() =>
        db
          .prepare(
            `SELECT vi.id, vi.producto_id, p.nombre, vi.presentacion_id, vi.cantidad_presentacion, vi.cantidad,
                    vi.precio_sin_igv_unitario_dm, vi.precio_total_unitario_dm, vi.total_cent
             FROM venta_item vi JOIN producto_catalogo p ON p.id = vi.producto_id
             WHERE vi.venta_id = ?1 ORDER BY vi.created_at`,
          )
          .bind(id)
          .all(),
      );
      return { venta, items: items.results as Record<string, unknown>[] };
    },

    // ============================================================
    // §7.6 — Anulación (admin+). Batch espejo con guarda por anulada_motivo prefijado por request:
    // anular dos veces no repone doble (la 2.ª no-opea, el motivo ya no coincide). El pre-check da
    // 404/409 al caso secuencial; la guarda cubre la carrera concurrente.
    // ============================================================
    async anular(id: string, actor: Actor, motivoPrefijado: string, nowIso: string): Promise<void> {
      const venta = await this.obtener(id, actor);
      if (!venta) throw noEncontrado("venta");
      if (venta.estado === "anulada") throw conflicto("la venta ya está anulada");
      const suc = venta.sucursal_id;
      const opId = actor.tipo === "usuario" ? actor.usuarioId : null;

      // Reposiciones a partir de lo vendido: unidades por lote y base units por producto.
      const vils = await withRetry(() =>
        db
          .prepare(
            `SELECT vil.lote_id, vil.unidades FROM venta_item_lote vil
             JOIN venta_item vi ON vi.id = vil.venta_item_id WHERE vi.venta_id = ?1`,
          )
          .bind(id)
          .all<{ lote_id: string; unidades: number }>(),
      );
      const porProducto = await withRetry(() =>
        db
          .prepare(`SELECT producto_id, SUM(cantidad) AS cant FROM venta_item WHERE venta_id = ?1 GROUP BY producto_id`)
          .bind(id)
          .all<{ producto_id: string; cant: number }>(),
      );

      const stmts: D1PreparedStatement[] = [
        // ① candado atómico: solo si estaba completada y sin motivo (idempotente ante doble anulación).
        db
          .prepare(
            `UPDATE venta SET estado = 'anulada', anulada_motivo = ?2, updated_at = ?3
             WHERE id = ?1 AND estado = 'completada' AND anulada_motivo IS NULL AND sucursal_id = ?4`,
          )
          .bind(id, motivoPrefijado, nowIso, suc),
      ];
      // ② reponer cada lote — guarda: la venta quedó anulada con ESTE motivo (?2 = id, ?3 = motivo).
      for (const v of vils.results) {
        stmts.push(
          db
            .prepare(
              `UPDATE lote SET unidades = unidades + ?4, updated_at = ?5 WHERE id = ?1
               AND EXISTS (SELECT 1 FROM venta WHERE id = ?2 AND estado = 'anulada' AND anulada_motivo = ?3)`,
            )
            .bind(v.lote_id, id, motivoPrefijado, v.unidades, nowIso),
        );
      }
      // ③ reponer inventario + ④ kardex 'anulacion', por producto (con la misma guarda).
      for (const p of porProducto.results) {
        stmts.push(
          db
            .prepare(
              `UPDATE inventario_local SET stock_unidades = stock_unidades + ?4, updated_at = ?5
               WHERE sucursal_id = ?1 AND producto_id = ?6
               AND EXISTS (SELECT 1 FROM venta WHERE id = ?2 AND estado = 'anulada' AND anulada_motivo = ?3)`,
            )
            .bind(suc, id, motivoPrefijado, p.cant, nowIso, p.producto_id),
        );
        stmts.push(
          db
            .prepare(
              `INSERT INTO movimiento_stock (id, client_uuid, sucursal_id, producto_id, tipo, cantidad, motivo, referencia_id, operador_id, fecha_hora)
               SELECT ?4, ?5, ?1, ?6, 'anulacion', ?7, 'anulación de venta', ?2, ?8, ?9
               WHERE EXISTS (SELECT 1 FROM venta WHERE id = ?2 AND estado = 'anulada' AND anulada_motivo = ?3)`,
            )
            .bind(suc, id, motivoPrefijado, uuidv7(), uuidv7(), p.producto_id, p.cant, opId, nowIso),
        );
      }
      // ⑤ auditoría (con la misma guarda; sin FK: nunca aborta).
      stmts.push(
        db
          .prepare(
            `INSERT INTO audit_log (id, tenant_id, sucursal_id, usuario_id, accion, recurso, recurso_id, datos_despues, fecha_hora)
             SELECT ?4, ?5, ?1, ?6, 'venta_anulada', 'venta', ?2, ?7, ?8
             WHERE EXISTS (SELECT 1 FROM venta WHERE id = ?2 AND estado = 'anulada' AND anulada_motivo = ?3)`,
          )
          .bind(suc, id, motivoPrefijado, uuidv7(), actor.tenantId, opId, JSON.stringify({ motivo: motivoPrefijado }), nowIso),
      );

      await withRetry(() => db.batch(stmts));
    },
  };
}

// Construye los statements del batch de venta (§7.3) — ① lleva ON CONFLICT DO NOTHING; el resto
// una guarda EXISTS(venta id=?vId). Se rearma en cada intento del lazo FEFO.
function construirBatch(
  db: D1Database,
  ctx: {
    vId: string;
    cab: { subtotalSinIgvCent: number; igvTotalCent: number; totalCent: number };
    items: ItemProc[];
    baseAgg: Map<string, number>;
    input: RegistrarVentaInput;
  },
): D1PreparedStatement[] {
  const { vId, cab, items, baseAgg, input } = ctx;
  const now = input.nowIso;
  const stmts: D1PreparedStatement[] = [];

  // ① cabecera (idempotencia por client_uuid).
  stmts.push(
    db
      .prepare(
        `INSERT INTO venta (id, client_uuid, sucursal_id, operador_id, fecha_hora, fecha_hora_cliente, atencion_inicio,
                            subtotal_sin_igv_cent, igv_total_cent, total_cent, metodo_pago, observaciones, cliente_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?5, ?5)
         ON CONFLICT (client_uuid) DO NOTHING`,
      )
      .bind(vId, input.clientUuid, input.sucursalId, input.operadorId, now, input.fechaHoraCliente, input.atencionInicio,
        cab.subtotalSinIgvCent, cab.igvTotalCent, cab.totalCent, input.metodoPago, input.observaciones, input.clienteId),
  );

  // ② venta_item (Δ1: presentacion_id + cantidad_presentacion NOT NULL) — solo si ① insertó (?2 = vId).
  for (const it of items) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO venta_item (id, venta_id, producto_id, presentacion_id, cantidad_presentacion, cantidad,
                                   precio_sin_igv_unitario_dm, igv_unitario_dm, precio_total_unitario_dm,
                                   subtotal_sin_igv_cent, igv_subtotal_cent, total_cent, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
           WHERE EXISTS (SELECT 1 FROM venta WHERE id = ?2)`,
        )
        .bind(it.itemId, vId, it.productoId, it.presentacionId, it.cantidadPresentacion, it.cantidadBase,
          it.precioDm, it.calc.igvUnitarioDm, it.calc.precioTotalUnitarioDm,
          it.calc.subtotalSinIgvCent, it.calc.igvSubtotalCent, it.calc.totalCent, now),
    );
    // ③ FEFO: venta_item_lote + descuento del lote (CHECK aborta el batch si otra venta lo vació).
    for (const a of it.asignaciones) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO venta_item_lote (id, venta_item_id, lote_id, unidades)
             SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM venta WHERE id = ?5)`,
          )
          .bind(a.vilId, it.itemId, a.loteId, a.unidades, vId),
      );
      stmts.push(
        db
          .prepare(
            `UPDATE lote SET unidades = unidades - ?2, updated_at = ?3
             WHERE id = ?1 AND EXISTS (SELECT 1 FROM venta WHERE id = ?4)`,
          )
          .bind(a.loteId, a.unidades, now, vId),
      );
    }
  }

  // ④ inventario + ⑤ kardex, por producto (descuento agregado; puede quedar negativo a propósito).
  for (const [productoId, cantBase] of baseAgg) {
    stmts.push(
      db
        .prepare(
          `UPDATE inventario_local SET stock_unidades = stock_unidades - ?3, updated_at = ?4
           WHERE sucursal_id = ?1 AND producto_id = ?2 AND EXISTS (SELECT 1 FROM venta WHERE id = ?5)`,
        )
        .bind(input.sucursalId, productoId, cantBase, now, vId),
    );
    stmts.push(
      db
        .prepare(
          `INSERT INTO movimiento_stock (id, client_uuid, sucursal_id, producto_id, tipo, cantidad, referencia_id, operador_id, fecha_hora)
           SELECT ?1, ?2, ?3, ?4, 'venta', ?5, ?6, ?7, ?8 WHERE EXISTS (SELECT 1 FROM venta WHERE id = ?6)`,
        )
        .bind(uuidv7(), uuidv7(), input.sucursalId, productoId, -cantBase, vId, input.operadorId, now),
    );
  }

  // Δ3: apertura de cajón por venta (solo efectivo — es cuando el cajón físicamente abre).
  if (input.metodoPago === "efectivo") {
    stmts.push(
      db
        .prepare(
          `INSERT INTO evento_caja (id, client_uuid, sucursal_id, operador_id, tipo, venta_id, fecha_hora)
           SELECT ?1, ?2, ?3, ?4, 'apertura_venta', ?5, ?6 WHERE EXISTS (SELECT 1 FROM venta WHERE id = ?5)`,
        )
        .bind(uuidv7(), uuidv7(), input.sucursalId, input.operadorId, vId, now),
    );
  }

  // ⑥ auditoría (sin FK: nunca aborta nada).
  stmts.push(
    db
      .prepare(
        `INSERT INTO audit_log (id, tenant_id, sucursal_id, usuario_id, accion, recurso, recurso_id, datos_despues, ip_origen, user_agent, fecha_hora)
         SELECT ?1, ?2, ?3, ?4, 'venta_registrada', 'venta', ?5, ?6, ?7, ?8, ?9 WHERE EXISTS (SELECT 1 FROM venta WHERE id = ?5)`,
      )
      .bind(uuidv7(), input.tenantId, input.sucursalId, input.operadorId, vId,
        JSON.stringify({ total_cent: cab.totalCent, items: items.length, metodo_pago: input.metodoPago }),
        input.ip, input.userAgent, now),
  );

  return stmts;
}
