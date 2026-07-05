import { useState, type FormEvent } from "react";
import { dbLocal } from "../lib/db-local";
import { login } from "../lib/auth";
import { ApiError, RedError } from "../lib/api";
import type { SesionActiva } from "../lib/tipos";

// §11.1: solo email+password contra /api/auth/login (fuera el magic-link de Supabase).
export function LoginPage({ onEntrar }: { onEntrar: (s: SesionActiva) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const sesion = await login(dbLocal, email.trim().toLowerCase(), password);
      onEntrar(sesion);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? "Email o contraseña incorrectos" : err.message);
      } else if (err instanceof RedError) {
        setError("Sin conexión. Verifica tu red e intenta de nuevo.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-center">Botica Huayruro</h1>
        <p className="mt-1 text-center opacity-60 text-sm">Mostrador · iniciar sesión</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm mb-1 opacity-80">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm mb-1 opacity-80">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-medium disabled:opacity-50"
          >
            {submitting ? "Ingresando..." : "Iniciar sesión"}
          </button>

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}
        </form>

        <p className="mt-8 text-xs text-center opacity-40">
          Si no tienes cuenta, contacta al administrador de la cadena.
        </p>
      </div>
    </main>
  );
}
