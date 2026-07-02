# scripts/dump-schema.ps1 — dunne wrapper; de echte dump is Node (UTF-8-safe).
# PS 5.1-pipes verminken BOM-loos UTF-8 (mojibake — zie scripts/dump-schema.mjs
# voor toelichting); daarom NIET zelf in PowerShell dumpen.
node "$PSScriptRoot\dump-schema.mjs"
exit $LASTEXITCODE
