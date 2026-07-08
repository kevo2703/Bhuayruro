// Transcripción de audio para el frente D (B10.1 §8). Toma los bytes de un chunk (opus/webm del
// A10) y los pasa por Workers AI Whisper. Igual que lib/vision.ts: es capa de I/O (R2 + IA), NUNCA
// autoritativa, y guardada con try/catch → devuelve null ante cualquier fallo para que el
// orquestador marque el audio en 'error' sin romper nada. La extracción de señales (faltante /
// venta_posible) vive en S8 (B10.2); aquí solo obtenemos el texto.
//
// Modelo verificado contra los docs de Cloudflare (2026-07): `@cf/openai/whisper-large-v3-turbo`
// recibe `audio` como STRING base64 + `task`/`language`/`vad_filter`, y devuelve `{ text, ... }`.
// Costo $0.0005/min (plan D1 §13). El binding AI se inyecta por wrangler; ausente (tests) → null.

import type { Bindings } from "../types";

const MODELO_WHISPER = "@cf/openai/whisper-large-v3-turbo";

// El binding de Workers AI expone run(modelo, entrada). Los tipos generados no cubren la variante
// de audio de whisper-turbo, así que llamamos por una firma laxa (sin `any`).
type CorredorAi = (modelo: string, entrada: unknown) => Promise<{ text?: string }>;

// Codifica bytes a base64 (lo que espera whisper-large-v3-turbo). btoa opera sobre "binary string";
// se arma por trozos para no reventar el stack con audios de decenas de KB.
export function base64DeBytes(bytes: Uint8Array): string {
  let binario = "";
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
}

// Transcribe un chunk de audio a texto (español). Devuelve el texto (no vacío) o null si el binding
// no está, la respuesta viene vacía, o algo falla. El caller decide: texto → 'transcrito'; null → 'error'.
export async function transcribirBytes(env: Bindings, bytes: Uint8Array): Promise<string | null> {
  if (!env.AI || bytes.byteLength === 0) return null;
  const run = env.AI.run as unknown as CorredorAi;
  try {
    const out = await run(MODELO_WHISPER, {
      audio: base64DeBytes(bytes),
      task: "transcribe",
      language: "es",
      vad_filter: true, // filtra silencio residual — la botica tiene silencios largos
    });
    const texto = typeof out?.text === "string" ? out.text.trim() : "";
    return texto ? texto : null;
  } catch {
    return null; // el orquestador marcará el audio en 'error'; el Cron reintenta los 'subido'
  }
}
