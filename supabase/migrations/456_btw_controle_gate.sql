-- Migratie 456: BTW-controle-gate op facturen + de 3 actieve factuur-RPC's
--
-- Vervolg op mig 454/455 (normaliseer_land EU-27 + bepaal_btw_regeling).
-- Gate-conventie zoals afl_adres_incompleet_sinds (mig 395) / prijs_ontbreekt_sinds
-- (mig 396): nullable TIMESTAMPTZ, NULL = geen probleem. ONTWERPKEUZE (zie plan
-- 2026-06-20): deze gate leeft op `facturen`, NIET op `orders`, en blokkeert het
-- VERZENDEN van de factuur, NIET _valideer_intake_gates/start_pickronden — het
-- risico hier is een factuur met het verkeerde BTW-bedrag, niet het fysiek
-- verzenden van de goederen. Een order mag dus gewoon gepickt en verzonden
-- worden; de bijbehorende factuur blijft hangen tot een mens het tarief
-- bevestigt.
--
-- KORTE-TERMIJN-CORRECTIE (zelfde dag, vóór merge): de eerste versie van deze
-- migratie liet de 3 RPC's een RAISE EXCEPTION doen ZODRA bepaal_btw_regeling
-- een hard-block-regeling teruggaf — VÓÓR de factuur-INSERT/UPDATE. Gevolg:
-- bij een blokkade werd er HELEMAAL GEEN factuur aangemaakt — alleen
-- `factuur_queue.last_error` kreeg de reden, en die tabel heeft geen enkele
-- UI. De "BTW controle nodig"-banner (factuur-detail) kon dus nooit zichtbaar
-- worden voor precies het scenario waarvoor hij gebouwd is.
--
-- Fix: de RPC's zetten de gate-kolommen nu ALTIJD (factuur wordt altijd
-- aangemaakt/bijgewerkt, zichtbaar als Concept met de banner) — de
-- daadwerkelijke blokkade verhuist naar de TS-laag in factuur-verzenden/
-- index.ts, ná het aanmaken van de factuur en VÓÓR het versturen van de
-- e-mail/EDI (zelfde "check bij de risicovolle actie"-patroon als
-- _valideer_intake_gates bij start_pickronden, alleen op een ander niveau).
--
-- Hard-block geldt alleen voor regeling IN ('eu_b2b_binnenland_afwijking',
-- 'export_buiten_eu') — 'eu_b2b_icl' zonder btw-nummer blijft advisory (mig
-- 164-besluit, niet heropend); 'nl_binnenland' blokkeert nooit (incl. de
-- leeg-land-fallback uit mig 455).
--
-- Aangepast: projecteer_concept_factuur (mig 449), genereer_factuur_voor_week
-- en genereer_factuur (beide mig 453). genereer_factuur_voor_bundel blijft
-- bewust ongewijzigd (bevestigd dode code, mig 453's eigen onderzoek).

-- ============================================================================
-- 1. Gate-kolommen op facturen
-- ============================================================================
ALTER TABLE facturen
  ADD COLUMN IF NOT EXISTS btw_controle_nodig_sinds TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS btw_regeling TEXT;

COMMENT ON COLUMN facturen.btw_controle_nodig_sinds IS
  'Mig 456: NULL = BTW-regeling automatisch bepaald en zeker. TIMESTAMPTZ = '
  'moment waarop bepaal_btw_regeling (mig 455) een afwijkende/onzekere regeling '
  'signaleerde bij de laatste projectie (eu_b2b_binnenland_afwijking, '
  'export_buiten_eu, of eu_b2b_icl zonder btw-nummer — die laatste alleen '
  'advisory, niet hard-blokkerend). Bevestigen via '
  'markeer_btw_regeling_geaccepteerd. Niet te verwarren met facturen.btw_verlegd '
  '(snapshot van het resultaat, mig 371).';

COMMENT ON COLUMN facturen.btw_regeling IS
  'Mig 456: snapshot van de regeling-code uit bepaal_btw_regeling op het moment '
  'van projectie (nl_binnenland/eu_b2b_icl/eu_b2b_binnenland_afwijking/'
  'export_buiten_eu). Puur informatief/audit.';

-- ============================================================================
-- 2. Bevestig-RPC (analoog markeer_prijs_geaccepteerd, mig 396)
-- ============================================================================
CREATE OR REPLACE FUNCTION markeer_btw_regeling_geaccepteerd(p_factuur_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sinds TIMESTAMPTZ;
BEGIN
  SELECT btw_controle_nodig_sinds INTO v_sinds
    FROM facturen WHERE id = p_factuur_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factuur % bestaat niet', p_factuur_id;
  END IF;

  IF v_sinds IS NULL THEN
    RETURN; -- no-op-guard
  END IF;

  UPDATE facturen SET btw_controle_nodig_sinds = NULL WHERE id = p_factuur_id;
END;
$$;

GRANT EXECUTE ON FUNCTION markeer_btw_regeling_geaccepteerd(BIGINT) TO authenticated;

COMMENT ON FUNCTION markeer_btw_regeling_geaccepteerd(BIGINT) IS
  'Mig 456: bevestigt dat de BTW-regeling op deze concept-factuur klopt, ook al '
  'signaleerde bepaal_btw_regeling een afwijking. Wist de gate zonder data te '
  'wijzigen (analoog markeer_prijs_geaccepteerd, mig 396). Een latere '
  'her-projectie (projecteer_concept_factuur opnieuw aanroepen) HERBEREKENT de '
  'regeling en kan de gate opnieuw zetten als de onderliggende data nog steeds '
  'afwijkend is — bevestiging is per-projectie, niet permanent.';

-- ============================================================================
-- 3. projecteer_concept_factuur — CREATE OR REPLACE, gerichte wijziging
-- ============================================================================
CREATE OR REPLACE FUNCTION public.projecteer_concept_factuur(p_zending_id bigint, p_factuur_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_zending              zendingen%ROWTYPE;
  v_debiteur             debiteuren%ROWTYPE;
  v_eerste_order         orders%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_btw_regeling         RECORD;
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

  -- Mig 456: eerste order van de bundel als representatief afleverland. Een
  -- bundel-zending wordt al gegroepeerd op genormaliseerd adres
  -- (start_pickronden), dus gemengd-land-binnen-1-bundel is een laag restrisico.
  SELECT * INTO v_eerste_order FROM orders WHERE id = v_order_ids[1];

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

  -- Mig 456 (gecorrigeerd): GEEN blokkade hier — de factuur wordt altijd
  -- aangemaakt/bijgewerkt (zichtbaar als Concept met de "BTW controle
  -- nodig"-banner als v_btw_regeling.controle_nodig). De daadwerkelijke
  -- blokkade (vóór verzenden) zit in factuur-verzenden/index.ts.

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
      fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
      btw_verlegd, btw_regeling, btw_controle_nodig_sinds
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
      CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END
    ) RETURNING id INTO v_factuur_id;
  ELSE
    v_factuur_id := p_factuur_id;
    -- Verse rebuild: wis de oude regels, herwaardeer de header-meta die in het
    -- venster gewijzigd kan zijn (btw/termijn/adres-snapshot). factuurdatum
    -- blijft de concept-datum.
    DELETE FROM factuur_regels WHERE factuur_id = v_factuur_id;
    UPDATE facturen SET
      btw_percentage = v_btw_pct,
      btw_verlegd    = (v_btw_regeling.regeling = 'eu_b2b_icl'),
      btw_regeling   = v_btw_regeling.regeling,
      btw_controle_nodig_sinds = CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END,
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
$function$;

COMMENT ON FUNCTION public.projecteer_concept_factuur(bigint, bigint) IS
  'Mig 428, BTW-fix mig 449, regeling-bewust sinds mig 456: projecteert een '
  'concept-factuur (header + regels) voor een zending — herhaalbaar, geen '
  'side-effects. BTW-regeling via bepaal_btw_regeling (mig 455, afl_land-bewust) '
  'snapshot op btw_regeling/btw_controle_nodig_sinds — GEEN blokkade hier (zie '
  'mig 456-correctie); factuur-verzenden/index.ts blokkeert het versturen bij '
  'eu_b2b_binnenland_afwijking/export_buiten_eu, ná aanmaak, zodat de factuur '
  'zichtbaar blijft als Concept met de "BTW controle nodig"-banner.';

-- ============================================================================
-- 4. genereer_factuur_voor_week — zelfde patroon
-- ============================================================================
CREATE OR REPLACE FUNCTION public.genereer_factuur_voor_week(p_debiteur_nr integer, p_jaar_week text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_debiteur             debiteuren%ROWTYPE;
  v_eerste_order         orders%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_btw_regeling         RECORD;
  v_betaaltermijn_dagen  INTEGER := 30;
  v_aantal_te_factureren INTEGER;
  v_order_ids            BIGINT[];
  v_subtotaal            NUMERIC(12,2);
  v_btw_bedrag           NUMERIC(12,2);
  v_totaal               NUMERIC(12,2);
  v_volgnr               INTEGER;
  v_zending              RECORD;
  v_bundel_subtotaal     NUMERIC(12,2);
  v_aantal_orders_bundel INTEGER;
  v_te_betalen           NUMERIC(8,2);
  v_omschrijving         TEXT;
BEGIN
  IF p_debiteur_nr IS NULL OR p_jaar_week IS NULL THEN
    RAISE EXCEPTION 'p_debiteur_nr en p_jaar_week zijn verplicht';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = p_debiteur_nr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debiteur % bestaat niet', p_debiteur_nr;
  END IF;

  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  -- Verzamel orders van deze (debiteur, week) die nog niet gefactureerd zijn.
  SELECT array_agg(o.id ORDER BY o.id)
    INTO v_order_ids
    FROM orders o
   WHERE o.debiteur_nr = p_debiteur_nr
     AND o.status = 'Verzonden'
     AND verzendweek_voor_datum(o.afleverdatum) = p_jaar_week
     AND NOT EXISTS (
       SELECT 1 FROM factuur_regels fr WHERE fr.order_id = o.id
     );

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Geen te-factureren orders gevonden voor debiteur % week %',
      p_debiteur_nr, p_jaar_week
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Mig 456: BTW-regeling op basis van de eerste order in de week-batch.
  SELECT * INTO v_eerste_order FROM orders WHERE id = v_order_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land, v_debiteur.land, v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom, v_debiteur.btw_nummer, v_debiteur.btw_percentage
    );
  v_btw_pct := v_btw_regeling.effectief_pct;

  -- Mig 456 (gecorrigeerd): geen blokkade hier — zie projecteer_concept_factuur.

  -- Mig 227-guard: tel daadwerkelijk te-factureren orderregels VÓÓR
  -- header-INSERT om lege facturen te voorkomen bij dubbele drain-aanroep.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND COALESCE(orr.artikelnr, '') <> 'VERZEND';

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Order(s) % zijn al volledig gefactureerd — geen regels te factureren', v_order_ids
      USING ERRCODE = 'no_data_found';
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
    btw_verlegd, btw_regeling, btw_controle_nodig_sinds
  ) VALUES (
    v_factuur_nr, p_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    (v_btw_regeling.regeling = 'eu_b2b_icl'),
    v_btw_regeling.regeling,
    CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END
  ) RETURNING id INTO v_factuur_id;

  -- Product-regels (zelfde SELECT-shape als mig 227 genereer_factuur).
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
    AND COALESCE(orr.artikelnr, '') <> 'VERZEND'
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND COALESCE(artikelnr, '') <> 'VERZEND';

  -- Verzending-regels: 1 per bundel-zending van deze (debiteur, week).
  SELECT COALESCE(MAX(regelnummer), 0) INTO v_volgnr
    FROM factuur_regels WHERE factuur_id = v_factuur_id;

  FOR v_zending IN
    SELECT z.id, z.zending_nr, z.vervoerder_code, z.afl_naam, z.afl_plaats
      FROM zendingen z
     WHERE z.verzendweek = p_jaar_week
       AND EXISTS (
         SELECT 1 FROM zending_orders zo
          WHERE zo.zending_id = z.id
            AND zo.order_id = ANY(v_order_ids)
       )
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
     ORDER BY z.id
  LOOP
    SELECT COALESCE(SUM(fr.bedrag), 0)::NUMERIC(12,2),
           COUNT(DISTINCT fr.order_id)::INTEGER
      INTO v_bundel_subtotaal, v_aantal_orders_bundel
      FROM factuur_regels fr
     WHERE fr.factuur_id = v_factuur_id
       AND fr.order_id IN (
         SELECT zo.order_id FROM zending_orders zo
          WHERE zo.zending_id = v_zending.id
       );

    IF v_aantal_orders_bundel = 0 THEN
      CONTINUE;
    END IF;

    IF v_zending.vervoerder_code IS NULL THEN
      v_te_betalen := 0;
      v_omschrijving := 'Afhalen — geen verzendkosten';
    ELSIF v_debiteur.gratis_verzending THEN
      v_te_betalen := 0;
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s) — gratis volgens klantafspraak',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END
      );
    ELSIF v_debiteur.verzend_drempel IS NOT NULL
          AND v_bundel_subtotaal >= v_debiteur.verzend_drempel THEN
      v_te_betalen := 0;
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s) — gratis vanaf €%s',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END,
        to_char(v_debiteur.verzend_drempel, 'FM999999.00')
      );
    ELSE
      v_te_betalen := COALESCE(v_debiteur.verzendkosten, 0);
      v_omschrijving := format(
        'Verzendkosten %s (%s, %s order%s)',
        p_jaar_week, v_zending.vervoerder_code,
        v_aantal_orders_bundel,
        CASE WHEN v_aantal_orders_bundel = 1 THEN '' ELSE 's' END
      );
    END IF;

    v_volgnr := v_volgnr + 1;

    INSERT INTO factuur_regels (
      factuur_id, order_id, order_regel_id, regelnummer,
      artikelnr, omschrijving,
      aantal, prijs, korting_pct, bedrag, btw_percentage
    ) VALUES (
      v_factuur_id,
      (SELECT MIN(zo.order_id) FROM zending_orders zo WHERE zo.zending_id = v_zending.id),
      NULL,
      v_volgnr,
      'VERZEND',
      v_omschrijving,
      1, v_te_betalen, 0, v_te_betalen, v_btw_pct
    );
  END LOOP;

  SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
    FROM factuur_regels WHERE factuur_id = v_factuur_id;
  v_btw_bedrag := ROUND(v_subtotaal * v_btw_pct / 100, 2);
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$function$;

