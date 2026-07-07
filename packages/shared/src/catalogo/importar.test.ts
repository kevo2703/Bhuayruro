import { describe, expect, it } from "vitest";
import { ErrorImportacion, PLANTILLA_CSV, validarCatalogoCsv } from "./importar";

const CAB =
  "nombre,codigo_barras,laboratorio,principio_activo,categoria,presentacion_texto,requiere_receta,es_cronico,precio_compra,precio_venta,stock_inicial,stock_minimo,numero_lote,fecha_vencimiento,blister_nombre,blister_factor,blister_precio_venta,blister_codigo_barras";

describe("validarCatalogoCsv — estructura", () => {
  it("archivo vacío lanza ErrorImportacion", () => {
    expect(() => validarCatalogoCsv("")).toThrow(ErrorImportacion);
  });
  it("solo cabecera (sin datos) lanza", () => {
    expect(() => validarCatalogoCsv(CAB)).toThrow(/sin filas de datos/);
  });
  it("falta columna obligatoria nombre", () => {
    expect(() => validarCatalogoCsv("precio_venta\n1.50")).toThrow(/nombre/);
  });
  it("falta columna obligatoria precio_venta", () => {
    expect(() => validarCatalogoCsv("nombre\nParacetamol")).toThrow(/precio_venta/);
  });
});

describe("validarCatalogoCsv — mapeo y dinero", () => {
  it("fila completa con blíster + lote mapea todo y convierte el precio (PVP con IGV → sin_igv)", () => {
    const csv = `${CAB}\nIbuprofeno 400 mg,7791111100001,Genfar,Ibuprofeno 400 mg,Antiinflamatorio,Tableta,no,no,0.90,1.80,100,20,L-2405,2027-03-31,Blíster x10,10,17.00,7791111100018`;
    const r = validarCatalogoCsv(csv);
    expect(r.rechazadas).toHaveLength(0);
    expect(r.validas).toHaveLength(1);
    const p = r.validas[0]!;
    expect(p.nombre).toBe("Ibuprofeno 400 mg");
    expect(p.gtin).toBe("7791111100001");
    expect(p.precioVentaPublicaDm).toBe(18000); // 1.80 soles
    expect(p.precioSinIgvDm).toBe(15254); // = seed Ibuprofeno
    expect(p.precioCompraDm).toBe(9000); // 0.90 soles
    expect(p.stockInicial).toBe(100);
    expect(p.stockMinimo).toBe(20);
    expect(p.lote).toEqual({ numero: "L-2405", vencimiento: "2027-03-31" });
    expect(p.blister?.factor).toBe(10);
    expect(p.blister?.gtin).toBe("7791111100018");
    expect(p.blister?.precioVentaPublicaDm).toBe(170000); // 17.00
    expect(p.blister?.precioSinIgvDm).toBe(144068); // round(1700000/118... 17.00 con IGV)
    expect(r.resumen).toMatchObject({ filas: 1, validas: 1, con_lote: 1, con_blister: 1 });
  });

  it("fila mínima (solo nombre + precio) usa defaults (stock 0, min 0, receta 0, sin lote/blíster)", () => {
    const r = validarCatalogoCsv("nombre,precio_venta\nAgua oxigenada,3.00");
    expect(r.validas).toHaveLength(1);
    const p = r.validas[0]!;
    expect(p.stockInicial).toBe(0);
    expect(p.stockMinimo).toBe(0);
    expect(p.requiereReceta).toBe(0);
    expect(p.gtin).toBeNull();
    expect(p.lote).toBeNull();
    expect(p.blister).toBeNull();
    expect(p.precioSinIgvDm).toBe(25424); // 3.00 → = seed Amoxicilina
  });

  it("delimitador ';' con decimales por coma (Excel es-PE)", () => {
    const csv = "nombre;precio_venta;stock_inicial\nParacetamol;1,50;200";
    const r = validarCatalogoCsv(csv);
    expect(r.delimitador).toBe(";");
    expect(r.validas[0]!.precioVentaPublicaDm).toBe(15000); // 1.50
    expect(r.validas[0]!.stockInicial).toBe(200);
  });

  it("cabeceras con sinónimos y tildes se reconocen", () => {
    const csv = "Producto,Precio,Categoría,Mínimo\nSildex,5.00,Genérico,10";
    const r = validarCatalogoCsv(csv);
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]!.categoria).toBe("Genérico");
    expect(r.validas[0]!.stockMinimo).toBe(10);
    expect(r.validas[0]!.precioSinIgvDm).toBe(42373); // 5.00 = seed Sildex
  });

  it("acepta fecha DD/MM/AAAA y la normaliza", () => {
    const csv = `${CAB}\nX,,,,,,,,,2.00,50,0,L1,31/12/2027,,,,`;
    const r = validarCatalogoCsv(csv);
    expect(r.validas[0]!.lote).toEqual({ numero: "L1", vencimiento: "2027-12-31" });
  });
});

