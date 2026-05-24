---
sprint: 1
fase: build
inicio: 2026-05-24
cierre_objetivo: 2026-06-01
horas_objetivo: 22
---

# Sprint 1 — Handoff de scaffolding

## Lo que ya está hecho (2026-05-24)

### Estructura del workspace
- ✅ Monorepo pnpm + turbo inicializado en `e:\proyectos-codigo\huayruro\`
- ✅ Git repo iniciado (rama `main`)
- ✅ Estructura completa: `apps/{pwa,admin}/`, `packages/{shared,ui,db}/`, `supabase/`, `docs/`, `.github/`

### Configuraciones base
- ✅ `package.json` raíz con scripts turbo
- ✅ `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- ✅ ESLint + Prettier + commitlint + husky preparados
- ✅ `.gitignore`, `.env.example`
- ✅ Workflow CI en `.github/workflows/ci.yml`

### Apps
- ✅ `apps/pwa/` — Vite + React 19 + TypeScript + vite-plugin-pwa con manifest + Workbox + index.html + main.tsx + App.tsx + index.css
- ✅ `apps/admin/` — Next.js 15.2.4 App Router + layout.tsx + page.tsx + globals.css + next.config.ts

### Packages
- ✅ `@huayruro/shared` con cálculo IGV + schemas zod + tests Vitest del IGV
- ✅ `@huayruro/ui` placeholder (shadcn se agrega sprint 2)
- ✅ `@huayruro/db` con cliente Supabase + stub de tipos

### Supabase
- ✅ `supabase/config.toml` con auth signups deshabilitado (multi-tenant controlado)
- ✅ Migration `20260526000001_extensions.sql` con `pgcrypto`, `uuid-ossp`, `pg_trgm`, polyfill UUID v7

### Documentación
- ✅ 10 ADRs en `docs/adr/` (001-010) consolidando las decisiones del spec
- ✅ Docs legales en `docs/legal/`: DPO designación, DPIA MVP, política retención, política privacidad, SOP ARCO
- ✅ Runbook `docs/runbooks/incidente-seguridad.md` con plantilla ANPDP 48h
- ✅ README principal con quickstart + estructura + comandos

---

## Lo que falta — acciones MANUALES de Kevin

Estas acciones requieren tu intervención porque involucran cuentas, tarjetas, hardware físico o decisiones que no puedo hacer desde Claude Code.

### 🔴 Bloqueantes para arrancar sprint 1

> **Estrategia 100% Free (decisión Kevin 24-may, confirmada):** operamos en tier Free durante toda la vida del MVP. En sprint 7, migramos Vercel → Cloudflare Pages (Free, sin restricción comercial) y mantenemos Supabase Free + script `pg_dump` diario manual a Google Drive como reemplazo de backups Pro. **Costo total del MVP: USD 0/mes.**

