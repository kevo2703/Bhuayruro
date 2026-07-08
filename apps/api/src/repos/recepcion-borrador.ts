// Bandeja de aprobación de recepciones del bot — B9 (§7.4). Tenant-scoped: un borrador de una
// sucursal es invisible para el admin de otra (fallo cerrado 404). Al APROBAR se convierte en una
// recepción REAL por el MISMO camino del kardex (recepcionRepo.registrar → lotes/FEFO/stock/audit
// intactos), de modo que el inventario se alimenta de lo RECIBIDO (D-N4). Rechazar NO toca stock.

import { sinIgvDmDesdeVentaPublicaDm, type BorradorBot } from "@huayruro/shared";
import { conflicto, noEncontrado, validacion } from "../lib/errores";
import { esSuper } from "../lib/scope";
import type { Actor } from "../types";
import { withRetry } from "./base";
import { precioRepo, productoRepo } from "./catalogo";
import { recepcionRepo } from "./recepcion";

type FilaBorrador = {
  id: string;
  tenant_id: string;
  sucursal_id: string;
  chat_id: string | null;
  payload_json: string;
  estado: string;
  recepcion_id: string | null;
  created_at: string;
  updated_at: string;
};

export type NuevoProductoAlta = {
  nombre: string;
  presentacion?: string | null;
  laboratorio?: string | null;
  principio_activo?: string | null;
  categoria?: string | null;
  requiere_receta?: boolean;
  codigo_barras?: string | null;
};

