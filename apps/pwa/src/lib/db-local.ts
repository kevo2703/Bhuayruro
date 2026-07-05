import Dexie, { type Table } from "dexie";

// Cache local (lecturas) + cola de escrituras idempotente (§9, decisión D7).
// Sin PowerSync, sin sync bidireccional de estado: lecturas = cache, escrituras = cola.

export type ProductoLocal = {
  id: string;
  nombre: string;
  presentacion: string | null;
  laboratorio: string | null;
  principio_activo: string | null;
  categoria: string | null;
  activo: number;
  updated_at: string;
};

export type PresentacionLocal = {
  id: string;
  producto_id: string;
  nombre: string;
  factor_unidades: number;
  es_base: number;
};

export type CodigoLocal = { gtin: string; producto_id: string; presentacion_id: string | null };

export type PrecioLocal = {
  id: string; // `${producto_id}:${presentacion_id}`
  producto_id: string;
  presentacion_id: string;
  precio_sin_igv_dm: number;
  precio_total_dm: number;
  vigente_desde: string;
};

export type StockCache = {
  producto_id: string;
  stock_unidades: number;
  stock_minimo: number;
  updated_at: string;
};

export type TipoOp = "venta" | "quiebre" | "recepcion";
export type EstadoOp = "pendiente" | "enviando" | "confirmada" | "rechazada";

// Una operación de escritura, idempotente por client_uuid (§9). El payload es el body del POST.
export type ColaOp = {
  client_uuid: string;
  tipo: TipoOp;
  payload: unknown;
  creado_at: string;
  estado: EstadoOp;
  intentos: number;
  ultimo_error: string | null;
  proximo_intento_at: string | null; // backoff
  venta_id: string | null; // asignado por el server al confirmar (para reimprimir)
};

export type SesionCache = {
  clave: "actual";
  token: string;
  usuario: unknown;
  sucursal: unknown;
  rol: string;
  guardado_at: string;
};

export type Meta = { clave: string; valor: unknown };

export class HuayruroDB extends Dexie {
  productos!: Table<ProductoLocal, string>;
  presentaciones!: Table<PresentacionLocal, string>;
  codigos!: Table<CodigoLocal, string>;
  precios!: Table<PrecioLocal, string>;
  stock_cache!: Table<StockCache, string>;
  cola_ops!: Table<ColaOp, string>;
  sesion_cache!: Table<SesionCache, string>;
  meta!: Table<Meta, string>;

  constructor(nombre = "huayruro-pos") {
    super(nombre);
    this.version(1).stores({
      productos: "id, nombre, updated_at, activo",
      presentaciones: "id, producto_id",
      codigos: "gtin, producto_id",
      precios: "id, producto_id",
      stock_cache: "producto_id, updated_at",
      // La cola: PK = client_uuid (idempotencia); índices por estado y orden FIFO.
      cola_ops: "client_uuid, estado, creado_at",
      sesion_cache: "clave",
      meta: "clave",
    });
  }
}

// Instancia por defecto (los tests crean la suya con nombre propio para aislarse).
export const dbLocal = new HuayruroDB();
