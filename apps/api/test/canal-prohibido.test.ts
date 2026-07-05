import { describe, expect, it } from "vitest";

// GATE 3 — test #14 (plan §4.4): el canal prohibido. Todo el SQL y el acceso a env.DB
// viven SOLO en src/repos/. Cargamos el código fuente como texto (import.meta.glob ?raw,
// inlineado por Vite; no usa node:fs, que no existe en workerd) y lo verificamos.

// Vite provee glob en runtime; augmentamos el tipo (y hay que llamarlo DIRECTO, es una macro).
declare global {
  interface ImportMeta {
    glob(patron: string, opts: { query: string; import: string; eager: boolean }): Record<string, string>;
  }
}

const fuentes = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true });

// Quita comentarios para no marcar menciones en prosa (sin romper URLs http://).
function sinComentarios(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const esRepo = (ruta: string) => ruta.includes("/src/repos/");
const esSpikeE0 = (ruta: string) => ruta.endsWith("/src/spike.ts"); // diagnóstico E0 sobre un db inyectado (no env.DB)

describe("GATE 3 — #14 canal prohibido (SQL/env.DB solo en repos/)", () => {
  it("hay archivos fuente cargados", () => {
    expect(Object.keys(fuentes).length).toBeGreaterThan(5);
  });

  it("ningún archivo fuera de src/repos/ toca env.DB", () => {
    const infractores: string[] = [];
    for (const [ruta, contenido] of Object.entries(fuentes)) {
      if (esRepo(ruta)) continue;
      if (/\benv\.DB\b/.test(sinComentarios(contenido))) infractores.push(ruta);
    }
    expect(infractores, `env.DB fuera de repos/: ${infractores.join(", ")}`).toEqual([]);
  });

  it("ningún archivo fuera de src/repos/ ejecuta SQL crudo (prepare/batch/exec)", () => {
    const infractores: string[] = [];
    for (const [ruta, contenido] of Object.entries(fuentes)) {
      if (esRepo(ruta) || esSpikeE0(ruta)) continue;
      if (/\.(prepare|batch|exec)\s*\(/.test(sinComentarios(contenido))) infractores.push(ruta);
    }
    expect(infractores, `SQL crudo fuera de repos/: ${infractores.join(", ")}`).toEqual([]);
  });
});