describe("validarCatalogoCsv — rechazos", () => {
  const fila = (over: string) => `${CAB}\n${over}`;
  it("precio inválido, negativo, cero", () => {
    const r = validarCatalogoCsv(
      `${CAB}\nA,,,,,,,,,abc,,,,,,,,\nB,,,,,,,,,0,,,,,,,,\nC,,,,,,,,,-5,,,,,,,,`,
    );
    expect(r.validas).toHaveLength(0);
    expect(r.rechazadas).toHaveLength(3);
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/precio_venta inválido/);
    expect(r.rechazadas[1]!.motivos.join()).toMatch(/mayor a 0/);
  });
  it("stock no entero rechaza", () => {
    const r = validarCatalogoCsv(fila("A,,,,,,,,,2.00,10.5,,,,,,,"));
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/stock_inicial inválido/);
  });
  it("lote a medias rechaza (número sin fecha)", () => {
    const r = validarCatalogoCsv(fila("A,,,,,,,,,2.00,50,,L1,,,,,"));
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/lote requiere/);
  });
  it("fecha inválida rechaza", () => {
    const r = validarCatalogoCsv(fila("A,,,,,,,,,2.00,50,0,L1,2026-02-31,,,,"));
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/fecha_vencimiento inválida/);
  });
  it("blíster factor <2 rechaza", () => {
    const r = validarCatalogoCsv(fila("A,,,,,,,,,2.00,,,,,Blister,1,,"));
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/blister_factor debe ser/);
  });
  it("blíster a medias (nombre sin factor) rechaza", () => {
    const r = validarCatalogoCsv(fila("A,,,,,,,,,2.00,,,,,Blister,,,"));
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/blíster requiere/);
  });
  it("nombre vacío rechaza", () => {
    const r = validarCatalogoCsv(fila(",,,,,,,,,2.00,,,,,,,,"));
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/nombre vacío/);
  });
});

describe("validarCatalogoCsv — advertencias", () => {
  it("requiere_receta no reconocido → advertencia + default No", () => {
    const r = validarCatalogoCsv(`${CAB}\nA,,,,,,quizas,,,2.00,,,,,,,,`);
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]!.requiereReceta).toBe(0);
    expect(r.advertencias.some((a) => /requiere_receta/.test(a.texto))).toBe(true);
  });
  it("lote con stock 0 → producto sin lote + advertencia", () => {
    const r = validarCatalogoCsv(`${CAB}\nA,,,,,,,,,2.00,0,,L1,2027-01-01,,,,`);
    expect(r.validas[0]!.lote).toBeNull();
    expect(r.advertencias.some((a) => /sin stock/.test(a.texto))).toBe(true);
  });
  it("lote vencido (con hoy) → advertencia pero se importa", () => {
    const r = validarCatalogoCsv(`${CAB}\nA,,,,,,,,,2.00,10,,L1,2020-01-01,,,,`, { hoy: "2026-07-06" });
    expect(r.validas[0]!.lote?.vencimiento).toBe("2020-01-01");
    expect(r.advertencias.some((a) => /vencido/.test(a.texto))).toBe(true);
  });
});

