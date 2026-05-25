-- Migration: 004 — producto_catalogo + codigo_barras + precio_local + RLS + seed
-- Sprint 2 · 2-jun-2026
-- Especificación: ../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/03-modelo-datos.md

-- =====================================================
-- PRODUCTO_CATALOGO (compartido a nivel cadena/tenant)
-- =====================================================

CREATE TABLE producto_catalogo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  sku_interno       text,
  nombre            text NOT NULL,
  presentacion      text,
  laboratorio       text,
  principio_activo  text,
  categoria         text,
  requiere_receta   boolean DEFAULT false,
  activo            boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX idx_producto_tenant
  ON producto_catalogo(tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_producto_nombre_trgm
  ON producto_catalogo USING gin (nombre gin_trgm_ops);

CREATE TRIGGER producto_catalogo_updated_at
  BEFORE UPDATE ON producto_catalogo
  FOR EACH ROW EXECUTE FUNCTION public.trg_updated_at();

COMMENT ON TABLE producto_catalogo IS
  'Catálogo maestro de productos a nivel cadena. Cada producto puede tener N códigos de barras y N precios por sucursal.';

-- =====================================================
-- CODIGO_BARRAS (GTIN-13 típicamente — N por producto)
-- =====================================================

CREATE TABLE codigo_barras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id   uuid NOT NULL REFERENCES producto_catalogo(id) ON DELETE CASCADE,
  gtin          text NOT NULL UNIQUE,
  es_unidad     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_gtin ON codigo_barras(gtin);

COMMENT ON TABLE codigo_barras IS
  'GTIN del producto. Un producto puede tener varios (unidad + caja). gtin es UNIQUE global.';

-- =====================================================
-- PRECIO_LOCAL (precio sin IGV por producto y sucursal,
-- con historial via vigente_desde / vigente_hasta)
-- =====================================================

CREATE TABLE precio_local (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id     uuid NOT NULL REFERENCES producto_catalogo(id) ON DELETE CASCADE,
  sucursal_id     uuid NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
  precio_compra   numeric(10,4),
  precio_sin_igv  numeric(10,4) NOT NULL,
  igv             numeric(10,4) GENERATED ALWAYS AS (round(precio_sin_igv * 0.18, 4)) STORED,
  precio_total    numeric(10,4) GENERATED ALWAYS AS (round(precio_sin_igv * 1.18, 4)) STORED,
  vigente_desde   timestamptz DEFAULT now(),
  vigente_hasta   timestamptz,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (producto_id, sucursal_id, vigente_desde)
);

CREATE INDEX idx_precio_vigente
  ON precio_local(producto_id, sucursal_id)
  WHERE vigente_hasta IS NULL;

COMMENT ON TABLE precio_local IS
  'Precio del producto por sucursal con historial. Solo el row con vigente_hasta IS NULL es el activo.';

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE producto_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE codigo_barras     ENABLE ROW LEVEL SECURITY;
ALTER TABLE precio_local      ENABLE ROW LEVEL SECURITY;

-- PRODUCTO_CATALOGO: todos los usuarios del tenant ven el catálogo;
-- solo super_admin y admin_sucursal escriben
CREATE POLICY producto_catalogo_select ON producto_catalogo FOR SELECT
  USING (tenant_id = public.auth_user_tenant_id());

CREATE POLICY producto_catalogo_insert ON producto_catalogo FOR INSERT
  WITH CHECK (
    tenant_id = public.auth_user_tenant_id()
    AND public.auth_is_admin_or_super()
  );

CREATE POLICY producto_catalogo_update ON producto_catalogo FOR UPDATE
  USING (
    tenant_id = public.auth_user_tenant_id()
    AND public.auth_is_admin_or_super()
  );

-- CODIGO_BARRAS: derivada del producto
CREATE POLICY codigo_barras_select ON codigo_barras FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM producto_catalogo p
      WHERE p.id = codigo_barras.producto_id
        AND p.tenant_id = public.auth_user_tenant_id()
    )
  );

CREATE POLICY codigo_barras_insert ON codigo_barras FOR INSERT
  WITH CHECK (
    public.auth_is_admin_or_super()
    AND EXISTS (
      SELECT 1 FROM producto_catalogo p
      WHERE p.id = codigo_barras.producto_id
        AND p.tenant_id = public.auth_user_tenant_id()
    )
  );

