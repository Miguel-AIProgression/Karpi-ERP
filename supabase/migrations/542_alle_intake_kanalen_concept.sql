-- Migratie 542: alle intake-kanalen starten met status='Concept'
--
-- Aanleiding (mig 540-541): de Concept-intake-gate is nu compleet:
--   mig 540 dicht de lekken (allocator/snijplanning/herplan-sweep)
--   mig 541 voegt bevestig_concept_order RPC toe
-- Nu moeten ALLE order-aanmaak-functies standaard op Concept beginnen.
--
-- Scope
-- -----
-- create_order_with_lines   — handmatig (order-form UI): 'Nieuw' → 'Concept'
-- create_edi_order          — EDI/Transus: hardcoded 'Klaar voor picken' → 'Concept'
-- create_webshop_order      — Shopify/webshop/e-mail: DEFAULT 'Klaar voor picken' → 'Concept'
--
-- Bewust NIET gewijzigd:
--   registreer_achteraf_order (mig 524) — retroactieve "al afgehandelde" orders
--   markeer_achteraf_verzonden (mig 539) — slaat de normale workflow bewust over
--
-- Edge functions hoeven niet aangepast:
--   poll-email-orders: geeft al expliciet p_initieel_status='Concept' mee
--   shopify-order-processor + sync-webshop-order: gebruiken SQL-default (verandert nu)
--   transus-poll: gebruikt SQL-literal in create_edi_order (verandert nu)
--
-- Triggers (herallocateer, auto_maak_snijplan, auto_sync_snijplan_maten,
-- actieve_snijgroepen) zijn al bewaakt via mig 540 — ze doen niets voor
-- Concept-orders. bevestig_concept_order (mig 541) is de enige uitweg.

-- ============================================================================
-- 1. create_order_with_lines — handmatige intake (mig 481 als basis)
--    Wijziging: 'Nieuw' → 'Concept' in de orders-INSERT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_order_with_lines(p_order jsonb, p_regels jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_order_nr      TEXT;
    v_order_id      BIGINT;
    v_debiteur_nr   INTEGER;
    v_prijslijst_nr TEXT;
BEGIN
    v_debiteur_nr := (p_order->>'debiteur_nr')::INTEGER;

    SELECT prijslijst_nr INTO v_prijslijst_nr
      FROM debiteuren
     WHERE debiteur_nr = v_debiteur_nr;

    IF v_prijslijst_nr IS NULL THEN
      RAISE EXCEPTION
        'Debiteur % heeft geen prijslijst gekoppeld — koppel eerst een prijslijst aan deze klant voordat je een order aanmaakt.',
        v_debiteur_nr
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_order_nr := volgend_nummer('ORD');

    INSERT INTO orders (
        order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
        week, vertegenw_code, betaler, inkooporganisatie,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        fact_email,
        afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
        afl_email,
        lever_modus,
        afhalen,
        lever_type,
        status
    ) VALUES (
        v_order_nr,
        v_debiteur_nr,
        COALESCE((p_order->>'orderdatum')::DATE, CURRENT_DATE),
        (p_order->>'afleverdatum')::DATE,
        p_order->>'klant_referentie',
        p_order->>'week',
        p_order->>'vertegenw_code',
        (p_order->>'betaler')::INTEGER,
        p_order->>'inkooporganisatie',
        p_order->>'fact_naam', p_order->>'fact_adres',
        p_order->>'fact_postcode', p_order->>'fact_plaats', p_order->>'fact_land',
        NULLIF(p_order->>'fact_email', ''),
        p_order->>'afl_naam', p_order->>'afl_naam_2',
        p_order->>'afl_adres', p_order->>'afl_postcode',
        p_order->>'afl_plaats', p_order->>'afl_land',
        NULLIF(p_order->>'afl_email', ''),
        NULLIF(p_order->>'lever_modus', ''),
        COALESCE((p_order->>'afhalen')::BOOLEAN, FALSE),
        COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
        'Concept'  -- mig 542: alle handmatige orders beginnen in Concept
    ) RETURNING id INTO v_order_id;

    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code,
        klant_referentie
    )
    SELECT
        v_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        (r->>'prijs')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        (r->>'bedrag')::NUMERIC,
        (r->>'gewicht_kg')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        (r->>'maatwerk_lengte_cm')::INTEGER,
        (r->>'maatwerk_breedte_cm')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code',
        NULLIF(r->>'klant_referentie', '')
    FROM jsonb_array_elements(p_regels) AS r;

    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$function$;

