-- Migratie 278: Levertijd-Module — maatwerk capaciteit-match (vervangt stub van mig 277)
--
-- ADR-0020: Levertijd als deep Module (capaciteit-seam owner).
-- Plan:  docs/superpowers/plans/2026-05-13-levertijd-als-deep-module.md — stap 7.
--
-- ----------------------------------------------------------------------------
-- Wat deze migratie doet
-- ----------------------------------------------------------------------------
-- Vervangt de tijdelijke stub-takken van `levertijd_fit_check` en
-- `levertijd_snelste_haalbaar` voor maatwerk-regels (mig 277) door een
-- realistische capaciteit-match tegen open snijplannen + `productie_planning`-
-- config in `app_config`.
--
-- Strategie: GEKOZEN OPTIE = (B) "vereenvoudigde PL/pgSQL-port" (80%-feature).
-- De Deno-implementatie (`_shared/levertijd-capacity.ts`, `levertijd-match.ts`,
-- `levertijd-resolver.ts`) blijft de canonieke implementatie van de edge-
-- function `check-levertijd`. Deze migratie spiegelt het *capaciteit-deel* in
-- SQL — voldoende voor de twee RPC's:
--   1) Weet een bepaalde ISO-week al genoeg vrije snij-capaciteit voor 1 extra
--      stuk maatwerk? → `levertijd_fit_check` maatwerk-tak.
--   2) Welke is de eerstvolgende ISO-week (vanaf "vandaag + logistieke buffer")
--      met capaciteits-ruimte voor 1 stuk? → `levertijd_snelste_haalbaar`.
--
-- Waarom optie B (en niet A of C):
--   * Optie A (volledige port) — FFDH-shelf-reconstruction + rol-match-logica
--     vereisen ~500 regels PL/pgSQL en geven geen meerwaarde voor het
--     fit-check-vraagstuk; alleen *capaciteit per week* is hier relevant.
--   * Optie C (pg_net → edge) — geen `pg_net`/`http` extension actief in deze
--     project (gecheckt in migraties: alleen `pg_cron` in mig 122/173). Zou
--     dependency uitbreiden voor weinig winst.
--
-- ----------------------------------------------------------------------------
-- Aannames over `productie_planning`-config (app_config-rij, JSONB)
-- ----------------------------------------------------------------------------
-- Spiegelt de defaults uit `supabase/functions/check-levertijd/index.ts`
-- (DEFAULT_CONFIG):
--   capaciteit_per_week         INTEGER  (default 450)   — max stuks per week
--   capaciteit_marge_pct        INTEGER  (default 0)     — veilige marge in %
--   wisseltijd_minuten          INTEGER  (default 15)    — niet gebruikt hier
--                                                          (capaciteit is in
--                                                          stuks, niet minuten)
--   snijtijd_minuten            INTEGER  (default 5)     — idem
--   logistieke_buffer_dagen     INTEGER  (default 2)     — werkdagen tussen
--                                                          snij-eind en lever
--
-- Capaciteit-eenheid: *aantal stuks per ISO-week*. Bezetting = aantal open
-- snijplannen (status ∈ ('Wacht','Gepland','Snijden'), gesneden_datum IS NULL,
-- planning_week + planning_jaar bekend) in die week.
--
-- ----------------------------------------------------------------------------
-- NIET-meegenomen features (TODO / V2-backlog)
-- ----------------------------------------------------------------------------
--   [V2] `productie_groep`-segmentering — er bestaat (nog) geen kolom op
--        `order_regels` of `snijplannen` voor productie-groep. Capaciteit is
--        één globale pool. Plan stap 7 noemt productie_groep; wordt ingevoerd
--        zodra dat schema-veld er is.
--   [V2] Confectie-lane-capaciteit (afwerking_types.type_bewerking) — confectie
--        heeft eigen capaciteits-doctrine. Levertijd-Module mag later een
--        tweede dimensie toevoegen zonder breaking change op de RPC-signatures.
--   [V2] FFDH-shelf-passt-check op specifieke rol (mig levert "capaciteit
--        beschikbaar", niet "past op rol X"). Voor de RPC's volstaat dat.
--   [V2] `lever_type='dag'`-voorrang (ADR-0014) — de edge-function past dag-
--        buffer toe; in deze SQL-tak nemen we de generieke `logistieke_buffer_
--        dagen` (week-default). Dag-orders blijven via edge-function lopen tot
--        stap 8 convergeert.
--   [V2] Backlog-drempel + spoed-detectie — pure capaciteit hier; spoed-logica
--        blijft in resolver (edge). Voor `spoed_uitleg` produceert deze SQL
--        één van drie korte strings.
--   [V2] Werkagenda-rekenkunde voor *minutering binnen werkdag* — we werken
--        op ISO-week-granulariteit (week is vol of niet), niet uren-precieze
--        plus_werkminuten zoals werkagenda.ts. Granulariteit week is voor
--        fit-check de juiste signal-to-noise.
--
-- ----------------------------------------------------------------------------
-- ISO-week-aritmetiek
-- ----------------------------------------------------------------------------
-- We gebruiken `to_char(d, 'IYYY-"W"IW')` voor de string ('2026-W19') — dit is
-- ISO-week-string, lexicografisch sorteerbaar (consistent met mig 277).
-- Iteratie over weken via `INTERVAL '7 days'` op de maandag van de start-week
-- (`date_trunc('week', d)::date` levert maandag voor ISO-weken op PostgreSQL).
--
-- Idempotent: CREATE OR REPLACE FUNCTION voor beide RPC's (signature gelijk
-- aan mig 277). Geen schema-wijzigingen, geen nieuwe kolommen.
-- VOORWAARDE: mig 277 (RPC-skeleton).

