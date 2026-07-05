# ADR-011 — Semántica de `db.batch()` y FTS5 en Cloudflare D1 (spike E0)

- **Estado:** aceptado
- **Fecha:** 2026-07-04
- **Contexto:** plan D1 §2.2 (spike bloqueante) y §7 (venta atómica). El diseño de la venta depende de 4 supuestos de D1 no citados textualmente en la doc oficial. Este ADR los verifica en **local** (Miniflare vía `@cloudflare/vitest-pool-workers`) y en **remoto** (D1 real, Worker desplegado en `huayruro.k-alexander-m-g.workers.dev`).

## Método

Una sola función `apps/api/src/spike.ts::runSpike(db)` corre idéntica en los dos entornos:

- **Local:** `apps/api/test/spike.test.ts` con `@cloudflare/vitest-pool-workers` (runtime workerd + D1 de Miniflare).
- **Remoto:** ruta temporal `GET /api/spike` (gated por token) contra la D1 `huayruro-db`; retirada del código tras este ADR (los artefactos `spike.ts` + `spike.test.ts` quedan como registro reproducible).

Solo toca tablas `spike_*`, creadas y borradas por la propia función.

## Resultados — TODO VERDE en local Y remoto

| # | Supuesto verificado | Local | Remoto | Evidencia remota |
|---|---|---|---|---|
| (a) | **Visibilidad intra-batch:** un `INSERT` en el statement 1 es visible para un `INSERT … SELECT … WHERE EXISTS` en el statement 2 del mismo `db.batch()` | ✅ | ✅ | `a_hijos_insertados: 1` |
| (b) | **Rollback por CHECK:** un `CHECK` violado en el statement N revierte los statements 1..N-1 del batch (transacción atómica) | ✅ | ✅ | `b_abortó: true, b_saldo_c1: 5, b_filas_c2: 0` |
| (c) | **`ON CONFLICT DO NOTHING`** dentro del batch no pisa la fila existente y continúa | ✅ | ✅ | `c_val_k1: first, c_total: 2` |
| (d) | **FTS5 standalone** con `tokenize="unicode61 remove_diacritics 2"`: buscar sin tilde matchea contenido con tilde (`ibuprofeno`↔`ibúprofeno`, `paracétamol`↔`paracetamol`) | ✅ | ✅ | `d_match_ibuprofeno: 1, d_match_paracetamol: 1` |

## Decisión

- **Se confirma el PLAN A del §7 (venta atómica con guardas `EXISTS` dentro de un solo `db.batch()`).** No se activa el plan B del §7.5 — la visibilidad intra-batch y el rollback por CHECK funcionan como el diseño asume, en local y en la D1 real.
- **FTS5 con `remove_diacritics 2` sirve** para el buscador de catálogo sin tildes (E5). Miniflare local también trae FTS5 compilado.

## Lección operativa (afecta E5/E6/repos remotos) — reintento sobre "Network connection lost"

Durante el spike, la **D1 REMOTA** (sobre todo recién provisionada) devolvió de forma **intermitente** `D1_ERROR: Network connection lost` en ráfagas de writes por *binding* (fallaba en statements distintos entre corridas; `SELECT 1`, `wrangler d1 execute`, y writes aislados sí funcionaban). En **local (Miniflare) no ocurre nunca**.

Mitigación adoptada y a estandarizar en los repos (`apps/api/src/repos/`):

1. **Reintento** sobre el error transitorio `Network connection lost` (backoff corto; ver `withRetry` en `spike.ts`). Seguro para `db.batch()` (atómico) y DDL idempotente. Cuidado al reintentar writes no-idempotentes fuera de batch.
2. **Menos round-trips:** agrupar DDL/statements sueltos en un solo `db.exec(...)` cuando aplique.
3. La venta ya reintenta por otra causa (carrera de lote / CHECK, §7.4): ese mismo lazo debe además tolerar `Network connection lost`.

## Datos de infraestructura

- Cuenta CF: `f36301c3df2903a6e000dcff985d2b53`.
- D1 `huayruro-db`: `da708485-cabe-4c4a-a05a-113a49f69603` (región ENAM).
- Worker: `huayruro` → `https://huayruro.k-alexander-m-g.workers.dev` (con `X-Robots-Tag: noindex`).
