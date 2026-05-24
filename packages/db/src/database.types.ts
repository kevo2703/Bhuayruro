// Tipos del schema public de Supabase.
//
// Generados manualmente sprint 1. Cuando hagamos `supabase link --project-ref ...`
// los reemplazamos por output de `pnpm supabase:types`.
//
// Espejo del SQL en scripts/setup-initial.sql v3.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ====== Enums ======

export type UserRole = "super_admin" | "admin_sucursal" | "operador" | "lector_reportes";

// ====== Tablas ======

export type Tenant = {
  id: string;
  nombre: string;
  nombre_comercial: string;
  ruc: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantInsert = {
  id?: string;
  nombre: string;
  nombre_comercial: string;
  ruc?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TenantUpdate = Partial<TenantInsert>;

export type Sucursal = {
  id: string;
  tenant_id: string;
  nombre: string;
  direccion: string | null;
  zona_horaria: string;
  activa: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type SucursalInsert = {
  id?: string;
  tenant_id: string;
  nombre: string;
  direccion?: string | null;
  zona_horaria?: string;
  activa?: boolean;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type SucursalUpdate = Partial<SucursalInsert>;

export type UsuarioPerfil = {
  id: string;
  tenant_id: string;
  sucursal_id: string | null;
  rol: UserRole;
  nombre: string;
  email: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export type UsuarioPerfilInsert = {
  id: string;
  tenant_id: string;
  sucursal_id?: string | null;
  rol: UserRole;
  nombre: string;
  email: string;
  activo?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type UsuarioPerfilUpdate = Partial<UsuarioPerfilInsert>;

// ====== Database schema completo (formato Supabase) ======

export type Database = {
  public: {
    Tables: {
      tenant: {
        Row: Tenant;
        Insert: TenantInsert;
        Update: TenantUpdate;
      };
      sucursal: {
        Row: Sucursal;
        Insert: SucursalInsert;
        Update: SucursalUpdate;
      };
      usuario_perfil: {
        Row: UsuarioPerfil;
        Insert: UsuarioPerfilInsert;
        Update: UsuarioPerfilUpdate;
      };
    };
    Views: Record<string, never>;
    Functions: {
      auth_user_rol: {
        Args: Record<string, never>;
        Returns: UserRole | null;
      };
      auth_user_sucursal_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      auth_user_tenant_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      auth_is_super_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      auth_is_admin_or_super: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
