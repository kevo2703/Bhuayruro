import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// ============================================================
// VETO D-N5 (plan frentes nuevos §2.3/§8.3) — el audio es SOLO asistencia operativa, JAMÁS
// supervisión de personal (RD 02-2020-JUS). Este test (mismo espíritu que el #14 canal-prohibido)
// lo hornea en TRES capas:
//   1. Esquema: audio_senal NO tiene columna de operador/usuario a propósito.
//   2. Ninguna query que toque audio_senal la cruza con personal (operador/usuario_perfil).
//   3. Solo repos/audio.ts lee/escribe audio_senal → el futuro repo de casos/EBR (S9) NO puede leerla.
// Si alguien intenta unir audio con personal, o darle operador_id a la señal, este test se pone rojo.
// ============================================================

// Carga el código fuente como texto (import.meta.glob ?raw, inlineado por Vite — no usa node:fs).
declare global {
  interface ImportMeta {
    glob(patron: string, opts: { query: string; import: string; eager: boolean }): Record<string, string>;
  }
}
const fuentes = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true });

// Extrae los literales de SQL (cadenas entre backticks) de un archivo. Nuestro SQL no anida backticks.
function literalesSql(contenido: string): string[] {
  return (contenido.match(/`[^`]*`/g) ?? []).filter((s) => /audio_senal/i.test(s));
}

// Términos que delatarían un cruce audio↔personal (supervisión).
const CRUCE_PERSONAL = /operador|usuario_perfil|usuario_id|personal/i;

describe("VETO D-N5 — el audio nunca cruza con personal (no supervisión)", () => {
  it("audio_senal NO tiene columna operador_id ni usuario_id (esquema)", async () => {
    const { results } = await env.DB.prepare(`PRAGMA table_info(audio_senal)`).all<{ name: string }>();
    const columnas = (results ?? []).map((r) => r.name.toLowerCase());
    expect(columnas.length, "audio_senal debe existir (migración 0004)").toBeGreaterThan(0);
    expect(columnas).not.toContain("operador_id");
    expect(columnas).not.toContain("usuario_id");
    expect(columnas).not.toContain("operador");
  });

  it("ninguna query que toque audio_senal la cruza con personal (operador/usuario)", () => {
    const infractores: string[] = [];
    for (const [ruta, contenido] of Object.entries(fuentes)) {
      for (const sql of literalesSql(contenido)) {
        if (CRUCE_PERSONAL.test(sql)) infractores.push(`${ruta}: ${sql.slice(0, 80)}…`);
      }
    }
    expect(infractores, `SQL que cruza audio_senal con personal:\n${infractores.join("\n")}`).toEqual([]);
  });

  it("solo repos/audio.ts lee/escribe audio_senal (el repo de casos/EBR no puede leerla)", () => {
    const infractores: string[] = [];
    for (const [ruta, contenido] of Object.entries(fuentes)) {
      if (ruta.endsWith("/repos/audio.ts")) continue;
      if (literalesSql(contenido).length > 0) infractores.push(ruta);
    }
    expect(infractores, `SQL de audio_senal fuera de repos/audio.ts: ${infractores.join(", ")}`).toEqual([]);
  });
});
