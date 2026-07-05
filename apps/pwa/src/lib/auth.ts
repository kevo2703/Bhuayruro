import { apiRequest, ApiError } from "./api";
import type { HuayruroDB, SesionCache } from "./db-local";
import type { Rol, SesionActiva, SucursalMin, UsuarioSesion } from "./tipos";

// Auth propia contra el Worker (§11.1: reemplaza Supabase Auth). El token de sesión se persiste en
// Dexie (sesion_cache) para arrancar offline y para que la cola re-sincronice tras un reinicio.

// Token vigente en memoria: la cola (flusher) y el sync lo leen sin acoplarse a React.
let tokenEnMemoria: string | null = null;
export const getToken = (): string | null => tokenEnMemoria;
export const setToken = (t: string | null): void => {
  tokenEnMemoria = t;
};

type LoginResp = {
  token: string;
  usuario: { id: string; nombre: string; email: string; rol: Rol; sucursalId: string | null; tenantId: string };
};

type MeResp = { usuarioId: string; rol: Rol; sucursalId: string | null; tenantId: string };

// Persiste la sesión activa en Dexie (arranque offline) y la deja en memoria.
export async function guardarSesion(db: HuayruroDB, sesion: SesionActiva): Promise<void> {
  const fila: SesionCache = {
    clave: "actual",
    token: sesion.token,
    usuario: sesion.usuario,
    sucursal: sesion.sucursal,
    rol: sesion.usuario.rol,
    guardado_at: new Date().toISOString(),
  };
  await db.sesion_cache.put(fila);
  setToken(sesion.token);
}

// Lee la sesión cacheada (para el primer render, antes de validar con /me).
export async function leerSesionCache(db: HuayruroDB): Promise<SesionActiva | null> {
  const fila = await db.sesion_cache.get("actual");
  if (!fila) return null;
  setToken(fila.token);
  return {
    token: fila.token,
    usuario: fila.usuario as UsuarioSesion,
    sucursal: (fila.sucursal as SucursalMin | null) ?? null,
  };
}

export async function borrarSesion(db: HuayruroDB): Promise<void> {
  await db.sesion_cache.delete("actual");
  setToken(null);
}

// Login: email+password → token + usuario. Resuelve el nombre de la sucursal vía /sucursales
// (el login solo trae sucursalId). Super_admin no tiene sucursal fija → sucursal = null.
export async function login(db: HuayruroDB, email: string, password: string): Promise<SesionActiva> {
  const r = await apiRequest<LoginResp>("/auth/login", {
    method: "POST",
    body: { email, password },
    reintentos: 0, // el login no se reintenta a ciegas
  });
  setToken(r.token);
  let sucursal: SucursalMin | null = null;
  if (r.usuario.sucursalId) {
    try {
      const s = await apiRequest<{ sucursales: (SucursalMin & { activa: number })[] }>("/sucursales", { token: r.token });
      sucursal = s.sucursales.find((x) => x.id === r.usuario.sucursalId) ?? null;
    } catch {
      /* sin conexión al resolver el nombre: la sesión sigue válida, sucursal se resuelve luego */
    }
  }
  const sesion: SesionActiva = { token: r.token, usuario: r.usuario, sucursal };
  await guardarSesion(db, sesion);
  return sesion;
}

// Valida el token cacheado contra el server. Devuelve:
//   'ok'         → token válido (sigue autenticado)
//   'invalida'   → el server rechazó el token (401/403) → hay que re-login
//   'sin_red'    → no se pudo verificar (offline) → se confía en la cache
export async function verificarSesion(token: string): Promise<"ok" | "invalida" | "sin_red"> {
  try {
    await apiRequest<MeResp>("/auth/me", { token, reintentos: 0 });
    return "ok";
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return "invalida";
    return "sin_red";
  }
}

// Logout: intenta invalidar en el server (best-effort) y limpia la cache local.
export async function logout(db: HuayruroDB, token: string | null): Promise<void> {
  if (token) {
    try {
      await apiRequest("/auth/logout", { method: "POST", token, reintentos: 0 });
    } catch {
      /* logout local igual: no bloquear por red */
    }
  }
  await borrarSesion(db);
}
