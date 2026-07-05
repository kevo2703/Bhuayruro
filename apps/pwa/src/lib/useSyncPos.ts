import { useEffect } from "react";
import { dbLocal } from "./db-local";
import { crearEnviador, flushUnaVez, iniciarFlusher } from "./cola";
import { sincronizarCatalogo, sincronizarStock } from "./sync";
import { getToken } from "./auth";

// Orquesta la sincronización del POS mientras hay sesión (§9): arranca el flusher de la cola y
// hace pull de catálogo + stock al entrar y cada 15 min. Todo tolera estar offline (no rompe la UI).
const CADA_MS = 15 * 60 * 1000;

export function useSyncPos(activo: boolean): void {
  useEffect(() => {
    if (!activo) return;
    const enviar = crearEnviador(getToken);
    const pararFlusher = iniciarFlusher(dbLocal, enviar);

    const pull = () => {
      void sincronizarCatalogo(dbLocal, getToken).catch(() => {});
      void sincronizarStock(dbLocal, getToken).catch(() => {});
    };
    pull();
    const timer = setInterval(pull, CADA_MS);

    return () => {
      pararFlusher();
      clearInterval(timer);
    };
  }, [activo]);
}

// Empuja la cola de inmediato (tras encolar una venta/quiebre) sin esperar al tick. Idempotente.
export function flushAhora(): void {
  void flushUnaVez(dbLocal, crearEnviador(getToken)).catch(() => {});
}
