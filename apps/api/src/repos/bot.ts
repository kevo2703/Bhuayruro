// Orquestador del bot de Telegram de inventario — B9 (§7.1/§7.2). Aquí vive TODO el SQL del bot y
// el pegamento entre Telegram, la máquina de estados pura (@huayruro/shared) y la visión (lib/vision).
//
// Seguridad (§7.1), horneada:
//   • Allowlist DURA: solo un chat vinculado (bot_chat.usuario_id) recibe respuesta; cualquier otro
//     chat → SILENCIO total (devuelve null → el webhook responde 200 vacío, ni "no autorizado").
//   • Vinculación por código de 6 dígitos que el admin genera en la web (expira 10 min).
//   • Idempotencia por update_id de Telegram (reintentos reenvían el mismo id).
//   • El bot NUNCA devuelve datos del sistema (precios/stock): solo conduce el alta.

import {
  avanzar,
  parseComando,
  PISTA_LOTE,
  PROMPT_PRODUCTO,
  uuidv7,
  type BorradorBot,
  type BotonInline,
  type EntradaBot,
  type EstadoBot,
  type Respuesta,
} from "@huayruro/shared";
import { descargarFoto, ocrLote, ocrProducto, UMBRAL_OCR } from "../lib/vision";
import type { Bindings } from "../types";
import { maestroRepo } from "./maestro";
import { withRetry } from "./base";

// ── Tipos mínimos del Update de Telegram (verificados contra core.telegram.org/bots/api) ──
type TgUser = { id: number; first_name?: string };
type TgChat = { id: number; type?: string };
type TgPhoto = { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number };
type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; text?: string; photo?: TgPhoto[] };
type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string };
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };

// Respuesta del webhook = un método de la Bot API en el cuerpo (Telegram lo ejecuta). null = silencio.
export type MetodoTelegram = { method: "sendMessage"; chat_id: string; text: string; reply_markup?: unknown };

type FilaChat = {
  chat_id: string;
  tenant_id: string | null;
  usuario_id: string | null;
  sucursal_id: string | null;
  estado: EstadoBot;
  borrador_json: string;
  ultimo_producto_json: string | null;
  ultimo_update_id: number;
};

// Construye el método sendMessage. Sin parse_mode (evita que un nombre con símbolos rompa el envío):
// se quitan los marcadores '*' que la conversación usa para énfasis.
function enviar(chatId: string, respuesta: Respuesta): MetodoTelegram {
  const text = respuesta.texto.replace(/\*/g, "");
  const reply_markup = respuesta.botones
    ? { inline_keyboard: respuesta.botones.map((fila: BotonInline[]) => fila.map((b) => ({ text: b.texto, callback_data: b.data }))) }
    : undefined;
  return { method: "sendMessage", chat_id: chatId, text, reply_markup };
}
const msg = (chatId: string, texto: string): MetodoTelegram => enviar(chatId, { texto });

const parseBorrador = (s: string | null): BorradorBot => {
  try {
    return s ? (JSON.parse(s) as BorradorBot) : {};
  } catch {
    return {};
  }
};

