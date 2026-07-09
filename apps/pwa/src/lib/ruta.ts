import { useEffect, useState } from "react";
import type { Rol } from "./tipos";

// Router propio por hash (§11.1: rutas por rol + guard /admin/*). Ligero, offline y sin config:
// la SPA de un mostrador es un kiosco, no necesita deep-linking de un router pesado.

export type RutaId =
  | "mostrador"
  | "recepcion"
  | "inventario"
  | "caja"
  | "dashboard"
  | "usuarios"
  | "sucursales"
  | "catalogo"
  | "importar-catalogo"
  | "proveedores"
  | "pedido"
  | "recepciones-pendientes"
  | "grabadores"
  | "faltantes"
  | "consolidado";

export type Vista = { id: RutaId; hash: string; label: string; icono: string; roles: Rol[]; grupo: "pos" | "admin" };

const TODOS: Rol[] = ["operador", "admin_sucursal", "super_admin", "lector_reportes"];
const OPERA: Rol[] = ["operador", "admin_sucursal", "super_admin"];
const ADMIN: Rol[] = ["admin_sucursal", "super_admin"];
const SUPER: Rol[] = ["super_admin"];

export const VISTAS: Vista[] = [
  { id: "mostrador", hash: "#/", label: "Mostrador", icono: "🧾", roles: OPERA, grupo: "pos" },
  { id: "recepcion", hash: "#/recepcion", label: "Recepción", icono: "📦", roles: OPERA, grupo: "pos" },
  { id: "inventario", hash: "#/inventario", label: "Inventario", icono: "🗃️", roles: TODOS, grupo: "pos" },
  { id: "caja", hash: "#/caja", label: "Caja", icono: "💰", roles: TODOS, grupo: "pos" },
  { id: "dashboard", hash: "#/dashboard", label: "Panel", icono: "📊", roles: TODOS, grupo: "admin" },
  { id: "faltantes", hash: "#/faltantes", label: "Faltantes", icono: "⚠️", roles: ADMIN, grupo: "admin" },
  { id: "consolidado", hash: "#/consolidado", label: "Consolidado", icono: "🏢", roles: SUPER, grupo: "admin" },
  { id: "catalogo", hash: "#/catalogo", label: "Catálogo", icono: "🏷️", roles: ADMIN, grupo: "admin" },
  { id: "importar-catalogo", hash: "#/importar-catalogo", label: "Importar", icono: "📥", roles: ADMIN, grupo: "admin" },
  { id: "proveedores", hash: "#/proveedores", label: "Proveedores", icono: "🚚", roles: ADMIN, grupo: "admin" },
  { id: "pedido", hash: "#/pedido", label: "Pedido", icono: "🛒", roles: ADMIN, grupo: "admin" },
  { id: "recepciones-pendientes", hash: "#/recepciones-pendientes", label: "Recep. bot", icono: "🤖", roles: ADMIN, grupo: "admin" },
  { id: "grabadores", hash: "#/grabadores", label: "Grabadores", icono: "🎙️", roles: ADMIN, grupo: "admin" },
  { id: "usuarios", hash: "#/usuarios", label: "Usuarios", icono: "👥", roles: ADMIN, grupo: "admin" },
  { id: "sucursales", hash: "#/sucursales", label: "Sucursales", icono: "🏬", roles: TODOS, grupo: "admin" },
];

const porHash = (hash: string): RutaId => VISTAS.find((v) => v.hash === hash)?.id ?? "mostrador";

export function navegar(id: RutaId): void {
  const v = VISTAS.find((x) => x.id === id);
  if (v) window.location.hash = v.hash;
}

// Devuelve la ruta actual, ya validada contra el rol (si no puede, cae a mostrador).
export function useRuta(rol: Rol): RutaId {
  const [hash, setHash] = useState(() => (typeof window === "undefined" ? "#/" : window.location.hash || "#/"));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const id = porHash(hash);
  const vista = VISTAS.find((v) => v.id === id)!;
  if (!vista.roles.includes(rol)) return "mostrador";
  return id;
}
