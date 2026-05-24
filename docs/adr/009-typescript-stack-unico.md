# ADR-009 — Stack TypeScript único frontend + backend

- **Status:** Accepted
- **Date:** 2026-05-24
- **Decision-makers:** Kevin

## Context and Problem Statement
PWA cliente y admin web pueden compartir lenguaje. ¿Mismo TypeScript en ambos o ecosistemas distintos?

## Decision Drivers
- Kevin solo + Claude Code: minimizar contextos cognitivos
- Compartir tipos generados por Supabase (`database.types.ts`)
- Compartir schemas de validación (zod)

## Considered Options
- **A: TypeScript en ambos** (PWA + admin + packages compartidos)
- **B: TypeScript admin + diferente PWA** (ej: Flutter, Svelte)

## Decision Outcome
**Chosen option: A — TypeScript único**. Tipos generados de Supabase se importan desde `@huayruro/db`. Cálculos (IGV, formato moneda) desde `@huayruro/shared`. shadcn/ui copy-paste vive en `@huayruro/ui` y se consume desde ambas apps.

### Consequences
- ✅ Una única especialización mental
- ✅ Reuso de tipos y schemas
- ✅ pnpm + turbo coordinan el monorepo
- ⚠️ React 19 + Next 15 + Vite 5 todos al mismo tiempo — version compatibility matrix a vigilar

## More Information
- Monorepo estructura en [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/02-stack-tecnologico.md]] · sección "Estructura de repo propuesta"
