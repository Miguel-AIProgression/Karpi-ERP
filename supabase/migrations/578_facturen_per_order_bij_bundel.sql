-- Migratie 578: facturen per order bij een bundel-zending (combi-levering)
--
-- Eis (Miguel, 02-07): "Facturen moeten apart gefactureerd worden en mogen
-- niet verzameld worden. Dus als verschillende orders gebundeld worden wel
-- aparte facturen (per order). En pakbon mag wel verzameld worden maar wel
-- duidelijk welke artikelen bij welke order horen."
--
-- Pakbon was al gedekt (één canonieke builder groepeert per bron-order) —
-- deze migratie levert het factuur-deel. Dit vervangt ADR-0010's "1 bundel-
-- zending = 1 factuur" → nieuwe ADR-0041. De drempel-toets blijft wél
-- bundel-niveau (dat was ADR-0010's echte motief en het hele punt van
-- combi-levering).
--
-- Ontwerp: de granulariteit van de factuur-queue verschuift van zending naar
-- (zending, order). Elke queue-rij → eigen concept-factuur → eigen
-- finalisatie → eigen mail/EDI-INVOIC. Basis van alle vijf functies is de
-- LIVE body (pg_get_functiondef, opgehaald 02-07 — NIET het migratiebestand
-- van mig 428/474, die lopen achter: mig 529/532-toeslag en het mig 518-
-- backorder-filter zitten al in de live body en blijven hier intact).
--
-- Plan: docs/superpowers/plans/2026-07-02-facturen-per-order-bij-bundel.md

------------------------------------------------------------------------
-- 1. factuur_queue.order_id
------------------------------------------------------------------------
ALTER TABLE factuur_queue
  ADD COLUMN IF NOT EXISTS order_id BIGINT REFERENCES orders(id);

COMMENT ON COLUMN factuur_queue.order_id IS
  'Mig 578: de ENE order waarvoor deze queue-rij een factuur bouwt (binnen '
  'zending_id, dat de hele bundel blijft aanwijzen). NULL voor wekelijkse/'
  'legacy rijen (zending_id IS NULL) en voor pre-mig-578 in-flight rijen — '
  'die laten p_order_id NULL en projecteren/finaliseren nog de hele bundel '
  'in één factuur, byte-identiek aan het oude gedrag.';

------------------------------------------------------------------------
-- 2. Dedup-index verschuift van (zending) naar (zending, order)
------------------------------------------------------------------------
-- Oude rijen (order_id NULL) conflicteren nooit onderling (NULL <> NULL in
-- een unieke index) — nieuwe inserts vullen order_id altijd (zie
-- enqueue_factuur_voor_event hieronder), dus die dedupliceren wél correct.
DROP INDEX IF EXISTS uq_factuur_queue_zending;

CREATE UNIQUE INDEX uq_factuur_queue_zending_order
  ON factuur_queue (zending_id, order_id)
  WHERE zending_id IS NOT NULL;

------------------------------------------------------------------------
-- 3. enqueue_factuur_voor_event — één queue-rij per (zending, order)
------------------------------------------------------------------------
-- De trigger vuurt al per order (NEW.order_id). De INSERT wordt simpeler:
-- per zending waarin deze order zit één rij met order_ids = ARRAY[NEW.order_id]
-- en order_id = NEW.order_id. De array_agg-subquery over zusterorders vervalt
-- — elke zusterorder krijgt zijn eigen rij via zijn eigen trigger-vuring.
CREATE OR REPLACE FUNCTION public.enqueue_factuur_voor_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_voorkeur       factuurvoorkeur;
  v_debiteur_nr    INTEGER;
  v_vertraging_min INTEGER;
