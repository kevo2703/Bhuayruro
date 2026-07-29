import { describe, expect, it } from "vitest";
import {
  disparaRegla,
  elegirSugerencia,
  errorDeRegla,
  MAX_GUION,
  normalizarRegla,
  pctConversion,
  type ProductoDisparador,
  type ReglaSugerencia,
} from "./motor";

// Golden a mano del motor de venta cruzada (A4). El caso de referencia es el real de botica:
// antiinflamatorio → protector gástrico.

const OMEPRAZOL = "p-omeprazol";
const IBUPROFENO = "p-ibuprofeno";

const regla = (over: Partial<ReglaSugerencia> = {}): ReglaSugerencia => ({
  id: "r1",
  disparador_tipo: "principio_activo",
  disparador_valor: "Ibuprofeno",
  sugerido_producto_id: OMEPRAZOL,
  guion: "Si lo va a tomar más de dos días, un protector le cuida el estómago.",
  prioridad: 0,
  ...over,
});

const ibuprofeno: ProductoDisparador = {
  producto_id: IBUPROFENO,
  categoria: "Antiinflamatorio",
  principio_activo: "Ibuprofeno 400 mg",
};

const ctx = (over: Partial<Parameters<typeof elegirSugerencia>[2]> = {}) => ({
  productosEnCarrito: [IBUPROFENO],
  stockPorProducto: { [OMEPRAZOL]: 40 },
  ...over,
});

describe("disparaRegla", () => {
  it("principio_activo pega por contenido: la regla 'Ibuprofeno' alcanza a 'Ibuprofeno 400 mg'", () => {
    expect(disparaRegla(regla(), ibuprofeno)).toBe(true);
  });

  it("ignora tildes y mayúsculas en ambos lados", () => {
    const r = regla({ disparador_tipo: "categoria", disparador_valor: "ANTIINFLAMATORIO" });
    expect(disparaRegla(r, { ...ibuprofeno, categoria: "Antiinflamatório" })).toBe(true);
  });

  it("no dispara si el campo del producto está vacío", () => {
    expect(disparaRegla(regla(), { ...ibuprofeno, principio_activo: null })).toBe(false);
  });

  it("no dispara con un disparador vacío (una regla en blanco no puede pegarle a todo)", () => {
    expect(disparaRegla(regla({ disparador_valor: "   " }), ibuprofeno)).toBe(false);
  });

  it("disparador 'producto' compara el id exacto, sin normalizar", () => {
    const r = regla({ disparador_tipo: "producto", disparador_valor: IBUPROFENO });
    expect(disparaRegla(r, ibuprofeno)).toBe(true);
    expect(disparaRegla(r, { ...ibuprofeno, producto_id: "p-otro" })).toBe(false);
    // El id se compara tal cual: en minúsculas forzadas dos UUID distintos podrían colisionar.
    expect(disparaRegla(regla({ disparador_tipo: "producto", disparador_valor: IBUPROFENO.toUpperCase() }), ibuprofeno)).toBe(false);
  });
});

