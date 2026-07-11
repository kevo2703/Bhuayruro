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

-- ── 3. audio_grabacion: marcar los chunks SIN voz (B10.3) ──────────────────────────────────
-- Chunks que Whisper procesó pero salieron SIN voz (silencio/ruido que el RMS del cliente no cortó)
-- ya no caen a 'error' (infra). Como el CHECK de `estado` no admite ALTER en SQLite y reconstruir la
-- tabla NO es viable (la D1 remota enforcea la FK audio_senal→audio_grabacion y no respeta
-- defer_foreign_keys en migrations apply → el rebuild revienta), usamos un FLAG: van a estado
-- 'procesado' (terminal, ya permitido) con `sin_habla=1`. El reporte de calidad los cuenta aparte por
-- el flag; NO ensucian el bucket de errores. `ADD COLUMN` es FK-safe (no toca ninguna relación).
ALTER TABLE audio_grabacion ADD COLUMN sin_habla INTEGER NOT NULL DEFAULT 0;
