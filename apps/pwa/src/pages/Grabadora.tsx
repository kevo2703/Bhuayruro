import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_BITS_POR_SEG, CHUNK_MS, elegirMime, esSilencio, rmsDeFloat32 } from "../lib/grabadora";
import { crearSubidorAudio, dbGrabadora, encolarChunk, iniciarFlusherAudio } from "../lib/grabadora-cola";

// Grabadora del A10 (B10.1 §8). Página de DISPOSITIVO: no usa sesión de usuario; se autentica con un
// token de dispositivo que el admin genera en `#/grabadores` y se pega aquí (queda en localStorage).
// Graba en chunks de 30 s (opus ~32 kbps), descarta los silenciosos por RMS, encola en IndexedDB
// (tope 200 MB FIFO) y sube con reintento offline. Pantalla siempre encendida (wake lock), enchufado.
//
// Desatendido (T-K2): tras tocar "Iniciar" UNA vez, graba sola — corta y sube cada 30 s sin más clics.
// Robustez: un watchdog reinicia la captura si se estanca; si algo la corta del todo (o tras recargar)
// intenta reanudar sola y, si el navegador exige un gesto, muestra un botón grande "Reanudar".
//
// Cada chunk es un webm COMPLETO (grabador rotativo: stop()→start()), no un fragmento — así Whisper lo
// decodifica por separado. Las APIs de navegador se validan en el A10 real (T-K2); la lógica pura está testeada.
//
// LÍMITE HONESTO (navegador): una web NO graba con la pantalla bloqueada/apagada — el navegador corta
// el micrófono. El wake lock mantiene la pantalla ENCENDIDA; el A10 va como kiosco (enchufado, pantalla
// prendida, esta página abierta). Para grabar con todo apagado hará falta un grabador dedicado (a futuro).

const TOKEN_KEY = "huayruro-grabador-token";
const INTENT_KEY = "huayruro-grabador-activo"; // "1" = debería estar grabando (para reanudar tras corte/recarga)
const STALL_MS = 45_000; // sin un chunk nuevo en 1.5× el intervalo → la captura se estancó
const WATCHDOG_MS = 10_000;

type Estado = "sin-token" | "listo" | "grabando";
type WakeLockLike = { release?: () => Promise<void> };