describe("elegirSugerencia", () => {
  it("elige la regla que dispara", () => {
    expect(elegirSugerencia([regla()], ibuprofeno, ctx())?.id).toBe("r1");
  });

  it("devuelve null si ninguna regla dispara", () => {
    expect(elegirSugerencia([regla({ disparador_valor: "Amoxicilina" })], ibuprofeno, ctx())).toBeNull();
  });

  it("NO sugiere un producto que ya está en el carrito", () => {
    const c = ctx({ productosEnCarrito: [IBUPROFENO, OMEPRAZOL] });
    expect(elegirSugerencia([regla()], ibuprofeno, c)).toBeNull();
  });

  it("NO sugiere un producto sin stock en esta botica", () => {
    expect(elegirSugerencia([regla()], ibuprofeno, ctx({ stockPorProducto: { [OMEPRAZOL]: 0 } }))).toBeNull();
    // Producto que ni figura en el inventario de la botica = tampoco.
    expect(elegirSugerencia([regla()], ibuprofeno, ctx({ stockPorProducto: {} }))).toBeNull();
  });

  it("con la cache de stock todavía sin cargar (null) no bloquea la sugerencia", () => {
    expect(elegirSugerencia([regla()], ibuprofeno, ctx({ stockPorProducto: null }))?.id).toBe("r1");
  });

  it("NO repite una regla que ya se mostró en esta atención", () => {
    expect(elegirSugerencia([regla()], ibuprofeno, ctx({ reglasYaMostradas: ["r1"] }))).toBeNull();
  });

  it("NO se sugiere a sí mismo (regla mal curada: dispara y sugiere el mismo producto)", () => {
    const r = regla({ sugerido_producto_id: IBUPROFENO });
    expect(elegirSugerencia([r], ibuprofeno, ctx())).toBeNull();
  });

  it("desempata por prioridad DESC y, en empate, por id ASC (determinista)", () => {
    const a = regla({ id: "r-b", prioridad: 5, sugerido_producto_id: "p-a" });
    const b = regla({ id: "r-a", prioridad: 5, sugerido_producto_id: "p-b" });
    const c = regla({ id: "r-c", prioridad: 9, sugerido_producto_id: "p-c" });
    const stock = { "p-a": 1, "p-b": 1, "p-c": 1 };
    expect(elegirSugerencia([a, b, c], ibuprofeno, ctx({ stockPorProducto: stock }))?.id).toBe("r-c");
    expect(elegirSugerencia([a, b], ibuprofeno, ctx({ stockPorProducto: stock }))?.id).toBe("r-a");
    // El orden en que llegan las reglas no cambia el resultado.
    expect(elegirSugerencia([b, a], ibuprofeno, ctx({ stockPorProducto: stock }))?.id).toBe("r-a");
  });

  it("devuelve UNA sola regla aunque disparen varias (tope §2 A4)", () => {
    const r1 = regla({ id: "r1", sugerido_producto_id: "p-a" });
    const r2 = regla({ id: "r2", disparador_tipo: "categoria", disparador_valor: "Antiinflamatorio", sugerido_producto_id: "p-b" });
    const elegida = elegirSugerencia([r1, r2], ibuprofeno, ctx({ stockPorProducto: { "p-a": 1, "p-b": 1 } }));
    expect(elegida).not.toBeNull();
    expect([r1.id, r2.id]).toContain(elegida?.id);
  });
});

describe("errorDeRegla", () => {
  const base = { disparador_tipo: "categoria", disparador_valor: "Antibiótico", sugerido_producto_id: "p-x", guion: "Le protege la flora." };

  it("acepta una regla bien formada", () => {
    expect(errorDeRegla(base)).toBeNull();
  });

  it("rechaza un disparador desconocido", () => {
    expect(errorDeRegla({ ...base, disparador_tipo: "marca" })).toMatch(/disparador_tipo/);
  });

  it("exige guion: sin la frase que se dice, la tarjeta no sirve", () => {
    expect(errorDeRegla({ ...base, guion: "   " })).toMatch(/guion/);
    expect(errorDeRegla({ ...base, guion: "x".repeat(MAX_GUION + 1) })).toMatch(/220/);
  });

  it("rechaza el disparador vacío y el producto sugerido vacío", () => {
    expect(errorDeRegla({ ...base, disparador_valor: " " })).toMatch(/disparador/);
    expect(errorDeRegla({ ...base, sugerido_producto_id: "" })).toMatch(/producto/);
  });

  it("rechaza la regla que se sugiere a sí misma", () => {
    expect(errorDeRegla({ ...base, disparador_tipo: "producto", disparador_valor: "p-x" })).toMatch(/mismo producto/);
  });
});

describe("normalizarRegla", () => {
  it("recorta, corta al tope y deja la prioridad como entero", () => {
    const r = normalizarRegla({
      disparador_tipo: "categoria",
      disparador_valor: "  Antibiótico  ",
      sugerido_producto_id: " p-x ",
      guion: "  Le protege la flora.  ",
      prioridad: 3.7,
    });
    expect(r).toEqual({
      disparador_tipo: "categoria",
      disparador_valor: "Antibiótico",
      sugerido_producto_id: "p-x",
      guion: "Le protege la flora.",
      prioridad: 3,
    });
  });

  it("una prioridad ausente o basura vale 0, no NaN", () => {
    expect(normalizarRegla({ ...{ disparador_tipo: "categoria", disparador_valor: "a", sugerido_producto_id: "b", guion: "c" } }).prioridad).toBe(0);
    expect(normalizarRegla({ disparador_tipo: "categoria", disparador_valor: "a", sugerido_producto_id: "b", guion: "c", prioridad: NaN }).prioridad).toBe(0);
  });
});

describe("pctConversion", () => {
  it("redondea a entero", () => {
    expect(pctConversion({ mostradas: 3, aceptadas: 1 })).toBe(33);
    expect(pctConversion({ mostradas: 4, aceptadas: 4 })).toBe(100);
  });

  it("sin mostradas es null, nunca 0 % (0 % se leería como 'no convierte')", () => {
    expect(pctConversion({ mostradas: 0, aceptadas: 0 })).toBeNull();
  });
});
