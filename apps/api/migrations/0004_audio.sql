-- ============================================================
-- 0004_audio — Audio A10 casi-tiempo-real (B10)
-- DDL del plan D1 §5.4 (audio_grabacion TAL CUAL) + enmienda del plan de frentes nuevos §4.3
-- (venta_borrador → audio_senal, que cubre faltantes + ventas en una sola bandeja).
-- Reglas: timestamps ISO del Worker; todo tenant/sucursal-scoped; el audio en R2 con retención
-- de 7 días (lifecycle del prefijo audio/, paso de infra al desplegar).
--
-- En S7 (B10.1) solo se USA audio_grabacion (ingesta + transcripción Whisper); audio_senal se
-- puebla en S8 (B10.2). Aplicar la migración completa está bien (crea ambas tablas).
--
-- VETO CERRADO D-N5 (plan frentes nuevos §2.3): el audio es SOLO asistencia operativa. audio_senal
-- NO tiene operador_id A PROPÓSITO; ninguna query cruza audio con personal; JAMÁS es señal de
-- supervisión (RD 02-2020-JUS). El test tipo canal-prohibido de S8 lo verifica.
-- ============================================================

-- ── 1. Cola de grabaciones: cada chunk que sube el A10 (§5.4) ───────────────────────────────
-- Autenticado como DISPOSITIVO (dispositivo.tipo='a10_grabador', token propio — no sesión de
-- usuario). estado: subido → (Whisper) → transcrito → (señales, S8) → procesado; error/descartado
-- son terminales. La transcripción se dispara en la ingesta (ctx.waitUntil) y el Cron cada 5 min
-- barre los que quedaron 'subido' (waitUntil no llegó).
CREATE TABLE audio_grabacion (
  id             TEXT PRIMARY KEY,            -- = client_uuid del chunk (idempotencia del reintento offline)
  sucursal_id    TEXT NOT NULL REFERENCES sucursal(id),
  dispositivo_id TEXT NOT NULL REFERENCES dispositivo(id),
  r2_key         TEXT NOT NULL,
  duracion_seg   INTEGER,
  grabado_at     TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'subido' CHECK (estado IN ('subido','transcrito','procesado','descartado','error')),
  transcripcion  TEXT,
  error_detalle  TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_audio_pendiente ON audio_grabacion(estado, grabado_at) WHERE estado IN ('subido','transcrito');

-- ── 2. Señales derivadas del audio (§4.3) — enmienda a venta_borrador ───────────────────────
-- Una sola bandeja para faltantes ("no hay X") y ventas posibles. SKU/precio SIEMPRE desde D1,
-- nunca del modelo. Sin operador_id (VETO D-N5).
CREATE TABLE audio_senal (
  id           TEXT PRIMARY KEY,
  sucursal_id  TEXT NOT NULL REFERENCES sucursal(id),
  audio_id     TEXT REFERENCES audio_grabacion(id),
  tipo         TEXT NOT NULL CHECK (tipo IN ('faltante','venta_posible')),
  items_json   TEXT NOT NULL,   -- [{producto_id?, nombre_detectado, cantidad?, confianza}] — SKU/precio SIEMPRE desde D1
  estado       TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmado','descartado','autocerrado')),
  quiebre_id   TEXT,            -- si tipo=faltante y se confirmó
  venta_id     TEXT,            -- si tipo=venta_posible y el operador la registró desde el borrador
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_senal_pendiente ON audio_senal(sucursal_id, estado) WHERE estado = 'pendiente';
-- VETO (D-N5): esta tabla NO tiene operador_id a propósito. Ninguna query la cruza con personal.