COMMENT ON FUNCTION public.genereer_factuur_voor_week(integer, text) IS
  'Legacy wekelijkse-verzamelfactuur-generatie (mig 117/122/231), BTW-fix mig '
  '453, regeling-bewust sinds mig 456 (bepaal_btw_regeling) — snapshot, GEEN '
  'blokkade hier (zie mig 456-correctie, factuur-verzenden/index.ts blokkeert '
  'het versturen). Nog actief voor factuurvoorkeur=wekelijks-debiteuren '
  '(momenteel 0).';

-- ============================================================================
-- 5. genereer_factuur — zelfde patroon
-- ============================================================================
CREATE OR REPLACE FUNCTION public.genereer_factuur(p_order_ids bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id BIGINT;
  v_factuur_nr TEXT;
  v_debiteur_nr INTEGER;
  v_debiteur debiteuren%ROWTYPE;
  v_eerste_order orders%ROWTYPE;
  v_btw_regeling RECORD;
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

  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(p_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal;

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Order(s) % zijn al volledig gefactureerd — geen regels te factureren', p_order_ids
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_debiteur_nr;

  -- Mig 456: BTW-regeling op basis van de eerste order in de array.
  SELECT * INTO v_eerste_order FROM orders WHERE id = p_order_ids[1];

  SELECT * INTO v_btw_regeling
    FROM bepaal_btw_regeling(
      v_eerste_order.afl_land, v_debiteur.land, v_eerste_order.afhalen,
      v_debiteur.btw_verlegd_intracom, v_debiteur.btw_nummer, v_debiteur.btw_percentage
    );
  v_btw_pct := v_btw_regeling.effectief_pct;

  -- Mig 456 (gecorrigeerd): geen blokkade hier — zie projecteer_concept_factuur.

  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
    btw_verlegd, btw_regeling, btw_controle_nodig_sinds
  ) VALUES (
    v_factuur_nr, v_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    (v_btw_regeling.regeling = 'eu_b2b_icl'),
    v_btw_regeling.regeling,
    CASE WHEN v_btw_regeling.controle_nodig THEN now() ELSE NULL END
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
  v_totaal     := v_subtotaal + v_btw_bedrag;

  UPDATE facturen
     SET subtotaal = v_subtotaal, btw_bedrag = v_btw_bedrag, totaal = v_totaal
   WHERE id = v_factuur_id;

  RETURN v_factuur_id;
END;
$function$;

COMMENT ON FUNCTION public.genereer_factuur(bigint[]) IS
  'Legacy per_zending-factuur-generatie (mig 117/227), BTW-fix mig 453, '
  'regeling-bewust sinds mig 456. Fallback-tak in factuur-verzenden voor '
  'queue-rijen zonder zending_id (momenteel niet bereikbaar vanuit enige live '
  'enqueue-RPC).';

NOTIFY pgrst, 'reload schema';
