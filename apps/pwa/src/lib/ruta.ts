import { useEffect, useState } from "react";
import type { Rol } from "./tipos";

// Router propio por hash (§11.1: rutas por rol + guard /admin/*). Ligero, offline y sin config.
//
// El REFRESH visual reorganiza la NAVEGACIÓN (IA): el panel del dueño/encargado se agrupa en 6
// SECCIONES (Hoy · Casos · Ventas y caja · Inventario · Compras · Ajustes) que compone el Sidebar.
// Las páginas siguen existiendo y son alcanzables por su hash (no se pierde ninguna ruta lógica);
// cada sección apunta a una ruta primaria y "posee" (owns) las sub-rutas que la resaltan.
// El POS/Mostrador queda FUERA de estas secciones (mobile/touch-first, ver Layout).

export type RutaId =
  | "mostrador"
  | "recepcion"
  | "clientes"
  | "reposiciones"
  | "sugerencias"
  | "inventario"
  | "caja"
  | "dashboard"
  | "usuarios"
  | "sucursales"
  | "catalogo"
  | "importar-catalogo"
  | "catalogo-prueba"
  | "proveedores"
  | "pedido"
  | "recepciones-pendientes"
  | "grabadores"
  | "audio-calidad"
  | "casos"
  | "conteo"
  | "faltantes"
  | "consolidado"
  | "hoy"
  | "ajustes"
  | "mapa";

export type Vista = { id: RutaId; hash: string; label: string; icono: string; roles: Rol[]; grupo: "pos" | "admin" };

const TODOS: Rol[] = ["operador", "admin_sucursal", "super_admin", "lector_reportes"];
const OPERA: Rol[] = ["operador", "admin_sucursal", "super_admin"];
const ADMIN: Rol[] = ["admin_sucursal", "super_admin"];
const PANEL: Rol[] = ["admin_sucursal", "super_admin", "lector_reportes"];
const SUPER: Rol[] = ["super_admin"];

// Registro de páginas (guard por rol + navegación por hash). Se conservan TODAS las del build.
export const VISTAS: Vista[] = [
  { id: "hoy", hash: "#/hoy", label: "Hoy", icono: "🏠", roles: PANEL, grupo: "admin" },
  { id: "mostrador", hash: "#/", label: "Mostrador", icono: "🧾", roles: OPERA, grupo: "pos" },
  { id: "recepcion", hash: "#/recepcion", label: "Recepción", icono: "📦", roles: OPERA, grupo: "pos" },
  // Clientes es OPERA, no PANEL: `lector_reportes` no entra al padrón (DNI, alergias y notas son
  // datos personales y de salud; sus endpoints ya le responden 403).
  { id: "clientes", hash: "#/clientes", label: "Clientes", icono: "👤", roles: OPERA, grupo: "admin" },
  // A2: mismo alcance que Clientes (OPERA, sin lector). Son nombres y teléfonos del padrón.
  // Va en el grupo POS y no en el panel a propósito: el WhatsApp de la botica vive en un CELULAR, y
  // el shell de escritorio tiene un ancho mínimo de 1200 px que obligaría a scrollear en horizontal
  // justo para tocar "Abrir WhatsApp". El dueño y el encargado llegan por "Punto de venta" en el
  // sidebar (y desde Clientes), igual que llegan al Mostrador.
  { id: "reposiciones", hash: "#/reposiciones", label: "Reposición", icono: "💊", roles: OPERA, grupo: "pos" },
  // A4: curar los consejos del mostrador es trabajo de quien manda en la botica, no de quien atiende
  // (el vendedor los USA, no los escribe). Por eso ADMIN y no OPERA.
  { id: "sugerencias", hash: "#/sugerencias", label: "Sugerencias", icono: "💡", roles: ADMIN, grupo: "admin" },
  { id: "inventario", hash: "#/inventario", label: "Inventario", icono: "🗃️", roles: TODOS, grupo: "pos" },
  { id: "caja", hash: "#/caja", label: "Caja", icono: "💰", roles: TODOS, grupo: "pos" },
  { id: "dashboard", hash: "#/dashboard", label: "Ventas y caja", icono: "📊", roles: PANEL, grupo: "admin" },
  { id: "casos", hash: "#/casos", label: "Casos", icono: "🚩", roles: ADMIN, grupo: "admin" },
  { id: "conteo", hash: "#/conteo", label: "Conteo", icono: "🔢", roles: ADMIN, grupo: "admin" },
  { id: "faltantes", hash: "#/faltantes", label: "Faltantes", icono: "⚠️", roles: ADMIN, grupo: "admin" },
  { id: "consolidado", hash: "#/consolidado", label: "Consolidado", icono: "🏢", roles: SUPER, grupo: "admin" },
  { id: "catalogo", hash: "#/catalogo", label: "Catálogo", icono: "🏷️", roles: ADMIN, grupo: "admin" },
  { id: "importar-catalogo", hash: "#/importar-catalogo", label: "Importar", icono: "📥", roles: ADMIN, grupo: "admin" },
  { id: "catalogo-prueba", hash: "#/catalogo-prueba", label: "Cat. prueba", icono: "🧪", roles: ADMIN, grupo: "admin" },
  { id: "proveedores", hash: "#/proveedores", label: "Proveedores", icono: "🚚", roles: ADMIN, grupo: "admin" },
  { id: "pedido", hash: "#/pedido", label: "Compras", icono: "🛒", roles: ADMIN, grupo: "admin" },
  { id: "recepciones-pendientes", hash: "#/recepciones-pendientes", label: "Recep. bot", icono: "🤖", roles: ADMIN, grupo: "admin" },
  { id: "grabadores", hash: "#/grabadores", label: "Grabadores", icono: "🎙️", roles: ADMIN, grupo: "admin" },
  { id: "audio-calidad", hash: "#/audio-calidad", label: "Calidad audio", icono: "📈", roles: ADMIN, grupo: "admin" },
  { id: "usuarios", hash: "#/usuarios", label: "Usuarios", icono: "👥", roles: ADMIN, grupo: "admin" },
  { id: "sucursales", hash: "#/sucursales", label: "Sucursales", icono: "🏬", roles: TODOS, grupo: "admin" },
  { id: "ajustes", hash: "#/ajustes", label: "Ajustes", icono: "⚙️", roles: ADMIN, grupo: "admin" },
  { id: "mapa", hash: "#/mapa", label: "Mapa", icono: "🗺️", roles: PANEL, grupo: "admin" },
];

