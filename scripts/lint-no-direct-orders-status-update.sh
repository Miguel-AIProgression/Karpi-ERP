#!/usr/bin/env bash
# scripts/lint-no-direct-orders-status-update.sh
# Faalt als 'UPDATE orders SET status' voorkomt in nieuwe code.
# Scope: frontend/ TS/TSX + supabase/migrations/2*.sql (Module-tijdperk).
# Legacy migraties 145/153/217 zijn historisch en niet meer bewerkt.
#
# ADR-0006: orders.status mag alleen worden geschreven via de
# Order-lifecycle Module (markeer_verzonden / markeer_geannuleerd /
# herbereken_wacht_status, intern via _apply_transitie in mig 218).
#
# Platform-noot: gebruikt POSIX-shell. Op Windows draaien via Git Bash.
set -euo pipefail

ALLOWED_PATHS=(
  'supabase/migrations/218_order_lifecycle_module.sql'
  'supabase/migrations/218_z_order_lifecycle_security_definer.sql'
)

# Zoek matches: frontend (excl. node_modules/dist) + nieuwe migraties.
frontend_matches=$(grep -rEn "UPDATE\s+orders\s+SET[^;]*\bstatus\b" frontend/src \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null || true)

migration_matches=$(grep -rEn "UPDATE\s+orders\s+SET[^;]*\bstatus\b" \
  supabase/migrations/2*.sql 2>/dev/null || true)

all="${frontend_matches}
${migration_matches}"

failed=0
while IFS=: read -r file line rest; do
  [ -z "$file" ] && continue
  allowed=0
  for path in "${ALLOWED_PATHS[@]}"; do
    if [[ "$file" == *"$path"* ]]; then allowed=1; break; fi
  done
  if [ "$allowed" -eq 0 ]; then
    echo "FAIL: $file:$line — gebruik markeer_verzonden / markeer_geannuleerd / herbereken_wacht_status uit @/modules/orders-lifecycle"
    failed=1
  fi
done <<< "$all"

if [ "$failed" -eq 1 ]; then
  exit 1
fi

echo "OK: geen directe UPDATE orders SET status buiten Module-allowlist"