describe("validarCatalogoCsv — dedup de códigos de barras dentro del archivo", () => {
  it("GTIN base repetido: 2da fila rechazada", () => {
    const csv = `nombre,codigo_barras,precio_venta\nA,111,2.00\nB,111,3.00`;
    const r = validarCatalogoCsv(csv);
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]!.nombre).toBe("A");
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/repetido.*fila 1/);
  });
  it("GTIN base de una fila == GTIN blíster de otra: choca", () => {
    const csv = `${CAB}\nA,999,,,,,,,,2.00,,,,,,,,\nB,,,,,,,,,3.00,,,,,Blister,10,,999`;
    const r = validarCatalogoCsv(csv);
    expect(r.validas).toHaveLength(1); // A sobrevive; B choca por su GTIN de blíster
    expect(r.rechazadas.some((x) => x.nombre === "B")).toBe(true);
  });
});

describe("validarCatalogoCsv — endurecimiento (hallazgos adversariales)", () => {
  const fila = (over: string) => `${CAB}\n${over}`;

  it("F1: precio enorme se RECHAZA (no desborda ni tumba el lote)", () => {
    const r = validarCatalogoCsv(`${CAB}\nBueno,,,,,,,,,2.00,,,,,,,,\nMalo,,,,,,,,,90071992547.0000,,,,,,,,`);
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]!.nombre).toBe("Bueno");
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/demasiado alto/);
  });

  it("F2: precio con coma de miles '1,200' se RECHAZA como ambiguo (no lo toma como 1.20)", () => {
    const r = validarCatalogoCsv(fila("A,,,,,,,,,\"1,200\",,,,,,,,"));
    expect(r.validas).toHaveLength(0);
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/precio_venta inválido/);
  });

  it("F2: coma decimal legítima '12,50' sí funciona (2 dígitos)", () => {
    const r = validarCatalogoCsv("nombre;precio_venta\nA;12,50");
    expect(r.validas[0]!.precioVentaPublicaDm).toBe(125000);
  });

  it("F4: comillas sin cerrar lanzan error estructural (no import silencioso truncado)", () => {
    const csv = 'nombre,precio_venta\n"Alcohol sin cerrar,2.00\nOtro,3.00';
    expect(() => validarCatalogoCsv(csv)).toThrow(/comillas sin cerrar/);
  });

  it("F5: columna duplicada (dos 'precio') se reporta como ignorada; gana la primera", () => {
    const r = validarCatalogoCsv("nombre,precio,precio\nA,5.00,999.00");
    expect(r.columnasIgnoradas.join()).toMatch(/repetida de "precio_venta"/);
    expect(r.validas[0]!.precioVentaPublicaDm).toBe(50000); // 5.00, la primera
  });

  it("F6: dos filas SIN código con el mismo nombre → la 2da se rechaza (dedup por nombre)", () => {
    const r = validarCatalogoCsv("nombre,precio_venta\nParacetamol 500,1.50\nPARACETAMOL  500,2.00");
    expect(r.validas).toHaveLength(1);
    expect(r.rechazadas[0]!.motivos.join()).toMatch(/sin código repetido/);
    expect(r.resumen.sin_codigo).toBe(1);
  });
});

describe("PLANTILLA_CSV", () => {
  it("la plantilla es válida y sus 2 ejemplos pasan", () => {
    const r = validarCatalogoCsv(PLANTILLA_CSV);
    expect(r.rechazadas).toHaveLength(0);
    expect(r.validas).toHaveLength(2);
    expect(r.validas[0]!.blister?.factor).toBe(10);
  });
});
