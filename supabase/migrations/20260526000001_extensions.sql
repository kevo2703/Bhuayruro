-- Migration: 001 — Extensiones base
-- Sprint 1 · 26-may-2026
-- Cliente: Botica Huayruro
-- Especificación: ../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/03-modelo-datos.md

-- Extensiones requeridas por el sistema
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- búsqueda fuzzy de productos por nombre

-- pg_stat_statements para observabilidad (Supabase puede tenerla habilitada por default)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- UUID v7 polyfill (Postgres 17 lo incluye nativo; Supabase usa 15)
-- Implementación tomada de https://github.com/fboulnois/pg_uuidv7 — versión simplificada
CREATE OR REPLACE FUNCTION public.uuid_generate_v7()
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  ts_ms bigint;
  rand_a bigint;
  rand_b bigint;
  bytes bytea;
BEGIN
  ts_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  rand_a := (random() * 4096)::bigint;
  rand_b := (random() * 4294967295)::bigint;

  bytes := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex')
        || decode('7' || lpad(to_hex(rand_a), 3, '0'), 'hex')
        || decode(lpad(to_hex(((random() * 16384)::int | 32768)::bigint), 4, '0'), 'hex')
        || decode(lpad(to_hex(rand_b), 8, '0'), 'hex')
        || decode(lpad(to_hex((random() * 4294967295)::bigint), 8, '0'), 'hex');

  RETURN encode(bytes, 'hex')::uuid;
END;
$$;

COMMENT ON FUNCTION public.uuid_generate_v7() IS
  'UUID v7 (timestamp-aware) polyfill mientras Supabase corre Postgres 15. Migrar a uuidv7() nativo en Postgres 17.';
