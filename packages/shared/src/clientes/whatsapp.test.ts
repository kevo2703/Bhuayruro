import { describe, expect, it } from "vitest";
import { enlaceWhatsapp, numeroWhatsappInternacional } from "./whatsapp";

describe("numeroWhatsappInternacional", () => {
  it("al celular peruano de 9 dígitos le antepone el 51", () => {
    expect(numeroWhatsappInternacional("918343561")).toBe("51918343561");
  });

  it("si ya trae el código de país no lo duplica", () => {
    expect(numeroWhatsappInternacional("51918343561")).toBe("51918343561");
  });

  it("tolera separadores (la base guarda dígitos, pero el campo del formulario no)", () => {
    expect(numeroWhatsappInternacional("918 343 561")).toBe("51918343561");
    expect(numeroWhatsappInternacional("+51 918-343-561")).toBe("51918343561");
  });

  it("sin número, o con uno que no alcanza, NO inventa un enlace", () => {
    expect(numeroWhatsappInternacional(null)).toBeNull();
    expect(numeroWhatsappInternacional("")).toBeNull();
    expect(numeroWhatsappInternacional("4521")).toBeNull(); // fijo corto mal cargado
  });
});

describe("enlaceWhatsapp", () => {
  it("arma la URL y deja el texto pre-cargado", () => {
    expect(enlaceWhatsapp("918343561")).toBe("https://wa.me/51918343561");
    expect(enlaceWhatsapp("918343561", "Hola")).toBe("https://wa.me/51918343561?text=Hola");
  });

  it("sin número no hay enlace (el botón se apaga, no lleva a una URL rota)", () => {
    expect(enlaceWhatsapp(null, "Hola")).toBeNull();
  });
});