const parsePayload = (s: string): BorradorBot => {
  try {
    return JSON.parse(s) as BorradorBot;
  } catch {
    return {};
  }
};

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function recepcionBorradorRepo(db: D1Database, actor: Actor) {
  const tid = actor.tenantId;

  // Carga un borrador propio (del tenant; y de MI sucursal si no soy super). 404 fuera de scope.
  async function propio(id: string): Promise<FilaBorrador> {
    const b = await withRetry(() =>
      db.prepare(`SELECT * FROM recepcion_borrador WHERE id = ?1 AND tenant_id = ?2`).bind(id, tid).first<FilaBorrador>(),
    );
    if (!b) throw noEncontrado("borrador");
    if (!esSuper(actor) && actor.sucursalId && b.sucursal_id !== actor.sucursalId) throw noEncontrado("borrador");
    return b;
  }

  // Busca un producto del tenant por GTIN (para sugerir/vincular en la bandeja).
  async function productoPorGtin(gtin: string): Promise<{ id: string; nombre: string } | null> {
    return withRetry(() =>
      db
        .prepare(
          `SELECT p.id, p.nombre FROM codigo_barras cb JOIN producto_catalogo p ON p.id = cb.producto_id
           WHERE cb.gtin = ?1 AND p.tenant_id = ?2 AND p.deleted_at IS NULL LIMIT 1`,
        )
        .bind(gtin, tid)
        .first<{ id: string; nombre: string }>(),
    );
  }

  async function verificarProductoTenant(productoId: string): Promise<void> {
    const p = await withRetry(() =>
      db.prepare(`SELECT id FROM producto_catalogo WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`).bind(productoId, tid).first<{ id: string }>(),
    );
    if (!p) throw noEncontrado("producto");
  }

  return {
    // Lista los borradores pendientes de una sucursal, enriquecidos con el producto sugerido (por GTIN)
    // y los datos del maestro (para precargar el alta sin round-trips).
    async pendientes(sucursalId: string): Promise<unknown[]> {
      const filas = await withRetry(() =>
        db
          .prepare(
            `SELECT id, tenant_id, sucursal_id, chat_id, payload_json, estado, recepcion_id, created_at, updated_at
             FROM recepcion_borrador WHERE tenant_id = ?1 AND sucursal_id = ?2 AND estado = 'pendiente' ORDER BY created_at`,
          )
          .bind(tid, sucursalId)
          .all<FilaBorrador>(),
      );

      const cards = [];
      for (const f of filas.results) {
        const p = parsePayload(f.payload_json);
        let sugerido: { id: string; nombre: string } | null = null;
        if (!p.producto_id && p.gtin) sugerido = await productoPorGtin(p.gtin);
        let maestro: { nombre: string; dci: string | null; laboratorio: string | null; presentacion: string | null } | null = null;
        if (p.maestro_id) {
          maestro = await withRetry(() =>
            db.prepare(`SELECT nombre, dci, laboratorio, presentacion FROM catalogo_maestro WHERE id = ?1`).bind(p.maestro_id).first<{ nombre: string; dci: string | null; laboratorio: string | null; presentacion: string | null }>(),
          );
        }
        cards.push({
          id: f.id,
          created_at: f.created_at,
          producto_texto: p.producto_texto ?? null,
          producto_id: p.producto_id ?? null,
          producto_sugerido: sugerido,
          gtin: p.gtin ?? null,
          maestro,
          lote: p.lote ?? null,
          vencimiento: p.vencimiento ?? null,
          precio_unidad_cent: p.precio_unidad_cent ?? null,
          precio_blister_cent: p.precio_blister_cent ?? null,
          unidades_por_blister: p.unidades_por_blister ?? null,
          cantidad: p.cantidad ?? null,
          ubicacion: p.ubicacion ?? null,
          fotos: (p.fotos ?? []).length,
          confianza_ocr: p.confianza_ocr ?? null,
        });
      }
      return cards;
    },

    // Clave R2 de la foto `idx` de un borrador propio (para el proxy del Worker). 404 fuera de scope.
    async claveFoto(id: string, idx: number): Promise<string> {
      const b = await propio(id);
      const p = parsePayload(b.payload_json);
      const key = (p.fotos ?? [])[idx];
      if (!key) throw noEncontrado("foto");
      return key;
    },

    // Guarda correcciones del admin sin aprobar (merge sobre el payload; sigue 'pendiente').
    async corregir(id: string, cambios: Partial<BorradorBot>, nowIso: string): Promise<void> {
      const b = await propio(id);
      if (b.estado !== "pendiente") throw conflicto("el borrador ya fue resuelto");
      const merged = { ...parsePayload(b.payload_json), ...limpiarCambios(cambios) };
      await withRetry(() =>
        db.prepare(`UPDATE recepcion_borrador SET payload_json = ?2, updated_at = ?3 WHERE id = ?1`).bind(id, JSON.stringify(merged), nowIso).run(),
      );
    },

    // Rechaza: marca 'rechazado', NO toca stock ni lotes.
    async rechazar(id: string, usuarioId: string, nowIso: string): Promise<void> {
      const b = await propio(id);
      if (b.estado !== "pendiente") throw conflicto("el borrador ya fue resuelto");
      await withRetry(() =>
        db.prepare(`UPDATE recepcion_borrador SET estado = 'rechazado', revisado_por = ?2, updated_at = ?3 WHERE id = ?1`).bind(id, usuarioId || null, nowIso).run(),
      );
    },

    // Aprueba: crea la recepción REAL (reusa el kardex). Si no hay producto y viene `nuevoProducto`,
    // lo da de alta (y, si trajo precio, lo deja vendible) antes de recibir. Idempotente por estado
    // ('pendiente' → 'aprobado'); reintentar un aprobado devuelve 409.
    async aprobar(
      id: string,
      opts: { correcciones?: Partial<BorradorBot>; nuevoProducto?: NuevoProductoAlta; usuarioId: string; nowIso: string },
    ): Promise<{ recepcion_id: string; producto_id: string }> {
      const b = await propio(id);
      if (b.estado !== "pendiente") throw conflicto("el borrador ya fue resuelto");

      const p = { ...parsePayload(b.payload_json), ...limpiarCambios(opts.correcciones ?? {}) };

      // Validación de los datos de recepción (lote/vencimiento/cantidad son obligatorios para el kardex).
      const numeroLote = (p.lote ?? "").trim();
      const vencimiento = (p.vencimiento ?? "").trim();
      const cantidad = p.cantidad;
      if (!numeroLote) throw validacion("falta el número de lote (corrígelo antes de aprobar)");
      if (!RE_FECHA.test(vencimiento)) throw validacion("vencimiento inválido (AAAA-MM-DD)");
      if (!Number.isInteger(cantidad) || (cantidad ?? 0) < 1) throw validacion("cantidad inválida");

      // Resolver el producto: id del payload/corrección → GTIN existente → alta nueva.
      let productoId = p.producto_id ?? null;
      let presentacionBaseId: string | null = null;
      if (productoId) {
        await verificarProductoTenant(productoId);
      } else if (p.gtin && (await productoPorGtin(p.gtin))) {
        productoId = (await productoPorGtin(p.gtin))!.id;
      } else if (opts.nuevoProducto?.nombre?.trim()) {
        const np = opts.nuevoProducto;
        const creado = await productoRepo(db, actor).crear({
          nombre: np.nombre.trim(),
          presentacion: np.presentacion?.trim() || null,
          laboratorio: np.laboratorio?.trim() || null,
          principio_activo: np.principio_activo?.trim() || null,
          categoria: np.categoria?.trim() || null,
          requiere_receta: np.requiere_receta ? 1 : 0,
          gtin: np.codigo_barras?.trim() || p.gtin || null,
          nowIso: opts.nowIso,
        });
        productoId = creado.id;
        presentacionBaseId = creado.presentacion_base_id;
      } else {
        throw validacion("este borrador no tiene producto: elige uno del catálogo o da de alta uno nuevo");
      }

      // Recepción REAL (mismo camino del kardex). client_uuid fresco → una recepción por aprobación.
      const rec = await recepcionRepo(db).registrar({
        clientUuid: `borrador:${id}`,
        sucursalId: b.sucursal_id,
        tenantId: tid,
        operadorId: opts.usuarioId || null,
        proveedor: null,
        observaciones: "Recepción vía bot de Telegram",
        items: [{ productoId: productoId!, numeroLote, fechaVencimiento: vencimiento, cantidad: cantidad! }],
        nowIso: opts.nowIso,
      });

      // Producto nuevo con precio capturado por el bot → déjalo vendible (best-effort; no bloquea el kardex).
      const precioCent = p.precio_unidad_cent;
      if (presentacionBaseId && typeof precioCent === "number" && precioCent > 0) {
        try {
          await precioRepo(db).crearVersion({
            productoId: productoId!,
            sucursalId: b.sucursal_id,
            presentacionId: presentacionBaseId,
            precioSinIgvDm: sinIgvDmDesdeVentaPublicaDm(precioCent * 100), // céntimos → diezmilésimas
            precioCompraDm: null,
            nowIso: opts.nowIso,
          });
        } catch {
          /* el precio es un extra; si algo falla, el admin lo fija a mano */
        }
      }

      await withRetry(() =>
        db
          .prepare(`UPDATE recepcion_borrador SET estado = 'aprobado', revisado_por = ?2, recepcion_id = ?3, payload_json = ?4, updated_at = ?5 WHERE id = ?1`)
          .bind(id, opts.usuarioId || null, rec.recepcionId, JSON.stringify({ ...p, producto_id: productoId }), opts.nowIso)
          .run(),
      );
      return { recepcion_id: rec.recepcionId, producto_id: productoId! };
    },

    // ── Gestión del bot desde la web (§7.1) ──────────────────────────────────────
    // Chats vinculados del tenant (para mostrar/gestionar en la bandeja).
    async listarChats(): Promise<unknown[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT bc.chat_id, bc.estado, bc.updated_at, u.nombre AS usuario, s.nombre AS sucursal
             FROM bot_chat bc LEFT JOIN usuario_perfil u ON u.id = bc.usuario_id
             LEFT JOIN sucursal s ON s.id = bc.sucursal_id
             WHERE bc.tenant_id = ?1 AND bc.usuario_id IS NOT NULL ORDER BY bc.updated_at DESC`,
          )
          .bind(tid)
          .all(),
      );
      return r.results;
    },

    // Desvincula un chat (borra la fila → allowlist deja de responderle). Solo del propio tenant.
    async desvincular(chatId: string): Promise<void> {
      const r = await withRetry(() =>
        db.prepare(`DELETE FROM bot_chat WHERE chat_id = ?1 AND tenant_id = ?2`).bind(chatId, tid).run(),
      );
      if (!r.meta.changes) throw noEncontrado("chat");
    },
  };
}

// Solo permite corregir campos de recepción conocidos (evita inyectar basura al payload).
function limpiarCambios(c: Partial<BorradorBot>): Partial<BorradorBot> {
  const out: Partial<BorradorBot> = {};
  if (typeof c.producto_id === "string" && c.producto_id.trim()) out.producto_id = c.producto_id.trim();
  if (typeof c.lote === "string") out.lote = c.lote.trim();
  if (typeof c.vencimiento === "string") out.vencimiento = c.vencimiento.trim();
  const cant = c.cantidad;
  if (typeof cant === "number" && Number.isInteger(cant)) out.cantidad = cant;
  const precio = c.precio_unidad_cent;
  if (typeof precio === "number" && Number.isInteger(precio)) out.precio_unidad_cent = precio;
  if (typeof c.ubicacion === "string") out.ubicacion = c.ubicacion.trim();
  if (typeof c.gtin === "string") out.gtin = c.gtin.trim();
  return out;
}
