<#
.SYNOPSIS
    Losse test voor de HST GET /OrderStatus-API.

    Beantwoordt DE vraag die de reconciliatie-fix nodig heeft: kunnen we bij
    HST opvragen of een zending al bekend is op basis van ONZE referentie
    (CustomerReference uit de POST), via de query-parameter OrderReference?

    Zo ja, dan kan hst-send vóór een onzekere (her)verzending eerst GET
    /OrderStatus?OrderReference=<zending_nr> doen en bij een treffer NIET
    opnieuw POSTen -> sluit het laatste dubbele-aanmelding-gat (netwerk-timeout
    waarbij HST de order wel aanmaakte maar wij geen response kregen).

.DESCRIPTION
    Spiegelt test-hst-api.ps1 (zelfde Basic-auth-patroon), maar doet een GET
    i.p.v. een POST. Wachtwoord staat bewust NIET in de repo.

    TESTCASE: ZEND-2026-0061 werd 4x aangemeld (T75038267004423 t/m ...4426).
    Geeft GET /OrderStatus?OrderReference=ZEND-2026-0061 die order(s) terug,
    dan is bewezen dat OrderReference op onze CustomerReference matcht.

.EXAMPLE
    .\scripts\test-hst-orderstatus.ps1 -OrderReference 'ZEND-2026-0061'
    # PRODUCTIE (default), vraagt om wachtwoord. Onze referentie-lookup.

.EXAMPLE
    .\scripts\test-hst-orderstatus.ps1 -OrderNumber 'T75038267004423' -Wachtwoord 'xxx'
    # Lookup op HST's eigen ordernummer (controle dat het endpoint leeft).
#>

[CmdletBinding()]
param(
    # Productie-omgeving (mig 417-cutover 17-06): daar zitten de echte zendingen.
    # Voor de ACCP-doc/omgeving: -BaseUrl 'https://accp.hstonline.nl/rest/api/v1' -Username 'karpi_api_user'.
    [string]$BaseUrl        = 'https://portal.hstonline.nl/rest/api/v1',
    [string]$Username       = 'karpi_array1_api_user',
    [string]$OrderReference = 'ZEND-2026-0061',
    [string]$OrderNumber    = '',
    [string]$Wachtwoord
)

$ErrorActionPreference = 'Stop'

# --- Wachtwoord ophalen (veilig vragen als niet meegegeven) ----------------
if (-not $Wachtwoord) {
    $secure = Read-Host -AsSecureString 'HST-wachtwoord'
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $Wachtwoord = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
}

# --- Query opbouwen --------------------------------------------------------
$qs = @()
if ($OrderNumber)    { $qs += 'OrderNumber='    + [Uri]::EscapeDataString($OrderNumber) }
if ($OrderReference) { $qs += 'OrderReference=' + [Uri]::EscapeDataString($OrderReference) }
if ($qs.Count -eq 0) { throw 'Geef minstens -OrderReference of -OrderNumber mee.' }
$url = $BaseUrl.TrimEnd('/') + '/OrderStatus?' + ($qs -join '&')

# --- Basic-auth header -----------------------------------------------------
$pair    = $Username + ':' + $Wachtwoord
$basic   = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
$headers = @{
    'Authorization' = 'Basic ' + $basic
    'Accept'        = 'application/json'
}

Write-Host ""
Write-Host "GET   $url"
Write-Host "User  $Username"
Write-Host "----------------------------------------------------------------"

# --- GET + status/response uitlezen (werkt op PS 5.1 en 7+) ----------------
$statusCode = 0
$bodyText   = ''

try {
    $resp = Invoke-WebRequest -Uri $url -Method Get -Headers $headers -UseBasicParsing
    $statusCode = [int]$resp.StatusCode
    $bodyText   = $resp.Content
}
catch {
    $webResp = $_.Exception.Response
    if ($webResp -and $webResp.GetResponseStream) {
        $statusCode = [int]$webResp.StatusCode
        $reader = New-Object IO.StreamReader($webResp.GetResponseStream())
        $bodyText = $reader.ReadToEnd()
        $reader.Close()
    }
    else {
        Write-Host "GEEN HTTP-RESPONS -- netwerk-/verbindingsfout:" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}

# --- Resultaat tonen -------------------------------------------------------
$statusKleur = 'Yellow'
if ($statusCode -ge 200 -and $statusCode -lt 300) { $statusKleur = 'Green' }
Write-Host "HTTP-status: $statusCode" -ForegroundColor $statusKleur
Write-Host ""

$parsed = $null
try { $parsed = $bodyText | ConvertFrom-Json } catch { }

if ($parsed) {
    Write-Host "Success      : $($parsed.Success)"
    Write-Host "ErrorMessage : $($parsed.ErrorMessage)"
    Write-Host "OrderNumber  : $($parsed.OrderNumber)"
    Write-Host "StatusText   : $($parsed.StatusText)"
    Write-Host "UrlTrackTrace: $($parsed.UrlTrackTrace)"
    if ($parsed.ColloStatusses) {
        Write-Host "ColloStatusses: $($parsed.ColloStatusses.Count) collo('s)"
    }
    Write-Host ""
    if ($parsed.Success -eq $true -and $parsed.OrderNumber) {
        Write-Host "RESULTAAT: HST kent deze referentie -> OrderReference matcht onze CustomerReference. Reconciliatie is bouwbaar." -ForegroundColor Green
    }
    else {
        Write-Host "RESULTAAT: respons ontvangen, maar geen order op deze referentie." -ForegroundColor Yellow
        Write-Host "Volledige body:" -ForegroundColor Yellow
        Write-Host $bodyText
    }
}
else {
    Write-Host "Respons (geen JSON):"
    Write-Host $bodyText
}
