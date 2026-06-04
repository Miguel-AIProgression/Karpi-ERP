-- Migratie 309: EDI-leverweek wordt voorstel — gewenste-datum-snapshot + gate
--
-- Probleem:
--   create_edi_order (mig 166) nam de door de partner meegestuurde leverdatum
--   1-op-1 over in orders.afleverdatum. Die week is een KLANTWENS, niet getoetst
--   op voorraad/inkoop. De order stroomde meteen door naar picken/productie.
--
-- Aanpak (alleen EDI):
--   1. Nieuwe kolom orders.edi_gewenste_afleverdatum = snapshot van de partner-wens
--      (verandert nooit; audit + UI-vergelijking "gewenst vs. haalbaar").
--   2. create_edi_order vult NAAST afleverdatum (=initieel voorstel, zodat de
--      allocator + mig 153 de haalbare datum vooruit kan schuiven) ook
--      edi_gewenste_afleverdatum. edi_bevestigd_op blijft NULL = "te bevestigen".
--   3. orders_list exposeert edi_bevestigd_op + edi_gewenste_afleverdatum zodat
--      de frontend het "Te bevestigen"-filter en de UI kan bouwen.
--   4. Backfill: bestaande EDI-orders die al in een late fase zitten of al een
--      orderbev hebben → edi_bevestigd_op = now() (niet opnieuw "te bevestigen");
--      edi_gewenste_afleverdatum = afleverdatum (best-effort snapshot).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION/VIEW.

-- ============================================================================
-- 1. Snapshot-kolom
-- ============================================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS edi_gewenste_afleverdatum DATE;

COMMENT ON COLUMN orders.edi_gewenste_afleverdatum IS
  'EDI-only: de door de handelspartner meegestuurde gewenste leverdatum '
  '(snapshot, verandert nooit). orders.afleverdatum mag hiervan afwijken zodra '
  'de allocator/mig 153 een haalbare datum berekent of een operator bij '
  'bevestiging corrigeert. NULL voor niet-EDI-orders of als de partner geen '
  'leverdatum meestuurde. Mig 309.';

-- ============================================================================
-- 2. create_edi_order — vult edi_gewenste_afleverdatum naast afleverdatum
--    (volledige herdefinitie van mig 166; enige verschil = de extra kolom)
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
  'functie OOK edi_gewenste_afleverdatum (= leverdatum-snapshot van de partner); de '
  'order blijft "te bevestigen" tot edi_bevestigd_op gezet is.';

-- ============================================================================
-- 3. orders_list — exposeer edi_bevestigd_op + edi_gewenste_afleverdatum
--    (volledige herdefinitie van mig 259; enige verschil = 2 extra kolommen)
-- ============================================================================
DROP VIEW IF EXISTS orders_list;

CREATE VIEW orders_list AS
WITH bundel_per_order AS (
  SELECT DISTINCT ON (zo.order_id)
    zo.order_id,
    z.id          AS zending_id,
    z.zending_nr  AS bundel_zending_nr,
    aantal_orders AS bundel_order_count
  FROM zending_orders zo
  JOIN zendingen z ON z.id = zo.zending_id
  JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS aantal_orders
      FROM zending_orders zo2
     WHERE zo2.zending_id = z.id
  ) cnt ON cnt.aantal_orders >= 2
  ORDER BY
    zo.order_id,
    CASE z.status
      WHEN 'Picken'                  THEN 1
      WHEN 'Klaar voor verzending'   THEN 2
      WHEN 'Onderweg'                THEN 3
      WHEN 'Afgeleverd'              THEN 4
      ELSE 5
    END,
    z.id
)
SELECT
  o.id,
  o.order_nr,
  o.oud_order_nr,
  o.debiteur_nr,
  o.klant_referentie,
  o.orderdatum,
  o.afleverdatum,
  o.status,
  o.aantal_regels,
  o.totaal_bedrag,
  o.totaal_gewicht,
  o.vertegenw_code,
  d.naam AS klant_naam,
  o.heeft_unmatched_regels,
  o.bron_systeem,
  o.bron_shop,
  o.lever_type,
  -- Mig 309: EDI-leverweek-bevestiging
  o.edi_bevestigd_op,
  o.edi_gewenste_afleverdatum,
  -- Mig 259: bundel-info — NULL voor solo-orders
  b.zending_id          AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. '
  'Sinds mig 244: lever_type. Sinds mig 259: bundel_zending_nr + bundel_order_count. '
  'Sinds mig 309: edi_bevestigd_op + edi_gewenste_afleverdatum voor het '
  '"Te bevestigen"-filter (EDI-orders met onbevestigde leverweek).';

-- ============================================================================
-- 4. Backfill — bestaande EDI-orders niet onterecht als "te bevestigen" tonen
-- ============================================================================
-- Snapshot de wens voor alle EDI-orders die er nog geen hebben.
UPDATE orders
   SET edi_gewenste_afleverdatum = afleverdatum
 WHERE bron_systeem = 'edi'
   AND edi_gewenste_afleverdatum IS NULL
   AND afleverdatum IS NOT NULL;

-- Markeer als bevestigd: orders die al een late fase bereikten of al een
-- (niet-geannuleerde) orderbev op de uitgaande wachtrij/verstuurd hebben.
UPDATE orders o
   SET edi_bevestigd_op = COALESCE(o.edi_bevestigd_op, now())
 WHERE o.bron_systeem = 'edi'
   AND o.edi_bevestigd_op IS NULL
   AND (
     o.status IN ('In pickronde', 'Deels verzonden', 'Verzonden', 'Klaar voor verzending')
     OR EXISTS (
       SELECT 1 FROM edi_berichten eb
        WHERE eb.order_id = o.id
          AND eb.richting = 'uit'
          AND eb.berichttype = 'orderbev'
          AND eb.status NOT IN ('Fout', 'Geannuleerd')
     )
   );

NOTIFY pgrst, 'reload schema';
