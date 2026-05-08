-- Migratie 227: genereer_factuur — guard tegen lege facturen bij dubbele aanroep
--
-- Productie-incident 2026-05-08: race-condition in [`factuur-verzenden`](../functions/factuur-verzenden/index.ts)
-- (SELECT pending → UPDATE processing zonder atomic claim) zorgde dat dezelfde
-- queue-rij N keer werd verwerkt. `genereer_factuur` (mig 119/124) maakte de
-- factuur-header onvoorwaardelijk aan, en filterde regels pas daarna op
-- `gefactureerd < orderaantal` — bij de tweede aanroep waren alle regels al
-- gefactureerd, dus 0 regel-rijen ingevoegd, en bleef er een lege €0,00
-- factuur achter. Resultaat: 7 echte facturen + 14 lege duplicaten.
--
-- Fix: tel eerst de te-factureren regels. Bij 0 → RAISE EXCEPTION, dus geen
-- header en de drain markeert de queue-rij als 'failed' (recovery vangt op).
--
-- De aanroeper (drain) wordt in een aparte change idempotent gemaakt met
-- `FOR UPDATE SKIP LOCKED`. Beide samen sluiten het lek aan beide kanten.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION genereer_factuur(p_order_ids BIGINT[])
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id BIGINT;
  v_factuur_nr TEXT;
  v_debiteur_nr INTEGER;
  v_debiteur debiteuren%ROWTYPE;
  v_subtotaal NUMERIC(12,2);
  v_btw_pct NUMERIC(5,2);
  v_btw_bedrag NUMERIC(12,2);
  v_totaal NUMERIC(12,2);
  v_betaaltermijn_dagen INTEGER := 30;
  v_aantal_te_factureren INTEGER;
BEGIN
  IF array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_order_ids mag niet leeg zijn';
  END IF;

  SELECT DISTINCT debiteur_nr INTO v_debiteur_nr
    FROM orders WHERE id = ANY(p_order_ids);
  IF v_debiteur_nr IS NULL THEN
    RAISE EXCEPTION 'Geen orders gevonden voor ids %', p_order_ids;
  END IF;
  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(p_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Orders behoren niet tot dezelfde debiteur';
  END IF;

  -- Mig 227-guard: tel te-factureren regels VÓÓR header-INSERT.
  -- Voorkomt lege duplicaat-header bij N-de aanroep waar alles al gefactureerd is.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(p_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal;

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Order(s) % zijn al volledig gefactureerd — geen regels te factureren', p_order_ids
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_debiteur_nr;

  v_btw_pct := COALESCE(v_debiteur.btw_percentage, 21.00);

  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer
  ) VALUES (
    v_factuur_nr, v_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer
  ) RETURNING id INTO v_factuur_id;

  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(p_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
    SET gefactureerd = orderaantal
  WHERE order_id = ANY(p_order_ids)
    AND COALESCE(gefactureerd, 0) < orderaantal;

  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
    SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
  WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION genereer_factuur(BIGINT[]) IS
  'Mig 227 (no-op guard): genereert factuur + regels voor order_ids. Faalt met '
  'no_data_found als er geen te-factureren regels (meer) zijn — voorkomt lege '
  'duplicaat-headers bij dubbele aanroep van de drain. Aanroeper moet de '
  'exception vangen en de queue-rij op failed of done markeren.';

-- ==========================================================================
-- Atomaire queue-claim — voorkomt race-condition aan de drain-kant
-- ==========================================================================
-- De drain-edge-function deed `SELECT pending → UPDATE processing` in twee
-- aparte calls. Tussen die twee kan een parallelle drain (cron + handmatig)
-- dezelfde rij claimen. Deze RPC doet het in één UPDATE met `FOR UPDATE SKIP
-- LOCKED`: rijen die al door een andere transactie zijn vastgepakt worden
-- overgeslagen, dus geen dubbele claim mogelijk.

CREATE OR REPLACE FUNCTION claim_factuur_queue_items(p_max_batch INTEGER DEFAULT 10)
RETURNS TABLE (
  id BIGINT,
  debiteur_nr INTEGER,
  order_ids BIGINT[],
  type TEXT,
  attempts INTEGER
)
LANGUAGE sql
AS $$
  UPDATE factuur_queue q
     SET status = 'processing',
         processing_started_at = now()
   WHERE q.id IN (
     SELECT inner_q.id
       FROM factuur_queue inner_q
      WHERE inner_q.status = 'pending'
      ORDER BY inner_q.created_at ASC
      LIMIT p_max_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.debiteur_nr, q.order_ids, q.type, q.attempts;
$$;

GRANT EXECUTE ON FUNCTION claim_factuur_queue_items(INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION claim_factuur_queue_items(INTEGER) IS
  'Mig 227: atomair claimen van pending factuur_queue rijen via FOR UPDATE '
  'SKIP LOCKED. Vervangt SELECT-then-UPDATE in de drain-function. Parallelle '
  'aanroepen (cron + handmatig) kunnen dezelfde rij niet meer dubbel pakken.';

NOTIFY pgrst, 'reload schema';
