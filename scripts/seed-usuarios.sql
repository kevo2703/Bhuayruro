-- ============================================================
-- SCRIPT — Seed de usuarios_perfil para la cadena Huayruro
-- ============================================================
-- PRECONDICIÓN: cada usuario debe existir primero en auth.users (Supabase Auth).
-- Para crearlos:
--   1. Supabase Dashboard → Authentication → Users → "Add user" → "Send invitation"
--   2. Repetí para los 4 emails:
--      - kevo2703@gmail.com (o el que uses como super_admin)
--      - kevin.huayruro.ves@email.com (admin VES — puede ser otro email tuyo)
--      - papa.huayruro.chazuta.puerto@email.com (mamá/papá Chazuta puerto)
--      - mama.huayruro.chazuta.plaza@email.com  (mamá Chazuta plaza)
--   3. Cada uno recibe magic link por email → acepta → existe en auth.users
--   4. Volvé a este script, completá los UUIDs reales abajo y ejecutá
--
-- Cómo obtener el UUID de cada auth.users:
--   SELECT id, email FROM auth.users ORDER BY created_at DESC;
-- ============================================================

-- ⚠️ EDITAR los UUIDs y emails de abajo con los valores reales antes de ejecutar.

DO $$
DECLARE
  v_tenant_id    uuid;
  v_suc_ves      uuid;
  v_suc_chz_pto  uuid;
  v_suc_chz_pza  uuid;

  -- Reemplazar con los UUIDs reales de auth.users
  v_kevin_id     uuid := '00000000-0000-0000-0000-000000000001'; -- TODO: super_admin
  v_kevin_ves_id uuid := '00000000-0000-0000-0000-000000000002'; -- TODO: admin VES
  v_papa_id      uuid := '00000000-0000-0000-0000-000000000003'; -- TODO: admin Chazuta Puerto
  v_mama_id      uuid := '00000000-0000-0000-0000-000000000004'; -- TODO: admin Chazuta Plaza

  -- Reemplazar con los emails reales (mismos que en auth.users)
  v_kevin_email     text := 'kevo2703@gmail.com';
  v_kevin_ves_email text := 'kevin.huayruro.ves@email.com';
  v_papa_email      text := 'papa.huayruro.chazuta.puerto@email.com';
  v_mama_email      text := 'mama.huayruro.chazuta.plaza@email.com';
BEGIN
  SELECT id INTO v_tenant_id    FROM tenant   WHERE nombre_comercial = 'Botica Huayruro';
  SELECT id INTO v_suc_ves      FROM sucursal WHERE nombre = 'Huayruro VES';
  SELECT id INTO v_suc_chz_pto  FROM sucursal WHERE nombre = 'Huayruro Chazuta Puerto';
  SELECT id INTO v_suc_chz_pza  FROM sucursal WHERE nombre = 'Huayruro Chazuta Plaza';

  -- super_admin Kevin (sin sucursal_id por la CHECK constraint)
  INSERT INTO usuario_perfil (id, tenant_id, sucursal_id, rol, nombre, email)
  VALUES (v_kevin_id, v_tenant_id, NULL, 'super_admin', 'Kevin Mandujano', v_kevin_email)
  ON CONFLICT (id) DO UPDATE SET
    rol = EXCLUDED.rol,
    nombre = EXCLUDED.nombre,
    email = EXCLUDED.email,
    activo = true;

  -- admin_sucursal Kevin para Huayruro VES
  INSERT INTO usuario_perfil (id, tenant_id, sucursal_id, rol, nombre, email)
  VALUES (v_kevin_ves_id, v_tenant_id, v_suc_ves, 'admin_sucursal', 'Kevin (VES)', v_kevin_ves_email)
  ON CONFLICT (id) DO UPDATE SET
    sucursal_id = EXCLUDED.sucursal_id,
    rol = EXCLUDED.rol,
    nombre = EXCLUDED.nombre,
    activo = true;

  -- admin_sucursal Papá para Chazuta Puerto
  INSERT INTO usuario_perfil (id, tenant_id, sucursal_id, rol, nombre, email)
  VALUES (v_papa_id, v_tenant_id, v_suc_chz_pto, 'admin_sucursal', 'Papá Mandujano', v_papa_email)
  ON CONFLICT (id) DO UPDATE SET
    sucursal_id = EXCLUDED.sucursal_id,
    rol = EXCLUDED.rol,
    nombre = EXCLUDED.nombre,
    activo = true;

  -- admin_sucursal Mamá para Chazuta Plaza
  INSERT INTO usuario_perfil (id, tenant_id, sucursal_id, rol, nombre, email)
  VALUES (v_mama_id, v_tenant_id, v_suc_chz_pza, 'admin_sucursal', 'Mamá Mandujano', v_mama_email)
  ON CONFLICT (id) DO UPDATE SET
    sucursal_id = EXCLUDED.sucursal_id,
    rol = EXCLUDED.rol,
    nombre = EXCLUDED.nombre,
    activo = true;
END $$;

-- Verificación
SELECT id, nombre, email, rol,
       (SELECT nombre FROM sucursal WHERE id = up.sucursal_id) AS sucursal_nombre
FROM usuario_perfil up
WHERE activo = true
ORDER BY rol DESC, nombre;
-- Esperado: 4 filas (1 super_admin + 3 admin_sucursal)
