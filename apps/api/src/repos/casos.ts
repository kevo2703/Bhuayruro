import { estaFueraDeHorario, uuidv7 } from "@huayruro/shared";
import { fechaLocal, rangoDiaLima } from "../lib/fecha";
import { noEncontrado, validacion } from "../lib/errores";
import type { Bindings } from "../types";
import { withRetry } from "./base";

// ============================================================
// B11.1 — EBR determinista (Exception-Based Reporting) + bandeja de casos.
// Plan frentes nuevos §9 + plan expansión §5 D1. El sistema INFORMA; un humano confirma/descarta —
// JAMÁS sanción automática. Cada indicador cruza umbral → abre un `caso` (idempotente por clave_dedup).
//
// VETO D-N5 (verificado por veto-audio.test.ts): este repo NUNCA lee ninguna tabla de audio. Los casos
// tipo 'personal' SÍ se ligan al operador (esa es la supervisión legítima por datos POS), pero el audio
// jamás alimenta un caso. Fuentes usadas: evento_caja, venta, venta_item, precio_local, cierre_caja,
// inventario_local, usuario_perfil, sucursal. Ninguna de audio.
// ============================================================

// ---- Umbrales: constantes AJUSTABLES SIN MIGRACIÓN (plan §9). Un cambio aquí re-calibra el EBR. ----
export const UMBRAL = {
  // Cajón sin venta (Δ3): un operador con muchas aperturas sin venta frente al promedio de la botica.
  CAJON_MIN_EVENTOS: 3, // piso absoluto en el día (con 1-2 no vale la pena mirar)
  CAJON_RATIO: 2, // ... y ≥ 2× el promedio por operador de la botica ese día
  // Anulaciones: tasa anuladas/ventas del operador muy por encima del promedio de la botica (30 días).
  ANUL_MIN_VENTAS: 10, // piso de ventas del operador en la ventana (sin volumen, el ratio miente)
  ANUL_PISO_TASA: 0.1, // ... y su propia tasa ≥ 10% (evita disparar cuando el promedio es ~0)
  ANUL_RATIO: 2, // ... y ≥ 2× la tasa promedio de la botica
  // Venta bajo precio: líneas cobradas por debajo del precio vigente AL MOMENTO de la venta.
  BAJO_PRECIO_MIN_LINEAS: 2, // 1 sola línea puede ser un descuento legítimo; ≥2 en el día merece revisión
  // Descuadre de caja (faltante de efectivo = diferencia negativa).
  DESCUADRE_UMBRAL_CENT: 500, // |faltante| ≥ S/5.00 para contar el día como descuadre
  DESCUADRE_DIAS: 3, // ≥ 3 días con faltante en 30 días → caso recurrente
  DESCUADRE_GRANDE_CENT: 5000, // un solo día con faltante ≥ S/50.00 → caso inmediato (severidad alta)
  // Stock negativo (venta sin recepción registrada): unidades por debajo de 0 en el inventario perpetuo.
  STOCK_NEG_SEV2_UNIDS: 20, // faltante ≥ 20 u → severidad 2
  // Merma por conteo cíclico (P5/C3): la diferencia física valorizada abre un caso 'perdida'.
  MERMA_MATERIAL_CENT: 2000, // una sesión con merma ≥ S/20 → caso material (piso; debajo es ruido de conteo)
  MERMA_SEV3_CENT: 10000, // merma ≥ S/100 en una sesión → severidad 3 (si no, 2)
  MERMA_VENTANA_DIAS: 3, // se revisan las sesiones de los últimos 3 días (catch-up idempotente por sesión)
  MERMA_RECURRENTE_DIAS: 30, // ventana del patrón recurrente por SKU
  MERMA_RECURRENTE_SESIONES: 3, // mismo SKU con faltante en ≥3 conteos distintos en 30 días → caso
  // Anti-fatiga.
  AUTOCIERRE_DIAS: 14, // un caso 'abierto' sin resolver se autocierra a los 14 días
  TOPE_POR_CORRIDA: 40, // cap de casos NUEVOS por sucursal por corrida (los más severos primero)
} as const;

type Indicador =
  | "cajon_sin_venta"
  | "anulaciones"
  | "venta_bajo_precio"
  | "descuadre"
  | "stock_negativo"
  | "fuera_horario"
  | "merma_conteo";

type CasoCandidato = {
  tipo: "perdida" | "personal";
  indicador: Indicador;
  severidad: 1 | 2 | 3;
  evidencia: Record<string, unknown>;
  claveDedup: string;
};

// ---- Helpers de fecha (Lima UTC-5 fijo; el Cron corre 03:00 Lima = 08:00 UTC) ----

function restarMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) - ms).toISOString();
}

