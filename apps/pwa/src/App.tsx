import { useEffect, useState } from "react";
import { useSession } from "./lib/useSession";
import { useSyncPos } from "./lib/useSyncPos";
import { useRuta } from "./lib/ruta";
import { Grabadora } from "./pages/Grabadora";
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
import { CatalogoImportador } from "./pages/admin/CatalogoImportador";
import { CatalogoPrueba } from "./pages/admin/CatalogoPrueba";
import { Proveedores } from "./pages/admin/Proveedores";
import { Pedido } from "./pages/admin/Pedido";
import { RecepcionesPendientes } from "./pages/admin/RecepcionesPendientes";
import { Grabadores } from "./pages/admin/Grabadores";
import { AudioCalidad } from "./pages/admin/AudioCalidad";
import { Casos } from "./pages/admin/Casos";
import { ConteoInventario } from "./pages/admin/ConteoInventario";
import { Faltantes } from "./pages/admin/Faltantes";
import { Consolidado } from "./pages/admin/Consolidado";
import { Hoy } from "./pages/Hoy";
import { Ajustes } from "./pages/admin/Ajustes";
import { Mapa } from "./pages/Mapa";
import type { SesionActiva } from "./lib/tipos";

// La grabadora del A10 es una página de DISPOSITIVO (token propio, sin sesión de usuario). Se resuelve
// ANTES que el flujo de login para que funcione sin cuenta (B10.1 §8).
function useEsGrabadora(): boolean {
  const [hash, setHash] = useState(() => (typeof window === "undefined" ? "" : window.location.hash));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash.startsWith("#/grabadora");
}

export function App() {
  const esGrabadora = useEsGrabadora();
  if (esGrabadora) return <Grabadora />;
  return <AppUsuario />;
}

function AppUsuario() {
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
      {ruta === "hoy" && <Hoy sesion={sesion} />}
      {ruta === "mostrador" && <Mostrador sesion={sesion} />}
      {ruta === "recepcion" && <Recepcion sesion={sesion} />}
      {ruta === "inventario" && <Inventario sesion={sesion} />}
      {ruta === "caja" && <Caja sesion={sesion} />}
      {ruta === "dashboard" && <Dashboard sesion={sesion} />}
      {ruta === "usuarios" && <Usuarios sesion={sesion} />}
      {ruta === "sucursales" && <Sucursales sesion={sesion} />}
      {ruta === "catalogo" && <CatalogoForm sesion={sesion} />}
      {ruta === "importar-catalogo" && <CatalogoImportador sesion={sesion} />}
      {ruta === "catalogo-prueba" && <CatalogoPrueba sesion={sesion} />}
      {ruta === "proveedores" && <Proveedores sesion={sesion} />}
      {ruta === "pedido" && <Pedido sesion={sesion} />}
      {ruta === "recepciones-pendientes" && <RecepcionesPendientes sesion={sesion} />}
      {ruta === "grabadores" && <Grabadores sesion={sesion} />}
      {ruta === "audio-calidad" && <AudioCalidad sesion={sesion} />}
      {ruta === "casos" && <Casos sesion={sesion} />}
      {ruta === "conteo" && <ConteoInventario sesion={sesion} />}
      {ruta === "faltantes" && <Faltantes sesion={sesion} />}
      {ruta === "consolidado" && <Consolidado sesion={sesion} />}
      {ruta === "ajustes" && <Ajustes sesion={sesion} />}
      {ruta === "mapa" && <Mapa sesion={sesion} />}
    </Layout>
  );
}
