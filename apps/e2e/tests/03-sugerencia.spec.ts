import { test, expect } from "../util/fixtures";
import { ADMIN_VES, PRODUCTOS } from "../util/cuentas";
import { abrirMostrador, agregarAlCarrito, cobrar, entrar, esperarConRecarga, esperarPost, irA, lineaDelCarrito } from "../util/acciones";

// S15 (P4a / A4): venta cruzada por reglas. La regla demo del seed 0003 dice que un antiinflamatorio
// oral se acompaña de protector gástrico — con el guion del que atiende, nunca sobreventa.
// El motor es LOCAL (Dexie): en hora punta un consejo que espera a la red llega tarde.

test.describe.configure({ mode: "serial" });

const TARJETA = '[data-testid="sugerencia"]';

test("agregar un antiinflamatorio ofrece el protector gástrico con su guion", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await abrirMostrador(page);
  await agregarAlCarrito(page, PRODUCTOS.ibuprofeno, 1);

  // La tarjeta vive DENTRO del carrito, pegada al total (si naciera fuera de pantalla en el celular
  // no serviría de nada — fue el defecto que atraparon las capturas de S15).
  const tarjeta = page.locator(TARJETA);
  await expect(tarjeta, "la sugerencia aparece al agregar el disparador").toBeVisible();
  await expect(tarjeta, "el protagonista es el consejo, no el precio").toContainText(/protector gástrico le cuida el estómago/i);
  await expect(tarjeta, "y nombra el producto sugerido").toContainText(PRODUCTOS.omeprazol);

  // Un tap la agrega al carrito.
  await tarjeta.getByRole("button", { name: /Agregar/ }).click();
  await expect(lineaDelCarrito(page, PRODUCTOS.omeprazol), "el sugerido entra al carrito").toBeVisible();
  await expect(tarjeta, "y la tarjeta se retira: una sugerencia por venta").toBeHidden();

  // Los eventos se mandan al CERRAR la atención y detrás de la venta (FIFO), así que hay que esperar
  // esa escritura antes de dar la venta por medida.
  const eventos = esperarPost(page, /\/api\/sugerencias\/eventos/);
  await cobrar(page);
  await eventos;
});

test("descartar la sugerencia no insiste en la misma venta", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await abrirMostrador(page);
  await agregarAlCarrito(page, PRODUCTOS.amoxicilina, 1);

  // Segunda regla del seed: dispara por CATEGORÍA (antibiótico), no por principio activo.
  const tarjeta = page.locator(TARJETA);
  await expect(tarjeta).toContainText(/El antibiótico suele caer pesado/i);
  await tarjeta.getByRole("button", { name: "Descartar sugerencia" }).click();
  await expect(tarjeta, "descartada no vuelve a aparecer").toBeHidden();

  // Descartar también se mide: si solo se contaran las aceptadas, la conversión saldría del 100 %.
  const eventos = esperarPost(page, /\/api\/sugerencias\/eventos/);
  await cobrar(page);
  await eventos;
});

test("no sugiere lo que ya está en el carrito", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await abrirMostrador(page);
  await agregarAlCarrito(page, PRODUCTOS.omeprazol, 1);
  await agregarAlCarrito(page, PRODUCTOS.ibuprofeno, 1);

  // Ofrecerle a la señora lo que ya está pagando es la forma más rápida de que deje de mirar la tarjeta.
  await expect(page.locator(TARJETA)).toHaveCount(0);
});

test("la conversión por regla se ve en el panel, con los soles que salieron de la venta", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/sugerencias");

  const fila = page.getByRole("row").filter({ hasText: /protector gástrico le cuida el estómago/i }).first();
  await expect(fila, "la regla que se aceptó tiene su fila de conversión").toBeVisible();

  // Los eventos de sugerencia salen por la MISMA cola offline que la venta, y DESPUÉS de ella (FIFO,
  // para que el server pueda engancharles el venta_id). O sea que el panel puede leerlos antes de que
  // lleguen: hay que recargar, no mirar más rato — `useApi` lee una sola vez al montar.
  const llegaron = await esperarConRecarga(page, async () => /S\/\s*[1-9]/.test(await fila.innerText()));
  expect(llegaron, "los soles agregados deberían llegar por la cola offline").toBe(true);
  // Se derivan de `venta_item` REAL: una aceptada cuyo producto no terminó en la venta suma 0.
  await expect(fila, "y los soles salen de la línea de venta, no de una estimación").toContainText(/S\/\s*[1-9]/);
});
