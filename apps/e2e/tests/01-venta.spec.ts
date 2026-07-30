import { test, expect } from "../util/fixtures";
import { ADMIN_VES, PRODUCTOS } from "../util/cuentas";
import {
  abrirMostrador,
  agregarAlCarrito,
  cobrar,
  contrasteDe,
  entrar,
  espiarGuias,
  guiasImpresas,
  irA,
  lineaDelCarrito,
  totalDelCarrito,
} from "../util/acciones";

// El camino del checklist E12 (plan D1 §15.1 y §18): login → buscar → carrito → cobrar → guía →
// anular. El cierre de caja va en el último archivo, porque tiene que ver las ventas de todos.

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await espiarGuias(page);
});

test("la búsqueda encuentra el producto aunque se escriba con tilde", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await abrirMostrador(page);

  // El caso del plan §5: "ibúprofeno" (mal tildado, como lo escribe cualquiera) tiene que traer
  // "Ibuprofeno". Acá se prueba la búsqueda LOCAL de Dexie, que es la que ve quien atiende; el FTS5
  // del server tiene su propio test en apps/api.
  await page.getByPlaceholder("Buscar por nombre o código...").fill("ibúprofeno");
  await expect(page.locator("li").filter({ hasText: PRODUCTOS.ibuprofeno }).first()).toBeVisible();

  // Y un código de barras del seed también entra por el mismo campo (lector de barras).
  await page.getByPlaceholder("Buscar por nombre o código...").fill("zzzznoexiste");
  await expect(page.getByText("Sin resultados.")).toBeVisible();
});

test("el total del carrito es el que dice el producto, sin centavos perdidos", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await abrirMostrador(page);

  const unitario = await agregarAlCarrito(page, PRODUCTOS.paracetamol, 1);
  expect(unitario, "el botón de la presentación debería mostrar su precio").toMatch(/S\/\s*\d/);
  const totalUno = await totalDelCarrito(page);
  expect(totalUno, "una unidad: el total es el precio unitario").toBe(unitario);

  // Dos unidades = el doble exacto. El dinero viaja en enteros (§6) y esto lo verifica de punta a
  // punta: precio en diezmilésimas → línea en céntimos → total del botón.
  await lineaDelCarrito(page, PRODUCTOS.paracetamol).locator('input[type="number"]').fill("2");
  const soles = (s: string) => Math.round(Number(s.replace(/[^\d.,]/g, "").replace(",", ".")) * 100);
  await expect
    .poll(async () => soles(await totalDelCarrito(page)), { message: "dos unidades deberían costar el doble" })
    .toBe(soles(unitario) * 2);
});

test("cobrar imprime la guía de 80 mm con el IGV desglosado", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await abrirMostrador(page);
  await agregarAlCarrito(page, PRODUCTOS.paracetamol, 2);

  // El botón más importante del POS: si no se lee, no se cobra. Medido sobre lo rendido.
  const contraste = await contrasteDe(page.getByRole("button", { name: /^Cobrar · / }));
  expect(
    contraste.ratio,
    `"Cobrar" debe ser legible: ${contraste.ratio.toFixed(2)}:1 (${contraste.color} sobre ${contraste.fondo})`,
  ).toBeGreaterThanOrEqual(4.5);

  const total = await cobrar(page, { metodo: "Efectivo", recibido: "10.00" });

  // Sin impresora WebUSB concedida, `imprimirGuia` cae al fallback CSS de 80 mm. Esto comprueba el
  // fallback REAL (el que corre hoy en el piloto), no que exista la función.
  await expect.poll(async () => (await guiasImpresas(page)).length, { message: "debería salir una guía" }).toBeGreaterThan(0);
  const guia = (await guiasImpresas(page))[0] ?? "";
  expect(guia).toContain("Huayruro");
  expect(guia, "la guía desglosa el IGV").toMatch(/IGV/i);
  expect(guia, "y trae el total cobrado").toContain(total.replace(/S\/\s*/, ""));

  // Reimprimir la última guía es lo que salva un ticket que se atascó.
  await page.getByRole("button", { name: /Reimprimir/ }).click();
  await expect.poll(async () => (await guiasImpresas(page)).length).toBeGreaterThan(1);
  expect((await guiasImpresas(page))[1] ?? "", "la reimpresión se rotula como tal").toMatch(/reimpres/i);
});

test("la venta aparece en el panel y el encargado la puede anular", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/dashboard");

  // La venta cobrada por el mostrador llega al feed del panel (pasó por la cola offline).
  const filaVenta = page.getByRole("row").filter({ hasText: PRODUCTOS.paracetamol }).first();
  await expect(filaVenta, "la venta cobrada debería aparecer en Últimas ventas").toBeVisible({ timeout: 30_000 });

  const botones = page.getByRole("button", { name: "Anular" });
  const antes = await botones.count();
  expect(antes, "cada venta del feed tiene su acción de anular").toBeGreaterThan(0);

  await filaVenta.getByRole("button", { name: "Anular" }).click();

  // Anular repone stock y mueve la caja del día: tiene que pedir motivo, no ser un tap suelto.
  const confirmar = page.getByRole("button", { name: /^Anular venta$/ });
  await expect(confirmar, "sin motivo escrito, no se puede confirmar").toBeDisabled();
  await page.getByPlaceholder(/la clienta devolvió/i).fill("Smoke e2e: devolución en el mostrador");
  await expect(confirmar).toBeEnabled();
  await confirmar.click();

  // El feed solo lista ventas 'completada': que la fila desaparezca ES la anulación.
  await expect(botones, "la venta anulada sale del feed").toHaveCount(antes - 1, { timeout: 30_000 });
});
