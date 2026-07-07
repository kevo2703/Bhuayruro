import { describe, expect, it } from "vitest";
import { esVencCorto, parseBonificacion, parseFactorUnidades, parseFechaVenc, validarListaCsv, ErrorLista } from "./lista";

describe("parseFactorUnidades (presentación → unidades base)", () => {
  it("patrones reales de droguería", () => {
    expect(parseFactorUnidades("CAJA X 100 TAB")).toBe(100);
    expect(parseFactorUnidades("X100")).toBe(100);
    expect(parseFactorUnidades("X 100")).toBe(100);
    expect(parseFactorUnidades("CJA100")).toBe(100);
    expect(parseFactorUnidades("BLISTER X 10")).toBe(10);
    expect(parseFactorUnidades("Blíster x10")).toBe(10);
    expect(parseFactorUnidades("AMOXICILINA 500 MG X 100 CAPSULAS")).toBe(100);
    expect(parseFactorUnidades("PAÑAL ADULTO X 20 UND")).toBe(20);
    expect(parseFactorUnidades("100 TAB")).toBe(100);
    expect(parseFactorUnidades("DISPENSADOR 50 SOBRES")).toBe(50);
  });

  it("medidas y decimales NO son factor", () => {
    expect(parseFactorUnidades("FCO X 120 ML")).toBeNull();
    expect(parseFactorUnidades("JARABE X 1.5 L")).toBeNull();
    expect(parseFactorUnidades("CREMA X 30 G")).toBeNull();
    expect(parseFactorUnidades("ALCOHOL X 1 L")).toBeNull();
    expect(parseFactorUnidades("FLEX100")).toBeNull(); // la X es parte de otra palabra
    expect(parseFactorUnidades("IBUPROFENO 400 MG")).toBeNull();
    expect(parseFactorUnidades("")).toBeNull();
  });

  it("caja de jarabes: el factor es de frascos, no de mililitros", () => {
    // "CAJA X 12 FRASCOS" → 12; el "120 ML" del contenido no contamina.
    expect(parseFactorUnidades("CAJA X 12 FCOS JARABE 120 ML")).toBe(12);
  });
});

describe("parseBonificacion", () => {
  it('"10+1" y variantes con espacios', () => {
    expect(parseBonificacion("10+1")).toEqual({ compra: 10, gratis: 1 });
    expect(parseBonificacion("10 + 1")).toEqual({ compra: 10, gratis: 1 });
    expect(parseBonificacion("12+2")).toEqual({ compra: 12, gratis: 2 });
  });
  it("rechaza formatos raros y ceros", () => {
    expect(parseBonificacion("10x1")).toBeNull();
    expect(parseBonificacion("0+1")).toBeNull();
    expect(parseBonificacion("10+0")).toBeNull();
    expect(parseBonificacion("bonif")).toBeNull();
    expect(parseBonificacion("")).toBeNull();
  });
});

describe("parseFechaVenc", () => {
  it("acepta los formatos del importador + MM/YYYY (día 01, conservador)", () => {
    expect(parseFechaVenc("2027-05-31")).toBe("2027-05-31");
    expect(parseFechaVenc("31/05/2027")).toBe("2027-05-31");
    expect(parseFechaVenc("05/2027")).toBe("2027-05-01");
    expect(parseFechaVenc("5-2027")).toBe("2027-05-01");
  });
  it("rechaza inválidos", () => {
    expect(parseFechaVenc("13/2027")).toBeNull();
    expect(parseFechaVenc("2027-02-31")).toBeNull();
    expect(parseFechaVenc("pronto")).toBeNull();
  });
});

