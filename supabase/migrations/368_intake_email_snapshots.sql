-- Migratie 368: EDI- en webshop-intake vullen e-mail-snapshots bij aanmaak
--
-- Probleem (gevonden 11-06-2026): mig 364 introduceerde orders.fact_email +
-- afleveradressen.email en paste alléén de orderformulier-RPC's aan
-- (create_order_with_lines / update_order_with_lines). De andere intake-RPC's
-- — create_edi_order (EDI) en create_webshop_order (Shopify/Lightspeed/e-mail)
-- — kennen de snapshots niet. De eenmalige backfill (mig 367) ving bestaande
-- orders, maar elke order die daarná via EDI/webshop binnenkwam landde met
-- lege fact_email/afl_email: factuur-verzenden heeft dan geen ontvanger en de
-- vervoerder stuurt geen track & trace. Concreet bewijs dezelfde dag:
-- Hornbach-EDI-order ORD-2026-0334 leeg terwijl de debiteur beide adressen
-- gewoon heeft. (Zelfde incidentklasse als mig 343: nieuw veld toegevoegd
-- maar niet in álle intake-paden.)
--
-- Fix — zelfde ladder als het orderformulier en mig 367:
--   fact_email: debiteuren.email_factuur → fallback debiteuren.email_overig
--   afl_email:  afleveradressen.email (EDI: de GLN-gematchte vestiging)
--               → fallback debiteuren.email_overig
--
-- create_edi_order:    EDI-orders hebben altijd een echte debiteur — ladder
--                      onvoorwaardelijk toepassen.
-- create_webshop_order: expliciete p_header-waarden winnen (de consument-e-mail
--                      uit de webshop-payload is leidend); de debiteur-ladder
--                      vult alleen aan als de header leeg is ÉN de match geen
--                      env_fallback is (verzameldebiteur — diens e-mail is
--                      niet de klant, zie mig 367-guard).
--
-- Sluit af met een idempotente her-run van de mig 367-backfill zodat de
-- orders die tussen die backfill en deze migratie binnenkwamen (o.a.
-- ORD-2026-0332/0333 uit het HEADLAM-wijzig-venster en EDI/Shopify-orders
-- van 11-06) in dezelfde run gerepareerd worden.
--
-- Idempotent: CREATE OR REPLACE + alleen-vullen-waar-leeg-backfill.

-- ============================================================================
-- 1. create_edi_order — body = mig 357 + e-mail-snapshots
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
  -- Mig 368: e-mail-snapshots
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

  -- Mig 368: zelfde ladder als orderformulier (mig 364) en backfill (mig 367)
  v_fact_email := COALESCE(v_email_factuur, v_email_overig);

  -- Mig 312: ".0"-tolerant — de afleveradres-GLN kan in de DB nog het Excel-
  -- float-artefact dragen, terwijl de binnenkomende GLN schoon is (en vice versa).
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

  -- Mig 368: vestiging zonder eigen e-mail → algemeen klant-e-mailadres
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
    'edi', v_transactie_id, 'Klaar voor picken'  -- mig 275-intentie hersteld (mig 357)
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
  '".0"-tolerant. Mig 357: status-literal definitief Klaar voor picken. '
  'Mig 368: vult fact_email (email_factuur → email_overig) en afl_email '
  '(afleveradres-email van de GLN-vestiging → email_overig).';

-- ============================================================================
-- 2. create_webshop_order — body = mig 343 + e-mail-snapshots
-- ============================================================================
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
  -- Mig 368: e-mail-snapshots
  v_env_fallback  BOOLEAN := COALESCE(NULLIF(p_header->>'debiteur_match_bron', ''), '') = 'env_fallback';
  v_email_factuur TEXT;
  v_email_overig  TEXT;
  v_fact_email    TEXT := NULLIF(p_header->>'fact_email', '');
  v_afl_email     TEXT := NULLIF(p_header->>'afl_email',  '');
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

  -- Mig 368: expliciete header-waarden winnen (consument-e-mail uit de
  -- webshop-payload is leidend); debiteur-ladder vult alleen aan — en bij
  -- env_fallback (verzameldebiteur) nooit, diens e-mail is niet de klant.
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
  'Sinds mig 308: optionele p_initieel_status (Concept voor e-mail-review). '
  'Sinds mig 322: persisteert debiteur_zeker + debiteur_match_bron. '
  'Sinds mig 343: persisteert regel.maatwerk_vorm (gevalideerd). '
  'Mig 368: vult fact_email/afl_email — expliciete p_header-waarden winnen, '
  'debiteur-ladder (email_factuur → email_overig) vult aan, behalve bij '
  'env_fallback (verzameldebiteur).';

