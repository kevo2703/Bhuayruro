import { useEffect, useRef, useState } from "react";
import { getToken } from "../lib/auth";

// Reproductor del chunk de audio del mostrador (B10.4.3). Baja el audio por el proxy AUTENTICADO del
// Worker (Bearer, igual que FotoBorrador con las fotos del bot) → blob → object URL → <audio>. Lazy:
// solo descarga al pulsar "Escuchar" (no jala audio de todas las señales al abrir la bandeja). Revoca
// el object URL al desmontar. Si el audio ya expiró por la retención de R2, muestra un aviso claro.
export function AudioPlayer({ audioId }: { audioId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const montadoRef = useRef(true);

  useEffect(
    () => () => {
      montadoRef.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function cargar() {
    if (url || cargando) return;
    setCargando(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`/api/audio/${audioId}/media`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(res.status === 404 ? "El audio ya no está disponible (expiró la retención)." : `HTTP ${res.status}`);
      const b = await res.blob();
      const u = URL.createObjectURL(b);
      // Si el componente se desmontó mientras bajaba (p.ej. se navegó de pantalla), revoca de una y sal:
      // el teardown ya corrió con urlRef null, así que sin esto el blob quedaba huérfano en memoria.
      if (!montadoRef.current) {
        URL.revokeObjectURL(u);
        return;
      }
      urlRef.current = u;
      setUrl(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el audio.");
    } finally {
      setCargando(false);
    }
  }

  if (error) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <p className="text-[11px] text-accent-ink">{error}</p>
        <button onClick={() => setError(null)} className="text-[11px] text-info-ink underline">Reintentar</button>
      </div>
    );
  }
  if (!url) {
    return (
      <button
        onClick={() => void cargar()}
        disabled={cargando}
        className="text-xs px-2 py-1 rounded-[9px] bg-info-soft border border-info/25 text-info-ink hover:bg-info-soft disabled:opacity-40"
      >
        {cargando ? "Cargando…" : "🔊 Escuchar"}
      </button>
    );
  }
  // eslint-disable-next-line jsx-a11y/media-has-caption -- audio ambiente del mostrador, no hay subtítulos
  return <audio src={url} controls className="w-full h-9 mt-1" />;
}
