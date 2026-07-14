import { withRetry } from "./base";

// Catálogo maestro nacional (B7): la ÚNICA tabla GLOBAL del sistema (D-N7) — data pública
// SUSALUD, igual para todos los tenants y READ-ONLY en runtime (solo el seed la escribe).
// Por eso este repo NO recibe actor: no hay nada que aislar. La ruta sí exige sesión.

export type MaestroFila = {
  id: string;
  gtin: string | null;
  nombre: string;
  dci: string | null;
  concentracion: string | null;
  forma: string | null;
  forma_simple: string | null;
  laboratorio: string | null;
  pais: string | null;
  presentacion: string | null;
  unidades_envase: number | null;
  registro_san: string | null;
};

const COLS = `m.id, m.gtin, m.nombre, m.dci, m.concentracion, m.forma, m.forma_simple,
              m.laboratorio, m.pais, m.presentacion, m.unidades_envase, m.registro_san`;

export function maestroRepo(db: D1Database) {
  return {
    // Búsqueda FTS sin tildes (mismo tokenizador que producto_fts); prefijo para autocompletar.
    async buscar(q: string): Promise<MaestroFila[]> {
      const termino = q.trim().replace(/["']/g, " ").trim();
      if (!termino) return [];
      const r = await withRetry(() =>
        db
          .prepare(
            `SELECT ${COLS} FROM maestro_fts f JOIN catalogo_maestro m ON m.rowid = f.rowid
             WHERE maestro_fts MATCH ?1 ORDER BY rank LIMIT 20`,
          )
          .bind(termino + "*")
          .all<MaestroFila>(),
      );
      return r.results;
    },

    async porGtin(gtin: string): Promise<MaestroFila | null> {
      return withRetry(() =>
        db.prepare(`SELECT ${COLS} FROM catalogo_maestro m WHERE m.gtin = ?1`).bind(gtin).first<MaestroFila>(),
      );
    },

    // Total del catálogo maestro nacional (GLOBAL, D-N7 — sin tenant): para la pantalla de Ajustes.
    async contar(): Promise<{ total: number }> {
      const r = await withRetry(() => db.prepare(`SELECT COUNT(*) AS n FROM catalogo_maestro`).first<{ n: number }>());
      return { total: r?.n ?? 0 };
    },
  };
}
