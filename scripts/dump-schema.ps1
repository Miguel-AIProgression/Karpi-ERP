# scripts/dump-schema.ps1
# Dumpt het live public-schema (functies, views, tabellen, triggers) naar
# supabase/schema/schema.sql — de canonieke "welke body is nu live"-bron.
# Draaien na elke toegepaste migratie; het resultaat mee-committen.
# Achtergrond: audit 2026-07-02 — de mig-428-BTW-regressie ontstond doordat
# een oude migratie-body als "actueel" werd hergebruikt.
#
# VEREIST: Docker Desktop (supabase db dump draait pg_dump in een container).
# Zonder Docker: draai de queries in supabase/schema/live/UITVRAAG-2026-07-02.sql
# (sectie-gewijs) in de SQL-editor en sla de output op onder supabase/schema/live/.
supabase db dump --linked --schema public -f supabase/schema/schema.sql
if ($LASTEXITCODE -ne 0) { Write-Error "supabase db dump faalde (Docker nodig?)"; exit 1 }
Write-Host "OK: supabase/schema/schema.sql ververst — commit dit mee."
