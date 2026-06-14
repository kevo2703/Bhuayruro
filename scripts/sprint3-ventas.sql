-- ============================================================
-- SCRIPT SPRINT 3 — Inventario + lotes + ventas + RPC registrar_venta
-- ============================================================
-- Generado: 2026-05-25
-- Idempotente: DROP TABLE IF EXISTS CASCADE al inicio.
--
-- PRECONDICIÓN: sprint1 + sprint2 ya corrieron
-- (tablas tenant, sucursal, usuario_perfil, producto_catalogo,
--  codigo_barras, precio_local + helpers public.auth_* existen).
--
-- USO:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Pegar este archivo entero → Run
--   3. Verificar SELECT final
-- ============================================================

-- ====== CLEANUP (idempotente) ======

DROP FUNCTION IF EXISTS public.anular_venta(uuid, text)         CASCADE;
DROP FUNCTION IF EXISTS public.registrar_venta(jsonb)           CASCADE;
DROP FUNCTION IF EXISTS public.trg_venta_item_descuenta_stock() CASCADE;

DROP TABLE IF EXISTS venta_item       CASCADE;
DROP TABLE IF EXISTS venta            CASCADE;
DROP TYPE  IF EXISTS metodo_pago      CASCADE;

DROP TABLE IF EXISTS audit_log        CASCADE;
DROP TABLE IF EXISTS lote             CASCADE;
DROP TABLE IF EXISTS inventario_local CASCADE;

-- ====== INVENTARIO_LOCAL ======

CREATE TABLE inventario_local (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id    uuid NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
  producto_id    uuid NOT NULL REFERENCES producto_catalogo(id) ON DELETE RESTRICT,
  stock_unidades integer NOT NULL DEFAULT 0,
  stock_minimo   integer DEFAULT 0,
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (sucursal_id, producto_id)
);

CREATE INDEX idx_inventario_sucursal ON inventario_local(sucursal_id);

-- ====== LOTE ======

