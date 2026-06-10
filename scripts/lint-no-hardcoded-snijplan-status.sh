#!/usr/bin/env bash
# Voorkom regressie naar hardcoded snijplan-status-arrays buiten de single-source.
# Single-source: frontend/src/lib/utils/snijplan-status.ts + _shared/snijplan-status.ts.
# Patroon: een array-literal die >=2 snijplan-statussen naast elkaar bevat.
#
# Run als pre-commit hook of in CI.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
# Twee aaneengesloten quoted statussen in een array-context.
PATTERN="\[[^]]*'(Wacht|Gepland|In productie|Snijden|Gesneden|In confectie|Gereed|Ingepakt|Geannuleerd)'[^]]*'(Wacht|Gepland|In productie|Snijden|Gesneden|In confectie|Gereed|Ingepakt|Geannuleerd)'"

WHITELIST_RE=(
  "frontend/src/lib/utils/snijplan-status\.ts"
  "supabase/functions/_shared/snijplan-status\.ts"
  "frontend/src/lib/utils/constants\.ts"
  "frontend/src/lib/utils/__tests__/.*"
  "supabase/migrations/.*"
  "docs/.*"
  "scripts/lint-no-hardcoded-snijplan-status\.sh"
)
WHITELIST_GREP=$(printf "|%s" "${WHITELIST_RE[@]}"); WHITELIST_GREP=${WHITELIST_GREP:1}

cd "$ROOT"
VIOLATIONS=$(git ls-files \
  | grep -E '\.(ts|tsx)$' \
  | grep -E -v "(${WHITELIST_GREP})" \
  | xargs -I{} grep -lEn "${PATTERN}" {} 2>/dev/null || true)

if [[ -n "$VIOLATIONS" ]]; then
  echo "Hardcoded snijplan-status-array gevonden buiten de single-source:" >&2
  echo "$VIOLATIONS" >&2
  echo >&2
  echo "Gebruik TE_SNIJDEN/ROL_FYSIEK_BEZET/INPAK_KANDIDAAT/CONFECTIE_INSTROOM uit snijplan-status.ts." >&2
  exit 1
fi
echo "Geen hardcoded snijplan-status-arrays buiten de single-source."
