"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/server";
import type { PrecioLocalInsert, UserRole } from "@huayruro/db";

const productoSchema = z.object({
  nombre: z.string().min(1, "Nombre requerido").max(200),
  presentacion: z.string().max(100).optional().or(z.literal("")),
  laboratorio: z.string().max(100).optional().or(z.literal("")),
  principio_activo: z.string().max(200).optional().or(z.literal("")),
  categoria: z.string().max(100).optional().or(z.literal("")),
  gtin: z.string().regex(/^\d{8,14}$/, "GTIN debe ser 8-14 dígitos").optional().or(z.literal("")),
  precio_compra: z.coerce.number().nonnegative().optional(),
  precio_total: z.coerce.number().positive("Precio venta requerido"),
  requiere_receta: z.boolean().optional(),
});

export type ProductoFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function crearProducto(
  _prevState: ProductoFormState,
  formData: FormData,
): Promise<ProductoFormState> {
  const supabase = await getServerClient();

  // Parsear y validar
  const raw = {
    nombre: formData.get("nombre"),
    presentacion: formData.get("presentacion") || "",
    laboratorio: formData.get("laboratorio") || "",
    principio_activo: formData.get("principio_activo") || "",
    categoria: formData.get("categoria") || "",
    gtin: formData.get("gtin") || "",
    precio_compra: formData.get("precio_compra") || undefined,
    precio_total: formData.get("precio_total"),
    requiere_receta: formData.get("requiere_receta") === "on",
  };

  const parsed = productoSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const data = parsed.data;

  // Obtener tenant del usuario
  type PerfilRow = { tenant_id: string; sucursal_id: string | null; rol: UserRole };
  const { data: perfil } = await supabase
    .from("usuario_perfil")
    .select("tenant_id, sucursal_id, rol")
    .maybeSingle()
    .returns<PerfilRow>();

  if (!perfil?.tenant_id) {
    return { error: "No se encontró tu perfil — contactá al super admin" };
  }

  // 1. Insertar producto
  const productoInsert = {
    tenant_id: perfil.tenant_id,
    nombre: data.nombre,
    presentacion: data.presentacion || null,
    laboratorio: data.laboratorio || null,
    principio_activo: data.principio_activo || null,
    categoria: data.categoria || null,
    requiere_receta: data.requiere_receta ?? false,
  };
  const { data: prod, error: prodErr } = await supabase
    .from("producto_catalogo")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(productoInsert as any)
    .select("id")
    .single<{ id: string }>();

  if (prodErr || !prod) {
    return { error: `Error creando producto: ${prodErr?.message ?? "desconocido"}` };
  }

  // 2. GTIN si se proveyó
  if (data.gtin) {
    const gtinInsert = { producto_id: prod.id, gtin: data.gtin };
    const { error: gtinErr } = await supabase
      .from("codigo_barras")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(gtinInsert as any);
    if (gtinErr) {
      return { error: `Producto creado pero falló GTIN: ${gtinErr.message}` };
    }
  }

  // 3. Precio para la sucursal del usuario (admin_sucursal) o todas (super_admin)
  // Por simplicidad: si admin_sucursal, en su sucursal; si super_admin, en todas las sucursales del tenant.
  if (perfil.rol === "super_admin") {
    const { data: sucursales } = await supabase
      .from("sucursal")
      .select("id")
      .eq("tenant_id", perfil.tenant_id)
      .is("deleted_at", null)
      .returns<Array<{ id: string }>>();

    if (sucursales && sucursales.length > 0) {
      const precioSinIgv = Math.round((data.precio_total / 1.18) * 10000) / 10000;
      const inserts: PrecioLocalInsert[] = sucursales.map((s) => ({
        producto_id: prod.id,
        sucursal_id: s.id,
        precio_compra: data.precio_compra ?? null,
        precio_sin_igv: precioSinIgv,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from("precio_local").insert(inserts as any);
    }
  } else if (perfil.sucursal_id) {
    const precioSinIgv = Math.round((data.precio_total / 1.18) * 10000) / 10000;
    const insert: PrecioLocalInsert = {
      producto_id: prod.id,
      sucursal_id: perfil.sucursal_id,
      precio_compra: data.precio_compra ?? null,
      precio_sin_igv: precioSinIgv,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from("precio_local").insert(insert as any);
  }

  revalidatePath("/catalogo");
  redirect("/catalogo");
}
