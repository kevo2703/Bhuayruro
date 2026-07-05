import type { Context } from "hono";
import type { AppEnv } from "../types";

// Lee el body JSON con default vacío tipado. Devuelve Partial<T> (todo opcional) —
// la validación real la hace cada handler.
export async function leerBody<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json().catch(() => ({}))) as Partial<T>;
}
