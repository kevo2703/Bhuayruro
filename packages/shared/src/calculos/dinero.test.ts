import { describe, expect, it } from "vitest";
import {
  calcularCabecera,
  calcularCabeceraDesdeLineas,
  calcularItem,
  centASolesStr,
  dmASolesStr,
  formatearSolesDesdeCent,
  rndDiv,
  sinIgvDmDesdeVentaPublicaDm,
  solesStrACent,
  solesStrADm,
} from "./dinero";

// Precios seed (§5.6), en diezmilésimas (precio_sin_igv × 10000).
const PRECIO_DM: Record<string, number> = {
  postday: 127119,
  portil: 50847,
  sildex: 42373,
  paracetamol: 12712,
  ibuprofeno: 15254,
  diclofenaco: 101695,
  loratadina: 16949,
  omeprazol: 16949,
  bromhexina: 67797,
  amoxicilina: 25424,
};

// GOLDEN calculado con implementación INDEPENDIENTE (BigInt exacto, half-up) — no con dinero.ts.
// Tupla por cantidad: [igvUnitarioDm, precioTotalUnitarioDm, lineaDm, subtotalCent, igvSubtotalCent, totalCent]
type Tupla = [number, number, number, number, number, number];
const GOLDEN: Record<string, Record<number, Tupla>> = {
  postday: {
    1: [22881, 150000, 127119, 1271, 229, 1500],
    2: [22881, 150000, 254238, 2542, 458, 3000],
    3: [22881, 150000, 381357, 3814, 686, 4500],
    7: [22881, 150000, 889833, 8898, 1602, 10500],
  },
  portil: {
    1: [9152, 59999, 50847, 508, 92, 600],
    2: [9152, 59999, 101694, 1017, 183, 1200],
    3: [9152, 59999, 152541, 1525, 275, 1800],
    7: [9152, 59999, 355929, 3559, 641, 4200],
  },
  sildex: {
    1: [7627, 50000, 42373, 424, 76, 500],
    2: [7627, 50000, 84746, 847, 153, 1000],
    3: [7627, 50000, 127119, 1271, 229, 1500],
    7: [7627, 50000, 296611, 2966, 534, 3500],
  },
  paracetamol: {
    1: [2288, 15000, 12712, 127, 23, 150],
    2: [2288, 15000, 25424, 254, 46, 300],
    3: [2288, 15000, 38136, 381, 69, 450],
    7: [2288, 15000, 88984, 890, 160, 1050],
  },
  ibuprofeno: {
    1: [2746, 18000, 15254, 153, 27, 180],
    2: [2746, 18000, 30508, 305, 55, 360],
    3: [2746, 18000, 45762, 458, 82, 540],
    7: [2746, 18000, 106778, 1068, 192, 1260],
  },
  diclofenaco: {
    1: [18305, 120000, 101695, 1017, 183, 1200],
    2: [18305, 120000, 203390, 2034, 366, 2400],
    3: [18305, 120000, 305085, 3051, 549, 3600],
    7: [18305, 120000, 711865, 7119, 1281, 8400],
  },
  loratadina: {
    1: [3051, 20000, 16949, 169, 31, 200],
    2: [3051, 20000, 33898, 339, 61, 400],
    3: [3051, 20000, 50847, 508, 92, 600],
    7: [3051, 20000, 118643, 1186, 214, 1400],
  },
  omeprazol: {
    1: [3051, 20000, 16949, 169, 31, 200],
    2: [3051, 20000, 33898, 339, 61, 400],
    3: [3051, 20000, 50847, 508, 92, 600],
    7: [3051, 20000, 118643, 1186, 214, 1400],
  },
  bromhexina: {
    1: [12203, 80000, 67797, 678, 122, 800],
    2: [12203, 80000, 135594, 1356, 244, 1600],
    3: [12203, 80000, 203391, 2034, 366, 2400],
    7: [12203, 80000, 474579, 4746, 854, 5600],
  },
  amoxicilina: {
    1: [4576, 30000, 25424, 254, 46, 300],
    2: [4576, 30000, 50848, 508, 92, 600],
    3: [4576, 30000, 76272, 763, 137, 900],
    7: [4576, 30000, 177968, 1780, 320, 2100],
  },
};

