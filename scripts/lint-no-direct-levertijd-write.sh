#!/usr/bin/env bash
# scripts/lint-no-direct-levertijd-write.sh
# Faalt als een directe schrijf naar de Levertijd-Module-velden
#   orders.levertijd_status  /  orders.standaard_afleverdatum_berekend
# voorkomt buiten de Levertijd-Module zelf.
# Scope: supabase/migrations/*.sql + supabase/functions/**/*.ts (recursief).
#
# ADR-0020: orders.levertijd_status wordt uitsluitend door de BEFORE-trigger
# trg_levertijd_status_recalc gederive't uit afleverdatum vs
# standaard_afleverdatum_berekend. Een directe `UPDATE orders SET
# levertijd_status` of `INSERT INTO orders (... levertijd_status ...)` zou
# het Module-label kunnen ontkoppelen van de bron-waarheid. De snapshot-kolom
# standaard_afleverdatum_berekend mag alleen gezet worden door de Module-eigen
# migratie en het order-mutations snapshot-pad.
#
# NOOT — frontend buiten scope: stap 6 schrijft
# standaard_afleverdatum_berekend via het order-mutations snapshot-pad
# (frontend/src/lib/supabase/queries/order-mutations.ts). Dat is frontend TS
# en valt buiten de SQL/edge-function-scan-scope van dit script, dus daarvoor
# is bewust GEEN whitelist-entry opgenomen.
#
# NOOT — trigger is geen UPDATE: de PL/pgSQL-toewijzing
# `NEW.levertijd_status := ...` in trg_levertijd_status_recalc is geen
# `UPDATE orders SET`-statement en wordt door de regex niet geflagd; de
# trigger-functie hoeft daarom niet apart te worden gewhitelist.
#
# Platform-noot: gebruikt POSIX-shell + multi-line PCRE-grep (grep -Pz).
# Op Windows draaien via Git Bash. Op Unix: maak executable via
# `chmod +x scripts/lint-no-direct-levertijd-write.sh`.
set -euo pipefail

# Multi-line PCRE-grep heeft een UTF-8/unibyte-locale nodig.
export LC_ALL="${LC_ALL:-C.UTF-8}"
export LANG="${LANG:-C.UTF-8}"

# De enige Module-eigen schrijver: mig 276 voegt de kolommen + trigger toe
# en doet de forward-looking backfill (UPDATE orders SET
# standaard_afleverdatum_berekend = afleverdatum). Migraties 277/278 raken
# alleen RPC's/views aan (lezen v.levertijd_status), geen directe orders-write
# — geverifieerd met grep, daarom NIET gewhitelist.
ALLOWED_PATHS=(
  'supabase/migrations/276_levertijd_status_kolom_en_trigger.sql'
)

# Multi-line (grep -Pz) zodat een `UPDATE orders` met de SET op een
# volgende regel óók wordt gevangen — een line-based regex zou de
# canonieke multi-line backfill (en toekomstige multi-line violations)
# missen en valse veiligheid geven.
# Twee patronen: UPDATE orders SET ... <kolom>, INSERT INTO orders ... <kolom>,
# voor beide Levertijd-Module-velden, t/m de eerstvolgende ';'.
PATTERN='(UPDATE\s+orders\s+SET[^;]*?\b(levertijd_status|standaard_afleverdatum_berekend)\b|INSERT\s+INTO\s+orders\b[^;]*?\b(levertijd_status|standaard_afleverdatum_berekend)\b)'

failed=0

check_tree() {
  local root="$1" glob="$2"
  local f
  # grep -Pzl: lijst bestanden waarin het multi-line-patroon (over ';' heen
  # niet) ergens voorkomt. NUL-gescheiden -> while-read met -d ''.
  while IFS= read -r -d '' f; do
    [ -z "$f" ] && continue
    local allowed=0 path
    for path in "${ALLOWED_PATHS[@]}"; do
      if [[ "$f" == *"$path"* ]]; then allowed=1; break; fi
    done
    if [ "$allowed" -eq 0 ]; then
      echo "FAIL: $f — directe schrijf op orders.levertijd_status / orders.standaard_afleverdatum_berekend verboden (ADR-0020). levertijd_status wordt door de trigger trg_levertijd_status_recalc gederive't; gebruik de Levertijd-Module."
      failed=1
    fi
  done < <(grep -rPzl --include="$glob" "$PATTERN" "$root" 2>/dev/null || true)
}

# 1) SQL-migraties.
check_tree supabase/migrations '*.sql'

# 2) Edge functions (recursief alle *.ts).
check_tree supabase/functions '*.ts'

if [ "$failed" -eq 1 ]; then
  echo ""
  echo "De Levertijd-Module (ADR-0020) is de enige schrijver van"
  echo "orders.levertijd_status en orders.standaard_afleverdatum_berekend."
  echo "levertijd_status volgt automatisch uit de BEFORE-trigger; zet het"
  echo "label nooit direct. Zie ADR-0020 + mig 276."
  exit 1
fi

echo "OK: geen directe schrijfacties op orders.levertijd_status / orders.standaard_afleverdatum_berekend buiten Levertijd-Module allowlist"
