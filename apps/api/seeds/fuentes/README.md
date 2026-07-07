# Fuentes del catálogo maestro (B7)

Descargadas 2026-07-06 de SUSALUD Datos Abiertos (verificadas esa fecha; los portales del Estado se caen — por eso viven en el repo):

- `CATALOGO_GTIN_v4.xlsx` — 15,181 productos × 14 columnas, última actualización 11-abr-2025.
  Origen: http://datos.susalud.gob.pe/sites/default/files/CATALOGO_GTIN_v4.xlsx
- `CATALOGO_EAN13.csv` — 8,922 filas, 24-jun-2021 (complemento: columna Fracciones = unidades por envase).
  Origen: http://datos.susalud.gob.pe/sites/default/files/CATALOGO_EAN13_0.csv

Consumidor: `scripts/gen-catalogo-maestro.mjs` (se crea en B7.1) → `apps/api/seeds/0002_catalogo_maestro.sql`.
Plan: e:\Bobeda Kevin\proyectos\botica-huayruro-sistema-automatizacion-plan-frentes-nuevos.md §5.
