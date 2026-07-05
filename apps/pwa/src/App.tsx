import { useSession } from "./lib/useSession";
import { useSyncPos } from "./lib/useSyncPos";
import { useRuta } from "./lib/ruta";
import { LoginPage } from "./pages/LoginPage";
import { Layout } from "./components/Layout";
import { Mostrador } from "./pages/Mostrador";
import { Recepcion } from "./pages/Recepcion";
import { Inventario } from "./pages/Inventario";
import { Caja } from "./pages/Caja";
import { Dashboard } from "./pages/Dashboard";
import { Usuarios } from "./pages/admin/Usuarios";
import { Sucursales } from "./pages/admin/Sucursales";
import { CatalogoForm } from "./pages/admin/CatalogoForm";
import { Faltantes } from "./pages/admin/Faltantes";
import { Consolidado } from "./pages/admin/Consolidado";
import type { SesionActiva } from "./lib/tipos";

export function App() {
  const { estado, entrar, salir } = useSession();
  useSyncPos(estado.status === "authenticated");

  if (estado.status === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="opacity-60">Cargando sesión...</p>
      </main>
    );
  }
  if (estado.status === "anonymous") {
    return <LoginPage onEntrar={entrar} />;
  }
  return <AppAutenticada sesion={estado.sesion} onSalir={() => void salir()} />;
}

function AppAutenticada({ sesion, onSalir }: { sesion: SesionActiva; onSalir: () => void }) {
  const ruta = useRuta(sesion.usuario.rol);
  return (
    <Layout sesion={sesion} rutaActual={ruta} onSalir={onSalir}>
      {ruta === "mostrador" && <Mostrador sesion={sesion} />}
      {ruta === "recepcion" && <Recepcion sesion={sesion} />}
      {ruta === "inventario" && <Inventario sesion={sesion} />}
      {ruta === "caja" && <Caja sesion={sesion} />}
      {ruta === "dashboard" && <Dashboard sesion={sesion} />}
      {ruta === "usuarios" && <Usuarios sesion={sesion} />}
      {ruta === "sucursales" && <Sucursales sesion={sesion} />}
      {ruta === "catalogo" && <CatalogoForm sesion={sesion} />}
      {ruta === "faltantes" && <Faltantes sesion={sesion} />}
      {ruta === "consolidado" && <Consolidado sesion={sesion} />}
    </Layout>
  );
}
