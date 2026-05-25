import { useSession } from "./lib/useSession";
import { LoginPage } from "./pages/LoginPage";
import { Mostrador } from "./pages/Mostrador";

export function App() {
  const session = useSession();

  if (session.status === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="opacity-60">Cargando sesión...</p>
      </main>
    );
  }

  if (session.status === "anonymous") {
    return <LoginPage />;
  }

  return <Mostrador session={session.session} />;
}
