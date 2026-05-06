-- Migration 179: RPC voorraadposities() — single-paar-modus (T001 tracer-bullet)
--
-- Doel: één seam die per (kwaliteit_code, kleur_code) antwoord geeft op
-- "wat heb ik vandaag uit eigen rol, wat kan via een uitwisselbare partner,
-- en wat komt binnenkort uit inkoop". Vervangt op termijn de losse callers
-- van rollen_uitwissel_voorraad / uitwisselbare_partners /
-- besteld_per_kwaliteit_kleur (cleanup in T005).
--
-- T001 levert ALLEEN single-paar-modus correct: p_kwaliteit + p_kleur beide
-- gevuld → één rij of leeg. Bij batch-aanroep (NULL/empty kwaliteit/kleur)
-- gedraagt deze versie zich als een minimale lege set; T003 (#28) vult
-- batch + filter volledig aan.
--
-- Invarianten in SQL afgedwongen:
--   1. eigen.totaal_m2 > 0 ⇒ beste_partner IS NULL  (geen uitwissel-suggestie
--      als we zelf nog voorraad hebben).
--   2. Symmetrie volgt automatisch uit uitwisselbare_partners() — die zelf-
--      joint kwaliteit_kleur_uitwisselgroepen op basis_code + variant_nr.
--   3. besteld_m2 = 0 (niet NULL) bij ontbrekende standaard_breedte_cm.
--   4. Kleur-normalisatie: regexp_replace(kleur_code, '\.0+$', '').
--
-- Output-shape (één regel per (kw, kl)):
--   kwaliteit_code, kleur_code  — beide genormaliseerd
--   eigen_volle_rollen, eigen_aangebroken_rollen, eigen_reststuk_rollen, eigen_totaal_m2
--   partners JSONB                — array van {kwaliteit_code, kleur_code, rollen, m2}
--                                   gesorteerd m2 DESC, kw ASC, kl ASC
--   beste_partner JSONB           — partners[0] alleen wanneer eigen_totaal_m2 = 0
--                                   AND partners[0].m2 > 0; anders NULL
--   besteld_m, besteld_m2, besteld_orders_count
--   eerstvolgende_leverweek TEXT, eerstvolgende_verwacht_datum DATE
--
-- Bron-RPC's hergebruikt:
--   - uitwisselbare_partners() — mig 114/115
--   - besteld_per_kwaliteit_kleur() — mig 137
-- Plus directe scan op `rollen` voor eigen-aggregaat (consistent met mig 115:
-- status NOT IN ('verkocht', 'gesneden') AND oppervlak_m2 > 0).

CREATE OR REPLACE FUNCTION voorraadposities(
  p_kwaliteit TEXT DEFAULT NULL,
  p_kleur     TEXT DEFAULT NULL,
  p_search    TEXT DEFAULT NULL
)
RETURNS TABLE (
  kwaliteit_code                TEXT,
  kleur_code                    TEXT,
  eigen_volle_rollen            INTEGER,
  eigen_aangebroken_rollen      INTEGER,
  eigen_reststuk_rollen         INTEGER,
  eigen_totaal_m2               NUMERIC,
  partners                      JSONB,
  beste_partner                 JSONB,
  besteld_m                     NUMERIC,
  besteld_m2                    NUMERIC,
  besteld_orders_count          INTEGER,
  eerstvolgende_leverweek       TEXT,
  eerstvolgende_verwacht_datum  DATE
)
LANGUAGE sql
STABLE
AS $$
  WITH
  -- Genormaliseerde input. Lege strings worden NULL — T001 retourneert
  -- in dat geval een lege set (caller-niveau guard tegen ''-call zit in
  -- fetchVoorraadpositie, dit is een tweede lijn).
  input AS (
    SELECT
      NULLIF(p_kwaliteit, '')                                         AS norm_kwaliteit,
      regexp_replace(COALESCE(NULLIF(p_kleur, ''), ''), '\.0+$', '')  AS norm_kleur
  ),
  -- Eigen voorraad per (kw, kl) uit `rollen`.
  -- Filter: status NOT IN ('verkocht', 'gesneden') AND oppervlak_m2 > 0
  -- (consistent met rollen_uitwissel_voorraad / uitwisselbare_partners — mig 115).
  -- Kleur ook genormaliseerd zodat '15.0' bij '15' aansluit.
  eigen AS (
    SELECT
      r.kwaliteit_code                                       AS kwaliteit_code,
      regexp_replace(r.kleur_code, '\.0+$', '')              AS kleur_code,
      COUNT(*) FILTER (WHERE r.rol_type = 'volle_rol')::INT  AS volle_rollen,
      COUNT(*) FILTER (WHERE r.rol_type = 'aangebroken')::INT AS aangebroken_rollen,
      COUNT(*) FILTER (WHERE r.rol_type = 'reststuk')::INT   AS reststuk_rollen,
      COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC              AS totaal_m2
    FROM rollen r, input i
    WHERE r.status NOT IN ('verkocht', 'gesneden')
      AND r.oppervlak_m2 > 0
      AND r.kwaliteit_code IS NOT NULL
      AND r.kleur_code     IS NOT NULL
      -- Single-paar-filter: beide gevuld in T001 — anders lege set.
      AND i.norm_kwaliteit IS NOT NULL
      AND i.norm_kleur     IS NOT NULL
      AND r.kwaliteit_code = i.norm_kwaliteit
      AND regexp_replace(r.kleur_code, '\.0+$', '') = i.norm_kleur
    GROUP BY r.kwaliteit_code, regexp_replace(r.kleur_code, '\.0+$', '')
  ),
  -- Partners: alle uitwisselbare (kw, kl)-paren. uitwisselbare_partners()
  -- (mig 115) zelfjoint kwaliteit_kleur_uitwisselgroepen — symmetrie is
  -- daar al gegarandeerd.
  partners_raw AS (
    SELECT
      up.kwaliteit_code                                          AS kwaliteit_code,
      regexp_replace(up.kleur_code, '\.0+$', '')                 AS kleur_code,
      up.partner_kwaliteit_code                                  AS p_kw,
      regexp_replace(up.partner_kleur_code, '\.0+$', '')         AS p_kl,
      COALESCE(up.partner_rollen, 0)::INTEGER                    AS p_rollen,
      COALESCE(up.partner_m2, 0)::NUMERIC                        AS p_m2
    FROM uitwisselbare_partners() up, input i
    WHERE i.norm_kwaliteit IS NOT NULL
      AND i.norm_kleur     IS NOT NULL
      AND up.kwaliteit_code = i.norm_kwaliteit
      AND regexp_replace(up.kleur_code, '\.0+$', '') = i.norm_kleur
  ),
  partners_agg AS (
    SELECT
      pr.kwaliteit_code,
      pr.kleur_code,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'kwaliteit_code', pr.p_kw,
            'kleur_code',     pr.p_kl,
            'rollen',         pr.p_rollen,
            'm2',             pr.p_m2
          )
          ORDER BY pr.p_m2 DESC, pr.p_kw ASC, pr.p_kl ASC
        ) FILTER (WHERE pr.p_kw IS NOT NULL),
        '[]'::jsonb
      ) AS partners_json
    FROM partners_raw pr
    GROUP BY pr.kwaliteit_code, pr.kleur_code
  ),
  -- Besteld per (kw, kl) uit besteld_per_kwaliteit_kleur() (mig 137).
  -- besteld_m2 = 0 bij ontbrekende standaard_breedte_cm zit al in die RPC
  -- via COALESCE — invariant 3 hoeft hier alleen te worden vastgehouden.
  besteld AS (
    SELECT
      bk.kwaliteit_code                                 AS kwaliteit_code,
      regexp_replace(bk.kleur_code, '\.0+$', '')        AS kleur_code,
      COALESCE(bk.besteld_m, 0)::NUMERIC                AS b_m,
      COALESCE(bk.besteld_m2, 0)::NUMERIC               AS b_m2,
      COALESCE(bk.orders_count, 0)::INTEGER             AS b_count,
      bk.eerstvolgende_leverweek                        AS b_week,
      bk.eerstvolgende_verwacht_datum                   AS b_datum
    FROM besteld_per_kwaliteit_kleur() bk, input i
    WHERE i.norm_kwaliteit IS NOT NULL
      AND i.norm_kleur     IS NOT NULL
      AND bk.kwaliteit_code = i.norm_kwaliteit
      AND regexp_replace(bk.kleur_code, '\.0+$', '') = i.norm_kleur
  ),
  -- FULL OUTER JOIN op de drie bronnen — single-paar retourneert ook
  -- ghost-paren (geen eigen voorraad maar wel partners of besteld).
  -- COALESCE op (kw, kl) zodat de output-key gevuld is uit welke bron
  -- dan ook als eerste matcht.
  joined AS (
    SELECT
      COALESCE(e.kwaliteit_code, p.kwaliteit_code, b.kwaliteit_code) AS kw,
      COALESCE(e.kleur_code,     p.kleur_code,     b.kleur_code)     AS kl,
      COALESCE(e.volle_rollen, 0)        AS volle_rollen,
      COALESCE(e.aangebroken_rollen, 0)  AS aangebroken_rollen,
      COALESCE(e.reststuk_rollen, 0)     AS reststuk_rollen,
      COALESCE(e.totaal_m2, 0)::NUMERIC  AS eigen_m2,
      COALESCE(p.partners_json, '[]'::jsonb) AS partners_json,
      COALESCE(b.b_m, 0)::NUMERIC        AS b_m,
      COALESCE(b.b_m2, 0)::NUMERIC       AS b_m2,
      COALESCE(b.b_count, 0)::INTEGER    AS b_count,
      b.b_week                            AS b_week,
      b.b_datum                           AS b_datum
    FROM eigen e
    FULL OUTER JOIN partners_agg p
      ON p.kwaliteit_code = e.kwaliteit_code
     AND p.kleur_code     = e.kleur_code
    FULL OUTER JOIN besteld b
      ON b.kwaliteit_code = COALESCE(e.kwaliteit_code, p.kwaliteit_code)
     AND b.kleur_code     = COALESCE(e.kleur_code,     p.kleur_code)
  )
  SELECT
    j.kw                        AS kwaliteit_code,
    j.kl                        AS kleur_code,
    j.volle_rollen              AS eigen_volle_rollen,
    j.aangebroken_rollen        AS eigen_aangebroken_rollen,
    j.reststuk_rollen           AS eigen_reststuk_rollen,
    j.eigen_m2                  AS eigen_totaal_m2,
    j.partners_json             AS partners,
    -- Invariant 1: alleen suggereren wanneer we zelf niets hebben.
    CASE
      WHEN j.eigen_m2 = 0
       AND jsonb_array_length(j.partners_json) > 0
       AND COALESCE((j.partners_json -> 0 ->> 'm2')::NUMERIC, 0) > 0
      THEN j.partners_json -> 0
      ELSE NULL
    END                         AS beste_partner,
    j.b_m                       AS besteld_m,
    j.b_m2                      AS besteld_m2,
    j.b_count                   AS besteld_orders_count,
    j.b_week                    AS eerstvolgende_leverweek,
    j.b_datum                   AS eerstvolgende_verwacht_datum
  FROM joined j
  WHERE j.kw IS NOT NULL
    AND j.kl IS NOT NULL;
$$;

COMMENT ON FUNCTION voorraadposities(TEXT, TEXT, TEXT) IS
  'Voorraadpositie per (kwaliteit_code, kleur_code) — één seam voor '
  '"wat heb ik vandaag uit eigen rol, wat kan via uitwisselbare partner, '
  'wat komt binnenkort uit inkoop". T001: alleen single-paar-modus '
  '(p_kwaliteit + p_kleur beide gevuld). T003 vult batch+filter aan via '
  'p_search. Invarianten: eigen>0 ⇒ beste_partner=NULL; symmetrie via '
  'uitwisselbare_partners(); besteld_m2=0 bij ontbrekende breedte; '
  'kleur-normalisatie strip trailing .0+. Hergebruikt: '
  'uitwisselbare_partners() (mig 115), besteld_per_kwaliteit_kleur() (mig 137). '
  'Single-call retourneert ook ghost-paren (zonder eigen voorraad). '
  'Migratie 179.';

GRANT EXECUTE ON FUNCTION voorraadposities(TEXT, TEXT, TEXT) TO anon, authenticated;
