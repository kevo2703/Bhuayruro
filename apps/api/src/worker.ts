// Entrada del Worker en producción: el fetch de Hono + el Cron Trigger (B10.1 §8).
//
// `src/index.ts` sigue exportando el app de Hono por DEFECTO para que los tests lo importen directo
// (`import app from "../src/index"; app.request(...)`). Esta capa es la que Cloudflare invoca según
// `wrangler.jsonc` (`main: src/worker.ts`). No toca env.DB (canal prohibido §4.4 #14): el Cron delega
// en `barrerAudiosPendientes`, que vive en repos/.
//
// Dos Cron (cada uno se invoca con su propio `controller.cron`):
//   · `*/5 * * * *`  BARREDORA de audio: re-transcribe los audios 'subido' que el `ctx.waitUntil` de la
//                     ingesta no alcanzó (Worker desalojado, etc.).
//   · `0 8 * * *`    EBR nocturno (03:00 Lima = 08:00 UTC): abre casos de excepción sobre los datos POS
//                     del día cerrado + autocierra los casos viejos (B11.1). No depende de cámaras.

import app from "./index";
import { barrerAudiosPendientes } from "./repos/audio";
import { barrerCasos } from "./repos/casos";
import type { Bindings } from "./types";

export default {
  fetch: app.fetch,
  // Sin `async`: el trabajo se entrega a `ctx.waitUntil` y NO se espera acá. Esperarlo dentro del
  // handler haría que el Cron se quede colgado del barrido en vez de devolver el control.
  scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): void {
    if (controller.cron === "0 8 * * *") {
      ctx.waitUntil(barrerCasos(env));
      return;
    }
    ctx.waitUntil(barrerAudiosPendientes(env));
  },
} satisfies ExportedHandler<Bindings>;
