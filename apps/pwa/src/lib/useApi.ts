import { useCallback, useEffect, useState } from "react";
import { apiRequest, type ApiOpts } from "./api";
import { getToken } from "./auth";

// Hook de lectura contra el Worker (screens de operación/admin, online). El POS de venta NO usa
// esto (lee de Dexie); esto es para inventario/caja/dashboards que consultan al server en vivo.
export function useApi<T>(path: string | null, deps: unknown[] = []): {
  data: T | null;
  cargando: boolean;
  error: string | null;
  recargar: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [cargando, setCargando] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const recargar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (path === null) {
      setCargando(false);
      return;
    }
    let vivo = true;
    setCargando(true);
    setError(null);
    void apiRequest<T>(path, { token: getToken() })
      .then((r) => {
        if (vivo) setData(r);
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { data, cargando, error, recargar };
}

// Mutación puntual (POST/PATCH/DELETE) con el token de sesión.
export function mutar<T>(path: string, opts: Omit<ApiOpts, "token">): Promise<T> {
  return apiRequest<T>(path, { ...opts, token: getToken() });
}

// Descarga un endpoint no-JSON (CSV) con el token de sesión, disparando la descarga del archivo.
export async function descargarCsv(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