CREATE POLICY codigo_barras_update ON codigo_barras FOR UPDATE
  USING (
    public.auth_is_admin_or_super()
    AND EXISTS (
      SELECT 1 FROM producto_catalogo p
      WHERE p.id = codigo_barras.producto_id
        AND p.tenant_id = public.auth_user_tenant_id()
    )
  );

-- PRECIO_LOCAL: cada sucursal ve sus precios; super_admin ve todos
CREATE POLICY precio_local_select ON precio_local FOR SELECT
  USING (
    public.auth_is_super_admin()
    OR sucursal_id = public.auth_user_sucursal_id()
  );

CREATE POLICY precio_local_insert ON precio_local FOR INSERT
  WITH CHECK (
    public.auth_is_admin_or_super()
    AND (
      public.auth_is_super_admin()
      OR sucursal_id = public.auth_user_sucursal_id()
    )
  );

CREATE POLICY precio_local_update ON precio_local FOR UPDATE
  USING (
    public.auth_is_admin_or_super()
    AND (
      public.auth_is_super_admin()
      OR sucursal_id = public.auth_user_sucursal_id()
    )
  );

-- =====================================================
-- SEED — 10 SKUs hardcoded para validar CRUD + venta sprint 3
-- (se reemplazan cuando importemos dataset DIGEMID en stream B)
-- =====================================================

