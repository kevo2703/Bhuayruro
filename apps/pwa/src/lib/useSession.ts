import { useCallback, useEffect, useState } from "react";
import { dbLocal } from "./db-local";
import { borrarSesion, leerSesionCache, logout, setToken, verificarSesion } from "./auth";
import type { SesionActiva } from "./tipos";

// Sesión propia (§11.1: REESCRITO — /api/auth/me + sesion_cache de Dexie, arranque offline).
// Arranca desde la cache (funciona sin red); valida el token contra el server en segundo plano y
// solo cierra sesión si el server RECHAZA el token (401/403). Sin red = se confía en la cache.

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; sesion: SesionActiva };

export function useSession(): {
  estado: SessionState;
  entrar: (s: SesionActiva) => void;
  salir: () => Promise<void>;
} {
  const [estado, setEstado] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const cache = await leerSesionCache(dbLocal);
      if (!vivo) return;
      if (!cache) {
        setEstado({ status: "anonymous" });
        return;
      }
      setEstado({ status: "authenticated", sesion: cache }); // optimista (offline OK)
      const veredicto = await verificarSesion(cache.token);
      if (!vivo) return;
      if (veredicto === "invalida") {
        await borrarSesion(dbLocal);
        if (vivo) setEstado({ status: "anonymous" });
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const entrar = useCallback((s: SesionActiva) => {
    setToken(s.token);
    setEstado({ status: "authenticated", sesion: s });
  }, []);

  const salir = useCallback(async () => {
    const token = estado.status === "authenticated" ? estado.sesion.token : null;
    await logout(dbLocal, token);
    setEstado({ status: "anonymous" });
  }, [estado]);

  return { estado, entrar, salir };
}