// Lunes (YYYY-MM-DD) de la semana de una fecha Lima → clave de dedup semanal estable.
function lunesDe(fechaYmd: string): string {
  const d = new Date(`${fechaYmd}T12:00:00.000Z`); // mediodía: lejos de cualquier borde de zona
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

type Ventanas = {
  ahoraIso: string;
  diaObjetivo: string; // último día Lima cerrado (el Cron corre de madrugada → ayer)
  dia: { inicio: string; fin: string }; // rango UTC del día objetivo
  v30Inicio: string; // 30 días atrás desde el fin del día objetivo
  hace30Fecha: string; // día objetivo − 30 (YYYY-MM-DD Lima), para cierre_caja.fecha
  semana: string; // lunes del día objetivo (dedup semanal)
};

// `offsetDias` retrocede el día objetivo (0 = ayer, 1 = anteayer…) para el catch-up de los indicadores
// diarios si el Cron se saltó una noche (los indicadores de 30 días / snapshot se anclan siempre en 0).
function ventanas(ahoraIso: string, offsetDias = 0): Ventanas {
  // Último día Lima COMPLETO = fecha Lima de (ahora − 24 h). Robusto para el Cron de madrugada.
  const diaObjetivo = fechaLocal("America/Lima", new Date(restarMs(ahoraIso, (1 + offsetDias) * 86_400_000)));
  const dia = rangoDiaLima(diaObjetivo);
  const v30Inicio = restarMs(dia.fin, 30 * 86_400_000);
  const hace30Fecha = fechaLocal("America/Lima", new Date(restarMs(dia.fin, 30 * 86_400_000)));
  return { ahoraIso, diaObjetivo, dia, v30Inicio, hace30Fecha, semana: lunesDe(diaObjetivo) };
}

// ============================================================
// Indicadores. Cada uno devuelve 0+ candidatos para la sucursal. Todos scoped por sucursal_id.
// ============================================================

// (1) Cajón sin venta (personal, Δ3): aperturas sin venta / no_sale por operador vs promedio de la botica.
async function indCajonSinVenta(db: D1Database, sucursalId: string, w: Ventanas): Promise<CasoCandidato[]> {
  const eventos = await withRetry(() =>
    db
      .prepare(
        `SELECT ec.operador_id AS operador_id, u.nombre AS operador_nombre, COUNT(*) AS n
         FROM evento_caja ec JOIN usuario_perfil u ON u.id = ec.operador_id
         WHERE ec.sucursal_id = ?1 AND ec.tipo IN ('no_sale','apertura_sin_venta')
           AND ec.fecha_hora >= ?2 AND ec.fecha_hora < ?3
         GROUP BY ec.operador_id`,
      )
      .bind(sucursalId, w.dia.inicio, w.dia.fin)
      .all<{ operador_id: string; operador_nombre: string; n: number }>(),
  );
  if (eventos.results.length === 0) return [];

  // Operadores activos ese día = quienes vendieron o abrieron el cajón (denominador justo del promedio).
  const activos = await withRetry(() =>
    db
      .prepare(
        `SELECT DISTINCT operador_id FROM venta
         WHERE sucursal_id = ?1 AND operador_id IS NOT NULL AND fecha_hora >= ?2 AND fecha_hora < ?3`,
      )
      .bind(sucursalId, w.dia.inicio, w.dia.fin)
      .all<{ operador_id: string }>(),
  );
  const setActivos = new Set<string>(activos.results.map((r) => r.operador_id));
  for (const e of eventos.results) setActivos.add(e.operador_id);
  const totalEventos = eventos.results.reduce((s, e) => s + e.n, 0);
  const promedio = totalEventos / Math.max(1, setActivos.size);

  const out: CasoCandidato[] = [];
  for (const e of eventos.results) {
    if (e.n < UMBRAL.CAJON_MIN_EVENTOS) continue;
    if (e.n < UMBRAL.CAJON_RATIO * promedio) continue;
    out.push({
      tipo: "personal",
      indicador: "cajon_sin_venta",
      severidad: e.n >= 3 * promedio ? 3 : 2,
      evidencia: {
        resumen: `${e.operador_nombre}: ${e.n} aperturas sin venta el ${w.diaObjetivo} (promedio de la botica ${promedio.toFixed(1)}).`,
        operador_id: e.operador_id,
        operador_nombre: e.operador_nombre,
        fecha: w.diaObjetivo,
        eventos: e.n,
        promedio_botica: Number(promedio.toFixed(2)),
      },
      claveDedup: `cajon_sin_venta:${e.operador_id}:${w.diaObjetivo}`,
    });
  }
  return out;
}

// (2) Anulaciones (personal): tasa anuladas/ventas del operador ≥ 2× el promedio de la botica en 30 días.
async function indAnulaciones(db: D1Database, sucursalId: string, w: Ventanas): Promise<CasoCandidato[]> {
  const filas = await withRetry(() =>
    db
      .prepare(
        `SELECT v.operador_id AS operador_id, u.nombre AS operador_nombre,
                SUM(CASE WHEN v.estado = 'anulada' THEN 1 ELSE 0 END) AS anuladas, COUNT(*) AS total
         FROM venta v JOIN usuario_perfil u ON u.id = v.operador_id
         WHERE v.sucursal_id = ?1 AND v.fecha_hora >= ?2 AND v.fecha_hora < ?3
         GROUP BY v.operador_id`,
      )
      .bind(sucursalId, w.v30Inicio, w.dia.fin)
      .all<{ operador_id: string; operador_nombre: string; anuladas: number; total: number }>(),
  );
  if (filas.results.length === 0) return [];
  const sumAnul = filas.results.reduce((s, f) => s + f.anuladas, 0);
  const sumTot = filas.results.reduce((s, f) => s + f.total, 0);
  const promTasa = sumTot > 0 ? sumAnul / sumTot : 0;

  const out: CasoCandidato[] = [];
  for (const f of filas.results) {
    if (f.total < UMBRAL.ANUL_MIN_VENTAS) continue;
    const tasa = f.anuladas / f.total;
    if (tasa < UMBRAL.ANUL_PISO_TASA) continue;
    if (tasa < UMBRAL.ANUL_RATIO * promTasa) continue;
    out.push({
      tipo: "personal",
      indicador: "anulaciones",
      severidad: tasa >= 3 * promTasa ? 3 : 2,
      evidencia: {
        resumen: `${f.operador_nombre}: ${f.anuladas} anulaciones de ${f.total} ventas (${(tasa * 100).toFixed(0)}%) vs ${(promTasa * 100).toFixed(0)}% de la botica (30 días).`,
        operador_id: f.operador_id,
        operador_nombre: f.operador_nombre,
        anuladas: f.anuladas,
        ventas: f.total,
        tasa: Number(tasa.toFixed(3)),
        tasa_promedio_botica: Number(promTasa.toFixed(3)),
      },
      claveDedup: `anulaciones:${f.operador_id}:${w.semana}`,
    });
  }
  return out;
}

// (3) Venta bajo precio (personal): líneas cobradas por debajo del precio VIGENTE al momento de la venta.
// Se recomputa contra precio_local (la advertencia del batch de venta NO se persiste en audit_log).
async function indVentaBajoPrecio(db: D1Database, sucursalId: string, w: Ventanas): Promise<CasoCandidato[]> {
  const filas = await withRetry(() =>
    db
      .prepare(
        `SELECT v.id AS venta_id, v.operador_id AS operador_id, u.nombre AS operador_nombre,
                p.nombre AS producto, vi.precio_sin_igv_unitario_dm AS cobrado_dm, pl.precio_sin_igv_dm AS vigente_dm,
                vi.cantidad_presentacion AS cantidad
         FROM venta v
         JOIN usuario_perfil u ON u.id = v.operador_id
         JOIN venta_item vi ON vi.venta_id = v.id
         JOIN producto_catalogo p ON p.id = vi.producto_id
         JOIN precio_local pl ON pl.producto_id = vi.producto_id AND pl.presentacion_id = vi.presentacion_id
              AND pl.sucursal_id = v.sucursal_id
              AND pl.vigente_desde <= v.fecha_hora AND (pl.vigente_hasta IS NULL OR pl.vigente_hasta > v.fecha_hora)
         WHERE v.sucursal_id = ?1 AND v.estado = 'completada' AND v.fecha_hora >= ?2 AND v.fecha_hora < ?3
           AND vi.precio_sin_igv_unitario_dm < pl.precio_sin_igv_dm
         ORDER BY v.operador_id
         LIMIT 500`,
      )
      .bind(sucursalId, w.dia.inicio, w.dia.fin)
      .all<{ venta_id: string; operador_id: string; operador_nombre: string; producto: string; cobrado_dm: number; vigente_dm: number; cantidad: number }>(),
  );
  if (filas.results.length === 0) return [];

  const porOp = new Map<string, { nombre: string; lineas: typeof filas.results; difDm: number }>();
  for (const f of filas.results) {
    const g = porOp.get(f.operador_id) ?? { nombre: f.operador_nombre, lineas: [], difDm: 0 };
    g.lineas.push(f);
    // El precio es POR PRESENTACIÓN → la pérdida de la línea = (vigente − cobrado) × cantidad_presentacion.
    g.difDm += (f.vigente_dm - f.cobrado_dm) * f.cantidad;
    porOp.set(f.operador_id, g);
  }

  const out: CasoCandidato[] = [];
  for (const [operadorId, g] of porOp) {
    if (g.lineas.length < UMBRAL.BAJO_PRECIO_MIN_LINEAS) continue;
    const difCent = Math.round(g.difDm / 100); // dm → céntimos
    out.push({
      tipo: "personal",
      indicador: "venta_bajo_precio",
      severidad: difCent >= 5000 ? 3 : difCent >= 1000 ? 2 : 1,
      evidencia: {
        resumen: `${g.nombre}: ${g.lineas.length} líneas bajo precio el ${w.diaObjetivo} (S/${(difCent / 100).toFixed(2)} por debajo).`,
        operador_id: operadorId,
        operador_nombre: g.nombre,
        lineas: g.lineas.length,
        diferencia_cent: difCent,
        ejemplos: g.lineas.slice(0, 10).map((l) => ({ venta_id: l.venta_id, producto: l.producto, cantidad: l.cantidad, cobrado_dm: l.cobrado_dm, vigente_dm: l.vigente_dm })),
      },
      claveDedup: `venta_bajo_precio:${operadorId}:${w.diaObjetivo}`,
    });
  }
  return out;
}

// (4) Descuadre de caja (pérdida): faltante de efectivo grande en un día, o recurrente en 30 días.
async function indDescuadre(db: D1Database, sucursalId: string, w: Ventanas): Promise<CasoCandidato[]> {
  const filas = await withRetry(() =>
    db
      .prepare(
        `SELECT fecha, diferencia_cent FROM cierre_caja
         WHERE sucursal_id = ?1 AND fecha >= ?2 AND fecha <= ?3 ORDER BY fecha`,
      )
      .bind(sucursalId, w.hace30Fecha, w.diaObjetivo)
      .all<{ fecha: string; diferencia_cent: number }>(),
  );
  if (filas.results.length === 0) return [];
  const out: CasoCandidato[] = [];

  // (a) faltante grande en un solo día → caso inmediato (severidad alta), uno por fecha.
  for (const f of filas.results) {
    if (f.diferencia_cent <= -UMBRAL.DESCUADRE_GRANDE_CENT) {
      out.push({
        tipo: "perdida",
        indicador: "descuadre",
        severidad: 3,
        evidencia: {
          resumen: `Faltante de caja de S/${(Math.abs(f.diferencia_cent) / 100).toFixed(2)} el ${f.fecha}.`,
          fecha: f.fecha,
          diferencia_cent: f.diferencia_cent,
          tipo_descuadre: "grande",
        },
        claveDedup: `descuadre_grande:${f.fecha}`,
      });
    }
  }

  // (b) faltante recurrente: ≥ DESCUADRE_DIAS días con faltante ≥ umbral en la ventana → un caso semanal.
  const diasFaltante = filas.results.filter((f) => f.diferencia_cent <= -UMBRAL.DESCUADRE_UMBRAL_CENT);
  if (diasFaltante.length >= UMBRAL.DESCUADRE_DIAS) {
    const total = diasFaltante.reduce((s, f) => s + f.diferencia_cent, 0);
    out.push({
      tipo: "perdida",
      indicador: "descuadre",
      severidad: 2,
      evidencia: {
        resumen: `${diasFaltante.length} días con faltante de caja en 30 días (total S/${(Math.abs(total) / 100).toFixed(2)}).`,
        dias: diasFaltante.map((f) => ({ fecha: f.fecha, diferencia_cent: f.diferencia_cent })),
        total_cent: total,
        tipo_descuadre: "recurrente",
      },
      claveDedup: `descuadre_recurrente:${w.semana}`,
    });
  }
  return out;
}

// (5) Stock negativo (pérdida): producto por debajo de 0 en el inventario perpetuo (venta sin recepción).
async function indStockNegativo(db: D1Database, sucursalId: string, w: Ventanas): Promise<CasoCandidato[]> {
  const filas = await withRetry(() =>
    db
      .prepare(
        `SELECT il.producto_id AS producto_id, p.nombre AS producto, il.stock_unidades AS stock
         FROM inventario_local il JOIN producto_catalogo p ON p.id = il.producto_id
         WHERE il.sucursal_id = ?1 AND il.stock_unidades < 0
         ORDER BY il.stock_unidades ASC LIMIT 200`,
      )
      .bind(sucursalId)
      .all<{ producto_id: string; producto: string; stock: number }>(),
  );
  return filas.results.map((f) => ({
    tipo: "perdida" as const,
    indicador: "stock_negativo" as const,
    severidad: (Math.abs(f.stock) >= UMBRAL.STOCK_NEG_SEV2_UNIDS ? 2 : 1) as 1 | 2,
    evidencia: {
      resumen: `${f.producto}: stock ${f.stock} (negativo → venta sin recepción registrada).`,
      producto_id: f.producto_id,
      producto: f.producto,
      stock: f.stock,
    },
    claveDedup: `stock_negativo:${f.producto_id}:${w.semana}`,
  }));
}

// (6) Venta fuera de horario (personal): ventas cuya hora Lima cae fuera del horario declarado de la
// sucursal. Se salta si la sucursal no tiene horario cargado (cero falsos positivos).
async function indFueraHorario(db: D1Database, sucursalId: string, w: Ventanas): Promise<CasoCandidato[]> {
  const suc = await withRetry(() =>
    db.prepare(`SELECT hora_apertura, hora_cierre FROM sucursal WHERE id = ?1`).bind(sucursalId).first<{ hora_apertura: string | null; hora_cierre: string | null }>(),
  );
  if (!suc || !suc.hora_apertura || !suc.hora_cierre) return [];

  const filas = await withRetry(() =>
    db
      .prepare(
        `SELECT v.id AS venta_id, v.operador_id AS operador_id, u.nombre AS operador_nombre, v.fecha_hora AS fecha_hora
         FROM venta v JOIN usuario_perfil u ON u.id = v.operador_id
         WHERE v.sucursal_id = ?1 AND v.estado = 'completada' AND v.fecha_hora >= ?2 AND v.fecha_hora < ?3
         LIMIT 1000`,
      )
      .bind(sucursalId, w.dia.inicio, w.dia.fin)
      .all<{ venta_id: string; operador_id: string; operador_nombre: string; fecha_hora: string }>(),
  );

  const porOp = new Map<string, { nombre: string; ventas: { venta_id: string; fecha_hora: string }[] }>();
  for (const f of filas.results) {
    if (!estaFueraDeHorario(f.fecha_hora, suc.hora_apertura, suc.hora_cierre)) continue;
    const g = porOp.get(f.operador_id) ?? { nombre: f.operador_nombre, ventas: [] };
    g.ventas.push({ venta_id: f.venta_id, fecha_hora: f.fecha_hora });
    porOp.set(f.operador_id, g);
  }

  const out: CasoCandidato[] = [];
  for (const [operadorId, g] of porOp) {
    out.push({
      tipo: "personal",
      indicador: "fuera_horario",
      severidad: 1,
      evidencia: {
        resumen: `${g.nombre}: ${g.ventas.length} venta(s) fuera del horario ${suc.hora_apertura}–${suc.hora_cierre} el ${w.diaObjetivo}.`,
        operador_id: operadorId,
        operador_nombre: g.nombre,
        horario: `${suc.hora_apertura}–${suc.hora_cierre}`,
        ventas: g.ventas.slice(0, 20),
        total: g.ventas.length,
      },
      claveDedup: `fuera_horario:${operadorId}:${w.diaObjetivo}`,
    });
  }
  return out;
}

// (7) Merma por conteo (pérdida, P5/C3): la diferencia física del conteo cíclico valorizada. Fuente =
// conteo_sesion/conteo_item (POS puro, jamás audio — VETO D-N5). tipo 'perdida': la merma NO se atribuye
// al operador (un descuadre puede ser recepción mal contada, robo de cliente o vencimiento). Dos formas:
//   (a) material: una sesión con merma valorizada fuerte → un caso por sesión (dedup por sesión);
//   (b) recurrente: un SKU con faltante en ≥N conteos distintos en 30 días → un caso por SKU (dedup semanal).
async function indMermaConteo(db: D1Database, sucursalId: string, w: Ventanas): Promise<CasoCandidato[]> {
  const out: CasoCandidato[] = [];
  const finIso = w.ahoraIso;

  // (a) Sesiones con merma material en la ventana (catch-up de MERMA_VENTANA_DIAS; dedup por sesión).
  const desdeMat = restarMs(finIso, UMBRAL.MERMA_VENTANA_DIAS * 86_400_000);
  const sesiones = await withRetry(() =>
    db
      .prepare(
        `SELECT id, created_at, merma_valor_cent FROM conteo_sesion
         WHERE sucursal_id = ?1 AND created_at >= ?2 AND created_at <= ?3 AND merma_valor_cent <= ?4
         ORDER BY merma_valor_cent ASC LIMIT 50`,
      )
      .bind(sucursalId, desdeMat, finIso, -UMBRAL.MERMA_MATERIAL_CENT)
      .all<{ id: string; created_at: string; merma_valor_cent: number }>(),
  );

  if (sesiones.results.length > 0) {
    const ids = sesiones.results.map((s) => s.id);
    const ph = ids.map((_, i) => `?${i + 1}`).join(",");
    const items = await withRetry(() =>
      db
        .prepare(
          `SELECT ci.conteo_sesion_id AS sesion_id, p.nombre AS producto, ci.diferencia_unidades AS dif, ci.diferencia_valor_cent AS valor
           FROM conteo_item ci JOIN producto_catalogo p ON p.id = ci.producto_id
           WHERE ci.conteo_sesion_id IN (${ph}) AND ci.diferencia_unidades < 0
           ORDER BY ci.diferencia_valor_cent ASC`,
        )
        .bind(...ids)
        .all<{ sesion_id: string; producto: string; dif: number; valor: number }>(),
    );
    const porSesion = new Map<string, { producto: string; dif: number; valor: number }[]>();
    for (const it of items.results) {
      const g = porSesion.get(it.sesion_id) ?? [];
      g.push(it);
      porSesion.set(it.sesion_id, g);
    }
    for (const s of sesiones.results) {
      const faltantes = porSesion.get(s.id) ?? [];
      const mermaCent = Math.abs(s.merma_valor_cent);
      const fecha = fechaLocal("America/Lima", new Date(s.created_at));
      out.push({
        tipo: "perdida",
        indicador: "merma_conteo",
        severidad: mermaCent >= UMBRAL.MERMA_SEV3_CENT ? 3 : 2,
        evidencia: {
          resumen: `Conteo con merma de S/${(mermaCent / 100).toFixed(2)} el ${fecha} (${faltantes.length} producto(s) con faltante).`,
          conteo_sesion_id: s.id,
          fecha,
          merma_cent: s.merma_valor_cent,
          tipo_merma: "material",
          faltantes: faltantes.slice(0, 10).map((f) => ({ producto: f.producto, unidades: f.dif, valor_cent: f.valor })),
        },
        claveDedup: `merma_conteo:${s.id}`,
      });
    }
  }

  // (b) Faltante recurrente por SKU: el mismo producto corto en ≥N conteos distintos de la ventana de 30 días.
  const desdeRec = restarMs(finIso, UMBRAL.MERMA_RECURRENTE_DIAS * 86_400_000);
  const recurrentes = await withRetry(() =>
    db
      .prepare(
        `SELECT ci.producto_id AS producto_id, p.nombre AS producto,
                COUNT(DISTINCT ci.conteo_sesion_id) AS sesiones, SUM(ci.diferencia_valor_cent) AS valor, SUM(ci.diferencia_unidades) AS unidades
         FROM conteo_item ci JOIN conteo_sesion cs ON cs.id = ci.conteo_sesion_id JOIN producto_catalogo p ON p.id = ci.producto_id
         WHERE cs.sucursal_id = ?1 AND ci.created_at >= ?2 AND ci.diferencia_unidades < 0
         GROUP BY ci.producto_id
         HAVING COUNT(DISTINCT ci.conteo_sesion_id) >= ?3
         ORDER BY valor ASC LIMIT 50`,
      )
      .bind(sucursalId, desdeRec, UMBRAL.MERMA_RECURRENTE_SESIONES)
      .all<{ producto_id: string; producto: string; sesiones: number; valor: number; unidades: number }>(),
  );
  for (const r of recurrentes.results) {
    out.push({
      tipo: "perdida",
      indicador: "merma_conteo",
      severidad: 2,
      evidencia: {
        resumen: `${r.producto}: faltante recurrente en ${r.sesiones} conteos (total S/${(Math.abs(r.valor) / 100).toFixed(2)}) en 30 días.`,
        producto_id: r.producto_id,
        producto: r.producto,
        sesiones: r.sesiones,
        unidades: r.unidades,
        valor_cent: r.valor,
        tipo_merma: "recurrente",
      },
      claveDedup: `merma_conteo_recurrente:${r.producto_id}:${w.semana}`,
    });
  }

  return out;
}

// NOTA sobre cajon_sin_venta (ACTIVO desde el botón "🔓 Cajón" del Mostrador → evento_caja 'no_sale'):
//   · 'no_sale' = DECLARACIÓN honesta del operador (abrir para dar vuelto/revisar) → detecta frecuencia
//     anómala de aperturas declaradas. NO es fraude-proof: un operador deshonesto simplemente no lo pulsa.
//   · La señal fraude-proof es 'apertura_sin_venta' = el sensor FÍSICO del cajón/impresora (T-K1), que el
//     operador no puede evitar. Este indicador YA filtra ambos tipos, así que entra sola cuando llegue T-K1.
// Indicador ACTIVO desde P5:
//   · merma_conteo: la diferencia física del conteo cíclico (C3) valorizada → caso 'perdida' (arriba, ind 7).
// Indicador DIFERIDO por falta de fuente (documentado, corre y devuelve [] hasta que exista):
//   · ticket_sin_impresion: depende de eventos de impresión (T-K1, impresora física) → se activa con T-K1.

// ============================================================
// Motor + barredora del Cron + bandeja
// ============================================================

// Los indicadores DIARIOS se reevalúan para los últimos N días cerrados: si el Cron se saltó una noche
// (Cron Triggers de Cloudflare son best-effort), la corrida siguiente recupera el día perdido. La
// clave_dedup incluye el día → reprocesar es idempotente (INSERT OR IGNORE). Los de 30 días / snapshot
// se auto-recuperan al re-consultar su ventana, así que corren una sola vez (offset 0).
const DIAS_REZAGO = 2;

// Evalúa TODOS los indicadores de UNA sucursal y persiste los casos nuevos (idempotente por clave_dedup).
export async function evaluarCasosSucursal(
  db: D1Database,
  sucursalId: string,
  ahoraIso: string,
): Promise<{ creados: number; omitidos: number }> {
  const w0 = ventanas(ahoraIso, 0);
  const tareas: Promise<CasoCandidato[]>[] = [
    indAnulaciones(db, sucursalId, w0),
    indDescuadre(db, sucursalId, w0),
    indStockNegativo(db, sucursalId, w0),
    indMermaConteo(db, sucursalId, w0), // P5/C3: la merma del conteo cíclico se autorecupera por ventana (dedup por sesión)
  ];
  for (let off = 0; off < DIAS_REZAGO; off++) {
    const w = ventanas(ahoraIso, off);
    tareas.push(indCajonSinVenta(db, sucursalId, w), indVentaBajoPrecio(db, sucursalId, w), indFueraHorario(db, sucursalId, w));
  }
  const grupos = await Promise.all(tareas);
  const candidatos = grupos.flat().sort((a, b) => b.severidad - a.severidad); // más severos primero (tope)
  if (candidatos.length === 0) return { creados: 0, omitidos: 0 };

  // El tope anti-fatiga debe reservar cupos a casos NUEVOS. Cada indicador re-genera sus candidatos desde
  // las tablas fuente cada noche, así que un candidato que YA tiene caso NO debe consumir presupuesto y
  // hambrear a uno nuevo de menor severidad (para merma_conteo, con ventana dura de 3 días, ese hambreo =
  // pérdida permanente). Pre-filtramos los clave_dedup ya persistidos (en trozos ≤99 binds + sucursal).
  const claves = candidatos.map((c) => c.claveDedup);
  const existentes = new Set<string>();
  for (let i = 0; i < claves.length; i += 90) {
    const grupo = claves.slice(i, i + 90);
    const ph = grupo.map((_, j) => `?${j + 2}`).join(",");
    const r = await withRetry(() =>
      db.prepare(`SELECT clave_dedup FROM caso WHERE sucursal_id = ?1 AND clave_dedup IN (${ph})`).bind(sucursalId, ...grupo).all<{ clave_dedup: string }>(),
    );
    for (const row of r.results) existentes.add(row.clave_dedup);
  }
  const nuevos = candidatos.filter((c) => !existentes.has(c.claveDedup));
  const aInsertar = nuevos.slice(0, UMBRAL.TOPE_POR_CORRIDA);
  const omitidos = nuevos.length - aInsertar.length; // casos NUEVOS que el tope dejó fuera (anti-fatiga real)
  if (aInsertar.length === 0) return { creados: 0, omitidos };

  const stmts = aInsertar.map((c) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO caso (id, sucursal_id, tipo, indicador, severidad, evidencia_json, estado, clave_dedup, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'abierto', ?7, ?8)`,
      )
      .bind(uuidv7(), sucursalId, c.tipo, c.indicador, c.severidad, JSON.stringify(c.evidencia), c.claveDedup, ahoraIso),
  );
  const res = await withRetry(() => db.batch(stmts));
  const creados = res.reduce((s, r) => s + (r.meta?.changes ?? 0), 0);
  return { creados, omitidos };
}

// Entrada del Cron nocturno (la invoca worker.ts). env.DB se toca AQUÍ (repos/), nunca en worker.ts.
// (1) autocierra los casos 'abierto' > 14 días; (2) evalúa cada sucursal activa de todos los tenants.
export async function barrerCasos(env: Bindings, ahoraIso = new Date().toISOString()): Promise<{ sucursales: number; creados: number; autocerrados: number; omitidos: number }> {
  const db = env.DB;
  const cutoff = restarMs(ahoraIso, UMBRAL.AUTOCIERRE_DIAS * 86_400_000);
  const auto = await withRetry(() =>
    db
      .prepare(`UPDATE caso SET estado = 'autocerrado', resuelto_at = ?1 WHERE estado = 'abierto' AND created_at < ?2`)
      .bind(ahoraIso, cutoff)
      .run(),
  );
  const sucs = await withRetry(() =>
    db.prepare(`SELECT id FROM sucursal WHERE activa = 1 AND deleted_at IS NULL`).all<{ id: string }>(),
  );
  let creados = 0;
  let omitidos = 0;
  for (const s of sucs.results) {
    const r = await evaluarCasosSucursal(db, s.id, ahoraIso);
    creados += r.creados;
    omitidos += r.omitidos;
  }
  // Anti-fatiga nunca silencioso: si el tope dejó casos NUEVOS fuera, queda en el log del Cron (wrangler tail).
  if (omitidos > 0) console.warn(`[EBR] ${omitidos} caso(s) nuevo(s) omitido(s) por el tope anti-fatiga (${UMBRAL.TOPE_POR_CORRIDA}/corrida).`);
  return { sucursales: sucs.results.length, creados, autocerrados: auto.meta?.changes ?? 0, omitidos };
}

// ---- Bandeja (admin ve SU sucursal; super elige una, verificada aparte por la ruta) ----

export type CasoFila = {
  id: string;
  sucursal_id: string;
  tipo: string;
  indicador: string;
  severidad: number;
  estado: string;
  evidencia: Record<string, unknown>;
  revisor_id: string | null;
  notas: string | null;
  created_at: string;
  resuelto_at: string | null;
};

export function casosRepo(db: D1Database) {
  return {
    // Lista los casos de la sucursal. `estado`: 'abierto' (default) | un estado | 'resueltos' (los tres
    // terminales) | null ('todos'). Orden: severidad↓, recientes↓. El filtro es aditivo (no rompe nada).
    async listar(sucursalId: string, estado: string | null = "abierto"): Promise<CasoFila[]> {
      const COLS = `id, sucursal_id, tipo, indicador, severidad, estado, evidencia_json, revisor_id, notas, created_at, resuelto_at`;
      let stmt: D1PreparedStatement;
      if (estado === "resueltos") {
        stmt = db.prepare(`SELECT ${COLS} FROM caso WHERE sucursal_id = ?1 AND estado IN ('confirmado','descartado','autocerrado') ORDER BY severidad DESC, created_at DESC LIMIT 200`).bind(sucursalId);
      } else if (estado) {
        stmt = db.prepare(`SELECT ${COLS} FROM caso WHERE sucursal_id = ?1 AND estado = ?2 ORDER BY severidad DESC, created_at DESC LIMIT 200`).bind(sucursalId, estado);
      } else {
        stmt = db.prepare(`SELECT ${COLS} FROM caso WHERE sucursal_id = ?1 ORDER BY severidad DESC, created_at DESC LIMIT 200`).bind(sucursalId);
      }
      const r = await withRetry(() => stmt.all<Record<string, unknown>>());
      return r.results.map((row) => {
        const { evidencia_json, ...resto } = row as Record<string, unknown> & { evidencia_json: string };
        let evidencia: Record<string, unknown> = {};
        try {
          evidencia = JSON.parse(evidencia_json) as Record<string, unknown>;
        } catch {
          evidencia = { resumen: "(evidencia ilegible)" };
        }
        return { ...(resto as unknown as Omit<CasoFila, "evidencia">), evidencia };
      });
    },

    // Conteo por estado (para el badge de la bandeja).
    async conteoAbiertos(sucursalId: string): Promise<number> {
      const r = await withRetry(() =>
        db.prepare(`SELECT COUNT(*) AS n FROM caso WHERE sucursal_id = ?1 AND estado = 'abierto'`).bind(sucursalId).first<{ n: number }>(),
      );
      return r?.n ?? 0;
    },

    // { abiertos, resueltos } de la sucursal (para las pestañas de la bandeja). Resueltos = los tres terminales.
    async contar(sucursalId: string): Promise<{ abiertos: number; resueltos: number }> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT
               SUM(CASE WHEN estado = 'abierto' THEN 1 ELSE 0 END) AS abiertos,
               SUM(CASE WHEN estado IN ('confirmado','descartado','autocerrado') THEN 1 ELSE 0 END) AS resueltos
             FROM caso WHERE sucursal_id = ?1`,
          )
          .bind(sucursalId)
          .first<{ abiertos: number | null; resueltos: number | null }>(),
      );
      return { abiertos: r?.abiertos ?? 0, resueltos: r?.resueltos ?? 0 };
    },

    // Reabrir un caso resuelto → vuelve a 'abierto' y limpia revisor/nota/resuelto_at. Idempotente
    // (si ya está 'abierto', no cambia nada). El caso DEBE ser de la sucursal indicada (aislamiento).
    // No hay columna reabierto_at (sin migración) → no se sella el tiempo de reapertura.
    async reabrir(id: string, sucursalId: string): Promise<void> {
      const fila = await withRetry(() =>
        db.prepare(`SELECT id FROM caso WHERE id = ?1 AND sucursal_id = ?2`).bind(id, sucursalId).first<{ id: string }>(),
      );
      if (!fila) throw noEncontrado("caso");
      await withRetry(() =>
        db
          .prepare(`UPDATE caso SET estado = 'abierto', revisor_id = NULL, notas = NULL, resuelto_at = NULL WHERE id = ?1 AND sucursal_id = ?2`)
          .bind(id, sucursalId)
          .run(),
      );
    },

    // Resolver un caso (confirmar o descartar). El caso DEBE ser de la sucursal indicada (aislamiento).
    async resolver(
      id: string,
      sucursalId: string,
      input: { estado: "confirmado" | "descartado"; revisorId: string | null; notas: string | null; nowIso: string },
    ): Promise<void> {
      if (input.estado !== "confirmado" && input.estado !== "descartado") throw validacion("estado inválido");
      const fila = await withRetry(() =>
        db.prepare(`SELECT id FROM caso WHERE id = ?1 AND sucursal_id = ?2`).bind(id, sucursalId).first<{ id: string }>(),
      );
      if (!fila) throw noEncontrado("caso");
      await withRetry(() =>
        db
          .prepare(`UPDATE caso SET estado = ?3, revisor_id = ?4, notas = ?5, resuelto_at = ?6 WHERE id = ?1 AND sucursal_id = ?2`)
          .bind(id, sucursalId, input.estado, input.revisorId, input.notas, input.nowIso)
          .run(),
      );
    },
  };
}
