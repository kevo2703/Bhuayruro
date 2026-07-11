import { describe, expect, it } from "vitest";
import { estaFueraDeHorario, minutosDeHHMM, minutosLima } from "./horario";

// Horario del piloto: Botica Huayruro abre 14:30 y cierra 00:00 (cruza a medianoche). Los timestamps
// de venta son ISO-8601 UTC; Lima = UTC-5. Una venta a las 20:00 Lima = 01:00Z del día siguiente.
const lima = (fecha: string, hhmm: string): string => {
  const [h, m] = hhmm.split(":").map(Number);
  const utcH = h! + 5; // Lima → UTC (+5)
  const dia = new Date(`${fecha}T00:00:00.000Z`);
  dia.setUTCHours(utcH, m, 0, 0);
  return dia.toISOString();
};

describe("minutosLima / minutosDeHHMM", () => {
  it("convierte un instante UTC a minutos-del-día Lima", () => {
    expect(minutosLima("2026-07-11T01:00:00.000Z")).toBe(20 * 60); // 20:00 Lima
    expect(minutosLima("2026-07-11T05:00:00.000Z")).toBe(0); // 00:00 Lima
    expect(minutosLima("2026-07-11T19:30:00.000Z")).toBe(14 * 60 + 30); // 14:30 Lima
  });
  it("fecha inválida → null", () => {
    expect(minutosLima("no-es-fecha")).toBeNull();
  });
  it("parsea 'HH:MM' y rechaza basura", () => {
    expect(minutosDeHHMM("14:30")).toBe(870);
    expect(minutosDeHHMM("00:00")).toBe(0);
    expect(minutosDeHHMM("24:00")).toBeNull();
    expect(minutosDeHHMM("9:99")).toBeNull();
    expect(minutosDeHHMM(null)).toBeNull();
    expect(minutosDeHHMM("")).toBeNull();
  });
});

describe("estaFueraDeHorario — horario que cruza medianoche (14:30 → 00:00)", () => {
  const A = "14:30";
  const C = "00:00";
  it("dentro del horario → false", () => {
    expect(estaFueraDeHorario(lima("2026-07-11", "14:30"), A, C)).toBe(false); // justo al abrir
    expect(estaFueraDeHorario(lima("2026-07-11", "20:00"), A, C)).toBe(false);
    expect(estaFueraDeHorario(lima("2026-07-11", "23:59"), A, C)).toBe(false);
  });
  it("antes de abrir o después de cerrar → true", () => {
    expect(estaFueraDeHorario(lima("2026-07-11", "14:29"), A, C)).toBe(true);
    expect(estaFueraDeHorario(lima("2026-07-11", "08:00"), A, C)).toBe(true);
    expect(estaFueraDeHorario(lima("2026-07-11", "00:00"), A, C)).toBe(true); // instante de cierre = cerrado
    expect(estaFueraDeHorario(lima("2026-07-11", "03:00"), A, C)).toBe(true);
  });
});

describe("estaFueraDeHorario — cierre pasada la medianoche (14:30 → 02:00) y mismo día (08:00 → 20:00)", () => {
  it("cruza medianoche: 01:00 dentro, 03:00 fuera", () => {
    expect(estaFueraDeHorario(lima("2026-07-11", "01:00"), "14:30", "02:00")).toBe(false);
    expect(estaFueraDeHorario(lima("2026-07-11", "03:00"), "14:30", "02:00")).toBe(true);
  });
  it("mismo día: 12:00 dentro, 07:00 y 21:00 fuera", () => {
    expect(estaFueraDeHorario(lima("2026-07-11", "12:00"), "08:00", "20:00")).toBe(false);
    expect(estaFueraDeHorario(lima("2026-07-11", "07:00"), "08:00", "20:00")).toBe(true);
    expect(estaFueraDeHorario(lima("2026-07-11", "21:00"), "08:00", "20:00")).toBe(true);
  });
});

describe("estaFueraDeHorario — sin control", () => {
  it("horario NULL/ inválido o 24h → nunca fuera (cero falsos positivos)", () => {
    expect(estaFueraDeHorario(lima("2026-07-11", "05:00"), null, "00:00")).toBe(false);
    expect(estaFueraDeHorario(lima("2026-07-11", "05:00"), "14:30", null)).toBe(false);
    expect(estaFueraDeHorario(lima("2026-07-11", "05:00"), "00:00", "00:00")).toBe(false); // 24h
    expect(estaFueraDeHorario("no-es-fecha", "14:30", "00:00")).toBe(false);
  });
});
