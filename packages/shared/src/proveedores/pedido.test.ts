import { describe, expect, it } from "vitest";
import {
  compararPedido,
  precioEfectivoUnidadDm,
  renglonCent,
  unidadesProveedor,
  type Necesidad,
  type OfertaComparable,
  type ProveedorComparable,
} from "./pedido";

describe("precio efectivo por unidad base (D-N2, enteros)", () => {
  it("caja x100 a S/38 con bonif 10+1 → S/0.3455/unidad", () => {
    expect(precioEfectivoUnidadDm(3800, 100, 10, 1)).toBe(3455); // round(3800*100*10 / (11*100))
  });
  it("blíster x10 a S/4.00 sin bonif → S/0.40/unidad (más caro que la caja pese al menor precio)", () => {
    expect(precioEfectivoUnidadDm(400, 10, null, null)).toBe(4000);
  });
  it("sin bonif es precio_cent×100/factor exacto", () => {
    expect(precioEfectivoUnidadDm(3000, 100, null, null)).toBe(3000);
  });
});

describe("renglón y cantidades", () => {
  it("redondea la cantidad hacia arriba a la unidad del proveedor", () => {
    expect(unidadesProveedor(200, 100)).toBe(2);
    expect(unidadesProveedor(101, 100)).toBe(2);
    expect(unidadesProveedor(100, 100)).toBe(1);
  });
  it("renglón con bonif 10+1 descuenta proporcionalmente", () => {
    expect(renglonCent(3800, 2, 10, 1)).toBe(6909); // round(3800*10*2 / 11)
  });
  it("renglón sin bonif = precio_cent × unidades", () => {
    expect(renglonCent(3000, 3, null, null)).toBe(9000);
  });
});

// ---- GOLDEN del comparador (combo óptimo calculado A MANO) ----
// 3 proveedores con mínimos y fletes distintos; 3 necesidades; caja×100 vs blíster×10; bonif 10+1;
// una oferta de venc. corto (C·P3) que NO se auto-elige salvo aceptación explícita.
const PROVS: ProveedorComparable[] = [
  { id: "A", nombre: "Droguería A", monto_minimo_cent: 50000, flete_cent: 2500 },
  { id: "B", nombre: "Droguería B", monto_minimo_cent: 80000, flete_cent: 4000 },
  { id: "C", nombre: "Droguería C", monto_minimo_cent: 30000, flete_cent: 1500 },
];
const NEC: Necesidad[] = [
  { producto_id: "P1", nombre: "Ibuprofeno 400", unidades_base: 1000 },
  { producto_id: "P2", nombre: "Paracetamol 500", unidades_base: 1000 },
  { producto_id: "P3", nombre: "Amoxicilina 500", unidades_base: 500 },
];
const li = (n: string) => `li-${n}`;
const OFERTAS: OfertaComparable[] = [
  // Proveedor A: caja×100; P1 con bonif 10+1 (más barato del sistema para P1)
  { lista_item_id: li("a1"), producto_id: "P1", proveedor_id: "A", precio_cent: 3800, factor_unidades: 100, bonif_compra: 10, bonif_gratis: 1, venc_corto: 0, vencimiento: null },
  { lista_item_id: li("a2"), producto_id: "P2", proveedor_id: "A", precio_cent: 3000, factor_unidades: 100, bonif_compra: null, bonif_gratis: null, venc_corto: 0, vencimiento: null },
  { lista_item_id: li("a3"), producto_id: "P3", proveedor_id: "A", precio_cent: 9000, factor_unidades: 100, bonif_compra: null, bonif_gratis: null, venc_corto: 0, vencimiento: null },
  // Proveedor B: blíster×10 (unidad chica); P3 más barato que A pero caro por unidad en P1/P2
  { lista_item_id: li("b1"), producto_id: "P1", proveedor_id: "B", precio_cent: 400, factor_unidades: 10, bonif_compra: null, bonif_gratis: null, venc_corto: 0, vencimiento: null },
  { lista_item_id: li("b2"), producto_id: "P2", proveedor_id: "B", precio_cent: 320, factor_unidades: 10, bonif_compra: null, bonif_gratis: null, venc_corto: 0, vencimiento: null },
  { lista_item_id: li("b3"), producto_id: "P3", proveedor_id: "B", precio_cent: 8500, factor_unidades: 100, bonif_compra: null, bonif_gratis: null, venc_corto: 0, vencimiento: null },
  // Proveedor C: P1 caro; P3 el MÁS barato pero venc. corto (no auto salvo aceptación); sin P2
  { lista_item_id: li("c1"), producto_id: "P1", proveedor_id: "C", precio_cent: 3600, factor_unidades: 100, bonif_compra: null, bonif_gratis: null, venc_corto: 0, vencimiento: null },
  { lista_item_id: li("c3"), producto_id: "P3", proveedor_id: "C", precio_cent: 8000, factor_unidades: 100, bonif_compra: null, bonif_gratis: null, venc_corto: 1, vencimiento: "2026-10-01" },
];