-- ============================================================================
-- 2. create_edi_order — EDI/Transus intake (mig 368 als basis)
--    Wijziging: hardcoded 'Klaar voor picken' → 'Concept' in de INSERT
--    Geen p_initieel_status parameter nodig: transus-poll gebruikt altijd
--    de hardcoded waarde; triggers zijn bewaakt via mig 540.
-- ============================================================================
CREATE OR REPLACE FUNCTION create_edi_order(
  p_inkomend_bericht_id BIGINT,
  p_payload_parsed      JSONB,
  p_debiteur_nr         INTEGER
) RETURNS BIGINT AS $$
DECLARE
  v_header           JSONB := p_payload_parsed->'header';
  v_regels           JSONB := p_payload_parsed->'regels';
  v_ordernr          TEXT;
  v_existing_id      BIGINT;
  v_order_id         BIGINT;
  v_klantref         TEXT  := v_header->>'ordernummer';
  v_leverdatum       DATE  := NULLIF(v_header->>'leverdatum', '')::DATE;
  v_orderdatum       DATE  := COALESCE(NULLIF(v_header->>'orderdatum','')::DATE, CURRENT_DATE);
  v_gln_gefact       TEXT  := v_header->>'gln_gefactureerd';
  v_gln_best         TEXT  := v_header->>'gln_besteller';
  v_gln_afl          TEXT  := v_header->>'gln_afleveradres';
  v_deb_naam         TEXT;
  v_deb_adres        TEXT;
  v_deb_postcode     TEXT;
  v_deb_plaats       TEXT;
  v_deb_land         TEXT;
  v_fact_naam        TEXT;
  v_fact_adres       TEXT;
  v_fact_postcode    TEXT;
  v_fact_plaats      TEXT;
  v_prijslijst_nr    TEXT;
  v_korting_pct      NUMERIC := 0;
  v_afl_naam         TEXT;
  v_afl_adres        TEXT;
  v_afl_postcode     TEXT;
  v_afl_plaats       TEXT;
  v_afl_land         TEXT;
  v_email_factuur    TEXT;
  v_email_overig     TEXT;
  v_fact_email       TEXT;
  v_afl_email        TEXT;
  v_transactie_id    TEXT;
  v_is_test          BOOLEAN;
  r                  JSONB;
  v_regelnr          INTEGER := 0;
  v_match            RECORD;
  v_aantal           INTEGER;
  v_omschrijving     TEXT;
  v_prijs            NUMERIC;
  v_bedrag           NUMERIC;
