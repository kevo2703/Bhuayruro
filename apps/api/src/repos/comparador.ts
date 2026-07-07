// Matching de listas de proveedores contra el catálogo del tenant — B8.2 (orquestación).
// La lógica pura (pipeline GTIN→alias→nombre→fuzzy, scoring token-set) vive en @huayruro/shared
// (proveedores/matching). Aquí cargamos los índices del tenant UNA vez y persistimos el resultado.
// Todo tenant-scoped: una lista/ítem de otro tenant → 404 (fallo cerrado, D-N7/§4.4).
import {
  indexarProducto,
  matchearOferta,
  precioEfectivoUnidadDm,
  uuidv7,
  type ProductoIndexado,
  type ResultadoMatch,
  type Sugerencia,
} from "@huayruro/shared";
import { noEncontrado } from "../lib/errores";
import type { Actor } from "../types";
import { withRetry } from "./base";

type ItemPendiente = {
  id: string;
  fila: number;
  texto_original: string;
  gtin: string | null;
  presentacion_texto: string | null;
  factor_unidades: number | null;
  precio_cent: number;
  bonif_compra: number | null;
  bonif_gratis: number | null;
  vencimiento: string | null;
  venc_corto: number;
  score: number;
  sugerencias: Sugerencia[];
};

export type ResumenMatch = { total: number; auto: number; pendiente: number; sin_match: number };

