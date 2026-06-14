import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@huayruro/db";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Devuelve cliente Supabase tipado con sesión del usuario actual.
 *
 * Implementación: creamos el cliente SSR (maneja cookies) y obtenemos su token de sesión,
 * pero retornamos un cliente regular de @supabase/supabase-js tipado con Database
 * para que las queries inferan tipos correctamente. El SSR client tiene un issue de
 * inferencia que rompe los .insert() en algunos casos.
 */
export async function getServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  // SSR client maneja el ciclo de auth/cookies
  const ssrClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components no setean cookies; el middleware las renueva.
          }
        },
      },
    },
  );

  // Obtener access token de la sesión actual
  const {
    data: { session },
  } = await ssrClient.auth.getSession();

  // Crear cliente tipado con el token (preserva la inferencia Database)
  const headers: Record<string, string> = {};
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers },
    },
  );
}
