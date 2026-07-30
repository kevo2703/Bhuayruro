import { expect, type Locator, type Page } from "@playwright/test";
import type { Cuenta } from "./cuentas";

// Acciones del POS por la INTERFAZ. Nada de llamadas directas a la API: si un flujo no se puede
// hacer clickeando, el smoke no debe fingir que sí (fue lo que dejó la anulación sin pantalla
// durante tres semanas de piloto).

/** Espera activa en vez de dormir: casi todo el POS carga de Dexie y de un fetch encadenado. */
export async function esperarTexto(page: Page, texto: RegExp | string): Promise<void> {
  await expect(page.locator("body")).toContainText(texto);
}

export async function entrar(page: Page, quien: Cuenta): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(quien.email);
  await page.locator("#password").fill(quien.pass);
  await page.getByRole("button", { name: /Iniciar sesión/i }).click();
  await expect(page.getByRole("button", { name: /Iniciar sesión/i }), `${quien.email} debería entrar`).toHaveCount(0);
}

export async function salir(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Cerrar sesión/i }).first().click();
  await expect(page.getByRole("button", { name: /Iniciar sesión/i })).toBeVisible();
}

/** Navega por hash. `#/` es el Mostrador; el resto son las rutas de `ruta.ts`. */
export async function irA(page: Page, hash: string): Promise<void> {
  await page.goto(`/${hash}`, { waitUntil: "domcontentloaded" });
}

/** El Mostrador tarda en hidratar el catálogo desde Dexie: hay que esperar al buscador vivo. */
export async function abrirMostrador(page: Page): Promise<void> {
  await irA(page, "#/");
  await expect(page.getByPlaceholder("Buscar por nombre o código...")).toBeVisible();
}

/**
 * Busca el producto y lo agrega al carrito tocando su presentación.
 * Devuelve el precio unitario TAL COMO lo pinta el botón, para poder cruzarlo contra el total.
 */
export async function agregarAlCarrito(page: Page, producto: string, cantidad = 1): Promise<string> {
  const buscador = page.getByPlaceholder("Buscar por nombre o código...");
  await buscador.fill(producto);

  const fila = page.locator("li").filter({ hasText: producto }).first();
  await expect(fila, `"${producto}" debería aparecer en la búsqueda`).toBeVisible();
  const botonPresentacion = fila.getByRole("button").first();
  const etiqueta = await botonPresentacion.innerText();
  const precio = /S\/\s*[\d.,]+/.exec(etiqueta)?.[0]?.replace(/\s+/g, " ") ?? "";
  await botonPresentacion.click();

  const linea = lineaDelCarrito(page, producto);
  await expect(linea, `"${producto}" debería entrar al carrito`).toBeVisible();
  if (cantidad !== 1) {
    await linea.locator('input[type="number"]').fill(String(cantidad));
    await expect(linea.locator('input[type="number"]')).toHaveValue(String(cantidad));
  }
  return precio;
}

/** La línea del carrito de ese producto (el carrito es la única lista con el input de cantidad). */
export function lineaDelCarrito(page: Page, producto: string): Locator {
  return page.locator("li").filter({ hasText: producto }).filter({ has: page.locator('input[type="number"]') }).first();
}

/** Total del carrito tal como lo muestra el botón de cobrar (fuente de verdad de la pantalla). */
export async function totalDelCarrito(page: Page): Promise<string> {
  const boton = page.getByRole("button", { name: /^Cobrar · / });
  await expect(boton).toBeEnabled();
  const t = await boton.innerText();
  return /S\/\s*[\d.,]+/.exec(t)?.[0]?.replace(/\s+/g, " ") ?? "";
}

type OpcionesCobro = { metodo?: "Efectivo" | "Yape" | "Plin" | "Tarjeta"; recibido?: string };

