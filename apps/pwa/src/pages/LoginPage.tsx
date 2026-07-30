import { useState, type FormEvent } from "react";
import { dbLocal } from "../lib/db-local";
import { login } from "../lib/auth";
import { ApiError, RedError } from "../lib/api";
import type { SesionActiva } from "../lib/tipos";
import { Button, Card, Input, Logo } from "../components/ui";

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-app p-6">
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center text-center">
          <Logo size={44} />
          <h1 className="mt-4 text-[23px] font-bold tracking-[-0.015em] text-ink">Botica Huayruro</h1>
          <p className="mt-1 text-[13px] text-ink-2">Mostrador · iniciar sesión</p>
        </div>

        <Card className="mt-7">
          {/* `void`: si el submit rechaza, React no maneja la promesa y el fallo queda mudo. */}
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-[12px] font-semibold text-ink-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                required
                autoFocus
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-[12px] font-semibold text-ink-2">
                Contraseña
              </label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button type="submit" variant="primary" disabled={submitting} className="mt-1 w-full justify-center">
              {submitting ? "Ingresando…" : "Iniciar sesión"}
            </Button>

            {error && <p className="text-center text-[12.5px] text-accent-ink">{error}</p>}
          </form>
        </Card>

        <p className="mt-7 text-center text-[12px] text-ink-3">
          Si no tienes cuenta, contacta al administrador de la cadena.
        </p>
      </div>
    </main>
  );
}
