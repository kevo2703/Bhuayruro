import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_BITS_POR_SEG, CHUNK_MS, elegirMime, esSilencio, rmsDeFloat32 } from "../lib/grabadora";
import { crearSubidorAudio, dbGrabadora, encolarChunk, iniciarFlusherAudio } from "../lib/grabadora-cola";

// Grabadora del A10 (B10.1 §8). Página de DISPOSITIVO: no usa sesión de usuario; se autentica con un
// token de dispositivo que el admin genera en la web y se pega aquí (queda en localStorage). Graba en
// chunks de 30 s (opus ~32 kbps), descarta los silenciosos por RMS, encola en IndexedDB (tope 200 MB
// FIFO) y sube con reintento offline. Pantalla siempre encendida (wake lock), enchufado, en mostrador.
//
// Cada chunk es un webm COMPLETO (grabador rotativo: stop()→start()), no un fragmento — así Whisper lo
// decodifica por separado. Las APIs de navegador (MediaRecorder/AudioContext/wake lock) se validan en
// el A10 real (T-K2); la lógica pura (RMS/silencio/evicción/cola) está testeada.

const TOKEN_KEY = "huayruro-grabador-token";
type Estado = "sin-token" | "listo" | "grabando";
type WakeLockLike = { release?: () => Promise<void> };

