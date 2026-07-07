import { esVencCorto, uuidv7, type ItemListaImportable } from "@huayruro/shared";
import { conflicto, noEncontrado, validacion } from "../lib/errores";
import type { Actor } from "../types";
import { withRetry } from "./base";

// Proveedores (droguerías) + listas de precios — B8.1. TODO tenant-scoped (a diferencia del
// maestro): las condiciones comerciales de una cadena son SU data (plan §2.3 D-N7).

export type ProveedorFila = {
  id: string;
  nombre: string;
  ruc: string | null;
  contacto: string | null;
  monto_minimo_cent: number;
  flete_cent: number;
  dias_entrega: number | null;
  activo: number;
  listas: number;
};

export type ListaFila = {
  id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  etiqueta: string;
  fecha_lista: string;
  filas_total: number;
  filas_match: number;
  estado: string;
  created_at: string;
};

export type ListaItemFila = {
  id: string;
  fila: number;
  texto_original: string;
  gtin: string | null;
  laboratorio: string | null;
  presentacion_texto: string | null;
  factor_unidades: number | null;
  precio_cent: number;
  precio_unidad_dm: number | null;
  bonif_compra: number | null;
  bonif_gratis: number | null;
  vencimiento: string | null;
  venc_corto: number;
  producto_id: string | null;
  match_metodo: string | null;
  match_score: number | null;
  match_estado: string;
};

// Tope de ofertas por lista: entra en UN db.batch atómico (o todo o nada). Las listas reales
// rondan ~2k filas/mes (plan §12); si un archivo pasa esto, que el humano lo parta.
export const MAX_ITEMS_LISTA = 3000;

