// Spike E0 (plan §2.2): verifica las 4 semánticas de D1 de las que depende el diseño.
// La MISMA función corre en el test local (vitest-pool-workers) y en la ruta remota
// (/api/spike) contra la D1 real, para comparar local vs remoto en el ADR-011.
// Solo toca tablas `spike_*` (creadas y borradas aquí); no interfiere con el esquema real.
//
// LECCIÓN E0 (documentada en ADR-011): la D1 REMOTA, sobre todo recién provisionada,
// devuelve intermitentemente "D1_ERROR: Network connection lost" en ráfagas de writes
// por binding. Se mitiga con reintento sobre ese error transitorio (withRetry) y
// agrupando DDL en un solo exec() para reducir round-trips. En local (Miniflare) no ocurre.

export type ResultadoSpike = {
  visibilidad_intra_batch: boolean; // (a) statement 2 ve el INSERT del statement 1
  rollback_por_check: boolean; // (b) un CHECK violado revierte los statements previos del batch
  on_conflict_do_nothing: boolean; // (c) ON CONFLICT DO NOTHING dentro del batch
  fts5_remove_diacritics: boolean; // (d) FTS5 busca sin tildes (ibuprofeno == ibúprofeno)
  detalle: Record<string, string>;
};

const esRedPerdida = (e: unknown): boolean => /Network connection lost/i.test(String(e));

// Reintenta una operación de D1 sobre el error transitorio "Network connection lost".
async function withRetry<T>(fn: () => Promise<T>, intentos = 5): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimo = e;
      if (!esRedPerdida(e)) throw e;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
  throw ultimo;
}

async function limpiar(db: D1Database): Promise<void> {
  await withRetry(() =>
    db.exec(
      [
        "DROP TABLE IF EXISTS spike_hijo",
        "DROP TABLE IF EXISTS spike_padre",
        "DROP TABLE IF EXISTS spike_check",
        "DROP TABLE IF EXISTS spike_conflict",
        "DROP TABLE IF EXISTS spike_fts",
      ].join(";\n"),
    ),
  );
}

