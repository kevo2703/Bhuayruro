import { beforeEach, describe, expect, it } from "vitest";
import { HuayruroDB } from "./db-local";
import type { ColaOp } from "./db-local";
import { encolar, flushUnaVez, type ResultadoEnvio } from "./cola";
import { derivar } from "./useEstadoSync";

// ============================================================
// GATE E7.2 (plan §9) — cola offline idempotente. Modo avión → 3 ventas → online →
// EXACTAMENTE 3 ventas únicas. El servidor se modela con dedupe por client_uuid (como el
// batch §7.3): reenviar una op NUNCA duplica. La garantía a nivel D1 se prueba, además, en
// apps/api/test/cola-offline.test.ts.
// ============================================================

// Servidor simulado: acumula client_uuids confirmados en un Set → idempotente por diseño.
function servidorSimulado() {
  const confirmados = new Set<string>();
  let online = false;
  const enviar = async (op: ColaOp): Promise<ResultadoEnvio> => {
    if (!online) return { tipo: "reintentar", error: "offline" };
    confirmados.add(op.client_uuid); // el Set NO duplica aunque llegue 2 veces
    return { tipo: "confirmada", venta_id: `v-${op.client_uuid}` };
  };
  return { enviar, confirmados, setOnline: (v: boolean) => (online = v) };
}

let n = 0;
let db: HuayruroDB;
beforeEach(async () => {
  db = new HuayruroDB(`t-cola-${n++}`);
  await db.cola_ops.clear();
});

describe("GATE E7.2 — cola offline (§9)", () => {
  it("modo avión → 3 ventas → online → EXACTAMENTE 3 ventas únicas (idempotente)", async () => {
    const srv = servidorSimulado();
    // Modo avión: 3 ventas se encolan igual (la UI confirma e imprime desde datos locales).
    for (let i = 0; i < 3; i++) {
      await encolar(db, "venta", { metodo_pago: "efectivo", items: [{ producto_id: `p${i}`, cantidad: 1, precio_sin_igv_unitario_dm: 15254 }] });
    }
    expect(await db.cola_ops.count()).toBe(3);

    // Flush offline: nada se confirma; las 3 siguen pendientes.
    const off = await flushUnaVez(db, srv.enviar, 1_000);
    expect(off.confirmadas).toBe(0);
    expect(srv.confirmados.size).toBe(0);
    expect(await db.cola_ops.where("estado").equals("confirmada").count()).toBe(0);

    // Vuelve la conexión (pasado el backoff): se vacían las 3.
    srv.setOnline(true);
    const on = await flushUnaVez(db, srv.enviar, 100_000);
    expect(on.confirmadas).toBe(3);
    expect(srv.confirmados.size).toBe(3); // ← EXACTAMENTE 3 únicas
    expect(await db.cola_ops.where("estado").equals("confirmada").count()).toBe(3);

    // Recuperación tras cierre abrupto: una op quedó 'enviando' y se reintenta → NO duplica.
    const alguna = (await db.cola_ops.toArray())[0]!;
    await db.cola_ops.update(alguna.client_uuid, { estado: "enviando" });
    const rerun = await flushUnaVez(db, srv.enviar, 200_000);
    expect(rerun.confirmadas).toBe(1); // se reenvía
    expect(srv.confirmados.size).toBe(3); // pero el server ya la tenía → siguen 3 únicas
  });

  it("respeta el backoff: tras fallar offline no reintenta en el mismo instante", async () => {
    const srv = servidorSimulado();
    await encolar(db, "venta", { metodo_pago: "efectivo", items: [] });
    await flushUnaVez(db, srv.enviar, 1_000); // falla → proximo_intento_at = 1000 + 1000
    srv.setOnline(true);
    const r = await flushUnaVez(db, srv.enviar, 1_500); // aún dentro del backoff (1000→2000)
    expect(r.confirmadas).toBe(0);
    expect(r.pendientes).toBe(1);
    const r2 = await flushUnaVez(db, srv.enviar, 3_000); // pasado el backoff
    expect(r2.confirmadas).toBe(1);
  });

  it("op de negocio rechazada (4xx) → estado 'rechazada' (bandeja), no se reintenta", async () => {
    const enviar = async (): Promise<ResultadoEnvio> => ({ tipo: "rechazada", error: "validacion: ítem inválido" });
    const cu = await encolar(db, "venta", { metodo_pago: "efectivo", items: [] });
    const r = await flushUnaVez(db, enviar, 1_000);
    expect(r.rechazadas).toBe(1);
    expect((await db.cola_ops.get(cu))!.estado).toBe("rechazada");
  });

  it("encolar inyecta client_uuid en el payload (idempotencia)", async () => {
    const cu = await encolar(db, "venta", { metodo_pago: "yape", items: [] });
    const op = (await db.cola_ops.get(cu))!;
    expect((op.payload as { client_uuid: string }).client_uuid).toBe(cu);
  });

  it("banner (derivar): estados ok/pendiente/offline/rechazada", () => {
    expect(derivar(true, 0, 0).nivel).toBe("ok");
    expect(derivar(true, 3, 0).nivel).toBe("pendiente");
    expect(derivar(false, 2, 0).nivel).toBe("offline");
    expect(derivar(true, 0, 1).nivel).toBe("rechazada"); // rechazadas priman
    expect(derivar(false, 0, 1).nivel).toBe("rechazada");
  });
});
