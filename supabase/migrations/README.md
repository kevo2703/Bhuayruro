# Migrations Supabase — Huayruro

> Cada cambio de schema = un archivo SQL versionado por timestamp. Nombrar `YYYYMMDDHHmmss_<descripcion>.sql`.

## Plan de migraciones — Sprint 1-4

| Archivo | Sprint | Contenido |
|---|---|---|
| `20260526000001_extensions.sql` | 1 | Extensiones (`pgcrypto`, `uuid-ossp`, `pg_trgm`, `pg_stat_statements`) + función `uuid_generate_v7()` |
| `20260602000001_tenant_sucursal.sql` | 2 | Tablas `tenant`, `sucursal` |
| `20260602000002_usuario_rol.sql` | 2 | Tipos enum `user_role`, tabla `usuario_perfil` |
| `20260602000003_producto_codigo.sql` | 2 | Tablas `producto_catalogo`, `codigo_barras`, `precio_local` |
| `20260609000001_inventario_lote.sql` | 3 | Tablas `inventario_local`, `lote` |
| `20260609000002_venta_item.sql` | 3 | Enum `metodo_pago`, tablas `venta`, `venta_item` |
| `20260616000001_quiebre_no_compra.sql` | 4 | Tablas `quiebre`, `no_compra`, enum `razon_no_compra` |
| `20260616000002_movimiento_cierre.sql` | 4 | Tablas `movimiento_stock`, `cierre_caja`, enum `tipo_movimiento` |
| `20260616000003_audit_log.sql` | 4 | Tabla `audit_log` |
| `20260616000004_rls_policies.sql` | 4 | Habilita RLS + policies por sucursal_id |
| `20260616000005_triggers.sql` | 4 | Triggers descuento stock, updated_at, audit |
| `20260616000006_rpc_registrar_venta.sql` | 4 | RPC atómica `registrar_venta(jsonb)` |

Especificación completa en [03-modelo-datos](../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/03-modelo-datos.md) y [04-apis-endpoints](../../../Bobeda Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/04-apis-endpoints.md).

## Comandos

```bash
# Aplicar todas las migrations en local
pnpm supabase:reset

# Crear nueva migration
supabase migration new <descripcion>

# Push a producción (después de tests)
supabase db push --linked
```
