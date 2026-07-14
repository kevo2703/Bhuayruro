import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";

// Sistema de toasts (design-system §7 "Toast/ToastStack"). Único estado global permitido en la UI.
// - <ToastProvider> envuelve la app y guarda la cola.
// - useToast() devuelve la función toast(msg) para disparar avisos.
// - <ToastStack> se monta UNA vez (dentro del provider) y pinta la pila fija abajo-derecha.
//
// Uso:
//   // en el root:
//   <ToastProvider>
//     <App />
//     <ToastStack />
//   </ToastProvider>
//
//   // en cualquier componente:
//   const toast = useToast();
//   toast("Pedido enviado");
//
// Auto-dismiss a los 4200ms; cada toast limpia su timer al desmontarse.

interface ToastItem {
  id: number;
  msg: string;
}

interface ToastCtx {
  toasts: ToastItem[];
  toast: (msg: string) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0); // id incremental por ref (no dispara render)

  const toast = useCallback((msg: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, msg }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo<ToastCtx>(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Devuelve la función para disparar toasts. Debe usarse dentro de <ToastProvider>.
export function useToast(): (msg: string) => void {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx.toast;
}

// Pila apilada abajo-derecha; los nuevos toasts entran abajo (orden natural de la cola).
export function ToastStack({ className }: { className?: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("<ToastStack> debe usarse dentro de <ToastProvider>");
  return (
    <div className={cn("fixed bottom-[22px] right-[22px] z-[60] flex flex-col gap-2", className)}>
      {ctx.toasts.map((t) => (
        <ToastCard key={t.id} id={t.id} msg={t.msg} onDismiss={ctx.dismiss} />
      ))}
    </div>
  );
}

// Toast individual: barra oscura + punto verde. Programa su auto-dismiss al montar y lo limpia al
// desmontar. `onDismiss` (dismiss del provider) es estable → el timer se fija una sola vez.
function ToastCard({
  id,
  msg,
  onDismiss,
}: {
  id: number;
  msg: string;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 4200);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 bg-ink-surface text-on-dark px-4 py-[11px] rounded-[11px] text-[13px] font-medium shadow-[0_10px_30px_rgba(36,29,26,0.25)] animate-toast-in"
    >
      <span className="w-2 h-2 shrink-0 rounded-full bg-toast-dot" />
      {msg}
    </div>
  );
}
