import { useEffect, useRef } from "react";

// Detecta entrada de lector de códigos de barras (HID keyboard).
// Pattern: ráfaga de caracteres alfanuméricos terminada en Enter, todo en <50ms entre keys.
// Ignora si el foco está en un input editable.

const BURST_GAP_MS = 50;

export function useBarcodeScanner(onScan: (code: string) => void) {
  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // No interceptar si el operador está escribiendo en un input
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) {
        const isReadonly = (target as HTMLInputElement).readOnly;
        if (!isReadonly) return;
      }

      const now = Date.now();
      const elapsed = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (elapsed > BURST_GAP_MS && bufferRef.current.length > 0) {
        // Comenzar nueva ráfaga
        bufferRef.current = "";
      }

      if (e.key === "Enter") {
        const code = bufferRef.current.trim();
        bufferRef.current = "";
        if (code.length >= 4 && /^\d+$/.test(code)) {
          e.preventDefault();
          onScan(code);
        }
        return;
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onScan]);
}
