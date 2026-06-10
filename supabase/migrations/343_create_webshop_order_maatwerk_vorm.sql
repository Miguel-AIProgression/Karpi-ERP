-- Migratie 343: create_webshop_order persisteert maatwerk_vorm
--
-- Probleem: slice 4 van het order-intake-plan (2026-06-09) laat Shopify én
-- beide Lightspeed-paden `maatwerk_vorm` meesturen in de regel-JSON
-- (IntakeRegel, _shared/order-intake/types.ts), maar de regel-INSERT in
-- create_webshop_order (laatste definitie: mig 322) kent die sleutel niet.
-- JSONB-parameters geven geen fout op onbekende sleutels → het veld stierf
-- geruisloos in de RPC en webshop-maatwerk landde met maatwerk_vorm = NULL,
-- waardoor het auto-snijplan van een rechthoek uitging (zelfde incidentklasse
-- als de maatwerk_vorm-fix van 2026-06-09, die hiermee pas écht af is).
--
-- Gedragsbehoud-guard: order_regels.maatwerk_vorm heeft een FK naar
-- maatwerk_vormen(code). Een rauwe insert van een onbekende code zou de hele
-- order laten falen waar die nu landt. Daarom een gevalideerde lookup:
-- onbekende/lege code → NULL (order landt, vorm ontbreekt — het huidige
-- gedrag), bekende code → gepersisteerd. De TS-kant emit 'rond' / 'ovaal' /
-- 'organisch_a' (product-matcher.ts detectVorm).
--
-- Body verder byte-voor-byte identiek aan mig 322. Signatuur ongewijzigd
-- (jsonb, jsonb, order_status) — caller-compatibel met sync-shopify-order,
-- sync-webshop-order, import-lightspeed-orders en poll-email-orders.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION create_webshop_order(
  p_header          JSONB,
  p_regels          JSONB,
  p_initieel_status order_status DEFAULT 'Klaar voor picken'
) RETURNS TABLE(order_nr TEXT, was_existing BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_oid     BIGINT;
  v_onr     TEXT;
  v_regel   JSONB;
  v_regelnr INT := 0;
BEGIN
  -- Idempotentie: als de order al bestaat → return zonder aanmaken
  SELECT o.id, o.order_nr INTO v_oid, v_onr
  FROM orders o
  WHERE o.bron_order_id = p_header->>'bron_order_id'
    AND o.bron_systeem  = p_header->>'bron_systeem'
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_onr, TRUE;
    RETURN;
  END IF;

  v_onr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr,
    debiteur_nr, klant_referentie, orderdatum, afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
    afl_email, afl_telefoon, opmerkingen,
    bron_systeem, bron_shop, bron_order_id,
    debiteur_zeker, debiteur_match_bron,
    status
  ) VALUES (
    v_onr,
    (p_header->>'debiteur_nr')::INTEGER,
    p_header->>'klant_referentie',
    NULLIF(p_header->>'orderdatum',   '')::DATE,
    NULLIF(p_header->>'afleverdatum', '')::DATE,
    p_header->>'fact_naam',  p_header->>'fact_adres',  p_header->>'fact_postcode',  p_header->>'fact_plaats',  COALESCE(NULLIF(p_header->>'fact_land', ''), 'NL'),
    p_header->>'afl_naam',   p_header->>'afl_naam_2',  p_header->>'afl_adres',  p_header->>'afl_postcode',  p_header->>'afl_plaats',  p_header->>'afl_land',
    NULLIF(p_header->>'afl_email',    ''),
    NULLIF(p_header->>'afl_telefoon', ''),
    NULLIF(p_header->>'opmerkingen',  ''),
    p_header->>'bron_systeem', p_header->>'bron_shop', p_header->>'bron_order_id',
    -- Default TRUE als de caller de vlag niet meestuurt (handmatig/legacy-pad).
    COALESCE((p_header->>'debiteur_zeker')::BOOLEAN, TRUE),
    NULLIF(p_header->>'debiteur_match_bron', ''),
    p_initieel_status
  )
  RETURNING id INTO v_oid;

  -- Orderregels invoegen
  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels) LOOP
    v_regelnr := v_regelnr + 1;
    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr,
      omschrijving, omschrijving_2,
      orderaantal, te_leveren,
      prijs, korting_pct, bedrag, gewicht_kg,
      is_maatwerk, maatwerk_kwaliteit_code, maatwerk_kleur_code,
      maatwerk_vorm,
      maatwerk_lengte_cm, maatwerk_breedte_cm
    ) VALUES (
      v_oid, v_regelnr,
      NULLIF(v_regel->>'artikelnr', ''),
      v_regel->>'omschrijving',
      NULLIF(v_regel->>'omschrijving_2', ''),
      (v_regel->>'orderaantal')::INTEGER,
      (v_regel->>'te_leveren')::INTEGER,
      NULLIF(v_regel->>'prijs',      '')::NUMERIC,
      COALESCE(NULLIF(v_regel->>'korting_pct', '')::NUMERIC, 0),
      NULLIF(v_regel->>'bedrag',     '')::NUMERIC,
      NULLIF(v_regel->>'gewicht_kg', '')::NUMERIC,
      COALESCE((v_regel->>'is_maatwerk')::BOOLEAN, FALSE),
      NULLIF(v_regel->>'maatwerk_kwaliteit_code', ''),
      NULLIF(v_regel->>'maatwerk_kleur_code', ''),
      -- Gevalideerd tegen maatwerk_vormen: onbekende code → NULL, geen FK-fout
      (SELECT mv.code FROM maatwerk_vormen mv
        WHERE mv.code = NULLIF(v_regel->>'maatwerk_vorm', '')),
      NULLIF(v_regel->>'maatwerk_lengte_cm', '')::NUMERIC,
      NULLIF(v_regel->>'maatwerk_breedte_cm', '')::NUMERIC
    );
  END LOOP;

  -- Voor niet-Concept orders: meteen reserveringen/status herberekenen
  IF p_initieel_status <> 'Concept' THEN
    PERFORM herbereken_wacht_status(v_oid);
  END IF;

  RETURN QUERY SELECT v_onr, FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION create_webshop_order(jsonb, jsonb, order_status) TO authenticated, service_role;

