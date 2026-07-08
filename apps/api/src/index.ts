import { Hono } from "hono";
import { ErrorApi } from "./lib/errores";
import { inyectarDb } from "./repos/contexto";
import { rutasAuth } from "./routes/auth";
import { rutasProtegidas } from "./routes/protegidas";
import { rutasTelegram } from "./routes/telegram";
import type { AppEnv } from "./types";

export type { Bindings } from "./types";

const app = new Hono<AppEnv>();

// Piloto: nunca indexar (regla de deploy del plan §3).
app.use("*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex, nofollow");
});

// Inyecta el binding D1 en el contexto (único acceso a env.DB del código, §4.1).
app.use("*", inyectarDb);

// Errores tipados → JSON con la convención del §8.
app.onError((err, c) => {
  if (err instanceof ErrorApi) {
    return c.json({ error: { codigo: err.codigo, mensaje: err.message } }, err.status);
  }
  console.error("error no controlado:", err);
  return c.json({ error: { codigo: "interno", mensaje: "Error interno" } }, 500);
});

app.get("/api/salud", (c) => c.json({ ok: true, servicio: "huayruro-api" }));

app.route("/api/auth", rutasAuth);
// Webhook del bot de Telegram: público (secret propio), montado ANTES de las protegidas.
app.route("/api/telegram", rutasTelegram);
app.route("/api", rutasProtegidas);

// Cualquier /api/* no manejado → 404 JSON (convención de errores §8), nunca la SPA.
app.all("/api/*", (c) => c.json({ error: { codigo: "no_encontrado", mensaje: "No encontrado" } }, 404));

// Fallback a la SPA (assets) para el resto de rutas.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
