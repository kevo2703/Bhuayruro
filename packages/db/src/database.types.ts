// Tipos del schema public de Supabase.
//
// Generados manualmente sprint 1-2. Cuando hagamos `supabase link --project-ref ...`
// los reemplazamos por output de `pnpm supabase:types`.
//
// Espejo del SQL en scripts/setup-initial.sql + scripts/sprint2-catalogo.sql.

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

export type ProductoCatalogo = {
  id: string;
  tenant_id: string;
  sku_interno: string | null;
  nombre: string;
  presentacion: string | null;
  laboratorio: string | null;
  principio_activo: string | null;
  categoria: string | null;
  requiere_receta: boolean;
  activo: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ProductoCatalogoInsert = {
  id?: string;
  tenant_id: string;
  sku_interno?: string | null;
  nombre: string;
  presentacion?: string | null;
  laboratorio?: string | null;
  principio_activo?: string | null;
  categoria?: string | null;
  requiere_receta?: boolean;
  activo?: boolean;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type ProductoCatalogoUpdate = Partial<ProductoCatalogoInsert>;

export type CodigoBarras = {
  id: string;
  producto_id: string;
  gtin: string;
  es_unidad: boolean;
  created_at: string;
};

export type CodigoBarrasInsert = {
  id?: string;
  producto_id: string;
  gtin: string;
  es_unidad?: boolean;
  created_at?: string;
};

export type CodigoBarrasUpdate = Partial<CodigoBarrasInsert>;

export type PrecioLocal = {
  id: string;
  producto_id: string;
  sucursal_id: string;
  precio_compra: number | null;
  precio_sin_igv: number;
  igv: number; // GENERATED
  precio_total: number; // GENERATED
  vigente_desde: string;
  vigente_hasta: string | null;
  created_at: string;
};

export type PrecioLocalInsert = {
  id?: string;
  producto_id: string;
  sucursal_id: string;
  precio_compra?: number | null;
  precio_sin_igv: number;
  vigente_desde?: string;
  vigente_hasta?: string | null;
  created_at?: string;
};

export type PrecioLocalUpdate = Partial<PrecioLocalInsert>;

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
      producto_catalogo: {
        Row: ProductoCatalogo;
        Insert: ProductoCatalogoInsert;
        Update: ProductoCatalogoUpdate;
      };
      codigo_barras: {
        Row: CodigoBarras;
        Insert: CodigoBarrasInsert;
        Update: CodigoBarrasUpdate;
      };
      precio_local: {
        Row: PrecioLocal;
        Insert: PrecioLocalInsert;
        Update: PrecioLocalUpdate;
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
