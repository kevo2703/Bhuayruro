# Evaluación de Impacto en Protección de Datos Personales (DPIA) — MVP

**Cliente:** Cadena Botica Huayruro
**Sistema:** Sistema operativo POS multi-tenant offline-first
**Versión:** MVP v0.1 (sprints 1-8)
**Fecha de evaluación:** 2026-05-24
**Próxima revisión:** al cerrar MVP + cada cambio sustancial de schema

---

## 1. Descripción del tratamiento

El sistema técnico construye un POS para 3 boticas familiares (con visión de cadena 10+). Trata:

- **Datos de operadores del sistema:** Kevin + papás + futuros vendedores empleados. Identidad (nombre, email), rol y log de actividad.
- **Datos operacionales:** ventas (sin identificar cliente), stock, lotes, precios, quiebres, no-compras.
- **NO trata datos del cliente final** de la botica por diseño.

## 2. Necesidad y proporcionalidad

- **Finalidad legítima:** gestión operativa, contable, control de inventario DIGEMID, cierre de caja, reportes gerenciales.
- **Base legal:** ejecución de relación contractual (operadores) + interés legítimo del negocio (datos operacionales).
- **Minimización:** se recolecta lo mínimo necesario para operar — no se piden datos del cliente final.

## 3. Identificación de riesgos

| Riesgo | Probabilidad | Impacto | Nivel |
|---|---|---|---|
| Filtración credenciales operador → acceso no autorizado a su sucursal | Baja | Medio | **Medio** |
| Bug RLS expone datos cross-sucursal | Muy baja | Alto | **Medio** |
| Pérdida PC mostrador con sesión activa | Baja | Bajo (datos no son cliente) | **Bajo** |
| Operador interno modifica precios sin autorización | Media | Medio | **Medio** |
| Backup Supabase compromiso vía cuenta Kevin | Muy baja | Alto | **Medio** |

## 4. Medidas de mitigación implementadas

- ✅ **Encriptación en tránsito:** HTTPS/TLS 1.3 obligatorio (Vercel + Supabase nativo)
- ✅ **Encriptación at-rest:** Supabase Postgres nativo
- ✅ **RLS estricto:** policies por `sucursal_id` en TODAS las tablas
- ✅ **Audit log:** cada operación sensible queda registrada con `usuario_id` + `ip_origen`
- ✅ **Auth con JWT + refresh tokens:** Supabase Auth estándar
- ✅ **Política de retención mínima:** datos personales 5 años post-egreso (operadores); audit log 2 años
- ✅ **Magic link como recovery:** sin password reset débil
- ✅ **Backups automáticos:** Supabase Pro 7 días
- ✅ **Restore drill ensayado** antes del rollout sprint 7
- ✅ **MFA recomendado** para super-admin (Kevin)
- ✅ **Tests SQL de RLS:** cada policy con test unitario que valida aislamiento

## 5. Conclusión de la evaluación

**Riesgo residual: BAJO-MEDIO.** El sistema procesa pocos datos personales (solo operadores, no clientes). Los datos sensibles (salud) **no se procesan por diseño** en el MVP. Las medidas técnicas + organizacionales descritas reducen el riesgo a niveles aceptables.

**Recomendación: se autoriza el tratamiento descrito.** El DPO (Kevin) revisará esta DPIA al cerrar el MVP (semana 8) y antes de iniciar fase 2 (audio efímero), que requerirá DPIA específica.

---

## 6. Firmas

**Oficial de Datos Personales:** ___________________________
Kevin Alexander Mandujano García · _<fecha>_

**Responsable del tratamiento:** ___________________________
Kevin Alexander Mandujano García · _<fecha>_

## 7. Documentos relacionados

- [[dpo-designacion.md]]
- [[politica-retencion.md]]
- [[politica-privacidad.md]]
- [[sop-arco.md]]
- [[../runbooks/incidente-seguridad.md]]
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/06-compliance-legal.md]]
