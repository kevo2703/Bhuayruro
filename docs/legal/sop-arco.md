# SOP — Procedimiento de Atención a Derechos ARCO

**Cliente:** Cadena Botica Huayruro
**Marco legal:** Ley N° 29733 Cap. III + D.S. 016-2024-JUS
**Versión:** 1.0
**Vigencia:** desde 2026-05-24
**Responsable:** Oficial de Datos Personales (Kevin)

---

## 0. Plazo máximo

**20 días hábiles** desde la recepción válida de la solicitud (artículo correspondiente Ley 29733).
**Plazo interno:** 15 días hábiles.

## 1. Vías de recepción

| Vía | Cómo |
|---|---|
| Email | `privacidad@huayruro.pe` con asunto "Solicitud ARCO — <tipo>" |
| Presencial | En cualquier botica de la cadena. Operador entrega plantilla de solicitud |
| Web | Formulario en `huayruro.pe/derechos` (habilitar sprint 7) |

## 2. Procedimiento paso a paso

### Paso 1 — Recepción y registro
- Día 0: la solicitud entra por cualquier vía
- DPO la registra en `audit_log` con `accion = 'arco_solicitud_recibida'`
- Asigna número de caso `ARCO-YYYY-NNN`

### Paso 2 — Verificación de identidad
- Solicitar copia de DNI vigente (escaneado o presencial)
- Verificar que el solicitante es efectivamente el titular o un representante con poder
- Si no se puede verificar identidad: solicitar más información (max 5 días para responder)

### Paso 3 — Triaje del tipo

| Tipo | Acción |
|---|---|
| **A (Acceso)** | Extraer todos los datos del titular del sistema: `audit_log` + `usuario_perfil` (si aplica) + cualquier referencia. Compilar en PDF con metadata: qué datos, finalidad, plazo de retención. Enviar por email cifrado. |
| **R (Rectificación)** | Confirmar el dato a corregir. Aplicar `UPDATE` en la tabla correspondiente. Registrar antes/después en `audit_log`. Confirmar al titular. |
| **C (Cancelación)** | Verificar si hay obligación legal de retención (tributaria 5 años, contable). Si NO hay obligación: hard delete. Si SÍ hay: anonimización (scrub email/nombre, mantener id para FK). Notificar al titular con qué datos se cancelaron y cuáles se anonimizaron por obligación. |
| **O (Oposición)** | Aplicable cuando el tratamiento no es obligatorio. Si aplica: stop al tratamiento del dato + scrub. Si no aplica: explicar al titular por qué (base legal del tratamiento). |

### Paso 4 — Respuesta formal

- Email al titular con:
  - Número de caso
  - Tipo de solicitud atendida
  - Acción realizada
  - Fecha de ejecución
  - Si fue parcial: por qué + qué quedó retenido + base legal
- Copia archivada en `docs/legal/arco-respuestas/ARCO-YYYY-NNN.md`

### Paso 5 — Cierre

- `audit_log` registra `accion = 'arco_resuelto'` con `datos_despues` = lo que se hizo
- Si el titular acepta la respuesta: caso cerrado
- Si no acepta: facilitar info de reclamo ante ANPDP

## 3. Casos especiales

### Solicitud anónima o sin verificación de identidad
- Se rechaza con explicación. No procede sin verificar identidad — proteger al titular real.

### Solicitud presencial sin acceso a sistema (Chazuta sin red ese día)
- Operador toma datos + escanea DNI con celular
- Envía a Kevin (DPO) por email/WhatsApp
- DPO procesa dentro del plazo

### Solicitud sobre datos de menor de edad
- Solo procede solicitud del representante legal con acreditación
- Documentar acreditación en el caso

### Solicitud sobre datos sensibles (salud — fase 2/3)
- Tratamiento adicional: doble verificación de identidad
- Respuesta en plazo más corto (15 días hábiles)

## 4. Plantilla de respuesta

```
Asunto: Respuesta a su solicitud ARCO — Caso ARCO-2026-001

Estimado/a <nombre>,

En atención a su solicitud recibida el <fecha> de <tipo: acceso/rectificación/cancelación/oposición>
de sus datos personales tratados por Cadena Botica Huayruro:

[Cuerpo: qué se hizo, qué se entrega, qué se difirió y por qué]

Fecha de ejecución: <fecha>
Caso: ARCO-2026-NNN

Si considera que esta respuesta no atiende correctamente sus derechos, puede presentar
reclamación ante la Autoridad Nacional de Protección de Datos Personales (ANPDP) del
Ministerio de Justicia: denuncias@minjus.gob.pe.

Atentamente,
Kevin Alexander Mandujano García
Oficial de Datos Personales
Cadena Botica Huayruro
```

## 5. Métricas a seguir

- M12 de [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/10-metricas-exito.md]]: tiempo medio de respuesta (objetivo ≤ 15 días)
- Cantidad de solicitudes por trimestre
- Tipo predominante de solicitud
- Tasa de aceptación / reclamo

## Documentos relacionados

- [[dpo-designacion.md]]
- [[politica-privacidad.md]]
- [[politica-retencion.md]]
