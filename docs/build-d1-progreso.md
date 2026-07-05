# Build D1 — Progreso (fuente de verdad de la ejecución)

> **Protocolo:** cada sesión de build (Opus 4.8, máximo esfuerzo) lee este archivo PRIMERO, ejecuta ÚNICAMENTE la siguiente SESIÓN pendiente (S1/S2/S3, cada una = 2 bloques), y lo actualiza al cerrar. Un checkbox solo se marca con su verificación en verde. Si algo bloquea, va a "Bloqueado" — nunca se improvisa alrededor de un gate.
>
> Plan maestro: `e:\Bobeda Kevin\proyectos\botica-huayruro-sistema-automatizacion-plan-d1.md` (incluida adenda §19).
> Plan de expansión: `e:\Bobeda Kevin\proyectos\botica-huayruro-sistema-automatizacion-plan-expansion.md`.
> Rama: `d1-rebuild` (commit por entregable: "E<N>: <qué>").

**Estado global:** 🟢 S2 (B3+B4) — **GATE E6.3 y GATE E7.2 verdes**; toda la API de venta/catálogo/recepción/caja + la fundación offline (Dexie/cola/flusher/banner) listas y probadas (API 32/32, PWA 5/5). Falta SOLO la **capa de páginas React** (cutover Supabase→D1 en Login/useSession/Mostrador + pantallas Recepción/Inventario/Caja) → necesita **sesión con navegador** (Playwright/E12). · **Siguiente sesión: capa de páginas PWA + S3 (B5+B6)**

## Mapa de sesiones y qué leer en cada una (ahorro de tokens: NO releer el plan completo)

| Sesión | Bloques | Lecturas (además de este archivo) |
|---|---|---|
| **S1** | B1 + B2 | Plan D1 COMPLETO (única sesión que lo lee entero, incluida adenda §19) + §1 del plan de expansión |
| **S2** | B3 + B4 | Plan D1 SOLO §6, §7, §8, §9, §11 + adenda §19 |
| **S3** | B5 + B6 | Plan D1 SOLO §3, §8, §10, §11, §18 (checklist E12) |

**Disciplina de tokens (aplica siempre):** tests con reporter silencioso (`--reporter=dot`) y SOLO del paquete tocado mientras desarrollas; la suite completa se corre UNA vez por gate 🚧. Salidas largas de comandos → `| tail -20`. No relee archivos ya en contexto, no imprime archivos completos en el chat, no lanza subagentes salvo necesidad real. La actualización del vault (regla 7) se hace UNA vez por sesión al cierre, no por bloque. Mensaje final: máx. 10 líneas.

---

## B1 — Cimientos (E0 spike + E1 esquema + E2 dinero)

- [x] E0.1 `apps/api` creado (Hono + wrangler.jsonc), `wrangler d1 create huayruro-db` (`da708485-…`), binding DB, assets binding
- [x] E0.2 `@cloudflare/vitest-pool-workers` corriendo (0.8.71 / vitest 2.1.9 / wrangler 4.107)
- [x] E0.3 **SPIKE** (plan §2.2): visibilidad intra-batch ✅ · rollback por CHECK ✅ · ON CONFLICT en batch ✅ · FTS5 remove_diacritics ✅ — **local Y remoto**. Documentado en `docs/adr/011-d1-batch-semantica.md`. **Plan A del §7 confirmado (sin plan B).** Lección: D1 remoto arroja "Network connection lost" transitorio → `withRetry` en repos/base.ts
- [x] E0.4 Keys Supabase muertas eliminadas de `.env.local`
- [x] E1.1 `0001_esquema_p0.sql` = DDL §5.2 **+ Δ1-Δ5** (24 tablas) — aplicada local
- [x] E1.2 Seeds (§5.6) aplicados **local** (10 SKU / 30 precios / 30 inv / 30 lotes / 20 presentaciones / 4 usuarios). Generador: `scripts/gen-seed-d1.mjs`. *(Remoto diferido a después del GATE 3 / E12 con catálogo real T-K4.)*
- [x] E2.1 `packages/shared/src/calculos/dinero.ts` (espec §6.2)
- [x] E2.2 🚧 **GATE 1-2 VERDE:** golden tests §6.3 (60 tests: 10 SKUs × {1,2,3,7} + carritos mixtos + propiedad 1000 + round-trip + regresión total≠round(S×1.18))

