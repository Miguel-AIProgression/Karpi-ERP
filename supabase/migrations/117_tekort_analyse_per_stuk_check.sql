-- Migration 117: snijplanning_tekort_analyse — per-stuk rol-past check
--
-- Bug in oude versie (migratie 102): `max_lange_zijde_cm` en
-- `max_korte_zijde_cm` werden berekend als MAX(GREATEST(r.lengte, r.breedte))
-- en MAX(LEAST(r.lengte, r.breedte)) OVER ALLE ROLLEN — deze twee kunnen dus
-- van verschillende rollen komen. Voorbeeld:
--   Rol A: 500×100 (lange=500, korte=100)
--   Rol B: 200×400 (lange=400, korte=200)
-- max_lange=500 (A), max_korte=400 (B). Frontend-check
-- `stuk.lange ≤ max_lange && stuk.korte ≤ max_korte` → "past wel" voor een
-- 450×350 stuk, terwijl GEEN van beide rollen dat stuk kan bevatten.
-- Zichtbaar symptoom: "Zou plannbaar moeten zijn"-banner terwijl packing
-- consistent faalt met "Geen stukken konden geplaatst worden".
--
-- Fix: twee nieuwe kolommen die per-stuk checken of er een rol bestaat
-- die dat specifieke stuk kan bevatten:
--   grootste_onpassend_stuk_lange_cm / _korte_cm → grootste stuk dat op
--   GEEN ENKELE rol past. Als > 0 → rol_te_klein.
--
-- Daarnaast: max_lange/max_korte komen nu van DEZELFDE ROL (de rol met
-- grootste korte-zijde, tiebreak op lange-zijde). Beter voor display in
-- de rol_te_klein-banner.
--
-- Idempotent: DROP + CREATE.

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
  grootste_onpassend_stuk_korte_cm  INTEGER
) LANGUAGE sql STABLE AS $$
  WITH groepen AS (
    SELECT DISTINCT so.kwaliteit_code, so.kleur_code
    FROM snijplanning_overzicht so
    WHERE so.rol_id IS NULL
      AND so.kwaliteit_code IS NOT NULL
      AND so.kleur_code     IS NOT NULL
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
           (mc.collectie_id IS NOT NULL) AS heeft_collectie,
           CASE
             WHEN mc.collectie_id IS NOT NULL THEN (
               SELECT ARRAY_AGG(code ORDER BY code)
               FROM kwaliteiten
               WHERE collectie_id = mc.collectie_id
             )
             ELSE ARRAY[mc.kwaliteit_code]
           END AS codes
    FROM met_collectie mc
  ),
  -- Alle bruikbare rollen per groep (kwaliteit+kleur)
  rollen_per_groep AS (
    SELECT z.kwaliteit_code,
           z.kleur_code,
           r.id                                        AS rol_id,
           GREATEST(r.lengte_cm, r.breedte_cm)         AS rol_lange,
           LEAST(r.lengte_cm, r.breedte_cm)            AS rol_korte,
           COALESCE(r.oppervlak_m2, 0)                 AS m2
    FROM zusters z
    JOIN rollen r
      ON r.status IN ('beschikbaar', 'reststuk')
     AND r.kwaliteit_code = ANY(z.codes)
     AND (
       r.kleur_code = z.kleur_code
       OR r.kleur_code = z.kleur_code || '.0'
       OR r.kleur_code = regexp_replace(z.kleur_code, '\.0$', '')
     )
  ),
  -- Aggregatie per groep: aantal rollen, totaal m²
  agg AS (
    SELECT kwaliteit_code, kleur_code,
           COUNT(rol_id)::INTEGER                   AS aantal,
           COALESCE(SUM(m2), 0)::NUMERIC            AS totaal_m2
    FROM rollen_per_groep
    GROUP BY kwaliteit_code, kleur_code
  ),
  -- Beste rol per groep: grootste korte-zijde (tiebreak lange-zijde).
  -- Dit is voor display in de rol_te_klein-banner ("max ${L}×${K} cm").
  best_rol AS (
    SELECT DISTINCT ON (kwaliteit_code, kleur_code)
           kwaliteit_code, kleur_code, rol_lange, rol_korte
    FROM rollen_per_groep
    ORDER BY kwaliteit_code, kleur_code, rol_korte DESC, rol_lange DESC
  ),
  -- Per-stuk check: bestaat er een rol (in zelfde groep) waarop dit stuk past?
  -- Een stuk past als: rol.lange >= stuk.lange EN rol.korte >= stuk.korte
  stuk_checks AS (
    SELECT so.kwaliteit_code,
           so.kleur_code,
           GREATEST(so.snij_lengte_cm, so.snij_breedte_cm) AS stuk_lange,
           LEAST(so.snij_lengte_cm, so.snij_breedte_cm)    AS stuk_korte,
           EXISTS (
             SELECT 1 FROM rollen_per_groep rpg
             WHERE rpg.kwaliteit_code = so.kwaliteit_code
               AND rpg.kleur_code     = so.kleur_code
               AND rpg.rol_lange >= GREATEST(so.snij_lengte_cm, so.snij_breedte_cm)
               AND rpg.rol_korte >= LEAST(so.snij_lengte_cm, so.snij_breedte_cm)
           ) AS past
    FROM snijplanning_overzicht so
    WHERE so.rol_id IS NULL
      AND so.snij_lengte_cm IS NOT NULL
      AND so.snij_breedte_cm IS NOT NULL
      AND so.snij_lengte_cm > 0
      AND so.snij_breedte_cm > 0
  ),
  -- Grootste stuk dat NIET past (hoogste lange, tiebreak korte)
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
  LEFT JOIN agg                ON agg.kwaliteit_code = z.kwaliteit_code AND agg.kleur_code = z.kleur_code
  LEFT JOIN best_rol           br ON br.kwaliteit_code = z.kwaliteit_code AND br.kleur_code = z.kleur_code
  LEFT JOIN grootste_onpassend go ON go.kwaliteit_code = z.kwaliteit_code AND go.kleur_code = z.kleur_code;
$$;

COMMENT ON FUNCTION snijplanning_tekort_analyse() IS
  'Tekort-analyse per snijden-groep met per-stuk rol-past check. '
  'max_lange/max_korte komen van DEZELFDE rol (beste beschikbare, grootste korte-zijde). '
  'grootste_onpassend_stuk_* geeft het grootste stuk dat op GEEN ENKELE rol past — '
  'frontend gebruikt dit om rol_te_klein vs voldoende te onderscheiden. '
  'Zie migratie 117 voor de bug-context (verschillende rollen mochten niet samen max_l/max_k leveren).';
