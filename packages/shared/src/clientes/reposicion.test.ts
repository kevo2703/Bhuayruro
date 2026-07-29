import { describe, expect, it } from "vitest";
import {
  DIAS_AVISO_DEFAULT,
  MAX_DIAS_TRATAMIENTO,
  diasEntre,
  fechaAgotamiento,
  fechaCorta,
  mensajeReposicion,
  primerNombre,
  saludoPeru,
} from "./reposicion";

// A2 v1 — lo que estos tests defienden:
//   1. La fecha de agotamiento se trunca hacia ABAJO (avisar antes, nunca después) y se niega a
//      inventar fechas cuando la dosis viene mal cargada.
//   2. El mensaje NO le dice a alguien que le queda medicina cuando ya se le acabó.
//   3. El saludo es el peruano y depende de la hora (el mensaje se manda a mano, a cualquier hora).

describe("fecha de agotamiento", () => {
  it("cantidad ÷ dosis, contada desde el día que se lo llevó", () => {
    // 30 tabletas, 1 al día, comprado el 01 → le alcanza hasta el 31.
    expect(fechaAgotamiento("2026-07-01", 30, 1)).toBe("2026-07-31");
    // 30 tabletas, 2 al día → 15 días.
    expect(fechaAgotamiento("2026-07-01", 30, 2)).toBe("2026-07-16");
  });

  it("trunca hacia abajo: si alcanza 9,8 días el aviso sale al noveno", () => {
    expect(fechaAgotamiento("2026-07-01", 29, 3)).toBe("2026-07-10"); // 9,66 → 9
  });

  it("media tableta al día también vale (la dosis es REAL, no entera)", () => {
    expect(fechaAgotamiento("2026-07-01", 30, 0.5)).toBe("2026-08-30"); // 60 días
  });

  it("cruza el fin de mes y el fin de año sin lógica extra", () => {
    expect(fechaAgotamiento("2026-12-20", 30, 1)).toBe("2027-01-19");
  });

  it("dosis o cantidad inservibles NO producen fecha (mejor sin aviso que con uno falso)", () => {
    expect(fechaAgotamiento("2026-07-01", 30, 0)).toBeNull();
    expect(fechaAgotamiento("2026-07-01", 0, 1)).toBeNull();
    expect(fechaAgotamiento("2026-07-01", 30, -1)).toBeNull();
    expect(fechaAgotamiento("no-es-fecha", 30, 1)).toBeNull();
  });

  it("una dosis mal cargada no genera un aviso a cinco años", () => {
    // 30 unidades con dosis 0,01/día darían 3.000 días. Se descarta.
    expect(fechaAgotamiento("2026-07-01", 30, 0.01)).toBeNull();
    // El borde exacto sí pasa.
    expect(fechaAgotamiento("2026-07-01", MAX_DIAS_TRATAMIENTO, 1)).toBe("2026-12-28");
  });
});

describe("utilidades de fecha y nombre", () => {
  it("diasEntre distingue el futuro del pasado", () => {
    expect(diasEntre("2026-07-29", "2026-08-01")).toBe(3);
    expect(diasEntre("2026-07-29", "2026-07-29")).toBe(0);
    expect(diasEntre("2026-07-29", "2026-07-24")).toBe(-5);
    expect(diasEntre("2026-07-29", "cualquier cosa")).toBeNull();
  });

  it("la fecha se escribe como se escribe en Perú", () => {
    expect(fechaCorta("2026-07-29")).toBe("29/07");
  });

  it("del padrón sale el primer nombre", () => {
    expect(primerNombre("María Quispe Vargas")).toBe("María");
    expect(primerNombre("  Juan  ")).toBe("Juan");
    expect(primerNombre("")).toBe("");
  });

  it("el saludo depende de la hora de Lima", () => {
    expect(saludoPeru(8)).toBe("Buenos días");
    expect(saludoPeru(15)).toBe("Buenas tardes");
    expect(saludoPeru(21)).toBe("Buenas noches");
  });
});

describe("el mensaje", () => {
  const base = { nombreCliente: "María Quispe", botica: "Botica Huayruro", hoyYmd: "2026-07-29", horaLima: 9 };

  it("dice de dónde sale el dato y ofrece separarlo", () => {
    const m = mensajeReposicion({
      ...base,
      items: [{ producto_nombre: "Losartán 50 mg", fecha_agotamiento: "2026-08-01", fecha_compra: "2026-07-02" }],
    });
    expect(m).toContain("Buenos días, María.");
    expect(m).toContain("Le escribo de Botica Huayruro.");
    expect(m).toContain("Por lo que llevó el 02/07");
    expect(m).toContain("su Losartán 50 mg le alcanzaría hasta el 01/08");
    expect(m).toContain("¿Se lo separamos");
  });

  it("si ya se le acabó NO le dice que le queda", () => {
    const m = mensajeReposicion({
      ...base,
      items: [{ producto_nombre: "Losartán 50 mg", fecha_agotamiento: "2026-07-24", fecha_compra: "2026-06-24" }],
    });
    expect(m).toContain("se le habría acabado el 24/07");
    expect(m).not.toContain("le alcanzaría");
  });

  it("con dos tratamientos lista cada uno con SU fecha", () => {
    const m = mensajeReposicion({
      ...base,
      items: [
        { producto_nombre: "Losartán 50 mg", fecha_agotamiento: "2026-08-01", fecha_compra: "2026-07-02" },
        { producto_nombre: "Metformina 850 mg", fecha_agotamiento: "2026-08-03", fecha_compra: "2026-07-02" },
      ],
    });
    expect(m).toContain("Losartán 50 mg (hasta el 01/08) y Metformina 850 mg (hasta el 03/08)");
    expect(m).toContain("¿Se los separamos");
  });

  it("sin fecha de compra (viene de un seguimiento a mano) igual se entiende", () => {
    const m = mensajeReposicion({
      ...base,
      items: [{ producto_nombre: "Enalapril 10 mg", fecha_agotamiento: "2026-08-01", fecha_compra: null }],
    });
    expect(m).toContain("Según lo que llevó, su Enalapril 10 mg");
    expect(m).not.toContain("Por lo que llevó el");
  });

  it("sin nombre de botica no queda una frase colgada", () => {
    const m = mensajeReposicion({
      ...base,
      botica: null,
      items: [{ producto_nombre: "Losartán 50 mg", fecha_agotamiento: "2026-08-01", fecha_compra: "2026-07-02" }],
    });
    expect(m.startsWith("Buenos días, María.\n\n")).toBe(true);
    expect(m).not.toContain("Le escribo de");
  });

  it("la ventana por defecto es la que ratificó Kevin", () => {
    expect(DIAS_AVISO_DEFAULT).toBe(3);
  });
});
