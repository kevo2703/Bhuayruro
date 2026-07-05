import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { uuidv7 } from "@huayruro/shared";
import { ErrorApi, noAutenticado, validacion } from "../lib/errores";
import { ahoraIso } from "../lib/fecha";
import { leerBody } from "../lib/http";
import { hashPassword, verifyPassword } from "../lib/password";
import { generarToken, hashToken } from "../lib/token";
import { authRepo } from "../repos/auth";
import { COOKIE_SESION, SESION_DIAS, requiereAuth } from "../mw/auth";
import type { AppEnv } from "../types";

const MAX_FALLIDOS = 5;
const VENTANA_MIN = 15;

export const rutasAuth = new Hono<AppEnv>();

rutasAuth.post("/login", async (c) => {
  const body = await leerBody<{ email: string; password: string }>(c);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) throw validacion("email y password requeridos");

  const repo = authRepo(c.get("db"));
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  if ((await repo.contarFallidosDesde(email, desde)) >= MAX_FALLIDOS) {
    throw new ErrorApi(429, "demasiados_intentos", "Demasiados intentos fallidos; espera unos minutos");
  }

  const usuario = await repo.buscarUsuarioPorEmail(email);
  const ok = usuario?.activo === 1 && (await verifyPassword(password, usuario.passwordHash));
  const ahora = ahoraIso();
  await repo.registrarIntento(email, !!ok, ahora);
  if (!ok || !usuario) throw new ErrorApi(401, "credenciales", "Email o contraseña incorrectos");

  const token = generarToken();
  const tokenHash = await hashToken(token);
  const expira = new Date(Date.now() + SESION_DIAS * 86_400_000).toISOString();
  await repo.crearSesion(
    uuidv7(),
    usuario.id,
    tokenHash,
    ahora,
    expira,
    c.req.header("cf-connecting-ip") ?? null,
    c.req.header("user-agent") ?? null,
  );

  setCookie(c, COOKIE_SESION, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESION_DIAS * 86_400,
  });

  return c.json({
    token, // la PWA lo persiste en IndexedDB para re-sincronizar tras reinicio offline
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      sucursalId: usuario.sucursalId,
      tenantId: usuario.tenantId,
    },
  });
});

rutasAuth.post("/logout", requiereAuth, async (c) => {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
  // Si vino por cookie, la limpiamos igual.
  if (token) await authRepo(c.get("db")).borrarSesionPorTokenHash(await hashToken(token));
  setCookie(c, COOKIE_SESION, "", { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 0 });
  return c.json({ ok: true });
});

rutasAuth.get("/me", requiereAuth, (c) => {
  const actor = c.get("actor");
  if (actor.tipo !== "usuario") throw noAutenticado();
  return c.json({
    usuarioId: actor.usuarioId,
    rol: actor.rol,
    sucursalId: actor.sucursalId,
    tenantId: actor.tenantId,
  });
});

rutasAuth.patch("/password", requiereAuth, async (c) => {
  const actor = c.get("actor");
  if (actor.tipo !== "usuario") throw noAutenticado();
  const body = await leerBody<{ actual: string; nueva: string }>(c);
  if (!body.actual || !body.nueva || body.nueva.length < 8) {
    throw validacion("actual y nueva (mín. 8) requeridas");
  }
  const repo = authRepo(c.get("db"));
  const hash = await repo.buscarHashPorId(actor.usuarioId);
  if (!hash || !(await verifyPassword(body.actual, hash))) throw new ErrorApi(401, "credenciales", "Contraseña actual incorrecta");
  await repo.actualizarPassword(actor.usuarioId, await hashPassword(body.nueva), ahoraIso());
  return c.json({ ok: true });
});
