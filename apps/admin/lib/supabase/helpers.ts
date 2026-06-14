// Helper para destrabar la inferencia de tipos de Supabase en el admin (Next.js + ssr)
// cuando el cliente pierde el tipo Database por incompatibilidad de versiones internas.
// Cuando hagamos `supabase gen types typescript --linked` los tipos generados con el
// proyecto real, este helper se podrá remover.

import type { Database } from "@huayruro/db";

type TableNames = keyof Database["public"]["Tables"];

type ClientWithFrom = {
  from: (table: TableNames) => unknown;
};

// Obtener el query builder de una tabla con cast forzado a tipos correctos.
// USAR SOLO PARA INSERT / UPDATE — el SELECT funciona OK con el cliente normal.
// Acepta cualquier cliente Supabase (regular o SSR) que tenga método from().
export function tableForMutation<T extends TableNames>(
  client: ClientWithFrom,
  table: T,
) {
  // Sin esto, Insert/Update infieren never por mismatch entre Database type y la versión
  // interna de supabase-js que arrastra @supabase/ssr.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client.from(table) as any;
}
