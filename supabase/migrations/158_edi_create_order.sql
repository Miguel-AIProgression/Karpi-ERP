-- Migratie 158: EDI fase 2 — order-creatie + bevestig-veld
--
-- Bouwt voort op mig 156–157 (datamodel + queue). Voegt toe:
--   1. Veld `orders.edi_bevestigd_op` — wanneer de orderbev via EDI is verstuurd
--   2. RPC `create_edi_order(p_inkomend_bericht_id, p_payload_parsed, p_debiteur_nr)`
--      — maakt order + regels uit een geparseerde inkomende EDI-payload, koppelt
--      het bron-bericht aan het order_id.
--
-- Plan: docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md
--
-- Idempotent.

-- ============================================================================
-- 1. Bevestiging-spoor op orders
-- ============================================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS edi_bevestigd_op TIMESTAMPTZ;

COMMENT ON COLUMN orders.edi_bevestigd_op IS
  'Tijdstip waarop voor deze order een EDI-orderbevestiging is verstuurd '
  '(of in de wachtrij geplaatst). NULL = nog niet bevestigd. Voorkomt dubbele '
  'orderbevestigingen bij retries en is de gate voor de Bevestig-knop in de UI.';

-- ============================================================================
-- 2. create_edi_order — atomic insert van EDI-order + regels
--
-- Input p_payload_parsed:
--   {
--     "header": {
--       "ordernummer": "WMZCGB",
--       "leverdatum": "2026-05-22",
--       "orderdatum": "2026-04-28",
--       "afnemer_naam": null,
--       "gln_gefactureerd": "9007019015989",
--       "gln_besteller": "9009852030365",
--       "gln_afleveradres": "9009852030365",
--       "gln_leverancier": "8715954999998",
--       ...
--     },
--     "regels": [
--       { "regelnummer": 1, "gtin": "8715954176047", "artikelcode": "PATCH",
--         "aantal": 1, "ordernummer_ref": "WMZCGB" },
--       ...
--     ]
--   }
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
  -- Snapshots uit debiteur (fallback als geen specifiek afleveradres-record gevonden)
  v_deb_naam         TEXT;
  v_deb_adres        TEXT;
  v_deb_postcode     TEXT;
  v_deb_plaats       TEXT;
  v_deb_land         TEXT;
  v_fact_naam        TEXT;
  v_fact_adres       TEXT;
  v_fact_postcode    TEXT;
  v_fact_plaats      TEXT;
  -- Afleveradres-record (gln-match) indien beschikbaar
  v_afl_naam         TEXT;
  v_afl_adres        TEXT;
  v_afl_postcode     TEXT;
  v_afl_plaats       TEXT;
  v_afl_land         TEXT;
  v_transactie_id    TEXT;
  v_is_test          BOOLEAN;
  r                  JSONB;
  v_regelnr          INTEGER := 0;
  v_artikelnr        TEXT;
  v_omschrijving     TEXT;
  v_verkoopprijs     NUMERIC;
