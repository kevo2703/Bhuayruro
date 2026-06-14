import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Sucursal, UserRole } from "@huayruro/db";

export type CatalogoProducto = {
  id: string;
  nombre: string;
  presentacion: string | null;
  laboratorio: string | null;
  principio_activo: string | null;
  categoria: string | null;
  requiere_receta: boolean;
  gtin: string | null;
  precio_total: number;       // con IGV
  precio_sin_igv: number;     // sin IGV (para registrar_venta)
  stock_unidades: number | null;
};

export type Perfil = {
  nombre: string;
  rol: UserRole;
  sucursal: Sucursal | null;
};

type State =
  | { status: "loading" }
  | { status: "ready"; perfil: Perfil | null; productos: CatalogoProducto[] }
  | { status: "error"; message: string };

export function useCatalogo(session: Session): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        // 1. Perfil del usuario
        type PerfilRow = {
          nombre: string;
          rol: UserRole;
          sucursal: Sucursal | Sucursal[] | null;
        };

        const { data: perfilData, error: perfilErr } = await supabase
          .from("usuario_perfil")
          .select("nombre, rol, sucursal:sucursal_id(*)")
          .eq("id", session.user.id)
          .maybeSingle()
          .returns<PerfilRow>();

        if (perfilErr) {
          if (mounted) setState({ status: "error", message: `Perfil: ${perfilErr.message}` });
          return;
        }

        const perfil: Perfil | null = perfilData
          ? {
              nombre: perfilData.nombre,
              rol: perfilData.rol,
              sucursal: Array.isArray(perfilData.sucursal)
                ? (perfilData.sucursal[0] ?? null)
                : perfilData.sucursal,
            }
          : null;

        // 2. Productos + precio + GTIN + stock (RLS filtra por sucursal)
        type ProductoRow = {
          id: string;
          nombre: string;
          presentacion: string | null;
          laboratorio: string | null;
          principio_activo: string | null;
          categoria: string | null;
          requiere_receta: boolean;
          precio_local: { precio_total: number; precio_sin_igv: number; sucursal_id: string }[];
          codigo_barras: { gtin: string }[];
          inventario_local: { stock_unidades: number; sucursal_id: string }[];
        };

        const { data: prodData, error: prodErr } = await supabase
          .from("producto_catalogo")
          .select(
            "id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta, " +
              "precio_local!inner(precio_total, precio_sin_igv, sucursal_id), " +
              "codigo_barras(gtin), " +
              "inventario_local(stock_unidades, sucursal_id)",
          )
          .is("deleted_at", null)
          .eq("activo", true)
          .is("precio_local.vigente_hasta", null)
          .order("nombre")
          .returns<ProductoRow[]>();

        if (prodErr) {
          if (mounted) setState({ status: "error", message: `Productos: ${prodErr.message}` });
          return;
        }

        const sucursalId = perfil?.sucursal?.id ?? null;

        const productos: CatalogoProducto[] = (prodData ?? []).map((p) => {
          const precio =
            sucursalId != null
              ? (p.precio_local.find((pr) => pr.sucursal_id === sucursalId) ?? p.precio_local[0])
              : p.precio_local[0];
          const stock =
            sucursalId != null
              ? (p.inventario_local.find((i) => i.sucursal_id === sucursalId)?.stock_unidades ?? null)
              : null;
          return {
            id: p.id,
            nombre: p.nombre,
            presentacion: p.presentacion,
            laboratorio: p.laboratorio,
            principio_activo: p.principio_activo,
            categoria: p.categoria,
            requiere_receta: p.requiere_receta,
            gtin: p.codigo_barras[0]?.gtin ?? null,
            precio_total: precio?.precio_total ?? 0,
            precio_sin_igv: precio?.precio_sin_igv ?? 0,
            stock_unidades: stock,
          };
        });

        if (mounted) setState({ status: "ready", perfil, productos });
      } catch (e) {
        if (mounted)
          setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();

    return () => {
      mounted = false;
    };
  }, [session.user.id]);

  return state;
}

export function useProductoByGtin(productos: CatalogoProducto[]) {
  return useMemo(() => {
    const map = new Map<string, CatalogoProducto>();
    for (const p of productos) {
      if (p.gtin) map.set(p.gtin, p);
    }
    return map;
  }, [productos]);
}
