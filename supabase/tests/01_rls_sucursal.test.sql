-- ============================================================
-- TEST 01 — RLS de sucursal y catálogo
-- ============================================================
-- Modelo: super_admin ve todas; admin_sucursal ve solo la suya;
-- el catálogo es compartido a nivel tenant.
--
-- Estos tests usan RAISE EXCEPTION para asertar (pgTAP no viene
-- en Supabase Cloud). Corren con `supabase test db` en local.
-- ============================================================

BEGIN;

-- ====== SETUP ======

-- Asumimos que el seed inicial corrió (1 tenant Botica Huayruro + 3 sucursales)
-- Si no, crear data mínima.
DO $$
DECLARE
  v_tenant_id    uuid;
  v_suc_ves      uuid;
  v_suc_chz_pto  uuid;
  v_kevin_id     uuid := '11111111-1111-1111-1111-111111111111';
  v_admin_ves_id uuid := '22222222-2222-2222-2222-222222222222';
  v_admin_chz_id uuid := '33333333-3333-3333-3333-333333333333';
BEGIN
  SELECT id INTO v_tenant_id    FROM tenant   WHERE nombre_comercial = 'Botica Huayruro';
  SELECT id INTO v_suc_ves      FROM sucursal WHERE nombre = 'Huayruro VES';
  SELECT id INTO v_suc_chz_pto  FROM sucursal WHERE nombre = 'Huayruro Chazuta Puerto';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PRECONDICIÓN FALLIDA: tenant Botica Huayruro no existe. Correr setup-initial.sql primero';
  END IF;

  -- Crear auth.users sintéticos para el test (solo si no existen)
  -- En BD productiva esto NO se debe hacer manualmente — usar Supabase Auth.
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES
    (v_kevin_id,     'kevin.test@huayruro.test',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_admin_ves_id, 'admin.ves.test@huayruro.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_admin_chz_id, 'admin.chz.test@huayruro.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  -- Crear usuario_perfil para los 3
  INSERT INTO usuario_perfil (id, tenant_id, sucursal_id, rol, nombre, email)
  VALUES
    (v_kevin_id,     v_tenant_id, NULL,         'super_admin',     'Kevin test',     'kevin.test@huayruro.test'),
    (v_admin_ves_id, v_tenant_id, v_suc_ves,    'admin_sucursal',  'Admin VES test', 'admin.ves.test@huayruro.test'),
    (v_admin_chz_id, v_tenant_id, v_suc_chz_pto,'admin_sucursal',  'Admin CHZ test', 'admin.chz.test@huayruro.test')
  ON CONFLICT (id) DO UPDATE SET
    sucursal_id = EXCLUDED.sucursal_id,
    rol         = EXCLUDED.rol,
    nombre      = EXCLUDED.nombre;
END $$;

-- ====== TEST 1: super_admin ve las 3 sucursales ======

DO $$
DECLARE
  v_kevin_id uuid := '11111111-1111-1111-1111-111111111111';
  v_count    int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_kevin_id::text)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM sucursal WHERE deleted_at IS NULL;
  IF v_count < 3 THEN
    RAISE EXCEPTION 'TEST 1 FAIL: super_admin debería ver >= 3 sucursales, vio %', v_count;
  END IF;
  RAISE NOTICE 'TEST 1 PASS: super_admin ve % sucursales', v_count;
END $$;

-- ====== TEST 2: admin_sucursal VES ve solo VES ======

DO $$
DECLARE
  v_admin_ves_id uuid := '22222222-2222-2222-2222-222222222222';
  v_count    int;
  v_nombres  text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_ves_id::text)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*), string_agg(nombre, ', ') INTO v_count, v_nombres
  FROM sucursal WHERE deleted_at IS NULL;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 2 FAIL: admin VES debería ver 1 sucursal, vio % (%)', v_count, v_nombres;
  END IF;
  IF v_nombres <> 'Huayruro VES' THEN
    RAISE EXCEPTION 'TEST 2 FAIL: admin VES debería ver "Huayruro VES", vio "%"', v_nombres;
  END IF;
  RAISE NOTICE 'TEST 2 PASS: admin VES ve solo VES';
END $$;

-- ====== TEST 3: admin_sucursal Chazuta Puerto ve solo Chazuta Puerto ======

DO $$
DECLARE
  v_admin_chz_id uuid := '33333333-3333-3333-3333-333333333333';
  v_nombres  text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_chz_id::text)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT string_agg(nombre, ', ') INTO v_nombres FROM sucursal WHERE deleted_at IS NULL;

  IF v_nombres <> 'Huayruro Chazuta Puerto' THEN
    RAISE EXCEPTION 'TEST 3 FAIL: admin Chazuta Puerto debería ver "Huayruro Chazuta Puerto", vio "%"', v_nombres;
  END IF;
  RAISE NOTICE 'TEST 3 PASS: admin Chazuta Puerto ve solo Chazuta Puerto';
END $$;

-- ====== TEST 4: catálogo es compartido a nivel tenant ======
-- Si hay productos, todos los usuarios del tenant los ven (independiente de rol).

DO $$
DECLARE
  v_admin_ves_id uuid := '22222222-2222-2222-2222-222222222222';
  v_admin_chz_id uuid := '33333333-3333-3333-3333-333333333333';
  v_count_ves    int;
  v_count_chz    int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_ves_id::text)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_count_ves FROM producto_catalogo WHERE deleted_at IS NULL;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_chz_id::text)::text, true);
  SELECT count(*) INTO v_count_chz FROM producto_catalogo WHERE deleted_at IS NULL;

  IF v_count_ves <> v_count_chz THEN
    RAISE EXCEPTION 'TEST 4 FAIL: catálogo debería ser igual entre admins del mismo tenant. VES=% Chazuta=%', v_count_ves, v_count_chz;
  END IF;
  RAISE NOTICE 'TEST 4 PASS: catálogo compartido (% productos visibles para ambos)', v_count_ves;
END $$;

-- ====== TEST 5: precio_local respeta sucursal (admin VES NO ve precios Chazuta) ======

DO $$
DECLARE
  v_admin_ves_id uuid := '22222222-2222-2222-2222-222222222222';
  v_suc_chz_pto  uuid;
  v_count        int;
BEGIN
  SELECT id INTO v_suc_chz_pto FROM sucursal WHERE nombre = 'Huayruro Chazuta Puerto';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_ves_id::text)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM precio_local WHERE sucursal_id = v_suc_chz_pto;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'TEST 5 FAIL: admin VES no debería ver precios de Chazuta Puerto, vio %', v_count;
  END IF;
  RAISE NOTICE 'TEST 5 PASS: precios de Chazuta NO visibles para admin VES';
END $$;

-- ====== Reset ======

ROLLBACK;
