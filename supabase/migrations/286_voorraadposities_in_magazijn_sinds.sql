-- Migratie 286: voorraadposities — in_magazijn_sinds + FIFO-volgorde in rol-lijst
--
-- Context (ADR-0021, geparkeerd): de rollen-overzicht-pagina moet per rol
-- tonen wanneer het materiaal is binnengekomen, en de rol-lijst per (kw,kl)
-- moet oudste-eerst staan zodat in één oogopslag zichtbaar is welke rol als
-- eerste binnenkwam (= FIFO-snijvolgorde).
--
-- Body identiek aan mig 180; twee minimale wijzigingen in de `eigen`-CTE:
--   * jsonb_build_object krijgt 'in_magazijn_sinds'
--   * ORDER BY: in_magazijn_sinds ASC NULLS FIRST vóór rol_type/rolnummer

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
            'reststuk_datum',    r.reststuk_datum,
            'in_magazijn_sinds', r.in_magazijn_sinds
          )
          ORDER BY r.in_magazijn_sinds ASC NULLS FIRST, r.rol_type ASC, r.rolnummer ASC
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
    AND (
      (i.is_single
        AND j.kw = i.norm_kwaliteit
        AND j.kl = i.norm_kleur)
      OR
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
  'Voorraadpositie per (kwaliteit_code, kleur_code). Body identiek aan mig 180; '
  'mig 286 voegt in_magazijn_sinds toe aan de rollen-JSONB en sorteert de '
  'rol-lijst oudste-eerst (in_magazijn_sinds ASC NULLS FIRST, dan rol_type, '
  'dan rolnummer) zodat FIFO-binnenkomst zichtbaar is. ADR-0021.';

GRANT EXECUTE ON FUNCTION voorraadposities(TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 286 toegepast: voorraadposities toont in_magazijn_sinds + FIFO-volgorde (ADR-0021).';
END $$;
