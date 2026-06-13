-- Migratie 357: schone herdefinitie create_edi_order — status 'Klaar voor picken'
-- (NB: op 2026-06-10 toegepast als "mig 355", vóór hernummering wegens collisie
--  met 355_sync_afleverdatum_maatwerk_afgerond_eindstatus op main — de NOTICE-teksten in de
--  DB-historie dragen het oude nummer. Inhoud identiek, geen her-run nodig.)
--
-- Regressie: mig 275 patchte de status-literal 'Nieuw' -> 'Klaar voor picken'
-- via pg_get_functiondef+REPLACE; mig 309 en 312 herdefinieerden de functie
-- daarna met de OUDE literal terug -> EDI-orders landen sinds mig 309/312 op de
-- dode status 'Nieuw'. Zelf-helend zodra een orderregel-trigger
-- herbereken_wacht_status aanroept (ladder-regel 5 kent 'Nieuw'), maar
-- create_edi_order zelf doet dat niet -> orders kunnen blijven hangen.
--
-- Fix: volledige herdefinitie (body = mig 312 r49-214, één regel gewijzigd) +
-- eenmalige backfill die hangende 'Nieuw'-EDI-orders door de ladder haalt.
-- Geen REPLACE-truc meer: de volgende herdefinieerder ziet de juiste literal
-- gewoon in dit bestand staan.
--
-- Idempotent: CREATE OR REPLACE; backfill is no-op als er niets hangt.

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
           COALESCE(korting_pct, 0)
      INTO v_deb_naam, v_deb_adres, v_deb_postcode, v_deb_plaats, v_deb_land,
           v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats,
           v_prijslijst_nr, v_korting_pct
      FROM debiteuren
     WHERE debiteur_nr = p_debiteur_nr;
  END IF;

  -- Mig 312: ".0"-tolerant — de afleveradres-GLN kan in de DB nog het Excel-
  -- float-artefact dragen, terwijl de binnenkomende GLN schoon is (en vice versa).
  IF p_debiteur_nr IS NOT NULL AND v_gln_afl IS NOT NULL THEN
    SELECT naam, adres, postcode, plaats, land
      INTO v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, v_afl_land
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

  v_ordernr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr, debiteur_nr, klant_referentie,
    orderdatum, afleverdatum, edi_gewenste_afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land,
    afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
    factuuradres_gln, besteller_gln, afleveradres_gln,
    bron_systeem, bron_order_id, status
  ) VALUES (
    v_ordernr, p_debiteur_nr, v_klantref,
    v_orderdatum, v_leverdatum, v_leverdatum,
    v_fact_naam, v_fact_adres, v_fact_postcode, v_fact_plaats, COALESCE(v_deb_land, 'NL'),
    NULLIF(v_header->>'afnemer_naam', ''), NULL, NULL, NULL, NULL,
    v_afl_naam, v_afl_adres, v_afl_postcode, v_afl_plaats, COALESCE(v_afl_land, 'NL'),
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
  '".0"-tolerant (Excel-float-artefact in gln_afleveradres) zodat de vestiging-match '
  'niet terugvalt op het debiteur-hoofdadres. Mig 357: status-literal definitief '
  'Klaar voor picken (regressie mig 309/312 hersteld).';

-- Zelf-test: de dode literal is weg, de juiste staat erin.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('create_edi_order(bigint, jsonb, integer)'::regprocedure);
BEGIN
  IF v_def LIKE $marker$%'edi', v_transactie_id, 'Nieuw'%$marker$ THEN
    RAISE EXCEPTION 'Mig 357: create_edi_order bevat nog de dode status-literal Nieuw';
  END IF;
  IF v_def NOT LIKE $marker$%'edi', v_transactie_id, 'Klaar voor picken'%$marker$ THEN
    RAISE EXCEPTION 'Mig 357: create_edi_order bevat de Klaar voor picken-literal niet';
  END IF;
  RAISE NOTICE 'Mig 357: create_edi_order zet Klaar voor picken';
END $$;

-- Eenmalige backfill: haal hangende 'Nieuw'-EDI-orders door de ladder
-- (ladder-regel 5: 'Nieuw' zonder blokkades -> 'Klaar voor picken'; met
-- claims/tekorten -> passende wacht-status). Via herbereken_wacht_status,
-- dus door _apply_transitie met audit-trail.
DO $$
DECLARE
  v_id BIGINT;
  v_n  INTEGER := 0;
BEGIN
  FOR v_id IN SELECT id FROM orders WHERE status = 'Nieuw' AND bron_systeem = 'edi'
  LOOP
    PERFORM herbereken_wacht_status(v_id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Mig 357: % hangende Nieuw-EDI-order(s) herberekend', v_n;
END $$;

NOTIFY pgrst, 'reload schema';
