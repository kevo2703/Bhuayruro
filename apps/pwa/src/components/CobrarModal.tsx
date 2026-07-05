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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-lg p-6 shadow-xl">
        <h2 className="text-2xl font-bold">Cobrar {solesCent(totalCent)}</h2>

        <div className="mt-4">
          <label className="block text-sm mb-2 opacity-80">Método de pago</label>
          <div className="grid grid-cols-3 gap-2">
            {METODOS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMetodo(m.value)}
                className={`p-3 rounded border text-sm transition ${
                  metodo === m.value ? "border-emerald-400 bg-emerald-500/10 text-emerald-300" : "border-white/10 hover:bg-white/5"
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
            <label htmlFor="recibido" className="block text-sm mb-1 opacity-80">
              Efectivo recibido (opcional)
            </label>
            <input
              id="recibido"
              type="text"
              inputMode="decimal"
              autoFocus
              value={recibidoStr}
              onChange={(e) => setRecibidoStr(e.target.value)}
              className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none text-lg font-mono"
              placeholder="0.00"
            />
            {recibidoCent > 0 && (
              <p className={`mt-2 text-sm font-mono ${vueltoCent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {vueltoCent >= 0 ? `Vuelto: ${solesCent(vueltoCent)}` : `Falta: ${solesCent(-vueltoCent)}`}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancelar}
            disabled={submitting}
            className="flex-1 py-2.5 rounded hover:bg-white/5 text-sm disabled:opacity-50"
          >
            Cancelar (Esc)
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || efectivoInsuficiente}
            className="flex-1 py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-30"
          >
            {submitting ? "Procesando..." : "Confirmar e imprimir"}
          </button>
        </div>
      </div>
    </div>
  );
}
