# ADR-007 — Audio fase 2 on-device sin retención

- **Status:** Accepted (no aplica al MVP — guía para fase 2)
- **Date:** 2026-05-24
- **Decision-makers:** Kevin
- **Consulted:** Compliance Officer, Data/AI Engineer (panel virtual)

## Context and Problem Statement
Fase 2 incluye capturar audio del mostrador para extraer campos transaccionales. ¿Cómo cumplir LPDP (datos sensibles de salud → consentimiento escrito previo) sin romper el flujo de venta?

## Decision Drivers
- LPDP Art. 14: datos sensibles requieren consentimiento por escrito
- Operación realista en una botica de avenida con clientes apurados
- Minimizar superficie regulatoria

## Considered Options
- **A: Grabar audio + transmitir a cloud + transcribir + persistir** (vía completa)
- **B: Grabar + procesar on-device + persistir transcripción** (sin envío cloud)
- **C: Procesar on-device + extraer solo campos transaccionales + descartar audio y transcripción**

## Decision Outcome
**Chosen option: C — Procesamiento on-device sin retención**. Whisper local (faster-whisper int8 CPU). Solo se persisten campos transaccionales (productos mencionados, ¿se cobró?). Sin contenido clínico. Sin audio crudo. Sin transcripción literal.

Cartel obligatorio en cada botica + política pública. Justificación legal: sin retención prolongada de dato sensible → no constituye "tratamiento" en el sentido amplio del Art. 13.5.

### Consequences
- ✅ Cumple LPDP por diseño
- ✅ No expone evidencia auto-incriminatoria de prescripción no-químico-farmacéutico (Ley 26842)
- ✅ Cero costo de cloud inference
- ⚠️ Calidad de extracción depende del modelo Whisper local (validar fase 2)
- ⚠️ Procesamiento on-device requiere PC con capacidad suficiente (validar Chazuta)

## More Information
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/06-compliance-legal.md]] · sección CL-12
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion-investigate-resultados.md]] · hipótesis 4
