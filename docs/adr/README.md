# Architecture Decision Records — Cadena Botica Huayruro

> Formato MADR (Markdown ADR) v3.0. Cada decisión arquitectural significativa vive en un ADR numerado. Cambiar una decisión = un nuevo ADR que supersedes el anterior, no editar el original.

## Estado actual

| # | Título | Estado | Sprint |
|---|---|---|---|
| [ADR-001](001-monolito-modular.md) | Monolito modular en lugar de microservicios | Accepted | 1 |
| [ADR-002](002-multi-tenant-rls.md) | Multi-tenant por filas con RLS Postgres | Accepted | 1 |
| [ADR-003](003-offline-first-powersync.md) | Local-first SQLite + PowerSync sobre Supabase | Accepted | 1 |
| [ADR-004](004-webusb-esc-pos.md) | WebUSB nativo para impresión ESC/POS | Accepted | 1 |
| [ADR-005](005-barcode-hid-keyboard.md) | Lector códigos = teclado HID estándar | Accepted | 1 |
| [ADR-006](006-idempotencia-client-uuid.md) | Idempotencia por `client_uuid` UUID v7 | Accepted | 1 |
| [ADR-007](007-audio-on-device-sin-retencion.md) | Audio fase 2 on-device sin retención | Accepted | 1 |
| [ADR-008](008-sin-modulo-hc-mvp.md) | Sin módulo HC ni transcripción clínica en MVP | Accepted | 1 |
| [ADR-009](009-typescript-stack-unico.md) | Stack TypeScript único frontend + backend | Accepted | 1 |
| [ADR-010](010-idioma-es-pe.md) | Producto en español de Perú (es-PE) | Accepted | 1 |

## Plantilla MADR para próximos ADRs

```markdown
# ADR-NNN — <Título corto>

- **Status:** Proposed | Accepted | Rejected | Deprecated | Superseded by [ADR-XXX]
- **Date:** YYYY-MM-DD
- **Decision-makers:** Kevin
- **Consulted:** spec panel virtual (Solution Architect, Backend, ...)

## Context and Problem Statement
¿Qué problema resolvemos? ¿Qué fuerzas en tensión existen?

## Decision Drivers
- Driver 1
- Driver 2

## Considered Options
- Opción A
- Opción B
- Opción C

## Decision Outcome
**Chosen option: <X>**, because <razones>.

### Consequences
- ✅ Pro
- ⚠️ Trade-off
- ❌ Con que aceptamos

## More Information
Referencias, links a fuentes.
```