BEGIN
  SELECT transactie_id, is_test
    INTO v_transactie_id, v_is_test
    FROM edi_berichten
   WHERE id = p_inkomend_bericht_id;

  IF v_transactie_id IS NULL THEN
    RAISE EXCEPTION 'edi_berichten id=% niet gevonden of geen transactie_id', p_inkomend_bericht_id;
  END IF;

  SELECT id INTO v_existing_id
    FROM orders
   WHERE bron_systeem = 'edi'
     AND bron_order_id = v_transactie_id;
  IF v_existing_id IS NOT NULL THEN
    UPDATE edi_berichten SET order_id = v_existing_id WHERE id = p_inkomend_bericht_id;
    RETURN v_existing_id;
  END IF;

  IF p_debiteur_nr IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land,
           COALESCE(fact_naam, naam),
           COALESCE(fact_adres, adres),
           COALESCE(fact_postcode, postcode),
           COALESCE(fact_plaats, plaats),
           prijslijst_nr,
           COALESCE(korting_pct, 0),
           NULLIF(TRIM(COALESCE(email_factuur, '')), ''),
           NULLIF(TRIM(COALESCE(email_overig,  '')), '')
      INTO v_deb_naam, v_deb_adres, v_deb_postcode, v_deb_plaats, v_deb_land,
           v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats,
           v_prijslijst_nr, v_korting_pct,
           v_email_factuur, v_email_overig
      FROM debiteuren
     WHERE debiteur_nr = p_debiteur_nr;
  END IF;

  v_fact_email := COALESCE(v_email_factuur, v_email_overig);

  IF p_debiteur_nr IS NOT NULL AND v_gln_afl IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land,
           NULLIF(TRIM(COALESCE(email, '')), '')
      INTO v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, v_afl_land,
           v_afl_email
      FROM afleveradressen
     WHERE debiteur_nr = p_debiteur_nr
       AND gln_afleveradres IN (v_gln_afl, v_gln_afl || '.0')
     LIMIT 1;
  END IF;

  IF v_afl_naam IS NULL THEN
    v_afl_naam := v_deb_naam;
    v_afl_adres := v_deb_adres;
    v_afl_postcode := v_deb_postcode;
    v_afl_plaats := v_deb_plaats;
    v_afl_land := v_deb_land;
  END IF;

  v_afl_email := COALESCE(v_afl_email, v_email_overig);

  v_ordernr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr, debiteur_nr, klant_referentie,
    orderdatum, afleverdatum, edi_gewenste_afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    fact_email,
    bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    afl_email,
    factuuradres_gln, besteller_gln, afleveradres_gln,
    bron_systeem, bron_order_id, status
  ) VALUES (
    v_ordernr, p_debiteur_nr, v_klantref,
    v_orderdatum, v_leverdatum, v_leverdatum,
    v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats, COALESCE(v_deb_land, 'NL'),
    v_fact_email,
    NULLIF(v_header->>'afnemer_naam', ''), NULL, NULL, NULL, NULL,
    v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, COALESCE(v_afl_land, 'NL'),
    v_afl_email,
    v_gln_gefact, v_gln_best, v_gln_afl,
    'edi', v_transactie_id, 'Concept'  -- mig 542: EDI-orders beginnen in Concept
  )
  RETURNING id INTO v_order_id;

  FOR r IN SELECT * FROM jsonb_array_elements(v_regels)
  LOOP
    v_regelnr := v_regelnr + 1;
    v_aantal := COALESCE((r->>'aantal')::NUMERIC::INTEGER, 1);
    v_prijs := NULL;

    SELECT * INTO v_match
      FROM match_edi_artikel(r->>'gtin', r->>'artikelcode');

    IF v_match.artikelnr IS NULL THEN
      v_omschrijving := '[EDI ongematcht: ' ||
        COALESCE(NULLIF(r->>'artikelcode', ''), r->>'gtin', '?') || ']';
    ELSE
      v_omschrijving := COALESCE(v_match.omschrijving, v_match.artikelnr);

      IF v_prijslijst_nr IS NOT NULL THEN
        SELECT pr.prijs
          INTO v_prijs
          FROM prijslijst_regels pr
         WHERE pr.prijslijst_nr = v_prijslijst_nr
           AND pr.artikelnr = v_match.artikelnr
         LIMIT 1;
      END IF;

      v_prijs := COALESCE(v_prijs, v_match.verkoopprijs);
    END IF;

    v_bedrag := ROUND(COALESCE(v_prijs, 0) * v_aantal * (1 - COALESCE(v_korting_pct, 0) / 100), 2);

    INSERT INTO order_regels (
      order_id, regelnummer,
      artikelnr, omschrijving,
      orderaantal, te_leveren,
      prijs, korting_pct, bedrag
    ) VALUES (
      v_order_id, v_regelnr,
      v_match.artikelnr,
      v_omschrijving,
      v_aantal, v_aantal,
      v_prijs,
      COALESCE(v_korting_pct, 0),
      v_bedrag
    );
  END LOOP;

  UPDATE edi_berichten SET order_id = v_order_id WHERE id = p_inkomend_bericht_id;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_edi_order(BIGINT, JSONB, INTEGER) TO authenticated;

COMMENT ON FUNCTION create_edi_order IS
  'Maakt een order + regels aan op basis van een geparseerde inkomende EDI-payload. '
  'Idempotent op (bron_systeem=edi, bron_order_id=TransactionID). Gebruikt '
  'match_edi_artikel voor artikelmatching en prijst regels via debiteuren.prijslijst_nr '
  '→ prijslijst_regels; fallback op producten.verkoopprijs. Sinds mig 309 vult de '
  'functie OOK edi_gewenste_afleverdatum. Sinds mig 312 is de afleveradres-lookup '
  '".0"-tolerant. Mig 368: vult fact_email/afl_email. '
  'Mig 542: status=''Concept'' (was Klaar voor picken) — bevestig_concept_order vereist.';

