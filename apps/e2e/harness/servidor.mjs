// El webServer de Playwright: prepara la base y la SPA, y recién entonces levanta `wrangler dev`.
//
// La preparación va ACÁ y no en un globalSetup a propósito: Playwright arranca el webServer y el
// globalSetup en un orden que no conviene depender de. Metiendo la preparación dentro del comando
// del server, el orden es el del programa y no el del runner.
//
// Puerto 8788 (no 8787) para no chocar con un `wrangler dev` que Kevin tenga abierto a mano.

import { spawn } from "node:child_process";
import { BASE_CORRIDA, REPO, preparar } from "./preparar.mjs";

const PUERTO = process.env.E2E_PUERTO ?? "8788";

if (process.env.E2E_SIN_PREPARAR === "1") {
  console.log("[e2e] preparación salteada por E2E_SIN_PREPARAR=1");
} else {
  preparar();
}

console.log(`[e2e] levantando wrangler dev en 127.0.0.1:${PUERTO}`);
const hijo = spawn(
  "npx",
  ["wrangler", "dev", "--config", "apps/api/wrangler.jsonc", "--persist-to", `"${BASE_CORRIDA}"`, "--port", PUERTO, "--ip", "127.0.0.1"],
  { cwd: REPO, stdio: "inherit", shell: true, env: { ...process.env, CI: "1" } },
);

// Playwright mata este proceso al terminar la suite; sin esto, `workerd` quedaría huérfano ocupando
// el puerto y la corrida siguiente se pegaría contra un server viejo sirviendo el bundle anterior.
const matar = () => {
  if (!hijo.killed) hijo.kill();
};
for (const senal of ["SIGINT", "SIGTERM", "SIGHUP", "exit"]) process.on(senal, matar);

hijo.on("exit", (codigo) => process.exit(codigo ?? 0));
