-- ============================================================
-- 0009_clientes — P1: perfil de cliente y seguimiento de tratamiento.
-- Fuente: plan D1 §5.3 (DDL) + §12 (flujo, endpoints y permisos) + §19 último bullet y plan de
-- expansión §1 final (campos añadidos: whatsapp/opt-in/RFM en `cliente`; dosis y cantidad dispensada
-- en `tratamiento`, de donde sale la fecha estimada de agotamiento).
-- El plan la nombra `0002_clientes` porque numeraba por fase; en el repo la secuencia real va en 0009.
--
-- REGLA DE NEGOCIO: el cliente es POR BOTICA (`sucursal_id NOT NULL`). La misma persona que compra en
-- dos boticas existe dos veces — correcto bajo aislamiento estricto (§4.1). NO hay matching cross-botica
-- por DNI ni por teléfono: lo único que cruza sucursales sigue siendo el consolidado de faltantes.
--
-- ROTULADO: `tratamiento` es el nombre INTERNO. En toda la UI se llama "Seguimiento" — nunca "historia
-- clínica" (§12; el encuadre legal está en el backlog §17).
--
-- FK-safe: son tablas NUEVAS que referencian tablas ya existentes (sucursal, venta, producto_catalogo).
-- No se reconstruye ninguna tabla ya referenciada → el gotcha D1 de `defer_foreign_keys` en
-- `migrations apply` NO aplica aquí (mismo razonamiento que 0008).
--
-- INTEGRIDAD DE `venta.cliente_id`: sigue siendo TEXT plano SIN FK (0001 línea 172) — SQLite no agrega
-- FK después y reconstruir `venta` está VETADO en D1 remota. La impone la aplicación: `repos/venta.ts`
-- valida antes de insertar que el cliente exista, no esté borrado y sea de LA MISMA sucursal. Una FK
-- por sí sola tampoco cubriría el caso que de verdad importa acá, que es el cliente de OTRA botica.
-- ============================================================

CREATE TABLE cliente (
  id                   TEXT PRIMARY KEY,
  sucursal_id          TEXT NOT NULL REFERENCES sucursal(id),
  nombre               TEXT NOT NULL,
  alias                TEXT,                       -- "la señora del ibuprofeno"
  dni                  TEXT,                       -- opcional: el alta rápida es nombre + teléfono (§12)
  telefono             TEXT,
  whatsapp             TEXT,                       -- expansión §1: puede diferir del teléfono de contacto
  optin_whatsapp       INTEGER NOT NULL DEFAULT 0 CHECK (optin_whatsapp IN (0,1)),
  optin_whatsapp_at    TEXT,                       -- cuándo consintió (NULL = nunca aceptó)
  optin_whatsapp_texto TEXT,                       -- el texto EXACTO que se le leyó al pedirlo
  fecha_nacimiento     TEXT,                       -- YYYY-MM-DD (los cumpleaños de la semana salen de aquí)
  alergias             TEXT,
  notas                TEXT,
  segmento_rfm         TEXT CHECK (segmento_rfm IS NULL OR segmento_rfm IN ('campeones','en_riesgo')),
  rfm_calculado_at     TEXT,                       -- lo escribe el Cron semanal de A3 (P4b), no el POS
  rostro_codigo        TEXT,                       -- P3: enlace lógico con la tabla `rostro` ("R-0047")
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT
);

-- Listado y navegación del padrón de la botica.
CREATE INDEX idx_cliente_sucursal ON cliente(sucursal_id, nombre) WHERE deleted_at IS NULL;

-- DNI OPCIONAL pero ÚNICO POR BOTICA cuando se llena (decisión de Kevin, S13). Tiene que ser un índice
-- PARCIAL: en SQLite un UNIQUE normal admite N filas con dni NULL, así que no serviría de candado para
-- el alta rápida sin documento. Con `WHERE dni IS NOT NULL` el candado solo aplica a quien sí lo cargó,
-- y `deleted_at IS NULL` deja re-registrar a alguien cuyo perfil fue borrado.
CREATE UNIQUE INDEX idx_cliente_dni_unico ON cliente(sucursal_id, dni) WHERE dni IS NOT NULL AND deleted_at IS NULL;

