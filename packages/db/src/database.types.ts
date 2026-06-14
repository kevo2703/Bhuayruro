// Tipos del schema public de Supabase.
//
// Generados manualmente sprint 1-2. Cuando hagamos `supabase link --project-ref ...`
// los reemplazamos por output de `pnpm supabase:types`.
//
// Espejo del SQL en scripts/setup-initial.sql + scripts/sprint2-catalogo.sql.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ====== Enums ======

export type UserRole = "super_admin" | "admin_sucursal" | "operador" | "lector_reportes";

export type MetodoPago = "efectivo" | "yape" | "plin" | "tarjeta" | "transferencia" | "otro";

export type VentaEstado = "completada" | "anulada";

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

export type InventarioLocal = {
  id: string;
  sucursal_id: string;
  producto_id: string;
  stock_unidades: number;
  stock_minimo: number | null;
  updated_at: string;
};

export type InventarioLocalInsert = {
  id?: string;
  sucursal_id: string;
  producto_id: string;
  stock_unidades?: number;
  stock_minimo?: number | null;
  updated_at?: string;
};

export type InventarioLocalUpdate = Partial<InventarioLocalInsert>;

export type Lote = {
  id: string;
  inventario_id: string;
  numero_lote: string;
  fecha_vencimiento: string;
  unidades: number;
  proveedor: string | null;
  fecha_recepcion: string;
  created_at: string;
  updated_at: string;
};

export type LoteInsert = {
  id?: string;
  inventario_id: string;
  numero_lote: string;
  fecha_vencimiento: string;
  unidades?: number;
  proveedor?: string | null;
  fecha_recepcion?: string;
};

export type LoteUpdate = Partial<LoteInsert>;

export type Venta = {
  id: string;
  client_uuid: string;
  sucursal_id: string;
  operador_id: string | null;
  fecha_hora: string;
  subtotal_sin_igv: number;
  igv_total: number;
  total: number;
  metodo_pago: MetodoPago;
  estado: VentaEstado;
  observaciones: string | null;
  sunat_estado: string | null;
  sunat_serie: string | null;
  sunat_numero: number | null;
  created_at: string;
  updated_at: string;
};

export type VentaItem = {
  id: string;
  venta_id: string;
  producto_id: string;
  lote_id: string | null;
  cantidad: number;
  precio_sin_igv_unitario: number;
  igv_unitario: number;
  precio_total_unitario: number;
  subtotal_sin_igv: number;
  igv_subtotal: number;
  total: number;
  created_at: string;
};

export type AuditLog = {
  id: string;
  tenant_id: string;
  sucursal_id: string | null;
  usuario_id: string | null;
  accion: string;
  recurso: string | null;
  recurso_id: string | null;
  datos_antes: Json | null;
  datos_despues: Json | null;
  ip_origen: string | null;
  user_agent: string | null;
  fecha_hora: string;
};

// ====== RPC types ======

export type RegistrarVentaItemInput = {
  producto_id: string;
  lote_id?: string;
  cantidad: number;
  precio_sin_igv_unitario: number;
};

export type RegistrarVentaInput = {
  client_uuid: string;
  sucursal_id: string;
  metodo_pago: MetodoPago;
  items: RegistrarVentaItemInput[];
  observaciones?: string;
  fecha_hora_cliente?: string;
};

export type RegistrarVentaOutput = {
  venta_id: string;
  total: number;
  subtotal_sin_igv?: number;
  igv_total?: number;
  fecha_hora_servidor?: string;
  idempotent?: boolean;
};

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
      inventario_local: {
        Row: InventarioLocal;
        Insert: InventarioLocalInsert;
        Update: InventarioLocalUpdate;
      };
      lote: {
        Row: Lote;
        Insert: LoteInsert;
        Update: LoteUpdate;
      };
      venta: {
        Row: Venta;
        // Inserts deben hacerse vía RPC registrar_venta — el tipo aquí es
        // permisivo solo para que la inferencia de tipos no se rompa.
        Insert: Partial<Venta> & { client_uuid: string; sucursal_id: string; metodo_pago: MetodoPago; total: number; subtotal_sin_igv: number; igv_total: number };
        Update: Partial<Venta>;
      };
      venta_item: {
        Row: VentaItem;
        Insert: Partial<VentaItem> & { venta_id: string; producto_id: string; cantidad: number; precio_sin_igv_unitario: number; igv_unitario: number; precio_total_unitario: number; subtotal_sin_igv: number; igv_subtotal: number; total: number };
        Update: Partial<VentaItem>;
      };
      audit_log: {
        Row: AuditLog;
        Insert: Partial<AuditLog> & { tenant_id: string; accion: string };
        Update: Partial<AuditLog>;
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
      registrar_venta: {
        Args: { payload: Json };
        Returns: Json;
      };
      anular_venta: {
        Args: { p_venta_id: string; p_motivo: string };
        Returns: Json;
      };
    };
    Enums: {
      user_role: UserRole;
      metodo_pago: MetodoPago;
    };
    CompositeTypes: Record<string, never>;
  };
};
