-- Migration 074: RPC voor tekort-analyse per kwaliteit/kleur-groep.
--
-- Doel: de frontend kan per tekort-groep een oorzaak tonen:
--   - geen_collectie: kwaliteit heeft geen collectie_id → geen uitwisseling mogelijk
--   - geen_voorraad:  wel uitwisselbaar, maar 0 beschikbare rollen voor deze kleur
--   - rol_te_klein:   wel voorraad, maar geen rol groot genoeg voor het grootste stuk
--   - voldoende:      theoretisch plannbaar (auto-plan moet slagen)
--
-- De client beslist uiteindelijk het label, want de "is de rol groot genoeg"-check
-- vereist de grootste snij-afmeting per groep (stuk-specifiek).

CREATE OR REPLACE FUNCTION snijplanning_tekort_analyse()
RETURNS TABLE (
  kwaliteit_code TEXT,
  kleur_code TEXT,
  heeft_collectie BOOLEAN,
  uitwisselbare_codes TEXT[],
  aantal_beschikbaar INTEGER,
  totaal_beschikbaar_m2 NUMERIC,
  max_rol_lengte_cm INTEGER,
  max_rol_breedte_cm INTEGER
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
           COALESCE(MAX(r.lengte_cm), 0)::INTEGER AS max_l,
           COALESCE(MAX(r.breedte_cm), 0)::INTEGER AS max_b
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
         COALESCE(ra.max_l, 0),
         COALESCE(ra.max_b, 0)
  FROM zusters z
  LEFT JOIN rollen_agg ra
    ON ra.kwaliteit_code = z.kwaliteit_code
   AND ra.kleur_code = z.kleur_code;
$$;

COMMENT ON FUNCTION snijplanning_tekort_analyse IS
  'Analyse per tekort-groep: collectie-status, uitwisselbare kwaliteiten, rolvoorraad in die zusters en max rol-afmeting. Zie migratie 074.';
