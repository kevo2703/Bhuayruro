import type { ContentfulStatusCode } from "hono/utils/http-status";

// Error de negocio/seguridad con código HTTP. Convención de errores del plan §8:
// 400 validación · 401 sin sesión · 403 rol · 404 fuera de scope/inexistente ·
// 409 conflicto · 422 negocio. Fallo cerrado: recurso ajeno = 404 (no 403).
export class ErrorApi extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorApi";
  }
}

export const noAutenticado = () => new ErrorApi(401, "no_autenticado", "Sesión inválida o ausente");
export const sinPermiso = () => new ErrorApi(403, "sin_permiso", "Rol insuficiente");
export const noEncontrado = (rec = "recurso") => new ErrorApi(404, "no_encontrado", `${rec} no encontrado`);
export const conflicto = (msg: string) => new ErrorApi(409, "conflicto", msg);
export const negocio = (msg: string) => new ErrorApi(422, "regla_negocio", msg);
export const validacion = (msg: string) => new ErrorApi(400, "validacion", msg);
