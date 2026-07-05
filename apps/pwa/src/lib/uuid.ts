// client_uuid para idempotencia de la cola offline (§9 / ADR-006).
// Migrado a UUID v7 (48 bits de timestamp + random, RFC 9562): ordenable en el tiempo y
// compartido con el Worker desde packages/shared (una sola implementación).
export { uuidv7 } from "@huayruro/shared";

// DEPRECADO: v4 (solo para código legado que aún no migra). Nuevo código usa uuidv7.
export function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