1. **Crear cuenta Supabase Free** (USD 0/mes)
   - Ir a [supabase.com](https://supabase.com)
   - Crear proyecto `huayruro` en región más cercana a Lima (us-east-1 o sa-east-1)
   - Plan: **Free** (500 MB DB, 50K MAU, 200 realtime — sobra para desarrollo)
   - Capturar `URL`, `anon key`, `service role key` → completar `.env.local`
   - **Upgrade a Pro:** sprint 7 antes del piloto producción (necesario por backups diarios)

2. **Crear cuenta Vercel Hobby** (USD 0/mes)
   - Ir a [vercel.com](https://vercel.com)
   - Plan: **Hobby** (100 GB bandwidth, ilimitados preview deploys)
   - Conectar GitHub repo (cuando se publique) — Sprint 1 día 5
   - **Upgrade a Pro:** sprint 7 antes del rollout (Hobby prohíbe uso comercial productivo)

3. **Repo en GitHub**
   - Crear repo privado `huayruro` en tu cuenta
   - `git remote add origin git@github.com:<tu-usuario>/huayruro.git`
   - `git add . && git commit -m "feat: scaffolding sprint 1" && git push -u origin main`

4. **Instalar deps locales**
   ```bash
   cd "e:\proyectos-codigo\huayruro"
   pnpm install
   ```
   Si pnpm no está instalado: `npm install -g pnpm@9`

5. **Documentos legales** — decisión Kevin 24-may: **NO se firman**.
   - Los archivos `docs/legal/*.md` quedan como **base operativa interna** (saber qué hacer ante incidente, cómo responder ARCO, política de retención) pero sin valor probatorio formal ante ANPDP.
   - Consistente con la estrategia "operar informal hasta formalizar". Si llega fiscalización ANPDP no se puede demostrar DPO designado — riesgo aceptado.

### 🟡 Validaciones técnicas (sprint 1 día 1-4)

6. **Validar WebUSB con impresora real VES** (~30 min)
   - Conectar la impresora térmica al puerto USB
   - Una vez tenga `apps/pwa` levantado, abrir Chrome → ir a la app
   - Pedirme: "implementa una página de test WebUSB que abra el diálogo, conecte la impresora y mande 'Hola Huayruro' con bytes ESC/POS"

7. **Validar SDK PowerSync en PWA** (~2-3h, tarea mía con Claude Code)
   - Setup `@powersync/web` en `apps/pwa`
   - Mini ejemplo: tabla `test_sync` en Postgres, sincronizar a SQLite local, escribir offline, verificar reconciliación al volver red
   - Si falla → fallback WatermelonDB (decisión al cierre del día)

### 🟢 No bloqueantes — sprint 1 ó más adelante

8. **Cuenta Sentry Free** (sprint 1 si hay tiempo)
   - [sentry.io](https://sentry.io) plan Free
   - Crear 2 projects: `huayruro-pwa` (vite) y `huayruro-admin` (next.js)
   - Capturar DSNs → `.env.local`

9. **UptimeRobot Free** (sprint 7)
   - 50 monitors gratis
   - Configurar al rollout

10. **Dominio `huayruro.pe`** (sprint 7, al rollout)
   - Comprar en NIC.pe o Namecheap (~S/30/año)
   - DNS → Vercel

## 💰 Costo total del MVP — USD 0/mes

Estrategia 100% Free aprobada por Kevin 24-may. Sin upgrade en sprint 7.

| Servicio | Plan | Costo | Compromiso |
|---|---|---|---|
| Supabase | Free | USD 0 | Sin backups automáticos — reemplazar con `pg_dump` diario manual |
| Cloudflare Pages | Free | USD 0 | Bandwidth ilimitado, sin restricción comercial (verificar tier exacto en sprint 7) |
| Vercel Hobby | Free | USD 0 | Solo durante desarrollo (sprints 1-6). Sprint 7 migra a Cloudflare Pages |
| PowerSync | Free | USD 0 | ≤ 1.000 dispositivos |
| Sentry | Free | USD 0 | 5K events/mes |
| n8n | Self-host con Docker | USD 0 | En tu PC o VPS — Cloud Starter (USD 24) postponed indefinido |
| Dominio | Comprado al rollout | S/30/año | Sprint 7 |

### Compromisos operativos del modelo Free

**Supabase Free → necesita backup manual diario:**
- Script `pg_dump` programado con Windows Task Scheduler que vuelca DB a Google Drive cada noche
- Implementación: sprint 6
- Sin esto, una caída de Supabase = posible pérdida de hasta 24h de data

**Vercel Hobby → migración a Cloudflare Pages en sprint 7:**
- Razón: Vercel Hobby ToS prohíbe uso comercial. Cloudflare Pages no tiene esa restricción.
- Trabajo de migración estimado: 4-6h
- Cloudflare Pages requiere plugin Next.js (Cloudflare Workers runtime). Verificar compatibilidad en sprint 7 con la versión actual del admin.

---

## Comandos para arrancar (después de los pasos 1-4)

```bash
cd "e:\proyectos-codigo\huayruro"

# Verificar todo OK
pnpm install
pnpm typecheck
pnpm test:unit

# Levantar Supabase local
supabase login
supabase link --project-ref <tu-project-ref>
pnpm supabase:start
pnpm supabase:reset    # aplica migration 001_extensions

# Levantar dev servers
pnpm dev
```

Si todo OK debes ver:
- PWA en http://localhost:5173 → "Botica Huayruro · Mostrador"
- Admin en http://localhost:3000 → "Botica Huayruro · Admin"
- Tests verdes (1 archivo, 7+ assertions del cálculo IGV)

## Sprint 1 — tareas restantes después del setup

Una vez tengas Supabase + Vercel + repo en GitHub conectados, las tareas Must restantes del sprint 1 son (referencia [07-roadmap-sprints sprint 1](../../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/07-roadmap-sprints.md)):

- [ ] Test WebUSB real (~30 min)
- [ ] Setup PowerSync + mini-prueba sync (~2-3h)
- [ ] Configurar Sentry (~1h)
- [ ] Primer deploy preview en Vercel (~1h)
- [ ] Husky pre-commit funcional (~30 min)
- [ ] CI verde en GitHub Actions (~1h)
- [ ] Tag `v0.1.0-sprint1` + release notes

**Tiempo restante estimado tras setup manual:** ~6-7 horas.

## Próximos sprints

Cuando cierres este sprint 1 con tag, abre Claude Code en el workspace y arrancamos sprint 2 con migrations + auth + catálogo. Ver [07-roadmap-sprints](../../../Bobeda%20Kevin/proyectos/botica-huayruro-sistema-automatizacion/spec/07-roadmap-sprints.md#sprint-2--multi-tenant--cat%C3%A1logo--auth).
