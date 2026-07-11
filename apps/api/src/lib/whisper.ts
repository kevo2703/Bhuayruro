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

// Sesgo de dominio (idea de Kevin): Whisper masacra los nombres de medicamentos ("fenazopiridina"
// salió "penasopiridina" en la prueba en vivo) y las palabras del mostrador. El parámetro
// `initial_prompt` (verificado en docs CF: "A text prompt to help provide context") inclina la
// transcripción hacia este vocabulario. OJO: el contexto es CORTO (~200 tokens) → jerga fija + una
// lista ACOTADA de nombres del catálogo del tenant; los precios NO van (son números, se resuelven en D1).
const JERGA_BOTICA =
  "Dinero: soles, céntimos, sencillo, vuelto, vueltos, cambio. " +
  "Términos: receta, blíster, caja, jarabe, tableta, pastilla, cápsula, ampolla, crema, gotas, genérico.";
const PROMPT_BASE = "Conversación en una botica del Perú. " + JERGA_BOTICA;
const MAX_PROMPT_CHARS = 800; // ~200 tokens; más se trunca y diluye el sesgo

// Arma el initial_prompt: jerga fija + tantos nombres de medicamentos como quepan en el presupuesto.
export function construirInitialPrompt(nombresMedicamentos: string[]): string {
  let meds = "";
  for (const n of nombresMedicamentos) {
    const limpio = n.trim();
    if (!limpio) continue;
    const tentativo = meds ? `${meds}, ${limpio}` : limpio;
    if (`${PROMPT_BASE} Medicamentos: ${tentativo}.`.length > MAX_PROMPT_CHARS) break;
    meds = tentativo;
  }
  return meds ? `${PROMPT_BASE} Medicamentos: ${meds}.` : PROMPT_BASE;
}

// El binding de Workers AI expone run(modelo, entrada). Los tipos generados no cubren la variante
// de audio de whisper-turbo, así que llamamos por una firma laxa (sin `any`).
type CorredorAi = (modelo: string, entrada: unknown) => Promise<{ text?: string }>;

// Resultado discriminado de una transcripción (B10.3): distinguir "sin voz" de "error" real. Un chunk
// que Whisper procesó pero que salió VACÍO (silencio/ruido que el vad_filter descartó) es 'sin_habla'
// (terminal benigno), NO 'error' (infra: sin binding, excepción) — así el panel de calidad no se ensucia.
export type ResultadoTranscripcion =
  | { estado: "texto"; texto: string }
  | { estado: "sin_habla" }
  | { estado: "error"; detalle: string };

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

// Transcribe un chunk de audio a texto (español). Resultado discriminado (B10.3): 'texto' con lo
// transcrito, 'sin_habla' si Whisper corrió pero salió vacío (silencio/ruido, no es error), o 'error'
// si el binding no está o algo falla. El caller mapea cada caso a un estado de la grabación.
export async function transcribirBytes(env: Bindings, bytes: Uint8Array, initialPrompt?: string): Promise<ResultadoTranscripcion> {
  if (!env.AI) return { estado: "error", detalle: "IA no disponible" };
  if (bytes.byteLength === 0) return { estado: "error", detalle: "audio vacío" };
  // OJO: llamar `env.AI.run(...)` como MÉTODO (no detachar en una const) — el binding usa `this`
  // internamente; `const run = env.AI.run; run(...)` lanza "Cannot set properties of undefined (#options)".
  const ai = env.AI as unknown as { run: CorredorAi };
  try {
    const entrada: Record<string, unknown> = {
      audio: base64DeBytes(bytes),
      task: "transcribe",
      language: "es",
      vad_filter: true, // filtra silencio residual — la botica tiene silencios largos
    };
    if (initialPrompt && initialPrompt.trim()) entrada.initial_prompt = initialPrompt.slice(0, 1024); // sesgo de dominio
    const out = await ai.run(MODELO_WHISPER, entrada);
    const texto = typeof out?.text === "string" ? out.text.trim() : "";
    return texto ? { estado: "texto", texto } : { estado: "sin_habla" }; // vacío = Whisper corrió, no oyó voz
  } catch {
    return { estado: "error", detalle: "fallo de transcripción" }; // infra; el Cron reintenta los 'subido'
  }
}
