import { test, expect } from "../util/fixtures";
import { ADMIN_VES, PRODUCTOS } from "../util/cuentas";
import { abrirMostrador, agregarAlCarrito, cobrar, entrar, identificarCliente, irA } from "../util/acciones";

// S13 + S14 (P1 Clientes / A1): identificar a quien compra ES el combustible de todo el motor de
// recompra — sin teléfono no hay reposición (S16) ni RFM (P4b). Y el KPI de "% identificadas" es el
// que le dice a Kevin si el piloto está capturando o no.

test.describe.configure({ mode: "serial" });

const MARIA = { nombre: "María Quispe e2e", celular: "918343561", optin: true };

test("el mostrador identifica al cliente y lo crea en 3 campos", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await abrirMostrador(page);
  await agregarAlCarrito(page, PRODUCTOS.loratadina, 3);

  await identificarCliente(page, MARIA);
  await expect(page.getByText(MARIA.nombre, { exact: false }).first(), "el nombre queda visible en la venta").toBeVisible();

  await cobrar(page, { metodo: "Yape" });
});

test("la venta con cliente ofrece el Seguimiento y se puede saltar", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await abrirMostrador(page);
  await agregarAlCarrito(page, PRODUCTOS.paracetamol, 1);
  await identificarCliente(page, MARIA);

  await page.getByRole("button", { name: /^Cobrar · / }).click();
  await page.getByRole("button", { name: /Confirmar e imprimir/ }).click();

  // El modal de Seguimiento aparece SOLO con cliente identificado. Y tiene que poder saltarse: en
  // hora punta nadie llena un formulario, y la bandeja de S16 no depende de esto.
  //
  // El ancla es la pregunta de los días y no el título: "Seguimiento" también rotula el panel
  // lateral del Mostrador, que sigue en pantalla cuando el modal se cierra.
  const preguntaDelModal = page.getByText("¿En cuántos días le preguntas?");
  await expect(preguntaDelModal, "con cliente identificado se ofrece el Seguimiento").toBeVisible();
  // Hay dos salidas ("ahora no" arriba y "Ahora no" en el pie): cualquiera tiene que servir.
  await page.getByRole("button", { name: /^ahora no$/i }).first().click();
  await expect(preguntaDelModal).toBeHidden();
  await expect(page.getByText(/Escanea un producto/)).toBeVisible();
});

test("el padrón encuentra a la clienta y su ficha muestra lo que compró", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/clientes");

  await page.getByPlaceholder("Buscar por nombre, celular o DNI…").fill("María Quispe e2e");
  const enLista = page.getByRole("button", { name: new RegExp(MARIA.nombre) }).first();
  await expect(enLista, "la clienta creada en el cobro está en el padrón").toBeVisible();
  await enLista.click();

  const cuerpo = page.locator("body");
  // La línea de tiempo es lo que convierte el padrón en algo útil en el mostrador: las dos compras
  // que le hicimos en este archivo tienen que estar ahí.
  await expect(cuerpo, "la ficha trae su línea de tiempo").toContainText("Línea de tiempo");
  await expect(cuerpo.getByText(/^compra$/), "con una entrada por compra").toHaveCount(2);

  // La constancia del consentimiento con SU frase y su fecha: es lo que sostiene, ante la LPDP, que
  // se le puede escribir. Si esto se pierde, el WhatsApp de S16 se queda sin respaldo.
  await expect(cuerpo, "queda la constancia de que aceptó, con la frase exacta").toContainText(
    /Aceptó el \d{2}\/\d{2}\/\d{4}: .¿Me da su WhatsApp para avisarle cuando le toque su medicina\?/,
  );
});

test("el KPI de ventas identificadas sale de ventas reales, no de un cero decorativo", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/dashboard");

  const kpi = page.locator("div").filter({ hasText: "Ventas con cliente (30 días)" }).last();
  await expect(kpi).toBeVisible();
  // Hubo ventas identificadas en este archivo: el KPI tiene que ser un porcentaje, no "Sin ventas aún".
  await expect(kpi, "con ventas identificadas el KPI muestra el porcentaje").toContainText(/%/);
  await expect(kpi).toContainText(/de \d+ ·/);
});
