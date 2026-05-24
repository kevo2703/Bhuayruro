# ADR-006 — Idempotencia por `client_uuid` UUID v7

- **Status:** Accepted
- **Date:** 2026-05-24
- **Decision-makers:** Kevin
- **Consulted:** Backend Engineer (panel virtual)

## Context and Problem Statement
Las operaciones offline se acumulan en cola local y se re-envían cuando vuelve red. Si la red falla justo después de un POST exitoso (el server procesó pero el ACK no llegó), el reintento crearía una venta duplicada.

## Decision Drivers
- Cero ventas duplicadas
- Cero ventas perdidas
- Operación correcta sin coordinación con el server

## Considered Options
- **A: ID server-generated** (autoincrement Postgres, no funciona offline)
- **B: UUID v4 con UNIQUE constraint** (sin orden temporal)
- **C: UUID v7 con UNIQUE constraint** (timestamp-aware, ordenable, no expone secuencia)

## Decision Outcome
**Chosen option: C — UUID v7**. Cada operación cliente genera su `client_uuid` UUID v7 antes de enviar. Server upsert con `ON CONFLICT (client_uuid) DO NOTHING` o retorna el existente (idempotente). Ordenable por timestamp embebido.

Implementación Postgres 15: polyfill `uuid_generate_v7()` en migration 001. Migrar a `uuidv7()` nativo cuando Supabase corra Postgres 17.

### Consequences
- ✅ Reintentos seguros sin riesgo de duplicar
- ✅ Ordenable cronológicamente sin campo extra
- ✅ Generables offline
- ⚠️ Polyfill SQL hasta Postgres 17 — escenario controlado

## More Information
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/04-apis-endpoints.md]] · sección RPC `registrar_venta`
- [RFC 9562 UUIDv7](https://datatracker.ietf.org/doc/rfc9562/)
