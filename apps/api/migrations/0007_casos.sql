-- ============================================================
-- 0007_casos — B11 (S9): EBR determinista + bandeja de casos + horario de sucursal.
-- Fuente: plan frentes nuevos §4.4/§9 + plan expansión §3 B1 y §5 D1.
--
-- GOTCHA DURABLE D1 (S8.5): la D1 REMOTA enforcea las FK y NO respeta defer_foreign_keys en
-- `migrations apply` → NUNCA reconstruir (rebuild 12-step) una tabla referenciada por FK. Para columnas
-- nuevas se usa `ALTER TABLE ... ADD COLUMN` (FK-safe). Por eso el horario va como ADD COLUMN.
-- ============================================================

-- Horario declarado de la sucursal, para el indicador 'venta fuera de horario'. 'HH:MM' hora LOCAL
-- (America/Lima). NULL = sin control de horario → el indicador se salta esa botica (cero falsos
-- positivos hasta que se cargue). El cierre PUEDE cruzar medianoche (ej. apertura 14:30, cierre 00:00).
ALTER TABLE sucursal ADD COLUMN hora_apertura TEXT;   -- 'HH:MM' o NULL
ALTER TABLE sucursal ADD COLUMN hora_cierre   TEXT;   -- 'HH:MM' o NULL

-- Bandeja de casos — UNA sola para prevención de pérdidas (tipo 'perdida') y supervisión de personal
-- (tipo 'personal'). El sistema INFORMA; un humano confirma/descarta — JAMÁS sanción automática (plan
-- expansión §3 B3 / §5). VETO D-N5: el audio NUNCA alimenta un caso → este esquema no referencia
-- ninguna tabla de audio, y el test veto-audio.test.ts verifica que repos/casos.ts no las lea.
CREATE TABLE caso (
  id             TEXT PRIMARY KEY,
  sucursal_id    TEXT NOT NULL REFERENCES sucursal(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('perdida','personal')),
  indicador      TEXT NOT NULL,               -- 'cajon_sin_venta'|'anulaciones'|'venta_bajo_precio'|'descuadre'|'stock_negativo'|'fuera_horario'
  severidad      INTEGER NOT NULL DEFAULT 1 CHECK (severidad BETWEEN 1 AND 3),
  evidencia_json TEXT NOT NULL,               -- filas/fechas/montos que dispararon el umbral (nunca audio)
  estado         TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','confirmado','descartado','autocerrado')),
  revisor_id     TEXT REFERENCES usuario_perfil(id),
  notas          TEXT,
  clave_dedup    TEXT NOT NULL,               -- indicador + ventana (día/semana Lima) + sujeto → idempotencia del Cron
  created_at     TEXT NOT NULL,
  resuelto_at    TEXT
);
CREATE INDEX idx_caso_bandeja ON caso(sucursal_id, estado, severidad DESC);
-- Un solo caso por excepción: el Cron nocturno re-corre cada noche sin duplicar (INSERT OR IGNORE por esta clave).
CREATE UNIQUE INDEX idx_caso_dedup ON caso(sucursal_id, clave_dedup);
