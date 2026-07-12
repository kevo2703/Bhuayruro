import { describe, expect, it } from "vitest";
import { ABC_CORTE, CADENCIA_DIAS, clasificarABC, conteoVencido, diasEntreYmd } from "./abc";

describe("clasificarABC — rankeo por valor de venta", () => {
  it("A = top 20%, B = hasta 50% acumulado, C = resto (10 SKUs)", () => {
    // 10 productos con valor 100,90,...,10 (p01 el más vendido). Percentiles: i/10.
    const items = Array.from({ length: 10 }, (_, i) => ({ productoId: `p${String(i).padStart(2, "0")}`, valorCent: (10 - i) * 10 }));
    const c = clasificarABC(items);
    // i<2 (0.0,0.1) → A; i<5 (0.2..0.4) → B; resto → C.
    expect(c.get("p00")).toBe("A");
    expect(c.get("p01")).toBe("A");
    expect(c.get("p02")).toBe("B");
    expect(c.get("p04")).toBe("B");
    expect(c.get("p05")).toBe("C");
    expect(c.get("p09")).toBe("C");
    const clases = [...c.values()];
    expect(clases.filter((x) => x === "A")).toHaveLength(2);
    expect(clases.filter((x) => x === "B")).toHaveLength(3);
    expect(clases.filter((x) => x === "C")).toHaveLength(5);
  });

  it("un SKU sin ventas cae a C aunque haya pocos productos (percentil lo alcanzaría)", () => {
    const c = clasificarABC([
      { productoId: "vende", valorCent: 5000 },
      { productoId: "muerto", valorCent: 0 },
    ]);
    expect(c.get("vende")).toBe("A"); // índice 0 → A
    expect(c.get("muerto")).toBe("C"); // valor 0 → C forzado (no B por estar en el top 50%)
  });

  it("es determinista: empata por productoId ASC", () => {
    const a = clasificarABC([
      { productoId: "zzz", valorCent: 100 },
      { productoId: "aaa", valorCent: 100 },
      { productoId: "mmm", valorCent: 100 },
    ]);
    // Todos mismo valor → orden por id: aaa(0)→A, mmm(1)→B... con 3 items: i<0.6→A? 0/3=0<0.2 A; 1/3=.33<.5 B; 2/3 C
    expect(a.get("aaa")).toBe("A");
    expect(a.get("mmm")).toBe("B");
    expect(a.get("zzz")).toBe("C");
  });

  it("lista vacía no rompe", () => {
    expect(clasificarABC([]).size).toBe(0);
  });
});

describe("conteoVencido — cadencia por clase", () => {
  it("nunca contado → siempre vencido", () => {
    expect(conteoVencido("A", null, "2026-07-12")).toBe(true);
    expect(conteoVencido("C", null, "2026-07-12")).toBe(true);
  });

  it("A vence a los 7 días; aún no a los 6", () => {
    expect(conteoVencido("A", "2026-07-05", "2026-07-11")).toBe(false); // 6 días
    expect(conteoVencido("A", "2026-07-05", "2026-07-12")).toBe(true); // 7 días
  });

  it("B mensual (30), C trimestral (90)", () => {
    expect(CADENCIA_DIAS.B).toBe(30);
    expect(CADENCIA_DIAS.C).toBe(90);
    expect(conteoVencido("B", "2026-06-13", "2026-07-12")).toBe(false); // 29 días
    expect(conteoVencido("B", "2026-06-12", "2026-07-12")).toBe(true); // 30 días
    expect(conteoVencido("C", "2026-05-01", "2026-07-12")).toBe(false); // 72 días
  });
});

describe("diasEntreYmd", () => {
  it("cuenta días calendario", () => {
    expect(diasEntreYmd("2026-07-01", "2026-07-11")).toBe(10);
    expect(diasEntreYmd("2026-07-11", "2026-07-11")).toBe(0);
  });
  it("fechas inválidas → 0", () => {
    expect(diasEntreYmd("basura", "2026-07-11")).toBe(0);
  });
  it("cortes ABC son 0.2 / 0.5", () => {
    expect(ABC_CORTE.A).toBe(0.2);
    expect(ABC_CORTE.B).toBe(0.5);
  });
});
