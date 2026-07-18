# Ritual de etapas — cómo se construye TODO lo que falta

> Nació de la sesión de orientación del 2026-07-17: el sistema se construyó 14 sesiones "en piloto
> automático" y Kevin terminó sin saber dónde estaba cada cosa. Este ritual evita que se repita.
> Aplica a **P1 (clientes)**, **P4a (venta cruzada)**, **P3 (rostros/Hikvision)**, **P6 (video-métricas)**,
> a la **unificación cámaras+audio** y a cualquier etapa nueva. Es corto a propósito: 3 pasos, sin excepciones.

## 1 · SPEC con Kevin, ANTES de codear

- La primera sesión de la etapa NO escribe código. Cierra con Kevin, vía `AskUserQuestion`, como mínimo:
  **cómo se llama** (el nombre que verá el usuario), **qué hace exactamente** (y qué NO hace),
  y **cómo sabremos que está lista** (el criterio de "terminado" en una frase).
- El spec queda escrito en el plan correspondiente (plan-d1 / plan-expansión / plan-frentes) antes del primer commit.
- Si una premisa del pedido es falsa o choca con un veto → **DETENTE y corrígela** (regla 9), no se codea alrededor.

## 2 · Build con gates

- Protocolo de siempre (`build-d1-progreso.md`): typecheck + tests por paquete + build SPA + revisión
  adversarial cuando el bloque toca dinero, aislamiento o datos sensibles. Un checkbox solo se marca en verde.

## 3 · Cierre SIEMPRE con demo, eyeball y mapa

Ninguna etapa se declara cerrada sin estos tres, en este orden:

1. **Demo guiada** — deck `/presentar` con capturas reales (Playwright): qué pregunta responde lo nuevo,
   qué hay dentro, qué puede hacer Kevin, qué quedó "próximamente" y por qué.
2. **Checklist de eyeball de Kevin** — lista explícita de qué debe mirar/clickear él en vivo (máx. 5 ítems).
   "Pendiente Kevin (no bloquea)" ya no vale como cierre: el eyeball es parte de la etapa.
3. **Actualizar `#/mapa`** — la pantalla nueva entra a `VISTAS`/`SECCIONES` en `ruta.ts` y recibe su línea
   en `PARA_QUE` de `Mapa.tsx` (el typecheck obliga: sin línea no compila). Así el mapa nunca se desfasa.

## Nota dura para P3 (rostros) — cargar ANTES de la sesión de spec

Los vetos del plan de expansión (`botica-huayruro-sistema-automatizacion-plan-expansion.md`) se releen
ANTES de especificar cualquier cosa con cámaras o rostro. No son negociables:

- **El audio JAMÁS es señal de supervisión de personal** (RD 02-2020-JUS). El veto D-N5 tiene test; se extiende
  a cualquier fuente nueva (video incluido): casos/espejo no leen audio ni biometría.
- **Sanción automática, nunca.** Todo pasa por la bandeja de casos con revisor humano.
- **Rostro = dato biométrico sensible (LPDP Ley 29733).** La inscripción del banco de datos ante la ANPDP
  va al backlog **pre-producción**: el piloto puede probar viabilidad, pero P3 no sale de piloto sin eso resuelto.
- Si el pedido de la sesión contradice cualquiera de estos puntos → regla 9: parar y corregir con Kevin,
  no construir una versión "suave" del veto.