// ---- IA nueva: las 6 secciones del panel (dueño/encargado). El POS no entra aquí. ----
export type SeccionId = "hoy" | "casos" | "ventas" | "clientes" | "inventario" | "compras" | "ajustes" | "mapa";
export type SeccionIcono = "hoy" | "casos" | "ventas" | "clientes" | "inventario" | "compras" | "ajustes" | "mapa";
export type Seccion = {
  id: SeccionId;
  label: string;
  icono: SeccionIcono;
  grupo: "cadena" | "admin";
  roles: Rol[];
  ruta: RutaId; // ruta primaria al hacer click en el ítem del sidebar
  owns: RutaId[]; // rutas cuya presencia resalta esta sección (para el estado activo)
  badge?: "casos" | "recepciones"; // contador dinámico (de /hoy/resumen)
};

export const SECCIONES: Seccion[] = [
  { id: "hoy", label: "Hoy", icono: "hoy", grupo: "cadena", roles: PANEL, ruta: "hoy", owns: ["hoy"] },
  { id: "casos", label: "Casos", icono: "casos", grupo: "cadena", roles: ADMIN, ruta: "casos", owns: ["casos"], badge: "casos" },
  { id: "ventas", label: "Ventas y caja", icono: "ventas", grupo: "cadena", roles: PANEL, ruta: "dashboard", owns: ["dashboard", "caja", "consolidado"] },
  // Sección propia y NO dentro de "Ventas": el padrón se consulta para atender, no para reportar —
  // y su alcance de roles es distinto (el lector no entra).
  { id: "clientes", label: "Clientes", icono: "clientes", grupo: "cadena", roles: ADMIN, ruta: "clientes", owns: ["clientes"] },
  { id: "inventario", label: "Inventario", icono: "inventario", grupo: "cadena", roles: ADMIN, ruta: "inventario", owns: ["inventario", "recepciones-pendientes", "faltantes", "conteo"], badge: "recepciones" },
  { id: "compras", label: "Compras", icono: "compras", grupo: "cadena", roles: ADMIN, ruta: "pedido", owns: ["pedido", "proveedores"] },
  // `sugerencias` vive acá y no en "Ventas y caja" por el mismo criterio que Clientes en S14: esa
  // sección incluye al `lector_reportes` y curar los consejos del mostrador es solo de admin+.
  { id: "ajustes", label: "Ajustes", icono: "ajustes", grupo: "admin", roles: ADMIN, ruta: "ajustes", owns: ["ajustes", "catalogo", "importar-catalogo", "catalogo-prueba", "sugerencias", "usuarios", "sucursales", "grabadores", "audio-calidad"] },
  { id: "mapa", label: "Mapa", icono: "mapa", grupo: "admin", roles: PANEL, ruta: "mapa", owns: ["mapa"] },
];

// Rutas que se muestran en el shell POS (mobile/touch-first), fuera del panel de escritorio.
export const RUTAS_POS: RutaId[] = ["mostrador", "recepcion", "reposiciones"];

export function seccionDeRuta(r: RutaId): Seccion | undefined {
  return SECCIONES.find((s) => s.owns.includes(r));
}

// Home según rol: el vendedor arranca en el Mostrador; el panel (dueño/encargado/lector) en "Hoy".
export function rutaHome(rol: Rol): RutaId {
  return rol === "operador" ? "mostrador" : "hoy";
}

export function navegar(id: RutaId): void {
  const v = VISTAS.find((x) => x.id === id);
  if (v) window.location.hash = v.hash;
}

// Devuelve la ruta actual, validada contra el rol (si no puede o el hash está vacío, cae al home del rol).
export function useRuta(rol: Rol): RutaId {
  const [hash, setHash] = useState(() => (typeof window === "undefined" ? "" : window.location.hash));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Hash vacío → home del rol. "#/" NO es vacío: es el Mostrador (resuelve por guard de rol abajo),
  // así que un admin/super puede abrir el Mostrador aunque su home sea "Hoy".
  const home = rutaHome(rol);
  if (!hash || hash === "#") return home;
  const vista = VISTAS.find((v) => v.hash === hash);
  if (!vista || !vista.roles.includes(rol)) return home;
  return vista.id;
}