describe("compararPedido — golden", () => {
  it("SIN aceptar venc. corto: gana {A} solo (cubre todo, único que llega a su mínimo)", () => {
    const r = compararPedido(NEC, OFERTAS, PROVS);
    const top = r.top3[0]!;
    expect(top.proveedor_ids).toEqual(["A"]);
    expect(top.cobertura).toBe(1);
    expect(top.valido).toBe(true);
    // A: P1 round(3800*10*10/11)=34545 · P2 3000*10=30000 · P3 9000*5=45000 = 109545; +flete 2500
    expect(top.total_cent).toBe(112045);
    const a = top.proveedores[0]!;
    expect(a.subtotal_cent).toBe(109545);
    const p3 = a.renglones.find((x) => x.producto_id === "P3")!;
    expect(p3.unidades_prov).toBe(5);
    expect(p3.renglon_cent).toBe(45000);
    // el combo {A,B} existe pero es inválido (B no llega a su mínimo de S/800)
    const ab = r.combos.find((c) => c.proveedor_ids.join() === "A,B");
    expect(ab?.valido).toBe(false);
  });

  it("comparación por unidad base (D-N1): P1 lo gana la caja×100 de A, no el blíster×10 de B", () => {
    const r = compararPedido(NEC, OFERTAS, PROVS);
    const a = r.top3[0]!.proveedores[0]!;
    const p1 = a.renglones.find((x) => x.producto_id === "P1")!;
    expect(p1.precio_unidad_dm).toBe(3455); // < 4000 de B
    expect(p1.renglon_cent).toBe(34545);
  });

  it("ACEPTANDO venc. corto de P3: gana {A,C} y ahorra S/35 vs {A}", () => {
    const r = compararPedido(NEC, OFERTAS, PROVS, { aceptarVencCorto: new Set(["P3"]) });
    const top = r.top3[0]!;
    expect(top.proveedor_ids).toEqual(["A", "C"]);
    expect(top.valido).toBe(true);
    // A: P1 34545 + P2 30000 = 64545 (+flete 2500). C: P3 8000*5=40000 (+flete 1500). Total 108545.
    expect(top.total_cent).toBe(108545);
    const c = top.proveedores.find((p) => p.id === "C")!;
    expect(c.subtotal_cent).toBe(40000);
    expect(c.cumple_minimo).toBe(true);
    // segundo lugar = {A} a 112045 → delta +3500 (S/35)
    const soloA = r.top3.find((t) => t.proveedor_ids.join() === "A")!;
    expect(soloA.delta_cent).toBe(3500);
  });

  it("producto sin oferta en ningún proveedor → sin_oferta", () => {
    const nec = [...NEC, { producto_id: "P9", nombre: "Gasa estéril", unidades_base: 50 }];
    const r = compararPedido(nec, OFERTAS, PROVS);
    expect(r.sin_oferta.map((s) => s.producto_id)).toEqual(["P9"]);
    expect(r.top3[0]!.cobertura).toBeCloseTo(3 / 4, 5);
  });
});
