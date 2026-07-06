// Hash de contraseña propio (Supabase Auth desapareció). Plan §4.2:
// PBKDF2-SHA256, salt 16 B, WebCrypto (nativo en Workers).
// Formato almacenado: "pbkdf2$<iter>$<saltB64>$<hashB64>". Comparación en tiempo constante.
//
// TOPE DE PLATAFORMA (NO SUBIR): Cloudflare Workers en producción rechaza PBKDF2 con
// más de 100 000 iteraciones ("iteration counts above 100000 are not supported").
// `wrangler dev` local NO aplica ese tope, por eso 310k "funcionaba" en local y daba
// 500 en prod. 100 000 es el máximo permitido en la plataforma; no lo aumentes.
const ITERACIONES = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function aBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function deBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(plain: string, salt: Uint8Array, iteraciones: number, largo: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iteraciones },
    key,
    largo * 8,
  );
  return new Uint8Array(bits);
}

function igualdadConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i]! ^ b[i]!;
  return dif === 0;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(plain, salt, ITERACIONES, KEY_BYTES);
  return `pbkdf2$${ITERACIONES}$${aBase64(salt)}$${aBase64(hash)}`;
}

export async function verifyPassword(plain: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.split("$");
  if (partes.length !== 4 || partes[0] !== "pbkdf2") return false;
  const iteraciones = Number(partes[1]);
  if (!Number.isInteger(iteraciones) || iteraciones < 1) return false;
  const salt = deBase64(partes[2]!);
  const esperado = deBase64(partes[3]!);
  const actual = await pbkdf2(plain, salt, iteraciones, esperado.length);
  return igualdadConstante(actual, esperado);
}
