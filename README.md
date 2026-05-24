# Huayruro — Sistema operativo cadena Botica Huayruro

> Sistema POS multi-tenant offline-first para la cadena Botica Huayruro (3 boticas hoy, 10+ planeadas).
> **Estado:** Sprint 1 en curso (arrancó 2026-05-24). Fase pipeline: `build`.

## Especificación

La especificación completa vive en el vault de Kevin como brief técnico de 12 documentos:

- 📂 [proyectos/botica-huayruro-sistema-automatizacion/spec/](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/)
- 📄 [00-resumen-ejecutivo](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/00-resumen-ejecutivo.md) — 1 página decisional
- 📄 [01-arquitectura](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/01-arquitectura.md) — C4 + ADRs + flujos UX
- 📄 [02-stack-tecnologico](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/02-stack-tecnologico.md) — versiones pineadas
- 📄 [03-modelo-datos](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/03-modelo-datos.md) — DDL + RLS + triggers
- 📄 [04-apis-endpoints](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/04-apis-endpoints.md) — RPCs + contratos
- 📄 [05-workflows-automatizacion](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/05-workflows-automatizacion.md) — triggers + n8n
- 📄 [06-compliance-legal](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/06-compliance-legal.md) 🔒 — LPDP/DIGEMID/checklist
- 📄 [07-roadmap-sprints](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/07-roadmap-sprints.md) — 8 sprints
- 📄 [08-plan-testing](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/08-plan-testing.md)
- 📄 [09-plan-deploy](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/09-plan-deploy.md)
- 📄 [10-metricas-exito](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/10-metricas-exito.md)

## Estructura del repo

```
huayruro/
├── apps/
│   ├── pwa/              # Cliente mostrador — Vite + React + PWA offline-first
│   └── admin/            # Panel administrativo — Next.js 15
├── packages/
│   ├── shared/           # Cálculo IGV, schemas zod, tipos compartidos
│   ├── ui/               # shadcn/ui components (sprint 2+)
│   └── db/               # Cliente Supabase + tipos generados
├── supabase/
│   ├── migrations/       # SQL versionado
│   ├── functions/        # Edge functions (fase 4)
│   ├── tests/            # Tests SQL (pgTAP)
│   └── config.toml
├── docs/
│   ├── adr/              # 10 Architecture Decision Records
│   ├── legal/            # DPO, DPIA, política retención, privacidad, ARCO
│   ├── runbooks/         # Incidente seguridad, restore drill, etc.
│   ├── diagramas/        # SVGs renderizados
│   └── sprints/          # Mini-reportes de cierre por sprint
└── .github/workflows/    # CI
```

## Stack

| Capa | Tech | Versión |
|---|---|---|
| Frontend mostrador | Vite + React + vite-plugin-pwa + Dexie.js | React 19, Vite 5, vite-plugin-pwa 0.20+ |
| Frontend admin | Next.js | 15.2.4 (App Router) |
| Backend | Supabase Pro | Postgres 15+ |
| Sync offline-first | PowerSync | Free tier ≤ 1000 devices |
| Hosting | Vercel Pro | obligatorio (Hobby prohíbe comercial) |
| Orquestación | n8n Cloud Starter | desde sprint 6 |
| Impresión térmica | WebUSB ESC/POS | Chrome/Edge 89+ |
| Audio fase 2 | faster-whisper CPU int8 | español `small` |

## Quickstart

> **Prerequisitos:** Node 20+, pnpm 9+, Supabase CLI, cuenta Supabase Pro, cuenta Vercel Pro.

```bash
# Instalar deps
pnpm install

# Copiar y completar variables
cp .env.example .env.local
# completar con keys de Supabase y PowerSync

# Levantar Supabase local
pnpm supabase:start

# Aplicar migrations
pnpm supabase:reset

# Levantar dev servers (PWA :5173, admin :3000)
pnpm dev
```

## Comandos comunes

| Comando | Descripción |
|---|---|
| `pnpm dev` | Levanta todos los apps en modo dev |
| `pnpm build` | Build de producción de todo el monorepo |
| `pnpm lint` | ESLint en todo el repo |
| `pnpm typecheck` | TypeScript check |
| `pnpm test:unit` | Tests unitarios (Vitest) |
| `pnpm test:e2e` | Tests end-to-end (Playwright) |
| `pnpm supabase:reset` | Recrear BD local + aplicar migrations |
| `pnpm supabase:types` | Regenerar tipos TypeScript desde la BD |

## Sprint actual

Sprint 1 (26-may → 1-jun) — Setup + validaciones críticas. Detalle en [07-roadmap-sprints](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/07-roadmap-sprints.md#sprint-1--setup--validaciones-cr%C3%ADticas).

## Compliance 🔒

Antes del rollout a producción sprint 7, deben cumplirse los 10 puntos del checklist de [06-compliance-legal](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/06-compliance-legal.md#lista-de-bloqueo-de-rollout--checklist-obligatorio). Documentación legal base:

- [docs/legal/dpo-designacion.md](docs/legal/dpo-designacion.md) — pendiente firma
- [docs/legal/dpia-mvp.md](docs/legal/dpia-mvp.md) — pendiente firma
- [docs/legal/politica-retencion.md](docs/legal/politica-retencion.md)
- [docs/legal/politica-privacidad.md](docs/legal/politica-privacidad.md)
- [docs/legal/sop-arco.md](docs/legal/sop-arco.md)
- [docs/runbooks/incidente-seguridad.md](docs/runbooks/incidente-seguridad.md)

## Convenciones

- **Idioma:** español de Perú (ADR-010). Sin voseo.
- **Commits:** Conventional Commits enforced via commitlint.
- **Code style:** Prettier + ESLint estricto (max-warnings 0).
- **Tests:** ver [08-plan-testing](../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/08-plan-testing.md).

## Soporte

- Owner: Kevin Alexander Mandujano García
- DPO: Kevin (auto-designado — ver `docs/legal/dpo-designacion.md`)
- Reporte de bugs: `docs/bugs/<numero>-<slug>.md`
