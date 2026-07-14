import { clasificarABC, conteoVencido, diasEntreYmd, PRIORIDAD_CLASE, uuidv7, type ClaseABC } from "@huayruro/shared";
import { validacion } from "../lib/errores";
import { withRetry } from "./base";

// ============================================================
// P5 (C3) — Conteo cíclico de inventario ("Conteo de inventario"). Plan expansión §4 C3 + §5 D.
//   · sugeridos(): lista del día por clasificación ABC (A semanal, B mensual, C trimestral) — CIEGA:
//     no revela el stock del sistema (el que cuenta no debe "cuadrar" al número → conteo honesto).
//   · finalizar(): aplica el conteo → ajusta stock (movimiento 'conteo_ciclico') y valoriza la merma;
//     idempotente por client_uuid (reintento offline NO re-ajusta).
//   · resumen(): IRA % (exactitud de inventario) + merma del periodo + sesiones recientes.
// Las diferencias valorizadas alimentan el indicador EBR `merma_conteo` (repos/casos.ts) — que abre un
// caso tipo 'perdida' (sobre el SKU/sesión, NUNCA sobre el operador: la merma no es una falta personal).
// ============================================================

const MAX_ITEMS = 150; // tope de productos por hoja de conteo (una hoja diaria real son 10–20)
const TROZO = 90; // gotcha D1: ≤100 binds/query → IN() en trozos + 1 bind de sucursal
const VENTANA_ABC_DIAS = 90; // ventana de ventas para clasificar ABC

function trozos<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export type ItemContado = { productoId: string; contado: number };

export type SesionResumen = {
  id: string;
  created_at: string;
  items_contados: number;
  items_descuadrados: number;
  merma_valor_cent: number;
  exceso_valor_cent: number;
};

