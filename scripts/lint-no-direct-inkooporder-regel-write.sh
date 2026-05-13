#!/usr/bin/env bash
# scripts/lint-no-direct-inkooporder-regel-write.sh
# Faalt als directe INSERT/UPDATE/DELETE op inkooporder_regels of
# UPDATE op inkooporders.status voorkomt buiten de Inkoop-Module
# allowlist en de Python-bulk-import.
#
# ADR-0017: schrijfacties op inkooporder_regels en inkooporders.status
# lopen via de Inkoop-Module (RPC's boek_inkooporder_ontvangst_stuks /
# boek_inkooporder_ontvangst_rollen / boek_io_ontvangst_claims).
# Directe schrijfacties zijn alleen toegestaan in Module-eigen migraties.
#
# Platform-noot: gebruikt POSIX-shell. Op Windows draaien via Git Bash.
# Op Unix: maak executable via `chmod +x scripts/lint-no-direct-inkooporder-regel-write.sh`.
set -euo pipefail

# Migraties die historisch / Module-eigen writes doen op inkooporder_regels
# of inkooporders.status:
#   127 — initial inkooporders/leveranciers tabellen
#   131 — FK-cleanup voor inkoop
#   133 — boek_ontvangst m2 fix
#   135 — boek_ontvangst auto-rolnummer
#   136 — boek_ontvangst voorraad_mutaties schema fix
#   148 — boek_voorraad_ontvangst claim-consume
#   254 — boek_voorraad_ontvangst -> PERFORM boek_io_ontvangst_claims (ADR-0015)
#   257 — RPC-rename naar boek_inkooporder_ontvangst_{stuks,rollen} (ADR-0017)
ALLOWED_MIGRATION_PATHS=(
  'supabase/migrations/127_inkooporders_leveranciers.sql'
  'supabase/migrations/131_inkoop_dubbele_fks_opruimen.sql'
  'supabase/migrations/133_boek_ontvangst_m2_fix.sql'
  'supabase/migrations/135_boek_ontvangst_auto_rolnummer.sql'
  'supabase/migrations/136_boek_ontvangst_voorraad_mutaties_schema_fix.sql'
  'supabase/migrations/148_boek_voorraad_ontvangst_consumeer_claims.sql'
  'supabase/migrations/254_reservering_module_split.sql'
  'supabase/migrations/271_inkoop_module_rename_ontvangst_rpcs.sql'
)

# Python-import-paden die initial-bulk-create doen.
# Backlog: vervang door create_inkooporder-RPC in vervolg-werk (zie ADR-0017).
ALLOWED_PYTHON_PATHS=(
  'import/import_inkoopoverzicht.py'
)

# Frontend-paden binnen de Inkoop-Module zelf (Module is haar eigen writer).
ALLOWED_FRONTEND_PATHS=(
  'frontend/src/modules/inkoop/'
)

failed=0

# 1) SQL-migraties: scan alle *.sql in supabase/migrations.
# Patronen: INSERT/UPDATE/DELETE op inkooporder_regels OF UPDATE inkooporders SET status.
SQL_PATTERN='(INSERT\s+INTO\s+inkooporder_regels|UPDATE\s+inkooporder_regels|DELETE\s+FROM\s+inkooporder_regels|UPDATE\s+inkooporders\s+SET[^;]*\bstatus\b)'

migration_matches=$(grep -rPin --include='*.sql' "$SQL_PATTERN" \
  supabase/migrations 2>/dev/null || true)

while IFS=: read -r file line rest; do
  [ -z "$file" ] && continue
  allowed=0
  for path in "${ALLOWED_MIGRATION_PATHS[@]}"; do
    if [[ "$file" == *"$path"* ]]; then allowed=1; break; fi
  done
  if [ "$allowed" -eq 0 ]; then
    echo "FAIL: $file:$line — directe schrijf op inkooporder_regels / inkooporders.status verboden (ADR-0017). Gebruik RPC's uit de Inkoop-Module (boek_inkooporder_ontvangst_stuks / boek_inkooporder_ontvangst_rollen)."
    echo "      $rest"
    failed=1
  fi
done <<< "$migration_matches"

# 2) Edge functions: recursief alle *.ts onder supabase/functions.
EDGE_PATTERN="from\(['\"]inkooporder_regels['\"]\)\.(update|insert|delete|upsert)"

function_matches=$(grep -rEn --include='*.ts' "$EDGE_PATTERN" \
  supabase/functions 2>/dev/null || true)

while IFS=: read -r file line rest; do
  [ -z "$file" ] && continue
  echo "FAIL: $file:$line — directe schrijf op inkooporder_regels in edge function verboden (ADR-0017). Roep de Inkoop-Module RPC aan."
  echo "      $rest"
  failed=1
done <<< "$function_matches"

# 3) Python-import scripts: directe table-writes verboden buiten whitelist; RPC is OK.
PYTHON_PATTERN="table\(['\"]inkooporder_regels['\"]\)\.(update|insert|delete|upsert)"

python_matches=$(grep -rEn --include='*.py' "$PYTHON_PATTERN" \
  import 2>/dev/null || true)

while IFS=: read -r file line rest; do
  [ -z "$file" ] && continue
  allowed=0
  for path in "${ALLOWED_PYTHON_PATHS[@]}"; do
    if [[ "$file" == *"$path"* ]]; then allowed=1; break; fi
  done
  if [ "$allowed" -eq 0 ]; then
    echo "FAIL: $file:$line — directe table-write op inkooporder_regels in Python verboden (ADR-0017). Gebruik de Inkoop-Module RPC via supabase.rpc(...)."
    echo "      $rest"
    failed=1
  fi
done <<< "$python_matches"

# 4) Frontend: TS/TSX onder frontend/src.
FRONTEND_PATTERN="from\(['\"]inkooporder_regels['\"]\)\.(update|insert|delete|upsert)"

frontend_matches=$(grep -rEn --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules --exclude-dir=dist \
  "$FRONTEND_PATTERN" frontend/src 2>/dev/null || true)

while IFS=: read -r file line rest; do
  [ -z "$file" ] && continue
  allowed=0
  for path in "${ALLOWED_FRONTEND_PATHS[@]}"; do
    if [[ "$file" == *"$path"* ]]; then allowed=1; break; fi
  done
  if [ "$allowed" -eq 0 ]; then
    echo "FAIL: $file:$line — directe schrijf op inkooporder_regels in frontend verboden (ADR-0017). Gebruik hooks/queries uit @/modules/inkoop."
    echo "      $rest"
    failed=1
  fi
done <<< "$frontend_matches"

if [ "$failed" -eq 1 ]; then
  echo ""
  echo "Inkoop-Module is de enige writer van inkooporder_regels en"
  echo "inkooporders.status. Gebruik boek_inkooporder_ontvangst_{stuks,rollen}"
  echo "of importeer via @/modules/inkoop. Zie ADR-0017."
  exit 1
fi

echo "OK: geen directe schrijfacties op inkooporder_regels / inkooporders.status buiten Inkoop-Module allowlist"
