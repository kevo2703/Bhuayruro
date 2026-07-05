import { centASolesStr, rndDiv } from "@huayruro/shared";

// Formateo de dinero para la UI (§6): montos en enteros → texto es-PE. NO usar floats aquí.
export const solesCent = (cent: number): string => `S/ ${centASolesStr(cent)}`;

// Precio unitario guardado en diezmilésimas (_dm) → mostrado en soles a 2 decimales (céntimos).
export const solesDm = (dm: number): string => `S/ ${centASolesStr(rndDiv(Math.max(0, dm), 100))}`;