export async function runSpike(db: D1Database): Promise<ResultadoSpike> {
  const detalle: Record<string, string> = {};
  await limpiar(db);

  // Esquema de prueba (un solo exec = un round-trip)
  await withRetry(() =>
    db.exec(
      [
        "CREATE TABLE spike_padre (id TEXT PRIMARY KEY, marca TEXT)",
        "CREATE TABLE spike_hijo (id TEXT PRIMARY KEY, padre_id TEXT)",
        "CREATE TABLE spike_check (id TEXT PRIMARY KEY, saldo INTEGER CHECK (saldo >= 0))",
        "CREATE TABLE spike_conflict (clave TEXT UNIQUE, val TEXT)",
      ].join(";\n"),
    ),
  );

  // (a) Visibilidad intra-batch: el INSERT...SELECT WHERE EXISTS del stmt 2 solo inserta
  //     si ve la fila que el stmt 1 insertó en el MISMO batch.
  let visibilidad_intra_batch = false;
  try {
    await withRetry(() =>
      db.batch([
        db.prepare(`INSERT INTO spike_padre (id, marca) VALUES ('p1','A')`),
        db.prepare(
          `INSERT INTO spike_hijo (id, padre_id) SELECT 'h1','p1' WHERE EXISTS (SELECT 1 FROM spike_padre WHERE id='p1')`,
        ),
      ]),
    );
    const hijo = await withRetry(() =>
      db.prepare(`SELECT COUNT(*) AS n FROM spike_hijo WHERE padre_id='p1'`).first<{ n: number }>(),
    );
    visibilidad_intra_batch = (hijo?.n ?? 0) === 1;
    detalle["a_hijos_insertados"] = String(hijo?.n ?? 0);
  } catch (e) {
    detalle["a_error"] = String(e);
  }

  // (b) Rollback por CHECK: el UPDATE previo del batch debe revertirse cuando el
  //     INSERT con saldo negativo viola el CHECK y aborta el batch entero.
  let rollback_por_check = false;
  try {
    await withRetry(() => db.prepare(`INSERT INTO spike_check (id, saldo) VALUES ('c1', 5)`).run());
    let abortó = false;
    try {
      await db.batch([
        db.prepare(`UPDATE spike_check SET saldo = saldo + 100 WHERE id='c1'`),
        db.prepare(`INSERT INTO spike_check (id, saldo) VALUES ('c2', -1)`), // viola CHECK
      ]);
    } catch (e) {
      if (esRedPerdida(e)) throw e; // no confundir red perdida con el abort esperado
      abortó = true;
    }
    const c1 = await withRetry(() => db.prepare(`SELECT saldo FROM spike_check WHERE id='c1'`).first<{ saldo: number }>());
    const c2 = await withRetry(() =>
      db.prepare(`SELECT COUNT(*) AS n FROM spike_check WHERE id='c2'`).first<{ n: number }>(),
    );
    rollback_por_check = abortó && c1?.saldo === 5 && (c2?.n ?? 0) === 0;
    detalle["b_abortó"] = String(abortó);
    detalle["b_saldo_c1"] = String(c1?.saldo);
    detalle["b_filas_c2"] = String(c2?.n ?? 0);
  } catch (e) {
    detalle["b_error"] = String(e);
  }

  // (c) ON CONFLICT DO NOTHING dentro del batch: no pisa la fila existente, y sigue.
  let on_conflict_do_nothing = false;
  try {
    await withRetry(() => db.prepare(`INSERT INTO spike_conflict (clave, val) VALUES ('k1','first')`).run());
    await withRetry(() =>
      db.batch([
        db.prepare(`INSERT INTO spike_conflict (clave, val) VALUES ('k1','second') ON CONFLICT (clave) DO NOTHING`),
        db.prepare(`INSERT INTO spike_conflict (clave, val) VALUES ('k2','new') ON CONFLICT (clave) DO NOTHING`),
      ]),
    );
    const k1 = await withRetry(() => db.prepare(`SELECT val FROM spike_conflict WHERE clave='k1'`).first<{ val: string }>());
    const total = await withRetry(() => db.prepare(`SELECT COUNT(*) AS n FROM spike_conflict`).first<{ n: number }>());
    on_conflict_do_nothing = k1?.val === "first" && (total?.n ?? 0) === 2;
    detalle["c_val_k1"] = String(k1?.val);
    detalle["c_total"] = String(total?.n ?? 0);
  } catch (e) {
    detalle["c_error"] = String(e);
  }

  // (d) FTS5 standalone con remove_diacritics: buscar sin tilde matchea contenido con tilde.
  let fts5_remove_diacritics = false;
  try {
    await withRetry(() =>
      db.exec(
        [
          `CREATE VIRTUAL TABLE spike_fts USING fts5(texto, tokenize="unicode61 remove_diacritics 2")`,
          `INSERT INTO spike_fts (texto) VALUES ('ibúprofeno 400 mg')`,
          `INSERT INTO spike_fts (texto) VALUES ('paracetamol 500 mg')`,
        ].join(";\n"),
      ),
    );
    const sinTilde = await withRetry(() =>
      db.prepare(`SELECT COUNT(*) AS n FROM spike_fts WHERE spike_fts MATCH 'ibuprofeno'`).first<{ n: number }>(),
    );
    const conTilde = await withRetry(() =>
      db.prepare(`SELECT COUNT(*) AS n FROM spike_fts WHERE spike_fts MATCH 'paracétamol'`).first<{ n: number }>(),
    );
    fts5_remove_diacritics = (sinTilde?.n ?? 0) === 1 && (conTilde?.n ?? 0) === 1;
    detalle["d_match_ibuprofeno"] = String(sinTilde?.n ?? 0);
    detalle["d_match_paracetamol"] = String(conTilde?.n ?? 0);
  } catch (e) {
    detalle["d_error"] = String(e);
  }

  await limpiar(db);
  return {
    visibilidad_intra_batch,
    rollback_por_check,
    on_conflict_do_nothing,
    fts5_remove_diacritics,
    detalle,
  };
}
