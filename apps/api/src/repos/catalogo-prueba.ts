// Catálogo de PRUEBA (B10.4.1). Promueve el catálogo maestro (SUSALUD GTIN — solo MEDICAMENTOS) a
// producto_catalogo + presentación base + código de barras + 100u de inventario + lote + precio
// placeholder, MARCADO con es_prueba=1 para poder PURGARLO trivialmente antes del catálogo real (T-K4).
//
// Por qué existe: durante el piloto de audio, las señales del mostrador salen "sin match en catálogo"
// porque el catálogo real aún no está cargado. Con el maestro promovido, el matcher del audio tiene
// contra qué pegar. PREMISA VERIFICADA: el maestro es SOLO medicamentos — aseo/perfumería/misc NO
// están aquí (vienen del catálogo real o del alta manual); no se inventan.
//
// Escala: ~15,181 medicamentos × ~6 filas/producto = ~90k escrituras a la D1 remota → la carga es
// PAGINADA (keyset por id del maestro, la UI itera con barra de progreso). Cada producto va en su
// PROPIO batch (atómico e independiente: un GTIN que choque no tumba la página). Idempotente por GTIN
// (re-correr salta lo ya cargado, sea de prueba o real). Reusa el contrato de dinero del importador.
import { calcularItem, sinIgvDmDesdeVentaPublicaDm, uuidv7 } from "@huayruro/shared";
import type { Actor } from "../types";
import { withRetry } from "./base";

// El maestro no trae precios: placeholder de S/1.00 al público (el catálogo de prueba es para el
// matcher del audio y 100u de stock, NO para vender de verdad; el precio real llega con T-K4).
const PVP_PLACEHOLDER_DM = 10_000; // S/1.00 en diezmilésimas
const STOCK_PRUEBA = 100;
const VENC_PRUEBA = "2099-12-31";

type MaestroCargable = {
  id: string;
  gtin: string | null;
  nombre: string;
  dci: string | null;
  concentracion: string | null;
  forma_simple: string | null;
  laboratorio: string | null;
  presentacion: string | null;
};

export type ResultadoPagina = {
  creados: number;
  omitidos: number;
  leidos: number;
  siguiente_desde: string | null; // último id del maestro leído; null = no hay más
  total_maestro: number;
};

async function totalMaestro(db: D1Database): Promise<number> {
  const r = await withRetry(() => db.prepare(`SELECT COUNT(*) AS n FROM catalogo_maestro WHERE gtin IS NOT NULL`).first<{ n: number }>());
  return r?.n ?? 0;
}

