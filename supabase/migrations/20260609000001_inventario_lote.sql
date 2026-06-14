-- Migration: 005 — inventario_local + lote + audit_log
-- Sprint 3 · 9-jun-2026

-- =====================================================
-- INVENTARIO_LOCAL — stock vivo por producto y sucursal
-- =====================================================

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

-- =====================================================
-- LOTE — DIGEMID requiere control por lote y vencimiento
-- =====================================================

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

-- =====================================================
-- AUDIT_LOG — eventos sensibles para trazabilidad LPDP
-- =====================================================

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

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE inventario_local ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;

-- INVENTARIO: cada sucursal ve su stock; super_admin ve todo
CREATE POLICY inventario_local_select ON inventario_local FOR SELECT
  USING (
    public.auth_is_super_admin()
    OR sucursal_id = public.auth_user_sucursal_id()
  );

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

-- LOTE: derivada del inventario
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

-- AUDIT LOG: solo super_admin lee; los INSERT vienen vía RPC security definer
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (public.auth_is_super_admin());

-- INSERT/UPDATE: solo via SECURITY DEFINER functions (no policy = bloqueado para client)
