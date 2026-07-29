import { describe, expect, it } from "vitest";
import { edadEnCumple, esBisiesto, ventanaCumpleanos } from "./cumpleanos";

describe("ventanaCumpleanos", () => {
  it("son 7 días empezando por hoy", () => {
    const v = ventanaCumpleanos("2026-07-28");
    expect(v.map((d) => d.dia)).toEqual(["07-28", "07-29", "07-30", "07-31", "08-01", "08-02", "08-03"]);
    expect(v[0]?.offset).toBe(0);
    expect(v[6]?.offset).toBe(6);
  });

  it("cruza el fin de año sin lógica especial", () => {
    const v = ventanaCumpleanos("2026-12-30", 4);
    expect(v.map((d) => d.dia)).toEqual(["12-30", "12-31", "01-01", "01-02"]);
    expect(v[2]?.ymd).toBe("2027-01-01");
  });

  it("en año NO bisiesto, quien nació el 29-feb entra junto con el 28", () => {
    // 2026 no es bisiesto: el calendario salta del 28 al 1 de marzo, y el 29 se cuelga del 28.
    const v = ventanaCumpleanos("2026-02-27", 3);
    expect(v.map((d) => d.dia)).toEqual(["02-27", "02-28", "02-29", "03-01"]);
    // El 29 comparte el día (y el offset) del 28: se saluda esa misma fecha.
    expect(v[1]?.offset).toBe(1);
    expect(v[2]?.offset).toBe(1);
    expect(v[2]?.ymd).toBe("2026-02-28");
    expect(v[3]?.offset).toBe(2);
  });

  it("en año bisiesto el 29-feb es su propio día y no se duplica", () => {
    const v = ventanaCumpleanos("2028-02-27", 3);
    expect(v.map((d) => d.dia)).toEqual(["02-27", "02-28", "02-29"]);
    expect(v[2]?.offset).toBe(2);
  });

  it("acota el rango pedido y aguanta una fecha inválida", () => {
    expect(ventanaCumpleanos("2026-07-28", 0)).toHaveLength(7); // 0 → default
    expect(ventanaCumpleanos("2026-07-28", 999)).toHaveLength(31); // tope
    expect(ventanaCumpleanos("no-es-fecha")).toEqual([]);
  });

  it("esBisiesto sigue la regla del siglo", () => {
    expect(esBisiesto(2028)).toBe(true);
    expect(esBisiesto(2026)).toBe(false);
    expect(esBisiesto(1900)).toBe(false);
    expect(esBisiesto(2000)).toBe(true);
  });
});

describe("edadEnCumple", () => {
  it("son los años que cumple en esa fecha", () => {
    expect(edadEnCumple("1990-07-30", "2026-07-30")).toBe(36);
  });

  it("sin año utilizable no inventa una edad", () => {
    expect(edadEnCumple("0001-07-30", "2026-07-30")).toBeNull();
    expect(edadEnCumple("xxxx-07-30", "2026-07-30")).toBeNull();
    expect(edadEnCumple("2030-07-30", "2026-07-30")).toBeNull(); // nacimiento futuro
  });
});
