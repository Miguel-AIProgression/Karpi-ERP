-- Migratie 159: betere artikel-matching voor EDI-orders
--
-- Probleem (gevonden 2026-04-29 bij eerste demo-test):
--   create_edi_order matcht artikelcode 1-op-1 tegen `producten.artikelnr`. Bij
--   echte EDI-orders is de artikelcode echter samengesteld:
--     "526650044 155x230"   (productcode + afmetingen)
--     "526650046 rund 160"
--     "526920037"           (alleen productcode, geen suffix)
--   Het deel vóór de eerste spatie is de feitelijke productcode in het Karpi-
--   systeem. Het deel erná is verrijking (afmetingen, vorm, kleur).
--
-- Fix:
--   Nieuwe helper `match_edi_artikel(p_gtin, p_artikelcode)` die in volgorde
--   probeert:
--     1. GTIN → producten.ean_code (exact)
--     2. artikelcode (volledig) → producten.artikelnr (exact, voor de "geen-spatie"-vorm)
--     3. eerste-token van artikelcode → producten.artikelnr (split op spatie)
--   Returnt artikelnr + omschrijving + verkoopprijs van eerste hit, of NULL.
--
-- create_edi_order wordt opnieuw geCREATE'd om deze helper te gebruiken.
-- Idempotent.

-- ============================================================================
-- Helper: match_edi_artikel
-- ============================================================================
CREATE OR REPLACE FUNCTION match_edi_artikel(
  p_gtin        TEXT,
  p_artikelcode TEXT
) RETURNS TABLE(
  artikelnr     TEXT,
  omschrijving  TEXT,
  verkoopprijs  NUMERIC
) AS $$
DECLARE
  v_eerste_token TEXT;
BEGIN
  -- 1. GTIN-match
  IF p_gtin IS NOT NULL AND p_gtin <> '' THEN
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.ean_code = p_gtin
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2. Volledige artikelcode → artikelnr (als de code geen spatie bevat)
  IF p_artikelcode IS NOT NULL AND p_artikelcode <> '' THEN
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.artikelnr = p_artikelcode
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 3. Eerste token (vóór spatie) → artikelnr
    v_eerste_token := split_part(p_artikelcode, ' ', 1);
    IF v_eerste_token <> '' AND v_eerste_token <> p_artikelcode THEN
      RETURN QUERY
      SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
        FROM producten p
       WHERE p.artikelnr = v_eerste_token
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;
    END IF;
  END IF;

  -- Geen match
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION match_edi_artikel(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION match_edi_artikel IS
  'Drie-staps artikel-matching voor inkomende EDI-orderregels: '
  '1) GTIN → ean_code, 2) volledige artikelcode → artikelnr, '
  '3) eerste token (vóór spatie) → artikelnr. Migratie 159.';

-- ============================================================================
-- create_edi_order — herdefinieer met nieuwe matching-helper
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
  v_afl_naam         TEXT;
  v_afl_adres        TEXT;
  v_afl_postcode     TEXT;
  v_afl_plaats       TEXT;
  v_afl_land         TEXT;
  v_transactie_id    TEXT;
  v_is_test          BOOLEAN;
  r                  JSONB;
  v_regelnr          INTEGER := 0;
  v_match            RECORD;
  v_aantal           INTEGER;
  v_omschrijving     TEXT;
BEGIN
  SELECT transactie_id, is_test
    INTO v_transactie_id, v_is_test
    FROM edi_berichten
   WHERE id = p_inkomend_bericht_id;

  IF v_transactie_id IS NULL THEN
    RAISE EXCEPTION 'edi_berichten id=% niet gevonden of geen transactie_id', p_inkomend_bericht_id;
  END IF;

  -- Idempotentie
  SELECT id INTO v_existing_id
    FROM orders
   WHERE bron_systeem = 'edi'
     AND bron_order_id = v_transactie_id;
  IF v_existing_id IS NOT NULL THEN
    UPDATE edi_berichten SET order_id = v_existing_id WHERE id = p_inkomend_bericht_id;
    RETURN v_existing_id;
  END IF;

  -- Debiteur-snapshot
  IF p_debiteur_nr IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land,
           COALESCE(fact_naam, naam),
           COALESCE(fact_adres, adres),
           COALESCE(fact_postcode, postcode),
           COALESCE(fact_plaats, plaats)
      INTO v_deb_naam, v_deb_adres, v_deb_postcode, v_deb_plaats, v_deb_land,
           v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats
      FROM debiteuren
     WHERE debiteur_nr = p_debiteur_nr;
  END IF;

  -- Afleveradres-record op basis van GLN
  IF p_debiteur_nr IS NOT NULL AND v_gln_afl IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land
      INTO v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, v_afl_land
      FROM afleveradressen
     WHERE debiteur_nr = p_debiteur_nr
       AND gln_afleveradres = v_gln_afl
     LIMIT 1;
  END IF;

  IF v_afl_naam IS NULL THEN
    v_afl_naam := v_deb_naam;
    v_afl_adres := v_deb_adres;
    v_afl_postcode := v_deb_postcode;
    v_afl_plaats := v_deb_plaats;
    v_afl_land := v_deb_land;
  END IF;

  v_ordernr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr, debiteur_nr, klant_referentie,
    orderdatum, afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    factuuradres_gln, besteller_gln, afleveradres_gln,
    bron_systeem, bron_order_id, status
  ) VALUES (
    v_ordernr, p_debiteur_nr, v_klantref,
    v_orderdatum, v_leverdatum,
    v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats, COALESCE(v_deb_land, 'NL'),
    NULLIF(v_header->>'afnemer_naam', ''), NULL, NULL, NULL, NULL,
    v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, COALESCE(v_afl_land, 'NL'),
    v_gln_gefact, v_gln_best, v_gln_afl,
    'edi', v_transactie_id, 'Nieuw'
  )
  RETURNING id INTO v_order_id;

  -- Regels: drie-staps matching via match_edi_artikel
  FOR r IN SELECT * FROM jsonb_array_elements(v_regels)
  LOOP
    v_regelnr := v_regelnr + 1;
    v_aantal := COALESCE((r->>'aantal')::NUMERIC::INTEGER, 1);

    SELECT * INTO v_match
      FROM match_edi_artikel(r->>'gtin', r->>'artikelcode');

    IF v_match.artikelnr IS NULL THEN
      -- Ongematcht — bewaar de raw artikelcode + GTIN als debug-info in omschrijving
      v_omschrijving := '[EDI ongematcht: ' ||
        COALESCE(NULLIF(r->>'artikelcode', ''), r->>'gtin', '?') || ']';
    ELSE
      v_omschrijving := COALESCE(v_match.omschrijving, v_match.artikelnr);
    END IF;

    INSERT INTO order_regels (
      order_id, regelnummer,
      artikelnr, omschrijving,
      orderaantal, te_leveren,
      prijs, bedrag
    ) VALUES (
      v_order_id, v_regelnr,
      v_match.artikelnr,
      v_omschrijving,
      v_aantal, v_aantal,
      v_match.verkoopprijs,
      COALESCE(v_match.verkoopprijs * v_aantal, 0)
    );
  END LOOP;

  UPDATE edi_berichten SET order_id = v_order_id WHERE id = p_inkomend_bericht_id;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_edi_order IS
  'Maakt een order + regels aan op basis van een geparseerde inkomende EDI-payload. '
  'Idempotent op (bron_systeem=edi, bron_order_id=TransactionID). Gebruikt '
  'match_edi_artikel voor drie-staps GTIN→ean / artikelcode→artikelnr / token→artikelnr-matching. '
  'Migratie 158, herdefinieerd in 159.';