DO $$
DECLARE
  v_tenant_id    uuid;
  v_suc_ves      uuid;
  v_suc_chz_pto  uuid;
  v_suc_chz_pza  uuid;

  -- IDs de producto que reutilizamos para insert de gtin y precio
  v_postday      uuid;
  v_portil       uuid;
  v_sildex       uuid;
  v_para_500     uuid;
  v_ibu_400      uuid;
  v_diclo_gel    uuid;
  v_loratadina   uuid;
  v_omeprazol    uuid;
  v_bromhexina   uuid;
  v_amoxicilina  uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM tenant WHERE nombre_comercial = 'Botica Huayruro';
  SELECT id INTO v_suc_ves     FROM sucursal WHERE nombre = 'Huayruro VES';
  SELECT id INTO v_suc_chz_pto FROM sucursal WHERE nombre = 'Huayruro Chazuta Puerto';
  SELECT id INTO v_suc_chz_pza FROM sucursal WHERE nombre = 'Huayruro Chazuta Plaza';

  -- Insertar productos
  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Postday', 'Caja x 1 tab', 'Lafrancol', 'Levonorgestrel 1.5 mg', 'Anticonceptivo emergencia', false)
  RETURNING id INTO v_postday;

  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Portil Crema', 'Tubo 20 g', 'Farmindustria', 'Mometasona furoato 0.1%', 'Dermatológico', false)
  RETURNING id INTO v_portil;

  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Sildex 50 mg', 'Caja x 1 tab', 'Genfar', 'Sildenafilo 50 mg', 'Disfunción eréctil', false)
  RETURNING id INTO v_sildex;

  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Paracetamol 500 mg', 'Tableta unidad', 'Genérico Mifarma', 'Paracetamol 500 mg', 'Analgésico', false)
  RETURNING id INTO v_para_500;

  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Ibuprofeno 400 mg', 'Tableta unidad', 'Genérico Mifarma', 'Ibuprofeno 400 mg', 'Antiinflamatorio', false)
  RETURNING id INTO v_ibu_400;

  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Diclofenaco Gel', 'Tubo 30 g', 'Bayer', 'Diclofenaco dietilamonio 1.16%', 'Antiinflamatorio tópico', false)
  RETURNING id INTO v_diclo_gel;

  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Loratadina 10 mg', 'Tableta unidad', 'Genérico Inkafarma', 'Loratadina 10 mg', 'Antihistamínico', false)
  RETURNING id INTO v_loratadina;

  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Omeprazol 20 mg', 'Cápsula unidad', 'Genérico Mifarma', 'Omeprazol 20 mg', 'Antiulceroso', false)
  RETURNING id INTO v_omeprazol;

  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Bromhexina Jarabe', 'Frasco 120 ml', 'Boehringer', 'Bromhexina 4 mg/5 ml', 'Mucolítico', false)
  RETURNING id INTO v_bromhexina;

  INSERT INTO producto_catalogo (tenant_id, nombre, presentacion, laboratorio, principio_activo, categoria, requiere_receta)
  VALUES (v_tenant_id, 'Amoxicilina 500 mg', 'Cápsula unidad', 'Genérico Medifarma', 'Amoxicilina 500 mg', 'Antibiótico', true)
  RETURNING id INTO v_amoxicilina;

  -- Insertar códigos de barras (GTIN-13 ficticios, prefijo 779 = Perú)
  INSERT INTO codigo_barras (producto_id, gtin) VALUES
    (v_postday,     '7790001000017'),
    (v_portil,      '7790001000024'),
    (v_sildex,      '7790001000031'),
    (v_para_500,    '7790001000048'),
    (v_ibu_400,     '7790001000055'),
    (v_diclo_gel,   '7790001000062'),
    (v_loratadina,  '7790001000079'),
    (v_omeprazol,   '7790001000086'),
    (v_bromhexina,  '7790001000093'),
    (v_amoxicilina, '7790001000109');

  -- Precios por sucursal — usamos los valores confirmados por Kevin
  -- (precios sin IGV; IGV se calcula automáticamente como columna generada).
  -- Para los productos con precio confirmado en propuesta, el "precio sin IGV"
  -- = precio_venta_total / 1.18. Ej: Postday venta S/15 → sin IGV S/12.71
  -- Mientras Kevin no formalice IGV, el precio_total mostrado al cliente es 15.

  -- Helper local: aplicamos los mismos precios a las 3 sucursales por simplicidad
  -- (la cadena Huayruro mantiene precios uniformes hoy). En el futuro pueden divergir.

  -- VES
  INSERT INTO precio_local (producto_id, sucursal_id, precio_compra, precio_sin_igv) VALUES
    (v_postday,     v_suc_ves, 2.00, 12.7119),
    (v_portil,      v_suc_ves, 2.20, 5.0847),
    (v_sildex,      v_suc_ves, 1.20, 4.2373),
    (v_para_500,    v_suc_ves, 0.30, 1.2712),
    (v_ibu_400,     v_suc_ves, 0.40, 1.5254),
    (v_diclo_gel,   v_suc_ves, 4.00, 10.1695),
    (v_loratadina,  v_suc_ves, 0.50, 1.6949),
    (v_omeprazol,   v_suc_ves, 0.40, 1.6949),
    (v_bromhexina,  v_suc_ves, 3.00, 6.7797),
    (v_amoxicilina, v_suc_ves, 0.80, 2.5424);

  -- Chazuta Puerto
  INSERT INTO precio_local (producto_id, sucursal_id, precio_compra, precio_sin_igv) VALUES
    (v_postday,     v_suc_chz_pto, 2.00, 12.7119),
    (v_portil,      v_suc_chz_pto, 2.20, 5.0847),
    (v_sildex,      v_suc_chz_pto, 1.20, 4.2373),
    (v_para_500,    v_suc_chz_pto, 0.30, 1.2712),
    (v_ibu_400,     v_suc_chz_pto, 0.40, 1.5254),
    (v_diclo_gel,   v_suc_chz_pto, 4.00, 10.1695),
    (v_loratadina,  v_suc_chz_pto, 0.50, 1.6949),
    (v_omeprazol,   v_suc_chz_pto, 0.40, 1.6949),
    (v_bromhexina,  v_suc_chz_pto, 3.00, 6.7797),
    (v_amoxicilina, v_suc_chz_pto, 0.80, 2.5424);

  -- Chazuta Plaza
  INSERT INTO precio_local (producto_id, sucursal_id, precio_compra, precio_sin_igv) VALUES
    (v_postday,     v_suc_chz_pza, 2.00, 12.7119),
    (v_portil,      v_suc_chz_pza, 2.20, 5.0847),
    (v_sildex,      v_suc_chz_pza, 1.20, 4.2373),
    (v_para_500,    v_suc_chz_pza, 0.30, 1.2712),
    (v_ibu_400,     v_suc_chz_pza, 0.40, 1.5254),
    (v_diclo_gel,   v_suc_chz_pza, 4.00, 10.1695),
    (v_loratadina,  v_suc_chz_pza, 0.50, 1.6949),
    (v_omeprazol,   v_suc_chz_pza, 0.40, 1.6949),
    (v_bromhexina,  v_suc_chz_pza, 3.00, 6.7797),
    (v_amoxicilina, v_suc_chz_pza, 0.80, 2.5424);
END $$;
