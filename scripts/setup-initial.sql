-- ============================================================
-- SCRIPT CONSOLIDADO INICIAL — Cadena Botica Huayruro
-- ============================================================
-- Generado: 2026-05-24 · v3
-- Cambios v3: helpers RLS en schema `public` (no `auth`).
--             Supabase reserva el schema auth — no tenemos permiso
--             desde el SQL Editor para crear funciones ahí.
-- Idempotente: limpia estado previo + recrea desde cero.
--
-- USO:
--   1. Abrir Supabase Dashboard → SQL Editor → New query
--   2. Pegar este archivo completo → Run
--   3. Resultado esperado en el SELECT final:
--      tenants_creados=1 · sucursales_creadas=3 · helpers_rls_creados=5
-- ============================================================

-- ====== CLEANUP — borra estado previo (idempotente, seguro en BD limpia) ======

DROP TABLE IF EXISTS usuario_perfil CASCADE;
DROP TABLE IF EXISTS sucursal CASCADE;
DROP TABLE IF EXISTS tenant CASCADE;

DROP TYPE IF EXISTS user_role CASCADE;

DROP FUNCTION IF EXISTS public.auth_is_admin_or_super() CASCADE;
DROP FUNCTION IF EXISTS public.auth_is_super_admin() CASCADE;
DROP FUNCTION IF EXISTS public.auth_user_tenant_id() CASCADE;
DROP FUNCTION IF EXISTS public.auth_user_sucursal_id() CASCADE;
DROP FUNCTION IF EXISTS public.auth_user_rol() CASCADE;

DROP FUNCTION IF EXISTS public.trg_updated_at() CASCADE;

-- ====== MIGRATION 001 — EXTENSIONES ======

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- NOTA UUID: usamos gen_random_uuid() (UUID v4 de pgcrypto). Cuando Supabase
-- pase a Postgres 17 (uuidv7() nativo), migrar. Decisión en docs/adr/006.

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

CREATE OR REPLACE FUNCTION public.trg_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_updated_at
  BEFORE UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION public.trg_updated_at();

CREATE TRIGGER sucursal_updated_at
  BEFORE UPDATE ON sucursal
  FOR EACH ROW EXECUTE FUNCTION public.trg_updated_at();

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
  FOR EACH ROW EXECUTE FUNCTION public.trg_updated_at();

-- ====== HELPERS RLS — en schema public (no auth)
-- Supabase reserva el schema auth; ponemos en public con prefijo auth_*

CREATE OR REPLACE FUNCTION public.auth_user_rol() RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rol FROM usuario_perfil WHERE id = auth.uid() AND activo = true;
$$;

CREATE OR REPLACE FUNCTION public.auth_user_sucursal_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sucursal_id FROM usuario_perfil WHERE id = auth.uid() AND activo = true;
$$;

CREATE OR REPLACE FUNCTION public.auth_user_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM usuario_perfil WHERE id = auth.uid() AND activo = true;
$$;

CREATE OR REPLACE FUNCTION public.auth_is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuario_perfil
    WHERE id = auth.uid() AND rol = 'super_admin' AND activo = true
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_is_admin_or_super() RETURNS boolean
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
  USING (id = public.auth_user_tenant_id());

CREATE POLICY sucursal_select ON sucursal FOR SELECT
  USING (
    tenant_id = public.auth_user_tenant_id()
    AND (public.auth_is_super_admin() OR id = public.auth_user_sucursal_id())
  );

CREATE POLICY usuario_perfil_select ON usuario_perfil FOR SELECT
  USING (
    id = auth.uid()
    OR (
      tenant_id = public.auth_user_tenant_id()
      AND (
        public.auth_is_super_admin()
        OR (public.auth_user_rol() = 'admin_sucursal' AND sucursal_id = public.auth_user_sucursal_id())
      )
    )
  );

CREATE POLICY usuario_perfil_insert ON usuario_perfil FOR INSERT
  WITH CHECK (
    tenant_id = public.auth_user_tenant_id()
    AND (
      public.auth_is_super_admin()
      OR (
        public.auth_user_rol() = 'admin_sucursal'
        AND sucursal_id = public.auth_user_sucursal_id()
        AND rol IN ('operador', 'lector_reportes')
      )
    )
  );

CREATE POLICY usuario_perfil_update ON usuario_perfil FOR UPDATE
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_user_rol() = 'admin_sucursal'
      AND sucursal_id = public.auth_user_sucursal_id()
      AND rol IN ('operador', 'lector_reportes')
    )
    OR id = auth.uid()
  );

-- ====== VERIFICACIÓN ======
SELECT
  (SELECT count(*) FROM tenant) AS tenants_creados,
  (SELECT count(*) FROM sucursal) AS sucursales_creadas,
  (SELECT array_agg(nombre ORDER BY nombre) FROM sucursal) AS nombres_sucursales,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('auth_user_rol', 'auth_user_sucursal_id', 'auth_user_tenant_id',
                    'auth_is_super_admin', 'auth_is_admin_or_super')
  ) AS helpers_rls_creados;
-- Esperado: 1 tenant · 3 sucursales · 5 helpers RLS
