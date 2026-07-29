import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbLocal, type ColaOp, type ReglaLocal } from "./db-local";
import { useSugerencia } from "./useSugerencia";
import type { ProductoVenta } from "./tipos";

// El flusher sale a la red; acá interesa QUÉ quedó en la cola, no que se haya enviado.
vi.mock("./useSyncPos", () => ({ flushAhora: vi.fn() }));

// ============================================================
// A4 — Lo que el motor puro (packages/shared) no puede probar: el tope de UNA sugerencia por venta
// a lo largo de varios productos, y que lo que pasó con la tarjeta termine en la cola offline
// enganchado a la venta correcta.
// ============================================================

const OME = "p-omeprazol";

const REGLA: ReglaLocal = {
  id: "r1",
  disparador_tipo: "principio_activo",
  disparador_valor: "Ibuprofeno",
  sugerido_producto_id: OME,
  guion: "Si lo va a tomar más de dos días, un protector le cuida el estómago.",
  prioridad: 10,
};

const REGLA_2: ReglaLocal = { ...REGLA, id: "r2", disparador_valor: "Amoxicilina", prioridad: 5 };

const omeprazol: ProductoVenta = {
  producto_id: OME,
  nombre: "Omeprazol 20 mg",
  presentacion_texto: "Cápsula unidad",
  laboratorio: null,
  principio_activo: "Omeprazol 20 mg",
  categoria: "Antiulceroso",
  requiere_receta: false,
  presentacion_id: "pres-ome",
  presentacion_nombre: "unidad",
  factor: 1,
  precio_sin_igv_dm: 10169,
  precio_total_dm: 12000,
  stock_cache: 40,
  gtin: null,
};

const ibuprofeno = { producto_id: "p-ibu", categoria: "Antiinflamatorio", principio_activo: "Ibuprofeno 400 mg" };
const amoxicilina = { producto_id: "p-amoxi", categoria: "Antibiótico", principio_activo: "Amoxicilina 500 mg" };

const resolver = (id: string) => (id === OME ? omeprazol : null);
const stock = { [OME]: 40 };

const opsDeSugerencia = async (): Promise<ColaOp[]> => (await dbLocal.cola_ops.toArray()).filter((o) => o.tipo === "sugerencia");
const payload = (op: ColaOp) =>
  op.payload as { eventos: { id: string; regla_id: string; resultado: string }[]; venta_client_uuid: string | null };

beforeEach(async () => {
  await dbLocal.cola_ops.clear();
  await dbLocal.reglas.clear();
  await dbLocal.reglas.bulkPut([REGLA, REGLA_2]);
});

async function montar() {
  const h = renderHook(() => useSugerencia(true));
  await waitFor(() => expect(h.result.current.hayReglas).toBe(true));
  return h;
}

describe("useSugerencia — el tope del veto §2 A4", () => {
  it("muestra UNA tarjeta y no vuelve a aparecer aunque entren más productos que disparan reglas", async () => {
    const { result } = await montar();

    act(() => result.current.evaluar(ibuprofeno, ["p-ibu"], stock, resolver));
    expect(result.current.viva?.reglaId).toBe("r1");

    // Se descarta y entra otro producto que también tiene regla: el cupo de la venta ya se usó.
    act(() => result.current.responder("rechazada"));
    expect(result.current.viva).toBeNull();
    act(() => result.current.evaluar(amoxicilina, ["p-ibu", "p-amoxi"], stock, resolver));
    expect(result.current.viva).toBeNull();
  });

  it("el cupo se renueva recién al cerrar la atención", async () => {
    const { result } = await montar();
    act(() => result.current.evaluar(ibuprofeno, ["p-ibu"], stock, resolver));
    await act(async () => await result.current.cerrar(null));

    act(() => result.current.evaluar(amoxicilina, ["p-amoxi"], stock, resolver));
    expect(result.current.viva?.reglaId).toBe("r2");
  });

  it("sin producto vendible en esta botica no hay tarjeta (aunque la regla dispare)", async () => {
    const { result } = await montar();
    act(() => result.current.evaluar(ibuprofeno, ["p-ibu"], stock, () => null));
    expect(result.current.viva).toBeNull();
    // Y como no se mostró nada, no hay nada que reportar.
    await act(async () => await result.current.cerrar(null));
    expect(await opsDeSugerencia()).toHaveLength(0);
  });
});

describe("useSugerencia — lo que llega a la cola", () => {
  it("mostrada + aceptada viajan JUNTAS, enganchadas al client_uuid de la venta", async () => {
    const { result } = await montar();
    act(() => result.current.evaluar(ibuprofeno, ["p-ibu"], stock, resolver));
    act(() => result.current.responder("aceptada"));
    await act(async () => await result.current.cerrar("cu-venta-1"));

    const ops = await opsDeSugerencia();
    expect(ops).toHaveLength(1);
    const p = payload(ops[0]!);
    expect(p.venta_client_uuid).toBe("cu-venta-1");
    expect(p.eventos.map((e) => e.resultado)).toEqual(["mostrada", "aceptada"]);
    expect(p.eventos.every((e) => e.regla_id === "r1")).toBe(true);
  });

  it("la atención que termina SIN venta igual reporta: si no, la conversión saldría inflada", async () => {
    const { result } = await montar();
    act(() => result.current.evaluar(ibuprofeno, ["p-ibu"], stock, resolver));
    act(() => result.current.responder("rechazada"));
    await act(async () => await result.current.cerrar(null));

    const p = payload((await opsDeSugerencia())[0]!);
    expect(p.venta_client_uuid).toBeNull();
    expect(p.eventos.map((e) => e.resultado)).toEqual(["mostrada", "rechazada"]);
  });

  it("una tarjeta mostrada que nadie tocó cuenta como mostrada (y solo eso)", async () => {
    const { result } = await montar();
    act(() => result.current.evaluar(ibuprofeno, ["p-ibu"], stock, resolver));
    await act(async () => await result.current.cerrar("cu-venta-2"));

    const p = payload((await opsDeSugerencia())[0]!);
    expect(p.eventos.map((e) => e.resultado)).toEqual(["mostrada"]);
  });

  it("cerrar una atención sin sugerencias NO encola una op vacía", async () => {
    const { result } = await montar();
    await act(async () => await result.current.cerrar("cu-venta-3"));
    expect(await opsDeSugerencia()).toHaveLength(0);
  });

  it("cada evento lleva su propio id: es la llave con la que el server no duplica al reintentar", async () => {
    const { result } = await montar();
    act(() => result.current.evaluar(ibuprofeno, ["p-ibu"], stock, resolver));
    act(() => result.current.responder("aceptada"));
    await act(async () => await result.current.cerrar("cu-venta-4"));

    const eventos = payload((await opsDeSugerencia())[0]!).eventos.map((e) => e.id);
    expect(new Set(eventos).size).toBe(2);
    expect(eventos.every((id) => typeof id === "string" && id.length > 10)).toBe(true);
  });

  it("apagado (sin sucursal) el motor no evalúa nada", async () => {
    const { result } = renderHook(() => useSugerencia(false));
    act(() => result.current.evaluar(ibuprofeno, ["p-ibu"], stock, resolver));
    expect(result.current.viva).toBeNull();
  });
});
