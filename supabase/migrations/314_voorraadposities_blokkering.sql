-- Migratie 314: voorraadposities — trek actieve migratie_blokkering m² af
--
-- ADR-0028: nog-niet-gesneden oud-systeem maatwerk-orders blokkeren FIFO-lengte
-- op fysieke rollen (tabel migratie_blokkering, mig 313). Die geblokkeerde m²
-- mag niet als vrije voorraad getoond worden. Body identiek aan mig 296; enige
-- wijziging: het teruggegeven eigen_totaal_m2 wordt verlaagd met het actieve
-- blokkering-m² per (kwaliteit, genormaliseerde kleur), ondergrens 0.
--
-- Bewust NIET aangepast: vrij_voor_nieuw_maatwerk_m2 / familie_aggr (ADR-0026,
-- ander concept) en de beste_partner-CASE — die blijven op de fysieke m².

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
  eerstvolgende_m2              NUMERIC,
  bruto_maatwerkvraag_m2        NUMERIC,
  vrij_voor_nieuw_maatwerk_m2   NUMERIC
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
  -- Actieve migratie-blokkering per (kwaliteit, genormaliseerde kleur), in m².
  -- Strip = volle rolbreedte × gereserveerde_lengte_cm; m² = breedte_cm/100 × lengte_cm/100.
  geblokkeerd AS (
    SELECT
      mb.kwaliteit_code                                  AS kwaliteit_code,
      regexp_replace(mb.kleur_code, '\.0+$', '')         AS norm_kleur,
      SUM(r.breedte_cm::NUMERIC / 100 * mb.gereserveerde_lengte_cm::NUMERIC / 100) AS m2
    FROM migratie_blokkering mb
    JOIN rollen r ON r.id = mb.rol_id
    WHERE mb.status = 'actief'
    GROUP BY mb.kwaliteit_code, regexp_replace(mb.kleur_code, '\.0+$', '')
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
  -- ADR-0026: bruto-maatwerkvraag per (bestelde kw, genormaliseerde kleur).
  -- Snijplannen in open statussen × maatwerk-regel × kwaliteit voor
  -- standaard_breedte_cm van de BESTELDE kwaliteit (niet die van de rol).
  -- Formule: min(l,b)/100 × COALESCE(standaard_breedte_cm, 400)/100.
  snijplan_vraag_per_paar AS (
    SELECT
      oreg.maatwerk_kwaliteit_code                       AS kwaliteit_code,
      regexp_replace(oreg.maatwerk_kleur_code, '\.0+$', '') AS kleur_code,
      SUM(
        (LEAST(sp.lengte_cm, sp.breedte_cm)::NUMERIC / 100.0)
        * (COALESCE(k.standaard_breedte_cm, 400)::NUMERIC / 100.0)
      )::NUMERIC                                         AS bruto_m2
    FROM snijplannen sp
    JOIN order_regels oreg ON oreg.id = sp.order_regel_id
    LEFT JOIN kwaliteiten k ON k.code = oreg.maatwerk_kwaliteit_code
    WHERE sp.status IN ('Wacht'::snijplan_status,
                        'Gepland'::snijplan_status,
                        'Snijden'::snijplan_status)
      AND oreg.is_maatwerk = TRUE
      AND oreg.maatwerk_kwaliteit_code IS NOT NULL
      AND oreg.maatwerk_kleur_code     IS NOT NULL
      AND sp.lengte_cm  IS NOT NULL
      AND sp.breedte_cm IS NOT NULL
    GROUP BY oreg.maatwerk_kwaliteit_code,
             regexp_replace(oreg.maatwerk_kleur_code, '\.0+$', '')
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
  ),
  -- ADR-0026: familie-rollup. Voor elke (kw, kl) in joined: SUM over alle
  -- (target_kw, target_kl) in uitwisselbare_paren(kw, kl) van:
  --   - voorraad (eigen.totaal_m2)
  --   - bruto-maatwerkvraag (snijplan_vraag_per_paar.bruto_m2)
  -- Claims (`producten.gereserveerd`) bewust niet gesubtraheerd in V1 — zie
  -- header-comment over unit-mismatch (stuks vs m²). V2-backlog: ADR-0026.
  -- Eén LATERAL per (kw, kl) — niet per snijplan-rij (te duur).
  familie_aggr AS (
    SELECT
      j.kw                                               AS kwaliteit_code,
      j.kl                                               AS kleur_code,
      COALESCE(SUM(e2.totaal_m2),  0)::NUMERIC           AS familie_voorraad_m2,
      COALESCE(SUM(svpp.bruto_m2), 0)::NUMERIC           AS familie_bruto_m2
    FROM (SELECT DISTINCT kw, kl FROM joined WHERE kw IS NOT NULL AND kl IS NOT NULL) j
    CROSS JOIN LATERAL uitwisselbare_paren(j.kw, j.kl) up
    LEFT JOIN eigen e2
      ON e2.kwaliteit_code = up.target_kwaliteit_code
     AND e2.kleur_code     = up.target_kleur_code
    LEFT JOIN snijplan_vraag_per_paar svpp
      ON svpp.kwaliteit_code = up.target_kwaliteit_code
     AND svpp.kleur_code     = up.target_kleur_code
    GROUP BY j.kw, j.kl
  )
  SELECT
    j.kw                        AS kwaliteit_code,
    j.kl                        AS kleur_code,
    pn.naam                     AS product_naam,
    j.volle_rollen              AS eigen_volle_rollen,
    j.aangebroken_rollen        AS eigen_aangebroken_rollen,
    j.reststuk_rollen           AS eigen_reststuk_rollen,
    GREATEST(0, j.eigen_m2 - COALESCE(gb.m2, 0))::NUMERIC AS eigen_totaal_m2,
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
    j.b_eerstvolg_m2            AS eerstvolgende_m2,
    COALESCE(fa.familie_bruto_m2, 0)::NUMERIC                                              AS bruto_maatwerkvraag_m2,
    (COALESCE(fa.familie_voorraad_m2, 0)
       - COALESCE(fa.familie_bruto_m2,  0))::NUMERIC                                       AS vrij_voor_nieuw_maatwerk_m2
  FROM joined j
  CROSS JOIN input_flag i
  LEFT JOIN product_naam_per_paar pn
    ON pn.kwaliteit_code = j.kw
   AND pn.kleur_code     = j.kl
  LEFT JOIN familie_aggr fa
    ON fa.kwaliteit_code = j.kw
   AND fa.kleur_code     = j.kl
  LEFT JOIN geblokkeerd gb
    ON gb.kwaliteit_code = j.kw
   AND gb.norm_kleur     = j.kl
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
  'Voorraadpositie per (kwaliteit_code, kleur_code). Body identiek aan mig 286; '
  'mig 296 voegt twee familie-geaggregeerde velden toe (ADR-0026): '
  'bruto_maatwerkvraag_m2 = SUM over open snijplannen (status Wacht/Gepland/Snijden) '
  'van min(l,b) × standaard_breedte van de BESTELDE kwaliteit; '
  'vrij_voor_nieuw_maatwerk_m2 = familie_voorraad − bruto-vraag. '
  'Aggregatie op uitwisselbare familie via uitwisselbare_paren(kw,kl). '
  'V1 trekt Claims NIET af (stuks-vs-m²-mismatch — V2-backlog). '
  'Geen snij-marge, geen tijdshorizon (ADR-0026). '
  'Mig 314 trekt actieve migratie_blokkering-m² af van eigen_totaal_m2 (ADR-0028), ondergrens 0.';

GRANT EXECUTE ON FUNCTION voorraadposities(TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Migratie 314 toegepast: voorraadposities trekt actieve migratie_blokkering m² af van eigen_totaal_m2 (ADR-0028).';
END $$;
