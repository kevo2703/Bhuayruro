-- ============================================================
-- 0003_recepcion_borrador — Bot de Telegram de inventario (B9)
-- DDL del plan de frentes nuevos §4.2 (decisión cerrada D-N4: el bot registra lo que LLEGA
-- → bandeja de aprobación web → recepción REAL por el MISMO camino del kardex).
-- Reglas: dinero en enteros (céntimos); timestamps ISO del Worker; todo tenant-scoped salvo
-- el catálogo maestro (D-N7). Los secretos (token del bot, secret del webhook) van por
-- `wrangler secret`, NUNCA en el esquema ni en el código (§7.1 / T-K12).
-- ============================================================

-- ── 1. Ampliar dispositivo.tipo con 'telegram_bot' ─────────────────────────────
-- El CHECK de dispositivo.tipo no admite ALTER en SQLite → recrear la tabla copiando datos
-- (patrón "12-step" de SQLite; ninguna tabla referencia dispositivo por FK, así que basta
-- crear-copiar-soltar-renombrar). El bot NO usa un token de dispositivo (su allowlist vive en
-- bot_chat), pero mantenemos el catálogo de tipos coherente para el futuro A10/Hikvision.
CREATE TABLE dispositivo_nuevo (
  id          TEXT PRIMARY KEY,
  sucursal_id TEXT NOT NULL REFERENCES sucursal(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('a10_grabador','camara_hikvision','telegram_bot')),
  nombre      TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  activo      INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  created_at  TEXT NOT NULL
);
INSERT INTO dispositivo_nuevo (id, sucursal_id, tipo, nombre, token_hash, activo, created_at)
  SELECT id, sucursal_id, tipo, nombre, token_hash, activo, created_at FROM dispositivo;
DROP TABLE dispositivo;
ALTER TABLE dispositivo_nuevo RENAME TO dispositivo;

-- ── 2. Estado de conversación del bot (máquina de estados chica — sin framework, §7.2) ──
-- Allowlist DURA: solo chats vinculados (con usuario_id) responden; cualquier otro = silencio.
-- Δ sobre §4.2: agregamos tenant_id (aislamiento del borrador que crea), ultimo_producto_json
-- (atajo /lote = misma caja repetida) y ultimo_update_id (idempotencia por update_id de Telegram).
CREATE TABLE bot_chat (
  chat_id              TEXT PRIMARY KEY,             -- chat_id de Telegram (numérico, como texto)
  tenant_id            TEXT REFERENCES tenant(id),
  usuario_id           TEXT REFERENCES usuario_perfil(id),  -- a quién está vinculado (allowlist)
  sucursal_id          TEXT REFERENCES sucursal(id),
  estado               TEXT NOT NULL DEFAULT 'inicio',      -- inicio|producto|producto_ok|lote|lote_ok|precio|blister|cantidad|ubicacion|resumen
  borrador_json        TEXT NOT NULL DEFAULT '{}',
  ultimo_producto_json TEXT,                         -- último producto confirmado (para el atajo /lote)
  ultimo_update_id     INTEGER NOT NULL DEFAULT 0,   -- dedup: Telegram reenvía el mismo update_id
  updated_at           TEXT NOT NULL
);

-- ── 3. Códigos de vinculación de un chat (los genera el admin en la web, §7.1) ──────────
-- El admin genera un código de 6 dígitos (expira 10 min); la persona lo manda al bot como
-- `/vincular 123456`. Al usarse, se crea/actualiza bot_chat y el código queda 'usado'.
CREATE TABLE bot_vinculacion (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenant(id),
  sucursal_id TEXT NOT NULL REFERENCES sucursal(id),
  usuario_id  TEXT NOT NULL REFERENCES usuario_perfil(id),  -- a quién quedará vinculado el chat
  codigo      TEXT NOT NULL,                 -- 6 dígitos
  expira_at   TEXT NOT NULL,
  usado       INTEGER NOT NULL DEFAULT 0 CHECK (usado IN (0,1)),
  created_at  TEXT NOT NULL
);
-- Búsqueda por código activo (no usado). La unicidad entre códigos ACTIVOS se garantiza al generar.
CREATE INDEX idx_vinculacion_codigo ON bot_vinculacion(codigo, usado);

-- ── 4. Bandeja de aprobación: lo que el bot entendió, pendiente de un admin en la web (§7.4) ──
CREATE TABLE recepcion_borrador (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenant(id),
  sucursal_id   TEXT NOT NULL REFERENCES sucursal(id),
  chat_id       TEXT,                          -- origen (chat de Telegram)
  -- payload: {producto_texto, producto_id?, maestro_id?, gtin?, lote, vencimiento(YYYY-MM-DD),
  --           precio_unidad_cent, precio_blister_cent?, unidades_por_blister?, cantidad,
  --           ubicacion, fotos:[r2_keys], confianza_ocr}
  payload_json  TEXT NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  revisado_por  TEXT REFERENCES usuario_perfil(id),
  recepcion_id  TEXT,                          -- FK lógica a la recepción real creada al aprobar
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_borrador_pendiente ON recepcion_borrador(sucursal_id, estado) WHERE estado = 'pendiente';
