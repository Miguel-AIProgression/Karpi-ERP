-- Migration 134: snijplanning_tekort_analyse() synchroon trekken met edge
-- (hernummerd van 132 → 134 vanwege 131-collision met inkoop-FK-fix)
--
-- Twee UI-verschillen t.o.v. de edge function `auto-plan-groep`:
--
-- (1) UITWISSELBAARHEID: de edge raadpleegt primair de fijnmazige Map1
--     (view `kwaliteit_kleur_uitwisselbaar` — expliciete (kw,kl)-paren uit
--     `kwaliteit_kleur_uitwisselgroepen`) en valt alleen terug op
--     `kwaliteiten.collectie_id` als Map1 leeg is. De tekort-analyse
--     gebruikte tot nu toe uitsluitend `collectie_id`. Gevolg: UI zei
--     "geen collectie" voor paren die via Map1 wél uitwisselbaar zijn
--     (bv. OASI 51 ↔ WOTO 51).
--
-- (2) PLACEHOLDERS: de edge `fetchBeschikbareRollen` filtert placeholder-
--     rollen uit (`lengte_cm <= 0 OR breedte_cm <= 0`). De tekort-analyse
--     telde die rollen wel mee — met als effect de misleidende melding
--     "Rol te klein max 0×0 cm" terwijl feitelijk simpelweg voorraad
--     ontbreekt.
--
-- Deze migratie herschrijft `snijplanning_tekort_analyse()` zodat:
--   • `uitwisselbare_codes` eerst Map1-paren bevat, daarna collectie-
--     fallback, en anders self-only (ARRAY[kwaliteit_code]).
--   • `heeft_collectie` true is zodra Map1 óf collectie uitwissel-opties
--     biedt (de kolomnaam is legacy; semantiek = "heeft uitwissel-partners").
--   • De `rollen_per_groep` CTE placeholders uitsluit
--     (`r.lengte_cm > 0 AND r.breedte_cm > 0`).
--   • Map1-paren kleur-specifiek blijven (match op exact target_kleur met
--     .0-normalisatie), collectie-fallback breed (alle codes × input-kleur).
--
-- Signatuur + return-rijen ongewijzigd — caller in
-- `frontend/src/lib/supabase/queries/snijplanning.ts` en
-- `groep-accordion.tsx` blijven werken.
--
-- Idempotent: DROP FUNCTION + CREATE OR REPLACE.

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
  -- Kleur-varianten voor tolerantie bij ".0" suffix (zie ook edge function).
  groepen_kv AS (
    SELECT g.kwaliteit_code,
           g.kleur_code,
           ARRAY[
             g.kleur_code,
             g.kleur_code || '.0',
             regexp_replace(g.kleur_code, '\.0$', '')
           ] AS kleur_varianten
    FROM groepen g
  ),
  -- (1a) Fijnmazige Map1-paren: expliciete (input_kw, input_kl) → (target_kw, target_kl).
  map1_paren AS (
    SELECT g.kwaliteit_code,
           g.kleur_code,
           u.uitwissel_kwaliteit_code AS target_kw,
           u.uitwissel_kleur_code     AS target_kl
    FROM groepen_kv g
    JOIN kwaliteit_kleur_uitwisselbaar u
      ON u.input_kwaliteit_code = g.kwaliteit_code
     AND u.input_kleur_code = ANY(g.kleur_varianten)
  ),
  -- (1b) Groepen zonder Map1-entry: collectie-fallback (alle kwaliteiten
  --      in dezelfde collectie) × input-kleur-varianten.
  coll_paren AS (
    SELECT g.kwaliteit_code,
           g.kleur_code,
           k2.code AS target_kw,
           kv       AS target_kl
    FROM groepen_kv g
    JOIN kwaliteiten k1 ON k1.code = g.kwaliteit_code AND k1.collectie_id IS NOT NULL
    JOIN kwaliteiten k2 ON k2.collectie_id = k1.collectie_id
    CROSS JOIN UNNEST(g.kleur_varianten) AS kv
    WHERE NOT EXISTS (
      SELECT 1 FROM map1_paren m
       WHERE m.kwaliteit_code = g.kwaliteit_code
         AND m.kleur_code     = g.kleur_code
    )
  ),
  -- (1c) Self-only voor groepen zonder Map1 en zonder collectie: alleen
  --      hun eigen kwaliteit × input-kleur-varianten (zodat eigen voorraad
  --      nog geteld wordt).
  self_paren AS (
    SELECT g.kwaliteit_code,
           g.kleur_code,
           g.kwaliteit_code AS target_kw,
           kv               AS target_kl
    FROM groepen_kv g
    CROSS JOIN UNNEST(g.kleur_varianten) AS kv
    WHERE NOT EXISTS (
      SELECT 1 FROM map1_paren m
       WHERE m.kwaliteit_code = g.kwaliteit_code AND m.kleur_code = g.kleur_code
    )
      AND NOT EXISTS (
        SELECT 1 FROM kwaliteiten k
         WHERE k.code = g.kwaliteit_code AND k.collectie_id IS NOT NULL
      )
  ),
  paren AS (
    SELECT * FROM map1_paren
    UNION
    SELECT * FROM coll_paren
    UNION
    SELECT * FROM self_paren
  ),
  zusters AS (
    SELECT g.kwaliteit_code,
           g.kleur_code,
           (EXISTS (
              SELECT 1 FROM map1_paren m
               WHERE m.kwaliteit_code = g.kwaliteit_code AND m.kleur_code = g.kleur_code
            ) OR EXISTS (
              SELECT 1 FROM kwaliteiten k
               WHERE k.code = g.kwaliteit_code AND k.collectie_id IS NOT NULL
            )) AS heeft_collectie,
           COALESCE(
             (SELECT ARRAY_AGG(DISTINCT p.target_kw ORDER BY p.target_kw)
                FROM paren p
               WHERE p.kwaliteit_code = g.kwaliteit_code
                 AND p.kleur_code     = g.kleur_code),
             ARRAY[g.kwaliteit_code]
           ) AS codes
    FROM groepen g
  ),
  rollen_per_groep AS (
    SELECT p.kwaliteit_code,
           p.kleur_code,
           r.id                                AS rol_id,
           GREATEST(r.lengte_cm, r.breedte_cm) AS rol_lange,
           LEAST(r.lengte_cm, r.breedte_cm)    AS rol_korte,
           COALESCE(r.oppervlak_m2, 0)         AS m2
    FROM paren p
    JOIN rollen r
      ON r.status IN ('beschikbaar', 'reststuk')
     AND r.kwaliteit_code = p.target_kw
     AND r.kleur_code     = p.target_kl
     AND r.lengte_cm  > 0
     AND r.breedte_cm > 0
  ),
  agg AS (
    SELECT kwaliteit_code, kleur_code,
           COUNT(DISTINCT rol_id)::INTEGER   AS aantal,
           COALESCE(SUM(m2), 0)::NUMERIC     AS totaal_m2
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
  LEFT JOIN agg                ON agg.kwaliteit_code = z.kwaliteit_code AND agg.kleur_code = z.kleur_code
  LEFT JOIN best_rol           br ON br.kwaliteit_code = z.kwaliteit_code AND br.kleur_code = z.kleur_code
  LEFT JOIN grootste_onpassend go ON go.kwaliteit_code = z.kwaliteit_code AND go.kleur_code = z.kleur_code;
$$;

COMMENT ON FUNCTION snijplanning_tekort_analyse() IS
  'Tekort-analyse per snijden-groep, synchroon met auto-plan-groep edge: '
  'Map1 (kwaliteit_kleur_uitwisselbaar) primair, collectie-fallback, placeholders '
  '(0×0 rollen) uitgesloten. Per-stuk rol-past check past stuk_snij_marge_cm() toe. '
  'heeft_collectie=TRUE zodra Map1 óf collectie uitwissel-opties biedt. '
  'Zie migratie 134 voor Map1+placeholder-sync met edge.';
