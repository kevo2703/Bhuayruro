# ADR-003 — Local-first SQLite + PowerSync sobre Supabase

- **Status:** Accepted
- **Date:** 2026-05-24
- **Decision-makers:** Kevin
- **Consulted:** Solution Architect, Backend (panel virtual)

## Context and Problem Statement
Chazuta tiene conectividad inestable (zona selva). El mostrador NO puede dejar de operar cuando se cae internet — la venta sigue, la sincronización se difiere.

## Decision Drivers
- Operación 100% local cuando no hay red
- Sin pérdida de datos cuando vuelve la red
- Compatibilidad con Supabase Postgres (backend ya elegido)
- Costo: Free para nuestro tamaño

## Considered Options
- **A: Supabase Realtime puro** (queries en vivo cuando hay red)
- **B: PowerSync** (capa Postgres ↔ SQLite oficial-partner Supabase)
- **C: WatermelonDB / RxDB** + sync manual a Supabase

## Decision Outcome
**Chosen option: B — PowerSync**, porque Supabase Realtime NO es offline-first (opera sobre cable). PowerSync es la capa oficial recomendada por Supabase para este patrón. Free hasta 1.000 dispositivos (cubre 10+ boticas largamente).

**Fallback:** si el SDK web de PowerSync no funciona en PWA Vite/React (validación sprint 1), bajar a WatermelonDB con sync manual.

### Consequences
- ✅ Mostrador opera 100% sin red
- ✅ Sync automático bidireccional cuando vuelve red
- ✅ Conflictos: last-write-wins (suficiente para POS de 1 sucursal por usuario)
- ⚠️ Dependencia de PowerSync como proveedor (vendor risk medio — el modelo SQLite local sigue siendo nuestro)
- ⚠️ Curva de aprendizaje de "sync rules" YAML

## More Information
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/01-arquitectura.md]] · ADR-03
- [PowerSync + Supabase docs](https://docs.powersync.com/integrations/supabase)
