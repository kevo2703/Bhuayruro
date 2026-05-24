# ADR-010 — Producto en español de Perú (es-PE)

- **Status:** Accepted
- **Date:** 2026-05-24
- **Decision-makers:** Kevin

## Context and Problem Statement
Operadores son hablantes nativos peruanos. Formato fecha, decimal, moneda, tratamiento (tú/usted) deben ser consistentes con el contexto local.

## Decision Drivers
- UX natural para los operadores (Kevin, papás, futuros vendedores)
- Sin variantes regionales mezcladas (no voseo argentino, no "ustedes" + verbo plural raro)

## Considered Options
- **A: es-PE estricto** (tú, formato fecha `dd/mm/yyyy`, S/ con punto-coma)
- **B: español neutro / es-419**
- **C: i18n con múltiples locales**

## Decision Outcome
**Chosen option: A — es-PE estricto**.

- Pronombre **tú** (no vos, no usted formal en UI)
- Verbos: "puedes", "tienes", "agregar" (no "podés", "tenés", "agregá")
- Fecha: `dd/mm/yyyy`
- Moneda: `S/` (símbolo soles) — `Intl.NumberFormat('es-PE', { currency: 'PEN' })`
- Decimal: coma (`S/ 1.234,50`)
- Zona horaria default: `America/Lima`

### Consequences
- ✅ Lenguaje natural para usuarios
- ✅ Consistencia desde día 1
- ⚠️ Si en fase 5 se vende a otras farmacias del Perú, no hay fricción
- ⚠️ Si en fase 6+ se vende a otras LATAM, requiere i18n — out of scope MVP

## More Information
- Memoria de feedback durable: `feedback_espanol_peruano_no_voseo`
