"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { tableForMutation } from "@/lib/supabase/helpers";

const CONSENT_KEY = "huayruro_consent_v1";
const CONSENT_VERSION = "2026-05-25";

type Props = {
  userId: string;
};

export function ConsentModal({ userId }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = `${CONSENT_KEY}_${userId}`;
    const stored = localStorage.getItem(key);
    if (stored !== CONSENT_VERSION) {
      setOpen(true);
    }
  }, [userId]);

  async function handleAccept() {
    const key = `${CONSENT_KEY}_${userId}`;
    localStorage.setItem(key, CONSENT_VERSION);

    // Log a audit para trazabilidad LPDP
    try {
      const supabase = getBrowserClient();
      await tableForMutation(supabase, "usuario_perfil")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", userId);
    } catch {
      // No bloquear si falla — el localStorage ya guardó
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4">
      <div className="max-w-lg bg-zinc-900 border border-white/10 rounded-lg p-6 shadow-xl">
        <h2 className="text-xl font-bold">Consentimiento de uso del sistema</h2>
        <p className="mt-2 text-sm opacity-80">
          Conforme a la <strong>Ley N° 29733</strong> y su reglamento{" "}
          <strong>D.S. 016-2024-JUS</strong>, te informamos:
        </p>

        <ul className="mt-3 space-y-2 text-sm opacity-90 list-disc list-inside">
          <li>
            Este sistema registra tu actividad (logins, operaciones en catálogo, ventas) con fines
            de seguridad y trazabilidad operativa.
          </li>
          <li>
            Tus datos personales tratados se limitan a: nombre, email, rol y log de actividad. No
            recolectamos otros datos sensibles.
          </li>
          <li>Plazo de retención: 2 años desde la última actividad (audit log).</li>
          <li>
            Podés ejercer tus derechos ARCO (acceso, rectificación, cancelación, oposición)
            enviando un correo a privacidad@huayruro.pe.
          </li>
          <li>
            Política completa disponible en{" "}
            <a href="/privacidad" target="_blank" className="text-emerald-400 underline">
              /privacidad
            </a>
            .
          </li>
        </ul>

        <p className="mt-4 text-xs opacity-60">
          Al hacer click en "Acepto" otorgás consentimiento expreso e informado al tratamiento
          descrito.
        </p>

        <div className="mt-4 flex justify-end">
          <button
            onClick={() => void handleAccept()}
            className="px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-medium"
          >
            Acepto
          </button>
        </div>
      </div>
    </div>
  );
}