-- ============================================================================
-- 3. create_webshop_order — Shopify/webshop/e-mail intake (mig 368 als basis)
--    Wijziging: DEFAULT 'Klaar voor picken' → DEFAULT 'Concept'
--    De IF p_initieel_status <> 'Concept' THEN guard was al aanwezig (mig 308).
-- ============================================================================
CREATE OR REPLACE FUNCTION create_webshop_order(
  p_header          JSONB,
  p_regels          JSONB,
  p_initieel_status order_status DEFAULT 'Concept'  -- mig 542: was 'Klaar voor picken'
) RETURNS TABLE(order_nr TEXT, was_existing BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_oid     BIGINT;
  v_onr     TEXT;
  v_regel   JSONB;
  v_regelnr INT := 0;
  v_env_fallback  BOOLEAN := COALESCE(NULLIF(p_header->>'debiteur_match_bron', ''), '') = 'env_fallback';
  v_email_factuur TEXT;
  v_email_overig  TEXT;
  v_fact_email    TEXT := NULLIF(p_header->>'fact_email', '');
  v_afl_email     TEXT := NULLIF(p_header->>'afl_email',  '');
BEGIN
  SELECT o.id, o.order_nr INTO v_oid, v_onr
  FROM orders o
  WHERE o.bron_order_id = p_header->>'bron_order_id'
    AND o.bron_systeem  = p_header->>'bron_systeem'
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_onr, TRUE;
    RETURN;
  END IF;

  IF (v_fact_email IS NULL OR v_afl_email IS NULL)
     AND NOT v_env_fallback
     AND NULLIF(p_header->>'debiteur_nr', '') IS NOT NULL THEN
    SELECT NULLIF(TRIM(COALESCE(d.email_factuur, '')), ''),
           NULLIF(TRIM(COALESCE(d.email_overig,  '')), '')
      INTO v_email_factuur, v_email_overig
      FROM debiteuren d
     WHERE d.debiteur_nr = (p_header->>'debiteur_nr')::INTEGER;

    v_fact_email := COALESCE(v_fact_email, v_email_factuur, v_email_overig);
    v_afl_email  := COALESCE(v_afl_email,  v_email_overig);
  END IF;

  v_onr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr,
    debiteur_nr, klant_referentie, orderdatum, afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    fact_email,
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
    v_fact_email,
    p_header->>'afl_naam',   p_header->>'afl_naam_2',  p_header->>'afl_adres',  p_header->>'afl_postcode',  p_header->>'afl_plaats',  p_header->>'afl_land',
    v_afl_email,
    NULLIF(p_header->>'afl_telefoon', ''),
    NULLIF(p_header->>'opmerkingen',  ''),
    p_header->>'bron_systeem', p_header->>'bron_shop', p_header->>'bron_order_id',
    COALESCE((p_header->>'debiteur_zeker')::BOOLEAN, TRUE),
    NULLIF(p_header->>'debiteur_match_bron', ''),
    p_initieel_status
  )
  RETURNING id INTO v_oid;

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
      (SELECT mv.code FROM maatwerk_vormen mv
        WHERE mv.code = NULLIF(v_regel->>'maatwerk_vorm', '')),
      NULLIF(v_regel->>'maatwerk_lengte_cm', '')::NUMERIC,
      NULLIF(v_regel->>'maatwerk_breedte_cm', '')::NUMERIC
    );
  END LOOP;

  -- Voor niet-Concept orders: meteen reserveringen/status herberekenen.
  -- Bij Concept (nu de default): allocator is geblokkeerd via mig 540-guards;
  -- bevestig_concept_order (mig 541) doet de allocatie na bevestiging.
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
  'Mig 308: optionele p_initieel_status. '
  'Mig 322: persisteert debiteur_zeker + debiteur_match_bron. '
  'Mig 343: persisteert regel.maatwerk_vorm (gevalideerd). '
  'Mig 368: vult fact_email/afl_email. '
  'Mig 542: DEFAULT gewijzigd naar ''Concept'' — alle webshop/Shopify-orders '
  'beginnen nu in Concept; bevestig_concept_order vereist voor activering.';

-- ============================================================================
-- 4. Zelf-test
-- ============================================================================
DO $$
DECLARE
  v_owl TEXT := pg_get_functiondef('create_order_with_lines(jsonb, jsonb)'::regprocedure);
  v_edi TEXT := pg_get_functiondef('create_edi_order(bigint, jsonb, integer)'::regprocedure);
  v_web TEXT := pg_get_functiondef('create_webshop_order(jsonb, jsonb, order_status)'::regprocedure);
BEGIN
  IF v_owl NOT LIKE $m$%'Concept'%$m$ OR v_owl LIKE $m$%'Nieuw'%$m$ THEN
    RAISE EXCEPTION 'Mig 542: create_order_with_lines heeft nog ''Nieuw'' i.p.v. ''Concept''';
  END IF;
  IF v_edi NOT LIKE $m$%'edi', v_transactie_id, 'Concept'%$m$ THEN
    RAISE EXCEPTION 'Mig 542: create_edi_order heeft niet ''Concept'' als intake-status';
  END IF;
  IF v_web NOT LIKE $m$%DEFAULT 'Concept'%$m$ THEN
    RAISE EXCEPTION 'Mig 542: create_webshop_order heeft niet DEFAULT ''Concept''';
  END IF;
  RAISE NOTICE 'Mig 542: alle drie intake-RPC''s starten nu met status=Concept';
END $$;

NOTIFY pgrst, 'reload schema';
