-- ============================================================
-- Seed DEMO de tratamientos crónicos (A2 v1, S16). Marca un par de SKU del catálogo SINTÉTICO para
-- que la bandeja de reposición se pueda ver funcionando el día 1, en vez de arrancar con un estado
-- vacío que no dice nada.
--
-- SOLO DOS, y no más: de los 10 productos del seed sintético estos son los únicos que una persona
-- toma TODOS LOS DÍAS de forma sostenida. Marcar un antibiótico (Amoxicilina) o un analgésico de
-- rescate (Paracetamol, Ibuprofeno) pondría a la botica a decirle a alguien "¿se lo separamos?" sobre
-- un tratamiento que NO debe recomprarse solo — es el mismo criterio con el que S15 se quedó con dos
-- reglas de venta cruzada en vez de inventar pares.
--
-- Se quitan con un tap desde Catálogo → Tratamientos crónicos → "Quitar". Los crónicos REALES los
-- marca Kevin (T-K10) cuando esté cargado el catálogo de verdad (T-K4).
-- ============================================================

UPDATE producto_catalogo
   SET es_cronico = 1,
       dosis_diaria_default = 1,   -- una unidad al día
       updated_at = '2026-07-29T00:00:00.000Z'
 WHERE id IN (
         '30000000-0000-7000-8000-000700000000',  -- Loratadina 10 mg (antialérgico de uso diario)
         '30000000-0000-7000-8000-000800000000'   -- Omeprazol 20 mg (protector gástrico de uso diario)
       )
   AND deleted_at IS NULL;