describe("dinero — golden §6.3.1: 10 SKUs × cantidades {1,2,3,7}", () => {
  for (const [sku, precioDm] of Object.entries(PRECIO_DM)) {
    for (const q of [1, 2, 3, 7]) {
      it(`${sku} × ${q}`, () => {
        const r = calcularItem(q, precioDm);
        const [igvU, ptU, lin, sub, igvS, tot] = GOLDEN[sku]![q]!;
        expect(r.igvUnitarioDm).toBe(igvU);
        expect(r.precioTotalUnitarioDm).toBe(ptU);
        expect(r.lineaDm).toBe(lin);
        expect(r.subtotalSinIgvCent).toBe(sub);
        expect(r.igvSubtotalCent).toBe(igvS);
        expect(r.totalCent).toBe(tot);
      });
    }
  }

  it("precio_total_dm del seed coincide (Postday 127119 → 150000 = S/ 15.00 exactos)", () => {
    expect(calcularItem(1, 127119).precioTotalUnitarioDm).toBe(150000);
    // Todos los precio_total_dm del seed (§5.6)
    const esperados: Record<string, number> = {
      postday: 150000,
      portil: 59999,
      sildex: 50000,
      paracetamol: 15000,
      ibuprofeno: 18000,
      diclofenaco: 120000,
      loratadina: 20000,
      omeprazol: 20000,
      bromhexina: 80000,
      amoxicilina: 30000,
    };
    for (const [sku, precioDm] of Object.entries(PRECIO_DM)) {
      expect(calcularItem(1, precioDm).precioTotalUnitarioDm, sku).toBe(esperados[sku]);
    }
  });
});

describe("dinero — golden §6.3.2: carritos mixtos (cabecera por fórmula, no suma de líneas)", () => {
  const carritos: { nombre: string; items: [string, number][]; sub: number; igv: number; total: number }[] = [
    { nombre: "c1", items: [["postday", 2], ["ibuprofeno", 3], ["diclofenaco", 1]], sub: 4017, igv: 723, total: 4740 },
    { nombre: "c2", items: [["paracetamol", 7], ["loratadina", 2], ["amoxicilina", 5], ["sildex", 1]], sub: 2924, igv: 526, total: 3450 },
    { nombre: "c3", items: [["bromhexina", 3], ["omeprazol", 4], ["portil", 6]], sub: 5763, igv: 1037, total: 6800 },
    { nombre: "c4", items: [["ibuprofeno", 1], ["paracetamol", 1], ["loratadina", 1], ["omeprazol", 1], ["amoxicilina", 1], ["sildex", 1]], sub: 1297, igv: 233, total: 1530 },
  ];
  for (const c of carritos) {
    it(c.nombre, () => {
      const r = calcularCabecera(c.items.map(([n, q]) => ({ cantidad: q, precioSinIgvUnitarioDm: PRECIO_DM[n]! })));
      expect(r.subtotalSinIgvCent).toBe(c.sub);
      expect(r.igvTotalCent).toBe(c.igv);
      expect(r.totalCent).toBe(c.total);
      expect(r.totalCent).toBe(r.subtotalSinIgvCent + r.igvTotalCent);
    });
  }

  it("regresión §6.2: el total de cabecera NO es round(S × 1.18)", () => {
    // S = 40043 dm → subtotal 400 + igv 72 = 472; round(S×1.18) daría 473. NO corregir.
    const r = calcularCabeceraDesdeLineas([40043]);
    expect(r.subtotalSinIgvCent).toBe(400);
    expect(r.igvTotalCent).toBe(72);
    expect(r.totalCent).toBe(472);
    expect(rndDiv(40043 * 118, 10000)).toBe(473); // el cálculo ingenuo diverge en 1 céntimo
    expect(r.totalCent).not.toBe(rndDiv(40043 * 118, 10000));
  });
});

