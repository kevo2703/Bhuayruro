export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Botica Huayruro · Admin</h1>
      <p className="mt-2 text-lg opacity-70">v0.1.0 · {new Date().toISOString().slice(0, 10)}</p>
      <p className="mt-8 text-sm opacity-50">
        Sprint 1 en curso · Setup base + validaciones críticas
      </p>
    </main>
  );
}
