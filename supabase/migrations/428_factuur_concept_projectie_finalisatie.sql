-- Migratie 428: factuur concept-fase — projecteer + finaliseer splitsing
--
-- Sinds mig 423 wordt een per_zending-factuur PAS na de 2-uur-verzendvertraging
-- aangemaakt (genereer_factuur_voor_bundel op claim-tijd). Gevolg: in dat venster
-- staat er NIETS in de facturatie-module. Gebruiker wil de factuur direct als
-- CONCEPT zien, e-mail/EDI pas na de vertraging, en order-correcties in het
-- venster moeten automatisch meegaan ("herbouwen bij verzenden").
--
-- Probleem: genereer_factuur_voor_bundel (mig 341) is NIET herhaalbaar — hij doet
-- bij aanmaak twee onomkeerbare side-effects op de order:
--   (1) UPDATE order_regels SET gefactureerd = orderaantal
--   (2) INSERT INTO order_regels van BUNDELKORTING/DREMPELKORTING-regels
-- Een tweede aanroep faalt (no_data_found). Daarom splitsen we de RPC:
--
--   · projecteer_concept_factuur(zending, [factuur_id]) — HERHAALBAAR, géén
--     side-effects. Bouwt/ververst de Concept-factuur + factuur_regels puur uit
--     de actuele order. = mig-341-body MINUS de twee side-effect-stukken, met
--     conditionele header (nieuw of hergebruik+DELETE regels).
--   · finaliseer_concept_factuur(zending, factuur_id) — EENMALIG. Herprojecteert
--     (verse regels uit de actuele order → correcties gaan mee), past dán de
--     side-effects toe: flip gefactureerd + spiegelt de korting-FACTUURregels
--     1-op-1 naar korting-ORDERregels (reproduceert mig 341 deel 3a/3b exact).
--
-- Drain-orchestratie (edge function factuur-verzenden, aparte slice):
--   Fase 1 (geen delay): verwerk_concept_queue() projecteert concepten voor
--     nieuwe pending-rijen (race-safe, DB-side FOR UPDATE SKIP LOCKED).
--   Fase 2 (delay-gate): claim_factuur_queue_items() claimt alleen rijen mét
--     concept (of legacy zonder zending) die beschikbaar zijn → finaliseer + mail.
--
-- Retry-veiligheid: factuur_queue.gefinaliseerd_op voorkomt dubbel-finaliseren
-- wanneer de mail faalt ná een geslaagde finalisatie (gefactureerd is dan al
-- vol → een tweede projectie-rebuild zou 0 regels vinden → no_data_found).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE.
-- VOORWAARDE: mig 341 (genereer_factuur_voor_bundel V2) + mig 423 (beschikbaar_op).

------------------------------------------------------------------------
-- 1. gefinaliseerd_op-vlag op factuur_queue
------------------------------------------------------------------------
ALTER TABLE factuur_queue
  ADD COLUMN IF NOT EXISTS gefinaliseerd_op TIMESTAMPTZ;

COMMENT ON COLUMN factuur_queue.gefinaliseerd_op IS
  'Mig 428: moment waarop finaliseer_concept_factuur de side-effects (flip + '
  'korting-orderregels) heeft toegepast. NULL = nog niet gefinaliseerd. De drain '
  'roept finaliseer alleen aan als dit NULL is; bij mail-retry wordt de bestaande '
  'factuur enkel opnieuw gemaild (geen tweede finalisatie → geen order-corruptie).';

