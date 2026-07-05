export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
};

export type Rol = "super_admin" | "admin_sucursal" | "operador" | "lector_reportes";

// La identidad SIEMPRE sale de la sesión del server (plan §4.1), nunca del body/query.
export type ActorUsuario = {
  tipo: "usuario";
  usuarioId: string;
  tenantId: string;
  sucursalId: string | null; // null solo para super_admin
  rol: Rol;
};

export type ActorDispositivo = {
  tipo: "dispositivo";
  dispositivoId: string;
  tenantId: string;
  sucursalId: string;
};

export type Actor = ActorUsuario | ActorDispositivo;

export type Variables = {
  db: D1Database; // inyectado por src/repos/contexto.ts; los handlers nunca tocan env.DB
  actor: Actor;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
