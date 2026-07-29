import { describe, expect, it } from "vitest";
import { inicioTrasAgregar, inicioTrasQuitar } from "./atencion";

// Δ2: hasta S14 el Mostrador no mandaba `atencion_inicio` y `servicio_prom_seg` del espejo era
// siempre null. Lo que se prueba acá es que el reloj mida la ATENCIÓN y no el tiempo de pantalla.

const T1 = "2026-07-28T15:00:00.000Z";
const T2 = "2026-07-28T15:02:30.000Z";

describe("inicioTrasAgregar", () => {
  it("el primer ítem arranca el reloj", () => {
    expect(inicioTrasAgregar(0, null, T1)).toBe(T1);
  });

  it("los siguientes ítems NO lo reinician (la atención es una sola)", () => {
    expect(inicioTrasAgregar(1, T1, T2)).toBe(T1);
    expect(inicioTrasAgregar(5, T1, T2)).toBe(T1);
  });

  it("si por lo que sea había ítems sin reloj, lo arranca en vez de mandar null", () => {
    expect(inicioTrasAgregar(2, null, T2)).toBe(T2);
  });
});

describe("inicioTrasQuitar", () => {
  it("vaciar el carrito descarta el reloj: la próxima venta es otra atención", () => {
    expect(inicioTrasQuitar(0, T1)).toBeNull();
  });

  it("quitar un ítem de varios no toca el reloj", () => {
    expect(inicioTrasQuitar(2, T1)).toBe(T1);
  });
});
