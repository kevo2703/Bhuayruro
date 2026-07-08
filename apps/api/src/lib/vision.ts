// OCR asistido para el bot de Telegram (B9 §7.3). Descarga la foto de Telegram y la pasa por
// Workers AI (visión). NUNCA es autoritativo: el chat SIEMPRE confirma lo entendido y, si la
// confianza es baja o algo falla, se cae a texto manual. Todo está guardado con try/catch y
// devuelve null ante cualquier fallo → el orquestador reacciona con el fallback de texto.
//
// Esta capa hace red (Telegram) + IA, no toca DB. Su camino feliz se valida en el smoke real
// con el bot de prueba (T-K12); los tests del gate corren con fixtures y NO llegan aquí
// (sin TELEGRAM_BOT_TOKEN, descargarFoto devuelve null y el flujo usa texto).

import type { Bindings } from "../types";

// Confianza mínima para creerle al OCR; por debajo, se pide el dato por texto (§7.3: ~30% cae a texto).
export const UMBRAL_OCR = 0.55;
const MODELO_VISION = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_FOTO_BYTES = 20 * 1024 * 1024; // Telegram: getFile hasta 20 MB

// Descarga la foto de mayor tamaño desde Telegram. Sin token o ante cualquier fallo → null.
export async function descargarFoto(env: Bindings, fileId: string): Promise<Uint8Array | null> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const meta = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!meta.ok) return null;
    const j = (await meta.json()) as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
    const filePath = j.result?.file_path;
    if (!filePath) return null;
    if ((j.result?.file_size ?? 0) > MAX_FOTO_BYTES) return null;
    const bin = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!bin.ok) return null;
    const buf = new Uint8Array(await bin.arrayBuffer());
    return buf.byteLength > 0 && buf.byteLength <= MAX_FOTO_BYTES ? buf : null;
  } catch {
    return null;
  }
}

// Extrae el primer objeto JSON de la respuesta del modelo (que a veces envuelve el JSON en prosa).
function extraerJson(texto: string): Record<string, unknown> | null {
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// El binding de visión acepta {image, prompt} (variante "prompt" del modelo); los tipos generados
// solo exponen la variante "messages", así que llamamos por una firma laxa (sin `any`).
type CorredorAi = (modelo: string, entrada: unknown) => Promise<{ response?: string }>;

async function correrVision(env: Bindings, bytes: Uint8Array, prompt: string): Promise<Record<string, unknown> | null> {
  if (!env.AI) return null;
  const run = env.AI.run as unknown as CorredorAi;
  const entrada = { image: [...bytes], prompt, max_tokens: 256 };
  try {
    const out = await run(MODELO_VISION, entrada);
    return out?.response ? extraerJson(out.response) : null;
  } catch {
    // La PRIMERA llamada al modelo de visión puede fallar porque falta aceptar la licencia Meta
    // (§2.2/§7.3). Auto-sanación: aceptamos la licencia (`prompt:"agree"`) y reintentamos UNA vez.
    // La aceptación queda registrada en la cuenta → las siguientes fotos no pasan por aquí.
    try {
      await run(MODELO_VISION, { prompt: "agree" });
      const out = await run(MODELO_VISION, entrada);
      return out?.response ? extraerJson(out.response) : null;
    } catch {
      return null; // sigue fallando (foto ilegible u otro) → el flujo cae a texto
    }
  }
}

const numero = (v: unknown, def = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : def);
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// Lee el nombre + laboratorio de la CAJA. Prompt cerrado que pide SOLO JSON.
export async function ocrProducto(
  env: Bindings,
  bytes: Uint8Array,
): Promise<{ nombre: string; laboratorio: string | null; concentracion: string | null; confianza: number } | null> {
  const prompt =
    "Eres el asistente de una botica en Perú. Mira la CAJA del medicamento. Responde SOLO un JSON, sin explicaciones: " +
    '{"nombre":"<nombre comercial>","laboratorio":"<laboratorio o null>","concentracion":"<ej: 400 mg, o null>","confianza":<0 a 1>}. ' +
    "Si no puedes leer con seguridad, pon confianza baja.";
  const j = await correrVision(env, bytes, prompt);
  const nombre = j && texto(j.nombre);
  if (!nombre) return null;
  return { nombre, laboratorio: j ? texto(j.laboratorio) : null, concentracion: j ? texto(j.concentracion) : null, confianza: numero(j?.confianza) };
}

// Lee lote + vencimiento del TROQUELADO (lo más frágil). vencimiento en AAAA-MM.
export async function ocrLote(
  env: Bindings,
  bytes: Uint8Array,
): Promise<{ lote: string | null; vencimiento: string | null; confianza: number } | null> {
  const prompt =
    "Mira el troquelado de un medicamento (lote y vencimiento). Responde SOLO un JSON, sin explicaciones: " +
    '{"lote":"<código de lote o null>","vencimiento":"<AAAA-MM o null>","confianza":<0 a 1>}. ' +
    "Si no puedes leer con seguridad, pon confianza baja.";
  const j = await correrVision(env, bytes, prompt);
  if (!j) return null;
  const venc = texto(j.vencimiento);
  // Normaliza AAAA-MM (o AAAA/MM) → AAAA-MM; descarta lo que no calce.
  const vm = venc?.match(/(20\d{2})[-/](\d{1,2})/);
  const vencimiento = vm && Number(vm[2]) >= 1 && Number(vm[2]) <= 12 ? `${vm[1]}-${String(Number(vm[2])).padStart(2, "0")}` : null;
  return { lote: texto(j.lote), vencimiento, confianza: numero(j.confianza) };
}

// Acepta la licencia Meta del modelo de visión (la PRIMERA llamada la exige, §2.2). Idempotente:
// se corre una vez al habilitar el bot; guardado para no romper si el binding no está.
export async function aceptarLicenciaMeta(env: Bindings): Promise<void> {
  if (!env.AI) return;
  try {
    const run = env.AI.run as unknown as CorredorAi;
    await run(MODELO_VISION, { prompt: "agree" });
  } catch {
    /* la licencia ya estaba aceptada o el binding no aplica */
  }
}