CREATE TABLE lote (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id     uuid NOT NULL REFERENCES inventario_local(id) ON DELETE CASCADE,
  numero_lote       text NOT NULL,
  fecha_vencimiento date NOT NULL,
  unidades          integer NOT NULL DEFAULT 0,
  proveedor         text,
  fecha_recepcion   date NOT NULL DEFAULT CURRENT_DATE,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_lote_vencimiento ON lote(fecha_vencimiento);
CREATE INDEX idx_lote_inventario  ON lote(inventario_id);

CREATE TRIGGER lote_updated_at
  BEFORE UPDATE ON lote
  FOR EACH ROW EXECUTE FUNCTION public.trg_updated_at();

-- ====== AUDIT_LOG ======

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  sucursal_id   uuid REFERENCES sucursal(id),
  usuario_id    uuid REFERENCES usuario_perfil(id),
  accion        text NOT NULL,
  recurso       text,
  recurso_id    uuid,
  datos_antes   jsonb,
  datos_despues jsonb,
  ip_origen     inet,
  user_agent    text,
  fecha_hora    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_usuario_fecha ON audit_log(usuario_id, fecha_hora DESC);
CREATE INDEX idx_audit_recurso       ON audit_log(recurso, recurso_id);

-- ====== METODO_PAGO + VENTA + VENTA_ITEM ======

CREATE TYPE metodo_pago AS ENUM (
  'efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'otro'
);

CREATE TABLE venta (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid       uuid NOT NULL UNIQUE,
  sucursal_id       uuid NOT NULL REFERENCES sucursal(id),
  operador_id       uuid REFERENCES usuario_perfil(id),
  fecha_hora        timestamptz NOT NULL DEFAULT now(),
  subtotal_sin_igv  numeric(10,2) NOT NULL,
  igv_total         numeric(10,2) NOT NULL,
  total             numeric(10,2) NOT NULL,
  metodo_pago       metodo_pago NOT NULL,
  estado            text NOT NULL DEFAULT 'completada',
  observaciones     text,
  sunat_estado      text,
  sunat_serie       text,
  sunat_numero      integer,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_venta_sucursal_fecha ON venta(sucursal_id, fecha_hora DESC);
CREATE INDEX idx_venta_client_uuid    ON venta(client_uuid);

CREATE TRIGGER venta_updated_at
  BEFORE UPDATE ON venta
  FOR EACH ROW EXECUTE FUNCTION public.trg_updated_at();

CREATE TABLE venta_item (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id                 uuid NOT NULL REFERENCES venta(id) ON DELETE CASCADE,
  producto_id              uuid NOT NULL REFERENCES producto_catalogo(id),
  lote_id                  uuid REFERENCES lote(id),
  cantidad                 numeric(10,3) NOT NULL,
  precio_sin_igv_unitario  numeric(10,4) NOT NULL,
  igv_unitario             numeric(10,4) NOT NULL,
  precio_total_unitario    numeric(10,4) NOT NULL,
  subtotal_sin_igv         numeric(10,2) NOT NULL,
  igv_subtotal             numeric(10,2) NOT NULL,
  total                    numeric(10,2) NOT NULL,
  created_at               timestamptz DEFAULT now()
);

CREATE INDEX idx_venta_item_venta    ON venta_item(venta_id);
CREATE INDEX idx_venta_item_producto ON venta_item(producto_id);

-- ====== RLS ======

ALTER TABLE inventario_local ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE venta            ENABLE ROW LEVEL SECURITY;
ALTER TABLE venta_item       ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventario_local_select ON inventario_local FOR SELECT
  USING (public.auth_is_super_admin() OR sucursal_id = public.auth_user_sucursal_id());

CREATE POLICY inventario_local_insert ON inventario_local FOR INSERT
  WITH CHECK (
    public.auth_is_admin_or_super()
    AND (public.auth_is_super_admin() OR sucursal_id = public.auth_user_sucursal_id())
  );

CREATE POLICY inventario_local_update ON inventario_local FOR UPDATE
  USING (
    public.auth_is_admin_or_super()
    AND (public.auth_is_super_admin() OR sucursal_id = public.auth_user_sucursal_id())
  );

CREATE POLICY lote_select ON lote FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM inventario_local i
      WHERE i.id = lote.inventario_id
        AND (public.auth_is_super_admin() OR i.sucursal_id = public.auth_user_sucursal_id())
    )
  );

CREATE POLICY lote_insert ON lote FOR INSERT
  WITH CHECK (
    public.auth_is_admin_or_super()
    AND EXISTS (
      SELECT 1 FROM inventario_local i
      WHERE i.id = lote.inventario_id
        AND (public.auth_is_super_admin() OR i.sucursal_id = public.auth_user_sucursal_id())
    )
  );

CREATE POLICY lote_update ON lote FOR UPDATE
  USING (
    public.auth_is_admin_or_super()
    AND EXISTS (
      SELECT 1 FROM inventario_local i
      WHERE i.id = lote.inventario_id
        AND (public.auth_is_super_admin() OR i.sucursal_id = public.auth_user_sucursal_id())
    )
  );

CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (public.auth_is_super_admin());

CREATE POLICY venta_select ON venta FOR SELECT
  USING (public.auth_is_super_admin() OR sucursal_id = public.auth_user_sucursal_id());

CREATE POLICY venta_update ON venta FOR UPDATE
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_user_rol() = 'admin_sucursal'
      AND sucursal_id = public.auth_user_sucursal_id()
    )
  );

CREATE POLICY venta_item_select ON venta_item FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM venta v
      WHERE v.id = venta_item.venta_id
        AND (public.auth_is_super_admin() OR v.sucursal_id = public.auth_user_sucursal_id())
    )
  );

-- ====== TRIGGER descuento stock ======