## B2 — Seguridad (E3 auth + E4 aislamiento)

- [x] E3.1 Auth: PBKDF2-SHA256 (310k)/WebCrypto, tabla `sesion` (solo SHA-256 del token), cookie+token, sesión deslizante 30d, rate-limit login 5/15min; login/logout/me/password
- [x] E3.2 Middleware `requiereAuth` (actor usuario|dispositivo) + guards de rol + repos con scoping (`env.DB` inyectado SOLO en `repos/contexto.ts`). Regla ESLint escrita (`apps/api/.eslintrc.cjs`); **enforcement real = test #14** (eslint9 sin flat config es deuda preexistente)
- [x] E4.1 Los 14 casos de §4.4 escritos (13 HTTP en `test/aislamiento.test.ts` + #14 en `test/canal-prohibido.test.ts`)
- [x] E4.2 🚧 **GATE 3 (BLOQUEANTE) VERDE:** 17/17 en apps/api (14/14 aislamiento). Datos reales ya habilitados para E12

## B3 — Venta (E5 catálogo + E6 venta atómica)

- [x] E5.1 Endpoints catálogo/precios/sync + FTS5 (test "ibúprofeno"→"Ibuprofeno" verde) + selector de presentación (Δ1). `catalogo.ts`: `porGtin`, `sync` (delta+tombstones), CRUD+FTS en batch, `precioRepo.crearVersion`; rutas barcode/sync/CRUD/POST precios (commit f3f3b70)
- [~] E5.2 PWA conectada — **API/data ✓, páginas pendientes.** ✓ `api.ts` (cliente tipado), `sync.ts` (pull→Dexie), `useCatalogoLocal` (búsqueda local sin tildes). ⏳ **cutover de páginas** (`LoginPage`/`useSession` a `/api/auth`, swap de `useCatalogo` en Mostrador) = **sesión con navegador**
- [x] E6.1 `POST /api/ventas` = batch §7.3 TAL CUAL (guardas EXISTS, FEFO cascada, venta_item_lote, retry por CHECK, advertencias, Δ3 evento_caja apertura_venta) (commit 1fcf301)
- [x] E6.2 Anulación §7.6 (guarda por `anulada_motivo` prefijado; sin doble reposición) (commit 1fcf301)
- [x] E6.3 🚧 **GATE VERDE (9 tests):** reintento idéntico · carrera de client_uuid · carrera de lote (CHECK-rollback-retry, sin negativos) · remanente sin lote · doble anulación (409) · golden dinero vía HTTP (S/15.00, S/105.00, regresión total≠round(S×1.18)) · blíster Δ1 factor 10 (commit bc20874)

## B4 — Offline + operación (E7 cola + E8 recepción/caja)

- [x] E7.1 Dexie completo (esquema §9) + flusher FIFO con backoff (1s/5s/30s/5min) + banner de estado + uuidv7 (shared). `db-local.ts`/`cola.ts`/`useEstadoSync.ts`/`BannerSync.tsx` (commit bedfc78)
- [x] E7.2 🚧 **GATE VERDE (ambos lados):** cliente (modo avión→online→3 confirmadas únicas + backoff + rechazada) y D1 (3 client_uuids × 2 envíos → 3 ventas únicas, stock 1 vez) (commits bedfc78, c641f64)
- [~] E8.1 Recepción — **API ✓, UI pendiente.** `POST /recepciones` idempotente + upsert lote (mismo número+venc suma) + dedupe intra-request; crea inventario si falta (commit a827b14). ⏳ pantalla `Recepcion.tsx`
- [~] E8.2 Ajuste de inventario (ya en S1) + **lotes por vencer** `GET /inventario/lotes?vence_antes=` ✓ (commit a827b14). ⏳ pantalla `Inventario.tsx`
- [~] E8.3 Cierre de caja — **API ✓, UI pendiente.** `GET /caja/dia` + `POST /caja/cierres` (server calcula total_sistema por día LOCAL Lima + diferencia; UNIQUE→409) + `GET /caja/cierres?mes=` (commit a827b14). ⏳ pantalla `Caja.tsx`

> **Nota de alcance S2:** el backbone correcto-crítico y testeable de B3+B4 (ambos gates + todos los repos/endpoints + cola offline) está **verde**. La **capa de páginas React** (cutover Supabase→D1 de Login/useSession/Mostrador + pantallas Recepción/Inventario/Caja/Quiebres) NO se tocó: es trabajo visual que se verifica en vivo (Playwright E12.2 / GATE 4) y rinde mejor en una sesión con navegador. Los módulos de datos que esas páginas necesitan (`api.ts`, `db-local.ts`, `cola.ts`, `sync.ts`, `useCatalogoLocal.ts`, banner) ya están listos y probados.

## B5 — Cierre operativo (E9 impresión + E10 faltantes + E11 dashboards/admin)

- [ ] E9.1 Impresión ESC/POS + guía 80mm + fallback print CSS + reimpresión — ⚠️ requiere **T-K1** (sesión física con impresora VES; validar también status de cajón para Δ3 `apertura_sin_venta`)
- [ ] E10.1 Quiebres (botón rápido, offline vía cola) + `/api/faltantes` por botica
- [ ] E10.2 Consolidado de faltantes superadmin + CSV (formato del plan §8)
- [ ] E11.1 Dashboard por botica + consolidado por botica (agregados, nunca detalle mezclado)
- [ ] E11.2 CRUD usuarios/sucursales + formularios de catálogo (crear/editar producto + presentaciones + precios)

## B6 — Deploy y piloto (E12)

- [ ] E12.1 Deploy prod workers.dev con `X-Robots-Tag: noindex`; migraciones + seeds remotos
- [ ] E12.2 Smoke Playwright: login → buscar/escanear → cobrar → imprimir/fallback → anular → cierre caja → consolidado
- [ ] E12.3 🚧 **GATE 4:** verificación EN VIVO con capturas (mostrador 1366×768 + móvil 390×844)
- [ ] E12.4 Carga catálogo real VES (**T-K4**) + usuarios reales (**T-K5**)
- [ ] E12.5 Retirar `apps/admin` (commit dedicado) · push · frontmatter regla 7 · entregar URL viva a Kevin (credenciales por canal seguro, nunca en chat)

---

## Después de P0 (bloques siguientes, según plan de expansión §6.1)

P1 clientes + A1 identidad (KPI % identificadas) → **P4a** venta cruzada + reposición v1 (bandeja wa.me) → **P5** EBR + bandeja de casos + conteos cíclicos + báscula + espejo operativo → P2 audio → P3 rostros → **P6** video-métricas + clips → **P4b** RFM + automatización (Cron Trigger, no n8n). Al llegar aquí, extender este archivo con esos bloques.

## Tareas de Kevin (no bloquean el arranque; bloquean lo indicado)

| # | Tarea | Bloquea | Estado |
|---|---|---|---|
| T-K1 | Impresora térmica VES conectada + sesión WebUSB | E9 | ⬜ |
| T-K4 | Catálogo real VES (~100–300 SKUs: nombre, barras, precios, stock) | E12.4 | ⬜ |
| T-K5 | Emails de papá y mamá para sus cuentas admin | E12.4 | ⬜ |
| T-K6 | Ratificar D9 (admin en la SPA) — **ratificada por defecto si no dice lo contrario** | — | ⬜ |
| T-K2 | Instalar PWA grabadora en el A10 | P2 | ⬜ |
| T-K3 | Modelo exacto Hikvision + acceso a config | P3/P6 | ⬜ |
| T-K7 | Báscula contadora (VES primero) | P5-C4 | ⬜ |
| T-K8 | Curar 5–10 reglas de venta cruzada | P4a | ⬜ |
| T-K9 | WhatsApp emisor por botica | P4a | ⬜ |
| T-K10 | Marcar SKUs crónicos + dosis | P4a | ⬜ |

## Notas para S2 (leer antes de E5/E6)

- **Venta S1 es MINIMAL** (solo cabecera, scoped): `ventaRepo.crearCabeceraMinima` y `anularMinima` + rutas `POST /api/ventas`, `POST /api/ventas/:id/anular` en `routes/protegidas.ts`. **S2/E6 las REEMPLAZA** con el batch §7.3 tal cual (FEFO cascada, venta_item, venta_item_lote, movimiento, audit) y la anulación §7.6.
- **Δ1 en venta_item:** `presentacion_id` y `cantidad_presentacion` son **NOT NULL** en el esquema → el INSERT de venta_item del §7.3 debe incluirlas (cantidad base = cantidad_presentacion × factor). El selector de presentación entra en la UI (E5/E6).
- **Retry remoto:** usar `withRetry` (repos/base.ts) también en el lazo de reintento por CHECK del §7.4 (tolerar "Network connection lost").
- Endpoints ya existentes (scoped) que E5/E8/E10/E11 deben COMPLETAR (hoy son mínimos): precios (versionado vigente_hasta), inventario/ajustes, faltantes/consolidado (quiebres 14d + sugerido), usuarios, audit.
- Worker desplegado para el spike: `https://huayruro.k-alexander-m-g.workers.dev` (solo `/api/salud` + assets placeholder; ruta spike ya retirada).

## Bloqueado

- **ESLint no corre repo-wide** (ESLint 9 + config legacy `.eslintrc.cjs` + plugins @typescript-eslint no instalados; sin hooks git activos en `.husky/`). Deuda PREEXISTENTE, no de S1. El canal prohibido se enforce por el **test #14** (verde). Migrar a flat config es tarea aparte.
- Seeds remotos + deploy prod “oficial”: diferidos a E12 (con `X-Robots-Tag` + catálogo real T-K4/T-K5). No bloquean S2.
- **Capa de páginas React (E5.2 cutover + pantallas E8) necesita navegador**: el cutover Supabase→D1 de Login/useSession/Mostrador y las pantallas Recepción/Inventario/Caja se verifican en vivo (Playwright/E12.2 + GATE 4). No bloquea el backbone (API + cola listas y probadas); es lo primero de la siguiente sesión. Nota: `apps/pwa` aún tiene `@powersync/web` y `@supabase/supabase-js` en deps + `supabase.ts` — se retiran en el cutover (decisión D7: sin PowerSync).

## Log de sesiones

| Fecha | Bloque | Resultado | Commit(s) |
|---|---|---|---|
| 2026-07-04 | S1 (B1+B2) | GATE 1-2 ✅ (60 golden) · GATE 3 ✅ (17/17, 14 aislamiento). Esquema+seeds local, auth+scoping, spike A/B/C/D verde local+remoto | 85ac071 (E0) · 4f2f4b2 (E2) · dd4bfbe (E1) · ffb9ddd (E3) · c23204f (E4) |
| 2026-07-04 | S2 (B3+B4) | GATE E6.3 ✅ (venta atómica, 9 tests) · GATE E7.2 ✅ (cola offline, cliente+D1). API completa de catálogo/venta/anulación/recepción/caja + fundación offline (Dexie/cola/flusher/banner/api/sync). API 32/32, PWA 5/5, typecheck limpio. Falta capa de páginas React (cutover Supabase→D1) → sesión con navegador | f3f3b70 (E5) · 1fcf301 (E6) · bc20874 (E6.3) · a827b14 (E8) · bedfc78 (E7.1/E5.2) · c641f64 (E7.2) |
