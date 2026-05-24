import { createPwaClient } from "@huayruro/db";

export const supabase = createPwaClient(import.meta.env as unknown as Record<string, string | undefined>);
