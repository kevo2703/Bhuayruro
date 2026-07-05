-- ============================================================
-- 0001_esquema_p0 — Esquema P0 de Botica Huayruro sobre Cloudflare D1
-- Traducción de Postgres → SQLite del plan §5.2 + enmiendas Δ-P0 (§19 / plan expansión §1).
-- Reglas: dinero en enteros (diezmilésimas *_dm / céntimos *_cent, §6);
--         timestamps ISO-8601 UTC inyectados desde el Worker (no datetime('now'));
--         FKs activas por defecto → orden padre-antes-que-hijo.
-- ============================================================

-- ============ NÚCLEO ============
CREATE TABLE tenant (
  id               TEXT PRIMARY KEY,
  nombre           TEXT NOT NULL,
  nombre_comercial TEXT NOT NULL,
  ruc              TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE sucursal (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenant(id),
  nombre       TEXT NOT NULL,
  direccion    TEXT,
  zona_horaria TEXT NOT NULL DEFAULT 'America/Lima',
  activa       INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX idx_sucursal_tenant ON sucursal(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE usuario_perfil (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenant(id),
  sucursal_id   TEXT REFERENCES sucursal(id),
  rol           TEXT NOT NULL CHECK (rol IN ('super_admin','admin_sucursal','operador','lector_reportes')),
  nombre        TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,            -- formato "pbkdf2$iter$saltB64$hashB64" (auth propio, E3)
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK ((rol = 'super_admin' AND sucursal_id IS NULL) OR (rol <> 'super_admin' AND sucursal_id IS NOT NULL))
);
CREATE INDEX idx_usuario_sucursal ON usuario_perfil(sucursal_id) WHERE activo = 1;

CREATE TABLE sesion (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuario_perfil(id),
  token_hash  TEXT NOT NULL UNIQUE,        -- SHA-256 del token opaco
  creada_at   TEXT NOT NULL,
  expira_at   TEXT NOT NULL,
  ip_origen   TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sesion_usuario ON sesion(usuario_id);

CREATE TABLE login_intento (
  email       TEXT NOT NULL,
  intento_at  TEXT NOT NULL,
  exito       INTEGER NOT NULL CHECK (exito IN (0,1))
);
CREATE INDEX idx_login_email_fecha ON login_intento(email, intento_at DESC);

CREATE TABLE dispositivo (
  id          TEXT PRIMARY KEY,
  sucursal_id TEXT NOT NULL REFERENCES sucursal(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('a10_grabador','camara_hikvision')),
  nombre      TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  activo      INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at  TEXT NOT NULL
);

-- ============ CATÁLOGO (compartido a nivel tenant) ============
CREATE TABLE producto_catalogo (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenant(id),
  sku_interno      TEXT,
  nombre           TEXT NOT NULL,
  presentacion     TEXT,
  laboratorio      TEXT,
  principio_activo TEXT,
  categoria        TEXT,
  requiere_receta  INTEGER NOT NULL DEFAULT 0 CHECK (requiere_receta IN (0,1)),
  es_cronico          INTEGER NOT NULL DEFAULT 0 CHECK (es_cronico IN (0,1)),  -- Δ4
  dosis_diaria_default REAL,                                                   -- Δ4: unidades base/día
  activo           INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE INDEX idx_producto_tenant ON producto_catalogo(tenant_id) WHERE deleted_at IS NULL;

-- FTS5 standalone (el repo la mantiene en el MISMO batch que crea/edita el producto)
CREATE VIRTUAL TABLE producto_fts USING fts5(
  producto_id UNINDEXED, texto,
  tokenize = "unicode61 remove_diacritics 2"
);

-- Δ1: presentaciones / fraccionamiento (stock SIEMPRE en unidades base)
CREATE TABLE presentacion (
  id              TEXT PRIMARY KEY,
  producto_id     TEXT NOT NULL REFERENCES producto_catalogo(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,          -- 'tableta', 'blíster x10', 'caja x100'
  factor_unidades INTEGER NOT NULL CHECK (factor_unidades > 0),  -- en unidades base
  es_base         INTEGER NOT NULL DEFAULT 0 CHECK (es_base IN (0,1)),
  activa          INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1)),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_presentacion_producto ON presentacion(producto_id) WHERE activa = 1;

CREATE TABLE codigo_barras (
  id             TEXT PRIMARY KEY,
  producto_id    TEXT NOT NULL REFERENCES producto_catalogo(id) ON DELETE CASCADE,
  presentacion_id TEXT REFERENCES presentacion(id),   -- Δ1: el GTIN de la caja ≠ el del blíster
  gtin           TEXT NOT NULL UNIQUE,
  es_unidad      INTEGER NOT NULL DEFAULT 1 CHECK (es_unidad IN (0,1)),
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_gtin ON codigo_barras(gtin);

-- ============ PRECIOS (por botica, por presentación — Δ1) ============
CREATE TABLE precio_local (
  id                TEXT PRIMARY KEY,
  producto_id       TEXT NOT NULL REFERENCES producto_catalogo(id) ON DELETE CASCADE,
  sucursal_id       TEXT NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
  presentacion_id   TEXT NOT NULL REFERENCES presentacion(id),  -- Δ1
  precio_compra_dm  INTEGER,                -- diezmilésimas (numeric(10,4) × 10000)
  precio_sin_igv_dm INTEGER NOT NULL CHECK (precio_sin_igv_dm >= 0),
  igv_dm            INTEGER NOT NULL,       -- ex-GENERATED: lo calcula el Worker (§6)
  precio_total_dm   INTEGER NOT NULL,       -- ex-GENERATED
  vigente_desde     TEXT NOT NULL,
  vigente_hasta     TEXT,                   -- NULL = vigente
  created_at        TEXT NOT NULL,
  UNIQUE (producto_id, sucursal_id, presentacion_id, vigente_desde)  -- Δ1
);
CREATE INDEX idx_precio_vigente ON precio_local(producto_id, sucursal_id, presentacion_id) WHERE vigente_hasta IS NULL;

-- ============ INVENTARIO + LOTES (por botica; stock en unidades base) ============
CREATE TABLE inventario_local (
  id             TEXT PRIMARY KEY,
  sucursal_id    TEXT NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
  producto_id    TEXT NOT NULL REFERENCES producto_catalogo(id),
  stock_unidades INTEGER NOT NULL DEFAULT 0,   -- SIN CHECK >= 0 a propósito (la realidad física manda)
  stock_minimo   INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  UNIQUE (sucursal_id, producto_id)
);
CREATE INDEX idx_inventario_sucursal ON inventario_local(sucursal_id);
CREATE INDEX idx_inventario_bajo ON inventario_local(sucursal_id) WHERE stock_unidades <= stock_minimo;

CREATE TABLE lote (
  id                TEXT PRIMARY KEY,
  inventario_id     TEXT NOT NULL REFERENCES inventario_local(id) ON DELETE CASCADE,
  numero_lote       TEXT NOT NULL,
  fecha_vencimiento TEXT NOT NULL,             -- YYYY-MM-DD
  unidades          INTEGER NOT NULL DEFAULT 0 CHECK (unidades >= 0),  -- CHECK = candado anti-carrera FEFO (§7.4)
  proveedor         TEXT,
  fecha_recepcion   TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_lote_inventario_fefo ON lote(inventario_id, fecha_vencimiento ASC) WHERE unidades > 0;

-- ============ VENTAS ============
CREATE TABLE venta (
  id                TEXT PRIMARY KEY,
  client_uuid       TEXT NOT NULL UNIQUE,      -- idempotencia (UUID v7 del POS)
  sucursal_id       TEXT NOT NULL REFERENCES sucursal(id),
  operador_id       TEXT REFERENCES usuario_perfil(id),
  cliente_id        TEXT,                      -- P1 (tabla cliente en 0002); TEXT plano en P0 (SQLite no agrega FK después)
  fecha_hora        TEXT NOT NULL,             -- la del server
  fecha_hora_cliente TEXT,                     -- ISO del POS (ventas offline tardías)
  atencion_inicio   TEXT,                      -- Δ2: carrito vacío → 1 ítem (tiempo de servicio)
  subtotal_sin_igv_cent INTEGER NOT NULL,      -- céntimos (numeric(10,2) × 100)
  igv_total_cent    INTEGER NOT NULL,
  total_cent        INTEGER NOT NULL,
  metodo_pago       TEXT NOT NULL CHECK (metodo_pago IN ('efectivo','yape','plin','tarjeta','transferencia','otro')),
  estado            TEXT NOT NULL DEFAULT 'completada' CHECK (estado IN ('completada','anulada')),
  observaciones     TEXT,
  anulada_motivo    TEXT,                      -- separado de observaciones
  sunat_estado      TEXT, sunat_serie TEXT, sunat_numero INTEGER,  -- reservado formalización
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_venta_sucursal_fecha ON venta(sucursal_id, fecha_hora DESC);

CREATE TABLE venta_item (
  id                         TEXT PRIMARY KEY,
  venta_id                   TEXT NOT NULL REFERENCES venta(id) ON DELETE CASCADE,
  producto_id                TEXT NOT NULL REFERENCES producto_catalogo(id),
  presentacion_id            TEXT NOT NULL REFERENCES presentacion(id),  -- Δ1
  cantidad_presentacion      INTEGER NOT NULL CHECK (cantidad_presentacion > 0),  -- Δ1: unidades de la presentación
  cantidad                   INTEGER NOT NULL CHECK (cantidad > 0),      -- unidades base = cantidad_presentacion × factor
  precio_sin_igv_unitario_dm INTEGER NOT NULL,
  igv_unitario_dm            INTEGER NOT NULL,
  precio_total_unitario_dm   INTEGER NOT NULL,
  subtotal_sin_igv_cent      INTEGER NOT NULL,
  igv_subtotal_cent          INTEGER NOT NULL,
  total_cent                 INTEGER NOT NULL,
  created_at                 TEXT NOT NULL
);
CREATE INDEX idx_venta_item_venta ON venta_item(venta_id);
CREATE INDEX idx_venta_item_producto ON venta_item(producto_id);

CREATE TABLE venta_item_lote (               -- arreglo #1: FEFO en cascada por lote
  id            TEXT PRIMARY KEY,
  venta_item_id TEXT NOT NULL REFERENCES venta_item(id) ON DELETE CASCADE,
  lote_id       TEXT NOT NULL REFERENCES lote(id),
  unidades      INTEGER NOT NULL CHECK (unidades > 0)
);
CREATE INDEX idx_vil_item ON venta_item_lote(venta_item_id);
CREATE INDEX idx_vil_lote ON venta_item_lote(lote_id);

-- ============ MOVIMIENTOS / RECEPCIÓN / CAJA / QUIEBRES ============
CREATE TABLE movimiento_stock (
  id            TEXT PRIMARY KEY,
  client_uuid   TEXT NOT NULL UNIQUE,
  sucursal_id   TEXT NOT NULL REFERENCES sucursal(id),
  producto_id   TEXT NOT NULL REFERENCES producto_catalogo(id),
  lote_id       TEXT REFERENCES lote(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('recepcion','venta','anulacion','ajuste_inventario','vencimiento','merma')),
  cantidad      INTEGER NOT NULL,             -- signo: + entrada, - salida
  motivo        TEXT,
  referencia_id TEXT,                         -- venta_id / recepcion_id según tipo
  operador_id   TEXT REFERENCES usuario_perfil(id),
  fecha_hora    TEXT NOT NULL
);
CREATE INDEX idx_movimiento_sucursal_fecha ON movimiento_stock(sucursal_id, fecha_hora DESC);

CREATE TABLE recepcion (
  id          TEXT PRIMARY KEY,
  client_uuid TEXT NOT NULL UNIQUE,
  sucursal_id TEXT NOT NULL REFERENCES sucursal(id),
  proveedor   TEXT,
  observaciones TEXT,
  operador_id TEXT REFERENCES usuario_perfil(id),
  fecha_hora  TEXT NOT NULL
);

CREATE TABLE cierre_caja (
  id             TEXT PRIMARY KEY,
  sucursal_id    TEXT NOT NULL REFERENCES sucursal(id),
  fecha          TEXT NOT NULL,               -- YYYY-MM-DD (America/Lima, resuelta en Worker)
  total_efectivo_cent INTEGER NOT NULL DEFAULT 0,
  total_yape_cent     INTEGER NOT NULL DEFAULT 0,
  total_otros_cent    INTEGER NOT NULL DEFAULT 0,
  total_sistema_cent  INTEGER NOT NULL,       -- ventas 'completada' del día (server)
  diferencia_cent     INTEGER NOT NULL,       -- ex-GENERATED: efectivo+yape+otros−sistema (Worker)
  observaciones  TEXT,
  cerrado_por    TEXT REFERENCES usuario_perfil(id),
  cerrado_at     TEXT NOT NULL,
  UNIQUE (sucursal_id, fecha)
);

CREATE TABLE quiebre (
  id              TEXT PRIMARY KEY,
  client_uuid     TEXT NOT NULL UNIQUE,
  sucursal_id     TEXT NOT NULL REFERENCES sucursal(id),
  operador_id     TEXT REFERENCES usuario_perfil(id),
  producto_id     TEXT REFERENCES producto_catalogo(id),
  gtin_consultado TEXT,
  descripcion_libre TEXT,
  fecha_hora      TEXT NOT NULL
);
CREATE INDEX idx_quiebre_sucursal_fecha ON quiebre(sucursal_id, fecha_hora DESC);

-- Δ3: eventos de caja (aperturas de cajón)
CREATE TABLE evento_caja (
  id          TEXT PRIMARY KEY,
  client_uuid TEXT NOT NULL UNIQUE,
  sucursal_id TEXT NOT NULL REFERENCES sucursal(id),
  operador_id TEXT REFERENCES usuario_perfil(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('apertura_venta','no_sale','apertura_sin_venta')),
  venta_id    TEXT REFERENCES venta(id),
  motivo      TEXT,
  fecha_hora  TEXT NOT NULL
);
CREATE INDEX idx_evento_caja_sucursal_fecha ON evento_caja(sucursal_id, fecha_hora DESC);

-- ============ AUDITORÍA (sin FKs a propósito: nunca debe impedir/abortar nada) ============
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  sucursal_id   TEXT,
  usuario_id    TEXT,
  accion        TEXT NOT NULL,
  recurso       TEXT,
  recurso_id    TEXT,
  datos_antes   TEXT,     -- JSON
  datos_despues TEXT,     -- JSON
  ip_origen     TEXT,
  user_agent    TEXT,
  fecha_hora    TEXT NOT NULL
);
CREATE INDEX idx_audit_usuario_fecha ON audit_log(usuario_id, fecha_hora DESC);
CREATE INDEX idx_audit_recurso ON audit_log(recurso, recurso_id);

-- ============ Δ5: reglas de venta cruzada (solo esquema en P0; UI en P4) ============
CREATE TABLE regla_sugerencia (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  disparador_tipo TEXT NOT NULL CHECK (disparador_tipo IN ('producto','categoria','principio_activo')),
  disparador_valor TEXT NOT NULL,
  sugerido_producto_id TEXT NOT NULL REFERENCES producto_catalogo(id),
  guion TEXT NOT NULL,                 -- redactado como CONSEJO profesional, no como oferta
  prioridad INTEGER NOT NULL DEFAULT 0,
  activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE sugerencia_evento (       -- eventos por sucursal (conversión real)
  id TEXT PRIMARY KEY,
  sucursal_id TEXT NOT NULL REFERENCES sucursal(id),
  regla_id TEXT NOT NULL REFERENCES regla_sugerencia(id),
  venta_id TEXT REFERENCES venta(id),
  resultado TEXT NOT NULL CHECK (resultado IN ('mostrada','aceptada','rechazada')),
  fecha_hora TEXT NOT NULL
);
CREATE INDEX idx_sugerencia_evento_regla ON sugerencia_evento(regla_id);
