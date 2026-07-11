// Extracción de señales desde la transcripción del audio del mostrador (B10.2 §8). Toma el texto que
// dejó Whisper y, con un LLM CHICO de Workers AI y un prompt CERRADO, saca dos cosas y nada más:
//   - faltantes  → el personal dice que NO hay algo ("no hay X", "se acabó", "ya no queda").
//   - ventas     → una venta que se está cerrando en el mostrador (productos entregados y cobrados).
//
// Igual que lib/whisper.ts y lib/vision.ts: es capa de I/O (IA), NUNCA autoritativa. El SKU y el
// precio SIEMPRE se resuelven después contra la D1 (§4.3); aquí solo obtenemos NOMBRES DETECTADOS que
// un humano confirma en el Mostrador. Guardado con try/catch → null ante cualquier fallo (el
// orquestador marca el audio 'procesado' sin romper nada). El extractor es INYECTABLE: en tests se
// pasa un fake determinista y la suite NUNCA llama a Workers AI real.
//
// VETO D-N5 (§2.3): estas señales son asistencia operativa; jamás supervisión de personal. Por eso el
// resultado no lleva —ni puede llevar— identidad de operador: solo nombres de producto y confianza.
//
// Modelo: `@cf/meta/llama-3.2-3b-instruct` (instruct chico, multilingüe). ELEGIDO tras validar contra
// Workers AI REAL (2026-07) con los tres casos en español: acertó faltante, venta, ruido vacío y el
// caso MIXTO (faltante + venta en una frase) SIN falsos positivos — mejor que 3.1-8b-fp8 (falso
// faltante + falló el mixto) y que llama-4-scout. OJO: `@cf/meta/llama-3.1-8b-instruct` (base) quedó
// DEPRECADO el 2026-05-30 (error 5028) → no usarlo.

import { normalizarNombre } from "@huayruro/shared";
import type { Bindings } from "../types";

const MODELO = "@cf/meta/llama-3.2-3b-instruct";
const MAX_TRANSCRIPCION = 4000; // acota el costo/tokens; un chunk de 30 s rara vez pasa de unas líneas

// Un producto mencionado (nombre TAL CUAL se oyó; el match contra el catálogo se hace en el repo).
export type ItemDetectado = { nombre: string; cantidad: number | null };
export type FaltanteDetectado = { nombre: string; cantidad: number | null; confianza: number };
export type VentaDetectada = { items: ItemDetectado[]; confianza: number };
export type SenalesExtraidas = { faltantes: FaltanteDetectado[]; ventas: VentaDetectada[] };

// Firma del extractor (inyectable): en producción = Workers AI; en tests = un fake determinista.
export type Extractor = (env: Bindings, transcripcion: string) => Promise<SenalesExtraidas | null>;

// Workers AI expone run(modelo, entrada). Con entrada de chat (`messages`) los Llama actuales
// devuelven el esquema OpenAI (`choices[].message.content`); algunos modelos/legacy devuelven
// `response`. Aceptamos AMBAS formas (verificado contra Workers AI real, 2026-07 — leer solo
// `response` daba null con los modelos vigentes → cero señales). Firma laxa, igual que whisper/vision.
type RespuestaAi = { response?: string; choices?: { message?: { content?: string } }[] };
type CorredorAi = (modelo: string, entrada: unknown) => Promise<RespuestaAi>;
// OJO (verificado contra Workers AI real 2026-07): los Llama actuales devuelven el texto en
// `choices[].message.content` Y ADEMÁS traen un campo `response` VACÍO (""). Hay que tomar el primer
// candidato que sea string NO vacío, prefiriendo choices; usar `response ?? choices` daría "" → null.
const textoDeRespuesta = (out: RespuestaAi | null): string | null => {
  for (const c of [out?.choices?.[0]?.message?.content, out?.response]) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return null;
};

const SISTEMA =
  "Eres el asistente de una botica en Perú. Recibes la TRANSCRIPCIÓN del audio ambiente del mostrador " +
  "(puede venir con ruido, cortada o incompleta). Tu tarea es extraer SOLO dos cosas y responder " +
  "ÚNICAMENTE un JSON, sin explicaciones, sin texto antes ni después:\n" +
  '{"faltantes":[{"nombre":"<producto tal como se mencionó>","cantidad":<entero o null>,"confianza":<0 a 1>}],' +
  '"ventas":[{"items":[{"nombre":"<producto>","cantidad":<entero o null>}],"confianza":<0 a 1>}]}\n' +
  "REGLAS:\n" +
  "- SOLO productos de BOTICA: medicamentos, insumos de salud y aseo personal. IGNORA por completo " +
  "comida, bebidas, temas personales y cualquier conversación ajena al mostrador (si oyes \"pescado\", " +
  "\"almuerzo\", nombres de personas, etc., NO son señales).\n" +
  "- faltantes: SOLO cuando alguien diga que NO hay o se ACABÓ un producto (\"no hay\", \"se acabó\", " +
  "\"ya no queda\", \"no tenemos\", \"falta\"). Un pedido normal NO es faltante.\n" +
  "- ventas: SOLO cuando claramente se está CERRANDO una venta (se entrega y se cobra un producto). " +
  "Ante la duda, NO la incluyas.\n" +
  "- NO inventes productos que no se mencionan. Si no hay nada, devuelve arreglos vacíos.\n" +
  "- confianza baja (< 0.4) si el audio es dudoso o el término no parece de botica. Responde SOLO el JSON.";

