# Política de Privacidad — Cadena Botica Huayruro

**Última actualización:** 2026-05-24
**Marco legal:** Ley N° 29733 + D.S. 016-2024-JUS

---

## 1. Responsable del tratamiento

**Razón social/Operador:** Kevin Alexander Mandujano García (persona natural — cadena en transición a régimen formal)
**Establecimientos:**
- Botica Huayruro VES — Av. Revolución × Av. Las Lomas, Villa El Salvador, Lima
- Botica Huayruro Chazuta Puerto — Chazuta, San Martín
- Botica Huayruro Chazuta Plaza — Chazuta, San Martín

**Contacto:** privacidad@huayruro.pe (en habilitación) · entre tanto: k.alexander.m.g@gmail.com
**Oficial de Datos Personales:** Kevin Alexander Mandujano García

## 2. Qué datos recolectamos

### En el sistema POS del mostrador

**SÍ recolectamos** de nuestros **operadores** (Kevin, papás, futuros empleados):
- Nombre completo y email
- Rol asignado (operador, admin, super_admin)
- Log de actividad dentro del sistema (audit log)

**NO recolectamos del cliente final** que compra en mostrador:
- ❌ Nombre o DNI
- ❌ Síntomas, diagnóstico ni contenido clínico
- ❌ Identificación biométrica ni geolocalización

### Sistema de video vigilancia

Las boticas cuentan con cámaras IP **con fines de seguridad**. Las grabaciones se conservan hasta 30 días. Imágenes de personas no se comparten con terceros salvo requerimiento de autoridad competente.

### Audio (fase 2, futuro)

Si en el futuro activamos el procesamiento de audio del mostrador:
- Se anunciará con cartel visible en cada establecimiento
- El audio se procesa **localmente** y NO se conserva
- Solo se extraen campos transaccionales (productos mencionados, monto)
- No se almacena el contenido de la conversación

## 3. Finalidades del tratamiento

- Operación del POS de venta
- Control de inventario y trazabilidad de lotes (DIGEMID)
- Seguridad (video vigilancia, audit log)
- Cumplimiento de obligaciones legales y tributarias

## 4. Plazo de retención

Cada tipo de dato tiene un plazo específico. Política completa: [[politica-retencion.md]].

Resumen: máximo 5 años desde la última operación; audit log 2 años; quiebres/no-compras 12 meses.

## 5. Tus derechos como titular (ARCO)

Tienes derecho a:

- **Acceso:** consultar qué datos tenemos tuyos
- **Rectificación:** corregir datos inexactos
- **Cancelación:** solicitar la eliminación (con las limitaciones de retención legal)
- **Oposición:** oponerte al tratamiento cuando proceda

**Cómo ejercerlos:**
1. Email a privacidad@huayruro.pe con asunto "Solicitud ARCO — <tipo>"
2. O presencial en cualquiera de las 3 boticas
3. Verificamos tu identidad (DNI) y respondemos en ≤ 15 días hábiles (plazo interno; el legal es 20 días)

## 6. Transferencias internacionales

Los datos se almacenan en servidores de **Supabase** y **Vercel**, que pueden estar ubicados en Estados Unidos o Unión Europea. Estos proveedores ofrecen garantías de seguridad equivalentes a las exigidas por la LPDP peruana.

## 7. Medidas de seguridad

- Encriptación en tránsito (HTTPS/TLS 1.3) y at-rest
- Autenticación por contraseña fuerte + JWT
- Row Level Security (Postgres) para aislamiento por sucursal
- Audit log de operaciones sensibles
- Backups automáticos diarios
- Protocolo de notificación de incidentes a la ANPDP en 48 horas

## 8. Reclamaciones

Si consideras que tus derechos no fueron atendidos correctamente, puedes presentar reclamo ante la **Autoridad Nacional de Protección de Datos Personales (ANPDP)** del Ministerio de Justicia: `denuncias@minjus.gob.pe`.

## 9. Cambios a esta política

Esta política puede actualizarse para reflejar cambios normativos o de tratamiento. Las versiones se mantienen disponibles en `huayruro.pe/privacidad`.

---

## Documentos relacionados

- [[dpo-designacion.md]]
- [[politica-retencion.md]]
- [[sop-arco.md]]
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/06-compliance-legal.md]]
