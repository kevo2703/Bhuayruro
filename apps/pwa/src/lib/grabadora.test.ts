import { describe, expect, it } from "vitest";
import { elegirMime, esSilencio, planEviccion, rmsDeFloat32, UMBRAL_SILENCIO_RMS } from "./grabadora";

// Lógica pura de la grabadora del A10 (B10.1 §8): RMS/silencio + evicción FIFO de la cola.

describe("grabadora — RMS y silencio", () => {
  it("rmsDeFloat32: silencio ≈ 0, tono constante = su amplitud", () => {
    expect(rmsDeFloat32(new Float32Array([0, 0, 0, 0]))).toBe(0);
    expect(rmsDeFloat32(new Float32Array([]))).toBe(0);
    // RMS de [0.5,-0.5,0.5,-0.5] = 0.5
    expect(rmsDeFloat32(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 6);
  });

  it("esSilencio: por debajo del umbral = silencio; una voz normal no", () => {
    expect(esSilencio(0)).toBe(true);
    expect(esSilencio(UMBRAL_SILENCIO_RMS / 2)).toBe(true);
    expect(esSilencio(0.2)).toBe(false); // voz al mostrador
    expect(esSilencio(0.05, 0.1)).toBe(true); // umbral custom
  });
});

describe("grabadora — evicción FIFO (tope 200 MB)", () => {
  it("no borra nada si cabe", () => {
    expect(planEviccion([{ client_uuid: "a", bytes: 10 }], 10, 100)).toEqual([]);
  });

  it("borra los más VIEJOS (orden de la lista) hasta que el nuevo quepa", () => {
    const cola = [
      { client_uuid: "v1", bytes: 40 },
      { client_uuid: "v2", bytes: 40 },
      { client_uuid: "v3", bytes: 40 },
    ]; // 120 usados; tope 100; nuevo 30 → hay que bajar a ≤70
    expect(planEviccion(cola, 30, 100)).toEqual(["v1", "v2"]); // quedan v3(40)+nuevo(30)=70
  });

  it("si el nuevo es enorme, borra toda la cola vieja", () => {
    const cola = [{ client_uuid: "a", bytes: 50 }, { client_uuid: "b", bytes: 50 }];
    expect(planEviccion(cola, 200, 100)).toEqual(["a", "b"]);
  });
});

describe("grabadora — elección de MIME", () => {
  it("elige el primero soportado; si ninguno, cadena vacía (default del UA)", () => {
    expect(elegirMime((m) => m === "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    expect(elegirMime((m) => m === "audio/webm")).toBe("audio/webm");
    expect(elegirMime(() => false)).toBe("");
  });
});