------------------------------------------------------------------------
-- 2. projecteer_concept_factuur — herhaalbaar, GEEN side-effects
------------------------------------------------------------------------
-- = mig 341 body, met:
--   · p_factuur_id NULL → nieuwe Concept-header; anders hergebruik + DELETE regels
--   · GEEN `UPDATE order_regels SET gefactureerd` (flip → finaliseer)
--   · GEEN `INSERT INTO order_regels` van korting-regels (→ finaliseer, gespiegeld)
-- De korting-FACTUURregels (DREMPELKORTING/BUNDELKORTING op de factuur) blijven
-- hier — ze horen op de factuur, concept én finaal.
CREATE OR REPLACE FUNCTION projecteer_concept_factuur(
  p_zending_id BIGINT,
  p_factuur_id BIGINT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_zending              zendingen%ROWTYPE;
  v_debiteur             debiteuren%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_bundel_subtotaal     NUMERIC(12,2);
  v_is_afhalen           BOOLEAN;
  v_vk                   RECORD;
BEGIN
  IF p_zending_id IS NULL THEN
    RAISE EXCEPTION 'p_zending_id is verplicht';
  END IF;

  SELECT * INTO v_zending FROM zendingen WHERE id = p_zending_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zending % bestaat niet', p_zending_id;
  END IF;

  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Zending % heeft geen gekoppelde orders', p_zending_id;
  END IF;

  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(v_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Bundel-zending % kruist debiteur-grens (orders %)',
      p_zending_id, v_order_ids;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren
   WHERE debiteur_nr = (SELECT DISTINCT debiteur_nr FROM orders WHERE id = ANY(v_order_ids));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geen debiteur voor orders %', v_order_ids;
  END IF;

  v_btw_pct := COALESCE(v_debiteur.btw_percentage, 21.00);
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);

  -- No-op-guard (mig 341): faal vroeg als alle regels al gefactureerd zijn.
  -- Bij projectie is de flip nog niet gedaan, dus dit telt de nog-open regels.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Zending % heeft geen te-factureren regels', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Header: nieuw Concept of hergebruik (verse rebuild op bestaande factuur_id).
  IF p_factuur_id IS NULL THEN
    v_factuur_nr := volgend_nummer('FACT');
    INSERT INTO facturen (
      factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
      subtotaal, btw_percentage, btw_bedrag, totaal,
      fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer
    ) VALUES (
      v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
      CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
      0, v_btw_pct, 0, 0,
      COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      v_debiteur.land,
      v_debiteur.btw_nummer
    ) RETURNING id INTO v_factuur_id;
  ELSE
    v_factuur_id := p_factuur_id;
    -- Verse rebuild: wis de oude regels, herwaardeer de header-meta die in het
    -- venster gewijzigd kan zijn (btw/termijn/adres-snapshot). factuurdatum
    -- blijft de concept-datum.
    DELETE FROM factuur_regels WHERE factuur_id = v_factuur_id;
    UPDATE facturen SET
      btw_percentage = v_btw_pct,
      vervaldatum    = factuurdatum + v_betaaltermijn_dagen,
      fact_naam      = COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      fact_adres     = COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      fact_postcode  = COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      fact_plaats    = COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      fact_land      = v_debiteur.land,
      btw_nummer     = v_debiteur.btw_nummer
     WHERE id = v_factuur_id;
  END IF;

  -- Product- + VERZEND-orderregels (1 factuur-regel per order x regel).
  -- BUNDELKORTING/DREMPELKORTING uitsluiten — die voegen we (als FACTUUR-regels)
  -- hieronder gespreid toe. GEEN flip van order_regels.gefactureerd (→ finaliseer).
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
  WHERE orr.order_id = ANY(v_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING')
  ORDER BY orr.order_id, orr.regelnummer;

  -- Verzendkosten-status (mig 234) — bepaalt of DREMPELKORTING van toepassing is.
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    INTO v_bundel_subtotaal
    FROM factuur_regels
   WHERE factuur_id = v_factuur_id
     AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');

  SELECT BOOL_OR(COALESCE(o.afhalen, FALSE))
    INTO v_is_afhalen
    FROM orders o
   WHERE o.id = ANY(v_order_ids);

  SELECT * INTO v_vk
    FROM verzendkosten_voor_bundel(v_debiteur.debiteur_nr, v_bundel_subtotaal, v_is_afhalen);

  -- Korting-FACTUURregels gespreid per order (mig 341 deel 1+2). De ORDERregel-
  -- spiegeling (deel 3a/3b) verhuist naar finaliseer_concept_factuur.
  DECLARE
    v_aantal_verzend_regels   INTEGER;
    v_verzendkosten_per_order NUMERIC(8,2);
    v_korting_regelnr         INTEGER;
    v_order_idx               INTEGER;
    v_target_order_id         BIGINT;
    v_target_order_nr         TEXT;
    v_target_uw_referentie    TEXT;
  BEGIN
    SELECT COUNT(*), COALESCE(MIN(bedrag), 0)
      INTO v_aantal_verzend_regels, v_verzendkosten_per_order
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id AND artikelnr = 'VERZEND';

    SELECT COALESCE(MAX(regelnummer), 0) INTO v_korting_regelnr
      FROM factuur_regels WHERE factuur_id = v_factuur_id;

    -- 1) DREMPELKORTING op order[1] (drempel-cadeau)
    IF v_vk.status = 'gratis_drempel' AND v_aantal_verzend_regels > 0 THEN
      SELECT order_nr, klant_referentie
        INTO v_target_order_nr, v_target_uw_referentie
        FROM orders WHERE id = v_order_ids[1];

      v_korting_regelnr := v_korting_regelnr + 1;
      INSERT INTO factuur_regels (
        factuur_id, order_id, order_regel_id, regelnummer,
        artikelnr, omschrijving,
        uw_referentie, order_nr,
        aantal, prijs, korting_pct, bedrag, btw_percentage
      ) VALUES (
        v_factuur_id, v_order_ids[1], NULL, v_korting_regelnr,
        'DREMPELKORTING',
        format('Drempelkorting verzending — vanaf €%s',
          to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
        v_target_uw_referentie, v_target_order_nr,
        1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
      );
    END IF;

    -- 2) BUNDELKORTING per order[2..N] (één −verzendkosten-regel per order)
    IF v_verzendkosten_per_order > 0 AND v_aantal_verzend_regels > 1 THEN
      FOR v_order_idx IN 2..array_length(v_order_ids, 1) LOOP
        v_target_order_id := v_order_ids[v_order_idx];

        SELECT order_nr, klant_referentie
          INTO v_target_order_nr, v_target_uw_referentie
          FROM orders WHERE id = v_target_order_id;

        v_korting_regelnr := v_korting_regelnr + 1;
        INSERT INTO factuur_regels (
          factuur_id, order_id, order_regel_id, regelnummer,
          artikelnr, omschrijving,
          uw_referentie, order_nr,
          aantal, prijs, korting_pct, bedrag, btw_percentage
        ) VALUES (
          v_factuur_id, v_target_order_id, NULL, v_korting_regelnr,
          'BUNDELKORTING',
          format('Bundelkorting verzending (gebundeld %s orders)',
            v_aantal_verzend_regels),
          v_target_uw_referentie, v_target_order_nr,
          1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
        );
      END LOOP;
    END IF;
  END;

  -- Eindtotalen.
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION projecteer_concept_factuur(BIGINT, BIGINT) IS
  'Mig 428: herhaalbare projectie van een Concept-factuur voor één bundel-zending. '
  '= mig 341 MINUS de gefactureerd-flip en de korting-orderregels (side-effects → '
  'finaliseer_concept_factuur). p_factuur_id NULL = nieuwe header; anders verse '
  'rebuild op bestaande factuur (DELETE regels + herwaardeer). Geen side-effects.';

GRANT EXECUTE ON FUNCTION projecteer_concept_factuur(BIGINT, BIGINT)
  TO authenticated, service_role;

------------------------------------------------------------------------
-- 3. finaliseer_concept_factuur — eenmalig, MÉT side-effects
------------------------------------------------------------------------
-- Herprojecteert (verse regels uit de actuele order → venster-correcties gaan
-- mee) en past dán de onomkeerbare side-effects toe:
--   · flip order_regels.gefactureerd (product + VERZEND)
--   · spiegel de korting-FACTUURregels 1-op-1 naar korting-ORDERregels
-- De spiegeling reproduceert mig 341 deel 3a/3b exact (zelfde order_id, bedrag,
-- omschrijving) zonder de v_vk-afleiding te dupliceren. Status blijft Concept;
-- de edge function zet Verstuurd na succesvolle mail/EDI.
CREATE OR REPLACE FUNCTION finaliseer_concept_factuur(
  p_zending_id BIGINT,
  p_factuur_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id BIGINT;
  v_order_ids  BIGINT[];
  v_admin_regelnr INTEGER;
  r RECORD;
BEGIN
  IF p_factuur_id IS NULL THEN
    RAISE EXCEPTION 'p_factuur_id is verplicht voor finalisatie';
  END IF;

  -- Verse rebuild op de bestaande concept-factuur.
  v_factuur_id := projecteer_concept_factuur(p_zending_id, p_factuur_id);

  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  -- Side-effect 1: flip gefactureerd (product + VERZEND; korting-orderregels
  -- bestaan hier nog niet en worden hieronder met gefactureerd=1 ingevoegd).
  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND COALESCE(artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  -- Side-effect 2: spiegel de korting-FACTUURregels naar korting-ORDERregels.
  -- bedrag <> 0 filtert het theoretische DREMPEL-bij-0-verzendkosten-geval
  -- (mig 341 deel 3a vereiste v_verzendkosten_per_order > 0).
  FOR r IN
    SELECT order_id, artikelnr, omschrijving, bedrag
      FROM factuur_regels
     WHERE factuur_id = v_factuur_id
       AND artikelnr IN ('DREMPELKORTING', 'BUNDELKORTING')
       AND bedrag <> 0
     ORDER BY regelnummer
  LOOP
    SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
      FROM order_regels WHERE order_id = r.order_id;
    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr, omschrijving,
      orderaantal, te_leveren, gefactureerd,
      prijs, korting_pct, bedrag, gewicht_kg
    ) VALUES (
      r.order_id, v_admin_regelnr, r.artikelnr, r.omschrijving,
      1, 0, 1,
      r.bedrag, 0, r.bedrag, 0
    );
  END LOOP;

  RETURN v_factuur_id;
END;
$$;

COMMENT ON FUNCTION finaliseer_concept_factuur(BIGINT, BIGINT) IS
  'Mig 428: eenmalige finalisatie van een concept-factuur. Herprojecteert vers en '
  'past dán de side-effects toe: gefactureerd-flip + korting-orderregels (gespiegeld '
  'uit de korting-factuurregels). Aanroepen via de drain alleen als '
  'factuur_queue.gefinaliseerd_op NULL is (retry-veilig).';

GRANT EXECUTE ON FUNCTION finaliseer_concept_factuur(BIGINT, BIGINT)
  TO authenticated, service_role;

------------------------------------------------------------------------
-- 4. verwerk_concept_queue — fase 1 orchestrator (race-safe, DB-side)
------------------------------------------------------------------------
-- Projecteert een Concept-factuur voor elke pending per_zending-rij zonder
-- concept. De FOR UPDATE SKIP LOCKED-lock leeft gedurende de hele functie-
-- transactie, dus twee parallelle drains pakken nooit dezelfde rij → geen
-- dubbele facturen. Geen delay-gate: het concept mag direct verschijnen.
CREATE OR REPLACE FUNCTION verwerk_concept_queue(p_max_batch INTEGER DEFAULT 10)
RETURNS TABLE (queue_id BIGINT, factuur_id BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  r     RECORD;
  v_fid BIGINT;
BEGIN
  FOR r IN
    SELECT q.id, q.zending_id
      FROM factuur_queue q
     WHERE q.status = 'pending'
       AND q.factuur_id IS NULL
       AND q.zending_id IS NOT NULL
     ORDER BY q.created_at ASC
     LIMIT p_max_batch
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_fid := projecteer_concept_factuur(r.zending_id, NULL);
      UPDATE factuur_queue SET factuur_id = v_fid WHERE id = r.id;
      queue_id := r.id; factuur_id := v_fid;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- Eén kapotte rij mag de batch niet laten falen; laat 'm pending (zonder
      -- concept) en log via last_error. Fase 2 raakt 'm niet zonder factuur_id.
      UPDATE factuur_queue
         SET last_error = 'concept-projectie: ' || SQLERRM
       WHERE id = r.id;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION verwerk_concept_queue(INTEGER) IS
  'Mig 428: fase 1 van de drain — projecteert concepten voor pending per_zending-'
  'rijen zonder factuur_id. Race-safe via FOR UPDATE SKIP LOCKED binnen de functie-'
  'transactie. Per-rij savepoint zodat één fout de batch niet sloopt.';

GRANT EXECUTE ON FUNCTION verwerk_concept_queue(INTEGER) TO authenticated, service_role;

------------------------------------------------------------------------
-- 5. claim_factuur_queue_items — fase 2: alleen finaliseerbare/legacy rijen
------------------------------------------------------------------------
-- = mig 423-body + gate `(factuur_id IS NOT NULL OR zending_id IS NULL)` zodat:
--   · per_zending (zending_id NOT NULL) pas geclaimd wordt als het concept
--     gemaakt is (factuur_id NOT NULL);
--   · wekelijks/legacy (zending_id NULL) ongewijzigd via het oude pad loopt.
-- Return-shape uitgebreid met factuur_id + gefinaliseerd_op zodat de edge
-- function in één call weet of nog gefinaliseerd moet worden.
DROP FUNCTION IF EXISTS claim_factuur_queue_items(INTEGER);

CREATE OR REPLACE FUNCTION claim_factuur_queue_items(p_max_batch INTEGER DEFAULT 10)
RETURNS TABLE (
  id               BIGINT,
  debiteur_nr      INTEGER,
  order_ids        BIGINT[],
  type             TEXT,
  attempts         INTEGER,
  zending_id       BIGINT,
  verzendweek      TEXT,
  factuur_id       BIGINT,
  gefinaliseerd_op TIMESTAMPTZ
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
        AND (inner_q.beschikbaar_op IS NULL OR inner_q.beschikbaar_op <= now())
        AND (inner_q.factuur_id IS NOT NULL OR inner_q.zending_id IS NULL)
      ORDER BY inner_q.created_at ASC
      LIMIT p_max_batch
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.debiteur_nr, q.order_ids, q.type, q.attempts,
            q.zending_id, q.verzendweek, q.factuur_id, q.gefinaliseerd_op;
$$;

GRANT EXECUTE ON FUNCTION claim_factuur_queue_items(INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION claim_factuur_queue_items(INTEGER) IS
  'Mig 428 (was mig 423): claim met FOR UPDATE SKIP LOCKED + beschikbaar_op-gate. '
  'Extra gate (factuur_id NOT NULL OR zending_id NULL): per_zending pas claimbaar '
  'mét concept, wekelijks/legacy ongewijzigd. Return + factuur_id + gefinaliseerd_op.';

NOTIFY pgrst, 'reload schema';

------------------------------------------------------------------------
-- Verificatie (run in SQL Editor / probe na deploy):
------------------------------------------------------------------------
-- 1. Projectie maakt GEEN side-effects (gefactureerd ongewijzigd):
--    SELECT projecteer_concept_factuur(<zending_id>);  -- → factuur_id
--    -- check: order_regels.gefactureerd onveranderd, factuur status 'Concept'.
-- 2. Tweede projectie op dezelfde factuur ververst de regels (idempotent):
--    SELECT projecteer_concept_factuur(<zending_id>, <factuur_id>);
-- 3. Finalisatie zet de flip + korting-orderregels:
--    SELECT finaliseer_concept_factuur(<zending_id>, <factuur_id>);
--    -- check: order_regels.gefactureerd = orderaantal, evt. BUNDEL/DREMPEL-orderregels.
-- 4. Bedragen identiek aan het oude pad: vergelijk subtotaal/btw/totaal met een
--    via genereer_factuur_voor_bundel gemaakte factuur van een gelijke zending.