-- El mostrador busca por teléfono tanto como por nombre (es lo que la gente recuerda).
CREATE INDEX idx_cliente_telefono ON cliente(sucursal_id, telefono) WHERE telefono IS NOT NULL AND deleted_at IS NULL;

-- P3: el reconocimiento de rostro resuelve el cliente por este código.
CREATE INDEX idx_cliente_rostro ON cliente(sucursal_id, rostro_codigo) WHERE rostro_codigo IS NOT NULL AND deleted_at IS NULL;

-- P4/P4b: las listas de recordatorio (A2) y de reactivación (A3) filtran por opt-in y por segmento.
CREATE INDEX idx_cliente_optin ON cliente(sucursal_id, segmento_rfm) WHERE optin_whatsapp = 1 AND deleted_at IS NULL;

-- FTS5 standalone, mismo tokenizador y mismo contrato que `producto_fts` (0001 línea 96): la mantiene
-- el repo en el MISMO batch que crea/edita/borra el cliente. `remove_diacritics 2` hace que "maria"
-- encuentre a "María". El texto indexado incluye nombre, alias, DNI y teléfono — unicode61 trata cada
-- número como un token, así que el prefijo "9876*" alcanza el celular.
-- OJO: `cliente_fts` NO lleva sucursal_id. El aislamiento lo impone el JOIN contra `cliente` en el repo
-- (idéntico a producto_fts, que filtra por tenant_id). Nunca consultar esta tabla sin ese JOIN.
CREATE VIRTUAL TABLE cliente_fts USING fts5(
  cliente_id UNINDEXED, texto,
  tokenize = "unicode61 remove_diacritics 2"
);

-- Para quién más compra este cliente: "ibuprofeno para el hijo" (§12). Sin sucursal_id propio — hereda
-- el aislamiento del cliente por CASCADE.
CREATE TABLE cliente_familiar (
  id         TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  relacion   TEXT,                                 -- 'hijo', 'esposa', 'madre'…
  notas      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cliente_familiar_cliente ON cliente_familiar(cliente_id);

CREATE TABLE tratamiento (
  id                     TEXT PRIMARY KEY,
  cliente_id             TEXT NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  familiar_id            TEXT REFERENCES cliente_familiar(id),   -- NULL = para el propio cliente
  venta_id               TEXT REFERENCES venta(id),              -- de qué venta salió (opcional)
  producto_id            TEXT REFERENCES producto_catalogo(id),
  descripcion            TEXT NOT NULL,           -- "ibuprofeno 400 para el hijo, fiebre"
  duracion_dias          INTEGER,                 -- si se sabe; si no, sale de dosis y cantidad
  dosis_diaria           REAL,                    -- expansión §1 (unidades base por día)
  cantidad_dispensada    INTEGER,                 -- expansión §1 → agotamiento = cantidad ÷ dosis
  indicacion_seguimiento TEXT,                    -- lo que quien atiende debe PREGUNTAR la próxima vez
  estado                 TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','cerrado')),
  fecha_inicio           TEXT NOT NULL,           -- YYYY-MM-DD (base del cálculo de "cuándo le toca")
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

-- Sirve a las dos lecturas calientes: el panel del cliente y el barrido de seguimientos pendientes
-- (que ordena por fecha_inicio dentro de los activos). Parcial: los cerrados no se consultan nunca.
CREATE INDEX idx_tratamiento_cliente ON tratamiento(cliente_id, fecha_inicio) WHERE estado = 'activo';
-- Desde una venta al seguimiento que originó (reimpresión y auditoría del ticket).
CREATE INDEX idx_tratamiento_venta ON tratamiento(venta_id) WHERE venta_id IS NOT NULL;
