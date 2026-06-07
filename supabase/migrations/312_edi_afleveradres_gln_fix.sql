-- Migratie 312: EDI-afleveradres matcht niet door ".0"-GLN-artefact — fix + backfill
--
-- Probleem (2026-06-04):
--   EDI-orders van centrale-facturatie-ketens (BDSK/XXXLutz #600556 e.a.) kregen
--   ALLEMAAL hetzelfde afleveradres — namelijk het debiteur-hoofdadres — terwijl
--   de orders wel degelijk verschillende vestiging-GLN's meesturen (BDSK: 39
--   orders, 37 unieke aflever-GLN's, 1 plaats = WUERZBURG). Oorzaak in drie lagen:
--
--     1. afleveradressen.gln_afleveradres is via de Excel-import als FLOAT
--        ingelezen en met een ".0"-suffix in de TEXT-kolom opgeslagen
--        (bv. '9007019005225.0'). 60 van de 64 GLN-afleveradressen hebben dit
--        artefact; alleen de 4 handmatig (via koppel-widget) ingevoerde Hornbach-
--        adressen staan schoon — daarom werkte Hornbach (#361208) wél.
--     2. create_edi_order (mig 166/309) matcht het afleveradres EXACT
--        (gln_afleveradres = v_gln_afl), zónder de ".0"-tolerantie die
--        matchDebiteur (transus-poll) wél heeft. De binnenkomende GLN is schoon
--        ('9007019005225') → geen match → terugval op het debiteur-hoofdadres.
--        (De DEBITEUR-match werkt wél, want die loopt via matchDebiteur, die de
--        ".0"-variant meeneemt.)
--     3. create_edi_order is idempotent: een bestaande order wordt nooit
--        her-gesnapshot (zelfde mechaniek als de prijzen-backfill in mig 308),
--        dus het foute hoofdadres bleef staan.
--
-- Fix (3 delen, EDI-only impact):
--   1. Schoon het ".0"-artefact uit afleveradressen.gln_afleveradres.
--   2. Maak de afleveradres-lookup in create_edi_order ".0"-tolerant
--      (defense-in-depth — een toekomstige her-import zou het artefact anders
--      opnieuw introduceren; de import-fix zelf staat los hiervan).
--   3. Backfill: her-snapshot afl_* op bestaande EDI-orders waarvan de
--      afleveradres_gln nu een afleveradres matcht (analoog aan mig 308). Orders
--      in een actieve/afgeronde bundel-zending worden overgeslagen (mig 230-lock:
--      hun pakbon is al naar buiten; afl_*-mutatie is daar verboden én ongewenst).
--
-- Idempotent: cleanup met LIKE-guard, CREATE OR REPLACE FUNCTION, backfill met
-- IS DISTINCT FROM-guard.

-- ============================================================================
-- 1. ".0"-artefact opschonen uit afleveradressen.gln_afleveradres
-- ============================================================================
UPDATE afleveradressen
   SET gln_afleveradres = left(gln_afleveradres, length(gln_afleveradres) - 2)
 WHERE gln_afleveradres LIKE '%.0';

-- ============================================================================
-- 2. create_edi_order — afleveradres-lookup ".0"-tolerant maken
--    (volledige herdefinitie van mig 309; enige verschil = de IN-clausule in de
--     afleveradres-SELECT)
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
    'edi', v_transactie_id, 'Nieuw'
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
  'niet terugvalt op het debiteur-hoofdadres.';

-- ============================================================================
-- 3. Backfill — her-snapshot afl_* op bestaande EDI-orders die nu matchen
-- ============================================================================
-- Spiegelt exact de afleveradres-snapshot uit create_edi_order: match op
-- (debiteur_nr, afleveradres_gln) — ".0"-tolerant — en zet afl_* uit het
-- afleveradres. Alleen waar het werkelijk afwijkt (IS DISTINCT FROM) en de order
-- niet in een actieve/afgeronde bundel-zending zit (mig 230-lock; die pakbon is al
-- naar buiten). Orders waarvan de afleveradres_gln nog GEEN afleveradres matcht
-- (vestiging niet in de tabel) blijven op het hoofdadres staan tot de vestiging
-- gekoppeld is.
UPDATE orders o
   SET afl_naam     = a.naam,
       afl_adres    = a.adres,
       afl_postcode = a.postcode,
       afl_plaats   = a.plaats,
       afl_land     = COALESCE(a.land, 'NL')
  FROM afleveradressen a
 WHERE o.bron_systeem = 'edi'
   AND o.afleveradres_gln IS NOT NULL
   AND a.debiteur_nr = o.debiteur_nr
   AND a.gln_afleveradres IN (o.afleveradres_gln, o.afleveradres_gln || '.0')
   AND (
        o.afl_naam     IS DISTINCT FROM a.naam
     OR o.afl_adres    IS DISTINCT FROM a.adres
     OR o.afl_postcode IS DISTINCT FROM a.postcode
     OR o.afl_plaats   IS DISTINCT FROM a.plaats
     OR o.afl_land     IS DISTINCT FROM COALESCE(a.land, 'NL')
   )
   AND NOT EXISTS (
     SELECT 1 FROM zending_orders zo
       JOIN zendingen z ON z.id = zo.zending_id
      WHERE zo.order_id = o.id
        AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
   )
   AND NOT EXISTS (
     SELECT 1 FROM zendingen z
      WHERE z.order_id = o.id
        AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
   );

NOTIFY pgrst, 'reload schema';