describe("esVencCorto (umbral 8 meses, §6.3)", () => {
  it("antes del límite = corto; en el límite o después = no", () => {
    expect(esVencCorto("2026-12-01", "2026-07-07")).toBe(true);
    expect(esVencCorto("2027-03-06", "2026-07-07")).toBe(true);
    expect(esVencCorto("2027-03-07", "2026-07-07")).toBe(false);
    expect(esVencCorto("2030-01-01", "2026-07-07")).toBe(false);
  });
  it("clampa el día al fin de mes destino (31-oct + 8m → 30-jun)", () => {
    expect(esVencCorto("2027-06-29", "2026-10-31")).toBe(true);
    expect(esVencCorto("2027-06-30", "2026-10-31")).toBe(false);
  });
});

describe("validarListaCsv", () => {
  const CSV = [
    "PRODUCTO;PRESENTACION;PRECIO;BONIFICACION;VCTO;CODIGO;LABORATORIO",
    "IBUPROFENO 400MG TAB;CAJA X 100;38.00;10+1;05/2027;7750001000100;GENFAR",
    "PARACETAMOL 500MG;CAJA X 100 TAB;30,50;;2027-12-31;;PORTUGAL",
    "JARABE TOS NIÑOS;FCO X 120 ML;12.90;;;codigo raro!!;LUSA",
    ";CAJA X 10;5.00;;;;",
    "AMOXICILINA 500;CAJA X 100;1.505;;;;",
  ].join("\n");

  it("mapea ofertas con factor, bonificación, vencimiento y gtin", () => {
    const r = validarListaCsv(CSV);
    expect(r.delimitador).toBe(";");
    expect(r.resumen.validas).toBe(3);
    expect(r.resumen.rechazadas).toBe(2); // sin descripción + 3 decimales

    const ibu = r.items[0]!;
    expect(ibu.textoNorm).toBe("ibuprofeno 400mg tab");
    expect(ibu.factorUnidades).toBe(100);
    expect(ibu.precioCent).toBe(3800);
    expect(ibu.bonifCompra).toBe(10);
    expect(ibu.bonifGratis).toBe(1);
    expect(ibu.vencimiento).toBe("2027-05-01");
    expect(ibu.gtin).toBe("7750001000100");
    expect(ibu.laboratorio).toBe("GENFAR");

    const para = r.items[1]!;
    expect(para.precioCent).toBe(3050); // coma decimal es-PE
    expect(para.gtin).toBeNull();

    const jarabe = r.items[2]!;
    expect(jarabe.factorUnidades).toBeNull(); // 120 ML no es factor
    expect(jarabe.gtin).toBeNull(); // código raro → aviso, no rechazo
    expect(r.advertencias.some((a) => a.fila === jarabe.fila && /código de barras raro/.test(a.aviso))).toBe(true);
  });

  it("rechaza precio con 3+ decimales (no redondeamos dinero en silencio)", () => {
    const r = validarListaCsv(CSV);
    const rech = r.rechazadas.find((x) => x.texto === "AMOXICILINA 500");
    expect(rech).toBeDefined();
    expect(rech!.motivos.join(" ")).toMatch(/más de 2 decimales/);
  });

  it("acepta TSV pegado desde Excel (D-N8)", () => {
    const tsv = "producto\tprecio\nIBUPROFENO 400\t12.00\n";
    const r = validarListaCsv(tsv);
    expect(r.delimitador).toBe("\t");
    expect(r.resumen.validas).toBe(1);
    expect(r.items[0]!.precioCent).toBe(1200);
  });

  it("producto repetido = advertencia (ambas ofertas viven)", () => {
    const r = validarListaCsv("producto,precio\nIBUPROFENO,10.00\nIBUPROFENO,9.00\n");
    expect(r.resumen.validas).toBe(2);
    expect(r.advertencias.some((a) => /repetido/.test(a.aviso))).toBe(true);
  });

  it("falta columna de producto o precio → error estructural", () => {
    expect(() => validarListaCsv("precio\n10.00\n")).toThrow(ErrorLista);
    expect(() => validarListaCsv("producto\nIBUPROFENO\n")).toThrow(ErrorLista);
  });
});
