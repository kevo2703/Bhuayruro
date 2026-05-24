-- ============================================================
-- SCRIPT CONSOLIDADO INICIAL — Cadena Botica Huayruro
-- ============================================================
-- Generado: 2026-05-24 · v2 (fix UUID v7 bug → uso gen_random_uuid v4)
-- Idempotente: limpia estado previo si existe + recrea desde cero.
--
-- USO (sprint 1 día 1):
--   1. Abrir Supabase Dashboard → Project hnbxjyvnthydiaqrojlh → SQL Editor
--   2. New query → pegar este archivo completo → Run
--   3. Resultado esperado en el SELECT final:
--      tenants_creados=1 · sucursales_creadas=3 · helpers_rls=5
-- ============================================================

-- ====== CLEANUP — borra estado previo (idempotente) ======
-- Borra solo tablas/types/functions creados por este script.
-- NO afecta el schema auth ni storage de Supabase.

DROP POLICY IF EXISTS usuario_perfil_update ON usuario_perfil;
DROP POLICY IF EXISTS usuario_perfil_insert ON usuario_perfil;
DROP POLICY IF EXISTS usuario_perfil_select ON usuario_perfil;
DROP POLICY IF EXISTS sucursal_select ON sucursal;
DROP POLICY IF EXISTS tenant_select_own ON tenant;

DROP FUNCTION IF EXISTS auth.is_admin_or_super();
DROP FUNCTION IF EXISTS auth.is_super_admin();
DROP FUNCTION IF EXISTS auth.user_tenant_id();
DROP FUNCTION IF EXISTS auth.user_sucursal_id();
DROP FUNCTION IF EXISTS auth.user_rol();

DROP TABLE IF EXISTS usuario_perfil CASCADE;
DROP TYPE  IF EXISTS user_role CASCADE;

DROP TABLE IF EXISTS sucursal CASCADE;
DROP TABLE IF EXISTS tenant CASCADE;

DROP FUNCTION IF EXISTS trg_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.uuid_generate_v7() CASCADE;

-- ====== MIGRATION 001 — EXTENSIONES ======

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- NOTA UUID v7 vs v4: estamos usando gen_random_uuid() (UUID v4 de pgcrypto)
-- porque Supabase corre Postgres 15 y los polyfills v7 PL/pgSQL son frágiles.
-- Cuando Supabase actualice a Postgres 17 (uuidv7() nativo), migrar.
-- Decisión registrada en docs/adr/006-idempotencia-client-uuid.md.

-- ====== MIGRATION 002 — TENANT + SUCURSAL ======

