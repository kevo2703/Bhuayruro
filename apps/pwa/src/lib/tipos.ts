// Tipos de dominio de la PWA (cutover D1: ya sin @supabase/*, §11.3). El dinero viaja en
// enteros — precios en diezmilésimas (_dm), totales en céntimos (_cent) — desde packages/shared.
import type { MetodoPago } from "@huayruro/shared";

export type { MetodoPago };

export type Rol = "super_admin" | "admin_sucursal" | "operador" | "lector_reportes";

export type UsuarioSesion = {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  sucursalId: string | null; // null solo para super_admin
  tenantId: string;
};

export type SucursalMin = { id: string; nombre: string; direccion: string | null };

// Sesión activa que consume la UI (persistida en Dexie sesion_cache para arranque offline).
export type SesionActiva = {
  token: string;
  usuario: UsuarioSesion;
  sucursal: SucursalMin | null; // la del operador/admin; null para super_admin
};

// Producto listo para vender: producto + presentación elegida + precio (dm) de MI sucursal.
export type ProductoVenta = {
  producto_id: string;
  nombre: string;
  presentacion_texto: string | null;
  laboratorio: string | null;
  principio_activo: string | null;
  categoria: string | null; // A4: uno de los tres disparadores del motor de venta cruzada
  requiere_receta: boolean;
  presentacion_id: string;
  presentacion_nombre: string;
  factor: number; // unidades base por presentación
  precio_sin_igv_dm: number;
  precio_total_dm: number;
  stock_cache: number | null; // informativo (puede estar viejo)
  gtin: string | null;
};
