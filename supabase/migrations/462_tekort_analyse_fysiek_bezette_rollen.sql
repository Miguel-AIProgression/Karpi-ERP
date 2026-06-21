-- Migratie 462: snijplanning_tekort_analyse() onderscheidt "bestaat nergens"
-- van "bestaat wel, maar volledig ingedeeld bij andere orders"
--
-- AANLEIDING
-- "0 rollen beschikbaar" (aantal_beschikbaar) telt alleen rollen met
-- status IN ('beschikbaar','reststuk') — een rol die status='in_snijplan'
-- of 'verkocht' heeft (fysiek aanwezig, maar al toegewezen aan ándere
-- snijplan-stukken) telt niet mee. Dat gaf op de Master Planning-pagina een
-- misleidende "0 rollen beschikbaar"-melding voor CAVA·12, terwijl er
-- gewoon 3 fysieke rollen van die kwaliteit/kleur bestaan — ze waren alleen
-- (deels) al belegd door andere orders. De gebruiker wil in dat geval zien
-- WELKE orders die rollen bezet houden.
--
-- WIJZIGING
-- Nieuwe kolom `aantal_fysiek_bezet` (rollen met status IN ('in_snijplan',
-- 'verkocht') voor dezelfde (kwaliteit,kleur)+uitwisselbare-paren-groep).
-- `aantal_beschikbaar = 0 AND aantal_fysiek_bezet > 0` is het signaal voor
-- de frontend om i.p.v. "0 rollen beschikbaar" te tonen: "rollen bestaan
-- wel, maar zijn volledig ingedeeld" + een link naar de bestaande
-- productie-groep-pagina (toont per rol welke orders erop staan).
-- CREATE OR REPLACE op de mig 439-body — superset, geen andere wijziging.

-- RETURNS TABLE-signatuur wijzigt (nieuwe kolom) — CREATE OR REPLACE staat dat
-- niet toe bij een andere rijtype, dus eerst de oude functie droppen.
DROP FUNCTION IF EXISTS snijplanning_tekort_analyse();

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
  grootste_onpassend_stuk_korte_cm  INTEGER,
  aantal_fysiek_bezet               INTEGER
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
  -- NIEUW (mig 462): fysiek aanwezige maar al toegewezen rollen, zelfde
  -- (kwaliteit,kleur)+uitwisselbare-paren-scope als rollen_per_groep.
  fysiek_bezette_rollen AS (
    SELECT
      p.kwaliteit_code,
      p.kleur_code,
      r.id AS rol_id
    FROM paren p
    JOIN rollen r
      ON r.status IN ('in_snijplan', 'verkocht')
     AND r.kwaliteit_code = p.target_kw
     AND normaliseer_kleur_code(r.kleur_code) = p.target_kl_norm
  ),
  fysiek_bezet_agg AS (
    SELECT kwaliteit_code, kleur_code,
           COUNT(DISTINCT rol_id)::INTEGER AS aantal
    FROM fysiek_bezette_rollen
    GROUP BY kwaliteit_code, kleur_code
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
         COALESCE(go.stuk_korte, 0)::INTEGER AS grootste_onpassend_stuk_korte_cm,
         COALESCE(fb.aantal,     0)          AS aantal_fysiek_bezet
  FROM zusters z
  LEFT JOIN agg                   ON agg.kwaliteit_code = z.kwaliteit_code AND agg.kleur_code = z.kleur_code
  LEFT JOIN best_rol           br ON br.kwaliteit_code  = z.kwaliteit_code AND br.kleur_code  = z.kleur_code
  LEFT JOIN grootste_onpassend go ON go.kwaliteit_code  = z.kwaliteit_code AND go.kleur_code  = z.kleur_code
  LEFT JOIN fysiek_bezet_agg   fb ON fb.kwaliteit_code  = z.kwaliteit_code AND fb.kleur_code  = z.kleur_code;
$$;

COMMENT ON FUNCTION snijplanning_tekort_analyse() IS
  'Tekort-analyse per snijden-groep (mig 142), sluit sinds mig 439 stukken met '
  'status=''Wacht op inkoop'' uit. Mig 462: aantal_fysiek_bezet onderscheidt '
  '"0 rollen bestaan" van "rollen bestaan, zijn alleen al ingedeeld bij andere '
  'orders" (status in_snijplan/verkocht).';

NOTIFY pgrst, 'reload schema';