CREATE TABLE tenant (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            text NOT NULL,
  nombre_comercial  text NOT NULL,
  ruc               text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

COMMENT ON TABLE tenant IS
  'Cadena comercial. Botica Huayruro es 1 tenant; futuros clientes externos serían tenants distintos.';

CREATE TABLE sucursal (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  nombre        text NOT NULL,
  direccion     text,
  zona_horaria  text DEFAULT 'America/Lima',
  activa        boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX idx_sucursal_tenant ON sucursal(tenant_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION trg_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_updated_at
  BEFORE UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION trg_updated_at();

CREATE TRIGGER sucursal_updated_at
  BEFORE UPDATE ON sucursal
  FOR EACH ROW EXECUTE FUNCTION trg_updated_at();

-- Seed inicial: cadena Botica Huayruro + 3 sucursales
DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  INSERT INTO tenant (nombre, nombre_comercial)
  VALUES ('Cadena Botica Huayruro', 'Botica Huayruro')
  RETURNING id INTO v_tenant_id;

  INSERT INTO sucursal (tenant_id, nombre, direccion) VALUES
    (v_tenant_id, 'Huayruro VES',            'Av. Revolución × Av. Las Lomas, Villa El Salvador, Lima'),
    (v_tenant_id, 'Huayruro Chazuta Puerto', 'Chazuta — Puerto, San Martín'),
    (v_tenant_id, 'Huayruro Chazuta Plaza',  'Chazuta — Plaza, San Martín');
END $$;

-- ====== MIGRATION 003 — USUARIO_PERFIL + HELPERS RLS ======

CREATE TYPE user_role AS ENUM (
  'super_admin',
  'admin_sucursal',
  'operador',
  'lector_reportes'
);

CREATE TABLE usuario_perfil (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  sucursal_id   uuid REFERENCES sucursal(id),
  rol           user_role NOT NULL,
  nombre        text NOT NULL,
  email         text NOT NULL UNIQUE,
  activo        boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),

  CONSTRAINT sucursal_required_unless_super_admin
    CHECK (
      (rol = 'super_admin' AND sucursal_id IS NULL)
      OR (rol <> 'super_admin' AND sucursal_id IS NOT NULL)
    )
);

CREATE INDEX idx_usuario_sucursal ON usuario_perfil(sucursal_id) WHERE activo = true;
CREATE INDEX idx_usuario_tenant ON usuario_perfil(tenant_id) WHERE activo = true;

CREATE TRIGGER usuario_perfil_updated_at
  BEFORE UPDATE ON usuario_perfil
  FOR EACH ROW EXECUTE FUNCTION trg_updated_at();

-- Helpers RLS (security definer)
CREATE OR REPLACE FUNCTION auth.user_rol() RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rol FROM usuario_perfil WHERE id = auth.uid() AND activo = true;
$$;

CREATE OR REPLACE FUNCTION auth.user_sucursal_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sucursal_id FROM usuario_perfil WHERE id = auth.uid() AND activo = true;
$$;

CREATE OR REPLACE FUNCTION auth.user_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM usuario_perfil WHERE id = auth.uid() AND activo = true;
$$;

CREATE OR REPLACE FUNCTION auth.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuario_perfil
    WHERE id = auth.uid() AND rol = 'super_admin' AND activo = true
  );
$$;

CREATE OR REPLACE FUNCTION auth.is_admin_or_super() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuario_perfil
    WHERE id = auth.uid()
      AND activo = true
      AND rol IN ('super_admin', 'admin_sucursal')
  );
$$;

-- RLS habilitado + policies
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_perfil ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_own ON tenant FOR SELECT
  USING (id = auth.user_tenant_id());

CREATE POLICY sucursal_select ON sucursal FOR SELECT
  USING (
    tenant_id = auth.user_tenant_id()
    AND (auth.is_super_admin() OR id = auth.user_sucursal_id())
  );

CREATE POLICY usuario_perfil_select ON usuario_perfil FOR SELECT
  USING (
    id = auth.uid()
    OR (
      tenant_id = auth.user_tenant_id()
      AND (
        auth.is_super_admin()
        OR (auth.user_rol() = 'admin_sucursal' AND sucursal_id = auth.user_sucursal_id())
      )
    )
  );

CREATE POLICY usuario_perfil_insert ON usuario_perfil FOR INSERT
  WITH CHECK (
    tenant_id = auth.user_tenant_id()
    AND (
      auth.is_super_admin()
      OR (
        auth.user_rol() = 'admin_sucursal'
        AND sucursal_id = auth.user_sucursal_id()
        AND rol IN ('operador', 'lector_reportes')
      )
    )
  );

CREATE POLICY usuario_perfil_update ON usuario_perfil FOR UPDATE
  USING (
    auth.is_super_admin()
    OR (
      auth.user_rol() = 'admin_sucursal'
      AND sucursal_id = auth.user_sucursal_id()
      AND rol IN ('operador', 'lector_reportes')
    )
    OR id = auth.uid()
  );

-- ====== VERIFICACIÓN ======
SELECT
  (SELECT count(*) FROM tenant) AS tenants_creados,
  (SELECT count(*) FROM sucursal) AS sucursales_creadas,
  (SELECT array_agg(nombre ORDER BY nombre) FROM sucursal) AS nombres_sucursales,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'auth'::regnamespace
    AND proname IN ('user_rol', 'user_sucursal_id', 'user_tenant_id', 'is_super_admin', 'is_admin_or_super')
  ) AS helpers_rls_creados;
-- Esperado: 1 tenant · 3 sucursales · 5 helpers RLS
