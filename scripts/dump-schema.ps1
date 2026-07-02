# scripts/dump-schema.ps1
# Dumpt alle live public-functies + views naar supabase/schema/ — de canonieke
# "welke body is nu live"-bron. Draaien na elke toegepaste migratie; resultaat
# mee-committen. Achtergrond: audit 2026-07-02 — de mig-428-BTW-regressie
# ontstond doordat een oude migratie-body als "actueel" werd hergebruikt.
# Route: `supabase db query --linked` (Management API, CLI >= 2.100) — geen
# Docker nodig (supabase db dump vereist die wel).
$ErrorActionPreference = 'Stop'

$fnQuery = "SELECT string_agg(pg_get_functiondef(p.oid), E'\n\n' ORDER BY p.proname) AS defs FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'"
$vwQuery = "SELECT string_agg(format(E'CREATE OR REPLACE VIEW %I AS\n%s', viewname, definition), E'\n\n' ORDER BY viewname) AS defs FROM pg_views WHERE schemaname='public'"

$fn = supabase db query --linked -o json $fnQuery | ConvertFrom-Json
$header = "-- GEGENEREERD: alle public-functies van de live DB (audit-remediatie Task 4.1).`n-- Ververs met scripts/dump-schema.ps1 (db query-route). NIET handmatig bewerken.`n`n"
[System.IO.File]::WriteAllText("$PSScriptRoot\..\supabase\schema\functies.sql", $header + $fn.rows[0].defs + "`n")

$vw = supabase db query --linked -o json $vwQuery | ConvertFrom-Json
[System.IO.File]::WriteAllText("$PSScriptRoot\..\supabase\schema\views.sql", "-- GEGENEREERD: alle public-views van de live DB (audit-remediatie Task 4.1).`n`n" + $vw.rows[0].defs + "`n")

Write-Host "OK: supabase/schema/functies.sql + views.sql ververst - commit ze mee."
