import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type { Database } from "./database.types";

export function createBrowserClient(url: string, anonKey: string) {
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
