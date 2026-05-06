-- Migration 180: voorraadposities() — batch+filter-modus + extra kolommen
--
-- T003 (#28) breidt de RPC uit T001 (mig 179) uit:
--   * Behoudt single-paar-modus (p_kwaliteit + p_kleur beide gevuld) exact zoals
--     voorheen — bestaande T001-fixtures + product-detail-caller blijven groen.
--   * Voegt batch+filter-modus toe: als p_kwaliteit IS NULL OR p_kwaliteit = ''
--     EN p_kleur IS NULL OR p_kleur = '', dan retourneert de RPC álle paren.
--     Optioneel filter via p_kwaliteit (gedeeltelijke match), p_kleur (exact na
--     normalisatie), of p_search (ILIKE op `kw-kl` of producten.omschrijving).
--
-- Bestaans-regel afgedwongen op SQL-niveau (asymmetrie batch vs single):
--   * Batch retourneert alléén paren met eigen voorraad (≥1 rol of m²>0).
--   * Single retourneert óók ghost-paren (paren zonder eigen voorraad maar met
--     partners of besteld) — nodig voor product-detail / maatwerk-hint.
--
-- Extra output-kolommen (t.o.v. mig 179):
--   * rollen JSONB         — array van {id, rolnummer, lengte_cm, breedte_cm,
--                            oppervlak_m2, status, rol_type, locatie,
--                            oorsprong_rol_id, reststuk_datum, artikelnr,
--                            kwaliteit_code, kleur_code} per paar — gesorteerd
--                            rol_type ASC, rolnummer ASC. Lege array `'[]'::jsonb`
--                            als geen rollen. Nodig voor expand-rows in
--                            rollen-overzicht.
--   * product_naam TEXT    — gepakt uit een product met (kwaliteit_code, kleur_code)
--                            (eerste hit, of NULL als geen match). Nodig voor de
--                            label-kolom van de rollen-overzicht-rij.
--   * eerstvolgende_m, eerstvolgende_m2 — uit besteld_per_kwaliteit_kleur() —
--                            tonen wat in de eerstvolgende leverweek valt.
--
-- Implementatie: een outer SELECT met CASE die filter-modus afdwingt; CTE-blok
-- ongewijzigd herkenbaar t.o.v. mig 179, behalve dat `eigen`/`partners_raw`/
-- `besteld` nu alle paren scannen (geen single-paar-filter meer in de CTE) en
-- de filtering in de outer SELECT gebeurt via input-vergelijking + bestaans-regel.
--
-- Invarianten ongewijzigd t.o.v. mig 179:
--   1. eigen.totaal_m2 > 0 ⇒ beste_partner IS NULL (CASE).
--   2. Symmetrie via uitwisselbare_partners() zelfjoin (mig 114/115).
--   3. besteld_m2 = 0 (niet NULL) bij ontbrekende standaard_breedte_cm (COALESCE).
--   4. Kleur-normalisatie via regexp_replace(kleur_code, '\.0+$', '').
--   9. partners is altijd een (mogelijk lege) JSONB-array, nooit NULL.

DROP FUNCTION IF EXISTS voorraadposities(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION voorraadposities(
  p_kwaliteit TEXT DEFAULT NULL,
  p_kleur     TEXT DEFAULT NULL,
  p_search    TEXT DEFAULT NULL
)
RETURNS TABLE (
  kwaliteit_code                TEXT,
  kleur_code                    TEXT,
  product_naam                  TEXT,
  eigen_volle_rollen            INTEGER,
  eigen_aangebroken_rollen      INTEGER,
  eigen_reststuk_rollen         INTEGER,
  eigen_totaal_m2               NUMERIC,
  rollen                        JSONB,
  partners                      JSONB,
  beste_partner                 JSONB,
  besteld_m                     NUMERIC,
  besteld_m2                    NUMERIC,
  besteld_orders_count          INTEGER,
  eerstvolgende_leverweek       TEXT,
  eerstvolgende_verwacht_datum  DATE,
  eerstvolgende_m               NUMERIC,
  eerstvolgende_m2              NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH
  -- Genormaliseerde input. Lege strings worden NULL.
  --  - is_single = beide gevuld → single-paar-modus.
  --  - is_batch  = beide leeg → álle paren met eigen voorraad.
  --  - filter_kwaliteit / filter_kleur / filter_search worden in de outer
  --    SELECT toegepast in de batch+filter-modus.
  input AS (
    SELECT
      NULLIF(p_kwaliteit, '')                                         AS norm_kwaliteit,
      regexp_replace(COALESCE(NULLIF(p_kleur, ''), ''), '\.0+$', '')  AS norm_kleur_raw,
      NULLIF(p_search, '')                                            AS norm_search
  ),
  input_flag AS (
    SELECT
      norm_kwaliteit,
      NULLIF(norm_kleur_raw, '')                                     AS norm_kleur,
      norm_search,
      (norm_kwaliteit IS NOT NULL AND NULLIF(norm_kleur_raw,'') IS NOT NULL) AS is_single
    FROM input
  ),
  -- Eigen voorraad per (kw, kl) uit `rollen`.
  -- Filter: status NOT IN ('verkocht', 'gesneden') AND oppervlak_m2 > 0
  -- (consistent met rollen_uitwissel_voorraad / uitwisselbare_partners — mig 115).
  -- Geen single-paar-filter meer in de CTE — outer SELECT filtert per modus.
  eigen AS (
    SELECT
      r.kwaliteit_code                                       AS kwaliteit_code,
      regexp_replace(r.kleur_code, '\.0+$', '')              AS kleur_code,
      COUNT(*) FILTER (WHERE r.rol_type = 'volle_rol')::INT  AS volle_rollen,
      COUNT(*) FILTER (WHERE r.rol_type = 'aangebroken')::INT AS aangebroken_rollen,
      COUNT(*) FILTER (WHERE r.rol_type = 'reststuk')::INT   AS reststuk_rollen,
      COALESCE(SUM(r.oppervlak_m2), 0)::NUMERIC              AS totaal_m2,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id',                r.id,
            'rolnummer',         r.rolnummer,
            'artikelnr',         r.artikelnr,
            'kwaliteit_code',    r.kwaliteit_code,
            'kleur_code',        regexp_replace(r.kleur_code, '\.0+$', ''),
            'lengte_cm',         r.lengte_cm,
            'breedte_cm',        r.breedte_cm,
            'oppervlak_m2',      r.oppervlak_m2,
            'status',            r.status,
            'rol_type',          r.rol_type,
            'locatie',           ml.code,
            'oorsprong_rol_id',  r.oorsprong_rol_id,
            'reststuk_datum',    r.reststuk_datum
          )
          ORDER BY r.rol_type ASC, r.rolnummer ASC
        ),
        '[]'::jsonb
      )                                                       AS rollen_json
    FROM rollen r
    LEFT JOIN magazijn_locaties ml ON ml.id = r.locatie_id
    WHERE r.status NOT IN ('verkocht', 'gesneden')
      AND r.oppervlak_m2 > 0
      AND r.kwaliteit_code IS NOT NULL
      AND r.kleur_code     IS NOT NULL
    GROUP BY r.kwaliteit_code, regexp_replace(r.kleur_code, '\.0+$', '')
  ),
  -- Partners: alle (kw, kl) → uitwisselbare paren. uitwisselbare_partners()
  -- (mig 115) zelfjoint kwaliteit_kleur_uitwisselgroepen — symmetrie is daar
  -- al gegarandeerd.
  partners_raw AS (
    SELECT
      up.kwaliteit_code                                          AS kwaliteit_code,
      regexp_replace(up.kleur_code, '\.0+$', '')                 AS kleur_code,
      up.partner_kwaliteit_code                                  AS p_kw,
      regexp_replace(up.partner_kleur_code, '\.0+$', '')         AS p_kl,
      COALESCE(up.partner_rollen, 0)::INTEGER                    AS p_rollen,
      COALESCE(up.partner_m2, 0)::NUMERIC                        AS p_m2
    FROM uitwisselbare_partners() up
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
  besteld AS (
    SELECT
      bk.kwaliteit_code                                 AS kwaliteit_code,
      regexp_replace(bk.kleur_code, '\.0+$', '')        AS kleur_code,
      COALESCE(bk.besteld_m, 0)::NUMERIC                AS b_m,
      COALESCE(bk.besteld_m2, 0)::NUMERIC               AS b_m2,
      COALESCE(bk.orders_count, 0)::INTEGER             AS b_count,
      bk.eerstvolgende_leverweek                        AS b_week,
      bk.eerstvolgende_verwacht_datum                   AS b_datum,
      COALESCE(bk.eerstvolgende_m,  0)::NUMERIC         AS b_eerstvolg_m,
      COALESCE(bk.eerstvolgende_m2, 0)::NUMERIC         AS b_eerstvolg_m2
    FROM besteld_per_kwaliteit_kleur() bk
  ),
  -- product_naam: pak één producten.omschrijving per (kw, kl) — eerste hit op artikelnr.
  -- LEFT JOIN, NULL als geen match.
  product_naam_per_paar AS (
    SELECT DISTINCT ON (p.kwaliteit_code, regexp_replace(p.kleur_code, '\.0+$', ''))
      p.kwaliteit_code                                  AS kwaliteit_code,
      regexp_replace(p.kleur_code, '\.0+$', '')         AS kleur_code,
      p.omschrijving                                    AS naam
    FROM producten p
    WHERE p.kwaliteit_code IS NOT NULL
      AND p.kleur_code     IS NOT NULL
    ORDER BY p.kwaliteit_code, regexp_replace(p.kleur_code, '\.0+$', ''), p.artikelnr
  ),
  -- FULL OUTER JOIN op de drie bronnen — single-paar retourneert ook
  -- ghost-paren (geen eigen voorraad maar wel partners of besteld).
  joined AS (
    SELECT
      COALESCE(e.kwaliteit_code, p.kwaliteit_code, b.kwaliteit_code) AS kw,
      COALESCE(e.kleur_code,     p.kleur_code,     b.kleur_code)     AS kl,
      COALESCE(e.volle_rollen, 0)            AS volle_rollen,
      COALESCE(e.aangebroken_rollen, 0)      AS aangebroken_rollen,
      COALESCE(e.reststuk_rollen, 0)         AS reststuk_rollen,
      COALESCE(e.totaal_m2, 0)::NUMERIC      AS eigen_m2,
      COALESCE(e.rollen_json, '[]'::jsonb)   AS rollen_json,
      COALESCE(p.partners_json, '[]'::jsonb) AS partners_json,
      COALESCE(b.b_m, 0)::NUMERIC            AS b_m,
      COALESCE(b.b_m2, 0)::NUMERIC           AS b_m2,
      COALESCE(b.b_count, 0)::INTEGER        AS b_count,
      b.b_week                                AS b_week,
      b.b_datum                               AS b_datum,
      COALESCE(b.b_eerstvolg_m,  0)::NUMERIC AS b_eerstvolg_m,
      COALESCE(b.b_eerstvolg_m2, 0)::NUMERIC AS b_eerstvolg_m2
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
    pn.naam                     AS product_naam,
    j.volle_rollen              AS eigen_volle_rollen,
    j.aangebroken_rollen        AS eigen_aangebroken_rollen,
    j.reststuk_rollen           AS eigen_reststuk_rollen,
    j.eigen_m2                  AS eigen_totaal_m2,
    j.rollen_json               AS rollen,
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
    j.b_datum                   AS eerstvolgende_verwacht_datum,
    j.b_eerstvolg_m             AS eerstvolgende_m,
    j.b_eerstvolg_m2            AS eerstvolgende_m2
  FROM joined j
  CROSS JOIN input_flag i
  LEFT JOIN product_naam_per_paar pn
    ON pn.kwaliteit_code = j.kw
   AND pn.kleur_code     = j.kl
  WHERE j.kw IS NOT NULL
    AND j.kl IS NOT NULL
    -- Modus-afhankelijke filtering:
    --  * Single-modus (beide gevuld): exacte (kw, kl)-match, ook ghost-paren.
    --  * Batch-modus (beide leeg óf één gevuld als filter): alleen paren met
    --    eigen voorraad EN match op optionele filters.
    AND (
      -- Single-paar-modus: exacte match op input.
      (i.is_single
        AND j.kw = i.norm_kwaliteit
        AND j.kl = i.norm_kleur)
      OR
      -- Batch+filter-modus: alleen eigen voorraad + filters.
      (NOT i.is_single
        AND (j.eigen_m2 > 0
          OR j.volle_rollen > 0
          OR j.aangebroken_rollen > 0
          OR j.reststuk_rollen > 0)
        AND (i.norm_kwaliteit IS NULL OR j.kw ILIKE '%' || i.norm_kwaliteit || '%')
        AND (i.norm_kleur     IS NULL OR j.kl = i.norm_kleur)
        AND (i.norm_search    IS NULL
             OR (j.kw || '-' || j.kl) ILIKE '%' || i.norm_search || '%'
             OR COALESCE(pn.naam, '') ILIKE '%' || i.norm_search || '%')
      )
    );
$$;

COMMENT ON FUNCTION voorraadposities(TEXT, TEXT, TEXT) IS
  'Voorraadpositie per (kwaliteit_code, kleur_code) — één seam voor '
  '"wat heb ik vandaag uit eigen rol, wat kan via uitwisselbare partner, '
  'wat komt binnenkort uit inkoop". Drie modi: '
  '(a) Single-paar (p_kwaliteit + p_kleur beide gevuld) → exacte match, '
  'retourneert óók ghost-paren zonder eigen voorraad. '
  '(b) Batch (beide leeg) → álle paren met eigen voorraad. '
  '(c) Batch+filter (één van beide of p_search) → alleen eigen-voorraad-paren '
  'die matchen op kwaliteit (ILIKE), kleur (exact na normalisatie) en/of '
  'search (ILIKE op kw-kl of producten.omschrijving). '
  'Invarianten: eigen>0 ⇒ beste_partner=NULL; symmetrie via uitwisselbare_partners(); '
  'besteld_m2=0 bij ontbrekende breedte; kleur-normalisatie strip trailing .0+; '
  'partners is altijd een (mogelijk lege) JSONB-array. '
  'Hergebruikt: uitwisselbare_partners() (mig 115), '
  'besteld_per_kwaliteit_kleur() (mig 137), producten (voor omschrijving). '
  'Output bevat extra kolommen rollen JSONB[] (per-rol details voor expand-rows), '
  'product_naam TEXT, eerstvolgende_m + eerstvolgende_m2 (mig 137-doorgifte). '
  'Migratie 180 (T003 / #28).';

GRANT EXECUTE ON FUNCTION voorraadposities(TEXT, TEXT, TEXT) TO anon, authenticated;