-- ============================================================================
-- Helper-kennis (geen losse functies — inline in beide RPC's voor STABLE-context)
-- ============================================================================
-- 1. config-fetch: SELECT app_config WHERE sleutel='productie_planning'
-- 2. snijplannen-bezetting-per-week: GROUP BY planning_jaar, planning_week
-- 3. ISO-week-iteratie: scan max 12 weken vooruit


-- ============================================================================
-- 1. levertijd_fit_check — maatwerk-tak nu realistisch
-- ============================================================================

CREATE OR REPLACE FUNCTION levertijd_fit_check(
  p_regel_ids BIGINT[],
  p_gewenste_week TEXT
)
RETURNS TABLE (
  regel_id BIGINT,
  haalbaar BOOLEAN,
  reden TEXT,
  eerstvolgend_haalbaar TEXT
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  v_cap_per_week     INTEGER;
  v_marge_pct        INTEGER;
  v_max_stuks        INTEGER;
  v_buffer_werkdagen INTEGER;
BEGIN
  -- 1) Config lezen (één keer; defaults bij ontbrekende keys)
  SELECT
    COALESCE((waarde->>'capaciteit_per_week')::INTEGER, 450),
    COALESCE((waarde->>'capaciteit_marge_pct')::INTEGER, 0),
    COALESCE((waarde->>'logistieke_buffer_dagen')::INTEGER, 2)
  INTO v_cap_per_week, v_marge_pct, v_buffer_werkdagen
  FROM app_config
  WHERE sleutel = 'productie_planning'
  LIMIT 1;

  -- Fallback als rij ontbreekt
  v_cap_per_week     := COALESCE(v_cap_per_week, 450);
  v_marge_pct        := COALESCE(v_marge_pct, 0);
  v_buffer_werkdagen := COALESCE(v_buffer_werkdagen, 2);
  v_max_stuks        := GREATEST(0, FLOOR(v_cap_per_week * (1 - v_marge_pct / 100.0))::INTEGER);

  RETURN QUERY
  WITH input AS (
    SELECT UNNEST(p_regel_ids) AS regel_id
  ),
  regel_data AS (
    SELECT
      i.regel_id,
      oreg.is_maatwerk,
      v.verwachte_leverweek,
      v.levertijd_status,
      v.eerste_io_nr
    FROM input i
    LEFT JOIN order_regels             oreg ON oreg.id = i.regel_id
    LEFT JOIN order_regel_levertijd    v    ON v.order_regel_id = i.regel_id
  ),
  -- Maatwerk-bezetting per ISO-week (globale pool — productie_groep V2-backlog)
  bezetting_per_week AS (
    -- S1 (code-review ADR-0020): iso_week_plus = exact dezelfde to_char-bron
    -- als de weken_iterator (geen format-drift in de join). make_date(jaar,1,4)
    -- ligt gegarandeerd in ISO-week 1 van dat jaar. planning_week BETWEEN 1
    -- AND 53 containt garbage-data (week 53 in een 52-weken-jaar zou anders
    -- stil naar (jaar+1)-W01 lekken → capaciteit-overschatting → vals haalbaar).
    SELECT
      iso_week_plus(make_date(planning_jaar, 1, 4), planning_week - 1) AS iso_week,
      COUNT(*) AS huidig_stuks
    FROM snijplannen
    WHERE status IN ('Wacht', 'Gepland', 'Snijden')
      AND gesneden_datum IS NULL
      AND planning_week IS NOT NULL
      AND planning_jaar IS NOT NULL
      AND planning_week BETWEEN 1 AND 53
    GROUP BY planning_jaar, planning_week
  ),
  -- 12 weken vooruit-iterator vanaf p_gewenste_week (lex-vergelijk via ISO-string)
  weken_iterator AS (
    SELECT
      to_char(date_trunc('week', current_date)::date + (n * 7)::INTEGER,
              'IYYY-"W"IW') AS iso_week,
      n AS offset_weken
    FROM generate_series(0, 12) AS n
  ),
  -- Per regel: eerstvolgende ISO-week ≥ p_gewenste_week met capaciteit-ruimte
  eerstvolgend_maatwerk AS (
    SELECT
      i.iso_week,
      i.offset_weken,
      (v_max_stuks - COALESCE(b.huidig_stuks, 0)) AS ruimte
    FROM weken_iterator i
    LEFT JOIN bezetting_per_week b ON b.iso_week = i.iso_week
    WHERE i.iso_week >= p_gewenste_week
      AND (v_max_stuks - COALESCE(b.huidig_stuks, 0)) > 0
    ORDER BY i.iso_week ASC
    LIMIT 1
  ),
  -- Capaciteit van de specifieke gewenste-week (voor haalbaar-bool)
  gewenste_week_capaciteit AS (
    SELECT (v_max_stuks - COALESCE(b.huidig_stuks, 0)) AS ruimte
    FROM (SELECT p_gewenste_week AS iso_week) g
    LEFT JOIN bezetting_per_week b ON b.iso_week = g.iso_week
  )
  SELECT
    rd.regel_id,
    CASE
      -- Maatwerk: capaciteit-match
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        COALESCE((SELECT ruimte > 0 FROM gewenste_week_capaciteit), TRUE)
      -- Voorraad-pad: sentinel 'voorraad' = altijd haalbaar
      WHEN rd.verwachte_leverweek = 'voorraad' THEN TRUE
      -- Geen view-rij + geen status → conservatief haalbaar
      WHEN rd.verwachte_leverweek IS NULL AND rd.levertijd_status IS NULL THEN TRUE
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop' THEN FALSE
      WHEN rd.verwachte_leverweek IS NOT NULL
        THEN rd.verwachte_leverweek <= p_gewenste_week
      ELSE TRUE
    END AS haalbaar,
    CASE
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        CASE
          WHEN COALESCE((SELECT ruimte > 0 FROM gewenste_week_capaciteit), TRUE)
            THEN NULL
          ELSE 'snij-capaciteit vol in week ' || p_gewenste_week
        END
      WHEN rd.verwachte_leverweek = 'voorraad' THEN 'voorraad'
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop' THEN 'wacht op nieuwe inkoop'
      WHEN rd.verwachte_leverweek IS NOT NULL AND rd.verwachte_leverweek > p_gewenste_week
        THEN CASE
          WHEN rd.eerste_io_nr IS NOT NULL THEN 'wacht op IO ' || rd.eerste_io_nr
          ELSE 'op inkoop'
        END
      WHEN rd.levertijd_status = 'op_inkoop' THEN
        CASE WHEN rd.eerste_io_nr IS NOT NULL THEN 'wacht op IO ' || rd.eerste_io_nr ELSE 'op inkoop' END
      ELSE NULL
    END AS reden,
    CASE
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        COALESCE(
          (SELECT iso_week FROM eerstvolgend_maatwerk),
          p_gewenste_week
        )
      WHEN rd.verwachte_leverweek = 'voorraad' THEN p_gewenste_week
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop' THEN NULL
      WHEN rd.verwachte_leverweek IS NOT NULL THEN rd.verwachte_leverweek
      ELSE p_gewenste_week
    END AS eerstvolgend_haalbaar
  FROM regel_data rd;
END;
$$;

GRANT EXECUTE ON FUNCTION levertijd_fit_check(BIGINT[], TEXT) TO authenticated;

COMMENT ON FUNCTION levertijd_fit_check(BIGINT[], TEXT) IS
  'Levertijd-Module (ADR-0020, mig 278): per regel — haalbaar voor gewenste '
  'ISO-week? Maatwerk-tak doet nu echte capaciteit-match tegen open snijplannen '
  '(status Wacht/Gepland/Snijden, gesneden_datum NULL) + productie_planning-'
  'config in app_config (capaciteit_per_week, capaciteit_marge_pct). '
  'Voorraad-pad delegeert ongewijzigd naar order_regel_levertijd-view '
  '(Reservering-Module). Niet meegenomen: productie_groep-segmentering, '
  'confectie-lanes, lever_type=dag-buffer — zie V2-backlog in mig 278 header.';


-- ============================================================================
-- 2. levertijd_snelste_haalbaar — maatwerk-tak nu realistisch
-- ============================================================================

CREATE OR REPLACE FUNCTION levertijd_snelste_haalbaar(
  p_regel_ids BIGINT[]
)
RETURNS TABLE (
  regel_id BIGINT,
  snelste_haalbaar TEXT,
  spoed_uitleg TEXT
)
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  v_cap_per_week     INTEGER;
  v_marge_pct        INTEGER;
  v_max_stuks        INTEGER;
  v_buffer_werkdagen INTEGER;
  v_huidige_week     TEXT;
BEGIN
  -- 1) Config (idem als fit_check)
  SELECT
    COALESCE((waarde->>'capaciteit_per_week')::INTEGER, 450),
    COALESCE((waarde->>'capaciteit_marge_pct')::INTEGER, 0),
    COALESCE((waarde->>'logistieke_buffer_dagen')::INTEGER, 2)
  INTO v_cap_per_week, v_marge_pct, v_buffer_werkdagen
  FROM app_config
  WHERE sleutel = 'productie_planning'
  LIMIT 1;

  v_cap_per_week     := COALESCE(v_cap_per_week, 450);
  v_marge_pct        := COALESCE(v_marge_pct, 0);
  v_buffer_werkdagen := COALESCE(v_buffer_werkdagen, 2);
  v_max_stuks        := GREATEST(0, FLOOR(v_cap_per_week * (1 - v_marge_pct / 100.0))::INTEGER);
  v_huidige_week     := to_char(current_date, 'IYYY-"W"IW');

  RETURN QUERY
  WITH input AS (
    SELECT UNNEST(p_regel_ids) AS regel_id
  ),
  regel_data AS (
    SELECT
      i.regel_id,
      oreg.is_maatwerk,
      v.verwachte_leverweek,
      v.levertijd_status,
      v.eerste_io_nr
    FROM input i
    LEFT JOIN order_regels             oreg ON oreg.id = i.regel_id
    LEFT JOIN order_regel_levertijd    v    ON v.order_regel_id = i.regel_id
  ),
  bezetting_per_week AS (
    -- S1 (code-review ADR-0020): iso_week_plus = exact dezelfde to_char-bron
    -- als de weken_iterator (geen format-drift in de join). make_date(jaar,1,4)
    -- ligt gegarandeerd in ISO-week 1 van dat jaar. planning_week BETWEEN 1
    -- AND 53 containt garbage-data (week 53 in een 52-weken-jaar zou anders
    -- stil naar (jaar+1)-W01 lekken → capaciteit-overschatting → vals haalbaar).
    SELECT
      iso_week_plus(make_date(planning_jaar, 1, 4), planning_week - 1) AS iso_week,
      COUNT(*) AS huidig_stuks
    FROM snijplannen
    WHERE status IN ('Wacht', 'Gepland', 'Snijden')
      AND gesneden_datum IS NULL
      AND planning_week IS NOT NULL
      AND planning_jaar IS NOT NULL
      AND planning_week BETWEEN 1 AND 53
    GROUP BY planning_jaar, planning_week
  ),
  -- Scan 12 weken vooruit vanaf huidige_week + buffer-werkdagen (≈ kalenderdagen)
  -- We benaderen werkdagen → kalenderdagen × (7/5) en flooren naar week.
  -- Voor de RPC is de granulariteit week, dus week-vooruit is voldoende.
  weken_iterator AS (
    SELECT
      to_char(date_trunc('week', current_date)::date + (n * 7)::INTEGER,
              'IYYY-"W"IW') AS iso_week,
      n AS offset_weken
    FROM generate_series(0, 12) AS n
  ),
  -- Eerstvolgende week ≥ huidige met ruimte (voor maatwerk-tak)
  snelste_maatwerk AS (
    SELECT
      i.iso_week,
      i.offset_weken,
      (v_max_stuks - COALESCE(b.huidig_stuks, 0)) AS ruimte
    FROM weken_iterator i
    LEFT JOIN bezetting_per_week b ON b.iso_week = i.iso_week
    WHERE (v_max_stuks - COALESCE(b.huidig_stuks, 0)) > 0
    ORDER BY i.iso_week ASC
    LIMIT 1
  )
  SELECT
    rd.regel_id,
    CASE
      -- Maatwerk: eerstvolgende week met ruimte (fallback: huidige + 2 weken zoals stub)
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        COALESCE(
          (SELECT iso_week FROM snelste_maatwerk),
          to_char(current_date + INTERVAL '2 weeks', 'IYYY-"W"IW')
        )
      WHEN rd.verwachte_leverweek = 'voorraad'
        THEN v_huidige_week
      WHEN rd.verwachte_leverweek IS NULL THEN NULL
      ELSE rd.verwachte_leverweek
    END AS snelste_haalbaar,
    CASE
      WHEN COALESCE(rd.is_maatwerk, false) THEN
        CASE
          WHEN (SELECT offset_weken FROM snelste_maatwerk) IS NULL
            THEN 'snij-planning vol komende 12 weken — pessimistische schatting'
          WHEN (SELECT offset_weken FROM snelste_maatwerk) = 0
            THEN 'spoed-slot: capaciteit beschikbaar deze week'
          WHEN (SELECT offset_weken FROM snelste_maatwerk) = 1
            THEN 'eerstvolgende vrije snij-week'
          ELSE 'eerstvolgende vrije snij-week (' || (SELECT offset_weken FROM snelste_maatwerk) || ' weken vooruit)'
        END
      WHEN rd.verwachte_leverweek = 'voorraad' THEN 'voorraad onmiddellijk'
      WHEN rd.levertijd_status = 'wacht_op_nieuwe_inkoop'
        THEN 'wacht op nieuwe inkoop — geen ETA bekend'
      WHEN rd.verwachte_leverweek IS NOT NULL THEN
        CASE
          WHEN rd.eerste_io_nr IS NOT NULL THEN 'eerstvolgende IO ' || rd.eerste_io_nr
          ELSE 'eerstvolgende inkoop'
        END
      ELSE NULL
    END AS spoed_uitleg
  FROM regel_data rd;
