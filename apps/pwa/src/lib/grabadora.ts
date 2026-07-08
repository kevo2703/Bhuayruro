// Lógica PURA de la grabadora del A10 (B10.1 §8 / plan D1 §13). Sin APIs de navegador aquí: esto se
// testea. El cableado con MediaRecorder / AudioContext / wake lock vive en pages/Grabadora.tsx y se
// valida físicamente en el A10 (T-K2).

// Chunk de 30 s (plan frentes nuevos §8: reacción casi-tiempo-real) a opus ~32 kbps mono (plan §13).
export const CHUNK_MS = 30_000;
export const AUDIO_BITS_POR_SEG = 32_000;
export const TOPE_COLA_AUDIO_BYTES = 200 * 1024 * 1024; // 200 MB FIFO (plan §13)

// Candidatos de contenedor/códec, del preferido al genérico. El componente elige el primero soportado.
export const MIMES_GRABACION = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

// Umbral de silencio por RMS (muestras en [-1,1]). ~-40 dBFS: la botica tiene silencios largos y no
// tiene sentido gastar Whisper en ellos (plan §13: descarte de silencio). Se afina en el A10 (T-K2).
export const UMBRAL_SILENCIO_RMS = 0.01;

// RMS de un buffer de muestras en el dominio del tiempo (AnalyserNode.getFloatTimeDomainData).
export function rmsDeFloat32(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let suma = 0;
  for (let i = 0; i < samples.length; i++) suma += samples[i]! * samples[i]!;
  return Math.sqrt(suma / samples.length);
}

// ¿el pico RMS de la ventana de 30 s quedó por debajo del umbral? → chunk silencioso, no se sube.
export function esSilencio(picoRms: number, umbral = UMBRAL_SILENCIO_RMS): boolean {
  return picoRms < umbral;
}

// Plan de evicción FIFO: dada la cola ordenada de más viejo a más nuevo, devuelve los client_uuid a
// borrar para que, tras sumar `nuevoBytes`, el total no supere `topeBytes`. Se descarta lo más viejo.
export function planEviccion(
  existentes: { client_uuid: string; bytes: number }[],
  nuevoBytes: number,
  topeBytes = TOPE_COLA_AUDIO_BYTES,
): string[] {
  let total = existentes.reduce((s, e) => s + e.bytes, 0) + nuevoBytes;
  const aBorrar: string[] = [];
  for (let i = 0; i < existentes.length && total > topeBytes; i++) {
    aBorrar.push(existentes[i]!.client_uuid);
    total -= existentes[i]!.bytes;
  }
  return aBorrar;
}

// Elige el primer MIME soportado por este navegador (el A10 corre Chrome Android). "" = default del UA.
export function elegirMime(soportado: (mime: string) => boolean): string {
  return MIMES_GRABACION.find((m) => soportado(m)) ?? "";
}
