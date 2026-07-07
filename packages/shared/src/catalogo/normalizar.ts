// Normalización canónica de nombres de producto. Módulo PURO y sin imports a propósito:
// lo consume el Worker/importador (vía @huayruro/shared) Y los scripts Node locales
// (scripts/gen-catalogo-maestro.mjs lo importa DIRECTO con type-stripping de Node ≥23).
// Es LA función de matching del sistema: catálogo del tenant, catálogo maestro (B7) y
// listas de proveedores (B8) deben normalizar EXACTAMENTE igual — no duplicarla.

/** Nombre normalizado (minúsculas, sin tildes, espacios colapsados) para dedup y matching. */
export const normalizarNombre = (s: string): string =>
  s
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
