import { describe, expect, it } from "vitest";
import {
  avanzar,
  CB,
  parseBlister,
  parseCantidad,
  parseComando,
  parseLoteVenc,
  parsePrecioSoles,
  resumenBorrador,
  type BorradorBot,
  type EstadoBot,
} from "./conversacion";

// ============================================================
// B9.2 — máquina de estados + parsers de la conversación del bot (PURO, sin DB/red).
// El troquelado es lo más frágil (§7.3: ~30% cae a texto): los parsers cubren los formatos reales.
// ============================================================

describe("parseComando", () => {
  it("extrae comando y argumento; ignora @NombreBot de grupos", () => {
    expect(parseComando("/nuevo")).toEqual({ comando: "nuevo", arg: "" });
    expect(parseComando("/vincular 123456")).toEqual({ comando: "vincular", arg: "123456" });
    expect(parseComando("/lote@HuayruroBot")).toEqual({ comando: "lote", arg: "" });
    expect(parseComando("hola")).toBeNull();
    expect(parseComando("  no /nuevo")).toBeNull();
  });
});

describe("parsePrecioSoles", () => {
  it("acepta punto y coma; rechaza basura y ≤0", () => {
    expect(parsePrecioSoles("1.50")).toBe(150);
    expect(parsePrecioSoles("1,50")).toBe(150);
    expect(parsePrecioSoles("12")).toBe(1200);
    expect(parsePrecioSoles("0")).toBeNull();
    expect(parsePrecioSoles("gratis")).toBeNull();
    expect(parsePrecioSoles("1.999")).toBeNull(); // 3 decimales
  });
});

describe("parseCantidad", () => {
  it("toma el primer entero ≥1", () => {
    expect(parseCantidad("50")).toBe(50);
    expect(parseCantidad("50 unidades")).toBe(50);
    expect(parseCantidad("dos")).toBeNull();
    expect(parseCantidad("0")).toBeNull();
  });
});

describe("parseBlister", () => {
  it("'no' → sin blíster; 'precio x unidades' → con blíster", () => {
    expect(parseBlister("no")).toEqual({ tipo: "no" });
    expect(parseBlister("n")).toEqual({ tipo: "no" });
    expect(parseBlister("12 x 10")).toEqual({ tipo: "si", precioCent: 1200, unidades: 10 });
    expect(parseBlister("12.50 × 10")).toEqual({ tipo: "si", precioCent: 1250, unidades: 10 });
    expect(parseBlister("s/12 x 10")).toEqual({ tipo: "si", precioCent: 1200, unidades: 10 });
    expect(parseBlister("hola")).toBeNull();
    expect(parseBlister("12 x 0")).toBeNull();
  });
});

describe("parseLoteVenc", () => {
  it("acepta separador '/' y espacio, y varios formatos de fecha", () => {
    expect(parseLoteVenc("A123 / 05-2027")).toEqual({ lote: "A123", vencimiento: "2027-05-01" });
    expect(parseLoteVenc("A123 05/2027")).toEqual({ lote: "A123", vencimiento: "2027-05-01" });
    expect(parseLoteVenc("LOTE B45 VENCE 12/2026")).toEqual({ lote: "B45", vencimiento: "2026-12-01" });
    expect(parseLoteVenc("C7 05-27")).toEqual({ lote: "C7", vencimiento: "2027-05-01" }); // año de 2 dígitos
    expect(parseLoteVenc("L9 / 08-2027")).toEqual({ lote: "L9", vencimiento: "2027-08-01" }); // no comerse la "L" del lote
    expect(parseLoteVenc("2027-05 lote AB9")).toEqual({ lote: "AB9", vencimiento: "2027-05-01" }); // ISO AAAA-MM
  });
  it("rechaza mes inválido, sin fecha o sin lote", () => {
    expect(parseLoteVenc("A123 / 13-2027")).toBeNull(); // mes 13
    expect(parseLoteVenc("A123")).toBeNull(); // sin fecha
    expect(parseLoteVenc("05-2027")).toBeNull(); // sin lote
  });
});

describe("resumenBorrador", () => {
  it("incluye blíster solo si está presente", () => {
    const base: BorradorBot = { producto_texto: "IBUPROFENO 400", lote: "A1", vencimiento: "2027-05-01", precio_unidad_cent: 150, cantidad: 50, ubicacion: "estante 3" };
    expect(resumenBorrador(base)).not.toMatch(/Blíster/);
    expect(resumenBorrador({ ...base, precio_blister_cent: 1200, unidades_por_blister: 10 })).toMatch(/Blíster: S\/ 12\.00 × 10/);
  });
});