export function conteoRepo(db: D1Database) {
  return {
    // Lista sugerida del día: productos "vencidos" según su clase ABC, priorizados (A primero, más
    // atrasado primero). CIEGA a propósito (sin el stock esperado). `limite` topa la hoja diaria.
    async sugeridos(
      sucursalId: string,
      opts: { hoyYmd: string; nowIso: string; limite?: number },
    ): Promise<{ hoy: string; total_universo: number; total_vencidos: number; sugeridos: { inventario_id: string; producto_id: string; nombre: string; clase: ClaseABC; ultimo_conteo: string | null }[] }> {
      const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100);
      const inv = await withRetry(() =>
        db
          .prepare(
            `SELECT il.id AS inventario_id, il.producto_id AS producto_id, p.nombre AS nombre, il.stock_unidades AS stock
             FROM inventario_local il JOIN producto_catalogo p ON p.id = il.producto_id
             WHERE il.sucursal_id = ?1 AND p.deleted_at IS NULL
             ORDER BY p.nombre LIMIT 2000`,
          )
          .bind(sucursalId)
          .all<{ inventario_id: string; producto_id: string; nombre: string; stock: number }>(),
      );
      if (inv.results.length === 0) return { hoy: opts.hoyYmd, total_universo: 0, total_vencidos: 0, sugeridos: [] };

      const desde = new Date(Date.parse(opts.nowIso) - VENTANA_ABC_DIAS * 86_400_000).toISOString();
      const ventas = await withRetry(() =>
        db
          .prepare(
            `SELECT vi.producto_id AS producto_id, SUM(vi.total_cent) AS valor
             FROM venta_item vi JOIN venta v ON v.id = vi.venta_id
             WHERE v.sucursal_id = ?1 AND v.estado = 'completada' AND v.fecha_hora >= ?2
             GROUP BY vi.producto_id`,
          )
          .bind(sucursalId, desde)
          .all<{ producto_id: string; valor: number }>(),
      );
      const valorPorProd = new Map<string, number>(ventas.results.map((r) => [r.producto_id, r.valor ?? 0]));

      const ultimos = await withRetry(() =>
        db
          .prepare(
            `SELECT ci.producto_id AS producto_id, MAX(cs.created_at) AS ultimo
             FROM conteo_item ci JOIN conteo_sesion cs ON cs.id = ci.conteo_sesion_id
             WHERE cs.sucursal_id = ?1 GROUP BY ci.producto_id`,
          )
          .bind(sucursalId)
          .all<{ producto_id: string; ultimo: string }>(),
      );
      const ultimoPorProd = new Map<string, string>(ultimos.results.map((r) => [r.producto_id, r.ultimo]));

      const clase = clasificarABC(inv.results.map((r) => ({ productoId: r.producto_id, valorCent: valorPorProd.get(r.producto_id) ?? 0 })));

      const vencidos = inv.results
        .map((r) => {
          const cl = clase.get(r.producto_id) ?? "C";
          const ultimoIso = ultimoPorProd.get(r.producto_id) ?? null;
          const ultimoYmd = ultimoIso ? ultimoIso.slice(0, 10) : null;
          const atraso = ultimoYmd ? diasEntreYmd(ultimoYmd, opts.hoyYmd) : 1_000_000; // nunca contado = más atrasado
          return { r, clase: cl, ultimoYmd, atraso };
        })
        .filter((x) => conteoVencido(x.clase, x.ultimoYmd, opts.hoyYmd));

      // A > B > C; dentro de la clase, el más atrasado primero; desempate por nombre.
      vencidos.sort(
        (a, b) => PRIORIDAD_CLASE[a.clase] - PRIORIDAD_CLASE[b.clase] || b.atraso - a.atraso || (a.r.nombre < b.r.nombre ? -1 : 1),
      );

      return {
        hoy: opts.hoyYmd,
        total_universo: inv.results.length,
        total_vencidos: vencidos.length,
        sugeridos: vencidos.slice(0, limite).map((x) => ({
          inventario_id: x.r.inventario_id,
          producto_id: x.r.producto_id,
          nombre: x.r.nombre,
          clase: x.clase,
          ultimo_conteo: x.ultimoYmd, // el ESPERADO nunca se expone (conteo ciego)
        })),
      };
    },

    // Aplica una hoja de conteo. Idempotente por client_uuid. Ajusta el stock de los descuadrados (a lo
    // contado), registra el movimiento (delta con signo, motivo 'conteo_ciclico') y valoriza la diferencia.
    async finalizar(opts: {
      sucursalId: string;
      clientUuid: string;
      operadorId: string | null;
      items: ItemContado[];
      notas: string | null;
      nowIso: string;
    }): Promise<{ id: string; items_contados: number; items_descuadrados: number; merma_valor_cent: number; exceso_valor_cent: number; omitidos: string[]; idempotent: boolean }> {
      const previa = await withRetry(() =>
        db
          .prepare(`SELECT id, items_contados, items_descuadrados, merma_valor_cent, exceso_valor_cent FROM conteo_sesion WHERE client_uuid = ?1`)
          .bind(opts.clientUuid)
          .first<{ id: string; items_contados: number; items_descuadrados: number; merma_valor_cent: number; exceso_valor_cent: number }>(),
      );
      if (previa) return { ...previa, omitidos: [], idempotent: true };

      // Dedup por producto (última cuenta gana) + validación.
      const porProd = new Map<string, number>();
      for (const it of opts.items) {
        if (!it.productoId) continue;
        if (!Number.isInteger(it.contado) || it.contado < 0) throw validacion("cantidad contada entera ≥0");
        porProd.set(it.productoId, it.contado);
      }
      const productoIds = [...porProd.keys()];
      if (productoIds.length === 0) throw validacion("sin productos para contar");
      if (productoIds.length > MAX_ITEMS) throw validacion(`máx ${MAX_ITEMS} productos por conteo`);

      // Stock esperado + costo por unidad base, en trozos ≤90 (gotcha D1 100 binds/query).
      const invPorProd = new Map<string, { inventarioId: string; stock: number }>();
      const costoPorProd = new Map<string, number>(); // dm por unidad base
      for (const grupo of trozos(productoIds, TROZO)) {
        const ph = grupo.map((_, i) => `?${i + 2}`).join(",");
        const invRows = await withRetry(() =>
          db.prepare(`SELECT id, producto_id, stock_unidades FROM inventario_local WHERE sucursal_id = ?1 AND producto_id IN (${ph})`).bind(opts.sucursalId, ...grupo).all<{ id: string; producto_id: string; stock_unidades: number }>(),
        );
        for (const r of invRows.results) invPorProd.set(r.producto_id, { inventarioId: r.id, stock: r.stock_unidades });
        const precios = await withRetry(() =>
          db
            .prepare(
              `SELECT pl.producto_id AS producto_id, pl.precio_compra_dm AS compra_dm, pl.precio_sin_igv_dm AS venta_dm, pr.factor_unidades AS factor
               FROM precio_local pl JOIN presentacion pr ON pr.id = pl.presentacion_id
               WHERE pl.sucursal_id = ?1 AND pl.vigente_hasta IS NULL AND pl.producto_id IN (${ph})
               ORDER BY pr.factor_unidades ASC`,
            )
            .bind(opts.sucursalId, ...grupo)
            .all<{ producto_id: string; compra_dm: number | null; venta_dm: number | null; factor: number }>(),
        );
        for (const r of precios.results) {
          if (costoPorProd.has(r.producto_id)) continue; // el de menor factor (base) gana
          const base = r.compra_dm ?? r.venta_dm; // costo real; si no hay, valoriza al precio de venta
          if (base == null) continue;
          const f = r.factor > 0 ? r.factor : 1;
          costoPorProd.set(r.producto_id, Math.round(base / f)); // dm por unidad base
        }
      }

      const sesionId = uuidv7();
      const stmts: D1PreparedStatement[] = [];
      let contados = 0;
      let descuadrados = 0;
      let merma = 0;
      let exceso = 0;
      const omitidos: string[] = [];
      for (const [productoId, contado] of porProd) {
        const inv = invPorProd.get(productoId);
        if (!inv) {
          omitidos.push(productoId); // sin inventario en esta sucursal → no se cuenta
          continue;
        }
        contados++;
        const esperado = inv.stock;
        const dif = contado - esperado;
        const costoDm = costoPorProd.get(productoId) ?? 0;
        const difValorCent = Math.round((dif * costoDm) / 100); // dm → céntimos, con signo
        if (dif !== 0) {
          descuadrados++;
          if (difValorCent < 0) merma += difValorCent;
          else exceso += difValorCent;
          stmts.push(db.prepare(`UPDATE inventario_local SET stock_unidades = ?2, updated_at = ?3 WHERE id = ?1`).bind(inv.inventarioId, contado, opts.nowIso));
          stmts.push(
            db
              .prepare(
                `INSERT INTO movimiento_stock (id, client_uuid, sucursal_id, producto_id, tipo, cantidad, motivo, referencia_id, operador_id, fecha_hora)
                 VALUES (?1,?2,?3,?4,'ajuste_inventario',?5,'conteo_ciclico',?6,?7,?8)`,
              )
              .bind(uuidv7(), uuidv7(), opts.sucursalId, productoId, dif, sesionId, opts.operadorId, opts.nowIso),
          );
        }
        stmts.push(
          db
            .prepare(
              `INSERT INTO conteo_item (id, conteo_sesion_id, producto_id, esperado_unidades, contado_unidades, diferencia_unidades, costo_unitario_dm, diferencia_valor_cent, created_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
            )
            .bind(uuidv7(), sesionId, productoId, esperado, contado, dif, costoDm, difValorCent, opts.nowIso),
        );
      }
      if (contados === 0) throw validacion("ninguno de los productos tiene inventario en esta sucursal");

      // Cabecera al frente: conteo_item referencia conteo_sesion (visibilidad intra-batch, ADR-011).
      stmts.unshift(
        db
          .prepare(
            `INSERT INTO conteo_sesion (id, client_uuid, sucursal_id, operador_id, items_contados, items_descuadrados, merma_valor_cent, exceso_valor_cent, notas, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
          )
          .bind(sesionId, opts.clientUuid, opts.sucursalId, opts.operadorId, contados, descuadrados, merma, exceso, opts.notas, opts.nowIso),
      );

      try {
        await withRetry(() => db.batch(stmts));
      } catch (e) {
        // Carrera de doble-tap: el UNIQUE(client_uuid) abortó el batch (atómico → sin doble ajuste).
        // Si la sesión ya existe, es idempotente; si no, propaga el error real.
        const dup = await db.prepare(`SELECT id, items_contados, items_descuadrados, merma_valor_cent, exceso_valor_cent FROM conteo_sesion WHERE client_uuid = ?1`).bind(opts.clientUuid).first<{ id: string; items_contados: number; items_descuadrados: number; merma_valor_cent: number; exceso_valor_cent: number }>();
        if (dup) return { ...dup, omitidos: [], idempotent: true };
        throw e;
      }
      return { id: sesionId, items_contados: contados, items_descuadrados: descuadrados, merma_valor_cent: merma, exceso_valor_cent: exceso, omitidos, idempotent: false };
    },

    // IRA % (exactitud) del periodo + merma valorizada + sesiones recientes.
    async resumen(
      sucursalId: string,
      opts: { dias: number; nowIso: string },
    ): Promise<{ dias: number; ira_pct: number | null; items_contados: number; items_exactos: number; merma_cent: number; sesiones: SesionResumen[] }> {
      const desde = new Date(Date.parse(opts.nowIso) - opts.dias * 86_400_000).toISOString();
      const ira = await withRetry(() =>
        db
          .prepare(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN ci.diferencia_unidades = 0 THEN 1 ELSE 0 END) AS exactos,
                    SUM(CASE WHEN ci.diferencia_valor_cent < 0 THEN ci.diferencia_valor_cent ELSE 0 END) AS merma_cent
             FROM conteo_item ci JOIN conteo_sesion cs ON cs.id = ci.conteo_sesion_id
             WHERE cs.sucursal_id = ?1 AND ci.created_at >= ?2`,
          )
          .bind(sucursalId, desde)
          .first<{ total: number; exactos: number; merma_cent: number | null }>(),
      );
      const sesiones = await withRetry(() =>
        db
          .prepare(
            `SELECT id, created_at, items_contados, items_descuadrados, merma_valor_cent, exceso_valor_cent
             FROM conteo_sesion WHERE sucursal_id = ?1 ORDER BY created_at DESC LIMIT 20`,
          )
          .bind(sucursalId)
          .all<SesionResumen>(),
      );
      const total = ira?.total ?? 0;
      const exactos = ira?.exactos ?? 0;
      return {
        dias: opts.dias,
        ira_pct: total > 0 ? Number(((exactos / total) * 100).toFixed(1)) : null,
        items_contados: total,
        items_exactos: exactos,
        merma_cent: ira?.merma_cent ?? 0,
        sesiones: sesiones.results,
      };
    },

    // Detalle por línea de UNA sesión de conteo (vista detalle). Scoped: la sesión DEBE ser de la
    // sucursal indicada (404 si es ajena → aislamiento). `motivo` no existe por línea en el esquema
    // (sin migración) → null; la UI lo rotula neutro. valor_merma_cent = diferencia valorizada con signo
    // (negativo = merma).
    async detalle(
      sesionId: string,
      sucursalId: string,
    ): Promise<{
      sesion: SesionResumen & { notas: string | null };
      items: { producto_id: string; nombre: string; esperado: number; contado: number; diferencia: number; valor_merma_cent: number; motivo: string | null }[];
    } | null> {
      const sesion = await withRetry(() =>
        db
          .prepare(
            `SELECT id, created_at, items_contados, items_descuadrados, merma_valor_cent, exceso_valor_cent, notas
             FROM conteo_sesion WHERE id = ?1 AND sucursal_id = ?2`,
          )
          .bind(sesionId, sucursalId)
          .first<SesionResumen & { notas: string | null }>(),
      );
      if (!sesion) return null;
      const items = await withRetry(() =>
        db
          .prepare(
            `SELECT ci.producto_id AS producto_id, p.nombre AS nombre, ci.esperado_unidades AS esperado,
                    ci.contado_unidades AS contado, ci.diferencia_unidades AS diferencia, ci.diferencia_valor_cent AS valor_merma_cent
             FROM conteo_item ci JOIN producto_catalogo p ON p.id = ci.producto_id
             WHERE ci.conteo_sesion_id = ?1 ORDER BY p.nombre`,
          )
          .bind(sesionId)
          .all<{ producto_id: string; nombre: string; esperado: number; contado: number; diferencia: number; valor_merma_cent: number }>(),
      );
      return { sesion, items: (items.results ?? []).map((it) => ({ ...it, motivo: null })) };
    },
  };
}
