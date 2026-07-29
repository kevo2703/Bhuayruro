import { describe, expect, it } from "vitest";
import { META_IDENTIFICADAS, nivelIdentificadas, pctIdentificadas } from "./kpi";

// El KPI "% de ventas identificadas" (expansión §2 A1) manda sobre toda la capacidad A. Lo que se
// prueba acá es que NO mienta en los bordes: sin ventas no hay porcentaje, y el semáforo cae del lado
// correcto justo en la meta.

describe("pctIdentificadas", () => {
  it("redondea a entero", () => {
    expect(pctIdentificadas(1, 3)).toBe(33);
    expect(pctIdentificadas(2, 3)).toBe(67);
    expect(pctIdentificadas(3, 10)).toBe(30);
  });

  it("sin ventas devuelve null, NUNCA 0 % (que se leería como 'nadie se identificó')", () => {
    expect(pctIdentificadas(0, 0)).toBeNull();
    expect(pctIdentificadas(5, 0)).toBeNull();
    expect(pctIdentificadas(0, -3)).toBeNull();
  });

  it("0 identificadas con ventas SÍ es 0 %", () => {
    expect(pctIdentificadas(0, 12)).toBe(0);
  });

  it("no se pasa de 100 ni baja de 0 con datos raros", () => {
    expect(pctIdentificadas(20, 10)).toBe(100);
    expect(pctIdentificadas(-4, 10)).toBe(0);
  });
});

describe("nivelIdentificadas (semáforo contra la meta)", () => {
  it("la meta se alcanza EN el umbral, no un punto después", () => {
    expect(nivelIdentificadas(META_IDENTIFICADAS.mes1)).toBe("meta1");
    expect(nivelIdentificadas(META_IDENTIFICADAS.mes1 - 1)).toBe("bajo");
    expect(nivelIdentificadas(META_IDENTIFICADAS.mes3)).toBe("meta3");
    expect(nivelIdentificadas(META_IDENTIFICADAS.mes3 - 1)).toBe("meta1");
  });

  it("sin porcentaje no hay semáforo", () => {
    expect(nivelIdentificadas(null)).toBe("sin_ventas");
  });
});
