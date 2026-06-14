import { useEffect, useState } from "react";
import { formatearSoles } from "@huayruro/shared";
import type { MetodoPago } from "@huayruro/db";

type Props = {
  total: number;
  onConfirmar: (metodo: MetodoPago, efectivoRecibido?: number) => Promise<void>;
  onCancelar: () => void;
};

const METODOS: { value: MetodoPago; label: string; icon: string }[] = [
  { value: "efectivo", label: "Efectivo", icon: "💵" },
  { value: "yape", label: "Yape", icon: "📱" },
  { value: "plin", label: "Plin", icon: "📲" },
  { value: "tarjeta", label: "Tarjeta", icon: "💳" },
  { value: "transferencia", label: "Transferencia", icon: "🏦" },
  { value: "otro", label: "Otro", icon: "•" },
];

export function CobrarModal({ total, onConfirmar, onCancelar }: Props) {
  const [metodo, setMetodo] = useState<MetodoPago>("efectivo");
  const [efectivoRecibido, setEfectivoRecibido] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelar();
    }
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("keydown", handleEsc);
    };
  }, [onCancelar]);

  const recibidoNumero = parseFloat(efectivoRecibido) || 0;
  const vuelto = recibidoNumero - total;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onConfirmar(metodo, metodo === "efectivo" ? recibidoNumero : undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-lg p-6 shadow-xl">
        <h2 className="text-2xl font-bold">Cobrar {formatearSoles(total)}</h2>

        <div className="mt-4">
          <label className="block text-sm mb-2 opacity-80">Método de pago</label>
          <div className="grid grid-cols-3 gap-2">
            {METODOS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMetodo(m.value)}
                className={`p-3 rounded border text-sm transition ${
                  metodo === m.value
                    ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 hover:bg-white/5"
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
              Efectivo recibido
            </label>
            <input
              id="recibido"
              type="number"
              step="0.10"
              autoFocus
              value={efectivoRecibido}
              onChange={(e) => setEfectivoRecibido(e.target.value)}
              className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none text-lg font-mono"
              placeholder="0.00"
            />
            {recibidoNumero > 0 && (
              <p
                className={`mt-2 text-sm font-mono ${vuelto >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {vuelto >= 0 ? `Vuelto: ${formatearSoles(vuelto)}` : `Falta: ${formatearSoles(-vuelto)}`}
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
            disabled={submitting || (metodo === "efectivo" && recibidoNumero < total)}
            className="flex-1 py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-semibold disabled:opacity-30"
          >
            {submitting ? "Procesando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
