-- ============================================================
-- 0002_abastecimiento — Catálogo maestro (B7) + comparador de proveedores (B8)
-- DDL del plan de frentes nuevos §4.1 (decisiones D-N1..D-N8 cerradas).
-- Reglas: dinero en enteros (céntimos *_cent / diezmilésimas *_dm); timestamps ISO del Worker.
-- ============================================================

-- Catálogo maestro nacional (GLOBAL, read-only en runtime — D-N7). La ÚNICA tabla sin tenant_id:
-- es data pública (SUSALUD GTIN v4); la carga la hace el build (seeds/0002_catalogo_maestro.sql).
CREATE TABLE catalogo_maestro (
  id              TEXT PRIMARY KEY,          -- id determinista generado en carga
  gtin            TEXT UNIQUE,               -- CODIGO (GTIN13); NULL si algún día cargamos filas sin código
  nombre          TEXT NOT NULL,
  dci             TEXT,                      -- DENOMINACIONCOMUN (principio activo)
  concentracion   TEXT,
  forma           TEXT,                      -- FORMAFARMACEUTICA
  forma_simple    TEXT,                      -- FORMAFARMACEUTICASIMP
  laboratorio     TEXT,
  pais            TEXT,
  presentacion    TEXT,                      -- texto del envase
  unidades_envase INTEGER,                   -- UNIDADENVASE (factor caja→unidad cuando aplica)
  situacion       TEXT,                      -- ACTIVO/... tal cual la fuente
  registro_san    TEXT,
  fuente          TEXT NOT NULL DEFAULT 'susalud_gtin_v4',
  nombre_norm     TEXT NOT NULL              -- normalizarNombre() en carga (la MISMA del importador)
);
CREATE INDEX idx_maestro_nombre_norm ON catalogo_maestro(nombre_norm);
CREATE INDEX idx_maestro_dci ON catalogo_maestro(dci);
-- FTS5 con el mismo tokenizador que producto_fts (el test "ibúprofeno"→"IBUPROFENO" se replica aquí).
-- Contenido externo: el seed hace INSERT INTO maestro_fts(maestro_fts) VALUES('rebuild') tras cargar.
CREATE VIRTUAL TABLE maestro_fts USING fts5(nombre, dci, laboratorio,
  content='catalogo_maestro', content_rowid='rowid', tokenize="unicode61 remove_diacritics 2");

-- Proveedores (droguerías) — tenant-scoped
CREATE TABLE proveedor (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenant(id),
  nombre            TEXT NOT NULL,
  ruc               TEXT,
  contacto          TEXT,                    -- teléfono/WhatsApp del vendedor
  monto_minimo_cent INTEGER NOT NULL DEFAULT 0,
  flete_cent        INTEGER NOT NULL DEFAULT 0,  -- flete estimado Lima→provincia por pedido
  dias_entrega      INTEGER,
  activo            INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at        TEXT NOT NULL,
  UNIQUE (tenant_id, nombre)
);

-- Cabecera de una lista de precios subida
CREATE TABLE lista_precios (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenant(id),
  proveedor_id TEXT NOT NULL REFERENCES proveedor(id),
  etiqueta     TEXT NOT NULL,                -- "VES julio 2026"
  fecha_lista  TEXT NOT NULL,                -- fecha declarada de la lista
  filas_total  INTEGER NOT NULL,
  filas_match  INTEGER NOT NULL DEFAULT 0,
  estado       TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','matcheada','archivada')),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_lista_tenant ON lista_precios(tenant_id, proveedor_id);

-- Ítems (ofertas) de una lista
CREATE TABLE lista_item (
  id                  TEXT PRIMARY KEY,
  lista_id            TEXT NOT NULL REFERENCES lista_precios(id),
  fila                INTEGER NOT NULL,       -- nº de fila original (trazabilidad)
  texto_original      TEXT NOT NULL,          -- descripción tal cual la droguería
  texto_norm          TEXT NOT NULL,
  gtin                TEXT,
  laboratorio         TEXT,
  presentacion_texto  TEXT,                   -- "CAJA X 100"
  factor_unidades     INTEGER,                -- unidades base por unidad de venta del proveedor (parseado o confirmado)
  precio_cent         INTEGER NOT NULL,       -- precio de la unidad de venta del proveedor, SIN normalizar
  precio_unidad_dm    INTEGER,                -- derivado: precio por unidad base en diezmilésimas (post-bonif, B8.3)
  bonif_compra        INTEGER,                -- "10+1" → 10
  bonif_gratis        INTEGER,                -- "10+1" → 1
  vencimiento         TEXT,                   -- YYYY-MM-DD si la lista lo trae
  venc_corto          INTEGER NOT NULL DEFAULT 0 CHECK (venc_corto IN (0,1)),  -- flag derivado (umbral §6.3)
  -- resultado del matching (B8.2):
  producto_id         TEXT REFERENCES producto_catalogo(id),  -- match contra NUESTRO catálogo
  maestro_id          TEXT REFERENCES catalogo_maestro(id),   -- match contra el maestro (informativo)
  match_metodo        TEXT CHECK (match_metodo IN ('gtin','alias','nombre_exacto','fuzzy','manual')),
  match_score         REAL,
  match_estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (match_estado IN ('pendiente','auto','confirmado','descartado'))
);
CREATE INDEX idx_lista_item_lista ON lista_item(lista_id, match_estado);

-- Aliases aprendidos: cómo llama ESTE proveedor a NUESTRO producto (el matching mejora cada mes)
CREATE TABLE producto_alias (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenant(id),
  proveedor_id TEXT NOT NULL REFERENCES proveedor(id),
  texto_norm   TEXT NOT NULL,
  producto_id  TEXT NOT NULL REFERENCES producto_catalogo(id),
  creado_por   TEXT NOT NULL,                -- usuario que confirmó
  created_at   TEXT NOT NULL,
  UNIQUE (proveedor_id, texto_norm)
);

-- Pedido propuesto/decidido (por corrida del comparador — B8.3)
CREATE TABLE pedido (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenant(id),
  sucursal_id   TEXT REFERENCES sucursal(id),   -- NULL = consolidado multi-botica
  estado        TEXT NOT NULL DEFAULT 'propuesto' CHECK (estado IN ('propuesto','enviado','recibido','cancelado')),
  combo_json    TEXT NOT NULL,               -- proveedores elegidos + totales + alternativas top-3
  creado_por    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE TABLE pedido_item (
  id            TEXT PRIMARY KEY,
  pedido_id     TEXT NOT NULL REFERENCES pedido(id),
  proveedor_id  TEXT NOT NULL REFERENCES proveedor(id),
  lista_item_id TEXT REFERENCES lista_item(id),
  producto_id   TEXT NOT NULL REFERENCES producto_catalogo(id),
  unidades_base INTEGER NOT NULL,            -- lo que se necesita
  unidades_prov INTEGER NOT NULL,            -- redondeado a la unidad de venta del proveedor
  precio_cent   INTEGER NOT NULL,            -- total del renglón
  nota          TEXT                         -- "bonif 10+1 aplicada", "venc. corto aceptado"
);
CREATE INDEX idx_pedido_item_pedido ON pedido_item(pedido_id);
