// Tipos auto-generados por Supabase CLI.
// Regenerar con: pnpm supabase:types
// Mientras se construya la BD en sprint 1-2, este archivo queda como stub mínimo.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
