# ADR-002 — Multi-tenant por filas con RLS Postgres

- **Status:** Accepted
- **Date:** 2026-05-24
- **Decision-makers:** Kevin
- **Consulted:** Solution Architect, Backend Engineer (panel virtual)

## Context and Problem Statement
¿Cómo separamos los datos entre las 3 boticas (escala a 10+) sin duplicar infraestructura?

## Decision Drivers
- Aislamiento estricto: admin Chazuta no ve datos VES
- Costo lineal con la cantidad de sucursales
- Compatibilidad con Supabase Pro
- Capacidad de consolidar a nivel cadena (super_admin Kevin)

## Considered Options
- **A: DB-per-tenant** (cada botica = una BD Postgres separada)
- **B: Schema-per-tenant** (un Postgres, un schema por botica)
- **C: Row-level RLS** (un Postgres + un schema + policy por `sucursal_id`)

## Decision Outcome
**Chosen option: C — RLS por fila**, porque Supabase lo soporta nativo, escala lineal con cantidad de sucursales, permite super_admin (Kevin) ver consolidado con políticas que respetan rol, y reduce ops vs B/A.

### Consequences
- ✅ Costo lineal (1 instancia Supabase × N boticas)
- ✅ Super_admin view consolidado fácil
- ✅ Migraciones aplican una sola vez para toda la cadena
- ⚠️ Bug en una policy puede exponer datos cross-sucursal — mitigación: tests SQL obligatorios para cada policy ([[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/08-plan-testing.md]])
- ⚠️ Si una botica exige aislamiento físico (ej: vende el negocio a un tercero), hay que migrar datos selectivamente — escenario remoto

## More Information
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/03-modelo-datos.md]] · sección RLS
- [Supabase RLS docs](https://supabase.com/docs/guides/auth/row-level-security)
