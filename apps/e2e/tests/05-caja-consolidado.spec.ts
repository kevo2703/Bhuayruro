import type { Page } from "@playwright/test";
import { test, expect, permitirErrorDeConsola } from "../util/fixtures";
import { ADMIN_VES, SUPER, VENDEDORA } from "../util/cuentas";
import { entrar, irA } from "../util/acciones";

// Los dos últimos pasos del checklist E12: cierre de caja y consolidado del dueño. Van al final del
// guion a propósito: el cierre tiene que ver TODAS las ventas de la suite, y solo se puede cerrar una
// vez por día (el segundo intento da 409). Por eso la base de cada corrida es nueva.

test.describe.configure({ mode: "serial" });

test("el resumen del día cuadra con lo que se vendió", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/caja");

  const resumen = page.locator("div").filter({ hasText: "Resumen del día" }).last();
  await expect(resumen).toBeVisible();
  // Hubo ventas en efectivo y en Yape a lo largo de la suite: el total del sistema no puede ser cero.
  await expect(resumen, "el total del sistema sale de las ventas reales").toContainText(/Total sistema/);
  await expect(resumen).toContainText(/S\/\s*[1-9]/);
});

/** Filas de cierre del historial (el encabezado de la tabla también es role="row", así que se filtra). */
const filasDeCierre = (page: Page) => page.getByRole("row").filter({ hasText: /Cuadró|Sobró|Faltó/ });

test("cerrar la caja calcula la diferencia en el server, no en el navegador", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/caja");
  await expect(filasDeCierre(page), "el día arranca sin cierres").toHaveCount(0);

  // Se cuenta un efectivo distinto al esperado a propósito: si el server no calculara la diferencia,
  // un descuadre real pasaría desapercibido — y el descuadre es lo que abre un caso EBR.
  await page.getByLabel("Efectivo").fill("5.00");
  await page.getByLabel("Yape/Plin").fill("0.00");
  await page.getByLabel("Otros").fill("0.00");
  await page.getByPlaceholder("Observaciones (opcional)").fill("Cierre del smoke e2e");
  await page.getByRole("button", { name: /^Cerrar caja$/ }).click();

  // El server responde con la diferencia calculada por él. Se contó S/ 5.00 contra ventas reales:
  // tiene que salir un faltante, no un "cuadró" de cortesía.
  await expect(page.getByText(/^Caja cerrada\. Diferencia: /), "el server devuelve la diferencia").toBeVisible({ timeout: 30_000 });
  await expect(filasDeCierre(page), "y el cierre queda en el historial").toHaveCount(1);
  await expect(filasDeCierre(page).first(), "con S/ 5.00 contados contra las ventas del día, falta plata").toContainText(/Faltó/);
});

test("no se puede cerrar dos veces el mismo día", async ({ page }) => {
  // El 409 del segundo cierre ES lo que se está probando, así que su error de consola está permitido
  // en ESTE test y en ninguno más.
  permitirErrorDeConsola(page, /Failed to load resource.*409/i);
  await entrar(page, ADMIN_VES);
  await irA(page, "#/caja");
  await expect(filasDeCierre(page)).toHaveCount(1);

  await page.getByLabel("Efectivo").fill("999.00");
  await page.getByRole("button", { name: /^Cerrar caja$/ }).click();

  // Sin esta guarda (UNIQUE sucursal+fecha → 409), dos cierres del mismo día dejarían la caja con dos
  // verdades distintas y el caso EBR de descuadre mirando la equivocada.
  await expect(page.getByText("el cierre de caja de ese día ya existe"), "el segundo cierre se rechaza con su motivo").toBeVisible();
  await expect(filasDeCierre(page), "y NO se escribió un segundo cierre").toHaveCount(1);
});

test("el dueño ve el consolidado de la cadena, agregado y sin detalle ajeno", async ({ page }) => {
  await entrar(page, SUPER);
  await irA(page, "#/consolidado");

  const cuerpo = page.locator("body");
  // La regla de aislamiento del §4: el super ve AGREGADOS por botica, nunca el detalle de una venta
  // de otra sede. Que estén las tres boticas del seed es la prueba de que el rollup es de cadena.
  await expect(cuerpo).toContainText(/VES|Villa El Salvador/i);
  await expect(cuerpo).toContainText(/Chazuta/i);
});

test("el vendedor no llega al consolidado ni por la dirección directa", async ({ page }) => {
  await entrar(page, VENDEDORA);
  await irA(page, "#/consolidado");

  // `useRuta` valida la ruta contra el rol y cae al home. Si esto se rompe, un vendedor vería la
  // facturación de las otras boticas de la familia.
  await expect(page.getByPlaceholder("Buscar por nombre o código..."), "cae al Mostrador, su home").toBeVisible();
});