CREATE OR REPLACE FUNCTION public.trg_venta_item_descuenta_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_sucursal_id uuid;
BEGIN
  SELECT sucursal_id INTO v_sucursal_id FROM venta WHERE id = NEW.venta_id;

  INSERT INTO inventario_local (sucursal_id, producto_id, stock_unidades)
  VALUES (v_sucursal_id, NEW.producto_id, -NEW.cantidad)
  ON CONFLICT (sucursal_id, producto_id) DO UPDATE
    SET stock_unidades = inventario_local.stock_unidades - NEW.cantidad,
        updated_at = now();

  IF NEW.lote_id IS NOT NULL THEN
    UPDATE lote SET unidades = unidades - NEW.cantidad, updated_at = now()
    WHERE id = NEW.lote_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER venta_item_descuenta_stock
  AFTER INSERT ON venta_item
  FOR EACH ROW EXECUTE FUNCTION public.trg_venta_item_descuenta_stock();

-- ====== RPC registrar_venta ======

CREATE OR REPLACE FUNCTION public.registrar_venta(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_uuid uuid := (payload->>'client_uuid')::uuid;
  v_sucursal_id uuid := (payload->>'sucursal_id')::uuid;
  v_venta_id    uuid;
  v_existing_id uuid;
  v_subtotal    numeric(10,2) := 0;
  v_igv_total   numeric(10,2) := 0;
  v_total       numeric(10,2) := 0;
  item          jsonb;
  v_user_suc    uuid;
BEGIN
  IF v_client_uuid IS NULL THEN
    RAISE EXCEPTION 'client_uuid requerido' USING ERRCODE = '22023';
  END IF;
  IF v_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'sucursal_id requerido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(COALESCE(payload->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items[] vacío' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing_id FROM venta WHERE client_uuid = v_client_uuid;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'venta_id', v_existing_id,
      'idempotent', true,
      'total', (SELECT total FROM venta WHERE id = v_existing_id)
    );
  END IF;

  v_user_suc := public.auth_user_sucursal_id();
  IF NOT (public.auth_is_super_admin() OR v_sucursal_id = v_user_suc) THEN
    RAISE EXCEPTION 'forbidden: no podés registrar venta en sucursal ajena' USING ERRCODE = '42501';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
  LOOP
    v_subtotal := v_subtotal + (item->>'cantidad')::numeric * (item->>'precio_sin_igv_unitario')::numeric;
  END LOOP;
  v_igv_total := round(v_subtotal * 0.18, 2);
  v_total     := round(v_subtotal + v_igv_total, 2);

  INSERT INTO venta (
    client_uuid, sucursal_id, operador_id, fecha_hora, metodo_pago,
    subtotal_sin_igv, igv_total, total, observaciones
  )
  VALUES (
    v_client_uuid,
    v_sucursal_id,
    auth.uid(),
    COALESCE(NULLIF(payload->>'fecha_hora_cliente','')::timestamptz, now()),
    (payload->>'metodo_pago')::metodo_pago,
    v_subtotal,
    v_igv_total,
    v_total,
    NULLIF(payload->>'observaciones','')
  )
  RETURNING id INTO v_venta_id;

  INSERT INTO venta_item (
    venta_id, producto_id, lote_id, cantidad,
    precio_sin_igv_unitario, igv_unitario, precio_total_unitario,
    subtotal_sin_igv, igv_subtotal, total
  )
  SELECT
    v_venta_id,
    (it->>'producto_id')::uuid,
    NULLIF(it->>'lote_id','')::uuid,
    (it->>'cantidad')::numeric,
    (it->>'precio_sin_igv_unitario')::numeric,
    round((it->>'precio_sin_igv_unitario')::numeric * 0.18, 4),
    round((it->>'precio_sin_igv_unitario')::numeric * 1.18, 4),
    round((it->>'cantidad')::numeric * (it->>'precio_sin_igv_unitario')::numeric, 2),
    round((it->>'cantidad')::numeric * (it->>'precio_sin_igv_unitario')::numeric * 0.18, 2),
    round((it->>'cantidad')::numeric * (it->>'precio_sin_igv_unitario')::numeric * 1.18, 2)
  FROM jsonb_array_elements(payload->'items') AS it;

  INSERT INTO audit_log (tenant_id, sucursal_id, usuario_id, accion, recurso, recurso_id, datos_despues)
  VALUES (
    public.auth_user_tenant_id(), v_sucursal_id, auth.uid(),
    'venta_registrada', 'venta', v_venta_id, payload
  );

  RETURN jsonb_build_object(
    'venta_id', v_venta_id,
    'total', v_total,
    'subtotal_sin_igv', v_subtotal,
    'igv_total', v_igv_total,
    'fecha_hora_servidor', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_venta(jsonb) TO authenticated;

-- ====== RPC anular_venta ======

CREATE OR REPLACE FUNCTION public.anular_venta(p_venta_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado text;
  v_sucursal_id uuid;
  item record;
BEGIN
  SELECT estado, sucursal_id INTO v_estado, v_sucursal_id FROM venta WHERE id = p_venta_id;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'venta no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_estado = 'anulada' THEN
    RAISE EXCEPTION 'venta ya está anulada' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.auth_is_super_admin()
          OR (public.auth_user_rol() = 'admin_sucursal'
              AND public.auth_user_sucursal_id() = v_sucursal_id)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE venta SET estado = 'anulada', observaciones = p_motivo, updated_at = now()
  WHERE id = p_venta_id;

  FOR item IN SELECT producto_id, lote_id, cantidad FROM venta_item WHERE venta_id = p_venta_id
  LOOP
    INSERT INTO inventario_local (sucursal_id, producto_id, stock_unidades)
    VALUES (v_sucursal_id, item.producto_id, item.cantidad)
    ON CONFLICT (sucursal_id, producto_id) DO UPDATE
      SET stock_unidades = inventario_local.stock_unidades + item.cantidad,
          updated_at = now();

    IF item.lote_id IS NOT NULL THEN
      UPDATE lote SET unidades = unidades + item.cantidad WHERE id = item.lote_id;
    END IF;
  END LOOP;

  INSERT INTO audit_log (tenant_id, sucursal_id, usuario_id, accion, recurso, recurso_id, datos_despues)
  VALUES (
    public.auth_user_tenant_id(), v_sucursal_id, auth.uid(),
    'venta_anulada', 'venta', p_venta_id, jsonb_build_object('motivo', p_motivo)
  );

  RETURN jsonb_build_object('venta_id', p_venta_id, 'estado', 'anulada');
END;
$$;

GRANT EXECUTE ON FUNCTION public.anular_venta(uuid, text) TO authenticated;

-- ====== SEED inicial de stock — 50 unidades de cada SKU en cada sucursal ======

DO $$
DECLARE
  v_suc record;
  v_prod record;
BEGIN
  FOR v_suc IN SELECT id FROM sucursal WHERE deleted_at IS NULL LOOP
    FOR v_prod IN SELECT id FROM producto_catalogo WHERE deleted_at IS NULL LOOP
      INSERT INTO inventario_local (sucursal_id, producto_id, stock_unidades, stock_minimo)
      VALUES (v_suc.id, v_prod.id, 50, 10)
      ON CONFLICT (sucursal_id, producto_id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- ====== VERIFICACIÓN ======

SELECT
  (SELECT count(*) FROM inventario_local)               AS inventario_filas,
  (SELECT sum(stock_unidades) FROM inventario_local)    AS stock_total_inicial,
  (SELECT count(*) FROM venta)                          AS ventas_creadas,
  (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname IN ('registrar_venta', 'anular_venta', 'trg_venta_item_descuenta_stock')) AS rpcs_y_triggers;
-- Esperado: inventario_filas=30 (10 productos x 3 sucursales)
--           stock_total_inicial=1500 (30 x 50)
--           ventas_creadas=0
--           rpcs_y_triggers=3
