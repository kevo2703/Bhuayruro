# Política de Retención y Borrado de Datos

**Cliente:** Cadena Botica Huayruro
**Marco legal:** Ley N° 29733 Art. 11 (retención mínima necesaria) + Reglamento D.S. 016-2024-JUS
**Fecha vigencia:** 2026-05-24
**Próxima revisión:** anual o ante cambio normativo

---

## Principio

Todos los datos del sistema se retienen por el tiempo **mínimo necesario** para la finalidad declarada. Pasado ese plazo, se borran de forma automática (hard delete) o se anonimizan (soft delete con scrub de PII).

## Tabla de retención

| Tipo de dato | Plazo de retención | Mecanismo de borrado | Justificación |
|---|---|---|---|
| Audio del mostrador (fase 2) | 0 segundos — no retenido | Por diseño: procesado on-device y descartado | LPDP categoría sensible (Art. 14) — minimización |
| Transcripción literal de la conversación (fase 2) | 0 segundos — no retenida | Por diseño | LPDP + Ley 26842 (evidencia auto-incriminatoria) |
| No-compras | 12 meses | `pg_cron` mensual hard-delete | Utilidad analítica acota |
| Quiebres | 12 meses | `pg_cron` mensual hard-delete | Utilidad analítica acota |
| Audit log | 2 años | `pg_cron` semanal hard-delete | Trazabilidad operativa + seguridad |
| Ventas + venta_item | 5 años | Soft delete con `deleted_at` (no hard) | Período tributario referencial (SUNAT) |
| Movimiento_stock | 5 años | Soft delete | Trazabilidad DIGEMID + tributaria |
| Cierre de caja | 5 años | Soft delete | Contabilidad |
| Lotes (con `unidades = 0` y `fecha_vencimiento` pasada) | 5 años desde vencimiento | Soft delete + reporte CSV exportable | DIGEMID trazabilidad |
| `usuario_perfil` de ex-empleados | 5 años post-egreso | Anonimización: scrub email, nombre, dni → "ex-operador-XXX" | Obligación laboral + auditoría tributaria |
| Backups Supabase | 7 días (Pro) / 30 días (PITR add-on opcional) | Provider |
| Sentry events | 30 días (Free) | Provider |

## Derecho a la cancelación (ARCO)

El titular puede solicitar la cancelación de sus datos antes de los plazos arriba. Si la cancelación entra en conflicto con una obligación legal de retención (tributaria, contable), se anonimiza en lugar de eliminar — manteniendo el dato necesario para cumplir la obligación pero sin PII identificable.

Procedimiento completo en [[sop-arco.md]].

## Implementación técnica

- `pg_cron` programado para hard-deletes mensuales y semanales según tabla
- `client_uuid` UUID v7 mantiene timestamp embebido — facilita queries por edad
- Migración de hard-delete inicia post-rollout sprint 8 (no purga datos del piloto)

## Revisión

Esta política se revisa:

- Al cierre del MVP (sprint 8) — calibración de plazos contra uso real
- Al iniciar fase 2 (audio) — validar política de "0 segundos"
- Al formalizar tributariamente (fase 4) — alinear con régimen SUNAT
- Anualmente

---

## Firmas

**Oficial de Datos Personales:** ___________________________
Kevin Alexander Mandujano García · _<fecha>_

## Documentos relacionados

- [[dpo-designacion.md]]
- [[dpia-mvp.md]]
- [[sop-arco.md]]
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/06-compliance-legal.md]]