BEGIN
  -- Mig 474: ook op een voltooide deelzending (event 'deels_verzonden' →
  -- status 'Deels verzonden'), niet alleen op de laatste zending van de order.
  IF NOT (
    (NEW.event_type = 'pickronde_voltooid' AND NEW.status_na = 'Verzonden') OR
    (NEW.event_type = 'deels_verzonden'    AND NEW.status_na = 'Deels verzonden')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT o.debiteur_nr, d.factuurvoorkeur
    INTO v_debiteur_nr, v_voorkeur
    FROM orders o
    JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
   WHERE o.id = NEW.order_id;

  -- Wekelijkse klanten enqueueren via cron, niet hier. NULL = per_zending-default.
  IF v_voorkeur IS NOT NULL AND v_voorkeur <> 'per_zending' THEN
    RETURN NEW;
  END IF;

  -- Verzend-vertraging uit config (default 120 min = 2 uur). Geen rij of geen
  -- veld → COALESCE valt terug op 120.
  SELECT (ac.waarde->>'vertraging_minuten')::int
    INTO v_vertraging_min
    FROM app_config ac
   WHERE ac.sleutel = 'facturatie';
  v_vertraging_min := COALESCE(v_vertraging_min, 120);

  -- Mig 578: per zending waarin deze order zit, één queue-rij VOOR DEZE ORDER
  -- (order_id gevuld) — niet meer voor de hele bundel. ON CONFLICT
  -- (zending_id, order_id) dedupliceert het herhaald vuren van de trigger
  -- voor dezelfde (zending, order)-combinatie (en voorkomt nog steeds een
  -- dubbele rij voor een deelzending die al eerder ingequeued is).
  INSERT INTO factuur_queue (debiteur_nr, order_ids, order_id, type, zending_id, bron_event_id, beschikbaar_op)
  SELECT
    v_debiteur_nr,
    ARRAY[NEW.order_id],
    NEW.order_id,
    'per_zending',
    zo.zending_id,
    NEW.id,
    now() + make_interval(mins => v_vertraging_min)
  FROM zending_orders zo
  WHERE zo.order_id = NEW.order_id
  ON CONFLICT (zending_id, order_id) WHERE zending_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enqueue_factuur_voor_event() IS
  'Mig 578: enqueue nu per (zending, order) i.p.v. per zending — elke order in '
  'een bundel-zending krijgt zijn eigen queue-rij (order_id gevuld, order_ids '
  '= ARRAY[NEW.order_id]) en dus straks zijn eigen concept-factuur. Was mig 474 '
  '(deelzending-event-dekking, ongewijzigd behouden).';

------------------------------------------------------------------------
-- 4. projecteer_concept_factuur — scope-array (v_scope_ids) + drempel-fix
------------------------------------------------------------------------
-- Nieuw 3e argument p_order_id (DEFAULT NULL). NULL = hele bundel in één
-- factuur (legacy/in-flight, byte-identiek aan de vorige body). Gezet = één
-- order-scoped factuur binnen de bundel-zending.
--
-- v_scope_ids (= v_order_ids als p_order_id NULL, anders ARRAY[p_order_id])
-- stuurt: regels-INSERT, no-op-guard, afleverland/BTW-representant, de
-- toeslag-activatie-BOOL_AND en (impliciet, via de join) uw_referentie.
--
-- v_order_ids (ALTIJD de hele zending, ongeacht scope) blijft sturen:
-- v_is_afhalen (BOOL_OR) en — nieuw — de drempel-grondslag: zie de
-- toelichting bij v_drempel_grondslag hieronder.
--
-- DROP eerst: een extra parameter (ook met DEFAULT) is voor Postgres een
-- NIEUW functie-signatuur (ander pg_proc-record) — CREATE OR REPLACE laat de
-- oude 2-arg-vorm gewoon ernaast bestaan, wat elke 2-arg-aanroep meteen
-- ambigu maakt ("function ... is not unique"). Bevestigd via een rolled-back
-- testrun tijdens het bouwen van deze migratie. Zonder deze DROP is het
-- deploy-window-vangnet (2-arg-aanroep valt terug op de queue-lookup) zelfs
-- kapot, niet alleen overbodig.
DROP FUNCTION IF EXISTS projecteer_concept_factuur(BIGINT, BIGINT);

CREATE OR REPLACE FUNCTION public.projecteer_concept_factuur(
  p_zending_id BIGINT,
  p_factuur_id BIGINT DEFAULT NULL,
  p_order_id BIGINT DEFAULT NULL
)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id            BIGINT;
  v_factuur_nr            TEXT;
  v_zending               zendingen%ROWTYPE;
  v_debiteur              debiteuren%ROWTYPE;
  v_eerste_order          orders%ROWTYPE;
  v_btw_regeling          RECORD;
  v_btw_pct               NUMERIC(5,2);
  v_betaaltermijn_dagen   INTEGER := 30;
  v_aantal_te_factureren  INTEGER;
  v_order_ids             BIGINT[];
  v_scope_ids             BIGINT[];
  v_order_id_lookup       BIGINT;
  v_subtotaal             NUMERIC(12,2);
  v_btw_bedrag            NUMERIC(12,2);
  v_totaal                NUMERIC(12,2);
  v_bundel_subtotaal      NUMERIC(12,2);
  v_drempel_grondslag     NUMERIC(12,2);
  v_is_afhalen            BOOLEAN;
  v_vk                    RECORD;
  -- Toeslag (mig 529/532)
  v_toeslag_bedrag        NUMERIC(12,2) := 0;
  v_toeslag_omschrijving  TEXT          := NULL;
  v_toeslag_actief        BOOLEAN       := FALSE;
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

  -- Mig 578 deploy-window-vangnet: een oude aanroep-vorm (2 args, of expliciet
  -- p_order_id NULL) op een BESTAANDE concept-factuur valt terug op de
  -- queue-rij die 'm gebouwd heeft, zodat de scope niet per ongeluk naar de
  -- hele bundel terugvalt tijdens het venster tussen mig-apply en edge-deploy.
  IF p_factuur_id IS NOT NULL AND p_order_id IS NULL THEN
    SELECT fq.order_id INTO v_order_id_lookup
      FROM factuur_queue fq
     WHERE fq.factuur_id = p_factuur_id
     LIMIT 1;
    IF v_order_id_lookup IS NOT NULL THEN
      p_order_id := v_order_id_lookup;
    END IF;
  END IF;

  IF p_order_id IS NOT NULL AND NOT (p_order_id = ANY(v_order_ids)) THEN
    RAISE EXCEPTION 'Order % hoort niet bij zending % (orders: %)',
      p_order_id, p_zending_id, v_order_ids;
  END IF;

  -- Scope-array: NULL = hele bundel (legacy/in-flight); gezet = 1 order.
  v_scope_ids := CASE WHEN p_order_id IS NULL THEN v_order_ids ELSE ARRAY[p_order_id] END;

  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(v_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Bundel-zending % kruist debiteur-grens (orders %)',
      p_zending_id, v_order_ids;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren
   WHERE debiteur_nr = (SELECT DISTINCT debiteur_nr FROM orders WHERE id = ANY(v_order_ids));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geen debiteur voor orders %', v_order_ids;
  END IF;

  -- Mig 578: afleverland/BTW-representant is de scope-order zelf (was
  -- v_order_ids[1] — voor een order-scoped factuur is dat exact dezelfde
  -- order; voor het NULL-pad is v_scope_ids[1] = v_order_ids[1], dus
  -- byte-identiek).
  SELECT * INTO v_eerste_order FROM orders WHERE id = v_scope_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land,
      v_debiteur.land,
      v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom,
      v_debiteur.btw_nummer,
      v_debiteur.btw_percentage
    );

  v_btw_pct := v_btw_regeling.effectief_pct;
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);

  -- Toeslag-activatie (mig 532), scope-gebonden (mig 578: v_scope_ids i.p.v.
  -- v_order_ids — bij een order-scoped factuur telt alleen de eigen order
  -- mee voor de aanmaakdatum-periode-check). BOOL_AND over lege set = NULL
  -- → FALSE → geen toeslag (veilig).
  v_toeslag_actief := COALESCE(v_debiteur.toeslag_actief, FALSE)
    AND v_debiteur.toeslag_procent IS NOT NULL
    AND (
        SELECT BOOL_AND(
            o.created_at::date >= COALESCE(v_debiteur.toeslag_begindatum, 'infinity'::date)
            AND o.created_at::date <= COALESCE(v_debiteur.toeslag_einddatum, 'infinity'::date)
        )
        FROM orders o WHERE o.id = ANY(v_scope_ids)
    );

  -- No-op-guard: faal vroeg als alle regels al gefactureerd zijn. Scope-
  -- gebonden (mig 578: v_scope_ids). pick_backorder-filter (mig 518/hersteld):
  -- regels met actieve backorder-markering worden nooit gefactureerd — gelijk
  -- aan finaliseer.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_scope_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
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
      fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
      btw_verlegd, btw_regeling, btw_controle_nodig_sinds,
      toeslag_bedrag, toeslag_omschrijving, toeslag_procent
    ) VALUES (
      v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
      CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
      0, v_btw_pct, 0, 0,
      COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      v_debiteur.land,
      v_debiteur.btw_nummer,
      (v_btw_regeling.regeling = 'eu_b2b_icl'),
      v_btw_regeling.regeling,
      CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END,
      0, NULL, NULL
    ) RETURNING id INTO v_factuur_id;
  ELSE
    v_factuur_id := p_factuur_id;
    DELETE FROM factuur_regels WHERE factuur_id = v_factuur_id;
    UPDATE facturen SET
      btw_percentage           = v_btw_pct,
      btw_verlegd              = (v_btw_regeling.regeling = 'eu_b2b_icl'),
      btw_regeling             = v_btw_regeling.regeling,
      btw_controle_nodig_sinds = CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END,
      vervaldatum              = factuurdatum + v_betaaltermijn_dagen,
      fact_naam                = COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
      fact_adres               = COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
      fact_postcode            = COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
      fact_plaats              = COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
      fact_land                = v_debiteur.land,
      btw_nummer               = v_debiteur.btw_nummer,
      toeslag_bedrag           = 0,
      toeslag_omschrijving     = NULL,
      toeslag_procent          = NULL
     WHERE id = v_factuur_id;
  END IF;

  -- Product- + VERZEND-orderregels (1 factuur-regel per order × regel).
  -- BUNDELKORTING/DREMPELKORTING → hieronder als korting-factuurregels.
  -- TOESLAG (pseudo-orderregel) → eigen totaal-sectie (mig 529). Scope-
  -- gebonden (mig 578: v_scope_ids i.p.v. v_order_ids).
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
  WHERE orr.order_id = ANY(v_scope_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING', 'TOESLAG')
  ORDER BY orr.order_id, orr.regelnummer;

  -- Product-subtotaal (excl. VERZEND) van de EIGEN factuur = grondslag voor
  -- de toeslag (ongewijzigd, mig 529) — bewust NIET de drempel-grondslag
  -- (zie hieronder).
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    INTO v_bundel_subtotaal
    FROM factuur_regels
   WHERE factuur_id = v_factuur_id
     AND COALESCE(artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING');

  -- Mig 578 drempel-grondslag-fix: de bundel-brede drempel-toets mag niet
  -- langer leunen op de factuurregels van ÉÉN (order-scoped) factuur — bij
  -- per-order-facturen zou finalisatie van factuur 1 (gefactureerd-flip) de
  -- grondslag verlagen die factuur 2's verse rebuild ziet, waardoor de
  -- korting zou verdwijnen afhankelijk van finalisatie-volgorde. Nieuw:
  -- grondslag = SUM(order_regels.bedrag) over ALLE v_order_ids (de hele
  -- zending, ongeacht scope), MET de bestaande backorder-filters, ZONDER
  -- gefactureerd-filter. Deterministisch en volgorde-onafhankelijk.
  -- Bewuste semantiek-nuance bij deelzending-overlap: de grondslag telt de
  -- hele order-waarde (ook een al-gefactureerd deel) — klant-gunstig, past
  -- bij de combi-intentie (gedocumenteerd in ADR-0041).
  SELECT COALESCE(SUM(orr.bedrag), 0)::NUMERIC(12,2)
    INTO v_drempel_grondslag
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND orr.pick_backorder_sinds IS NULL AND orr.pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(orr.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING', 'TOESLAG');

  SELECT BOOL_OR(COALESCE(o.afhalen, FALSE))
    INTO v_is_afhalen
    FROM orders o
   WHERE o.id = ANY(v_order_ids);

  -- NULL-pad (legacy/in-flight rijen): oude grondslag uit de eigen
  -- factuurregels, byte-identiek aan het pre-578-gedrag. Alleen een
  -- order-scoped factuur gebruikt de nieuwe volgorde-onafhankelijke grondslag.
  SELECT * INTO v_vk
    FROM verzendkosten_voor_bundel(
      v_debiteur.debiteur_nr,
      CASE WHEN p_order_id IS NULL THEN v_bundel_subtotaal ELSE v_drempel_grondslag END,
      v_is_afhalen);

  -- Korting-FACTUURregels (DREMPELKORTING/BUNDELKORTING).
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

    IF p_order_id IS NULL THEN
      -- Mig 578: ongewijzigde hele-bundel-logica — byte-identiek voor
      -- in-flight (legacy) rijen zonder order-scope.

      -- 1) DREMPELKORTING op order[1]
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

      -- 2) BUNDELKORTING per order[2..N]
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

    ELSE
      -- Mig 578: order-scoped factuur — de eigen VERZEND-regel op DEZE
      -- factuur bepaalt of/welke korting hier hoort. Geen eigen VERZEND-regel
      -- (bv. een pseudo-scope zonder verzendkosten) → geen korting-regel.
      IF v_aantal_verzend_regels > 0 THEN
        IF p_order_id = v_order_ids[1] THEN
          -- Verzendkosten-drager: drempel gehaald → DREMPELKORTING
          -- neutraliseert de eigen VERZEND-regel; anders blijft VERZEND
          -- gewoon staan (klant betaalt 1× verzendkosten per bundel).
          IF v_vk.status = 'gratis_drempel' THEN
            SELECT order_nr, klant_referentie
              INTO v_target_order_nr, v_target_uw_referentie
              FROM orders WHERE id = p_order_id;

            v_korting_regelnr := v_korting_regelnr + 1;
            INSERT INTO factuur_regels (
              factuur_id, order_id, order_regel_id, regelnummer,
              artikelnr, omschrijving,
              uw_referentie, order_nr,
              aantal, prijs, korting_pct, bedrag, btw_percentage
            ) VALUES (
              v_factuur_id, p_order_id, NULL, v_korting_regelnr,
              'DREMPELKORTING',
              format('Drempelkorting verzending — vanaf €%s',
                to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
              v_target_uw_referentie, v_target_order_nr,
              1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
            );
          END IF;
        ELSE
          -- Zusterorder: een bundel is 1 fysieke transportbeweging —
          -- zusterorders betalen nooit verzendkosten, ongeacht de drempel.
          -- N = array_length(v_order_ids) — uit de zending, niet uit de
          -- (altijd ≤1) VERZEND-regels op deze eigen factuur.
          IF v_verzendkosten_per_order > 0 THEN
            SELECT order_nr, klant_referentie
              INTO v_target_order_nr, v_target_uw_referentie
              FROM orders WHERE id = p_order_id;

            v_korting_regelnr := v_korting_regelnr + 1;
            INSERT INTO factuur_regels (
              factuur_id, order_id, order_regel_id, regelnummer,
              artikelnr, omschrijving,
              uw_referentie, order_nr,
              aantal, prijs, korting_pct, bedrag, btw_percentage
            ) VALUES (
              v_factuur_id, p_order_id, NULL, v_korting_regelnr,
              'BUNDELKORTING',
              format('Bundelkorting verzending (gebundeld %s orders)',
                array_length(v_order_ids, 1)),
              v_target_uw_referentie, v_target_order_nr,
              1, -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, v_btw_pct
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END;

  -- Toeslag-berekening (mig 529): grondslag = v_bundel_subtotaal (product
  -- excl. VERZEND, over de EIGEN factuurregels) — ongewijzigde formule.
  IF v_toeslag_actief THEN
    v_toeslag_bedrag := ROUND(v_bundel_subtotaal * v_debiteur.toeslag_procent / 100, 2);
    v_toeslag_omschrijving := REPLACE(
      v_debiteur.toeslag_omschrijving,
      '{percentage}',
      REPLACE(
        REGEXP_REPLACE(v_debiteur.toeslag_procent::TEXT, '\.?0+$', ''),
        '.', ','
      )
    );
  END IF;

  -- Eindtotalen (BTW over subtotaal + toeslag; gedragsneutraal als toeslag=0).
  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  v_btw_bedrag := ROUND((v_subtotaal + v_toeslag_bedrag) * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_toeslag_bedrag + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal            = v_subtotaal,
         btw_bedrag           = v_btw_bedrag,
         totaal               = v_totaal,
         toeslag_bedrag       = v_toeslag_bedrag,
         toeslag_omschrijving = v_toeslag_omschrijving,
         toeslag_procent      = CASE WHEN v_toeslag_actief THEN v_debiteur.toeslag_procent ELSE NULL END
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$function$;

COMMENT ON FUNCTION public.projecteer_concept_factuur(BIGINT, BIGINT, BIGINT) IS
  'Mig 578: 3e argument p_order_id (DEFAULT NULL) — NULL projecteert de hele '
  'bundel in één factuur (legacy/in-flight, byte-identiek aan de vorige body); '
  'gezet projecteert alleen die order in zijn EIGEN factuur (v_scope_ids), maar '
  'houdt v_is_afhalen + de drempel-grondslag altijd bundel-breed (v_order_ids). '
  'Drempel-grondslag is herzien: SUM(order_regels.bedrag) over de hele zending, '
  'backorder-gefilterd, zonder gefactureerd-filter — deterministisch en '
  'finalisatie-volgorde-onafhankelijk (was: SUM(eigen factuurregels), brak bij '
  'per-order-facturen). Deploy-window-vangnet: bij p_factuur_id gezet en '
  'p_order_id NULL wordt p_order_id opgezocht via factuur_queue.';

GRANT EXECUTE ON FUNCTION projecteer_concept_factuur(BIGINT, BIGINT, BIGINT)
  TO authenticated, service_role;

------------------------------------------------------------------------
-- 5. finaliseer_concept_factuur — scope-gebonden gefactureerd-flip
------------------------------------------------------------------------
-- DROP eerst — zelfde reden als bij projecteer_concept_factuur hierboven: een
-- extra parameter is een nieuw functie-signatuur, geen vervanging.
DROP FUNCTION IF EXISTS finaliseer_concept_factuur(BIGINT, BIGINT);

CREATE OR REPLACE FUNCTION public.finaliseer_concept_factuur(
  p_zending_id BIGINT,
  p_factuur_id BIGINT,
  p_order_id BIGINT DEFAULT NULL
)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id      BIGINT;
  v_order_ids       BIGINT[];
  v_scope_ids       BIGINT[];
  v_order_id_lookup BIGINT;
  v_admin_regelnr   INTEGER;
  r RECORD;
BEGIN
  IF p_factuur_id IS NULL THEN
    RAISE EXCEPTION 'p_factuur_id is verplicht voor finalisatie';
  END IF;

  -- Mig 578 deploy-window-vangnet: een oude 2-arg-aanroep (p_order_id NULL)
  -- valt terug op de queue-rij die deze factuur bouwde, zodat alleen de
  -- juiste order geflipt wordt i.p.v. de hele bundel.
  IF p_order_id IS NULL THEN
    SELECT fq.order_id INTO v_order_id_lookup
      FROM factuur_queue fq
     WHERE fq.factuur_id = p_factuur_id
     LIMIT 1;
    IF v_order_id_lookup IS NOT NULL THEN
      p_order_id := v_order_id_lookup;
    END IF;
  END IF;

  -- Verse rebuild op de bestaande concept-factuur, met dezelfde order-scope.
  v_factuur_id := projecteer_concept_factuur(p_zending_id, p_factuur_id, p_order_id);

  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
   WHERE zo.zending_id = p_zending_id;

  v_scope_ids := CASE WHEN p_order_id IS NULL THEN v_order_ids ELSE ARRAY[p_order_id] END;

  -- Side-effect 1: flip gefactureerd (product + VERZEND; korting-orderregels
  -- bestaan hier nog niet en worden hieronder met gefactureerd=1 ingevoegd).
  -- Mig 578: WHERE order_id = ANY(v_scope_ids) i.p.v. de hele bundel — bij een
  -- order-scoped factuur mag de flip alleen DIE order raken, anders zou
  -- factuur 2 straks 0 te-factureren regels vinden voor een order die al
  -- door factuur 1 geflipt was.
  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_scope_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND pick_backorder_sinds IS NULL AND pick_backorder_geannuleerd_op IS NULL
     AND COALESCE(artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  -- Side-effect 2: spiegel de korting-FACTUURregels naar korting-ORDERregels.
  -- Loopt al via `factuur_regels WHERE factuur_id = v_factuur_id` — die bevat
  -- bij een order-scoped factuur alleen de eigen korting-regel(s), dus dit is
  -- automatisch per-order correct zonder wijziging.
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
$function$;

COMMENT ON FUNCTION public.finaliseer_concept_factuur(BIGINT, BIGINT, BIGINT) IS
  'Mig 578: 3e argument p_order_id (DEFAULT NULL) — geeft de order-scope door '
  'aan projecteer_concept_factuur en beperkt de gefactureerd-flip tot '
  'v_scope_ids (was: de hele bundel). Deploy-window-vangnet identiek aan '
  'projecteer: p_order_id NULL wordt opgezocht via factuur_queue.order_id.';

GRANT EXECUTE ON FUNCTION finaliseer_concept_factuur(BIGINT, BIGINT, BIGINT)
  TO authenticated, service_role;

------------------------------------------------------------------------
-- 6. verwerk_concept_queue — geeft q.order_id door aan de projectie
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verwerk_concept_queue(p_max_batch integer DEFAULT 10)
 RETURNS TABLE(queue_id bigint, factuur_id bigint)
 LANGUAGE plpgsql
AS $function$
DECLARE
  r     RECORD;
  v_fid BIGINT;
BEGIN
  FOR r IN
    SELECT q.id, q.zending_id, q.order_id
      FROM factuur_queue q
     WHERE q.status = 'pending'
       AND q.factuur_id IS NULL
       AND q.zending_id IS NOT NULL
     ORDER BY q.created_at ASC
     LIMIT p_max_batch
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_fid := projecteer_concept_factuur(r.zending_id, NULL, r.order_id);
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
$function$;

COMMENT ON FUNCTION public.verwerk_concept_queue(INTEGER) IS
  'Mig 578: geeft q.order_id door als 3e argument aan projecteer_concept_factuur '
  '(elke queue-rij projecteert nu zijn eigen order-scoped concept i.p.v. de hele '
  'bundel). NULL bij legacy rijen zonder order_id → ongewijzigd hele-bundel-pad.';

------------------------------------------------------------------------
-- 7. claim_factuur_queue_items — order_id mee terug (return-shape-wijziging)
------------------------------------------------------------------------
-- DROP eerst — precedent mig 428, PostgreSQL staat geen kolom-toevoeging aan
-- RETURNS TABLE toe via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS claim_factuur_queue_items(integer);

CREATE OR REPLACE FUNCTION public.claim_factuur_queue_items(p_max_batch integer DEFAULT 10)
 RETURNS TABLE(
   id               bigint,
   debiteur_nr      integer,
   order_ids        bigint[],
   order_id         bigint,
   type             text,
   attempts         integer,
   zending_id       bigint,
   verzendweek      text,
   factuur_id       bigint,
   gefinaliseerd_op timestamp with time zone
 )
 LANGUAGE sql
AS $function$
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
  RETURNING q.id, q.debiteur_nr, q.order_ids, q.order_id, q.type, q.attempts,
            q.zending_id, q.verzendweek, q.factuur_id, q.gefinaliseerd_op;
$function$;

GRANT EXECUTE ON FUNCTION claim_factuur_queue_items(INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_factuur_queue_items(INTEGER) IS
  'Mig 578: return-shape uitgebreid met order_id zodat de edge function weet '
  'welke ENE order deze geclaimde rij betreft (voor de p_order_id-aanroep van '
  'finaliseer_concept_factuur). Verder ongewijzigd t.o.v. mig 428.';

NOTIFY pgrst, 'reload schema';