describe("dinero — inversa PVP→sin_igv (importador de catálogo)", () => {
  // Kevin llena el PRECIO AL PÚBLICO (con IGV) de su lista; el importador guarda el sin_igv.
  // El precio al público "limpio" (2 decimales) de cada SKU del seed → su sin_igv canónico.
  const PVP_CENT: Record<string, number> = {
    postday: 1500,   // S/ 15.00
    portil: 600,     // S/ 6.00
    sildex: 500,     // S/ 5.00
    paracetamol: 150, // S/ 1.50
    ibuprofeno: 180, // S/ 1.80
    diclofenaco: 1200, // S/ 12.00
    loratadina: 200, // S/ 2.00
    omeprazol: 200,  // S/ 2.00
    bromhexina: 800, // S/ 8.00
    amoxicilina: 300, // S/ 3.00
  };

  it("PVP al público (con IGV) → precio_sin_igv_dm reproduce EXACTO los 10 del seed §5.6", () => {
    for (const [sku, sinIgvSeed] of Object.entries(PRECIO_DM)) {
      const pvpDm = PVP_CENT[sku]! * 100; // céntimos → diezmilésimas (×100)
      expect(sinIgvDmDesdeVentaPublicaDm(pvpDm), sku).toBe(sinIgvSeed);
    }
  });

  it("round-trip: PVP → sin_igv → total re-derivado cae al mismo céntimo que el PVP", () => {
    for (const [sku, pvpCent] of Object.entries(PVP_CENT)) {
      const sinIgv = sinIgvDmDesdeVentaPublicaDm(pvpCent * 100);
      const totalDm = calcularItem(1, sinIgv).precioTotalUnitarioDm;
      // total re-derivado (dm) redondeado a céntimos == el PVP que puso Kevin
      expect(rndDiv(totalDm, 100), sku).toBe(pvpCent);
    }
  });

  it("desde texto: '6.00' → 60000 dm → sin_igv 50847 (= Portil seed)", () => {
    expect(sinIgvDmDesdeVentaPublicaDm(solesStrADm("6.00"))).toBe(50847);
    expect(sinIgvDmDesdeVentaPublicaDm(solesStrADm("15"))).toBe(127119);
  });

  it("0 → 0 y rechaza negativos", () => {
    expect(sinIgvDmDesdeVentaPublicaDm(0)).toBe(0);
    expect(() => sinIgvDmDesdeVentaPublicaDm(-1)).toThrow();
  });
});

describe("dinero — golden §6.3.3: propiedad (1000 aleatorios)", () => {
  it("cabecera: subtotal+igv==total, todos ≥0, enteros seguros", () => {
    let semilla = 123456789; // PRNG determinista (sin Math.random)
    const rand = (max: number) => {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      return semilla % max;
    };
    for (let i = 0; i < 1000; i++) {
      const n = 1 + rand(6);
      const items = Array.from({ length: n }, () => ({
        cantidad: 1 + rand(20),
        precioSinIgvUnitarioDm: 1 + rand(2_000_000),
      }));
      const cab = calcularCabecera(items);
      expect(cab.totalCent).toBe(cab.subtotalSinIgvCent + cab.igvTotalCent);
      expect(cab.subtotalSinIgvCent).toBeGreaterThanOrEqual(0);
      expect(cab.igvTotalCent).toBeGreaterThanOrEqual(0);
      expect(Number.isSafeInteger(cab.totalCent)).toBe(true);
      // cada ítem también coherente
      for (const it2 of items) {
        const r = calcularItem(it2.cantidad, it2.precioSinIgvUnitarioDm);
        expect(Number.isSafeInteger(r.lineaDm)).toBe(true);
        expect(r.totalCent).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("dinero — golden §6.3.4: round-trip UI (parseo por dígitos, sin float)", () => {
  it("solesStrADm / dmASolesStr para los 10 precios seed", () => {
    const strs: Record<string, string> = {
      postday: "12.7119",
      portil: "5.0847",
      sildex: "4.2373",
      paracetamol: "1.2712",
      ibuprofeno: "1.5254",
      diclofenaco: "10.1695",
      loratadina: "1.6949",
      omeprazol: "1.6949",
      bromhexina: "6.7797",
      amoxicilina: "2.5424",
    };
    for (const [sku, dm] of Object.entries(PRECIO_DM)) {
      expect(solesStrADm(strs[sku]!), sku).toBe(dm);
      expect(dmASolesStr(dm), sku).toBe(strs[sku]);
    }
  });

  it("céntimos ida y vuelta", () => {
    expect(solesStrACent("15.00")).toBe(1500);
    expect(solesStrACent("15")).toBe(1500);
    expect(centASolesStr(1500)).toBe("15.00");
    expect(centASolesStr(4740)).toBe("47.40");
  });

  it("no usa float: 0.0003 sol → 3 dm exactos (parseFloat×10000 fallaría)", () => {
    expect(solesStrADm("0.0003")).toBe(3);
    expect(dmASolesStr(3)).toBe("0.0003");
  });

  it("formatearSolesDesdeCent devuelve moneda es-PE desde céntimos", () => {
    // Intl es-PE usa el símbolo "S/"; validamos que contenga el monto correcto.
    expect(formatearSolesDesdeCent(1500)).toContain("15.00");
    expect(formatearSolesDesdeCent(4740)).toContain("47.40");
  });
});
