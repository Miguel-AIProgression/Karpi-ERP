# Wrapper rond scripts/herplan-alle-groepen.mjs — vraagt interactief om de
# Supabase service-role key (verborgen input, niet in shell-history of
# omgevingsvariabelen van andere processen).
#
# Gebruik:
#   PS> .\scripts\herplan-alle-groepen.ps1
#
# Optioneel één specifieke groep:
#   PS> .\scripts\herplan-alle-groepen.ps1 -Kwaliteit ABST -Kleur 11

param(
    [string]$Kwaliteit,
    [string]$Kleur,
    [string]$Url = 'https://wqzeevfobwauxkalagtn.supabase.co'
)

$ErrorActionPreference = 'Stop'

Write-Host "Supabase URL: $Url" -ForegroundColor DarkGray
$secure = Read-Host -Prompt "Service-role key (verborgen)" -AsSecureString
if ($secure.Length -eq 0) {
    Write-Error "Geen key opgegeven — afgebroken."
    exit 1
}

# Converteer SecureString → plain text (alleen in deze sessie, niet gelogd).
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $key = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$env:SUPABASE_URL              = $Url
$env:SUPABASE_SERVICE_ROLE_KEY = $key

try {
    if ($Kwaliteit -and $Kleur) {
        Write-Host "Herplan 1 groep: $Kwaliteit $Kleur" -ForegroundColor Cyan
        node scripts/herplan-alle-groepen.mjs $Kwaliteit $Kleur
    } else {
        Write-Host "Herplan ALLE groepen met Snijden-stukken..." -ForegroundColor Cyan
        node scripts/herplan-alle-groepen.mjs
    }
}
finally {
    # Wis de key uit de huidige sessie zodat hij niet nablijft.
    Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
    $key = $null
}