export function catalogoPruebaRepo(db: D1Database, actor: Actor) {
  const tenantId = actor.tenantId;
  return {
    // Estado para el panel: cuántos productos de prueba tiene el tenant y el techo del maestro.
    async conteo(): Promise<{ productos_prueba: number; total_maestro: number }> {
      const p = await withRetry(() =>
        db.prepare(`SELECT COUNT(*) AS n FROM producto_catalogo WHERE tenant_id = ?1 AND es_prueba = 1 AND deleted_at IS NULL`).bind(tenantId).first<{ n: number }>(),
      );
      return { productos_prueba: p?.n ?? 0, total_maestro: await totalMaestro(db) };
    },

    // GTINs de esta página que el tenant YA tiene (prueba o real) → se saltan (idempotencia).
    async gtinsExistentes(gtins: string[]): Promise<Set<string>> {
      const set = new Set<string>();
      const unicos = [...new Set(gtins.filter(Boolean))];
      // Troceo en 99: con el tenant en ?1, 99 GTIN dan 100 binds = tope de la D1 REMOTA (100 params/query;
      // miniflare local permite 32766 → un trozo de 100 pasaba el gate pero reventaba en prod).
      for (let i = 0; i < unicos.length; i += 99) {
        const trozo = unicos.slice(i, i + 99);
        const placeholders = trozo.map((_, j) => `?${j + 2}`).join(",");
        const r = await withRetry(() =>
          db
            .prepare(
              `SELECT cb.gtin AS gtin FROM codigo_barras cb JOIN producto_catalogo p ON p.id = cb.producto_id
               WHERE p.tenant_id = ?1 AND cb.gtin IN (${placeholders})`,
            )
            .bind(tenantId, ...trozo)
            .all<{ gtin: string }>(),
        );
        for (const fila of r.results ?? []) set.add(fila.gtin);
      }
      return set;
    },

    // Promueve una PÁGINA del maestro (keyset: filas con id > desdeId). Devuelve el último id leído
    // como cursor para la siguiente llamada (null si la página vino incompleta → fin).
    async promoverPagina(opts: { sucursalId: string; desdeId: string; cantidad: number; hoy: string; nowIso: string }): Promise<ResultadoPagina> {
      const total = await totalMaestro(db);
      const { results } = await withRetry(() =>
        db
          .prepare(
            `SELECT id, gtin, nombre, dci, concentracion, forma_simple, laboratorio, presentacion
             FROM catalogo_maestro WHERE gtin IS NOT NULL AND id > ?1 ORDER BY id ASC LIMIT ?2`,
          )
          .bind(opts.desdeId, opts.cantidad)
          .all<MaestroCargable>(),
      );
      const filas = results ?? [];
      const yaExisten = await this.gtinsExistentes(filas.map((f) => f.gtin ?? ""));

      let creados = 0;
      let omitidos = 0;
      for (const f of filas) {
        if (!f.gtin || yaExisten.has(f.gtin)) {
          omitidos++;
          continue;
        }
        try {
          await this.promoverUno(f, opts);
          creados++;
        } catch {
          // GTIN que choca contra otro tenant (UNIQUE global) u otra rareza → se salta, no tumba la página.
          omitidos++;
        }
      }
      const leidos = filas.length;
      const ultimo = filas.length ? filas[filas.length - 1]!.id : null;
      // Cursor: si la página vino LLENA hay (probablemente) más; si vino corta, terminamos.
      const siguiente = leidos === opts.cantidad ? ultimo : null;
      return { creados, omitidos, leidos, siguiente_desde: siguiente, total_maestro: total };
    },

    // Un producto de prueba en UN batch atómico (catálogo + fts + presentación base + código + 100u + lote + precio).
    async promoverUno(f: MaestroCargable, opts: { sucursalId: string; hoy: string; nowIso: string }): Promise<void> {
      const prodId = uuidv7();
      const basePresId = uuidv7();
      const invId = uuidv7();
      const precioSinIgvDm = sinIgvDmDesdeVentaPublicaDm(PVP_PLACEHOLDER_DM);
      const precio = calcularItem(1, precioSinIgvDm);
      const categoria = f.forma_simple ?? null;
      const textoFts = [f.nombre, f.dci, f.laboratorio, f.concentracion, f.forma_simple].filter(Boolean).join(" ");
      await withRetry(() =>
        db.batch([
          db
            .prepare(
              `INSERT INTO producto_catalogo (id, tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta, es_cronico, es_prueba, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, 1, ?8, ?8)`,
            )
            .bind(prodId, tenantId, f.nombre, f.presentacion, f.laboratorio, f.dci, categoria, opts.nowIso),
          db.prepare(`INSERT INTO producto_fts (producto_id, texto) VALUES (?1, ?2)`).bind(prodId, textoFts),
          db.prepare(`INSERT INTO presentacion (id, producto_id, nombre, factor_unidades, es_base, created_at) VALUES (?1, ?2, 'unidad', 1, 1, ?3)`).bind(basePresId, prodId, opts.nowIso),
          db.prepare(`INSERT INTO codigo_barras (id, producto_id, presentacion_id, gtin, es_unidad, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)`).bind(uuidv7(), prodId, basePresId, f.gtin, opts.nowIso),
          db.prepare(`INSERT INTO inventario_local (id, sucursal_id, producto_id, stock_unidades, stock_minimo, updated_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)`).bind(invId, opts.sucursalId, prodId, STOCK_PRUEBA, opts.nowIso),
          db
            .prepare(`INSERT INTO lote (id, inventario_id, numero_lote, fecha_vencimiento, unidades, proveedor, fecha_recepcion, created_at, updated_at) VALUES (?1, ?2, 'PRUEBA', ?3, ?4, NULL, ?5, ?6, ?6)`)
            .bind(uuidv7(), invId, VENC_PRUEBA, STOCK_PRUEBA, opts.hoy, opts.nowIso),
          db
            .prepare(
              `INSERT INTO precio_local (id, producto_id, sucursal_id, presentacion_id, precio_compra_dm, precio_sin_igv_dm, igv_dm, precio_total_dm, vigente_desde, created_at)
               VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?8)`,
            )
            .bind(uuidv7(), prodId, opts.sucursalId, basePresId, precioSinIgvDm, precio.igvUnitarioDm, precio.precioTotalUnitarioDm, opts.nowIso),
        ]),
      );
    },

    // Purga TODO el catálogo de prueba del tenant (WHERE es_prueba=1), en orden de FK. NO toca ventas:
    // si un producto de prueba tuviera ventas ligadas, la FK aborta el batch y el error sube (nunca
    // borra historial en silencio). Deja intactos los productos reales (es_prueba=0).
    async purgar(): Promise<{ productos: number }> {
      const antes = await withRetry(() =>
        db.prepare(`SELECT COUNT(*) AS n FROM producto_catalogo WHERE tenant_id = ?1 AND es_prueba = 1`).bind(tenantId).first<{ n: number }>(),
      );
      const n = antes?.n ?? 0;
      if (n === 0) return { productos: 0 };
      const ids = `SELECT id FROM producto_catalogo WHERE tenant_id = ?1 AND es_prueba = 1`;
      const b = (sql: string) => db.prepare(sql).bind(tenantId);
      await withRetry(() =>
        db.batch([
          b(`DELETE FROM lote WHERE inventario_id IN (SELECT id FROM inventario_local WHERE producto_id IN (${ids}))`),
          b(`DELETE FROM inventario_local WHERE producto_id IN (${ids})`),
          b(`DELETE FROM precio_local WHERE producto_id IN (${ids})`),
          b(`DELETE FROM codigo_barras WHERE producto_id IN (${ids})`),
          b(`DELETE FROM presentacion WHERE producto_id IN (${ids})`),
          b(`DELETE FROM producto_fts WHERE producto_id IN (${ids})`),
          b(`DELETE FROM producto_catalogo WHERE tenant_id = ?1 AND es_prueba = 1`),
        ]),
      );
      return { productos: n };
    },
  };
}
