import { Hono } from "hono";
import { botRepo, type TgUpdate } from "../repos/bot";
import type { AppEnv } from "../types";

// Webhook público del bot de Telegram (B9 §7.1). NO pasa por requiereAuth: el "actor" es el bot,
// autenticado por el secret del webhook + la allowlist de bot_chat (dentro del repo). Se monta
// ANTES de las rutas protegidas para que /api/telegram/webhook no caiga en requiereAuth.
export const rutasTelegram = new Hono<AppEnv>();

// Seguridad de primera línea: sin el header con el secret correcto → 401 sin cuerpo. Fallo cerrado:
// si el secret no está configurado (TELEGRAM_WEBHOOK_SECRET ausente), también 401 (el bot no opera).
rutasTelegram.post("/webhook", async (c) => {
  const esperado = c.env.TELEGRAM_WEBHOOK_SECRET;
  const recibido = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (!esperado || recibido !== esperado) return new Response(null, { status: 401 });

  let update: TgUpdate;
  try {
    update = (await c.req.json()) as TgUpdate;
  } catch {
    return c.json({}, 200); // cuerpo ilegible: aceptamos y no reintentamos
  }

  const metodo = await botRepo(c.get("db"), c.env).procesarUpdate(update);
  // Respuesta-como-método: si hay algo que decir, Telegram ejecuta el método del cuerpo; si no, 200 vacío.
  return c.json(metodo ?? {}, 200);
});
