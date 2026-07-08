import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrabadoraDB, crearSubidorAudio, encolarChunk, flushAudioUnaVez, type ChunkAudio, type ResultadoChunk } from "./grabadora-cola";

// Cola offline de audio del A10 (B10.1 §8): FIFO 200 MB, subida idempotente por client_uuid, reintento
// con backoff (modo avión → online). El server real se prueba en apps/api/test/audio.test.ts.

const blobDe = (n: number) => new Blob([new Uint8Array(n)]);
const chunk = (id: string, bytes: number, creado: string): ChunkAudio => ({
  client_uuid: id,
  blob: blobDe(bytes),
  bytes,
  duracion_seg: 30,
  grabado_at: creado,
  creado_at: creado,
  intentos: 0,
  proximo_intento_at: null,
});

let n = 0;
let db: GrabadoraDB;
beforeEach(() => {
  db = new GrabadoraDB(`t-graba-${n++}`);
});

describe("grabadora-cola — encolar", () => {
  it("guarda el chunk con client_uuid y tamaño; incrementa la cola", async () => {
    const id = await encolarChunk(db, blobDe(1000), { duracionSeg: 30, grabadoAt: "2026-07-08T10:00:00.000Z" });
    expect(id).toBeTruthy();
    const c = await db.chunks.get(id);
    expect(c?.bytes).toBe(1000);
    expect(await db.chunks.count()).toBe(1);
  });

  it("evicta los más VIEJOS cuando se pasaría del tope (FIFO)", async () => {
    await db.chunks.put(chunk("v1", 40, "2026-07-08T10:00:00.000Z"));
    await db.chunks.put(chunk("v2", 40, "2026-07-08T10:00:30.000Z"));
    // tope 100: 80 usados + nuevo 40 = 120 > 100 → borra el más viejo (v1) → 40(v2)+40=80
    await encolarChunk(db, blobDe(40), { duracionSeg: 30, grabadoAt: "2026-07-08T10:01:00.000Z" }, 100);
    expect(await db.chunks.get("v1")).toBeUndefined();
    expect(await db.chunks.get("v2")).toBeTruthy();
    expect(await db.chunks.count()).toBe(2); // v2 + el nuevo
  });
});

describe("grabadora-cola — flush con backoff", () => {
  const seed = () => db.chunks.put(chunk("c1", 100, "2026-07-08T10:00:00.000Z"));

  it("'ok' → borra el chunk de la cola", async () => {
    await seed();
    const r = await flushAudioUnaVez(db, async () => "ok", 1_000);
    expect(r.subidos).toBe(1);
    expect(await db.chunks.count()).toBe(0);
  });

  it("'definitivo' (token malo) → borra y no reintenta en bucle", async () => {
    await seed();
    const r = await flushAudioUnaVez(db, async () => "definitivo", 1_000);
    expect(r.definitivos).toBe(1);
    expect(await db.chunks.count()).toBe(0);
  });

  it("'reintentar' → conserva el chunk y fija el backoff; no reintenta dentro de la ventana", async () => {
    await seed();
    const r1 = await flushAudioUnaVez(db, async () => "reintentar", 1_000);
    expect(r1.pendientes).toBe(1);
    expect((await db.chunks.get("c1"))?.intentos).toBe(1);

    // Aún dentro del backoff (1.er reintento = +1000): no debe llamar al subidor.
    const subir = vi.fn<(c: ChunkAudio) => Promise<ResultadoChunk>>(async () => "ok");
    const r2 = await flushAudioUnaVez(db, subir, 1_500);
    expect(subir).not.toHaveBeenCalled();
    expect(r2.pendientes).toBe(1);

    // Pasado el backoff: sube y se vacía.
    const r3 = await flushAudioUnaVez(db, subir, 5_000);
    expect(subir).toHaveBeenCalledTimes(1);
    expect(r3.subidos).toBe(1);
    expect(await db.chunks.count()).toBe(0);
  });
});

describe("grabadora-cola — subidor real (mapa de estados HTTP)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const c = chunk("11111111-1111-1111-1111-111111111111", 100, "2026-07-08T10:00:00.000Z");
  const subir = crearSubidorAudio(() => "tok-dispositivo");

  it("2xx (nuevo o idempotente) → ok", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
    expect(await subir(c)).toBe("ok");
    // La URL lleva client_uuid + metadatos y el body es el blob.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("client_uuid=11111111-1111-1111-1111-111111111111");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-dispositivo");
  });

  it("4xx (token malo/desactivado) → definitivo; 5xx/red → reintentar", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    expect(await subir(c)).toBe("definitivo");
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    expect(await subir(c)).toBe("reintentar");
    fetchMock.mockRejectedValue(new Error("sin red"));
    expect(await subir(c)).toBe("reintentar");
  });

  it("sin token → reintentar (no quema el chunk)", async () => {
    const subirSinTok = crearSubidorAudio(() => null);
    expect(await subirSinTok(c)).toBe("reintentar");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
