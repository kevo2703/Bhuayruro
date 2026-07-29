import {
  DIAS_AVISO_DEFAULT,
  DIAS_AVISO_MAX,
  DIAS_AVISO_MIN,
  MAX_ATRASO_DIAS,
  MAX_DIAS_TRATAMIENTO,
  diasEntre,
  enlaceWhatsapp,
  mensajeReposicion,
  uuidv7,
  type ItemReposicion,
} from "@huayruro/shared";
import { noEncontrado, validacion } from "../lib/errores";
import type { Actor } from "../types";
import { withRetry } from "./base";

// ============================================================
// A2 v1 — Bandeja de reposición de crónicos (plan de expansión §2 A2).
//
// QUÉ RESPONDE: "¿a quién se le está por acabar su medicina?". Sale de dos fuentes, y la de arriba
// es la que le da volumen real:
//   1. VENTAS de productos marcados como crónicos (Δ4): unidades vendidas ÷ dosis diaria. No exige
//      que nadie tipee nada en el mostrador — con marcar el SKU una vez, la bandeja se llena sola.
//   2. SEGUIMIENTOS escritos a mano (S14): lo que quien atiende registró para esa persona.
// Si las dos hablan del mismo cliente y el mismo producto, manda el SEGUIMIENTO: alguien lo escribió
// a propósito, con la duración que le dijo el paciente. Sin este desempate la señora saldría dos
// veces en la lista y recibiría dos mensajes iguales.
//
// AISLAMIENTO: es POR BOTICA. El padrón (`cliente`) es por sucursal y las ventas también; toda
// consulta de acá filtra `sucursal_id`, y las referencias que llegan para marcar "ya le escribí" se
// verifican contra la botica ANTES de escribir. Un id adivinado de otra botica es 404.
//
// OPT-IN: solo entra a la lista quien ACEPTÓ que le escriban (`optin_whatsapp = 1`) y tiene un número
// utilizable. A los demás no se les arma enlace ni se muestra su teléfono: se cuentan aparte, para que
// la botica sepa que existe gente a la que le toca y a la que hay que pedirle permiso la próxima vez.
//
// LA V1 NO ENVÍA NADA. Genera el texto y el enlace `wa.me`; una persona decide y manda desde el
// WhatsApp de la botica. El envío automático es P4b y su gate es la tasa de respuesta de esto.
// ============================================================

const MOTIVO = "reposicion";
const MAX_REFERENCIAS = 20;
const MAX_FILAS = 200;

// El día de Lima a partir de un timestamp ISO-UTC. Perú es UTC-5 fijo (sin horario de verano), así
// que `-5 hours` alcanza. Sin esto, una venta de las 9 de la noche contaría como del día siguiente y
// el aviso saldría un día tarde.
const FECHA_LIMA = (col: string) => `date(${col}, '-5 hours')`;

// Duración efectiva de un seguimiento: la escrita, o la deducida de cuánto se dispensó y cuánto toma
// por día. Misma expresión que usa el panel de Seguimiento (repos/clientes.ts) — a propósito: las dos
// pantallas tienen que decir la misma fecha.
const DIAS_TRATAMIENTO = `COALESCE(t.duracion_dias, CAST(t.cantidad_dispensada / NULLIF(t.dosis_diaria, 0) AS INTEGER))`;

export type ReferenciaTipo = "venta_item" | "tratamiento";

export type ItemBandeja = ItemReposicion & {
  referencia_tipo: ReferenciaTipo;
  referencia_id: string;
  producto_id: string | null;
  dias_restantes: number; // negativo = ya se le acabó y nadie le escribió
  cantidad: number | null;
  dosis_diaria: number | null;
};

export type FilaBandeja = {
  cliente_id: string;
  cliente_nombre: string;
  dias_restantes: number; // el del ítem más urgente (ordena la lista)
  enlace: string;
  mensaje: string;
  items: ItemBandeja[];
};

export type ContactadoFila = {
  cliente_id: string;
  cliente_nombre: string;
  productos: string[];
  enviado_at: string;
  operador_nombre: string | null;
  envio_ids: string[];
};

export type Bandeja = {
  hoy: string;
  dias: number;
  filas: FilaBandeja[];
  sin_permiso: number; // les toca reponer pero nunca aceptaron que les escriban
  sin_numero: number; // aceptaron, pero el número que hay no sirve para armar un enlace
  cronicos_marcados: number; // 0 = la bandeja no puede tener contenido todavía (T-K10)
  ya_contactados: ContactadoFila[];
};

