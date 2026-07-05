import type { Rol } from "../types";
import { withRetry } from "./base";

export type SesionUsuario = {
  usuarioId: string;
  tenantId: string;
  sucursalId: string | null;
  rol: Rol;
  nombre: string;
  email: string;
  sesionId: string;
};

export type DispositivoAuth = {
  dispositivoId: string;
  tenantId: string;
  sucursalId: string;
};

export type UsuarioLogin = {
  id: string;
  tenantId: string;
  sucursalId: string | null;
  rol: Rol;
  nombre: string;
  email: string;
  passwordHash: string;
  activo: number;
};

export function authRepo(db: D1Database) {
  return {
    async buscarSesionPorTokenHash(tokenHash: string, ahoraIso: string): Promise<SesionUsuario | null> {
      const row = await withRetry(() =>
        db
          .prepare(
            `SELECT s.id AS sesion_id, u.id AS usuario_id, u.tenant_id, u.sucursal_id, u.rol, u.nombre, u.email
             FROM sesion s JOIN usuario_perfil u ON u.id = s.usuario_id
             WHERE s.token_hash = ?1 AND s.expira_at > ?2 AND u.activo = 1`,
          )
          .bind(tokenHash, ahoraIso)
          .first<{
            sesion_id: string;
            usuario_id: string;
            tenant_id: string;
            sucursal_id: string | null;
            rol: Rol;
            nombre: string;
            email: string;
          }>(),
      );
      if (!row) return null;
      return {
        sesionId: row.sesion_id,
        usuarioId: row.usuario_id,
        tenantId: row.tenant_id,
        sucursalId: row.sucursal_id,
        rol: row.rol,
        nombre: row.nombre,
        email: row.email,
      };
    },

    async deslizarExpiracion(sesionId: string, nuevaExpiraIso: string): Promise<void> {
      await withRetry(() =>
        db.prepare(`UPDATE sesion SET expira_at = ?2 WHERE id = ?1`).bind(sesionId, nuevaExpiraIso).run(),
      );
    },

    async buscarDispositivoPorTokenHash(tokenHash: string): Promise<DispositivoAuth | null> {
      const row = await withRetry(() =>
        db
          .prepare(
            `SELECT d.id AS dispositivo_id, d.sucursal_id, su.tenant_id
             FROM dispositivo d JOIN sucursal su ON su.id = d.sucursal_id
             WHERE d.token_hash = ?1 AND d.activo = 1`,
          )
          .bind(tokenHash)
          .first<{ dispositivo_id: string; sucursal_id: string; tenant_id: string }>(),
      );
      if (!row) return null;
      return { dispositivoId: row.dispositivo_id, sucursalId: row.sucursal_id, tenantId: row.tenant_id };
    },

    async buscarUsuarioPorEmail(email: string): Promise<UsuarioLogin | null> {
      const row = await withRetry(() =>
        db
          .prepare(
            `SELECT id, tenant_id, sucursal_id, rol, nombre, email, password_hash, activo
             FROM usuario_perfil WHERE email = ?1`,
          )
          .bind(email)
          .first<{
            id: string;
            tenant_id: string;
            sucursal_id: string | null;
            rol: Rol;
            nombre: string;
            email: string;
            password_hash: string;
            activo: number;
          }>(),
      );
      if (!row) return null;
      return {
        id: row.id,
        tenantId: row.tenant_id,
        sucursalId: row.sucursal_id,
        rol: row.rol,
        nombre: row.nombre,
        email: row.email,
        passwordHash: row.password_hash,
        activo: row.activo,
      };
    },

    async crearSesion(
      sesionId: string,
      usuarioId: string,
      tokenHash: string,
      creadaIso: string,
      expiraIso: string,
      ip: string | null,
      ua: string | null,
    ): Promise<void> {
      await withRetry(() =>
        db
          .prepare(
            `INSERT INTO sesion (id, usuario_id, token_hash, creada_at, expira_at, ip_origen, user_agent)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .bind(sesionId, usuarioId, tokenHash, creadaIso, expiraIso, ip, ua)
          .run(),
      );
    },

    async borrarSesionPorTokenHash(tokenHash: string): Promise<void> {
      await withRetry(() => db.prepare(`DELETE FROM sesion WHERE token_hash = ?1`).bind(tokenHash).run());
    },

    // Rate-limit: intentos fallidos por email en la ventana (plan §4.2: 5 / 15 min).
    async contarFallidosDesde(email: string, desdeIso: string): Promise<number> {
      const row = await withRetry(() =>
        db
          .prepare(`SELECT COUNT(*) AS n FROM login_intento WHERE email = ?1 AND exito = 0 AND intento_at > ?2`)
          .bind(email, desdeIso)
          .first<{ n: number }>(),
      );
      return row?.n ?? 0;
    },

    async registrarIntento(email: string, exito: boolean, cuandoIso: string): Promise<void> {
      await withRetry(() =>
        db
          .prepare(`INSERT INTO login_intento (email, intento_at, exito) VALUES (?1, ?2, ?3)`)
          .bind(email, cuandoIso, exito ? 1 : 0)
          .run(),
      );
    },

    async buscarHashPorId(usuarioId: string): Promise<string | null> {
      const row = await withRetry(() =>
        db
          .prepare(`SELECT password_hash FROM usuario_perfil WHERE id = ?1 AND activo = 1`)
          .bind(usuarioId)
          .first<{ password_hash: string }>(),
      );
      return row?.password_hash ?? null;
    },

    async actualizarPassword(usuarioId: string, nuevoHash: string, actualizadoIso: string): Promise<void> {
      await withRetry(() =>
        db
          .prepare(`UPDATE usuario_perfil SET password_hash = ?2, updated_at = ?3 WHERE id = ?1`)
          .bind(usuarioId, nuevoHash, actualizadoIso)
          .run(),
      );
    },
  };
}