-- ============================================================================
-- 3. Zelf-test (definitie-niveau)
-- ============================================================================
DO $$
DECLARE
  v_edi TEXT := pg_get_functiondef('create_edi_order(bigint, jsonb, integer)'::regprocedure);
  v_web TEXT := pg_get_functiondef('create_webshop_order(jsonb, jsonb, order_status)'::regprocedure);
BEGIN
  IF v_edi NOT LIKE '%fact_email%' OR v_edi NOT LIKE '%v_afl_email%' THEN
    RAISE EXCEPTION 'Mig 368: create_edi_order mist de e-mail-snapshots';
  END IF;
  -- Regressie-guards uit mig 357/343 blijven gelden
  IF v_edi NOT LIKE $m$%'edi', v_transactie_id, 'Klaar voor picken'%$m$ THEN
    RAISE EXCEPTION 'Mig 368: create_edi_order verloor de Klaar voor picken-literal (mig 357)';
  END IF;
  IF v_web NOT LIKE '%v_fact_email%' OR v_web NOT LIKE '%env_fallback%' THEN
    RAISE EXCEPTION 'Mig 368: create_webshop_order mist de e-mail-snapshots of de env_fallback-guard';
  END IF;
  IF v_web NOT LIKE '%FROM maatwerk_vormen%' THEN
    RAISE EXCEPTION 'Mig 368: create_webshop_order verloor de maatwerk_vorm-lookup (mig 343)';
  END IF;
  RAISE NOTICE 'Mig 368: beide intake-RPC''s vullen e-mail-snapshots';
END $$;

-- ============================================================================
-- 4. Backfill-her-run (idempotent, identiek aan mig 367) — vangt de orders
--    die tussen de mig 367-run en deze migratie zijn binnengekomen
--    (o.a. ORD-2026-0332/0333 en de EDI/Shopify-orders van 11-06).
-- ============================================================================

-- 4.1 fact_email uit debiteuren (email_factuur → email_overig)
UPDATE orders o
   SET fact_email = COALESCE(
         NULLIF(TRIM(COALESCE(d.email_factuur, '')), ''),
         NULLIF(TRIM(COALESCE(d.email_overig,  '')), '')
       )
  FROM debiteuren d
 WHERE d.debiteur_nr = o.debiteur_nr
   AND NULLIF(TRIM(COALESCE(o.fact_email, '')), '') IS NULL
   AND o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND COALESCE(o.debiteur_match_bron, '') <> 'env_fallback'
   AND COALESCE(
         NULLIF(TRIM(COALESCE(d.email_factuur, '')), ''),
         NULLIF(TRIM(COALESCE(d.email_overig,  '')), '')
       ) IS NOT NULL;

-- 4.2a afl_email uit het matchende afleveradres
UPDATE orders o
   SET afl_email = (
         SELECT NULLIF(TRIM(COALESCE(a.email, '')), '')
           FROM afleveradressen a
          WHERE a.debiteur_nr = o.debiteur_nr
            AND NULLIF(TRIM(COALESCE(a.email, '')), '') IS NOT NULL
            AND _normaliseer_afleveradres(a.adres, a.postcode, a.land)
              = _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
          ORDER BY a.adres_nr
          LIMIT 1
       )
 WHERE NULLIF(TRIM(COALESCE(o.afl_email, '')), '') IS NULL
   AND o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND EXISTS (
         SELECT 1
           FROM afleveradressen a
          WHERE a.debiteur_nr = o.debiteur_nr
            AND NULLIF(TRIM(COALESCE(a.email, '')), '') IS NOT NULL
            AND _normaliseer_afleveradres(a.adres, a.postcode, a.land)
              = _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land)
       );

-- 4.2b afl_email fallback: algemeen klant-e-mailadres
UPDATE orders o
   SET afl_email = NULLIF(TRIM(COALESCE(d.email_overig, '')), '')
  FROM debiteuren d
 WHERE d.debiteur_nr = o.debiteur_nr
   AND NULLIF(TRIM(COALESCE(o.afl_email, '')), '') IS NULL
   AND o.status NOT IN ('Verzonden', 'Geannuleerd')
   AND COALESCE(o.debiteur_match_bron, '') <> 'env_fallback'
   AND NULLIF(TRIM(COALESCE(d.email_overig, '')), '') IS NOT NULL;

-- 4.3 Zending-snapshots bijwerken
UPDATE zendingen z
   SET afl_email = NULLIF(TRIM(COALESCE(o.afl_email, '')), '')
  FROM orders o
 WHERE o.id = z.order_id
   AND NULLIF(TRIM(COALESCE(z.afl_email, '')), '') IS NULL
   AND z.status NOT IN ('Onderweg', 'Afgeleverd')
   AND NULLIF(TRIM(COALESCE(o.afl_email, '')), '') IS NOT NULL;

NOTIFY pgrst, 'reload schema';
