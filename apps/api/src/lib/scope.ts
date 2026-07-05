import { noEncontrado, validacion } from "./errores";
import type { Actor } from "../types";

// Resuelve la sucursal objetivo de una operación (plan §4.1/§4.3):
//   - super_admin: DEBE indicar sucursal_id explícito (selector).
//   - admin/operador/lector y dispositivos: SIEMPRE su propia sucursal; si piden otra → 404.
// La identidad manda desde el server; el parámetro nunca des-aísla a un no-super.
export function sucursalObjetivo(actor: Actor, pedida?: string | null): string {
  if (actor.tipo === "dispositivo") {
    if (pedida && pedida !== actor.sucursalId) throw noEncontrado("sucursal");
    return actor.sucursalId;
  }
  if (actor.rol === "super_admin") {
    if (!pedida) throw validacion("super_admin debe indicar sucursal_id");
    return pedida;
  }
  if (!actor.sucursalId) throw noEncontrado("sucursal");
  if (pedida && pedida !== actor.sucursalId) throw noEncontrado("sucursal");
  return actor.sucursalId;
}

export function esSuper(actor: Actor): boolean {
  return actor.tipo === "usuario" && actor.rol === "super_admin";
}
