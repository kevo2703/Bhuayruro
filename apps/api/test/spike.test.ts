import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runSpike } from "../src/spike";

describe("Spike E0 — semántica de D1 (plan §2.2)", () => {
  it("verifica visibilidad intra-batch, rollback por CHECK, ON CONFLICT y FTS5 sin tildes", async () => {
    const r = await runSpike(env.DB);
    const ctx = JSON.stringify(r.detalle);
    expect(r.visibilidad_intra_batch, `(a) visibilidad intra-batch — ${ctx}`).toBe(true);
    expect(r.rollback_por_check, `(b) rollback por CHECK — ${ctx}`).toBe(true);
    expect(r.on_conflict_do_nothing, `(c) ON CONFLICT DO NOTHING — ${ctx}`).toBe(true);
    expect(r.fts5_remove_diacritics, `(d) FTS5 remove_diacritics — ${ctx}`).toBe(true);
  });
});
