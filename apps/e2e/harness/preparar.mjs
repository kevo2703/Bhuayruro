// Prepara todo lo que el smoke necesita ANTES de levantar el Worker, y lo deja idempotente para que
// la suite se pueda correr las veces que haga falta sin arrastrar basura de la corrida anterior.
//
// Tres piezas:
//   1. La SPA construida y puesta en `apps/api/public/` (el Worker sirve los assets desde ahí).
//   2. Una PLANTILLA de base D1 local (migraciones + seeds), que se arma UNA vez y se cachea.
//   3. Una COPIA fresca de esa plantilla por corrida — la base de la corrida es desechable.
//
// Por qué desechable y no reusada: (a) el cierre de caja da 409 si ya se cerró el día, así que una
// base sucia hace fallar el smoke por una razón que no es un defecto; (b) matar `workerd` deja el
// directorio de persistencia INSERVIBLE (gotcha de S16: el siguiente `wrangler dev` muere con
// std::terminate) y Playwright mata el webServer al terminar. Con la base desechable ninguna de las
// dos cosas importa: se tira y se copia de nuevo.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const E2E = resolve(AQUI, "..");
export const REPO = resolve(E2E, "../..");
const CACHE = join(E2E, ".cache");
const PLANTILLA = join(CACHE, "plantilla");
const MARCADOR = join(CACHE, "plantilla.json");
export const BASE_CORRIDA = join(CACHE, "base");

const API = join(REPO, "apps", "api");
const PWA = join(REPO, "apps", "pwa");
const PUBLIC = join(API, "public");
const CONFIG = "apps/api/wrangler.jsonc";

// El maestro SUSALUD (0002) son 15,181 filas y ningún flujo del smoke lo toca: cargarlo en cada
// rearmado de la plantilla costaría minutos por nada. Los otros tres sí: catálogo sintético +
// reglas de venta cruzada demo (S15) + crónicos demo (S16).
const SEEDS = ["0001_seed_p0.sql", "0003_reglas_sugerencia_demo.sql", "0004_cronicos_demo.sql"];

const log = (m) => console.log(`[e2e] ${m}`);

function correr(cmd, args, opciones = {}) {
  return execFileSync(cmd, args, { cwd: REPO, stdio: "pipe", encoding: "utf8", shell: true, ...opciones });
}

/** mtime más reciente de un árbol de archivos (0 si no existe). */
function masReciente(ruta) {
  if (!existsSync(ruta)) return 0;
  const st = statSync(ruta);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const entrada of readdirSync(ruta, { withFileTypes: true })) {
    if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
    max = Math.max(max, masReciente(join(ruta, entrada.name)));
  }
  return max;
}

/** Construye la SPA y la deja en apps/api/public — solo si el build quedó viejo respecto al código. */
function construirSpa() {
  if (process.env.E2E_SIN_BUILD === "1") {
    log("build de la SPA salteado por E2E_SIN_BUILD=1");
    return;
  }
  const indexPublic = join(PUBLIC, "index.html");
  const fuenteMs = Math.max(masReciente(join(PWA, "src")), masReciente(join(PWA, "index.html")), masReciente(join(REPO, "packages", "shared", "src")));
  if (existsSync(indexPublic) && statSync(indexPublic).mtimeMs > fuenteMs) {
    log("la SPA servida ya está al día");
    return;
  }
  log("construyendo la SPA…");
  correr("pnpm", ["--filter", "@huayruro/pwa", "build"], { stdio: "inherit" });

  // Gotcha de S15/S16: el `public` NO se puede mezclar con los assets del build anterior (quedan
  // bundles viejos y el Worker sirve el que le pinta), y borrarlo con el server vivo falla con
  // "Device or resource busy". Acá el server todavía no existe, así que es el momento de limpiarlo.
  rmSync(PUBLIC, { recursive: true, force: true });
  mkdirSync(PUBLIC, { recursive: true });
  cpSync(join(PWA, "dist"), PUBLIC, { recursive: true });
  log("SPA puesta en apps/api/public");
}

/** Huella de lo que define la plantilla: si cambia una migración o un seed, hay que rearmarla. */
function huella() {
  return JSON.stringify({
    migraciones: masReciente(join(API, "migrations")),
    seeds: SEEDS.map((s) => masReciente(join(API, "seeds", s))),
  });
}

function armarPlantilla() {
  const esperada = huella();
  if (existsSync(MARCADOR) && existsSync(PLANTILLA)) {
    try {
      if (readFileSync(MARCADOR, "utf8") === esperada) {
        log("plantilla de base D1 al día (se reusa)");
        return;
      }
    } catch {
      /* marcador ilegible → se rearma */
    }
    log("cambiaron migraciones o seeds → rearmando la plantilla");
  } else {
    log("armando la plantilla de base D1 (primera vez)");
  }

  rmSync(PLANTILLA, { recursive: true, force: true });
  rmSync(MARCADOR, { force: true });
  mkdirSync(CACHE, { recursive: true });

  correr("npx", ["wrangler", "d1", "migrations", "apply", "huayruro-db", "--local", "--persist-to", `"${PLANTILLA}"`, "--config", CONFIG], {
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  });
  for (const seed of SEEDS) {
    log(`seed ${seed}`);
    correr("npx", ["wrangler", "d1", "execute", "huayruro-db", "--local", "--persist-to", `"${PLANTILLA}"`, "--config", CONFIG, "--file", `./apps/api/seeds/${seed}`], {
      stdio: "pipe",
      env: { ...process.env, CI: "1" },
    });
  }
  writeFileSync(MARCADOR, esperada);
  log("plantilla lista");
}

/** Copia fresca de la plantilla: la base con la que corre ESTA suite. */
function copiarBaseDeCorrida() {
  rmSync(BASE_CORRIDA, { recursive: true, force: true });
  cpSync(PLANTILLA, BASE_CORRIDA, { recursive: true });
  log("base de la corrida en cero");
}

export function preparar() {
  construirSpa();
  armarPlantilla();
  copiarBaseDeCorrida();
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  preparar();
}
