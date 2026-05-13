#!/usr/bin/env bash
# scripts/lint-no-direct-order-reserveringen-write.sh
# Faalt als directe INSERT/UPDATE/DELETE op order_reserveringen voorkomt
# in nieuwe code buiten de Reservering-Module zelf.
# Scope: supabase/migrations/*.sql + supabase/functions/**/*.ts (recursief).
#
# ADR-0015: schrijfacties op order_reserveringen lopen via de Reservering-Module
# (RPC's herallocateer_orderregel, set_uitwisselbaar_claims, consumeer_claims, etc).
# Directe schrijfacties zijn alleen toegestaan in de Module-migraties zelf.
#
# Platform-noot: gebruikt POSIX-shell. Op Windows draaien via Git Bash.
# Op Unix: maak executable via `chmod +x scripts/lint-no-direct-order-reserveringen-write.sh`.
set -euo pipefail

ALLOWED_PATHS=(
  'supabase/migrations/144_order_reserveringen_basis.sql'
  'supabase/migrations/145_order_reserveringen_rpcs.sql'
  'supabase/migrations/146_order_reserveringen_triggers.sql'
  'supabase/migrations/147_inkoop_status_release_trigger.sql'
  'supabase/migrations/148_boek_voorraad_ontvangst_consumeer_claims.sql'
  'supabase/migrations/151_backfill_order_reserveringen.sql'
  'supabase/migrations/154_uitwisselbaar_claims.sql'
  'supabase/migrations/155_order_reserveringen_rls.sql'
  'supabase/migrations/218_order_lifecycle_module.sql'
  'supabase/migrations/254_reservering_module_split.sql'
  'supabase/migrations/255_reservering_order_events_trigger.sql'
)

# Case-insensitive, multi-line via PCRE: tolereer whitespace/newlines tussen tokens.
# Drie patronen: INSERT INTO order_reserveringen, UPDATE order_reserveringen,
# DELETE FROM order_reserveringen.
PATTERN='(INSERT\s+INTO\s+order_reserveringen|UPDATE\s+order_reserveringen|DELETE\s+FROM\s+order_reserveringen)'

# SQL-migraties: scan alle *.sql in supabase/migrations.
migration_matches=$(grep -rPin --include='*.sql' "$PATTERN" \
  supabase/migrations 2>/dev/null || true)

# Edge functions: recursief alle *.ts onder supabase/functions.
function_matches=$(grep -rPin --include='*.ts' "$PATTERN" \
  supabase/functions 2>/dev/null || true)

all="${migration_matches}
${function_matches}"

failed=0
while IFS=: read -r file line rest; do
  [ -z "$file" ] && continue
  allowed=0
  for path in "${ALLOWED_PATHS[@]}"; do
    if [[ "$file" == *"$path"* ]]; then allowed=1; break; fi
  done
  if [ "$allowed" -eq 0 ]; then
    echo "FAIL: $file:$line — directe schrijf op order_reserveringen verboden (ADR-0015). Gebruik RPC's uit de Reservering-Module (herallocateer_orderregel / set_uitwisselbaar_claims / consumeer_claims)."
    echo "      $rest"
    failed=1
  fi
done <<< "$all"

if [ "$failed" -eq 1 ]; then
  exit 1
fi

echo "OK: geen directe INSERT/UPDATE/DELETE op order_reserveringen buiten Module-allowlist"
