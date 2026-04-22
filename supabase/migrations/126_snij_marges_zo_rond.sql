-- Migration 126: snij-marges voor ZO-afwerking (+6 cm) en Rond/Ovaal (+5 cm)
--
-- Aanleiding: de operator snijdt een stuk met ZO-afwerking 6 cm groter (120x120
-- wordt als 126x126 gesneden, daarna 6 cm rondom verwerkt = 120x120 klant-maat).
-- Ronde/ovale stukken krijgen 5 cm speling voor het handmatig uitzagen van de
-- vorm. Voorheen kreeg de planner de nominale maat door, waardoor stukken te
-- krap geplaatst werden (bijv. een 320x230 ronde geplaatst als 320x230 i.p.v.
-- 325x235) en de tekort-analyse kon stukken als "passend" classificeren die
-- fysiek eigenlijk niet pasten.
--
-- Aanpak:
--   (1) SQL-helper `stuk_snij_marge_cm(afwerking, vorm)` geeft de marge (0, 5, 6).
--       Deze functie is de single source of truth voor de marge-regel binnen SQL.
--   (2) `snijplanning_tekort_analyse()` gebruikt de functie zodat de rol-past
--       check met opgehoogde stuk-maat rekent (anders zegt tekort-analyse "past"
--       terwijl de packer het stuk NIET kan plaatsen).
--
-- Marge-regel (TS-equivalent leeft in supabase/functions/_shared/snij-marges.ts
-- en frontend/src/lib/utils/snij-marges.ts — houd synchroon):
--   - maatwerk_afwerking = 'ZO'                    → +6 cm (beide dimensies)
--   - maatwerk_vorm IN ('rond', 'ovaal')           → +5 cm (beide dimensies)
--   - Beide tegelijk: neem de grootste (GREATEST), niet cumulatief.
--
-- Idempotent: CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- (1) Helper-functie
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION stuk_snij_marge_cm(
  afwerking TEXT,
  vorm      TEXT
) RETURNS INTEGER
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT GREATEST(
    CASE WHEN afwerking = 'ZO'                                     THEN 6 ELSE 0 END,
    CASE WHEN lower(COALESCE(vorm, '')) IN ('rond', 'ovaal')       THEN 5 ELSE 0 END
  );
$$;

COMMENT ON FUNCTION stuk_snij_marge_cm(TEXT, TEXT) IS
  'Extra cm op elke dimensie bij snijden. ZO-afwerking: +6 cm (6 cm rondom afwerking). '
  'Rond/ovaal: +5 cm speling voor handmatig uitzagen. Bij combi wint de grootste marge, '
  'niet cumulatief. Houd synchroon met snij-marges.ts in edge function en frontend.';

-- ---------------------------------------------------------------------------
-- (2) snijplanning_tekort_analyse — rol-past check met marge
-- ---------------------------------------------------------------------------
-- Ongewijzigd t.o.v. migratie 117 behalve de `stuk_checks`-CTE die de marge
-- meeneemt in de te vergelijken stuk-maten (+ afwerking/vorm meelezen uit
-- snijplanning_overzicht om de marge te kunnen berekenen).

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
  agg AS (
    SELECT kwaliteit_code, kleur_code,
           COUNT(rol_id)::INTEGER                   AS aantal,
           COALESCE(SUM(m2), 0)::NUMERIC            AS totaal_m2
    FROM rollen_per_groep
    GROUP BY kwaliteit_code, kleur_code
  ),
  best_rol AS (
    SELECT DISTINCT ON (kwaliteit_code, kleur_code)
           kwaliteit_code, kleur_code, rol_lange, rol_korte
    FROM rollen_per_groep
    ORDER BY kwaliteit_code, kleur_code, rol_korte DESC, rol_lange DESC
  ),
  -- Per-stuk check met snij-marge. De marge (ZO/rond/ovaal) wordt bij de
  -- nominale maat opgeteld voordat we tegen rol-dimensies vergelijken, omdat
  -- de packer ook met opgehoogde maat plant. Een 320x230 ronde moet op een
  -- rol passen met beide zijden >= 325x235 — niet 320x230.
  stuk_checks AS (
    SELECT so.kwaliteit_code,
           so.kleur_code,
           GREATEST(so.snij_lengte_cm, so.snij_breedte_cm)
             + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm)  AS stuk_lange,
           LEAST(so.snij_lengte_cm, so.snij_breedte_cm)
             + stuk_snij_marge_cm(so.maatwerk_afwerking, so.maatwerk_vorm)  AS stuk_korte,
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
      AND so.snij_lengte_cm IS NOT NULL
      AND so.snij_breedte_cm IS NOT NULL
      AND so.snij_lengte_cm > 0
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
  LEFT JOIN agg                ON agg.kwaliteit_code = z.kwaliteit_code AND agg.kleur_code = z.kleur_code
  LEFT JOIN best_rol           br ON br.kwaliteit_code = z.kwaliteit_code AND br.kleur_code = z.kleur_code
  LEFT JOIN grootste_onpassend go ON go.kwaliteit_code = z.kwaliteit_code AND go.kleur_code = z.kleur_code;
$$;

COMMENT ON FUNCTION snijplanning_tekort_analyse() IS
  'Tekort-analyse per snijden-groep met per-stuk rol-past check. '
  'Past stuk_snij_marge_cm() toe op snij_lengte/breedte zodat rol-past check '
  'met dezelfde opgehoogde maat rekent als de packer (ZO: +6cm, rond/ovaal: +5cm). '
  'max_lange/max_korte komen van DEZELFDE rol (beste beschikbare, grootste korte-zijde). '
  'grootste_onpassend_stuk_* geeft het grootste stuk (incl. marge) dat op GEEN ENKELE rol past. '
  'Zie migratie 117 voor de basis-fix en 126 voor de marge-uitbreiding.';