COMMENT ON FUNCTION create_webshop_order IS
  'Maakt webshop/e-mail-order + regels aan, idempotent op '
  '(bron_systeem, bron_order_id). (EDI loopt via create_edi_order.) '
  'Sinds mig 308: optionele p_initieel_status '
  '(Concept voor e-mail-review). Sinds mig 322: persisteert optionele '
  'p_header.debiteur_zeker + p_header.debiteur_match_bron (default zeker=TRUE) '
  'voor de "debiteur te bevestigen"-flow. Sinds mig 343: persisteert '
  'regel.maatwerk_vorm (gevalideerd tegen maatwerk_vormen, onbekend -> NULL).';

-- ============================================================================
-- Zelf-test (definitie-niveau; de functie heeft side-effects dus geen
-- fixture-order op productie):
--   1. de live definitie bevat nu maatwerk_vorm + de gevalideerde lookup;
--   2. de drie codes die de TS-kant emit (product-matcher detectVorm) bestaan
--      in maatwerk_vormen — ontbreekt er één, dan hoor je dat NU en niet
--      stilletjes bij de eerstvolgende order.
-- ============================================================================
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('create_webshop_order(jsonb, jsonb, order_status)'::regprocedure);
  v_ontbrekend TEXT;
BEGIN
  IF v_def NOT LIKE '%maatwerk_vorm%' THEN
    RAISE EXCEPTION 'FAAL: create_webshop_order bevat geen maatwerk_vorm';
  END IF;
  IF v_def NOT LIKE '%FROM maatwerk_vormen%' THEN
    RAISE EXCEPTION 'FAAL: maatwerk_vorm-insert mist de gevalideerde lookup';
  END IF;

  SELECT string_agg(c.code, ', ') INTO v_ontbrekend
  FROM (VALUES ('rond'), ('ovaal'), ('organisch_a')) AS c(code)
  WHERE NOT EXISTS (SELECT 1 FROM maatwerk_vormen mv WHERE mv.code = c.code);

  IF v_ontbrekend IS NOT NULL THEN
    RAISE EXCEPTION 'FAAL: TS-kant emit vorm-codes die niet in maatwerk_vormen staan: %', v_ontbrekend;
  END IF;

  RAISE NOTICE 'Mig 343: alle asserties geslaagd (maatwerk_vorm gepersisteerd + gevalideerd)';
END $$;

NOTIFY pgrst, 'reload schema';
