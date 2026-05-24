import { describe, it, expect } from "vitest";
import { calcularTotalConIgv, calcularDesdeTotal, formatearSoles, IGV_TASA } from "./igv";

describe("calcularTotalConIgv", () => {
  it("calcula 18% IGV correctamente sobre S/100", () => {
    const r = calcularTotalConIgv(100);
    expect(r).toEqual({ subtotal: 100, igv: 18, total: 118 });
  });

  it("redondea a 2 decimales", () => {
    const r = calcularTotalConIgv(99.99);
    expect(r.subtotal).toBe(99.99);
    expect(r.igv).toBe(18);
    expect(r.total).toBe(117.99);
  });

  it("acepta 0 (caso edge)", () => {
    expect(calcularTotalConIgv(0)).toEqual({ subtotal: 0, igv: 0, total: 0 });
  });

  it("rechaza valores negativos", () => {
    expect(() => calcularTotalConIgv(-1)).toThrow(RangeError);
  });

  it("rechaza NaN", () => {
    expect(() => calcularTotalConIgv(Number.NaN)).toThrow(RangeError);
  });

  it("usa la tasa IGV peruana 18%", () => {
    expect(IGV_TASA).toBe(0.18);
  });
});

describe("calcularDesdeTotal", () => {
  it("calcula correctamente desde S/118", () => {
    const r = calcularDesdeTotal(118);
    expect(r.subtotal).toBe(100);
    expect(r.igv).toBe(18);
    expect(r.total).toBe(118);
  });

  it("round-trip con calcularTotalConIgv", () => {
    const forward = calcularTotalConIgv(50);
    const backward = calcularDesdeTotal(forward.total);
    expect(backward.subtotal).toBe(forward.subtotal);
  });
});

describe("formatearSoles", () => {
  it("formato es-PE con S/", () => {
    const r = formatearSoles(1234.5);
    expect(r).toContain("1");
    expect(r).toContain("234");
    expect(r).toContain("50");
  });
});
