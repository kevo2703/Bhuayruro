-- Migration: 003 — usuario_perfil + roles + helpers RLS
-- Sprint 2 · 2-jun-2026
-- Especificación: ../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/03-modelo-datos.md (sección usuario_perfil + RLS)

-- =====================================================
-- ROLES del sistema (Decisión Opción B — propuesta sec. 11)
-- =====================================================

CREATE TYPE user_role AS ENUM (
  'super_admin',     -- Kevin: ve toda la cadena, admin cross-sucursal
  'admin_sucursal',  -- Kevin VES, papá Chazuta puerto, mamá Chazuta plaza
  'operador',        -- vendedor empleado (futuro)
  'lector_reportes'  -- usuario read-only (asesor, contador externo)
);

-- =====================================================
-- USUARIO_PERFIL (linkeado 1:1 con auth.users de Supabase)
-- =====================================================

CREATE TABLE usuario_perfil (
  id            uuid PRIMARY KEY,                              -- = auth.users.id
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  sucursal_id   uuid REFERENCES sucursal(id),                  -- NULL si super_admin
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

COMMENT ON TABLE usuario_perfil IS
  'Perfil extendido de auth.users. Define rol + sucursal del operador. super_admin tiene sucursal_id NULL.';

-- =====================================================
-- FUNCIONES HELPER para RLS (security definer, cacheables)
-- =====================================================

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

COMMENT ON FUNCTION auth.user_rol() IS
  'Rol del usuario autenticado. NULL si no hay sesión o no tiene perfil activo.';

-- =====================================================
-- RLS — habilitar y crear policies para usuario_perfil
-- (las policies de las demás tablas se crean en migrations posteriores)
-- =====================================================

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_perfil ENABLE ROW LEVEL SECURITY;

-- TENANT: cada usuario ve su propio tenant
CREATE POLICY tenant_select_own ON tenant FOR SELECT
  USING (id = auth.user_tenant_id());

-- SUCURSAL: super_admin ve todas su tenant; admin/operador ve solo la suya
CREATE POLICY sucursal_select ON sucursal FOR SELECT
  USING (
    tenant_id = auth.user_tenant_id()
    AND (
      auth.is_super_admin()
      OR id = auth.user_sucursal_id()
    )
  );

-- USUARIO_PERFIL: cada uno ve su propio perfil; super_admin ve los de su cadena;
-- admin_sucursal ve los de su sucursal
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

-- INSERT/UPDATE de usuario_perfil solo lo hace super_admin o admin_sucursal de la misma sucursal
CREATE POLICY usuario_perfil_insert ON usuario_perfil FOR INSERT
  WITH CHECK (
    tenant_id = auth.user_tenant_id()
    AND (
      auth.is_super_admin()
      OR (
        auth.user_rol() = 'admin_sucursal'
        AND sucursal_id = auth.user_sucursal_id()
        AND rol IN ('operador', 'lector_reportes')   -- admin_sucursal NO puede crear otros admins
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
    OR id = auth.uid()  -- cada uno puede actualizar su propio perfil (limitado por column-level si fuera necesario)
  );

-- =====================================================
-- Trigger: al crear auth.users, crear stub de usuario_perfil
-- (en MVP la creación va siempre desde admin invitando — pero
--  preparamos el trigger por si se habilita signup)
-- =====================================================

-- NOTA: el trigger se agrega en una migration posterior una vez definidos
-- los flujos de invitación. En MVP el admin crea el usuario_perfil
-- manualmente desde el panel (sprint 2).
