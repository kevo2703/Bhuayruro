-- Migration: 002 — tenant + sucursal
-- Sprint 2 · 2-jun-2026
-- Especificación: ../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/03-modelo-datos.md

-- =====================================================
-- TENANT (cadena comercial — Botica Huayruro es 1 tenant)
-- =====================================================

CREATE TABLE tenant (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  nombre            text NOT NULL,
  nombre_comercial  text NOT NULL,
  ruc               text,                       -- nullable hasta formalización fase 4
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

COMMENT ON TABLE tenant IS
  'Cadena comercial. Botica Huayruro es 1 tenant; futuros clientes externos serían tenants distintos.';

-- =====================================================
-- SUCURSAL (local físico — 3 hoy: VES + Chazuta puerto + Chazuta plaza)
-- =====================================================

CREATE TABLE sucursal (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
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

COMMENT ON TABLE sucursal IS
  'Local físico bajo una cadena (tenant). El sistema separa datos por sucursal_id vía RLS.';

-- =====================================================
-- Trigger updated_at universal (reutilizado por más tablas)
-- =====================================================

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

-- =====================================================
-- Seed inicial — cadena Botica Huayruro + 3 sucursales
-- (en supabase/seed.sql se completa con usuarios cuando exista auth)
-- =====================================================

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  INSERT INTO tenant (nombre, nombre_comercial)
  VALUES ('Cadena Botica Huayruro', 'Botica Huayruro')
  RETURNING id INTO v_tenant_id;

  INSERT INTO sucursal (tenant_id, nombre, direccion) VALUES
    (v_tenant_id, 'Huayruro VES',          'Av. Revolución × Av. Las Lomas, Villa El Salvador, Lima'),
    (v_tenant_id, 'Huayruro Chazuta Puerto', 'Chazuta — Puerto, San Martín'),
    (v_tenant_id, 'Huayruro Chazuta Plaza',  'Chazuta — Plaza, San Martín');
END $$;
