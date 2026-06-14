"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/server";
import { tableForMutation } from "@/lib/supabase/helpers";
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
  const { data: prod, error: prodErr } = (await tableForMutation(supabase, "producto_catalogo")
    .insert({
      tenant_id: perfil.tenant_id,
      nombre: data.nombre,
      presentacion: data.presentacion || null,
      laboratorio: data.laboratorio || null,
      principio_activo: data.principio_activo || null,
      categoria: data.categoria || null,
      requiere_receta: data.requiere_receta ?? false,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (prodErr || !prod) {
    return { error: `Error creando producto: ${prodErr?.message ?? "desconocido"}` };
  }

  // 2. GTIN si se proveyó
  if (data.gtin) {
    const { error: gtinErr } = await tableForMutation(supabase, "codigo_barras").insert({
      producto_id: prod.id,
      gtin: data.gtin,
    });
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
      await tableForMutation(supabase, "precio_local").insert(inserts);
    }
  } else if (perfil.sucursal_id) {
    const precioSinIgv = Math.round((data.precio_total / 1.18) * 10000) / 10000;
    await tableForMutation(supabase, "precio_local").insert({
      producto_id: prod.id,
      sucursal_id: perfil.sucursal_id,
      precio_compra: data.precio_compra ?? null,
      precio_sin_igv: precioSinIgv,
    });
  }

  revalidatePath("/catalogo");
  redirect("/catalogo");
}

// ====== ACTUALIZAR PRODUCTO ======

const productoUpdateSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().min(1).max(200),
  presentacion: z.string().max(100).optional().or(z.literal("")),
  laboratorio: z.string().max(100).optional().or(z.literal("")),
  principio_activo: z.string().max(200).optional().or(z.literal("")),
  categoria: z.string().max(100).optional().or(z.literal("")),
  requiere_receta: z.boolean().optional(),
  activo: z.boolean().optional(),
  precio_total: z.coerce.number().positive().optional(),
  precio_compra: z.coerce.number().nonnegative().optional(),
});

export async function actualizarProducto(
  _prevState: ProductoFormState,
  formData: FormData,
): Promise<ProductoFormState> {
  const supabase = await getServerClient();

  const raw = {
    id: formData.get("id"),
    nombre: formData.get("nombre"),
    presentacion: formData.get("presentacion") || "",
    laboratorio: formData.get("laboratorio") || "",
    principio_activo: formData.get("principio_activo") || "",
    categoria: formData.get("categoria") || "",
    requiere_receta: formData.get("requiere_receta") === "on",
    activo: formData.get("activo") === "on",
    precio_total: formData.get("precio_total") || undefined,
    precio_compra: formData.get("precio_compra") || undefined,
  };

  const parsed = productoUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const data = parsed.data;

  // 1. Actualizar producto
  const { error: updErr } = await tableForMutation(supabase, "producto_catalogo")
    .update({
      nombre: data.nombre,
      presentacion: data.presentacion || null,
      laboratorio: data.laboratorio || null,
      principio_activo: data.principio_activo || null,
      categoria: data.categoria || null,
      requiere_receta: data.requiere_receta ?? false,
      activo: data.activo ?? true,
    })
    .eq("id", data.id);

  if (updErr) {
    return { error: `Error actualizando: ${updErr.message}` };
  }

  // 2. Si vino nuevo precio, cerramos el vigente y creamos uno nuevo
  if (data.precio_total) {
    type PerfilRow = { tenant_id: string; sucursal_id: string | null; rol: UserRole };
    const { data: perfil } = await supabase
      .from("usuario_perfil")
      .select("tenant_id, sucursal_id, rol")
      .maybeSingle()
      .returns<PerfilRow>();

    if (perfil?.tenant_id) {
      const precioSinIgv = Math.round((data.precio_total / 1.18) * 10000) / 10000;

      // Cerrar precios vigentes
      await tableForMutation(supabase, "precio_local")
        .update({ vigente_hasta: new Date().toISOString() })
        .eq("producto_id", data.id)
        .is("vigente_hasta", null);

      // Crear nuevo precio en sucursales correspondientes
      if (perfil.rol === "super_admin") {
        const { data: sucursales } = await supabase
          .from("sucursal")
          .select("id")
          .eq("tenant_id", perfil.tenant_id)
          .is("deleted_at", null)
          .returns<Array<{ id: string }>>();
        if (sucursales && sucursales.length > 0) {
          const inserts: PrecioLocalInsert[] = sucursales.map((s) => ({
            producto_id: data.id,
            sucursal_id: s.id,
            precio_compra: data.precio_compra ?? null,
            precio_sin_igv: precioSinIgv,
          }));
          await tableForMutation(supabase, "precio_local").insert(inserts);
        }
      } else if (perfil.sucursal_id) {
        await tableForMutation(supabase, "precio_local").insert({
          producto_id: data.id,
          sucursal_id: perfil.sucursal_id,
          precio_compra: data.precio_compra ?? null,
          precio_sin_igv: precioSinIgv,
        });
      }
    }
  }

  revalidatePath("/catalogo");
  revalidatePath(`/catalogo/${data.id}`);
  return {};
}

// ====== SOFT DELETE ======

export async function eliminarProducto(formData: FormData): Promise<void> {
  const supabase = await getServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await tableForMutation(supabase, "producto_catalogo")
    .update({ deleted_at: new Date().toISOString(), activo: false })
    .eq("id", id);

  revalidatePath("/catalogo");
  redirect("/catalogo");
}
