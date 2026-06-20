-- Migratie 439: snijplanning_tekort_analyse() sluit 'Wacht op inkoop' uit
--
-- Vervolg op mig 437/438. Zodra een stuk geclaimd is tegen een openstaande
-- rol-inkooporder (status='Wacht op inkoop', rol_id blijft NULL) mag het niet
-- langer als "Tekort" meetellen — het heeft al een dekking, alleen nog geen
-- fysieke rol. Zonder deze aanpassing zou de tekort-tab het stuk dubbel tonen
-- (Tekort + straks ook "Wacht op inkoop").
--
-- CREATE OR REPLACE op de mig 142-body; enige functionele wijziging is de
-- toegevoegde statusfilter in zowel `groepen` als `stuk_checks` (beide lezen
-- onafhankelijk van elkaar `snijplanning_overzicht WHERE rol_id IS NULL`).

CREATE OR REPLACE FUNCTION snijplanning_tekort_analyse()
RETURNS TABLE (
  kwaliteit_code                    TEXT,
  kleur_code                        TEXT,
  heeft_collectie                   BOOLEAN,
  uitwisselbare_codes               TEXT[],
  aantal_beschikbaar                INTEGER,
  totaal_beschikbaar_m2             NUMERIC,
  max_lange_zijde_cm                INTEGER,
  max_korte_zijde_cm                INTEGER,
  grootste_onpassend_stuk_lange_cm  INTEGER,
  grootste_onpassend_stuk_korte_cm  INTEGER
) LANGUAGE sql STABLE AS $$
  WITH groepen AS (
    SELECT DISTINCT so.kwaliteit_code, so.kleur_code
    FROM snijplanning_overzicht so
    WHERE so.rol_id IS NULL
      AND so.status <> 'Wacht op inkoop'
      AND so.kwaliteit_code IS NOT NULL
      AND so.kleur_code     IS NOT NULL
  ),
  -- Per snijden-groep: alle uitwissel-paren via canonieke seam.
  paren AS (
    SELECT
      g.kwaliteit_code,
      g.kleur_code,
      up.target_kwaliteit_code AS target_kw,
      up.target_kleur_code     AS target_kl_norm,
      up.is_zelf
    FROM groepen g
    CROSS JOIN LATERAL uitwisselbare_paren(g.kwaliteit_code, g.kleur_code) up
  ),
  zusters AS (
    SELECT
      g.kwaliteit_code,
      g.kleur_code,
      EXISTS (
        SELECT 1 FROM paren p
        WHERE p.kwaliteit_code = g.kwaliteit_code
          AND p.kleur_code     = g.kleur_code
          AND NOT p.is_zelf
      ) AS heeft_collectie,
      (SELECT ARRAY_AGG(DISTINCT p.target_kw ORDER BY p.target_kw)
         FROM paren p
        WHERE p.kwaliteit_code = g.kwaliteit_code
          AND p.kleur_code     = g.kleur_code
      ) AS codes
    FROM groepen g
  ),
  rollen_per_groep AS (
    SELECT
      p.kwaliteit_code,
      p.kleur_code,
      r.id                                AS rol_id,
      GREATEST(r.lengte_cm, r.breedte_cm) AS rol_lange,
      LEAST(r.lengte_cm, r.breedte_cm)    AS rol_korte,
      COALESCE(r.oppervlak_m2, 0)         AS m2
    FROM paren p
    JOIN rollen r
      ON r.status IN ('beschikbaar', 'reststuk')
     AND r.kwaliteit_code = p.target_kw
     AND normaliseer_kleur_code(r.kleur_code) = p.target_kl_norm
     AND r.lengte_cm  > 0
     AND r.breedte_cm > 0
  ),
  agg AS (
    SELECT kwaliteit_code, kleur_code,
           COUNT(DISTINCT rol_id)::INTEGER AS aantal,
           COALESCE(SUM(m2), 0)::NUMERIC   AS totaal_m2
    FROM rollen_per_groep
    GROUP BY kwaliteit_code, kleur_code
  ),
  best_rol AS (
    SELECT DISTINCT ON (kwaliteit_code, kleur_code)
           kwaliteit_code, kleur_code, rol_lange, rol_korte
    FROM rollen_per_groep
    ORDER BY kwaliteit_code, kleur_code, rol_korte DESC, rol_lange DESC
  ),
  stuk_checks AS (
    SELECT so.kwaliteit_code,
           so.kleur_code,
           GREATEST(so.snij_lengte_cm, so.snij_breedte_cm)
             + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm) AS stuk_lange,
           LEAST(so.snij_lengte_cm, so.snij_breedte_cm)
             + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm) AS stuk_korte,
           EXISTS (
             SELECT 1 FROM rollen_per_groep rpg
             WHERE rpg.kwaliteit_code = so.kwaliteit_code
               AND rpg.kleur_code     = so.kleur_code
               AND rpg.rol_lange >= GREATEST(so.snij_lengte_cm, so.snij_breedte_cm)
                                    + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm)
               AND rpg.rol_korte >= LEAST(so.snij_lengte_cm, so.snij_breedte_cm)
                                    + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm)
           ) AS past
    FROM snijplanning_overzicht so
    WHERE so.rol_id IS NULL
      AND so.status <> 'Wacht op inkoop'
      AND so.snij_lengte_cm  IS NOT NULL
      AND so.snij_breedte_cm IS NOT NULL
      AND so.snij_lengte_cm  > 0
      AND so.snij_breedte_cm > 0
  ),
  grootste_onpassend AS (
    SELECT DISTINCT ON (kwaliteit_code, kleur_code)
           kwaliteit_code, kleur_code, stuk_lange, stuk_korte
    FROM stuk_checks
    WHERE past = FALSE
    ORDER BY kwaliteit_code, kleur_code, stuk_lange DESC, stuk_korte DESC
  )
  SELECT z.kwaliteit_code,
         z.kleur_code,
         z.heeft_collectie,
         z.codes,
         COALESCE(agg.aantal,    0),
         COALESCE(agg.totaal_m2, 0),
         COALESCE(br.rol_lange,  0)::INTEGER AS max_lange_zijde_cm,
         COALESCE(br.rol_korte,  0)::INTEGER AS max_korte_zijde_cm,
         COALESCE(go.stuk_lange, 0)::INTEGER AS grootste_onpassend_stuk_lange_cm,
         COALESCE(go.stuk_korte, 0)::INTEGER AS grootste_onpassend_stuk_korte_cm
  FROM zusters z
  LEFT JOIN agg                   ON agg.kwaliteit_code = z.kwaliteit_code AND agg.kleur_code = z.kleur_code
  LEFT JOIN best_rol           br ON br.kwaliteit_code  = z.kwaliteit_code AND br.kleur_code  = z.kleur_code
  LEFT JOIN grootste_onpassend go ON go.kwaliteit_code  = z.kwaliteit_code AND go.kleur_code  = z.kleur_code;
$$;

COMMENT ON FUNCTION snijplanning_tekort_analyse() IS
  'Tekort-analyse per snijden-groep (mig 142), sluit sinds mig 439 stukken met '
  'status=''Wacht op inkoop'' uit — die hebben al dekking via een openstaande '
  'rol-inkooporder (mig 437/438) en zijn geen tekort meer.';