export function Grabadora() {
  const [token, setToken] = useState<string | null>(() => (typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY)));
  const [estado, setEstado] = useState<Estado>(token ? "listo" : "sin-token");
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ enCola: 0, subidos: 0, descartados: 0 });

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const picoRmsRef = useRef(0);
  const rmsTimerRef = useRef<number | null>(null);
  const rotarTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockLike | null>(null);
  const flusherStopRef = useRef<(() => void) | null>(null);
  const detenerRef = useRef<() => void>(() => {});

  const refrescarCola = useCallback(async () => {
    const n = await dbGrabadora.chunks.count();
    setStats((s) => ({ ...s, enCola: n }));
  }, []);

  useEffect(() => {
    void refrescarCola();
  }, [refrescarCola]);

  // --- muestreo de RMS: guarda el pico de la ventana de 30 s (para decidir silencio) ---
  const muestrearRms = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    const rms = rmsDeFloat32(buf);
    if (rms > picoRmsRef.current) picoRmsRef.current = rms;
  }, []);

  // --- un chunk terminó: silencio → descarta; con voz → encola para subir ---
  const procesarChunk = useCallback(
    async (blob: Blob, grabadoAt: string) => {
      const pico = picoRmsRef.current;
      picoRmsRef.current = 0;
      if (blob.size === 0) return;
      if (esSilencio(pico)) {
        setStats((s) => ({ ...s, descartados: s.descartados + 1 }));
        return;
      }
      await encolarChunk(dbGrabadora, blob, { duracionSeg: Math.round(CHUNK_MS / 1000), grabadoAt });
      await refrescarCola();
    },
    [refrescarCola],
  );

  // Graba UN chunk; al parar, lo procesa y (si seguimos grabando) encadena el siguiente webm completo.
  const iniciarChunk = useCallback(
    (stream: MediaStream, mime: string) => {
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: AUDIO_BITS_POR_SEG } : { audioBitsPerSecond: AUDIO_BITS_POR_SEG });
      const grabadoAt = new Date().toISOString();
      const trozos: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) trozos.push(e.data);
      };
      rec.onstop = () => {
        void procesarChunk(new Blob(trozos, { type: mime || "audio/webm" }), grabadoAt);
        if (recorderRef.current === rec && streamRef.current) iniciarChunk(streamRef.current, mime);
      };
      recorderRef.current = rec;
      rec.start(); // sin timeslice: al stop() sale un webm decodificable por chunk
    },
    [procesarChunk],
  );

  const pedirWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockLike> } };
      wakeLockRef.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      /* sin wake lock: la grabación sigue igual */
    }
  }, []);

  const detener = useCallback(() => {
    if (rotarTimerRef.current) window.clearInterval(rotarTimerRef.current);
    if (rmsTimerRef.current) window.clearInterval(rmsTimerRef.current);
    rotarTimerRef.current = null;
    rmsTimerRef.current = null;
    const rec = recorderRef.current;
    recorderRef.current = null; // corta el encadenamiento en onstop
    try {
      rec?.stop();
    } catch {
      /* ya estaba detenido */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    flusherStopRef.current?.();
    flusherStopRef.current = null;
    void wakeLockRef.current?.release?.();
    wakeLockRef.current = null;
    setEstado("listo");
  }, []);
  detenerRef.current = detener;

  const grabar = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;

      const mime = elegirMime((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
      iniciarChunk(stream, mime);
      rotarTimerRef.current = window.setInterval(() => {
        try {
          recorderRef.current?.stop();
        } catch {
          /* */
        }
      }, CHUNK_MS);
      rmsTimerRef.current = window.setInterval(muestrearRms, 250);

      flusherStopRef.current = iniciarFlusherAudio(
        dbGrabadora,
        crearSubidorAudio(() => (typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY))),
        (r) => {
          if (r.subidos) setStats((s) => ({ ...s, subidos: s.subidos + r.subidos }));
          if (r.definitivos) setError("El token del grabador fue rechazado. Pídele uno nuevo al administrador y vuelve a pegarlo.");
          void refrescarCola();
        },
      );

      await pedirWakeLock();
      setEstado("grabando");
    } catch (e) {
      setError("No pude acceder al micrófono. Da permiso y reintenta. " + (e instanceof Error ? e.message : ""));
      detener();
    }
  }, [iniciarChunk, muestrearRms, pedirWakeLock, refrescarCola, detener]);

  // Re-adquiere el wake lock al volver a primer plano (Android lo suelta al bloquear).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && estado === "grabando" && !wakeLockRef.current) void pedirWakeLock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [estado, pedirWakeLock]);

  useEffect(() => () => detenerRef.current(), []);

  const guardarToken = () => {
    const t = tokenInput.trim();
    if (!t) return;
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
    setEstado("listo");
    setError(null);
    setTokenInput("");
  };
  const olvidarToken = () => {
    detenerRef.current();
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setEstado("sin-token");
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center gap-6 p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">🎙️ Grabadora Huayruro</h1>
        <p className="text-neutral-400 text-sm mt-1">Asistente de mostrador. Solo asistencia operativa; nunca vigilancia de personal.</p>
      </div>

      {error && <p className="max-w-md rounded-lg bg-red-950 border border-red-800 px-4 py-2 text-red-200 text-sm">{error}</p>}

      {estado === "sin-token" && (
        <div className="w-full max-w-md flex flex-col gap-3">
          <p className="text-neutral-300 text-sm">Pega el token del grabador (lo genera el administrador en la web, en “Grabadores”).</p>
          <textarea
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Token del dispositivo…"
            className="rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm font-mono break-all"
            rows={3}
          />
          <button onClick={guardarToken} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 font-medium">
            Guardar token
          </button>
        </div>
      )}

      {estado === "listo" && (
        <div className="flex flex-col items-center gap-4">
          <button onClick={() => void grabar()} className="rounded-full bg-emerald-600 hover:bg-emerald-500 w-40 h-40 text-lg font-semibold shadow-lg">
            Iniciar<br />grabación
          </button>
          <button onClick={olvidarToken} className="text-neutral-500 hover:text-neutral-300 text-xs underline">
            Cambiar token
          </button>
        </div>
      )}

      {estado === "grabando" && (
        <div className="flex flex-col items-center gap-5">
          <div className="flex items-center gap-3 text-red-400">
            <span className="inline-block w-4 h-4 rounded-full bg-red-500 animate-pulse" />
            <span className="text-lg font-medium">Grabando… mantené esta pantalla encendida</span>
          </div>
          <button onClick={detener} className="rounded-full bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 w-40 h-40 text-lg font-semibold">
            Detener
          </button>
        </div>
      )}

      {estado !== "sin-token" && (
        <div className="grid grid-cols-3 gap-4 text-center mt-2">
          <Stat n={stats.enCola} label="en cola" />
          <Stat n={stats.subidos} label="subidos" />
          <Stat n={stats.descartados} label="silencio" />
        </div>
      )}
    </main>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-2 min-w-20">
      <div className="text-xl font-semibold tabular-nums">{n}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
