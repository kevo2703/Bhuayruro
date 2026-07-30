// Cuentas del SEED SINTÉTICO. No son secretos: viven en claro en `apps/api/seeds/0001_seed_p0.sql`
// (documentadas ahí como "passwords temporales dev") y solo abren la base local desechable de la
// suite. Verificado el 2026-07-29 contra producción: estas credenciales dan 401 ahí, así que no
// sirven para entrar al piloto.

export type Cuenta = { email: string; pass: string; nombre: string };

export const SUPER: Cuenta = { email: "kevin@huayruro.local", pass: "HuayruroSuper.2026", nombre: "Kevin (super)" };
export const ADMIN_VES: Cuenta = { email: "admin.ves@huayruro.local", pass: "HuayruroVes.2026", nombre: "Kevin (VES)" };

// El seed NO trae operador (solo el super y los tres admin). Lo crea `00-usuario.spec.ts` por la
// pantalla de Usuarios, que de paso es el flujo E11.2 del checklist de P0.
export const VENDEDORA: Cuenta = { email: "vendedora.e2e@huayruro.local", pass: "SmokeE2E.2026", nombre: "Vendedora e2e" };

// Productos del catálogo sintético que usa el smoke (seed 0001, 10 SKU).
export const PRODUCTOS = {
  paracetamol: "Paracetamol 500 mg",
  ibuprofeno: "Ibuprofeno 400 mg",
  loratadina: "Loratadina 10 mg",
  omeprazol: "Omeprazol 20 mg",
  amoxicilina: "Amoxicilina 500 mg",
} as const;
