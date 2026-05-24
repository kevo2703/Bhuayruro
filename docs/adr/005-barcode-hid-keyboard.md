# ADR-005 — Lector códigos de barras = teclado HID estándar

- **Status:** Accepted
- **Date:** 2026-05-24
- **Decision-makers:** Kevin

## Context and Problem Statement
¿Cómo escucha la PWA los códigos de barras del lector USB?

## Decision Drivers
- Cero código nativo
- Compatibilidad con cualquier lector comercial

## Considered Options
- **A: Lector como HID keyboard** (envía caracteres + Enter, frontend escucha `keydown`)
- **B: WebUSB con lector** (driver custom)
- **C: WebSerial** (algunos lectores soportan modo serial)

## Decision Outcome
**Chosen option: A — HID keyboard**. Es el modo estándar de prácticamente todos los lectores USB comerciales. El frontend escucha `keydown` con un buffer y dispara la búsqueda al recibir Enter (caracter Cr-Lf).

### Consequences
- ✅ Cero desarrollo nativo
- ✅ Funciona con cualquier lector comercial
- ⚠️ Si el operador tipea en otro input al escanear, los caracteres van al input equivocado — mitigación: auto-foco al input correcto + flag de "modo scan" con timeout

## More Information
- [[../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/01-arquitectura.md]] · ADR-05
