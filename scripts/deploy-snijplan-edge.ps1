# Deploy de twee snijplan edge functions naar Supabase via `npx supabase`.
# Draait vanuit project-root. Project-ref wordt gelezen uit supabase/config.toml.
#
# Gebruik:
#   PS> .\scripts\deploy-snijplan-edge.ps1
#
# Vereist: `npx` (Node.js) en login via `npx supabase login` (eenmalig).

$ErrorActionPreference = 'Stop'

$projectRef = 'wqzeevfobwauxkalagtn'
$functions  = @('auto-plan-groep', 'optimaliseer-snijplan')

Write-Host "Deploy target: $projectRef" -ForegroundColor DarkGray
Write-Host "Functions:     $($functions -join ', ')" -ForegroundColor DarkGray
Write-Host ''

foreach ($fn in $functions) {
    Write-Host "→ Deploying $fn..." -ForegroundColor Cyan
    npx supabase functions deploy $fn --project-ref $projectRef
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Deploy van $fn faalde (exit $LASTEXITCODE) — stopt."
        exit $LASTEXITCODE
    }
    Write-Host ''
}

Write-Host 'Alle edge functions gedeployed.' -ForegroundColor Green
Write-Host 'Volgende stap: .\scripts\herplan-alle-groepen.ps1 -Kwaliteit MARI -Kleur 13' -ForegroundColor DarkGray
