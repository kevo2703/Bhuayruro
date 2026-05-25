import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type {
  Database,
  Tenant,
  TenantInsert,
  TenantUpdate,
  Sucursal,
  SucursalInsert,
  SucursalUpdate,
  UsuarioPerfil,
  UsuarioPerfilInsert,
  UsuarioPerfilUpdate,
  UserRole,
  ProductoCatalogo,
  ProductoCatalogoInsert,
  ProductoCatalogoUpdate,
  CodigoBarras,
  CodigoBarrasInsert,
  CodigoBarrasUpdate,
  PrecioLocal,
  PrecioLocalInsert,
  PrecioLocalUpdate,
} from "./database.types";

export type HuayruroSupabaseClient = SupabaseClient<Database>;

type ClientConfig = {
  url: string;
  anonKey: string;
};

function readConfigFromEnv(env: Record<string, string | undefined>, prefix: "VITE_" | "NEXT_PUBLIC_"): ClientConfig {
  const url = env[`${prefix}SUPABASE_URL`];
  const anonKey = env[`${prefix}SUPABASE_ANON_KEY`];
  if (!url || !anonKey) {
    throw new Error(
      `Faltan variables de entorno: ${prefix}SUPABASE_URL y/o ${prefix}SUPABASE_ANON_KEY. ` +
        "Verificá tu .env.local",
    );
  }
  return { url, anonKey };
}

/**
 * Cliente Supabase para PWA (Vite + React).
 * Lee config desde import.meta.env (Vite).
 *
 * Persiste sesión en localStorage, refresca tokens automáticamente.
 */
export function createPwaClient(env: Record<string, string | undefined>): HuayruroSupabaseClient {
  const { url, anonKey } = readConfigFromEnv(env, "VITE_");
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

/**
 * Cliente Supabase para Next.js admin (browser side).
 * Lee config desde process.env (NEXT_PUBLIC_*).
 */
export function createAdminBrowserClient(env: Record<string, string | undefined>): HuayruroSupabaseClient {
  const { url, anonKey } = readConfigFromEnv(env, "NEXT_PUBLIC_");
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

/**
 * Cliente Supabase server-side con service_role.
 * USO RESTRINGIDO: solo desde Next.js server components, Edge Functions, scripts.
 * NUNCA exponer al browser.
 */
export function createAdminServerClient(url: string, serviceRoleKey: string): HuayruroSupabaseClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