export function Grabadora() {
  const [token, setToken] = useState<string | null>(() => (typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY)));
  const [estado, setEstado] = useState<Estado>(token ? "listo" : "sin-token");
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reanudarPendiente, setReanudarPendiente] = useState(false);
  const [reconectando, setReconectando] = useState(false);
  const [stats, setStats] = useState({ enCola: 0, subidos: 0, descartados: 0 });
  const [haceSeg, setHaceSeg] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mimeRef = useRef<string>("");
  const picoRmsRef = useRef(0);
  const ultimoChunkAtRef = useRef(0);
  const ultimoReinicioRef = useRef(0);
  const rmsTimerRef = useRef<number | null>(null);
  const rotarTimerRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockLike | null>(null);
  const flusherStopRef = useRef<(() => void) | null>(null);
  const reiniciarRef = useRef<() => void>(() => {});
  const pararRef = useRef<(borrarIntent: boolean) => void>(() => {});

  const refrescarCola = useCallback(async () => {
    const n = await dbGrabadora.chunks.count();
    setStats((s) => ({ ...s, enCola: n }));
  }, []);

  useEffect(() => {
    void refrescarCola();
  }, [refrescarCola]);

  // Pico de RMS de la ventana de 30 s (para decidir silencio).
  const muestrearRms = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    const rms = rmsDeFloat32(buf);
    if (rms > picoRmsRef.current) picoRmsRef.current = rms;
  }, []);

  // Un chunk terminó: marca el latido; silencio → descarta; con voz → encola. Si el AudioContext no
  // está corriendo (p.ej. reanudó sin gesto), NO filtramos silencio (mejor subir de más que perder).
  const procesarChunk = useCallback(
    async (blob: Blob, grabadoAt: string) => {
      ultimoChunkAtRef.current = Date.now();
      const pico = picoRmsRef.current;
      picoRmsRef.current = 0;
      if (blob.size === 0) return;
      const puedeFiltrar = audioCtxRef.current?.state === "running";
      if (puedeFiltrar && esSilencio(pico)) {
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
      rec.onerror = () => {
        if (recorderRef.current === rec) reiniciarRef.current();
      };
      recorderRef.current = rec;
      rec.start(); // sin timeslice: al stop() sale un webm decodificable por chunk
    },
    [procesarChunk],
  );

  // Arranca la captura (ctx + analyser + grabador rotativo + muestreo RMS) sobre un stream ya obtenido.
  const arrancarCaptura = useCallback(
    (stream: MediaStream) => {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      void ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      const mime = elegirMime((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
      mimeRef.current = mime;
      ultimoChunkAtRef.current = Date.now();
      iniciarChunk(stream, mime);
      rotarTimerRef.current = window.setInterval(() => {
        try {
          recorderRef.current?.stop();
        } catch {
          /* ya detenido */
        }
      }, CHUNK_MS);
      rmsTimerRef.current = window.setInterval(muestrearRms, 250);
    },
    [iniciarChunk, muestrearRms],
  );

  // Tira abajo SOLO la captura (grabador/stream/ctx/timers); no toca flusher/wake lock/watchdog.
  const tumbarCaptura = useCallback(() => {
    if (rotarTimerRef.current) window.clearInterval(rotarTimerRef.current);
    if (rmsTimerRef.current) window.clearInterval(rmsTimerRef.current);
    rotarTimerRef.current = null;
    rmsTimerRef.current = null;
    const rec = recorderRef.current;
    recorderRef.current = null; // corta el encadenamiento en onstop
    try {
      rec?.stop();
    } catch {
      /* ya detenido */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  const pedirWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockLike> } };
      wakeLockRef.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      /* sin wake lock: la grabación sigue igual */
    }
  }, []);

  const pedirStream = useCallback(
    () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }),
    [],
  );

  // Reinicia la captura sin perder la sesión (watchdog / onerror). Si no se puede reabrir el micrófono
  // sin un gesto, pide reanudar a mano (deja la intención marcada para el botón grande).
  const reiniciarCaptura = useCallback(async () => {
    if (localStorage.getItem(INTENT_KEY) !== "1") return;
    setReconectando(true);
    tumbarCaptura();
    try {
      const stream = await pedirStream();
      streamRef.current = stream;
      arrancarCaptura(stream);
      ultimoReinicioRef.current = Date.now();
    } catch {
      pararRef.current(false); // no se pudo: para todo pero DEJA la intención → botón "Reanudar"
      setReanudarPendiente(true);
    } finally {
      setReconectando(false);
    }
  }, [arrancarCaptura, pedirStream, tumbarCaptura]);
  reiniciarRef.current = () => void reiniciarCaptura();

  // Para todo (captura + flusher + wake lock + watchdog). borrarIntent=false conserva la intención
  // para reanudar (corte/recarga); =true la borra (el operador tocó "Detener").
  const parar = useCallback(
    (borrarIntent: boolean) => {
      tumbarCaptura();
      if (watchdogTimerRef.current) window.clearInterval(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
      flusherStopRef.current?.();
      flusherStopRef.current = null;
      void wakeLockRef.current?.release?.();
      wakeLockRef.current = null;
      if (borrarIntent) localStorage.setItem(INTENT_KEY, "0");
      setEstado("listo");
    },
    [tumbarCaptura],
  );
  pararRef.current = parar;

  const arrancarWatchdog = useCallback(() => {
    if (watchdogTimerRef.current) return;
    watchdogTimerRef.current = window.setInterval(() => {
      if (localStorage.getItem(INTENT_KEY) !== "1") return;
      const sinChunk = Date.now() - ultimoChunkAtRef.current;
      const desdeReinicio = Date.now() - ultimoReinicioRef.current;
      if (sinChunk > STALL_MS && desdeReinicio > STALL_MS) reiniciarRef.current();
    }, WATCHDOG_MS);
  }, []);

  // Arranca la grabación. auto=true (reanudar sin gesto tras recarga): si falla, ofrece el botón grande.
  const grabar = useCallback(
    async (auto = false) => {
      setError(null);
      setReanudarPendiente(false);
      try {
        const stream = await pedirStream();
        streamRef.current = stream;
        arrancarCaptura(stream);
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
        localStorage.setItem(INTENT_KEY, "1");
        arrancarWatchdog();
        setEstado("grabando");
      } catch (e) {
        tumbarCaptura();
        if (auto) {
          setReanudarPendiente(true); // reanudar sin gesto no está permitido → botón grande
        } else {
          setError("No pude acceder al micrófono. Da permiso y reintenta. " + (e instanceof Error ? e.message : ""));
          localStorage.setItem(INTENT_KEY, "0");
        }
        setEstado("listo");
      }
    },
    [arrancarCaptura, arrancarWatchdog, pedirStream, pedirWakeLock, refrescarCola, tumbarCaptura],
  );

  // Al montar con intención activa (recarga/reboot): intenta reanudar sola; si el navegador lo bloquea,
  // el botón "Reanudar" queda listo (un solo toque).
  useEffect(() => {
    if (token && localStorage.getItem(INTENT_KEY) === "1") void grabar(true);
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-adquiere el wake lock al volver a primer plano (Android lo suelta al bloquear).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && estado === "grabando" && !wakeLockRef.current) void pedirWakeLock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [estado, pedirWakeLock]);

  // Latido visible: "última captura hace Ns" (confirma de un vistazo que sigue viva).
  useEffect(() => {
    if (estado !== "grabando") return;
    const t = window.setInterval(() => setHaceSeg(Math.round((Date.now() - ultimoChunkAtRef.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [estado]);

  // Al desmontar: para la captura SIN borrar la intención (recargar reanuda sola).
  useEffect(() => () => pararRef.current(false), []);

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
    parar(true);
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setEstado("sin-token");
    setReanudarPendiente(false);
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
          {reanudarPendiente && <p className="text-amber-300 text-sm max-w-xs">La grabación se detuvo. Toca para reanudar.</p>}
          <button
            onClick={() => void grabar(false)}
            className={`rounded-full w-44 h-44 text-lg font-semibold shadow-lg ${reanudarPendiente ? "bg-amber-500 hover:bg-amber-400 text-black animate-pulse" : "bg-emerald-600 hover:bg-emerald-500"}`}
          >
            {reanudarPendiente ? "▶ Reanudar" : (<>Iniciar<br />grabación</>)}
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
            <span className="text-lg font-medium">{reconectando ? "Reconectando…" : "Grabando… mantén esta pantalla encendida"}</span>
          </div>
          <p className="text-xs text-neutral-500">última captura hace {haceSeg}s · corta y sube cada 30s sola</p>
          <button onClick={() => parar(true)} className="rounded-full bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 w-40 h-40 text-lg font-semibold">
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