export function proveedorRepo(db: D1Database, actor: Actor) {
  const tid = actor.tenantId;

  const proveedorPropio = async (proveedorId: string): Promise<{ id: string }> => {
    const p = await withRetry(() =>
      db.prepare(`SELECT id FROM proveedor WHERE id = ?1 AND tenant_id = ?2`).bind(proveedorId, tid).first<{ id: string }>(),
    );
    if (!p) throw noEncontrado("proveedor");
    return p;
  };

  return {
    // 404 si el proveedor no existe o es de otro tenant (para el dry-run de ingesta).
    async verificar(proveedorId: string): Promise<void> {
      await proveedorPropio(proveedorId);
    },

    async listar(): Promise<ProveedorFila[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT p.id, p.nombre, p.ruc, p.contacto, p.monto_minimo_cent, p.flete_cent, p.dias_entrega, p.activo,
                    (SELECT COUNT(*) FROM lista_precios lp WHERE lp.proveedor_id = p.id) AS listas
             FROM proveedor p WHERE p.tenant_id = ?1 ORDER BY p.activo DESC, p.nombre`,
          )
          .bind(tid)
          .all<ProveedorFila>(),
      );
      return r.results;
    },

    async crear(input: {
      nombre: string;
      ruc: string | null;
      contacto: string | null;
      montoMinimoCent: number;
      fleteCent: number;
      diasEntrega: number | null;
      nowIso: string;
    }): Promise<{ id: string }> {
      if (!input.nombre.trim()) throw validacion("nombre requerido");
      const id = uuidv7();
      try {
        await withRetry(() =>
          db
            .prepare(
              `INSERT INTO proveedor (id, tenant_id, nombre, ruc, contacto, monto_minimo_cent, flete_cent, dias_entrega, activo, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9)`,
            )
            .bind(id, tid, input.nombre.trim(), input.ruc, input.contacto, input.montoMinimoCent, input.fleteCent, input.diasEntrega, input.nowIso)
            .run(),
        );
      } catch (e) {
        if (/UNIQUE constraint failed: proveedor\./i.test(String(e))) throw conflicto("ya existe un proveedor con ese nombre");
        throw e;
      }
      return { id };
    },

    // 404 si es de otro tenant (fallo cerrado, §4.4 #9).
    async actualizar(
      id: string,
      campos: {
        nombre?: string | undefined;
        ruc?: string | null | undefined;
        contacto?: string | null | undefined;
        montoMinimoCent?: number | undefined;
        fleteCent?: number | undefined;
        diasEntrega?: number | null | undefined;
        activo?: boolean | undefined;
      },
    ): Promise<void> {
      await proveedorPropio(id);
      try {
        await withRetry(() =>
          db
            .prepare(
              `UPDATE proveedor SET
                 nombre = COALESCE(?2, nombre), ruc = COALESCE(?3, ruc), contacto = COALESCE(?4, contacto),
                 monto_minimo_cent = COALESCE(?5, monto_minimo_cent), flete_cent = COALESCE(?6, flete_cent),
                 dias_entrega = COALESCE(?7, dias_entrega), activo = COALESCE(?8, activo)
               WHERE id = ?1 AND tenant_id = ?9`,
            )
            .bind(
              id,
              campos.nombre?.trim() ?? null,
              campos.ruc ?? null,
              campos.contacto ?? null,
              campos.montoMinimoCent ?? null,
              campos.fleteCent ?? null,
              campos.diasEntrega ?? null,
              campos.activo === undefined ? null : campos.activo ? 1 : 0,
              tid,
            )
            .run(),
        );
      } catch (e) {
        if (/UNIQUE constraint failed: proveedor\./i.test(String(e))) throw conflicto("ya existe un proveedor con ese nombre");
        throw e;
      }
    },

    // Ingesta de una lista validada: cabecera + TODOS los ítems en un solo batch (atómico:
    // si algo falla, no queda una lista a medias). venc_corto se deriva aquí con el umbral §6.3.
    async crearLista(input: {
      proveedorId: string;
      etiqueta: string;
      fechaLista: string;
      items: ItemListaImportable[];
      hoy: string;
      nowIso: string;
    }): Promise<{ id: string; insertadas: number }> {
      await proveedorPropio(input.proveedorId);
      if (input.items.length === 0) throw validacion("la lista no tiene filas válidas");
      if (input.items.length > MAX_ITEMS_LISTA) {
        throw validacion(`demasiadas filas (${input.items.length}); máximo ${MAX_ITEMS_LISTA} por lista — parte el archivo`);
      }
      const listaId = uuidv7();
      const stmts = [
        db
          .prepare(
            `INSERT INTO lista_precios (id, tenant_id, proveedor_id, etiqueta, fecha_lista, filas_total, filas_match, estado, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'borrador', ?7)`,
          )
          .bind(listaId, tid, input.proveedorId, input.etiqueta, input.fechaLista, input.items.length, input.nowIso),
      ];
      for (const it of input.items) {
        stmts.push(
          db
            .prepare(
              `INSERT INTO lista_item (id, lista_id, fila, texto_original, texto_norm, gtin, laboratorio, presentacion_texto,
                                       factor_unidades, precio_cent, bonif_compra, bonif_gratis, vencimiento, venc_corto, match_estado)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'pendiente')`,
            )
            .bind(
              uuidv7(),
              listaId,
              it.fila,
              it.textoOriginal,
              it.textoNorm,
              it.gtin,
              it.laboratorio,
              it.presentacionTexto,
              it.factorUnidades,
              it.precioCent,
              it.bonifCompra,
              it.bonifGratis,
              it.vencimiento,
              it.vencimiento && esVencCorto(it.vencimiento, input.hoy) ? 1 : 0,
            ),
        );
      }
      await withRetry(() => db.batch(stmts));
      return { id: listaId, insertadas: input.items.length };
    },

    async listas(proveedorId?: string): Promise<ListaFila[]> {
      const base = `SELECT l.id, l.proveedor_id, p.nombre AS proveedor_nombre, l.etiqueta, l.fecha_lista,
                           l.filas_total, l.filas_match, l.estado, l.created_at
                    FROM lista_precios l JOIN proveedor p ON p.id = l.proveedor_id
                    WHERE l.tenant_id = ?1 ${proveedorId ? "AND l.proveedor_id = ?2" : ""}
                    ORDER BY l.created_at DESC LIMIT 100`;
      const stmt = proveedorId ? db.prepare(base).bind(tid, proveedorId) : db.prepare(base).bind(tid);
      const r = await withRetry(() => stmt.all<ListaFila>());
      return r.results;
    },

    // Ítems de una lista propia (revisión). 404 si la lista es de otro tenant.
    async itemsDeLista(listaId: string): Promise<{ lista: ListaFila; items: ListaItemFila[] }> {
      const lista = await withRetry(() =>
        db
          .prepare(
            `SELECT l.id, l.proveedor_id, p.nombre AS proveedor_nombre, l.etiqueta, l.fecha_lista,
                    l.filas_total, l.filas_match, l.estado, l.created_at
             FROM lista_precios l JOIN proveedor p ON p.id = l.proveedor_id
             WHERE l.id = ?1 AND l.tenant_id = ?2`,
          )
          .bind(listaId, tid)
          .first<ListaFila>(),
      );
      if (!lista) throw noEncontrado("lista");
      const items = await withRetry(() =>
        db
          .prepare(
            `SELECT id, fila, texto_original, gtin, laboratorio, presentacion_texto, factor_unidades,
                    precio_cent, precio_unidad_dm, bonif_compra, bonif_gratis, vencimiento, venc_corto,
                    producto_id, match_metodo, match_score, match_estado
             FROM lista_item WHERE lista_id = ?1 ORDER BY fila`,
          )
          .bind(listaId)
          .all<ListaItemFila>(),
      );
      return { lista, items: items.results };
    },
  };
}
