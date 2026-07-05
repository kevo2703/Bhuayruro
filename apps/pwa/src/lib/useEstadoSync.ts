import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { HuayruroDB } from "./db-local";

export type NivelSync = "ok" | "pendiente" | "rechazada" | "offline";
export type EstadoSync = { nivel: NivelSync; texto: string; pendientes: number; rechazadas: number; online: boolean };

// Deriva el estado del banner permanente (§9): verde "al día", ámbar "N por sincronizar",
// rojo "sin conexión" / "N rechazadas". Reactivo a la cola (Dexie) y a navigator.onLine.
export function useEstadoSync(db: HuayruroDB): EstadoSync {
  const pendientes = useLiveQuery(() => db.cola_ops.where("estado").anyOf(["pendiente", "enviando"]).count(), [db], 0) ?? 0;
  const rechazadas = useLiveQuery(() => db.cola_ops.where("estado").equals("rechazada").count(), [db], 0) ?? 0;
  const [online, setOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    const arriba = () => setOnline(true);
    const abajo = () => setOnline(false);
    window.addEventListener("online", arriba);
    window.addEventListener("offline", abajo);
    return () => {
      window.removeEventListener("online", arriba);
      window.removeEventListener("offline", abajo);
    };
  }, []);

  return { ...derivar(online, pendientes, rechazadas), pendientes, rechazadas, online };
}

// Lógica pura del banner (testeable sin React).
export function derivar(online: boolean, pendientes: number, rechazadas: number): { nivel: NivelSync; texto: string } {
  if (rechazadas > 0) return { nivel: "rechazada", texto: `${rechazadas} venta(s) rechazada(s) — revisar` };
  if (!online) return { nivel: "offline", texto: pendientes > 0 ? `Sin conexión · ${pendientes} por sincronizar` : "Sin conexión" };
  if (pendientes > 0) return { nivel: "pendiente", texto: `${pendientes} por sincronizar` };
  return { nivel: "ok", texto: "Al día" };
}