export function comparadorRepo(db: D1Database, actor: Actor) {
  const tid = actor.tenantId;

  // La lista debe ser del tenant. Devuelve su proveedor (para el alias) o 404.
  const listaPropia = async (listaId: string): Promise<{ id: string; proveedor_id: string }> => {
    const l = await withRetry(() =>
      db.prepare(`SELECT id, proveedor_id FROM lista_precios WHERE id = ?1 AND tenant_id = ?2`).bind(listaId, tid).first<{ id: string; proveedor_id: string }>(),
    );
    if (!l) throw noEncontrado("lista");
    return l;
  };

  // El ítem debe pertenecer a una lista del tenant. Devuelve datos para confirmar/descartar.
  const itemPropio = async (itemId: string): Promise<{ id: string; lista_id: string; proveedor_id: string; texto_norm: string }> => {
    const it = await withRetry(() =>
      db
        .prepare(
          `SELECT li.id, li.lista_id, li.texto_norm, lp.proveedor_id
           FROM lista_item li JOIN lista_precios lp ON lp.id = li.lista_id
           WHERE li.id = ?1 AND lp.tenant_id = ?2`,
        )
        .bind(itemId, tid)
        .first<{ id: string; lista_id: string; proveedor_id: string; texto_norm: string }>(),
    );
    if (!it) throw noEncontrado("ítem de lista");
    return it;
  };

  // Índices del tenant (una carga por corrida de matching): productos, GTIN→producto, alias del proveedor.
  async function cargarIndices(proveedorId: string): Promise<{
    productos: ProductoIndexado[];
    gtinAProducto: Map<string, string>;
    aliasAProducto: Map<string, string>;
  }> {
    const prods = await withRetry(() =>
      db
        .prepare(
          `SELECT id, nombre, principio_activo, laboratorio FROM producto_catalogo
           WHERE tenant_id = ?1 AND deleted_at IS NULL`,
        )
        .bind(tid)
        .all<{ id: string; nombre: string; principio_activo: string | null; laboratorio: string | null }>(),
    );
    const productos = prods.results.map((p) => indexarProducto({ producto_id: p.id, nombre: p.nombre, dci: p.principio_activo, laboratorio: p.laboratorio }));

    const cods = await withRetry(() =>
      db
        .prepare(
          `SELECT cb.gtin, cb.producto_id FROM codigo_barras cb
           JOIN producto_catalogo p ON p.id = cb.producto_id
           WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL`,
        )
        .bind(tid)
        .all<{ gtin: string; producto_id: string }>(),
    );
    const gtinAProducto = new Map(cods.results.map((c) => [c.gtin, c.producto_id]));

    const al = await withRetry(() =>
      db.prepare(`SELECT texto_norm, producto_id FROM producto_alias WHERE tenant_id = ?1 AND proveedor_id = ?2`).bind(tid, proveedorId).all<{ texto_norm: string; producto_id: string }>(),
    );
    const aliasAProducto = new Map(al.results.map((a) => [a.texto_norm, a.producto_id]));

    return { productos, gtinAProducto, aliasAProducto };
  }

  return {
    // Matchea (o re-matchea) los ítems 'pendiente'/'auto' de una lista. Preserva 'confirmado' y
    // 'descartado' (decisiones humanas). Persiste todo en un batch y marca la lista 'matcheada'.
    async matchearLista(listaId: string): Promise<{ resumen: ResumenMatch; pendientes: ItemPendiente[] }> {
      const lista = await listaPropia(listaId);
      const idx = await cargarIndices(lista.proveedor_id);

      const items = await withRetry(() =>
        db
          .prepare(
            `SELECT id, fila, texto_original, texto_norm, gtin, presentacion_texto, factor_unidades,
                    precio_cent, bonif_compra, bonif_gratis, vencimiento, venc_corto
             FROM lista_item WHERE lista_id = ?1 AND match_estado IN ('pendiente','auto') ORDER BY fila`,
          )
          .bind(listaId)
          .all<{
            id: string; fila: number; texto_original: string; texto_norm: string; gtin: string | null;
            presentacion_texto: string | null; factor_unidades: number | null; precio_cent: number;
            bonif_compra: number | null; bonif_gratis: number | null; vencimiento: string | null; venc_corto: number;
          }>(),
      );

      const stmts: D1PreparedStatement[] = [];
      const pendientes: ItemPendiente[] = [];
      let auto = 0, pendiente = 0, sinMatch = 0;

      for (const it of items.results) {
        const r: ResultadoMatch = matchearOferta({ gtin: it.gtin, texto_norm: it.texto_norm, texto_original: it.texto_original }, idx);
        const precioUnidadDm = it.factor_unidades && it.factor_unidades > 0 ? precioEfectivoUnidadDm(it.precio_cent, it.factor_unidades, it.bonif_compra, it.bonif_gratis) : null;
        stmts.push(
          db
            .prepare(`UPDATE lista_item SET producto_id = ?2, match_metodo = ?3, match_score = ?4, match_estado = ?5, precio_unidad_dm = ?6 WHERE id = ?1`)
            .bind(it.id, r.producto_id, r.metodo, r.score, r.estado, precioUnidadDm),
        );
        if (r.estado === "auto") auto++;
        else {
          if (r.producto_id === null) sinMatch++;
          else pendiente++;
          pendientes.push({
            id: it.id,
            fila: it.fila,
            texto_original: it.texto_original,
            gtin: it.gtin,
            presentacion_texto: it.presentacion_texto,
            factor_unidades: it.factor_unidades,
            precio_cent: it.precio_cent,
            bonif_compra: it.bonif_compra,
            bonif_gratis: it.bonif_gratis,
            vencimiento: it.vencimiento,
            venc_corto: it.venc_corto,
            score: r.score,
            sugerencias: r.sugerencias,
          });
        }
      }

      // filas_match = ofertas con producto asignado (auto o confirmado) tras esta corrida.
      stmts.push(
        db
          .prepare(
            `UPDATE lista_precios SET filas_match = (
               SELECT COUNT(*) FROM lista_item WHERE lista_id = ?1 AND match_estado IN ('auto','confirmado')
             ), estado = 'matcheada' WHERE id = ?1 AND tenant_id = ?2`,
          )
          .bind(listaId, tid),
      );
      if (stmts.length > 0) await withRetry(() => db.batch(stmts));

      return { resumen: { total: items.results.length, auto, pendiente, sin_match: sinMatch }, pendientes };
    },

    // Confirma un match (humano): fija el producto y APRENDE el alias del proveedor (upsert). El mes
    // siguiente ese texto matchea solo. `productoId` debe ser del catálogo del tenant.
    async confirmar(itemId: string, productoId: string, opts: { usuarioId: string; nowIso: string }): Promise<void> {
      const it = await itemPropio(itemId);
      const prod = await withRetry(() =>
        db.prepare(`SELECT id FROM producto_catalogo WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`).bind(productoId, tid).first<{ id: string }>(),
      );
      if (!prod) throw noEncontrado("producto");

      await withRetry(() =>
        db.batch([
          db.prepare(`UPDATE lista_item SET producto_id = ?2, match_metodo = 'manual', match_estado = 'confirmado' WHERE id = ?1`).bind(itemId, productoId),
          // Alias aprendido (UNIQUE proveedor_id+texto_norm): si ya existía con otro producto, se corrige.
          db
            .prepare(
              `INSERT INTO producto_alias (id, tenant_id, proveedor_id, texto_norm, producto_id, creado_por, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
               ON CONFLICT (proveedor_id, texto_norm) DO UPDATE SET producto_id = excluded.producto_id, creado_por = excluded.creado_por, created_at = excluded.created_at`,
            )
            .bind(uuidv7(), tid, it.proveedor_id, it.texto_norm, productoId, opts.usuarioId, opts.nowIso),
          db
            .prepare(`UPDATE lista_precios SET filas_match = (SELECT COUNT(*) FROM lista_item WHERE lista_id = ?1 AND match_estado IN ('auto','confirmado')) WHERE id = ?1`)
            .bind(it.lista_id),
        ]),
      );
    },

    // Descarta un ítem (no es nuestro / no lo vendemos). v1: no aprende alias negativo (§6.2, se
    // re-pregunta por lista; anotado como mejora v2). Suelta el producto asignado.
    async descartar(itemId: string): Promise<void> {
      const it = await itemPropio(itemId);
      await withRetry(() =>
        db.batch([
          db.prepare(`UPDATE lista_item SET producto_id = NULL, match_metodo = NULL, match_estado = 'descartado' WHERE id = ?1`).bind(itemId),
          db
            .prepare(`UPDATE lista_precios SET filas_match = (SELECT COUNT(*) FROM lista_item WHERE lista_id = ?1 AND match_estado IN ('auto','confirmado')) WHERE id = ?1`)
            .bind(it.lista_id),
        ]),
      );
    },
  };
}
