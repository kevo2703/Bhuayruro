"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/client";

type Mode = "magic-link" | "password";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/";

  const [mode, setMode] = useState<Mode>("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    { kind: "idle" } | { kind: "ok"; message: string } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleMagicLink(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult({ kind: "idle" });
    const supabase = getBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}${from}` },
    });
    setSubmitting(false);
    if (error) {
      setResult({ kind: "error", message: `${error.code ?? "?"}: ${error.message}` });
    } else {
      setResult({ kind: "ok", message: `Te enviamos un link a ${email}.` });
    }
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult({ kind: "idle" });
    const supabase = getBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setResult({ kind: "error", message: `${error.code ?? "?"}: ${error.message}` });
      return;
    }
    router.push(from);
    router.refresh();
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-center">Botica Huayruro</h1>
        <p className="mt-1 text-center opacity-60 text-sm">Admin · iniciar sesión</p>

        <div className="mt-8 flex gap-2 border-b border-white/10">
          <button
            type="button"
            onClick={() => {
              setMode("magic-link");
              setResult({ kind: "idle" });
            }}
            className={`px-4 py-2 text-sm transition ${
              mode === "magic-link" ? "border-b-2 border-emerald-400 text-emerald-400" : "opacity-60"
            }`}
          >
            Magic link
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setResult({ kind: "idle" });
            }}
            className={`px-4 py-2 text-sm transition ${
              mode === "password" ? "border-b-2 border-emerald-400 text-emerald-400" : "opacity-60"
            }`}
          >
            Contraseña
          </button>
        </div>

        <form
          onSubmit={mode === "magic-link" ? handleMagicLink : handlePassword}
          className="mt-6 space-y-4"
        >
          <div>
            <label htmlFor="email" className="block text-sm mb-1 opacity-80">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-400 outline-none"
              placeholder="tu@email.com"
            />
          </div>

          {mode === "password" && (
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
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-medium disabled:opacity-50"
          >
            {submitting
              ? "Enviando..."
              : mode === "magic-link"
                ? "Enviar magic link"
                : "Iniciar sesión"}
          </button>

          {result.kind === "ok" && (
            <p className="text-sm text-emerald-400 text-center">{result.message}</p>
          )}
          {result.kind === "error" && (
            <p className="text-sm text-red-400 text-center">{result.message}</p>
          )}
        </form>
      </div>
    </main>
  );
}
