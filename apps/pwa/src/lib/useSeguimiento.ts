import { useCallback, useEffect, useRef, useState } from "react";
import { cumpleanosSemana, seguimientosPendientes, type Cumpleanero, type SeguimientoPendiente } from "./clientes";

// Lo que el Mostrador necesita saber sin que nadie lo pida: a quién le toca seguimiento y quién cumple
// años esta semana. Se consulta ONLINE y no bloquea nada — si no hay red, el mostrador cobra igual
// (la venta va por Dexie) y esto simplemente no se refresca.
//
// El refresco es lento a propósito (5 min): estas listas cambian por día, no por minuto, y en hora
// punta el POS no está para gastar red en algo que no es cobrar.
const INTERVALO_MS = 300_000;
const PROXIMOS_DIAS = 2; // los de hoy + los que caen en un par de días (para adelantar la llamada)

export function useSeguimientoMostrador(activo: boolean): {
  pendientes: SeguimientoPendiente[];
  cumpleanos: Cumpleanero[];
  hoy: string | null;
  recargar: () => void;
} {
  const [pendientes, setPendientes] = useState<SeguimientoPendiente[]>([]);
  const [cumpleanos, setCumpleanos] = useState<Cumpleanero[]>([]);
  const [hoy, setHoy] = useState<string | null>(null);
  const vivoRef = useRef(true);

  const cargar = useCallback(async () => {
    if (!activo) return;
    try {
      const [seg, cumple] = await Promise.all([seguimientosPendientes(PROXIMOS_DIAS), cumpleanosSemana()]);
      if (!vivoRef.current) return;
      setPendientes(seg.pendientes ?? []);
      setCumpleanos(cumple.cumpleanos ?? []);
      setHoy(seg.hoy);
    } catch {
      /* offline o sin permiso: se conserva lo último. Nunca rompe la caja. */
    }
  }, [activo]);

  useEffect(() => {
    vivoRef.current = true;
    if (!activo) {
      setPendientes([]);
      setCumpleanos([]);
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

  return { pendientes, cumpleanos, hoy, recargar: () => void cargar() };
}