BEGIN
  -- Get the bericht-context (transactie_id voor idempotentie + is_test)
  SELECT transactie_id, is_test
    INTO v_transactie_id, v_is_test
    FROM edi_berichten
   WHERE id = p_inkomend_bericht_id;

  IF v_transactie_id IS NULL THEN
    RAISE EXCEPTION 'edi_berichten id=% niet gevonden of geen transactie_id', p_inkomend_bericht_id;
  END IF;

  -- Idempotentie: zelfde transactie_id → bestaande order returnen, géén nieuwe maken.
  SELECT id INTO v_existing_id
    FROM orders
   WHERE bron_systeem = 'edi'
     AND bron_order_id = v_transactie_id;
  IF v_existing_id IS NOT NULL THEN
    -- Koppel bestaande order_id aan dit bericht voor dubbele inserts
    UPDATE edi_berichten SET order_id = v_existing_id WHERE id = p_inkomend_bericht_id;
    RETURN v_existing_id;
  END IF;

  -- Debiteur-snapshot voor factuur- en backup-afleveradres
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

  -- Afleveradres-record op basis van gln_afleveradres (indien debiteur bekend)
  IF p_debiteur_nr IS NOT NULL AND v_gln_afl IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land
      INTO v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, v_afl_land
      FROM afleveradressen
     WHERE debiteur_nr = p_debiteur_nr
       AND gln_afleveradres = v_gln_afl
     LIMIT 1;
  END IF;

  -- Fallback afleveradres: naam uit debiteur, geen specifiek adres
  IF v_afl_naam IS NULL THEN
    v_afl_naam     := v_deb_naam;
    v_afl_adres    := v_deb_adres;
    v_afl_postcode := v_deb_postcode;
    v_afl_plaats   := v_deb_plaats;
    v_afl_land     := v_deb_land;
  END IF;

  -- Genereer ORD-nummer
  v_ordernr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr,
    debiteur_nr,
    klant_referentie,
    orderdatum,
    afleverdatum,
    -- Factuuradres-snapshot (uit debiteur)
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    -- Besteller-snapshot (NAD+BY) — naam uit header indien gegeven, anders niets
    bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land,
    -- Afleveradres-snapshot
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    -- GLN-velden
    factuuradres_gln, besteller_gln, afleveradres_gln,
    -- Bron-tracking
    bron_systeem, bron_order_id,
    status
  ) VALUES (
    v_ordernr,
    p_debiteur_nr,
    v_klantref,
    v_orderdatum,
    v_leverdatum,
    v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats, COALESCE(v_deb_land, 'NL'),
    NULLIF(v_header->>'afnemer_naam', ''), NULL, NULL, NULL, NULL,
    v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, COALESCE(v_afl_land, 'NL'),
    v_gln_gefact, v_gln_best, v_gln_afl,
    'edi', v_transactie_id,
    'Nieuw'
  )
  RETURNING id INTO v_order_id;

  -- Regels: GTIN → ean_code matching, fallback op artikelcode → artikelnr.
  FOR r IN SELECT * FROM jsonb_array_elements(v_regels)
  LOOP
    v_regelnr := v_regelnr + 1;
    v_artikelnr := NULL;
    v_omschrijving := r->>'artikelcode';
    v_verkoopprijs := NULL;

    -- Match 1: GTIN → producten.ean_code
    IF (r->>'gtin') IS NOT NULL AND (r->>'gtin') <> '' THEN
      SELECT artikelnr, omschrijving, verkoopprijs
        INTO v_artikelnr, v_omschrijving, v_verkoopprijs
        FROM producten
       WHERE ean_code = r->>'gtin'
       LIMIT 1;
    END IF;

    -- Match 2: artikelcode → producten.artikelnr (rauwe match — alleen als GTIN miste)
    IF v_artikelnr IS NULL AND (r->>'artikelcode') IS NOT NULL THEN
      SELECT artikelnr, omschrijving, verkoopprijs
        INTO v_artikelnr, v_omschrijving, v_verkoopprijs
        FROM producten
       WHERE artikelnr = r->>'artikelcode'
       LIMIT 1;
    END IF;

    INSERT INTO order_regels (
      order_id,
      regelnummer,
      artikelnr,
      omschrijving,
      orderaantal,
      te_leveren,
      prijs,
      bedrag
    ) VALUES (
      v_order_id,
      v_regelnr,
      v_artikelnr,
      COALESCE(v_omschrijving, '[EDI ongematcht: ' || COALESCE(r->>'gtin', r->>'artikelcode', '?') || ']'),
      COALESCE((r->>'aantal')::NUMERIC::INTEGER, 1),
      COALESCE((r->>'aantal')::NUMERIC::INTEGER, 1),
      v_verkoopprijs,
      COALESCE(v_verkoopprijs * COALESCE((r->>'aantal')::NUMERIC, 1), 0)
    );
  END LOOP;

  -- Koppel het bron-bericht aan dit order_id
  UPDATE edi_berichten SET order_id = v_order_id WHERE id = p_inkomend_bericht_id;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_edi_order(BIGINT, JSONB, INTEGER) TO authenticated;

COMMENT ON FUNCTION create_edi_order IS
  'Maakt een order + regels aan op basis van een geparseerde inkomende EDI-payload. '
  'Idempotent op (bron_systeem=edi, bron_order_id=TransactionID). Koppelt het '
  'edi_berichten-rij terug naar de aangemaakte order via order_id.';

-- ============================================================================
-- 3. markeer_order_edi_bevestigd
--
-- Wordt aangeroepen door de UI-knop "Bevestigen" op de bericht-detail pagina.
-- Zet `orders.edi_bevestigd_op` op now() — voorkomt dubbele bevestigingen.
-- De UI bouwt vervolgens de orderbev-payload en plaatst hem op de wachtrij.
-- ============================================================================
CREATE OR REPLACE FUNCTION markeer_order_edi_bevestigd(p_order_id BIGINT)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  UPDATE orders
     SET edi_bevestigd_op = v_now
   WHERE id = p_order_id
     AND edi_bevestigd_op IS NULL;

  -- Als de UPDATE geen rij raakte: orde was al bevestigd → return de bestaande timestamp
  IF NOT FOUND THEN
    SELECT edi_bevestigd_op INTO v_now FROM orders WHERE id = p_order_id;
  END IF;

  RETURN v_now;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION markeer_order_edi_bevestigd(BIGINT) TO authenticated;

COMMENT ON FUNCTION markeer_order_edi_bevestigd IS
  'Markeert een order als EDI-bevestigd. Idempotent: returnt de bestaande timestamp '
  'als de order al bevestigd was. UI bouwt vervolgens de orderbev-payload via de '
  'TypeScript-builder en queue''t hem in edi_berichten.';
