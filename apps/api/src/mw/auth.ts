import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { ahoraIso } from "../lib/fecha";
import { noAutenticado } from "../lib/errores";
import { hashToken } from "../lib/token";
import { authRepo } from "../repos/auth";
import type { AppEnv } from "../types";

export const SESION_DIAS = 30;
export const COOKIE_SESION = "sesion";

function extraerToken(c: Context<AppEnv>): string | null {
  const cookie = getCookie(c, COOKIE_SESION);
  if (cookie) return cookie;
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

// Resuelve la sesión → actor {usuario|dispositivo}. Fallo cerrado: sin sesión válida = 401.
export const requiereAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = extraerToken(c);
  if (!token) throw noAutenticado();

  const repo = authRepo(c.get("db"));
  const tokenHash = await hashToken(token);
  const ahora = ahoraIso();

  const sesion = await repo.buscarSesionPorTokenHash(tokenHash, ahora);
  if (sesion) {
    // Expiración deslizante 30 días.
    const nuevaExpira = new Date(Date.now() + SESION_DIAS * 86_400_000).toISOString();
    await repo.deslizarExpiracion(sesion.sesionId, nuevaExpira);
    c.set("actor", {
      tipo: "usuario",
      usuarioId: sesion.usuarioId,
      tenantId: sesion.tenantId,
      sucursalId: sesion.sucursalId,
      rol: sesion.rol,
    });
    return next();
  }

  const dispositivo = await repo.buscarDispositivoPorTokenHash(tokenHash);
  if (dispositivo) {
    c.set("actor", {
      tipo: "dispositivo",
      dispositivoId: dispositivo.dispositivoId,
      tenantId: dispositivo.tenantId,
      sucursalId: dispositivo.sucursalId,
    });
    return next();
  }

  throw noAutenticado();
});
