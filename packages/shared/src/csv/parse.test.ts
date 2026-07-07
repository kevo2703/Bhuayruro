import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse";

describe("parseCsv — casos base", () => {
  it("coma simple, cabecera + 2 filas", () => {
    const r = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(r.delimitador).toBe(",");
    expect(r.filas).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("detecta ';' (Excel es-PE) sobre ','", () => {
    const r = parseCsv("nombre;precio;stock\nParacetamol;1,50;100");
    expect(r.delimitador).toBe(";");
    expect(r.filas[1]).toEqual(["Paracetamol", "1,50", "100"]);
  });

  it("respeta comas DENTRO de comillas", () => {
    const r = parseCsv('nombre,nota\n"Ibuprofeno 400 mg, caja","x, y, z"');
    expect(r.filas[1]).toEqual(["Ibuprofeno 400 mg, caja", "x, y, z"]);
  });

  it("comillas escapadas ('\"\"' → '\"')", () => {
    const r = parseCsv('a\n"dice ""hola"" fuerte"');
    expect(r.filas[1]).toEqual(['dice "hola" fuerte']);
  });

  it("salto de línea DENTRO de comillas no rompe la fila", () => {
    const r = parseCsv('a,b\n"linea1\nlinea2",fin');
    expect(r.filas).toEqual([
      ["a", "b"],
      ["linea1\nlinea2", "fin"],
    ]);
  });

  it("CRLF y BOM", () => {
    const r = parseCsv("﻿a,b\r\n1,2\r\n");
    expect(r.filas).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("ignora líneas totalmente vacías (finales o intermedias)", () => {
    const r = parseCsv("a,b\n1,2\n\n\n3,4\n");
    expect(r.filas).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("recorta espacios de borde fuera de comillas, los preserva dentro", () => {
    const r = parseCsv('a,b\n  hola  ,"  con espacios  "');
    expect(r.filas[1]).toEqual(["hola", "  con espacios  "]);
  });

  it("tab como delimitador", () => {
    const r = parseCsv("a\tb\tc\n1\t2\t3");
    expect(r.delimitador).toBe("\t");
    expect(r.filas[1]).toEqual(["1", "2", "3"]);
  });

  it("delimitador forzado ignora la detección", () => {
    const r = parseCsv("a;b,c\n1;2,3", ",");
    expect(r.delimitador).toBe(",");
    expect(r.filas[0]).toEqual(["a;b", "c"]);
  });

  it("celda vacía entre delimitadores se conserva", () => {
    const r = parseCsv("a,b,c\n1,,3");
    expect(r.filas[1]).toEqual(["1", "", "3"]);
  });

  it("comilla suelta en medio de un valor NO entrecomillado es literal (no se traga filas)", () => {
    const r = parseCsv('nombre,x\nAlcohol 70" antiseptico,ok\nSegundo,fila');
    expect(r.comillasSinCerrar).toBe(false);
    expect(r.filas).toEqual([
      ["nombre", "x"],
      ['Alcohol 70" antiseptico', "ok"],
      ["Segundo", "fila"],
    ]);
  });

  it("comilla ABIERTA al inicio y nunca cerrada marca comillasSinCerrar", () => {
    const r = parseCsv('a,b\n"sin cerrar,resto,del,archivo');
    expect(r.comillasSinCerrar).toBe(true);
  });

  it("archivo bien formado → comillasSinCerrar false", () => {
    const r = parseCsv('a,b\n"ok",2');
    expect(r.comillasSinCerrar).toBe(false);
  });
});
