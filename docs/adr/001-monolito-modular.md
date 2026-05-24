# ADR-001 — Monolito modular en lugar de microservicios

- **Status:** Accepted
- **Date:** 2026-05-24
- **Decision-makers:** Kevin
- **Consulted:** Solution Architect (panel virtual /tech-blueprint)

## Context and Problem Statement
La cadena Huayruro arranca con 3 boticas y proyecta 10+ en 2-3 años. ¿Construimos un sistema distribuido en microservicios pensando en la escala, o un monolito modular más simple?

## Decision Drivers
- Operación por Kevin solo + Claude Code (sin equipo de ops)
- Volumen real: 3-10 boticas × ~100 transacciones/día. Ni cerca de saturar Postgres
- Time-to-value: MVP en 8 semanas
- Costo operativo bajo

## Considered Options
- **A: Microservicios** (auth-service, catalog-service, sales-service, sync-service)
- **B: Monolito modular** (un repo + Next.js admin + PWA cliente comparten Postgres)
- **C: Serverless functions** (cada operación = Edge Function aislada)

## Decision Outcome
**Chosen option: B — Monolito modular**, porque la coordinación distribuida (transacciones, debugging, deploy) supera dramáticamente el beneficio para 3-10 boticas. Si superamos 50+ boticas, evaluar partir en microservicios — pero será re-arquitectura justificada por evidencia, no especulación.

### Consequences
- ✅ Operación simple, un solo deploy
- ✅ Transacciones atómicas en Postgres
- ✅ Onboarding de Kevin (y futuro colaborador) más fácil
- ⚠️ Si Postgres se vuelve cuello, escalar vertical primero (Supabase Team)
- ❌ Si crecemos a 50+ boticas, refactor distribuido cuesta más que haber empezado distribuido — riesgo aceptado

## More Information
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/01-arquitectura.md]] · ADR-01
