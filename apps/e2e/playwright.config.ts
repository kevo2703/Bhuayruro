import { defineConfig, devices } from "@playwright/test";

// Smoke e2e del POS (E12, plan D1 §15.1 y §18) sobre el seed sintético, contra `wrangler dev`.
//
// Decisiones que importan:
//  · workers: 1 y sin paralelismo — es un POS sobre UNA base: el cierre de caja tiene que ver las
//    ventas que hicieron los archivos anteriores, y dos navegadores vendiendo a la vez pelearían por
//    el stock del mismo lote. El orden de los archivos (01…05) ES el guion.
//  · reuseExistingServer apagado por defecto: cada corrida arranca de una base recién copiada de la
//    plantilla. Con E2E_REUSAR=1 se reusa un server ya vivo (para iterar rápido sobre un solo test).
//  · retries 0, y no es pereza: estos tests ESCRIBEN en la base y el día se puede cerrar una sola
//    vez. Reintentar corre el test de nuevo contra una base que el intento anterior ya movió, así que
//    un reintento "verde" tapa el defecto y un reintento "rojo" inventa uno. Lo que hace confiable a
//    la suite es la base nueva por corrida, no el reintento; la espera por la cola offline se
//    resuelve donde corresponde (`esperarConRecarga`).

const PUERTO = process.env.E2E_PUERTO ?? "8788";
export const BASE_URL = `http://127.0.0.1:${PUERTO}`;
const REUSAR = process.env.E2E_REUSAR === "1";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // El camino completo (5 archivos, ~10 flujos) sobre wrangler dev local; los cobros pasan por la
  // cola offline de Dexie, que no es instantánea.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // El POS es de Perú: la hora de Lima decide el día de la venta y el saludo del mensaje de S16.
    locale: "es-PE",
    timezoneId: "America/Lima",
  },
  projects: [
    { name: "panel", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "node harness/servidor.mjs",
    url: `${BASE_URL}/api/salud`,
    reuseExistingServer: REUSAR,
    // Construye la SPA + arma la plantilla D1 + copia la base + arranca workerd. La primera vez
    // (plantilla fría) es lo más lento de todo el ciclo.
    timeout: 420_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
