// Token de sesión / dispositivo: opaco de 256 bits. En D1 se guarda SOLO el SHA-256
// del token (nunca el token en claro). Plan §4.2.

export function generarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  // base64url sin padding
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bytes = new Uint8Array(d);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
