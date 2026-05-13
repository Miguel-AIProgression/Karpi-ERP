#!/usr/bin/env bash
# Voorkom regressie naar hardcoded admin-pseudo-strings buiten de whitelist.
# Whitelist:
#   - mig 265 (seed van pseudo-producten)
#   - mig 272 (backfill van is_pseudo + helper)
#   - mig 273 (callsite-rewrites; bevat scope-comments met de oude IN-lijst)
#   - oude callsite-migraties die door 273 zijn vervangen (legacy files, in git history)
#   - factuur-construct-RPCs (mig 234/256/260-268) — toe-voeg-context, niet skip
#   - SHIPPING_PRODUCT_ID-constant (toe-voeg-context)
#   - is-shipping-regel.ts (zending-specifieke VERZEND-skip, niet generieke pseudo)
#   - admin-pseudo.ts helper + tests
#   - facturen.ts banner-detect (factuur-niveau per-type-identificatie)
#   - docs en plan-bestanden
#
# Run als pre-commit hook of in CI.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
PATTERN="'BUNDELKORTING'|'DREMPELKORTING'"

WHITELIST_RE=(
  "supabase/migrations/265_pseudo_producten_bundelkorting\.sql"
  "supabase/migrations/272_producten_is_pseudo_kolom\.sql"
  "supabase/migrations/273_admin_pseudo_callsite_rewrites\.sql"
  "supabase/migrations/263_claims_skip_admin_artikelnrs\.sql"
  "supabase/migrations/266_orderregel_trigger_skip_admin\.sql"
  "supabase/migrations/269_admin_pseudos_skip_status_en_levertijd\.sql"
  "supabase/migrations/(234|256|260|261|262|264|268)_.*\.sql"
  "scripts/lint-no-hardcoded-admin-pseudo-strings\.sh"
  "scripts/retroactief-.*\.sql"
  "scripts/verifieer-.*\.sql"
  "docs/.*"
  "frontend/src/lib/orders/admin-pseudo\.ts"
  "frontend/src/lib/orders/__tests__/admin-pseudo\.test\.ts"
  "frontend/src/modules/facturatie/queries/facturen\.ts"
  "frontend/src/modules/facturatie/__tests__/.*"
  "frontend/src/components/orders/bundel-korting-banner\.tsx"
  "frontend/src/components/orders/__tests__/bundel-korting-banner\.test\.tsx"
)

WHITELIST_GREP=$(printf "|%s" "${WHITELIST_RE[@]}")
WHITELIST_GREP=${WHITELIST_GREP:1}

cd "$ROOT"
VIOLATIONS=$(git ls-files \
  | grep -E '\.(sql|ts|tsx)$' \
  | grep -E -v "(${WHITELIST_GREP})" \
  | xargs -I{} grep -lE "${PATTERN}" {} 2>/dev/null || true)

if [[ -n "$VIOLATIONS" ]]; then
  echo "Hardcoded BUNDELKORTING/DREMPELKORTING strings gevonden:" >&2
  echo "$VIOLATIONS" >&2
  echo >&2
  echo "Gebruik is_admin_pseudo() (SQL) of isAdminPseudo(regel) (TS) - zie ADR-0018." >&2
  exit 1
fi

echo "Geen hardcoded admin-pseudo-strings buiten whitelist."
