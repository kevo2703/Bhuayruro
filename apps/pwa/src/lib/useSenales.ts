import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { getToken } from "./auth";
import { mutar } from "./useApi";

// Señales del audio del mostrador (B10.2 §8): faltantes detectados + ventas posibles pendientes de la
// sucursal. El Mostrador muestra el badge 🎙️ con el conteo y abre la bandeja. Es asistencia en vivo:
// se consulta online (no bloquea la venta, que va por Dexie) y si no hay red simplemente no refresca.

export type SenalItem = {
  producto_id: string | null;
  nombre_detectado: string;
  cantidad: number | null;
  confianza: number;
  producto_nombre: string | null;
};
export type Senal = { id: string; tipo: "faltante" | "venta_posible"; created_at: string; items: SenalItem[] };

const INTERVALO_MS = 20_000; // refresco del badge; el operador confirma/descarta cuando quiere

export function useSenales(activo: boolean): {
  senales: Senal[];
  recargar: () => void;
  confirmar: (id: string) => Promise<void>;
  descartar: (id: string) => Promise<void>;
} {
  const [senales, setSenales] = useState<Senal[]>([]);
  const vivoRef = useRef(true);

  const cargar = useCallback(async () => {
    if (!activo) return;
    try {
      const r = await apiRequest<{ senales: Senal[] }>("/audio/senales", { token: getToken(), reintentos: 0 });
      if (vivoRef.current) setSenales(r.senales ?? []);
    } catch {
      /* offline / sin red: mantenemos lo último. El badge no es crítico. */
    }
  }, [activo]);

  useEffect(() => {
    vivoRef.current = true;
    if (!activo) {
      setSenales([]);
      return () => {
        vivoRef.current = false;
      };
    }
    void cargar();
    const t = setInterval(() => void cargar(), INTERVALO_MS);
    return () => {
      vivoRef.current = false;
      clearInterval(t);
    };
  }, [activo, cargar]);

  // Acción optimista: sacamos la señal de la lista al toque; si falla, recargamos para reponerla.
  const confirmar = useCallback(async (id: string) => {
    try {
      await mutar(`/audio/senales/${id}/confirmar`, { method: "POST", body: {} });
      setSenales((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      void cargar();
      throw e;
    }
  }, [cargar]);

  const descartar = useCallback(async (id: string) => {
    try {
      await mutar(`/audio/senales/${id}/descartar`, { method: "POST", body: {} });
      setSenales((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      void cargar();
      throw e;
    }
  }, [cargar]);

  return { senales, recargar: () => void cargar(), confirmar, descartar };
}
