import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

// ÚNICO punto del código que toca env.DB (plan §4.1 rule 2). Inyecta el binding en el
// contexto para que los handlers usen c.get("db") y jamás env.DB directamente.
// Lo verifica el test del canal prohibido (§4.4 #14) y la regla ESLint.
export const inyectarDb = createMiddleware<AppEnv>(async (c, next) => {
  c.set("db", c.env.DB);
  return next();
});
