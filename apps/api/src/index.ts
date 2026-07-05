import { Hono } from "hono";

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// Piloto: nunca indexar (regla de deploy del plan §3).
app.use("*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex, nofollow");
});

app.get("/api/salud", (c) => c.json({ ok: true, servicio: "huayruro-api" }));

// Cualquier /api/* no manejado → 404 JSON (convención de errores §8), nunca la SPA.
app.all("/api/*", (c) => c.json({ error: { codigo: 404, mensaje: "No encontrado" } }, 404));

// Fallback a la SPA (assets) para el resto de rutas.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