/** Fila cruda de cualquiera de las dos fuentes, antes de agrupar por persona. */
type Candidato = {
  cliente_id: string;
  cliente_nombre: string;
  optin_whatsapp: number;
  whatsapp: string | null;
  telefono: string | null;
  producto_id: string | null;
  producto_nombre: string;
  fecha_compra: string | null;
  fecha_agotamiento: string;
  cantidad: number | null;
  dosis_diaria: number | null;
  referencia_id: string;
};

export function reposicionesRepo(db: D1Database, actor: Actor) {
  const tid = actor.tenantId;

  /** Nombre con el que se presenta la botica en el mensaje ("Le escribo de …"). */
  async function nombreBotica(): Promise<string | null> {
    const r = await withRetry(() =>
      db.prepare(`SELECT nombre_comercial, nombre FROM tenant WHERE id = ?1`).bind(tid).first<{ nombre_comercial: string | null; nombre: string }>(),
    );
    return r?.nombre_comercial?.trim() || r?.nombre?.trim() || null;
  }

  async function exigirCliente(clienteId: string, sucursalId: string): Promise<void> {
    const r = await withRetry(() =>
      db.prepare(`SELECT id FROM cliente WHERE id = ?1 AND sucursal_id = ?2 AND deleted_at IS NULL`).bind(clienteId, sucursalId).first<{ id: string }>(),
    );
    if (!r) throw noEncontrado("cliente");
  }

  return {
    /**
     * La lista del día: quien tiene ≤ `dias` de tratamiento por delante, MÁS los que ya se les acabó
     * y nunca fueron contactados (hasta `MAX_ATRASO_DIAS` atrás). Los atrasados van primero: si la
     * bandeja no se miró ayer, esa gente no puede desaparecer sola.
     */
    async bandeja(sucursalId: string, opts: { hoyYmd: string; horaLima: number; dias?: number | undefined }): Promise<Bandeja> {
      const dias = Math.min(Math.max(Math.trunc(opts.dias ?? DIAS_AVISO_DEFAULT) || DIAS_AVISO_DEFAULT, DIAS_AVISO_MIN), DIAS_AVISO_MAX);
      const hoy = opts.hoyYmd;

      const [porVenta, porTratamiento, marcados, contactados, botica] = await Promise.all([
        // --- Fuente 1: la ÚLTIMA venta de cada (cliente, producto crónico) de esta botica ---
        // Se agrupa por venta+producto antes de rankear porque una misma venta puede traer dos líneas
        // del mismo producto (unidad y blíster, Δ1): sumarlas es la cantidad que se llevó de verdad.
        withRetry(() =>
          db
            .prepare(
              `WITH lineas AS (
                 SELECT v.id AS venta_id, v.cliente_id, vi.producto_id,
                        ${FECHA_LIMA("v.fecha_hora")} AS fecha_compra,
                        SUM(vi.cantidad) AS cantidad,
                        MIN(vi.id) AS referencia_id,
                        p.dosis_diaria_default AS dosis_diaria,
                        p.nombre AS producto_nombre
                 FROM venta v
                 JOIN venta_item vi ON vi.venta_id = v.id
                 JOIN producto_catalogo p ON p.id = vi.producto_id
                 WHERE v.sucursal_id = ?1
                   AND v.estado = 'completada'
                   AND v.cliente_id IS NOT NULL
                   AND v.fecha_hora >= ?2
                   AND p.tenant_id = ?3
                   AND p.es_cronico = 1
                   AND COALESCE(p.dosis_diaria_default, 0) > 0
                   AND p.deleted_at IS NULL
                 GROUP BY v.id, v.cliente_id, vi.producto_id
               ),
               ult AS (
                 SELECT *, ROW_NUMBER() OVER (PARTITION BY cliente_id, producto_id ORDER BY fecha_compra DESC, venta_id DESC) AS rn
                 FROM lineas
               )
               SELECT u.cliente_id, c.nombre AS cliente_nombre, c.optin_whatsapp, c.whatsapp, c.telefono,
                      u.producto_id, u.producto_nombre, u.fecha_compra, u.cantidad, u.dosis_diaria, u.referencia_id,
                      date(u.fecha_compra, '+' || CAST(u.cantidad / u.dosis_diaria AS INTEGER) || ' days') AS fecha_agotamiento
                 FROM ult u
                 JOIN cliente c ON c.id = u.cliente_id AND c.sucursal_id = ?1 AND c.deleted_at IS NULL
                WHERE u.rn = 1
                  AND (u.cantidad / u.dosis_diaria) <= ?7
                  AND date(u.fecha_compra, '+' || CAST(u.cantidad / u.dosis_diaria AS INTEGER) || ' days') <= date(?4, '+' || ?5 || ' days')
                  AND date(u.fecha_compra, '+' || CAST(u.cantidad / u.dosis_diaria AS INTEGER) || ' days') >= date(?4, '-' || ?6 || ' days')
                  AND NOT EXISTS (
                        SELECT 1 FROM envio_whatsapp e
                         WHERE e.cliente_id = u.cliente_id AND e.motivo = '${MOTIVO}'
                           AND e.referencia_tipo = 'venta_item' AND e.referencia_id = u.referencia_id)
                ORDER BY fecha_agotamiento
                LIMIT ${MAX_FILAS}`,
            )
            .bind(sucursalId, cortePorVentas(hoy), tid, hoy, dias, MAX_ATRASO_DIAS, MAX_DIAS_TRATAMIENTO)
            .all<Candidato>(),
        ),

        // --- Fuente 2: los seguimientos que alguien escribió a mano en el mostrador ---
        withRetry(() =>
          db
            .prepare(
              `SELECT t.id AS referencia_id, t.cliente_id, c.nombre AS cliente_nombre, c.optin_whatsapp, c.whatsapp, c.telefono,
                      t.producto_id, COALESCE(p.nombre, t.descripcion) AS producto_nombre,
                      NULL AS fecha_compra, t.cantidad_dispensada AS cantidad, t.dosis_diaria,
                      date(t.fecha_inicio, '+' || ${DIAS_TRATAMIENTO} || ' days') AS fecha_agotamiento
                 FROM tratamiento t
                 JOIN cliente c ON c.id = t.cliente_id AND c.sucursal_id = ?1 AND c.deleted_at IS NULL
                 LEFT JOIN producto_catalogo p ON p.id = t.producto_id
                WHERE t.estado = 'activo'
                  AND ${DIAS_TRATAMIENTO} IS NOT NULL
                  AND ${DIAS_TRATAMIENTO} BETWEEN 0 AND ?5
                  AND date(t.fecha_inicio, '+' || ${DIAS_TRATAMIENTO} || ' days') <= date(?2, '+' || ?3 || ' days')
                  AND date(t.fecha_inicio, '+' || ${DIAS_TRATAMIENTO} || ' days') >= date(?2, '-' || ?4 || ' days')
                  AND NOT EXISTS (
                        SELECT 1 FROM envio_whatsapp e
                         WHERE e.cliente_id = t.cliente_id AND e.motivo = '${MOTIVO}'
                           AND e.referencia_tipo = 'tratamiento' AND e.referencia_id = t.id)
                ORDER BY fecha_agotamiento
                LIMIT ${MAX_FILAS}`,
            )
            .bind(sucursalId, hoy, dias, MAX_ATRASO_DIAS, MAX_DIAS_TRATAMIENTO)
            .all<Candidato>(),
        ),

        withRetry(() =>
          db
            .prepare(`SELECT COUNT(*) AS n FROM producto_catalogo WHERE tenant_id = ?1 AND es_cronico = 1 AND deleted_at IS NULL`)
            .bind(tid)
            .first<{ n: number }>(),
        ),

        this.contactadosHoy(sucursalId, hoy),
        nombreBotica(),
      ]);

      const tratamientos = porTratamiento.results ?? [];
      // Desempate entre fuentes: si hay seguimiento escrito para ese cliente y ese producto, la venta
      // no vuelve a decir lo mismo.
      const cubiertos = new Set(tratamientos.filter((t) => t.producto_id).map((t) => `${t.cliente_id}|${t.producto_id}`));
      const crudos = [
        ...tratamientos.map((c) => ({ c, tipo: "tratamiento" as ReferenciaTipo })),
        ...(porVenta.results ?? [])
          .filter((c) => !cubiertos.has(`${c.cliente_id}|${c.producto_id}`))
          .map((c) => ({ c, tipo: "venta_item" as ReferenciaTipo })),
      ];

      let sinPermiso = 0;
      let sinNumero = 0;
      const porCliente = new Map<string, { nombre: string; numero: string; items: ItemBandeja[] }>();

      for (const { c, tipo } of crudos) {
        if (c.optin_whatsapp !== 1) {
          sinPermiso++;
          continue;
        }
        const numero = c.whatsapp?.trim() || c.telefono?.trim() || "";
        if (!enlaceWhatsapp(numero)) {
          sinNumero++;
          continue;
        }
        const item: ItemBandeja = {
          referencia_tipo: tipo,
          referencia_id: c.referencia_id,
          producto_id: c.producto_id,
          producto_nombre: c.producto_nombre,
          fecha_compra: c.fecha_compra,
          fecha_agotamiento: c.fecha_agotamiento,
          dias_restantes: diasEntre(hoy, c.fecha_agotamiento) ?? 0,
          cantidad: c.cantidad,
          dosis_diaria: c.dosis_diaria,
        };
        const actualCliente = porCliente.get(c.cliente_id);
        if (actualCliente) actualCliente.items.push(item);
        else porCliente.set(c.cliente_id, { nombre: c.cliente_nombre, numero, items: [item] });
      }

      const filas: FilaBandeja[] = [];
      for (const [clienteId, datos] of porCliente) {
        // Una persona con dos tratamientos recibe UN mensaje con los dos, no dos mensajes.
        datos.items.sort((a, b) => a.fecha_agotamiento.localeCompare(b.fecha_agotamiento));
        const mensaje = mensajeReposicion({
          nombreCliente: datos.nombre,
          botica,
          items: datos.items,
          hoyYmd: hoy,
          horaLima: opts.horaLima,
        });
        const enlace = enlaceWhatsapp(datos.numero, mensaje);
        if (!enlace) continue; // ya se filtró arriba; el chequeo cierra el tipo sin inventar un enlace
        filas.push({
          cliente_id: clienteId,
          cliente_nombre: datos.nombre,
          dias_restantes: datos.items[0]?.dias_restantes ?? 0,
          enlace,
          mensaje,
          items: datos.items,
        });
      }
      filas.sort((a, b) => a.dias_restantes - b.dias_restantes || a.cliente_nombre.localeCompare(b.cliente_nombre));

      return {
        hoy,
        dias,
        filas,
        sin_permiso: sinPermiso,
        sin_numero: sinNumero,
        cronicos_marcados: marcados?.n ?? 0,
        ya_contactados: contactados,
      };
    },

    /**
     * Deja constancia de que a esta persona ya se le escribió por estos avisos. No prueba que el
     * mensaje se haya enviado (eso pasa dentro de WhatsApp, fuera del sistema): prueba que alguien
     * se hizo cargo. Con eso alcanza para que no le llegue dos veces.
     *
     * Las referencias se verifican contra la botica: sin esto, un id de venta de otra sucursal
     * dejaría un registro cruzado y sacaría de la bandeja ajena a un cliente al que nadie escribió.
     */
    async marcarContactado(
      sucursalId: string,
      datos: {
        clienteId: string;
        referencias: { tipo: ReferenciaTipo; id: string }[];
        mensaje?: string | null;
        operadorId: string | null;
        nowIso: string;
      },
    ): Promise<{ registrados: number }> {
      const refs = (datos.referencias ?? []).filter((r) => (r?.tipo === "venta_item" || r?.tipo === "tratamiento") && typeof r.id === "string" && r.id.trim() !== "");
      if (refs.length === 0) throw validacion("referencias requeridas (tipo, id)");
      if (refs.length > MAX_REFERENCIAS) throw validacion(`máximo ${MAX_REFERENCIAS} avisos por persona`);
      await exigirCliente(datos.clienteId, sucursalId);

      const idsVenta = refs.filter((r) => r.tipo === "venta_item").map((r) => r.id);
      const idsTrat = refs.filter((r) => r.tipo === "tratamiento").map((r) => r.id);

      // `producto_id` sale de la BASE, nunca del body: es lo que se va a mostrar en "ya le escribí".
      const validas: { tipo: ReferenciaTipo; id: string; producto_id: string | null }[] = [];
      if (idsVenta.length > 0) {
        const marcadores = idsVenta.map((_, i) => `?${i + 3}`).join(", ");
        const r = await withRetry(() =>
          db
            .prepare(
              `SELECT vi.id, vi.producto_id
                 FROM venta_item vi JOIN venta v ON v.id = vi.venta_id
                WHERE v.sucursal_id = ?1 AND v.cliente_id = ?2 AND vi.id IN (${marcadores})`,
            )
            .bind(sucursalId, datos.clienteId, ...idsVenta)
            .all<{ id: string; producto_id: string }>(),
        );
        for (const f of r.results ?? []) validas.push({ tipo: "venta_item", id: f.id, producto_id: f.producto_id });
      }
      if (idsTrat.length > 0) {
        const marcadores = idsTrat.map((_, i) => `?${i + 3}`).join(", ");
        const r = await withRetry(() =>
          db
            .prepare(
              `SELECT t.id, t.producto_id
                 FROM tratamiento t JOIN cliente c ON c.id = t.cliente_id
                WHERE c.sucursal_id = ?1 AND t.cliente_id = ?2 AND t.id IN (${marcadores})`,
            )
            .bind(sucursalId, datos.clienteId, ...idsTrat)
            .all<{ id: string; producto_id: string | null }>(),
        );
        for (const f of r.results ?? []) validas.push({ tipo: "tratamiento", id: f.id, producto_id: f.producto_id });
      }
      if (validas.length === 0) throw noEncontrado("aviso");

      const mensaje = datos.mensaje?.trim() || null;
      await withRetry(() =>
        db.batch(
          validas.map((v) =>
            db
              .prepare(
                `INSERT INTO envio_whatsapp (id, sucursal_id, cliente_id, motivo, origen, referencia_tipo, referencia_id, producto_id, mensaje, enviado_at, operador_id, created_at)
                 VALUES (?1, ?2, ?3, '${MOTIVO}', 'asistido', ?4, ?5, ?6, ?7, ?8, ?9, ?8)
                 ON CONFLICT DO NOTHING`,
              )
              .bind(uuidv7(), sucursalId, datos.clienteId, v.tipo, v.id, v.producto_id, mensaje, datos.nowIso, datos.operadorId),
          ),
        ),
      );
      return { registrados: validas.length };
    },

    /** A quién se le escribió hoy (con qué producto y quién lo marcó), para poder deshacer un tap mal dado. */
    async contactadosHoy(sucursalId: string, hoyYmd: string): Promise<ContactadoFila[]> {
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT e.id, e.cliente_id, c.nombre AS cliente_nombre, e.enviado_at,
                    COALESCE(p.nombre, '—') AS producto_nombre, u.nombre AS operador_nombre
               FROM envio_whatsapp e
               JOIN cliente c ON c.id = e.cliente_id
               LEFT JOIN producto_catalogo p ON p.id = e.producto_id
               LEFT JOIN usuario_perfil u ON u.id = e.operador_id
              WHERE e.sucursal_id = ?1 AND e.motivo = '${MOTIVO}' AND ${FECHA_LIMA("e.enviado_at")} = ?2
              ORDER BY e.enviado_at DESC
              LIMIT ${MAX_FILAS}`,
          )
          .bind(sucursalId, hoyYmd)
          .all<{ id: string; cliente_id: string; cliente_nombre: string; enviado_at: string; producto_nombre: string; operador_nombre: string | null }>(),
      );

      const porCliente = new Map<string, ContactadoFila>();
      for (const f of r.results ?? []) {
        const actualFila = porCliente.get(f.cliente_id);
        if (actualFila) {
          actualFila.productos.push(f.producto_nombre);
          actualFila.envio_ids.push(f.id);
        } else {
          porCliente.set(f.cliente_id, {
            cliente_id: f.cliente_id,
            cliente_nombre: f.cliente_nombre,
            productos: [f.producto_nombre],
            enviado_at: f.enviado_at,
            operador_nombre: f.operador_nombre,
            envio_ids: [f.id],
          });
        }
      }
      return [...porCliente.values()];
    },

    /**
     * Deshacer el "ya le escribí": la persona vuelve a la bandeja de mañana. Existe porque el botón
     * está al lado del enlace y un tap de más, sin esto, borraría a alguien de la lista para siempre.
     */
    async deshacer(sucursalId: string, envioIds: string[]): Promise<{ borrados: number }> {
      const ids = (envioIds ?? []).filter((x) => typeof x === "string" && x.trim() !== "").slice(0, MAX_REFERENCIAS);
      if (ids.length === 0) throw validacion("ids requeridos");
      const marcadores = ids.map((_, i) => `?${i + 2}`).join(", ");
      const r = await withRetry(() =>
        db
          .prepare(`DELETE FROM envio_whatsapp WHERE sucursal_id = ?1 AND motivo = '${MOTIVO}' AND id IN (${marcadores})`)
          .bind(sucursalId, ...ids)
          .run(),
      );
      const borrados = r.meta?.changes ?? 0;
      if (borrados === 0) throw noEncontrado("registro");
      return { borrados };
    },
  };
}

/** Ventana de ventas que se mira hacia atrás: nada anterior puede seguir vigente hoy. */
function cortePorVentas(hoyYmd: string): string {
  const base = Date.parse(`${hoyYmd}T12:00:00.000Z`);
  const dias = MAX_DIAS_TRATAMIENTO + MAX_ATRASO_DIAS;
  return Number.isNaN(base) ? "1970-01-01T00:00:00.000Z" : new Date(base - dias * 86_400_000).toISOString();
}
