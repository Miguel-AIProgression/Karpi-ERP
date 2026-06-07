<#
.SYNOPSIS
    Losse rondreis-test voor de HST TransportOrder-API.

    Beantwoordt een vraag: als we NU een TransportOrder posten, krijgen we
    dan een geldige API-reactie terug (verwacht HTTP 201 + Success=true +
    OrderNumber)? Onafhankelijk van de pickronde-/cron-keten -- pure POST.

.DESCRIPTION
    Stuurt de bekende-goede voorbeeld-payload via HTTP Basic-auth naar de
    HST-endpoint en print de HTTP-status + relevante response-velden.

    Wachtwoord staat bewust NIET in de repo. Geef het mee via -Wachtwoord of
    laat het script er veilig om vragen.

.EXAMPLE
    .\scripts\test-hst-api.ps1
    # ACCP (acceptatie/test), vraagt om wachtwoord.

.EXAMPLE
    .\scripts\test-hst-api.ps1 -BaseUrl 'https://hstonline.nl/rest/api/v1' -Wachtwoord 'xxx'
    # Productie (vul echte host + credentials in).
#>

[CmdletBinding()]
param(
    [string]$BaseUrl    = 'https://accp.hstonline.nl/rest/api/v1',
    [string]$Username   = 'karpi_api_user',
    [string]$CustomerId = '038267',
    [string]$Wachtwoord
)

$ErrorActionPreference = 'Stop'

# --- Wachtwoord ophalen (veilig vragen als niet meegegeven) ----------------
if (-not $Wachtwoord) {
    $secure = Read-Host -AsSecureString 'HST-wachtwoord'
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $Wachtwoord = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
}

# --- Payload laden uit de fixture -----------------------------------------
$fixturePath = Join-Path $PSScriptRoot '..\supabase\functions\hst-send\fixtures\example-transportorder-request.json'
if (-not (Test-Path $fixturePath)) {
    throw "Fixture niet gevonden: $fixturePath"
}

$payloadObj = Get-Content -Raw -Path $fixturePath | ConvertFrom-Json
$payloadObj.CustomerID = $CustomerId
$stempel = Get-Date -Format 'yyyy-MM-dd HH:mm'
$payloadObj.CustomerReference = "KARPI-API-TEST $stempel"
$payload = $payloadObj | ConvertTo-Json -Depth 10

# --- Basic-auth header -----------------------------------------------------
$pair    = $Username + ':' + $Wachtwoord
$basic   = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
$url     = $BaseUrl.TrimEnd('/') + '/TransportOrder'
$headers = @{
    'Authorization' = 'Basic ' + $basic
    'Accept'        = 'application/json'
}

Write-Host ""
Write-Host "POST  $url"
Write-Host "User  $Username  (CustomerID $CustomerId)"
Write-Host "----------------------------------------------------------------"

# --- POST + status/response uitlezen (werkt op PS 5.1 en 7+) ---------------
$statusCode = 0
$bodyText   = ''

try {
    $resp = Invoke-WebRequest -Uri $url -Method Post -Headers $headers -ContentType 'application/json' -Body $payload -UseBasicParsing
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
    Write-Host "Success     : $($parsed.Success)"
    Write-Host "OrderNumber : $($parsed.OrderNumber)"
    if ($parsed.PDFDocument -and $parsed.PDFDocument.Contents) {
        $pdfLen = $parsed.PDFDocument.Contents.Length
        Write-Host "PDFDocument : base64-PDF aanwezig, $pdfLen chars"
    }
    Write-Host ""
    if ($statusCode -eq 201 -and $parsed.Success -eq $true -and $parsed.OrderNumber) {
        Write-Host "RESULTAAT: HST-API reageert correct. Rondreis geslaagd." -ForegroundColor Green
    }
    else {
        Write-Host "RESULTAAT: respons ontvangen, maar GEEN succesvolle TransportOrder." -ForegroundColor Yellow
        Write-Host "Volledige body:" -ForegroundColor Yellow
        Write-Host $bodyText
    }
}
else {
    Write-Host "Respons (geen JSON):"
    Write-Host $bodyText
}
