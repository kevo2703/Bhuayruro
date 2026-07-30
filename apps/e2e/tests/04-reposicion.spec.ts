import { test, expect } from "../util/fixtures";
import { ADMIN_VES, PRODUCTOS, VENDEDORA } from "../util/cuentas";
import { abrirMostrador, agregarAlCarrito, cobrar, contrasteDe, entrar, esperarConRecarga, identificarCliente, irA } from "../util/acciones";

// S16 (A2 v1): la bandeja de reposición de crónicos. La botica sabe a quién se le está por acabar su
// medicina y abre el WhatsApp con el mensaje ya escrito. Nada se envía solo.
//
// El seed 0004 ya trae Loratadina y Omeprazol marcados como crónicos con dosis 1 al día, así que la
// bandeja se llena con las ventas que hicieron los archivos anteriores.

test.describe.configure({ mode: "serial" });

const ROSA = { nombre: "Rosa Ttito e2e", celular: "918111222", optin: true };
const PEDRO = { nombre: "Pedro Sin Permiso e2e", celular: "918999888", optin: false };

test("el catálogo muestra los tratamientos crónicos con su dosis", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/catalogo");

  // Δ4 no tenía escritor hasta S16: si esta tarjeta desaparece, la bandeja no puede nacer con datos.
  const tarjeta = page.locator("div").filter({ hasText: "Tratamientos crónicos" }).last();
  await expect(tarjeta).toBeVisible();
  await expect(tarjeta, "los crónicos del seed están marcados con su dosis").toContainText(/al día/);
});

test("a quien no dio permiso no se le escribe, y su teléfono no llega a la pantalla", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await abrirMostrador(page);

  // 3 unidades con dosis de 1 al día = se le acaba en 3 días, que es justo el borde de la ventana.
  // Con 5 unidades NO tendría que aparecer todavía, y eso es correcto: la bandeja avisa cuando toca,
  // no cuando se vendió.
  await agregarAlCarrito(page, PRODUCTOS.omeprazol, 3);
  await identificarCliente(page, ROSA);
  await cobrar(page);

  // Pedro se lleva lo mismo pero NUNCA dio permiso de WhatsApp.
  await abrirMostrador(page);
  await agregarAlCarrito(page, PRODUCTOS.loratadina, 3);
  await identificarCliente(page, PEDRO);
  await cobrar(page);

  await irA(page, "#/reposiciones");
  const cuerpo = page.locator("body");
  const aparecio = await esperarConRecarga(page, async () => (await cuerpo.innerText()).includes(ROSA.nombre));
  expect(aparecio, "Rosa debería entrar a la bandeja (se le acaba en 3 días)").toBe(true);
  await expect(cuerpo, "y se dice cuándo se le acaba").toContainText(/se le acaba en \d+ día|se le acabó hace/);
  await expect(cuerpo, "Pedro nunca dio permiso: no entra a la bandeja").not.toContainText(PEDRO.nombre);
  await expect(cuerpo, "pero se avisa que hay gente sin permiso").toContainText(/no acept/i);
  await expect(cuerpo, "el teléfono de quien no dio permiso no viaja al navegador").not.toContainText(PEDRO.celular);
});

test("el enlace de WhatsApp lleva el 51 y el mensaje escrito, y el botón se lee", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/reposiciones");

  // La tarjeta de Rosa, no "la primera": el orden lo decide la urgencia (los atrasados van primero),
  // así que dar por hecho quién encabeza la lista es lo mismo que no probar nada.
  const tarjetaRosa = page.locator("div").filter({ hasText: ROSA.nombre }).filter({ has: page.locator('a:has-text("Abrir WhatsApp")') }).last();
  const enlace = tarjetaRosa.locator('a:has-text("Abrir WhatsApp")').first();
  await expect(enlace).toBeVisible();

  // El defecto de S16: `a { color }` fuera de @layer base le ganaba a `text-white` y este botón verde
  // salía con texto ROJO. Se mide sobre lo rendido para que no pueda volver sin que la suite grite.
  const contraste = await contrasteDe(enlace);
  expect(
    contraste.ratio,
    `"Abrir WhatsApp" debe ser legible: ${contraste.ratio.toFixed(2)}:1 (${contraste.color} sobre ${contraste.fondo})`,
  ).toBeGreaterThanOrEqual(4.5);

  const href = (await enlace.getAttribute("href")) ?? "";
  expect(href, "el número de Rosa sale con el 51 de Perú delante").toMatch(
    new RegExp(`^https://wa\\.me/51${ROSA.celular}\\?text=`),
  );
  const texto = decodeURIComponent(href.split("?text=")[1] ?? "");
  expect(texto, "saluda como se saluda en Perú, según la hora de Lima").toMatch(/Buen[oa]s (días|tardes|noches), Rosa\./);
  expect(texto, "dice de parte de quién").toContain("Botica Huayruro");
  expect(texto, "nombra el producto que se le acaba").toContain(PRODUCTOS.omeprazol);
  expect(texto, "y ofrece separarlo, sin presionar").toMatch(/¿Se lo separamos/i);
});

test('"ya le escribí" saca a la persona de la lista y se puede deshacer', async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/reposiciones");

  const tarjetaRosa = page.locator("div").filter({ hasText: ROSA.nombre }).filter({ has: page.getByRole("button", { name: /Ya le escribí/ }) }).last();
  await tarjetaRosa.getByRole("button", { name: /Ya le escribí/ }).click();

  // El "ya le escribí" es de la BOTICA, no del navegador: la bandeja se abre desde el celular del
  // mostrador y desde la compu. Con marca local, la señora recibía el mismo mensaje dos veces.
  const cuerpo = page.locator("body");
  await expect(cuerpo, "queda anotado en lo hecho hoy").toContainText(/ya les escribiste hoy/i);
  await expect(page.getByRole("button", { name: /^Deshacer$/ }).first()).toBeVisible();

  await page.getByRole("button", { name: /^Deshacer$/ }).first().click();
  await expect(cuerpo, "deshacer la devuelve a los pendientes").toContainText(/les toca reponer/i);
  await expect(tarjetaRosa.getByRole("button", { name: /Ya le escribí/ })).toBeVisible();
});

test("la vendedora la encuentra desde el celular, sin scroll horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await entrar(page, VENDEDORA);

  // Llega por su barra de navegación, sin saberse la dirección de memoria.
  await expect(page.getByRole("button", { name: /Reposición/ })).toBeVisible();
  await page.getByRole("button", { name: /Reposición/ }).click();
  await expect(page.locator("body")).toContainText(ROSA.nombre);

  // El motivo por el que la bandeja vive en el shell POS: a 390 px tiene que caber.
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(ancho, `no debería haber scroll horizontal (scrollWidth=${ancho})`).toBeLessThanOrEqual(390);

  // Se toca con el local lleno: los dos botones grandes tienen que ser tocables de verdad.
  const caja = await page.locator('a:has-text("Abrir WhatsApp")').first().boundingBox();
  expect(Math.round(caja?.height ?? 0), "el botón de WhatsApp llega al mínimo táctil").toBeGreaterThanOrEqual(44);
  const cajaMarcar = await page.getByRole("button", { name: /Ya le escribí/ }).first().boundingBox();
  expect(Math.round(cajaMarcar?.height ?? 0), 'y el de "ya le escribí" también').toBeGreaterThanOrEqual(44);
});
