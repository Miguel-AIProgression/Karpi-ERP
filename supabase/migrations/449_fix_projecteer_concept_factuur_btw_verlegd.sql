-- Migratie 449: fix btw_verlegd-snapshot in projecteer_concept_factuur (mig 428)
--
-- Bug gevonden 2026-06-20 bij onderzoek naar het CBS-statistieknummer-werk
-- (mig 446-448): facturen vanaf FACT-2026-0009 (19-06-2026) voor debiteuren
-- met `btw_verlegd_intracom=true` (BDSK, Campaert, Gero, etc.) kregen
-- `facturen.btw_verlegd=false` + het volle BTW-percentage (21%) — 24
-- facturen, € 1.444,52 ten onrechte berekende BTW.
--
-- Oorzaak: de mig-428-split van `genereer_factuur_voor_bundel` (mig 341) in
-- `projecteer_concept_factuur` + `finaliseer_concept_factuur` nam de
-- BTW-verlegd-logica niet over. `v_btw_pct` werd berekend als kale
-- `COALESCE(v_debiteur.btw_percentage, 21.00)` i.p.v. via de gedeelde seam
-- `effectief_btw_pct(verlegd, pct)` (mig 371/`_shared/btw.ts`), en
-- `facturen.btw_verlegd` werd nergens gezet (INSERT-kolomlijst miste 'm,
-- dus viel terug op de kolom-default `false`). `finaliseer_concept_factuur`
-- roept alleen `projecteer_concept_factuur` aan (geen eigen header-update),
-- dus de fix hier dekt beide paden.
--
-- Fix: `v_btw_pct` via `effectief_btw_pct`; `btw_verlegd` toegevoegd aan
-- zowel de INSERT (nieuwe concept-factuur) als de UPDATE (verse rebuild op
-- bestaande factuur_id) tak. Verder gedragsneutraal.
--
-- Historische 24 foutieve facturen: NIET in deze migratie gecorrigeerd —
-- apart traject (credit/hercalculatie), zie gebruiker-overleg.

CREATE OR REPLACE FUNCTION public.projecteer_concept_factuur(p_zending_id bigint, p_factuur_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
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

  -- Mig 449-fix: effectief BTW-tarief via de gedeelde seam (verlegd → 0%).
  v_btw_pct := effectief_btw_pct(v_debiteur.btw_verlegd_intracom, v_debiteur.btw_percentage);
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
      fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
      btw_verlegd
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
      COALESCE(v_debiteur.btw_verlegd_intracom, FALSE)
    ) RETURNING id INTO v_factuur_id;
  ELSE
    v_factuur_id := p_factuur_id;
    -- Verse rebuild: wis de oude regels, herwaardeer de header-meta die in het
    -- venster gewijzigd kan zijn (btw/termijn/adres-snapshot). factuurdatum
    -- blijft de concept-datum.
    DELETE FROM factuur_regels WHERE factuur_id = v_factuur_id;
    UPDATE facturen SET
      btw_percentage = v_btw_pct,
      btw_verlegd    = COALESCE(v_debiteur.btw_verlegd_intracom, FALSE),
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
  'Mig 428, gefixt mig 449: projecteert een concept-factuur (header + regels) '
  'voor een zending — herhaalbaar, geen side-effects. Btw_verlegd/effectief '
  'btw-tarief via debiteuren.btw_verlegd_intracom + effectief_btw_pct() (mig 371-seam, '
  'was tot mig 449 abusievelijk niet toegepast).';