// Extrae el primer objeto JSON de la respuesta (el modelo a veces lo envuelve en prosa).
function extraerJson(texto: string): Record<string, unknown> | null {
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const aTexto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
const aCantidad = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
const aConfianza = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);

// Normaliza la salida cruda del modelo a `SenalesExtraidas` (descarta lo que no calce). Público para
// que el fake de los tests y el camino real compartan exactamente la misma forma de datos.
export function normalizarSalida(j: Record<string, unknown> | null): SenalesExtraidas {
  const faltantesRaw = Array.isArray(j?.faltantes) ? (j!.faltantes as unknown[]) : [];
  const ventasRaw = Array.isArray(j?.ventas) ? (j!.ventas as unknown[]) : [];
  const faltantes: FaltanteDetectado[] = [];
  for (const f of faltantesRaw) {
    const o = f as Record<string, unknown>;
    const nombre = aTexto(o?.nombre);
    if (nombre) faltantes.push({ nombre, cantidad: aCantidad(o?.cantidad), confianza: aConfianza(o?.confianza) });
  }
  const ventas: VentaDetectada[] = [];
  for (const v of ventasRaw) {
    const o = v as Record<string, unknown>;
    const itemsRaw = Array.isArray(o?.items) ? (o.items as unknown[]) : [];
    const items: ItemDetectado[] = [];
    for (const it of itemsRaw) {
      const io = it as Record<string, unknown>;
      const nombre = aTexto(io?.nombre);
      if (nombre) items.push({ nombre, cantidad: aCantidad(io?.cantidad) });
    }
    if (items.length > 0) ventas.push({ items, confianza: aConfianza(o?.confianza) });
  }
  return { faltantes, ventas };
}

// Frase-fuente de una señal (B10.4.2): la oración de la transcripción donde MÁS aparece el nombre
// detectado, para dar CONTEXTO en la bandeja ("no hay paracetamol para el bebé" en vez de solo
// "paracetamol"). DETERMINISTA (sin IA, sin costo, sin falsos positivos): parte por puntuación fuerte
// y salto de línea, y puntúa cada oración por cuántos tokens (≥3) del nombre contiene. Devuelve la
// oración original (recortada a `maxLargo`) de mayor puntaje, o null si nada calza → la UI cae a la
// transcripción completa del chunk. NO toca la D1 ni la IA: es texto puro.
export function fraseFuente(transcripcion: string, nombre: string, maxLargo = 240): string | null {
  const texto = (transcripcion ?? "").trim();
  if (!texto) return null;
  const objetivo = new Set(normalizarNombre(nombre).split(/\s+/).filter((t) => t.length >= 3));
  if (objetivo.size === 0) return null;
  const oraciones = texto.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const candidatas = oraciones.length ? oraciones : [texto];
  let mejor: string | null = null;
  let mejorPuntaje = 0;
  for (const o of candidatas) {
    const tokens = new Set(normalizarNombre(o).split(/\s+/).filter(Boolean));
    let p = 0;
    for (const t of objetivo) if (tokens.has(t)) p++;
    if (p > mejorPuntaje) {
      mejorPuntaje = p;
      mejor = o;
    }
  }
  if (mejorPuntaje === 0 || !mejor) return null;
  return mejor.length > maxLargo ? `${mejor.slice(0, maxLargo - 1).trimEnd()}…` : mejor;
}

// Extractor de producción: pasa la transcripción por el LLM chico. Devuelve las señales normalizadas
// o null si el binding no está, la transcripción es vacía, o algo falla (el orquestador sigue igual).
// `modelo` es parametrizable solo para poder probar/validar candidatos contra Workers AI real.
export async function extraerSenalesIA(env: Bindings, transcripcion: string, modelo: string = MODELO): Promise<SenalesExtraidas | null> {
  const texto = transcripcion.trim();
  if (!env.AI || !texto) return null;
  // OJO: llamar `env.AI.run(...)` como MÉTODO (no `const run = env.AI.run; run(...)`) — el binding
  // usa `this` internamente y detacharlo lanza "Cannot set properties of undefined (#options)".
  const ai = env.AI as unknown as { run: CorredorAi };
  try {
    const out = await ai.run(modelo, {
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: texto.slice(0, MAX_TRANSCRIPCION) },
      ],
      temperature: 0.1, // determinismo: es extracción, no creatividad
      max_tokens: 512,
    });
    const texto2 = textoDeRespuesta(out);
    return texto2 ? normalizarSalida(extraerJson(texto2)) : null;
  } catch {
    return null; // el orquestador marca el audio 'procesado' sin señales; no reintenta en bucle
  }
}
