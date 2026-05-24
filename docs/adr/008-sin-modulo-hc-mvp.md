# ADR-008 — Sin módulo HC ni transcripción clínica en MVP

- **Status:** Accepted
- **Date:** 2026-05-24
- **Decision-makers:** Kevin
- **Consulted:** Compliance Officer (panel virtual)

## Context and Problem Statement
La visión incluye consultorio anexo con historial clínico (fase 3, 2027). ¿Construimos el módulo HC ahora "para que esté"?

## Decision Drivers
- Ley 29459 + Ley 26842: prescripción y atención clínica reservada a profesional habilitado
- LPDP categoría sensible salud
- Consultorio anexo a las boticas NO está habilitado por DIRESA al 2026-05-24

## Considered Options
- **A: Construir módulo HC en MVP** (deshabilitado por flag)
- **B: No construir HC, diferir a fase 3 cuando consultorio se habilite**

## Decision Outcome
**Chosen option: B — Sin HC en MVP**. El sistema técnico se mantiene en lado defensible: solo registra transacciones de venta + lotes + stock. El operador (Kevin/papás) puede prescribir verbalmente en mostrador como hoy — el sistema NO documenta esa prescripción.

Si en fase 3 se habilita consultorio anexo con químico-farmacéutico o médico, construir módulo HC con encriptación at-rest + consentimientos firmados + acceso solo a profesional habilitado.

### Consequences
- ✅ Sin riesgo regulatorio adicional del sistema (Ley 29459, LPDP categoría sensible)
- ✅ MVP entrega valor sin tocar el área más sensible
- ⚠️ Cuando llegue fase 3, construir HC requiere migration + UI nueva — esperado

## More Information
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/06-compliance-legal.md]] · sección DIGEMID
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion-investigate-resultados.md]] · hipótesis 8
