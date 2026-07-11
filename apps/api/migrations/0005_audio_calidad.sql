-- ============================================================
-- 0005_audio_calidad — Optimización de calidad del audio A10 (B10.3)
-- Cierra el loop de calidad sobre B10.2: (1) diccionario de correcciones que APRENDE
-- (forma oída → producto), (2) reporte de calidad diario por sucursal (lo escribe el Cron),
-- (3) estado 'sin_habla' para chunks sin voz (hoy caían a 'error' y ensuciaban el panel).
-- Reglas: timestamps ISO del Worker; todo tenant/sucursal-scoped.
--
-- VETO CERRADO D-N5 (plan frentes nuevos §2.3): el audio es SOLO asistencia operativa. Ninguna de
-- estas tablas lleva operador/usuario ni cruza el audio con personal. audio_correccion es aprendizaje
-- de vocabulario (texto→producto), audio_reporte_calidad son conteos por sucursal — jamás supervisión.
-- El test del veto (tipo canal-prohibido) verifica que audio_correccion tampoco tiene columna de personal.
-- ============================================================

-- Rebuild de audio_grabacion referencia FKs de audio_senal(audio_id) → diferimos su chequeo al commit
-- (patrón D1 para reconstruir una tabla referenciada; recreamos con los MISMOS ids antes de cerrar).
PRAGMA defer_foreign_keys = TRUE;

-- ── 1. Diccionario de correcciones aprendidas (forma OÍDA normalizada → producto del tenant) ──
-- Cuando se confirma/corrige una señal de faltante, aprendemos "penasopiridina" = Fenazopiridina.
-- Alimenta dos cosas: (a) el match del audio (se consulta ANTES del FTS) y (b) el sesgo del
-- initial_prompt (los productos con corrección se priorizan en la lista que se le pasa a Whisper).
-- VETO D-N5: SIN operador/usuario a propósito. Es vocabulario, no quién estuvo en el mostrador.
CREATE TABLE audio_correccion (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenant(id),
  texto_norm  TEXT NOT NULL,                          -- normalizarNombre() de lo que se oyó ("penasopiridina")
  producto_id TEXT NOT NULL REFERENCES producto_catalogo(id),
  veces       INTEGER NOT NULL DEFAULT 1,             -- cuántas veces se reforzó (frecuencia del error)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (tenant_id, texto_norm)                      -- una forma oída mapea a un solo producto (el último gana)
);
CREATE INDEX idx_correccion_producto ON audio_correccion(tenant_id, producto_id);

-- ── 2. Reporte de calidad diario por sucursal (lo upserta el Cron cada corrida; PK sucursal+fecha) ──
-- Snapshot de la salud del audio de un día: qué se transcribió/procesó, cuántos errores/sin_habla,
-- cuántas señales y cuántas sin match / de baja confianza. El panel admin lee el historial (y calcula
-- "hoy" en vivo para que no dependa del último tick del Cron).
CREATE TABLE audio_reporte_calidad (
  sucursal_id       TEXT NOT NULL REFERENCES sucursal(id),
  fecha             TEXT NOT NULL,                    -- YYYY-MM-DD (UTC, por created_at)
  transcritos       INTEGER NOT NULL DEFAULT 0,
  procesados        INTEGER NOT NULL DEFAULT 0,
  errores           INTEGER NOT NULL DEFAULT 0,
  sin_habla         INTEGER NOT NULL DEFAULT 0,
  senales           INTEGER NOT NULL DEFAULT 0,
  senales_sin_match INTEGER NOT NULL DEFAULT 0,       -- faltantes cuyo nombre no matcheó ningún producto
  senales_baja_conf INTEGER NOT NULL DEFAULT 0,       -- señales creadas con confianza < 0.6 (dudosas)
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (sucursal_id, fecha)
);

-- ── 3. audio_grabacion: agregar 'sin_habla' al CHECK de estado (12-step, el CHECK no admite ALTER) ──
-- Chunks que Whisper procesó pero SIN voz (silencio/ruido que el RMS del cliente no cortó) ya no caen
-- a 'error' (infra) — van a 'sin_habla' (terminal benigno) para no ensuciar el panel de calidad.
CREATE TABLE audio_grabacion_nuevo (
  id             TEXT PRIMARY KEY,
  sucursal_id    TEXT NOT NULL REFERENCES sucursal(id),
  dispositivo_id TEXT NOT NULL REFERENCES dispositivo(id),
  r2_key         TEXT NOT NULL,
  duracion_seg   INTEGER,
  grabado_at     TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'subido' CHECK (estado IN ('subido','transcrito','procesado','descartado','error','sin_habla')),
  transcripcion  TEXT,
  error_detalle  TEXT,
  created_at     TEXT NOT NULL
);
INSERT INTO audio_grabacion_nuevo (id, sucursal_id, dispositivo_id, r2_key, duracion_seg, grabado_at, estado, transcripcion, error_detalle, created_at)
  SELECT id, sucursal_id, dispositivo_id, r2_key, duracion_seg, grabado_at, estado, transcripcion, error_detalle, created_at FROM audio_grabacion;
DROP TABLE audio_grabacion;
ALTER TABLE audio_grabacion_nuevo RENAME TO audio_grabacion;
CREATE INDEX idx_audio_pendiente ON audio_grabacion(estado, grabado_at) WHERE estado IN ('subido','transcrito');
