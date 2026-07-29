-- ============================================================
-- P4a (A4) — Reglas de venta cruzada DEMO, activas.
--
-- Kevin decidió en la spec de S15 arrancar con reglas demo ACTIVAS para poder ver la conversión
-- funcionando hoy; las 5–10 reales son T-K8 y se cargan desde `#/sugerencias` cuando esté el
-- catálogo real (T-K4). Estas dos apuntan al catálogo SINTÉTICO del seed 0001, así que si ese
-- catálogo se purga, estas reglas se van con él (la FK a producto_catalogo no admite huérfanos).
--
-- Marcador de "demo": el prefijo `90000000-0000-7000-8000-` en el id — misma convención que usa la
-- purga del catálogo sintético del importador. La pantalla las rotula y las borra de un tap.
--
-- CONTENIDO: con los 10 SKU sintéticos, el único par de venta cruzada honesto es AINE oral →
-- protector gástrico. Todo lo demás que se podría armar con este catálogo sería inventar una
-- indicación clínica, y el veto §2 A4 es explícito: consejo del que atiende, nunca sobreventa.
--
-- Aplicar:
--   wrangler d1 execute huayruro-db --local  --file apps/api/seeds/0003_reglas_sugerencia_demo.sql
--   wrangler d1 execute huayruro-db --remote --file apps/api/seeds/0003_reglas_sugerencia_demo.sql
-- ============================================================

INSERT OR IGNORE INTO regla_sugerencia
  (id, tenant_id, disparador_tipo, disparador_valor, sugerido_producto_id, guion, prioridad, activa, created_at)
VALUES
  -- 1) Antiinflamatorio oral → protector gástrico. El disparador es el principio activo porque en el
  --    catálogo real viene con la concentración pegada ("Ibuprofeno 400 mg") y la regla debe pegarle
  --    a todas las concentraciones sin curar una regla por cada una.
  ('90000000-0000-7000-8000-0000000000e1',
   '10000000-0000-7000-8000-000000000001',
   'principio_activo', 'Ibuprofeno',
   '30000000-0000-7000-8000-000800000000',
   'Si lo va a tomar más de dos días, un protector gástrico le cuida el estómago.',
   10, 1, '2026-07-28T00:00:00.000Z'),

  -- 2) Antibiótico → protector gástrico. Va por CATEGORÍA (y no por principio activo) a propósito:
  --    así cubre a cualquier antibiótico del catálogo sin listarlos uno por uno, y de paso el motor
  --    ejercita los dos tipos de disparador en la demo.
  ('90000000-0000-7000-8000-0000000000e2',
   '10000000-0000-7000-8000-000000000001',
   'categoria', 'Antibiótico',
   '30000000-0000-7000-8000-000800000000',
   'El antibiótico suele caer pesado. Con algo de comida ayuda; si igual le molesta el estómago, esto le calma.',
   5, 1, '2026-07-28T00:00:00.000Z');
