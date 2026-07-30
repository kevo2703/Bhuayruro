import { useEffect, useState } from "react";
import { solesStrACent } from "@huayruro/shared";
import { solesCent } from "../lib/money";
import type { MetodoPago } from "../lib/tipos";

type Props = {
  totalCent: number;
  onConfirmar: (metodo: MetodoPago, efectivoRecibidoCent: number | null) => Promise<void>;
  onCancelar: () => void;
};

const METODOS: { value: MetodoPago; label: string; icon: string }[] = [
  { value: "efectivo", label: "Efectivo", icon: "💵" },
  { value: "yape", label: "Yape", icon: "📱" },
  { value: "plin", label: "Plin", icon: "📲" },
  { value: "tarjeta", label: "Tarjeta", icon: "💳" },
  { value: "transferencia", label: "Transf.", icon: "🏦" },
  { value: "otro", label: "Otro", icon: "•" },
];

// Parseo tolerante de soles → céntimos (vacío o inválido = 0).
function aCent(s: string): number {
  const limpio = s.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return 0;
  try {
    return solesStrACent(limpio);
  } catch {
    return 0;
  }
}

export function CobrarModal({ totalCent, onConfirmar, onCancelar }: Props) {
  const [metodo, setMetodo] = useState<MetodoPago>("efectivo");
  const [recibidoStr, setRecibidoStr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelar();
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancelar]);

  const recibidoCent = aCent(recibidoStr);
  const vueltoCent = recibidoCent - totalCent;
  const efectivoInsuficiente = metodo === "efectivo" && recibidoStr.trim() !== "" && recibidoCent < totalCent;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onConfirmar(metodo, metodo === "efectivo" ? (recibidoStr.trim() ? recibidoCent : null) : null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-surface/40 backdrop-blur p-4">
      <div className="w-full max-w-md bg-card border border-line rounded-[14px] p-6 shadow-[0_10px_30px_rgba(36,29,26,0.25)]">
        <h2 className="text-2xl font-bold text-ink tabular-nums">Cobrar {solesCent(totalCent)}</h2>

        <div className="mt-4">
          <label className="block text-sm mb-2 text-ink-2">Método de pago</label>
          <div className="grid grid-cols-3 gap-2">
            {METODOS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMetodo(m.value)}
                className={`p-3 rounded-[9px] border text-sm transition ${
                  metodo === m.value ? "border-ok bg-ok-soft text-ok" : "border-line-input text-ink hover:bg-hover-btn"
                }`}
              >
                <div className="text-xl mb-1">{m.icon}</div>
                <div>{m.label}</div>
              </button>
            ))}
          </div>
        </div>

        {metodo === "efectivo" && (
          <div className="mt-4">
            <label htmlFor="recibido" className="block text-sm mb-1 text-ink-2">
              Efectivo recibido (opcional)
            </label>
            <input
              id="recibido"
              type="text"
              inputMode="decimal"
              autoFocus
              value={recibidoStr}
              onChange={(e) => setRecibidoStr(e.target.value)}
              className="w-full px-3 py-2 rounded-[9px] bg-field border border-line-input focus:border-ok outline-none text-lg font-mono text-ink tabular-nums"
              placeholder="0.00"
            />
            {recibidoCent > 0 && (
              <p className={`mt-2 text-sm font-mono tabular-nums ${vueltoCent >= 0 ? "text-ok" : "text-accent-ink"}`}>
                {vueltoCent >= 0 ? `Vuelto: ${solesCent(vueltoCent)}` : `Falta: ${solesCent(-vueltoCent)}`}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancelar}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-[9px] bg-card border border-line-input text-ink-emph hover:bg-hover-btn text-sm disabled:opacity-50"
          >
            Cancelar (Esc)
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || efectivoInsuficiente}
            // `bg-ok` por contraste (blanco sobre ok-strong = 3,44:1 < 4,5:1). Ver Carrito.tsx.
            className="flex-1 py-2.5 rounded-[9px] bg-ok hover:opacity-90 text-white font-semibold disabled:opacity-30"
          >
            {submitting ? "Procesando..." : "Confirmar e imprimir"}
          </button>
        </div>
      </div>
    </div>
  );
}