/** Cobra la venta en curso. Devuelve el total cobrado, leído del modal antes de confirmar. */
export async function cobrar(page: Page, opciones: OpcionesCobro = {}): Promise<string> {
  const { metodo = "Efectivo", recibido } = opciones;
  await page.getByRole("button", { name: /^Cobrar · / }).click();

  const titulo = page.getByRole("heading", { name: /^Cobrar S\// });
  await expect(titulo).toBeVisible();
  const total = /S\/\s*[\d.,]+/.exec(await titulo.innerText())?.[0]?.replace(/\s+/g, " ") ?? "";

  if (metodo !== "Efectivo") await page.getByRole("button", { name: metodo, exact: false }).first().click();
  if (recibido !== undefined) await page.getByPlaceholder("0.00").fill(recibido);

  await page.getByRole("button", { name: /Confirmar e imprimir/ }).click();
  // La venta sale por la cola offline (Dexie → flusher). El botón de cobrar NO desaparece: se queda
  // deshabilitado en S/ 0.00, así que la señal honesta de "ya se cobró" es el carrito vacío.
  await expect(page.getByText(/Escanea un producto/), "el carrito debería quedar vacío tras cobrar").toBeVisible();

  // S14 ofrece registrar el Seguimiento cuando la venta tiene cliente. El smoke lo salta salvo que
  // el test lo pida explícitamente: la gracia de S16 es que la bandeja se llena SIN ese registro.
  // Hay DOS formas de saltarlo (el enlace del encabezado y el botón del pie): cualquiera sirve.
  const ahoraNo = page.getByRole("button", { name: /^ahora no$/i });
  if (await ahoraNo.count()) await ahoraNo.first().click();

  // Antes de irse del Mostrador hay que dejar que la cola drene: los paneles leen del server, y la
  // venta (y los eventos de sugerencia que van detrás de ella) todavía pueden estar en Dexie.
  await esperarColaVacia(page);
  return total;
}

/**
 * Espera a que el equipo quede al día, o sea a que la cola de Dexie se vacíe.
 *
 * OJO CON EL ROTULADO: el mismo estado se dice de dos maneras según el shell — el panel escribe
 * "N por sincronizar" y el POS escribe "N en cola" (Layout.tsx:151 vs :232). Mirar solo uno de los dos
 * hace que la espera resuelva al instante en el Mostrador y que la suite se vaya antes del flush: así
 * se perdían los eventos de venta cruzada de una venta sí y de la otra no.
 *
 * Y ojo con el atajo tentador de recargar en bucle para "apurar" la cola: el flusher vive en la
 * página, así que cada recarga le reinicia el backoff (1s/5s/30s) y puede impedir que mande nunca.
 */
export async function esperarColaVacia(page: Page, timeout = 30_000): Promise<void> {
  await page
    .getByText(/por sincronizar|en cola/)
    .first()
    .waitFor({ state: "hidden", timeout })
    .catch(() => {
      /* si nunca apareció, la cola ya estaba vacía */
    });
}

/**
 * Deja armada la espera de una escritura que viaja por la cola offline, ANTES de disparar la acción.
 * Es la única forma honesta de saber que el server la recibió: la pantalla confirma con datos locales
 * mucho antes de que el dato salga del equipo.
 */
export function esperarPost(page: Page, ruta: RegExp): Promise<unknown> {
  return page.waitForResponse((r) => ruta.test(r.url()) && r.request().method() === "POST", { timeout: 45_000 });
}

/**
 * Recarga hasta que la pantalla refleje algo que viaja por la COLA OFFLINE.
 * Los paneles leen una sola vez al montar (`useApi`), así que esperar sobre el DOM no sirve: si el
 * dato todavía no llegó al server, no va a aparecer solo por mirar más rato.
 */
export async function esperarConRecarga(page: Page, comprobar: () => Promise<boolean>, intentos = 8): Promise<boolean> {
  for (let i = 0; i < intentos; i++) {
    await esperarQueTermineDeCargar(page);
    if (await comprobar()) return true;
    await page.waitForTimeout(1_500);
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await esperarQueTermineDeCargar(page);
  return comprobar();
}

/**
 * Espera a que se vayan los rótulos de "cargando" del panel. Sin esto, mirar el texto de la página
 * justo después de recargar mide la pantalla a medio pintar y da un falso negativo (la bandeja de
 * reposición decía "Armando la lista…", que no es lo mismo que estar vacía).
 */
export async function esperarQueTermineDeCargar(page: Page): Promise<void> {
  const cargando = page.getByText(/Armando la lista|Cargando|Buscando…/);
  await cargando
    .first()
    .waitFor({ state: "hidden", timeout: 20_000 })
    .catch(() => {
      /* si nunca apareció, no hay nada que esperar */
    });
}

/** Identifica al cliente en el cobro (S14). Si no existe, lo crea con su opt-in de WhatsApp. */
export async function identificarCliente(page: Page, datos: { nombre: string; celular: string; optin: boolean }): Promise<void> {
  await page.getByRole("button", { name: /👤 Cliente/ }).click();
  const buscador = page.getByPlaceholder(/María, 918 343 561/);
  await expect(buscador).toBeVisible();
  await buscador.fill(datos.nombre);

  // Los resultados del padrón viven en la lista; el botón de crear NO. Distinguirlos importa: el
  // rótulo del botón de crear incluye lo que se tecleó (➕ Crear cliente "María…"), así que buscar
  // el nombre en toda la pantalla encuentra ese botón y no a la persona.
  const enPadron = page.locator("ul li button").filter({ hasText: datos.nombre }).first();
  const sinResultados = page.getByText("No hay nadie con ese dato");
  // El padrón responde por red: hay que dejarlo contestar antes de decidir crear.
  await expect(enPadron.or(sinResultados).first()).toBeVisible();

  if (await enPadron.count()) {
    await enPadron.click();
  } else {
    await page.getByRole("button", { name: /Crear cliente/ }).click();
    // `exact` en los dos: sin él, "918 343 561" también pega en el placeholder del buscador
    // ("María, 918 343 561, 45678912…") y el celular se escribiría en el campo equivocado.
    await page.getByPlaceholder("María Quispe", { exact: true }).fill(datos.nombre);
    await page.getByPlaceholder("918 343 561", { exact: true }).fill(datos.celular);
    // El consentimiento está deshabilitado hasta que haya celular (no se puede aceptar recibir
    // WhatsApp sin número), así que este orden no es casual.
    if (datos.optin) await page.locator('input[type="checkbox"]:not([disabled])').first().check();
    await page.getByRole("button", { name: /Guardar y asignar/ }).click();
  }
  // `exact` distingue el ✕ del carrito ("Quitar cliente") del enlace del panel de Seguimiento
  // ("quitar cliente", en minúscula): son dos botones distintos y el que confirma la asignación a la
  // venta en curso es el del carrito.
  await expect(
    page.getByRole("button", { name: "Quitar cliente", exact: true }),
    "el cliente debería quedar pegado a la venta",
  ).toBeVisible();
}

/**
 * Contraste REAL de un elemento, calculado sobre lo que el navegador rindió (no sobre la clase CSS).
 * Nació del defecto de S16: `a { color }` fuera de @layer base le ganaba a `text-white` y el botón
 * verde salía con texto rojo — la clase decía una cosa y el píxel otra.
 */
export async function contrasteDe(elemento: Locator): Promise<{ ratio: number; color: string; fondo: string }> {
  return elemento.evaluate((el) => {
    const luminancia = (css: string): number => {
      const partes = /(\d+),\s*(\d+),\s*(\d+)/.exec(css);
      if (!partes) return 0;
      const [r, g, b] = [partes[1], partes[2], partes[3]].map((n) => {
        const v = Number(n) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // El fondo puede ser transparente y venir del ancestro: hay que subir hasta encontrar uno opaco.
    const fondoEfectivo = (nodo: Element): string => {
      let actual: Element | null = nodo;
      while (actual) {
        const bg = getComputedStyle(actual).backgroundColor;
        if (bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg)) return bg;
        actual = actual.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    const estilo = getComputedStyle(el);
    const fondo = fondoEfectivo(el);
    const [claro, oscuro] = [luminancia(estilo.color), luminancia(fondo)].sort((a, b) => b - a) as [number, number];
    return { ratio: (claro + 0.05) / (oscuro + 0.05), color: estilo.color, fondo };
  });
}

/**
 * Engancha la guía impresa. `imprimirPorNavegador` escribe el ticket de 80 mm en un iframe oculto y
 * lo BORRA a los ~2 s: sin este espía, comprobar la guía sería una carrera contra ese temporizador.
 */
export async function espiarGuias(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __guias?: string[] };
    w.__guias = [];
    const observador = new MutationObserver((mutaciones) => {
      for (const m of mutaciones) {
        for (const nodo of Array.from(m.addedNodes)) {
          if (nodo instanceof HTMLIFrameElement && nodo.getAttribute("aria-hidden") === "true") {
            setTimeout(() => w.__guias?.push(nodo.contentDocument?.body?.innerText ?? ""), 0);
          }
        }
      }
    });
    const arrancar = () => observador.observe(document.body, { childList: true });
    if (document.body) arrancar();
    else document.addEventListener("DOMContentLoaded", arrancar);
  });
}

export async function guiasImpresas(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __guias?: string[] }).__guias ?? []);
}
