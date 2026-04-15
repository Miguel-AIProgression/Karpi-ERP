-- Migration 076: breid tekort-analyse uit met max-lange-zijde en max-korte-zijde.
--
-- Zonder min-side info kan de UI niet zien of een stuk in *enige* beschikbare
-- rol past. We voegen toe:
--   max_lange_zijde_cm = max(greatest(lengte, breedte)) over beschikbare rollen
--   max_korte_zijde_cm = max(least(lengte, breedte)) over beschikbare rollen
--
-- Coarse check client-side: stuk past als stuk_long <= max_lange EN stuk_short
-- <= max_korte. Vals-positief mogelijk (twee aggregates kunnen uit verschillende
-- rollen komen), maar vals-negatieve "te klein" is uitgesloten.

DROP FUNCTION IF EXISTS snijplanning_tekort_analyse();

CREATE OR REPLACE FUNCTION snijplanning_tekort_analyse()
RETURNS TABLE (
  kwaliteit_code TEXT,
  kleur_code TEXT,
  heeft_collectie BOOLEAN,
  uitwisselbare_codes TEXT[],
  aantal_beschikbaar INTEGER,
  totaal_beschikbaar_m2 NUMERIC,
  max_lange_zijde_cm INTEGER,
  max_korte_zijde_cm INTEGER
) LANGUAGE sql STABLE AS $$
  WITH groepen AS (
    SELECT DISTINCT so.kwaliteit_code, so.kleur_code
    FROM snijplanning_overzicht so
    WHERE so.status = 'Snijden'
      AND so.rol_id IS NULL
      AND so.kwaliteit_code IS NOT NULL
  ),
  met_collectie AS (
    SELECT g.kwaliteit_code,
           g.kleur_code,
           k.collectie_id
    FROM groepen g
    LEFT JOIN kwaliteiten k ON k.code = g.kwaliteit_code
  ),
  zusters AS (
    SELECT mc.kwaliteit_code,
           mc.kleur_code,
           mc.collectie_id IS NOT NULL AS heeft_collectie,
           CASE
             WHEN mc.collectie_id IS NULL THEN ARRAY[mc.kwaliteit_code]
             ELSE (SELECT ARRAY_AGG(code ORDER BY code)
                   FROM kwaliteiten
                   WHERE collectie_id = mc.collectie_id)
           END AS codes
    FROM met_collectie mc
  ),
  rollen_agg AS (
    SELECT z.kwaliteit_code,
           z.kleur_code,
           COUNT(r.id)::INTEGER AS aantal,
           COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC AS totaal_m2,
           COALESCE(MAX(GREATEST(r.lengte_cm, r.breedte_cm)), 0)::INTEGER AS max_lange,
           COALESCE(MAX(LEAST(r.lengte_cm, r.breedte_cm)), 0)::INTEGER AS max_korte
    FROM zusters z
    LEFT JOIN rollen r
      ON r.kwaliteit_code = ANY(z.codes)
     AND r.status IN ('beschikbaar', 'reststuk')
     AND (
       r.kleur_code = z.kleur_code
       OR r.kleur_code = z.kleur_code || '.0'
       OR r.kleur_code = regexp_replace(z.kleur_code, '\.0$', '')
     )
    GROUP BY z.kwaliteit_code, z.kleur_code
  )
  SELECT z.kwaliteit_code,
         z.kleur_code,
         z.heeft_collectie,
         z.codes,
         COALESCE(ra.aantal, 0),
         COALESCE(ra.totaal_m2, 0),
         COALESCE(ra.max_lange, 0),
         COALESCE(ra.max_korte, 0)
  FROM zusters z
  LEFT JOIN rollen_agg ra
    ON ra.kwaliteit_code = z.kwaliteit_code
   AND ra.kleur_code = z.kleur_code;
$$;

COMMENT ON FUNCTION snijplanning_tekort_analyse IS
  'Analyse per tekort-groep: collectie, uitwisselbare kwaliteiten, rolvoorraad + max lange/korte zijde. Zie migratie 076.';
