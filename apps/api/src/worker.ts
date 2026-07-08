// Entrada del Worker en producción: el fetch de Hono + el Cron Trigger (B10.1 §8).
//
// `src/index.ts` sigue exportando el app de Hono por DEFECTO para que los tests lo importen directo
// (`import app from "../src/index"; app.request(...)`). Esta capa es la que Cloudflare invoca según
// `wrangler.jsonc` (`main: src/worker.ts`). No toca env.DB (canal prohibido §4.4 #14): el Cron delega
// en `barrerAudiosPendientes`, que vive en repos/.
//
// scheduled (Cron `*/5 * * * *`) = BARREDORA: re-transcribe los audios que quedaron 'subido' porque
// el `ctx.waitUntil` de la ingesta no llegó a procesarlos (Worker desalojado, etc.).

import app from "./index";
import { barrerAudiosPendientes } from "./repos/audio";
import type { Bindings } from "./types";

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(barrerAudiosPendientes(env));
  },
} satisfies ExportedHandler<Bindings>;
