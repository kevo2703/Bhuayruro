# Deploy de previsualización a Cloudflare Pages
# Uso: pwsh scripts/deploy-preview.ps1
#
# Despliega:
#   - apps/pwa/dist     -> https://huayruro-pos.pages.dev      (la app real)
#   - progreso/          -> https://huayruro-progreso.pages.dev (dashboard de avance)
#
# Cuenta Cloudflare: k.alexander.m.g@gmail.com (account f36301c3df2903a6e000dcff985d2b53)
# Costo: USD 0 (Cloudflare Pages Free, sin restricción de uso comercial conocida)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "==> Build de la PWA..." -ForegroundColor Cyan
pnpm --filter @huayruro/pwa build

Write-Host "==> Deploy PWA -> huayruro-pos..." -ForegroundColor Cyan
npx wrangler pages deploy apps/pwa/dist --project-name=huayruro-pos --branch=main --commit-dirty=true

Write-Host "==> Deploy dashboard de progreso -> huayruro-progreso..." -ForegroundColor Cyan
npx wrangler pages deploy progreso --project-name=huayruro-progreso --branch=main --commit-dirty=true

Write-Host ""
Write-Host "LISTO:" -ForegroundColor Green
Write-Host "  App:      https://huayruro-pos.pages.dev"
Write-Host "  Progreso: https://huayruro-progreso.pages.dev"
