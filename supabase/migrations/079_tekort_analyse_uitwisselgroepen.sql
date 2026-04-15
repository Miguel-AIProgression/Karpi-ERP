-- Migration 079: tekort-analyse gebruikt Map1 uitwisselgroepen (primair) met
-- fallback op `collecties`.
--
-- Achtergrond: de frontend-UI (groep-accordion "Tekort"-tab) toont meldingen
-- "Geen collectie gekoppeld" en "Geen voorraad in uitwisselbare kwaliteiten
-- (…)". Die meldingen komen uit `snijplanning_tekort_analyse()`. Die functie
-- kende alleen het `collecties`-pad. Na migratie 078 (fijnmazige Map1-tabel)
-- moet de analyse dezelfde bron gebruiken als de edge-functies.

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
  -- Fijnmazig pad: paren uit Map1 (kwaliteit_kleur_uitwisselgroepen via view)
  map1_paren AS (
    SELECT g.kwaliteit_code,
           g.kleur_code,
           v.uitwissel_kwaliteit_code,
           v.uitwissel_kleur_code
    FROM groepen g
    JOIN kwaliteit_kleur_uitwisselbaar v
      ON v.input_kwaliteit_code = g.kwaliteit_code
     AND (
       v.input_kleur_code = g.kleur_code
       OR v.input_kleur_code = g.kleur_code || '.0'
       OR v.input_kleur_code = regexp_replace(g.kleur_code, '\.0$', '')
     )
  ),
  -- Fallback pad: collecties (enkel voor groepen zónder Map1-rij)
  met_collectie AS (
    SELECT g.kwaliteit_code,
           g.kleur_code,
           k.collectie_id,
           EXISTS (SELECT 1 FROM map1_paren m
                   WHERE m.kwaliteit_code = g.kwaliteit_code
                     AND m.kleur_code = g.kleur_code) AS heeft_map1
    FROM groepen g
    LEFT JOIN kwaliteiten k ON k.code = g.kwaliteit_code
  ),
  zusters AS (
    SELECT mc.kwaliteit_code,
           mc.kleur_code,
           -- "heeft_collectie" = uitwisselbaarheid bekend (Map1 OR collectie)
           (mc.heeft_map1 OR mc.collectie_id IS NOT NULL) AS heeft_collectie,
           CASE
             WHEN mc.heeft_map1 THEN (
               SELECT ARRAY_AGG(DISTINCT mp.uitwissel_kwaliteit_code ORDER BY mp.uitwissel_kwaliteit_code)
               FROM map1_paren mp
               WHERE mp.kwaliteit_code = mc.kwaliteit_code
                 AND mp.kleur_code = mc.kleur_code
             )
             WHEN mc.collectie_id IS NOT NULL THEN (
               SELECT ARRAY_AGG(code ORDER BY code)
               FROM kwaliteiten
               WHERE collectie_id = mc.collectie_id
             )
             ELSE ARRAY[mc.kwaliteit_code]
           END AS codes,
           mc.heeft_map1
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
      ON r.status IN ('beschikbaar', 'reststuk')
     AND (
       -- Map1-pad: exact match op (kwaliteit, kleur) tegen de paren
       (z.heeft_map1 AND EXISTS (
         SELECT 1 FROM map1_paren mp
         WHERE mp.kwaliteit_code = z.kwaliteit_code
           AND mp.kleur_code     = z.kleur_code
           AND mp.uitwissel_kwaliteit_code = r.kwaliteit_code
           AND mp.uitwissel_kleur_code     = r.kleur_code
       ))
       OR
       -- Fallback: zoals vroeger (kwaliteit IN codes + kleur-variant match)
       (NOT z.heeft_map1
         AND r.kwaliteit_code = ANY(z.codes)
         AND (
           r.kleur_code = z.kleur_code
           OR r.kleur_code = z.kleur_code || '.0'
           OR r.kleur_code = regexp_replace(z.kleur_code, '\.0$', '')
         )
       )
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
  'Analyse per tekort-groep. Primair: Map1-uitwisselgroepen; fallback: collecties. Zie migratie 079.';
