import { createMiddleware } from "hono/factory";
import { sinPermiso } from "../lib/errores";
import type { AppEnv, Rol } from "../types";

// Exige que el actor sea un USUARIO con uno de los roles dados. Un token de dispositivo
// (o rol insuficiente) → 403 (plan §4.3 / §4.4 #10-13).
export function requiereRol(...roles: Rol[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const actor = c.get("actor");
    if (actor.tipo !== "usuario" || !roles.includes(actor.rol)) throw sinPermiso();
    return next();
  });
}

// Cualquier usuario autenticado (no dispositivo).
export const requiereUsuario = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("actor").tipo !== "usuario") throw sinPermiso();
  return next();
});

export const soloSuperAdmin = requiereRol("super_admin");
export const adminOSuper = requiereRol("admin_sucursal", "super_admin");
export const operadorParaArriba = requiereRol("operador", "admin_sucursal", "super_admin");
