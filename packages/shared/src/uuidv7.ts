// UUID v7 (RFC 9562): 48 bits de timestamp ms + versión 7 + variante + aleatorio.
// Ordenable lexicográficamente por tiempo (ADR-006). Compartido PWA (client_uuid) ↔ Worker (PKs).
// Usa crypto.getRandomValues + Date.now(), disponibles en Workers y navegador.

const hexByte: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export function uuidv7(ms: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  // 48 bits de timestamp (big-endian)
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  // 10 bytes aleatorios
  crypto.getRandomValues(bytes.subarray(6));
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // versión 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC 4122

  const h = hexByte;
  return (
    h[bytes[0]!]! + h[bytes[1]!]! + h[bytes[2]!]! + h[bytes[3]!]! + "-" +
    h[bytes[4]!]! + h[bytes[5]!]! + "-" +
    h[bytes[6]!]! + h[bytes[7]!]! + "-" +
    h[bytes[8]!]! + h[bytes[9]!]! + "-" +
    h[bytes[10]!]! + h[bytes[11]!]! + h[bytes[12]!]! + h[bytes[13]!]! + h[bytes[14]!]! + h[bytes[15]!]!
  );
}