// ── Máquina de estados: recorrido feliz completo (texto) ──────────────────────────
describe("avanzar — flujo feliz por texto", () => {
  it("inicio → /nuevo → producto → … → resumen → enviar crea borrador", () => {
    let estado: EstadoBot = "inicio";
    let borrador: BorradorBot = {};
    const paso = (e: Parameters<typeof avanzar>[2]) => {
      const t = avanzar(estado, borrador, e);
      estado = t.estado;
      borrador = t.borrador;
      return t;
    };

    expect(paso({ tipo: "texto", texto: "/nuevo" }).estado).toBe("producto");
    let t = paso({ tipo: "texto", texto: "Ibuprofeno 400mg Genfar" });
    expect(t.estado).toBe("producto_ok");
    expect(t.respuesta?.botones).toBeTruthy();

    t = paso({ tipo: "callback", data: CB.ok });
    expect(t.estado).toBe("lote");
    expect(t.enriquecerProducto).toBe(true); // el orquestador cruza contra el maestro aquí

    expect(paso({ tipo: "texto", texto: "A123 / 05-2027" }).estado).toBe("lote_ok");
    expect(paso({ tipo: "callback", data: CB.ok }).estado).toBe("precio");
    expect(paso({ tipo: "texto", texto: "1.50" }).estado).toBe("blister");
    expect(paso({ tipo: "texto", texto: "12 x 10" }).estado).toBe("cantidad");
    expect(paso({ tipo: "texto", texto: "50" }).estado).toBe("ubicacion");
    t = paso({ tipo: "texto", texto: "estante 3" });
    expect(t.estado).toBe("resumen");

    const fin = paso({ tipo: "callback", data: CB.enviar });
    expect(fin.accion).toBe("crear_borrador");
    expect(fin.estado).toBe("inicio");
    // El borrador acumulado quedó completo y en enteros.
    expect(borrador).toMatchObject({
      producto_texto: "Ibuprofeno 400mg Genfar",
      lote: "A123",
      vencimiento: "2027-05-01",
      precio_unidad_cent: 150,
      precio_blister_cent: 1200,
      unidades_por_blister: 10,
      cantidad: 50,
      ubicacion: "estante 3",
    });
  });

  it("blíster 'no' deja el producto sin blíster y sigue a cantidad", () => {
    const t = avanzar("blister", { producto_texto: "X", precio_unidad_cent: 100 }, { tipo: "texto", texto: "no" });
    expect(t.estado).toBe("cantidad");
    expect(t.borrador.precio_blister_cent).toBeUndefined();
  });
});

// ── Correcciones, comandos globales y descarte ────────────────────────────────────
describe("avanzar — correcciones y comandos globales", () => {
  it("✏️ Corregir el producto vuelve a pedir el nombre", () => {
    const t = avanzar("producto_ok", { producto_texto: "malo" }, { tipo: "callback", data: CB.editar });
    expect(t.estado).toBe("producto");
  });

  it("escribir en un paso de botón se toma como corrección del dato", () => {
    const t = avanzar("lote_ok", { lote: "A1", vencimiento: "2026-01-01" }, { tipo: "texto", texto: "B2 / 06-2028" });
    expect(t.estado).toBe("lote_ok");
    expect(t.borrador.lote).toBe("B2");
    expect(t.borrador.vencimiento).toBe("2028-06-01");
  });

  it("/cancelar en cualquier estado resetea a inicio", () => {
    const t = avanzar("precio", { producto_texto: "X" }, { tipo: "texto", texto: "/cancelar" });
    expect(t.estado).toBe("inicio");
    expect(t.borrador).toEqual({});
  });

  it("/lote sin producto previo pide /nuevo; con producto previo salta a lote", () => {
    expect(avanzar("inicio", {}, { tipo: "texto", texto: "/lote" }).estado).toBe("inicio");
    const t = avanzar("inicio", {}, { tipo: "texto", texto: "/lote" }, { ultimoProducto: { producto_texto: "IBU 400", gtin: "7750100000015" } });
    expect(t.estado).toBe("lote");
    expect(t.borrador.producto_texto).toBe("IBU 400");
    expect(t.borrador.gtin).toBe("7750100000015");
  });

  it("descartar en el resumen limpia el borrador", () => {
    const t = avanzar("resumen", { producto_texto: "X", cantidad: 5 }, { tipo: "callback", data: CB.descartar });
    expect(t.accion).toBe("descartar");
    expect(t.borrador).toEqual({});
  });

  it("entrada inválida en un paso de dato reprompt sin avanzar", () => {
    const t = avanzar("precio", { producto_texto: "X" }, { tipo: "texto", texto: "carísimo" });
    expect(t.estado).toBe("precio");
    expect(t.respuesta?.texto).toMatch(/precio/i);
  });
});
