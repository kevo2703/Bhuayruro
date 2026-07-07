// Motor del pedido — B8.3 (orquestación). La matemática pura (precio efectivo, consolidación
// exacta ≤2 proveedores) vive en @huayruro/shared (proveedores/pedido); aquí juntamos faltantes +
// ofertas matcheadas, guardamos el pedido elegido y exportamos el CSV por proveedor.
// Todo tenant-scoped. Base = faltantes de la sucursal (reusa faltantesRepo).
import {
  compararPedido,
  evaluarCombo,
  uuidv7,
  type Necesidad,
  type OfertaComparable,
  type ProveedorComparable,
  type ResultadoComparacion,
} from "@huayruro/shared";
import { noEncontrado, validacion } from "../lib/errores";
import type { Actor } from "../types";
import { withRetry } from "./base";
import { faltantesRepo } from "./admin";

const ESTADOS_PEDIDO = new Set(["propuesto", "enviado", "recibido", "cancelado"]);

export function pedidoRepo(db: D1Database, actor: Actor) {
  const tid = actor.tenantId;

  // Ofertas matcheadas (auto/confirmado) y con factor conocido para un set de productos.
  async function ofertasVigentes(productoIds: string[]): Promise<OfertaComparable[]> {
    if (productoIds.length === 0) return [];
    const ofertas: OfertaComparable[] = [];
    for (let i = 0; i < productoIds.length; i += 100) {
      const trozo = productoIds.slice(i, i + 100);
      const ph = trozo.map((_, j) => `?${j + 2}`).join(",");
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT li.id AS lista_item_id, li.producto_id, lp.proveedor_id, li.precio_cent, li.factor_unidades,
                    li.bonif_compra, li.bonif_gratis, li.venc_corto, li.vencimiento
             FROM lista_item li
             JOIN lista_precios lp ON lp.id = li.lista_id
             JOIN proveedor pr ON pr.id = lp.proveedor_id
             WHERE lp.tenant_id = ?1 AND lp.estado <> 'archivada' AND pr.activo = 1
               AND li.match_estado IN ('auto','confirmado') AND li.factor_unidades IS NOT NULL
               AND li.producto_id IN (${ph})`,
          )
          .bind(tid, ...trozo)
          .all<OfertaComparable>(),
      );
      ofertas.push(...r.results);
    }
    return ofertas;
  }

  async function proveedoresComparables(): Promise<ProveedorComparable[]> {
    const r = await withRetry(() =>
      db.prepare(`SELECT id, nombre, monto_minimo_cent, flete_cent FROM proveedor WHERE tenant_id = ?1 AND activo = 1`).bind(tid).all<ProveedorComparable>(),
    );
    return r.results;
  }

  return {
    // Necesidades base = faltantes de la sucursal (sugerido = max(0, mínimo×2 − stock)).
    async necesidadesBase(sucursalId: string): Promise<Necesidad[]> {
      const filas = (await faltantesRepo(db, actor).miBotica(sucursalId)) as { producto_id: string; nombre: string; sugerido: number }[];
      return filas.filter((f) => f.sugerido > 0).map((f) => ({ producto_id: f.producto_id, nombre: f.nombre, unidades_base: f.sugerido }));
    },

    // Compara combos (sin persistir): top-3 con delta + productos sin oferta + los que solo tienen
    // oferta de venc. corto (para que la UI ofrezca aceptarlos).
    async comparar(necesidades: Necesidad[], aceptarVencCorto: string[]): Promise<ResultadoComparacion & { proveedores_evaluados: number; venc_corto_disponibles: { producto_id: string; nombre: string }[] }> {
      const ofertas = await ofertasVigentes(necesidades.map((n) => n.producto_id));
      const proveedores = await proveedoresComparables();
      const res = compararPedido(necesidades, ofertas, proveedores, { aceptarVencCorto: new Set(aceptarVencCorto) });
      const usados = new Set(ofertas.map((o) => o.proveedor_id));
      const nombre = new Map(necesidades.map((n) => [n.producto_id, n.nombre]));
      const vencCortoIds = [...new Set(ofertas.filter((o) => o.venc_corto === 1).map((o) => o.producto_id))];
      return {
        ...res,
        proveedores_evaluados: proveedores.filter((p) => usados.has(p.id)).length,
        venc_corto_disponibles: vencCortoIds.map((id) => ({ producto_id: id, nombre: nombre.get(id) ?? id })),
      };
    },

    // Persiste el pedido para un combo elegido (1–2 proveedores). Recalcula la asignación EXACTA
    // para ese set (determinista) y guarda cabecera + renglones. combo_json = comparación completa.
    async crear(input: {
      necesidades: Necesidad[];
      aceptarVencCorto: string[];
      proveedorIds: string[];
      sucursalId: string;
      usuarioId: string;
      nowIso: string;
    }): Promise<{ id: string; total_cent: number; renglones: number }> {
      if (input.proveedorIds.length < 1 || input.proveedorIds.length > 2) throw validacion("elige 1 o 2 proveedores para el pedido");
      const proveedores = await proveedoresComparables();
      const combo = proveedores.filter((p) => input.proveedorIds.includes(p.id));
      if (combo.length !== input.proveedorIds.length) throw noEncontrado("proveedor");

      const ofertas = await ofertasVigentes(input.necesidades.map((n) => n.producto_id));
      const evalCombo = evaluarCombo(combo, input.necesidades, ofertas, { aceptarVencCorto: new Set(input.aceptarVencCorto) });
      if (evalCombo.proveedores.length === 0) throw validacion("ese combo no cubre ningún producto con oferta");

      // Para el registro guardamos la comparación completa (top-3) además del combo elegido.
      const comparacion = compararPedido(input.necesidades, ofertas, proveedores, { aceptarVencCorto: new Set(input.aceptarVencCorto) });
      const pedidoId = uuidv7();
      const comboJson = JSON.stringify({ elegido: evalCombo, alternativas: comparacion.top3, sin_oferta: comparacion.sin_oferta });

      const stmts: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO pedido (id, tenant_id, sucursal_id, estado, combo_json, creado_por, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'propuesto', ?4, ?5, ?6, ?6)`,
          )
          .bind(pedidoId, tid, input.sucursalId, comboJson, input.usuarioId, input.nowIso),
      ];
      let renglones = 0;
      for (const prov of evalCombo.proveedores) {
        for (const r of prov.renglones) {
          renglones++;
          const nota = r.venc_corto ? "venc. corto aceptado" : r.bonif_compra ? `bonif ${r.bonif_compra}+${r.bonif_gratis} aplicada` : null;
          stmts.push(
            db
              .prepare(
                `INSERT INTO pedido_item (id, pedido_id, proveedor_id, lista_item_id, producto_id, unidades_base, unidades_prov, precio_cent, nota)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
              )
              .bind(uuidv7(), pedidoId, prov.id, r.lista_item_id, r.producto_id, r.unidades_base, r.unidades_prov, r.renglon_cent, nota),
          );
        }
      }
      await withRetry(() => db.batch(stmts));
      return { id: pedidoId, total_cent: evalCombo.total_cent, renglones };
    },

    async listar(): Promise<Record<string, unknown>[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT p.id, p.sucursal_id, p.estado, p.created_at,
                    (SELECT COUNT(*) FROM pedido_item pi WHERE pi.pedido_id = p.id) AS renglones,
                    (SELECT COALESCE(SUM(pi.precio_cent),0) FROM pedido_item pi WHERE pi.pedido_id = p.id) AS subtotal_cent
             FROM pedido p WHERE p.tenant_id = ?1 ORDER BY p.created_at DESC LIMIT 100`,
          )
          .bind(tid)
          .all(),
      );
      return r.results as Record<string, unknown>[];
    },

    // Detalle: cabecera + renglones agrupados por proveedor (con nombre, presentación y precio unitario).
    async detalle(pedidoId: string): Promise<{ pedido: Record<string, unknown>; por_proveedor: Record<string, unknown>[] }> {
      const pedido = await withRetry(() =>
        db.prepare(`SELECT id, sucursal_id, estado, combo_json, created_at, updated_at FROM pedido WHERE id = ?1 AND tenant_id = ?2`).bind(pedidoId, tid).first(),
      );
      if (!pedido) throw noEncontrado("pedido");
      const items = await withRetry(() =>
        db
          .prepare(
            `SELECT pi.proveedor_id, pr.nombre AS proveedor_nombre, pr.monto_minimo_cent, pr.flete_cent,
                    pi.producto_id, pc.nombre AS producto_nombre, pi.unidades_base, pi.unidades_prov,
                    pi.precio_cent, pi.nota, li.presentacion_texto, li.precio_cent AS precio_unit_cent
             FROM pedido_item pi
             JOIN pedido p ON p.id = pi.pedido_id
             JOIN proveedor pr ON pr.id = pi.proveedor_id
             JOIN producto_catalogo pc ON pc.id = pi.producto_id
             LEFT JOIN lista_item li ON li.id = pi.lista_item_id
             WHERE pi.pedido_id = ?1 AND p.tenant_id = ?2
             ORDER BY pr.nombre, pc.nombre`,
          )
          .bind(pedidoId, tid)
          .all<{
            proveedor_id: string; proveedor_nombre: string; monto_minimo_cent: number; flete_cent: number;
            producto_id: string; producto_nombre: string; unidades_base: number; unidades_prov: number;
            precio_cent: number; nota: string | null; presentacion_texto: string | null; precio_unit_cent: number | null;
          }>(),
      );
      const grupos = new Map<string, Record<string, unknown>>();
      for (const it of items.results) {
        let g = grupos.get(it.proveedor_id);
        if (!g) {
          g = { proveedor_id: it.proveedor_id, proveedor_nombre: it.proveedor_nombre, monto_minimo_cent: it.monto_minimo_cent, flete_cent: it.flete_cent, subtotal_cent: 0, renglones: [] as unknown[] };
          grupos.set(it.proveedor_id, g);
        }
        g.subtotal_cent = (g.subtotal_cent as number) + it.precio_cent;
        (g.renglones as unknown[]).push({
          producto_id: it.producto_id, producto_nombre: it.producto_nombre, unidades_base: it.unidades_base,
          unidades_prov: it.unidades_prov, precio_unit_cent: it.precio_unit_cent, precio_cent: it.precio_cent,
          presentacion_texto: it.presentacion_texto, nota: it.nota,
        });
      }
      return { pedido: pedido as Record<string, unknown>, por_proveedor: [...grupos.values()] };
    },

    async marcarEstado(pedidoId: string, estado: string, nowIso: string): Promise<void> {
      if (!ESTADOS_PEDIDO.has(estado)) throw validacion("estado inválido");
      const r = await withRetry(() =>
        db.prepare(`UPDATE pedido SET estado = ?2, updated_at = ?3 WHERE id = ?1 AND tenant_id = ?4`).bind(pedidoId, estado, nowIso, tid).run(),
      );
      if (!r.meta.changes) throw noEncontrado("pedido");
    },

    // CSV de UN proveedor de un pedido (la orden que se le manda). Neutraliza inyección de fórmulas
    // (celda que empieza con = + - @ se ejecuta al abrir el .csv) igual que el consolidado de faltantes.
    async csvProveedor(pedidoId: string, proveedorId: string): Promise<string> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT pc.nombre AS producto, li.presentacion_texto AS presentacion, pi.unidades_prov,
                    li.precio_cent AS precio_unit_cent, pi.precio_cent AS subtotal_cent, pi.nota
             FROM pedido_item pi
             JOIN pedido p ON p.id = pi.pedido_id
             JOIN producto_catalogo pc ON pc.id = pi.producto_id
             LEFT JOIN lista_item li ON li.id = pi.lista_item_id
             WHERE pi.pedido_id = ?1 AND pi.proveedor_id = ?2 AND p.tenant_id = ?3
             ORDER BY pc.nombre`,
          )
          .bind(pedidoId, proveedorId, tid)
          .all<{ producto: string; presentacion: string | null; unidades_prov: number; precio_unit_cent: number | null; subtotal_cent: number; nota: string | null }>(),
      );
      if (r.results.length === 0) throw noEncontrado("renglones del proveedor en el pedido");
      const cel = (s: unknown) => {
        let v = String(s ?? "");
        if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
        return `"${v.replace(/"/g, '""')}"`;
      };
      const soles = (cent: number | null) => (cent === null ? "" : (cent / 100).toFixed(2));
      const lineas = ["producto,presentacion,cantidad,precio_unitario,subtotal,nota"];
      let total = 0;
      for (const f of r.results) {
        total += f.subtotal_cent;
        lineas.push([cel(f.producto), cel(f.presentacion ?? ""), f.unidades_prov, soles(f.precio_unit_cent), soles(f.subtotal_cent), cel(f.nota ?? "")].join(","));
      }
      lineas.push([cel("TOTAL"), "", "", "", soles(total), ""].join(","));
      return lineas.join("\r\n");
    },
  };
}
