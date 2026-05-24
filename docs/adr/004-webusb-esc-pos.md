# ADR-004 — WebUSB nativo para impresión ESC/POS

- **Status:** Accepted (pendiente validación física sprint 1 día 1)
- **Date:** 2026-05-24
- **Decision-makers:** Kevin
- **Consulted:** Frontend Engineer (panel virtual)

## Context and Problem Statement
La PWA del mostrador debe imprimir guías internas en la impresora térmica 80mm que ya existe en VES y Chazuta. ¿Driver, app puente, o nativo del browser?

## Decision Drivers
- Cero instalación de software adicional en la PC
- Sin desarrollo nativo (Kevin solo con Claude Code)
- Funcionar en Windows 11 (boticas) confiable

## Considered Options
- **A: App puente local** (`node-thermal-printer` corriendo como servicio Node en la PC)
- **B: WebUSB API** (Chrome 89+ envía bytes ESC/POS directamente)
- **C: Driver del fabricante** (instalación específica por modelo)

## Decision Outcome
**Chosen option: B — WebUSB nativo**, porque Kevin ya validó WebUSB con Chrome antes (declaración 24-may). Cero deps. Limita el mostrador a Chrome/Edge — aceptable, controlamos el equipo.

**Validación pendiente sprint 1:** prueba real con la impresora actual de VES.

**Fallback:** si WebUSB falla con esa impresora puntual, A (app puente con `node-thermal-printer`).

### Consequences
- ✅ Cero instalación adicional
- ✅ Funciona con cualquier impresora ESC/POS estándar
- ⚠️ Limita a Chrome / Edge (Firefox + Safari no soportan WebUSB)
- ⚠️ La primera vez requiere que el operador autorice el device en Chrome — UX one-time

## More Information
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/02-stack-tecnologico.md]] · sección Impresión térmica
- [WebUSBReceiptPrinter (NielsLeenheer)](https://github.com/NielsLeenheer/WebUSBReceiptPrinter)
