import { test, expect } from "../util/fixtures";
import { ADMIN_VES, VENDEDORA } from "../util/cuentas";
import { entrar, irA } from "../util/acciones";

// El seed sintético trae al dueño y a los tres encargados, pero NINGÚN vendedor — y el vendedor es
// quien de verdad atiende el mostrador y quien recibe el shell mobile-first. Crearlo acá mata dos
// pájaros: la suite consigue su operador y de paso queda ejercitado E11.2 (CRUD de usuarios), que
// el checklist de P0 pide y hasta hoy nunca se probó por la interfaz.
//
// El orden de los archivos es el guion de la suite: este va primero por eso.

test.describe.configure({ mode: "serial" });

test("un encargado crea la cuenta del vendedor de su botica", async ({ page }) => {
  await entrar(page, ADMIN_VES);
  await irA(page, "#/usuarios");
  // El encargado solo ve a la gente de SU botica: arranca viéndose a sí mismo y a nadie más.
  await expect(page.getByText(ADMIN_VES.email, { exact: false })).toBeVisible();

  const yaEsta = page.getByText(VENDEDORA.email, { exact: false });
  if (await yaEsta.count()) {
    // Base reusada (E2E_REUSAR=1): la cuenta ya existe y sirve igual.
    await expect(yaEsta.first()).toBeVisible();
    return;
  }

  await page.getByRole("button", { name: /Agregar usuario/ }).click();
  await page.getByPlaceholder("Nombre").fill(VENDEDORA.nombre);
  await page.getByPlaceholder("Email").fill(VENDEDORA.email);
  await page.getByPlaceholder("Contraseña (mín. 8)").fill(VENDEDORA.pass);
  await page.getByRole("button", { name: /Crear usuario/ }).click();

  // Un admin_sucursal solo puede crear OPERADORES: el server ignora el rol que le manden (no hay
  // selector de rol en su formulario). Que aparezca como "Vendedor" es ese candado en verde.
  const fila = page.locator("div").filter({ hasText: VENDEDORA.email }).last();
  await expect(fila).toContainText(/Vendedor/);
});

test("el vendedor recién creado puede entrar y cae en el Mostrador", async ({ page }) => {
  await entrar(page, VENDEDORA);
  // `rutaHome`: el operador arranca en el Mostrador, no en el panel.
  await expect(page.getByPlaceholder("Buscar por nombre o código...")).toBeVisible();
  // Y no debería ver las pantallas de dueño.
  await expect(page.getByRole("button", { name: /^Consolidado$/ })).toHaveCount(0);
});
