# Runbook — Incidente de Seguridad

**Cliente:** Cadena Botica Huayruro
**Marco legal:** D.S. 016-2024-JUS — notificación a ANPDP en **≤ 48 horas**
**Responsable:** Oficial de Datos Personales (Kevin)
**Versión:** 1.0 · 2026-05-24

---

## Definición

Constituye **incidente de seguridad** cualquier acceso no autorizado, pérdida, alteración, divulgación o destrucción de datos personales. Ejemplos:

- Robo o pérdida de PC mostrador con sesión activa
- Filtración de credenciales (anon key Supabase, password operador, service role)
- Acceso de usuario no autorizado a datos de otra sucursal (bug RLS, error humano)
- Modificación maliciosa por usuario interno
- Ransomware en PC mostrador
- Backup expuesto en lugar público

## Reloj 48h

| T+ | Acción |
|---|---|
| **T+0** | Conocimiento del incidente. **Anotar la hora exacta** en el caso |
| **T+15min** | Activar runbook. Notificar (informal) por WhatsApp al super-admin si hay otro |
| **T+1h** | Evaluación inicial — alcance, severidad, contención disponible |
| **T+2-6h** | Contención |
| **T+6-24h** | Análisis de impacto + preparación de notificación |
| **T+24-48h** | **Notificación formal a ANPDP** vía `denuncias@minjus.gob.pe` o trámite gob.pe |
| **T+72h** | Si el riesgo es alto: notificar a titulares afectados |
| **T+1 semana** | RCA documentado + medidas correctivas + agregadas al backlog del sistema |

## Procedimiento

### Paso 1 — Conocimiento y registro

- Crear archivo `docs/legal/incidentes/INC-YYYY-NNN.md` con la plantilla del final
- Anotar HORA EXACTA del conocimiento (zona horaria America/Lima)
- Nombrar lo que se sabe y lo que NO se sabe

### Paso 2 — Evaluación inicial (T+1h)

Responder estas 5 preguntas:

1. ¿Qué tipo de datos están afectados? (operadores / operacionales / ninguno / desconocido)
2. ¿Cuántos titulares están afectados? (estimación con rango)
3. ¿Es contenible? ¿Cuánto cuesta contenerlo?
4. ¿Hay riesgo activo en curso? (atacante con acceso ahora vs incidente pasado)
5. ¿Hay obligación de notificar? (sí si afecta datos personales identificables)

### Paso 3 — Contención (T+2-6h)

Acciones típicas según tipo:

| Tipo | Acción |
|---|---|
| Robo PC mostrador | Revocar sesiones del operador en Supabase Auth · cambiar password · escalar a sucursal de papá/mamá |
| Filtración credencial Supabase | Rotar anon key + service role key inmediato · revocar JWTs · invalidar `supabase logout all` |
| Bug RLS | Bloquear la policy afectada · UPDATE temporal con regla más restrictiva · push fix |
| Acceso interno no autorizado | Revocar permisos del usuario · cambiar password · audit log de su actividad |
| Ransomware PC | Aislar la PC de la red · evaluar si SQLite local tiene data no sincronizada · restaurar PC desde imagen |

**Después de cada acción de contención: verificar que el incidente se contuvo realmente.**

### Paso 4 — Análisis de impacto

- ¿Qué datos exactos se expusieron?
- ¿Cuántos titulares?
- ¿Qué hace el atacante con ellos?
- ¿Hay obligación de notificar individualmente a los afectados? (criterio: riesgo alto = sí)

### Paso 5 — Notificación a ANPDP (≤ T+48h)

**Vía:** `denuncias@minjus.gob.pe` con asunto `Notificación Incidente Datos Personales — <organización> — <fecha>`.

**Plantilla** (completar el archivo del incidente con esto y enviar):

```
Estimados señores,

En cumplimiento del D.S. 016-2024-JUS, notifico el siguiente incidente de seguridad
de datos personales:

DATOS DE LA ORGANIZACIÓN
- Responsable: Kevin Alexander Mandujano García (Cadena Botica Huayruro)
- Contacto: <email + teléfono>
- Oficial de Datos Personales: Kevin Alexander Mandujano García

DATOS DEL INCIDENTE
- Fecha y hora de conocimiento: <fecha> <hora> America/Lima
- Tipo de incidente: <robo / filtración / acceso no autorizado / otro>
- Datos personales afectados: <tipos>
- Cantidad estimada de titulares afectados: <número o rango>
- Origen: <interno / externo / accidental / técnico>

MEDIDAS ADOPTADAS
- <acción 1>
- <acción 2>

MEDIDAS PREVENTIVAS PLANIFICADAS
- <acción 1>
- <acción 2>

NOTIFICACIÓN A TITULARES
- <Sí, fecha planeada / No, justificación: bajo riesgo>

Atentamente,
Kevin Alexander Mandujano García
Oficial de Datos Personales
Cadena Botica Huayruro
```

### Paso 6 — Notificación a titulares (si aplica)

Si el riesgo es **alto** para los titulares (datos sensibles + identificables + uso malicioso posible):

- Email individual a cada titular afectado
- Explicar qué pasó (sin culpas), qué se hizo, qué pueden hacer ellos
- Ofrecer canal de contacto del DPO

### Paso 7 — RCA y mejoras (T+1 semana)

- ¿Cuál fue la causa raíz?
- ¿Qué falló en el diseño que permitió el incidente?
- ¿Qué control nuevo evita su recurrencia?
- Agregar al backlog técnico

## Plantilla de archivo de incidente

```markdown
---
id: INC-YYYY-NNN
fecha_conocimiento: YYYY-MM-DD HH:MM America/Lima
severidad: bajo | medio | alto | critico
estado: activo | contenido | notificado | cerrado
dpo: Kevin Alexander Mandujano García
---

# Incidente INC-YYYY-NNN — <título corto>

## Cronología
- T+0 (HH:MM): conocimiento. <cómo se conoció>
- T+...: ...

## Datos afectados
- ...

## Acciones de contención
- ...

## Notificación ANPDP
- Enviada: <fecha>
- Confirmación: <ID o N/A>

## Notificación a titulares
- <fecha o N/A>

## RCA
- ...

## Mejoras al sistema
- [ ] Backlog item 1
- [ ] Backlog item 2

## Cierre
Fecha: <fecha>
Firma DPO: ___
```

## Documentos relacionados

- [[../legal/dpo-designacion.md]]
- [[../legal/politica-privacidad.md]]
- [[../legal/politica-retencion.md]]
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/06-compliance-legal.md]] · sección CL-05
