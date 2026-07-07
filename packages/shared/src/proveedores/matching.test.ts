import { describe, expect, it } from "vitest";
import { normalizarNombre } from "../catalogo/normalizar";
import {
  indexarProducto,
  matchearOferta,
  puntajeOferta,
  tokenizar,
  UMBRAL_MATCH_AUTO,
  UMBRAL_MATCH_PENDIENTE,
  type IndicesMatch,
  type OfertaParaMatch,
} from "./matching";

// Catálogo del tenant (perfiles indexados una vez).
const IBUPROFENO = indexarProducto({ producto_id: "p-ibu", nombre: "Ibuprofeno 400 mg", dci: "Ibuprofeno", laboratorio: "Genfar" });
const PARACETAMOL = indexarProducto({ producto_id: "p-para", nombre: "Paracetamol 500 mg", dci: "Paracetamol", laboratorio: "Portugal" });
const AMOXI = indexarProducto({ producto_id: "p-amox", nombre: "Amoxicilina 500 mg", dci: "Amoxicilina", laboratorio: "Genfar" });
const ALCOHOL = indexarProducto({ producto_id: "p-alc", nombre: "Alcohol 70", dci: null, laboratorio: null });

const PRODUCTOS = [IBUPROFENO, PARACETAMOL, AMOXI, ALCOHOL];

function oferta(textoOriginal: string, gtin: string | null = null): OfertaParaMatch {
  return { gtin, texto_original: textoOriginal, texto_norm: normalizarNombre(textoOriginal) };
}
function indices(over: Partial<IndicesMatch> = {}): IndicesMatch {
  return { productos: PRODUCTOS, gtinAProducto: new Map(), aliasAProducto: new Map(), ...over };
}

describe("tokenizar", () => {
  it("separa concentración de identidad y quita ruido de empaque", () => {
    const t = tokenizar("IBUPROFENO 400MG TAB CAJA X 100 GENFAR");
    expect([...t.alpha].sort()).toEqual(["genfar", "ibuprofeno"]); // tab/caja/x/100 fuera
    expect([...t.conc]).toEqual(["400mg"]);
  });
  it("normaliza unidades (gr→g, ml, lt→l) y no confunde el factor de caja", () => {
    expect([...tokenizar("PARACETAMOL 500 GR").conc]).toEqual(["500g"]);
    expect([...tokenizar("JARABE X 120 ML").conc]).toEqual(["120ml"]);
    expect([...tokenizar("CAJA X 100 TAB").conc]).toEqual([]); // 100 es factor, no concentración
  });
});

describe("puntajeOferta", () => {
  it("oferta verbosa con lab correcto → 1.0 (auto)", () => {
    expect(puntajeOferta(tokenizar("IBUPROFENO 400MG TAB CAJA X 100 GENFAR"), IBUPROFENO)).toBeCloseTo(1.0, 5);
  });
  it("misma droga, distinta dosis → guarda de concentración lo acota a manual", () => {
    expect(puntajeOferta(tokenizar("IBUPROFENO 600 MG TAB"), IBUPROFENO)).toBeCloseTo(0.55, 5);
  });
  it("misma droga con forma/lab extra (suspensión de otro lab) → banda pendiente", () => {
    const s = puntajeOferta(tokenizar("AMOXICILINA 500 MG SUSPENSION FCO 60 ML MEDIFARMA"), AMOXI);
    expect(s).toBeCloseTo(0.7333, 3);
    expect(s).toBeGreaterThanOrEqual(UMBRAL_MATCH_PENDIENTE);
    expect(s).toBeLessThan(UMBRAL_MATCH_AUTO);
  });
  it("droga distinta → puntaje bajo (manual)", () => {
    expect(puntajeOferta(tokenizar("PARACETAMOL 500 MG"), IBUPROFENO)).toBeLessThan(UMBRAL_MATCH_PENDIENTE);
  });
  it("producto sin identidad no puntúa", () => {
    const vacio = indexarProducto({ producto_id: "x", nombre: "500 mg", dci: null, laboratorio: null });
    expect(puntajeOferta(tokenizar("cualquier cosa"), vacio)).toBe(0);
  });
});

describe("matchearOferta — pipeline", () => {
  it("1) GTIN exacto → auto", () => {
    const idx = indices({ gtinAProducto: new Map([["7750100000015", "p-ibu"]]) });
    const r = matchearOferta(oferta("cualquier descripcion", "7750100000015"), idx);
    expect(r).toMatchObject({ metodo: "gtin", producto_id: "p-ibu", estado: "auto", score: 1.0 });
  });

  it("2) Alias aprendido → auto (aunque el nombre no se parezca)", () => {
    const idx = indices({ aliasAProducto: new Map([[normalizarNombre("IBU GENFAR CJ100"), "p-ibu"]]) });
    const r = matchearOferta(oferta("IBU GENFAR CJ100"), idx);
    expect(r).toMatchObject({ metodo: "alias", producto_id: "p-ibu", estado: "auto" });
  });

  it("3) Nombre normalizado exacto → auto (0.95)", () => {
    const r = matchearOferta(oferta("Ibuprofeno 400 mg"), indices());
    expect(r).toMatchObject({ metodo: "nombre_exacto", producto_id: "p-ibu", estado: "auto", score: 0.95 });
  });

  it("4a) Fuzzy ≥0.90 → auto", () => {
    const r = matchearOferta(oferta("IBUPROFENO 400MG TAB CAJA X 100 GENFAR"), indices());
    expect(r).toMatchObject({ metodo: "fuzzy", producto_id: "p-ibu", estado: "auto" });
    expect(r.score).toBeGreaterThanOrEqual(UMBRAL_MATCH_AUTO);
  });

  it("4b) Fuzzy 0.60–0.89 → pendiente con sugerencias top-3", () => {
    const r = matchearOferta(oferta("AMOXICILINA 500 MG SUSPENSION FCO 60 ML MEDIFARMA"), indices());
    expect(r.estado).toBe("pendiente");
    expect(r.metodo).toBe("fuzzy");
    expect(r.producto_id).toBe("p-amox");
    expect(r.sugerencias[0]!.producto_id).toBe("p-amox");
    expect(r.sugerencias.length).toBeLessThanOrEqual(3);
  });

  it("4c) <0.60 → manual (sin producto asignado)", () => {
    const r = matchearOferta(oferta("GASA ESTERIL 10X10 CM"), indices());
    expect(r.estado).toBe("pendiente");
    expect(r.producto_id).toBeNull();
    expect(r.metodo).toBeNull();
  });

  it("concentración distinta NO se auto-matchea (400 vs 600)", () => {
    const r = matchearOferta(oferta("IBUPROFENO 600 MG TABLETA CAJA X 100"), indices());
    expect(r.producto_id).toBeNull(); // 0.55 < 0.60
  });

  it("el orden manda: GTIN gana sobre un nombre que apuntaría a otro", () => {
    const idx = indices({ gtinAProducto: new Map([["7750100000015", "p-para"]]) });
    const r = matchearOferta(oferta("IBUPROFENO 400 MG", "7750100000015"), idx);
    expect(r.metodo).toBe("gtin");
    expect(r.producto_id).toBe("p-para");
  });
});