export function botRepo(db: D1Database, env: Bindings) {
  const chatPorId = (chatId: string) =>
    withRetry(() =>
      db
        .prepare(
          `SELECT chat_id, tenant_id, usuario_id, sucursal_id, estado, borrador_json, ultimo_producto_json, ultimo_update_id
           FROM bot_chat WHERE chat_id = ?1`,
        )
        .bind(chatId)
        .first<FilaChat>(),
    );

  async function persistirChat(chatId: string, estado: EstadoBot, borrador: BorradorBot, updateId: number, ultimoProductoJson: string | null): Promise<void> {
    await withRetry(() =>
      db
        .prepare(
          `UPDATE bot_chat SET estado = ?2, borrador_json = ?3, ultimo_update_id = ?4, ultimo_producto_json = ?5, updated_at = ?6 WHERE chat_id = ?1`,
        )
        .bind(chatId, estado, JSON.stringify(borrador), updateId, ultimoProductoJson, new Date().toISOString())
        .run(),
    );
  }

  async function crearBorradorRecepcion(chat: FilaChat, borrador: BorradorBot): Promise<void> {
    const nowIso = new Date().toISOString();
    await withRetry(() =>
      db
        .prepare(
          `INSERT INTO recepcion_borrador (id, tenant_id, sucursal_id, chat_id, payload_json, estado, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'pendiente', ?6, ?6)`,
        )
        .bind(uuidv7(), chat.tenant_id, chat.sucursal_id, chat.chat_id, JSON.stringify(borrador), nowIso)
        .run(),
    );
  }

  // Cruza el texto del producto contra el catálogo maestro (global) para robar GTIN/id → menos tipeo.
  async function enriquecerContraMaestro(borrador: BorradorBot): Promise<void> {
    if (!borrador.producto_texto) return;
    try {
      const hits = await maestroRepo(db).buscar(borrador.producto_texto);
      if (hits.length > 0) {
        borrador.maestro_id ??= hits[0]!.id;
        if (hits[0]!.gtin) borrador.gtin ??= hits[0]!.gtin;
      }
    } catch {
      /* el maestro es best-effort; si falla, el admin completa en la bandeja */
    }
  }

  return {
    // Genera un código de 6 dígitos para vincular un chat (lo llama la web, admin+). Garantiza que el
    // código sea único entre los ACTIVOS (no usados / no expirados) para que la búsqueda del bot no sea ambigua.
    async generarCodigoVinculacion(input: { tenantId: string; sucursalId: string; usuarioId: string; nowIso: string; minutos?: number }): Promise<{ codigo: string; expira_at: string }> {
      const expira = new Date(new Date(input.nowIso).getTime() + (input.minutos ?? 10) * 60_000).toISOString();
      let codigo = "";
      for (let intento = 0; intento < 20; intento++) {
        const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
        codigo = String(n).padStart(6, "0");
        const choque = await withRetry(() =>
          db.prepare(`SELECT id FROM bot_vinculacion WHERE codigo = ?1 AND usado = 0 AND expira_at > ?2`).bind(codigo, input.nowIso).first<{ id: string }>(),
        );
        if (!choque) break;
      }
      await withRetry(() =>
        db
          .prepare(
            `INSERT INTO bot_vinculacion (id, tenant_id, sucursal_id, usuario_id, codigo, expira_at, usado, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)`,
          )
          .bind(uuidv7(), input.tenantId, input.sucursalId, input.usuarioId, codigo, expira, input.nowIso)
          .run(),
      );
      return { codigo, expira_at: expira };
    },

    // Punto de entrada del webhook. Devuelve el método de Telegram a ejecutar, o null (silencio).
    async procesarUpdate(update: TgUpdate): Promise<MetodoTelegram | null> {
      if (!update || typeof update.update_id !== "number") return null;
      const cq = update.callback_query;
      const message = update.message ?? cq?.message;
      const chatId = message?.chat?.id != null ? String(message.chat.id) : cq?.message?.chat?.id != null ? String(cq.message.chat.id) : null;
      if (!chatId) return null;

      const textoEntrante = update.message?.text?.trim();
      const cbData = cq?.data;
      const foto = update.message?.photo;

      // 1) /vincular: ÚNICO comando que atiende un chat AÚN no vinculado (antes de la allowlist).
      //    Todo lo demás de un chat no vinculado (incluido /start) recibe silencio: no confirmamos
      //    siquiera que el bot existe (§7.1).
      if (textoEntrante) {
        const cmd = parseComando(textoEntrante);
        if (cmd?.comando === "vincular") return this.vincular(chatId, cmd.arg, update.update_id, update.message?.from);
      }

      // 2) Allowlist DURA: chat no vinculado → silencio absoluto.
      const chat = await chatPorId(chatId);
      if (!chat || !chat.usuario_id || !chat.tenant_id || !chat.sucursal_id) return null;

      // 3) Idempotencia: update ya procesado → 200 vacío, sin re-ejecutar efectos.
      if (update.update_id <= chat.ultimo_update_id) return null;

      const borrador = parseBorrador(chat.borrador_json);
      let ultimoProductoJson = chat.ultimo_producto_json;

      // 4) Determinar la entrada para la máquina de estados (texto / callback / OCR de foto).
      let entrada: EntradaBot | null = null;
      const fotosNuevas: string[] = [];
      let confianzaOcr: number | undefined;
      let fallbackTexto: string | null = null; // foto ilegible en el paso: no avanza, pide texto

      if (cbData !== undefined) {
        entrada = { tipo: "callback", data: cbData };
      } else if (foto && foto.length > 0) {
        const best = foto[foto.length - 1]!; // el último es el de mayor resolución
        const bytes = await descargarFoto(env, best.file_id);
        if (bytes && env.MEDIA) {
          const key = `bot/${chat.tenant_id}/${new Date().toISOString().slice(0, 10)}/${uuidv7()}.jpg`;
          try {
            await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
            fotosNuevas.push(key);
          } catch {
            /* R2 no disponible: seguimos igual, la foto es evidencia opcional */
          }
        }
        const est = chat.estado;
        if (est === "producto" || est === "producto_ok") {
          const r = bytes ? await ocrProducto(env, bytes) : null;
          if (r && r.confianza >= UMBRAL_OCR) {
            entrada = { tipo: "texto", texto: [r.nombre, r.laboratorio, r.concentracion].filter(Boolean).join(" ") };
            confianzaOcr = r.confianza;
          } else {
            fallbackTexto = `No pude leer bien la foto 😅. ${PROMPT_PRODUCTO}`;
          }
        } else if (est === "lote" || est === "lote_ok") {
          const r = bytes ? await ocrLote(env, bytes) : null;
          if (r && r.vencimiento && r.confianza >= UMBRAL_OCR) {
            entrada = { tipo: "texto", texto: `${r.lote ?? ""} / ${r.vencimiento}` };
            confianzaOcr = r.confianza;
          } else {
            fallbackTexto = PISTA_LOTE;
          }
        } else {
          fallbackTexto = "Gracias por la foto 📷. Sigamos con lo que te pedí.";
        }
      } else if (textoEntrante) {
        entrada = { tipo: "texto", texto: textoEntrante };
      }

      // 5a) Foto ilegible: conserva estado, guarda la foto en el borrador, pide el dato por texto.
      if (fallbackTexto) {
        const nb: BorradorBot = fotosNuevas.length ? { ...borrador, fotos: [...(borrador.fotos ?? []), ...fotosNuevas] } : borrador;
        await persistirChat(chatId, chat.estado, nb, update.update_id, ultimoProductoJson);
        return msg(chatId, fallbackTexto);
      }
      if (!entrada) {
        // Update sin contenido accionable (sticker, etc.): registra el update_id y guía suave.
        await persistirChat(chatId, chat.estado, borrador, update.update_id, ultimoProductoJson);
        return msg(chatId, "Te leo por texto o fotos 📷. Escribe /nuevo para registrar lo que llegó.");
      }

      // 5b) Avanzar la máquina de estados (pura).
      const ctx = chat.ultimo_producto_json
        ? { ultimoProducto: JSON.parse(chat.ultimo_producto_json) as { producto_texto: string; gtin?: string; maestro_id?: string } }
        : undefined;
      const t = avanzar(chat.estado, borrador, entrada, ctx);

      let borradorFinal = t.borrador;
      if (fotosNuevas.length) borradorFinal = { ...borradorFinal, fotos: [...(borradorFinal.fotos ?? []), ...fotosNuevas] };
      if (confianzaOcr !== undefined) borradorFinal.confianza_ocr = confianzaOcr;
      if (t.enriquecerProducto) await enriquecerContraMaestro(borradorFinal);

      let estadoFinal = t.estado;
      if (t.accion === "crear_borrador") {
        await crearBorradorRecepcion(chat, borradorFinal);
        ultimoProductoJson = JSON.stringify({ producto_texto: borradorFinal.producto_texto, gtin: borradorFinal.gtin, maestro_id: borradorFinal.maestro_id });
        borradorFinal = {};
        estadoFinal = "inicio";
      } else if (t.accion === "descartar") {
        borradorFinal = {};
        estadoFinal = "inicio";
      }

      await persistirChat(chatId, estadoFinal, borradorFinal, update.update_id, ultimoProductoJson);
      return t.respuesta ? enviar(chatId, t.respuesta) : null;
    },

    // Vincula un chat con un código de 6 dígitos activo. Crea/actualiza bot_chat (allowlist) y marca
    // el código usado. Un código inválido/vencido → mensaje neutro (no revela usuarios ni sucursales).
    async vincular(chatId: string, arg: string, updateId: number, _from?: TgUser): Promise<MetodoTelegram> {
      const codigo = (arg || "").trim();
      if (!/^\d{6}$/.test(codigo)) {
        return msg(chatId, "Escríbeme el código de 6 dígitos que te dio el admin. Ejemplo: /vincular 123456");
      }
      const nowIso = new Date().toISOString();
      const v = await withRetry(() =>
        db
          .prepare(`SELECT id, tenant_id, sucursal_id, usuario_id FROM bot_vinculacion WHERE codigo = ?1 AND usado = 0 AND expira_at > ?2 ORDER BY created_at DESC LIMIT 1`)
          .bind(codigo, nowIso)
          .first<{ id: string; tenant_id: string; sucursal_id: string; usuario_id: string }>(),
      );
      if (!v) return msg(chatId, "Ese código no es válido o ya venció. Pídele al admin uno nuevo 🙏");

      await withRetry(() =>
        db.batch([
          db
            .prepare(
              `INSERT INTO bot_chat (chat_id, tenant_id, usuario_id, sucursal_id, estado, borrador_json, ultimo_producto_json, ultimo_update_id, updated_at)
               VALUES (?1, ?2, ?3, ?4, 'inicio', '{}', NULL, ?5, ?6)
               ON CONFLICT (chat_id) DO UPDATE SET tenant_id = excluded.tenant_id, usuario_id = excluded.usuario_id,
                 sucursal_id = excluded.sucursal_id, estado = 'inicio', borrador_json = '{}', updated_at = excluded.updated_at`,
            )
            .bind(chatId, v.tenant_id, v.usuario_id, v.sucursal_id, updateId, nowIso),
          db.prepare(`UPDATE bot_vinculacion SET usado = 1 WHERE id = ?1`).bind(v.id),
        ]),
      );
      return msg(chatId, "✅ ¡Listo! Quedaste vinculado. Escribe /nuevo para registrar lo que llegó 📦");
    },
  };
}
