-- Migration 137: RPC besteld_per_kwaliteit_kleur()
--
-- Doel: aggregatie van openstaande inkooporder-regels per (kwaliteit, kleur)
-- zodat de rollen-overview pagina per groep kan tonen hoeveel m² besteld is
-- en wat de eerstvolgende leverweek is.
--
-- Gebruikt door:
--   - frontend/src/pages/rollen/rollen-overview.tsx  → tag "besteld m²"
--   - frontend/src/pages/producten/product-detail.tsx → sectie "Openstaande inkooporders"
--
-- Hergebruikt de bestaande view `openstaande_inkooporder_regels` (migratie 127)
-- die al filtert op te_leveren_m > 0 en status in (Concept/Besteld/Deels ontvangen).

CREATE OR REPLACE FUNCTION besteld_per_kwaliteit_kleur()
RETURNS TABLE (
  kwaliteit_code                TEXT,
  kleur_code                    TEXT,
  besteld_m                     NUMERIC,
  besteld_m2                    NUMERIC,
  orders_count                  BIGINT,
  eerstvolgende_leverweek       TEXT,
  eerstvolgende_verwacht_datum  DATE,
  eerstvolgende_m               NUMERIC,
  eerstvolgende_m2              NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH eerstvolg AS (
    SELECT DISTINCT ON (v.kwaliteit_code, v.kleur_code)
      v.kwaliteit_code,
      v.kleur_code,
      v.leverweek,
      v.verwacht_datum
    FROM openstaande_inkooporder_regels v
    WHERE v.kwaliteit_code IS NOT NULL
      AND v.kleur_code IS NOT NULL
      AND v.verwacht_datum IS NOT NULL
    ORDER BY v.kwaliteit_code, v.kleur_code, v.verwacht_datum ASC
  )
  SELECT
    v.kwaliteit_code,
    v.kleur_code,
    COALESCE(SUM(v.te_leveren_m), 0)::NUMERIC AS besteld_m,
    COALESCE(SUM(
      CASE
        WHEN COALESCE(k.standaard_breedte_cm, 0) > 0
          THEN v.te_leveren_m * k.standaard_breedte_cm / 100.0
        ELSE 0
      END
    ), 0)::NUMERIC AS besteld_m2,
    COUNT(DISTINCT v.inkooporder_id)::BIGINT AS orders_count,
    MAX(e.leverweek)                          AS eerstvolgende_leverweek,
    MAX(e.verwacht_datum)                     AS eerstvolgende_verwacht_datum,
    COALESCE(SUM(v.te_leveren_m) FILTER (
      WHERE e.verwacht_datum IS NOT NULL
        AND v.verwacht_datum = e.verwacht_datum
    ), 0)::NUMERIC AS eerstvolgende_m,
    COALESCE(SUM(
      CASE
        WHEN v.verwacht_datum IS NOT NULL
         AND e.verwacht_datum IS NOT NULL
         AND v.verwacht_datum = e.verwacht_datum
         AND COALESCE(k.standaard_breedte_cm, 0) > 0
        THEN v.te_leveren_m * k.standaard_breedte_cm / 100.0
        ELSE 0
      END
    ), 0)::NUMERIC AS eerstvolgende_m2
  FROM openstaande_inkooporder_regels v
  LEFT JOIN kwaliteiten k ON k.code = v.kwaliteit_code
  LEFT JOIN eerstvolg e
    ON e.kwaliteit_code = v.kwaliteit_code
   AND e.kleur_code     = v.kleur_code
  WHERE v.kwaliteit_code IS NOT NULL
    AND v.kleur_code IS NOT NULL
  GROUP BY v.kwaliteit_code, v.kleur_code;
$$;

COMMENT ON FUNCTION besteld_per_kwaliteit_kleur IS
  'Aggregeert openstaande inkooporder-regels per (kwaliteit, kleur): '
  'totaal besteld in meters + m², aantal orders, eerstvolgende leverweek/datum '
  'en het deel dat in die eerstvolgende levering valt. '
  'M² berekend via kwaliteiten.standaard_breedte_cm (alleen voor regels met '
  'bekende breedte; anders 0). Bron: view openstaande_inkooporder_regels.';

GRANT EXECUTE ON FUNCTION besteld_per_kwaliteit_kleur() TO anon, authenticated;
