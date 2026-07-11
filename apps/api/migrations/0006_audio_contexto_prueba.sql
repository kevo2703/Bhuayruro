-- ============================================================
-- 0006_audio_contexto_prueba — B10.4 (contexto y auditoría del audio para el piloto de 3 meses)
-- Dos columnas, ambas por ADD COLUMN (FK-safe). GOTCHA DURABLE (B10.3): la D1 REMOTA enforcea las FKs
-- y NO respeta defer_foreign_keys en `wrangler d1 migrations apply` → NUNCA reconstruir una tabla
-- referenciada por FK (audio_senal→audio_grabacion, producto_catalogo←todo el catálogo). ADD COLUMN
-- no toca ninguna relación → seguro en local Y remoto.
-- Reglas de siempre: timestamps ISO del Worker; todo tenant/sucursal-scoped en el runtime.
--
-- VETO D-N5 (§2.3): `frase` es contexto de la transcripción (texto ambiente), NUNCA identidad de
-- personal. audio_senal sigue sin operador_id; el test del veto (tipo canal-prohibido) lo verifica.
-- ============================================================

-- ── 1. Contexto de la señal (B10.4.2) ───────────────────────────────────────────────────────
-- La FRASE de la transcripción donde se mencionó el producto ("no hay paracetamol para el bebé"),
-- ya recortada, para que la señal sea accionable. Sin contexto, "crema hidratante — venta posible
-- 90%" es inaccionable (lo que Kevin vio en la bandeja en vivo). La transcripción COMPLETA del chunk
-- se lee por JOIN a audio_grabacion.transcripcion; esta columna guarda solo la frase-fuente.
ALTER TABLE audio_senal ADD COLUMN frase TEXT;

-- ── 2. Catálogo de PRUEBA (B10.4.1) ─────────────────────────────────────────────────────────
-- Marca los productos promovidos desde el catálogo maestro (SUSALUD, solo MEDICAMENTOS) con 100u de
-- stock, para dar al matcher del audio algo contra qué pegar durante el piloto. Es data de prueba:
-- se PURGA trivialmente (WHERE es_prueba = 1) antes de cargar el catálogo real (T-K4). El catálogo
-- real y el alta manual dejan es_prueba = 0 (default). Flag, igual patrón que sin_habla (0005).
ALTER TABLE producto_catalogo ADD COLUMN es_prueba INTEGER NOT NULL DEFAULT 0;