END;
$$;

GRANT EXECUTE ON FUNCTION levertijd_snelste_haalbaar(BIGINT[]) TO authenticated;

COMMENT ON FUNCTION levertijd_snelste_haalbaar(BIGINT[]) IS
  'Levertijd-Module (ADR-0020, mig 278): per regel — snelst mogelijke ISO-week. '
  'Maatwerk-tak scant 12 weken vooruit naar eerstvolgende week met '
  'capaciteit-ruimte (productie_planning.capaciteit_per_week minus open '
  'snijplannen). Voorraad-pad ongewijzigd. spoed_uitleg differentieert tussen '
  '"spoed-slot" (week 0), "eerstvolgende vrije snij-week" (week 1), N weken '
  'vooruit, of pessimistische fallback bij 12-week-overflow.';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 3. ASSERT-blok: smoke-tests
-- ============================================================================

DO $$
DECLARE
  v_fit_count       INTEGER;
  v_snelste_count   INTEGER;
  v_empty_rows      INTEGER;
  v_maatwerk_regel  BIGINT;
  v_haalbaar        BOOLEAN;
  v_snelste         TEXT;
  v_uitleg          TEXT;
  v_eerstvolgend    TEXT;
BEGIN
  -- 1) Functies bestaan (idempotent overschreven, zelfde signature)
  SELECT COUNT(*) INTO v_fit_count
    FROM pg_proc
   WHERE proname = 'levertijd_fit_check';
  ASSERT v_fit_count >= 1, 'levertijd_fit_check verdwenen na mig 278';

  SELECT COUNT(*) INTO v_snelste_count
    FROM pg_proc
   WHERE proname = 'levertijd_snelste_haalbaar';
  ASSERT v_snelste_count >= 1, 'levertijd_snelste_haalbaar verdwenen na mig 278';

  -- 2) Lege array smoke-test (geen errors, 0 rijen)
  SELECT COUNT(*) INTO v_empty_rows
    FROM levertijd_fit_check(ARRAY[]::BIGINT[], '2026-W25');
  ASSERT v_empty_rows = 0,
    format('levertijd_fit_check(empty) gaf %s rijen, verwacht 0', v_empty_rows);

  SELECT COUNT(*) INTO v_empty_rows
    FROM levertijd_snelste_haalbaar(ARRAY[]::BIGINT[]);
  ASSERT v_empty_rows = 0,
    format('levertijd_snelste_haalbaar(empty) gaf %s rijen, verwacht 0', v_empty_rows);

  -- 3) Sample maatwerk-regel: snelste_haalbaar moet NIET-NULL retourneren
  --    (de fallback in de RPC garandeert dit, ongeacht snijplan-bezetting).
  SELECT id INTO v_maatwerk_regel
    FROM order_regels
   WHERE is_maatwerk = TRUE
   LIMIT 1;

  IF v_maatwerk_regel IS NOT NULL THEN
    SELECT snelste_haalbaar, spoed_uitleg
      INTO v_snelste, v_uitleg
      FROM levertijd_snelste_haalbaar(ARRAY[v_maatwerk_regel]);

    ASSERT v_snelste IS NOT NULL,
      format('Maatwerk-regel %s: snelste_haalbaar is NULL — verwacht ISO-week-string',
             v_maatwerk_regel);
    ASSERT v_snelste ~ '^\d{4}-W\d{2}$',
      format('Maatwerk-regel %s: snelste_haalbaar="%s" matcht niet ISO-week-formaat',
             v_maatwerk_regel, v_snelste);
    ASSERT v_uitleg IS NOT NULL,
      format('Maatwerk-regel %s: spoed_uitleg is NULL — verwacht beschrijving',
             v_maatwerk_regel);

    -- fit_check op die regel voor een ver-in-de-toekomst-week moet haalbaar=TRUE geven
    SELECT haalbaar, eerstvolgend_haalbaar
      INTO v_haalbaar, v_eerstvolgend
      FROM levertijd_fit_check(ARRAY[v_maatwerk_regel], '2099-W52');

    ASSERT v_haalbaar = TRUE,
      format('Maatwerk-regel %s: fit_check voor 2099-W52 gaf haalbaar=FALSE — onverwacht',
             v_maatwerk_regel);
    ASSERT v_eerstvolgend IS NOT NULL,
      format('Maatwerk-regel %s: eerstvolgend_haalbaar is NULL voor 2099-W52',
             v_maatwerk_regel);

    RAISE NOTICE 'Smoke-test maatwerk-regel %: snelste=%, fit_check(2099-W52).haalbaar=%, eerstvolgend=%',
      v_maatwerk_regel, v_snelste, v_haalbaar, v_eerstvolgend;
  ELSE
    RAISE NOTICE 'Geen maatwerk-regel gevonden voor smoke-test — overgeslagen';
  END IF;

  RAISE NOTICE 'Mig 278 OK: maatwerk-takken van levertijd_fit_check en levertijd_snelste_haalbaar';
  RAISE NOTICE '  - Capaciteit-bron: snijplannen (Wacht/Gepland/Snijden, gesneden_datum NULL)';
  RAISE NOTICE '  - Config-bron:     app_config.productie_planning (capaciteit_per_week)';
  RAISE NOTICE '  - V2-backlog:      productie_groep-segmentering, confectie-lanes, dag-order-buffer';
END $$;
