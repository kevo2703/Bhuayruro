import { test as base, expect, type Page } from "@playwright/test";

// Fixture con vigilancia de consola SIEMPRE encendida: en las 4 sesiones anteriores, lo que los
// tests unitarios no vieron y las capturas sí fueron errores de runtime del navegador. Un test que
// "pasa" mientras la consola escupe un TypeError no está pasando.

// Ruido conocido y ajeno al defecto que se está midiendo. Se agrega SOLO con la razón escrita.
const RUIDO_CONOCIDO: RegExp[] = [
  // El Mostrador con un super sin sucursal pide stock/catálogo de "su" botica y el server contesta
  // 400: es correcto (el super no cobra en ninguna caja) y es pre-existente desde S4.
  /Failed to load resource.*40[03]/i,
  // wrangler dev sirve la SPA sin service worker registrado en algunas corridas headless.
  /ServiceWorker|sw\.js/i,
];

// Permisos POR TEST. Algunos tests provocan un error a propósito (el 409 del doble cierre de caja ES
// el comportamiento que se está probando). Se declara test por test y no en la lista global de ruido:
// así un 409 inesperado en cualquier otra pantalla sigue tumbando la suite.
const permitidosPorPagina = new WeakMap<Page, RegExp[]>();

export function permitirErrorDeConsola(page: Page, patron: RegExp): void {
  const actuales = permitidosPorPagina.get(page) ?? [];
  permitidosPorPagina.set(page, [...actuales, patron]);
}

export const test = base.extend<{ vigilarConsola: void }>({
  vigilarConsola: [
    async ({ page }, use, testInfo) => {
      const errores: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errores.push(m.text());
      });
      page.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));

      await use();

      // Si el test ya falló, el error de consola es consecuencia y no causa: no lo tapamos con otro.
      if (testInfo.status !== testInfo.expectedStatus) return;
      const permitidos = [...RUIDO_CONOCIDO, ...(permitidosPorPagina.get(page) ?? [])];
      const reales = errores.filter((e) => !permitidos.some((r) => r.test(e)));
      expect(reales, "la pantalla no debería tirar errores de consola").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
