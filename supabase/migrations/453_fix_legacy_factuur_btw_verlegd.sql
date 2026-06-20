-- Migratie 453: fix btw_verlegd in genereer_factuur_voor_week + genereer_factuur
--
-- Vervolg op mig 449 (projecteer_concept_factuur): bij het nalopen van álle
-- functies die INSERT INTO facturen doen (2026-06-20), bleek dezelfde bug —
-- geen btw_verlegd-kolom in de INSERT, v_btw_pct via kale
-- COALESCE(btw_percentage, 21.00) i.p.v. effectief_btw_pct(verlegd, pct) —
-- ook in twee legacy-paden te zitten:
--
--   - genereer_factuur_voor_week: nog actief gebeld door factuur-verzenden
--     voor debiteuren met factuurvoorkeur='wekelijks' (op dit moment 0
--     debiteuren, dus geen acute schade, maar wel een latente bug zodra er
--     ooit een wekelijkse + btw_verlegd-debiteur bij komt).
--   - genereer_factuur: legacy fallback-tak in factuur-verzenden (zending_id
--     NULL + type≠'wekelijks'); op dit moment niet bereikbaar vanuit enige
--     live enqueue-RPC, maar de code-pad bestaat nog.
--
-- genereer_factuur_voor_bundel (mig 341, vervangen door mig 428) is NIET
-- meegenomen: geverifieerd dat geen enkele edge function of SQL-functie
-- 'm nog aanroept — echt dode code, geen migratie-churn waard.
--
-- Verder gedragsneutraal.

CREATE OR REPLACE FUNCTION public.genereer_factuur_voor_week(p_debiteur_nr integer, p_jaar_week text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_debiteur             debiteuren%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
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

  -- Mig 453-fix: effectief BTW-tarief via de gedeelde seam (verlegd → 0%).
  v_btw_pct := effectief_btw_pct(v_debiteur.btw_verlegd_intracom, v_debiteur.btw_percentage);
  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  -- Verzamel orders van deze (debiteur, week) die nog niet gefactureerd zijn.
  -- Bron-van-waarheid voor week is `orders.afleverdatum` (NIET zendingen.
  -- verzendweek, want één order kan meerdere zendingen hebben — bv. spoed
  -- + restant — die in verschillende weken vallen; in zo'n geval splitst de
  -- factuur over meerdere weken via separate cron-runs).
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
    btw_verlegd
  ) VALUES (
    v_factuur_nr, p_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    COALESCE(v_debiteur.btw_verlegd_intracom, FALSE)
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
  -- Drempel-toets per bundel op het bundel-subtotaal (som van order_regels.
  -- bedrag voor orders die gekoppeld zijn aan déze zending via M2M).
  --
  -- Volgnummer voor verzending-regels: na de hoogste product-regelnummer.
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
       -- Alleen Verzonden-keten zendingen tellen (Klaar voor verzending+).
       -- 'Picken' is nog niet uit de deur — die orders zouden niet 'Verzonden'-
       -- order-status moeten hebben, dus de array-filter dekt dat al af, maar
       -- defensief.
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd')
     ORDER BY z.id
  LOOP
    -- Bundel-subtotaal: som van factuur_regels.bedrag voor orders die aan
    -- déze zending gekoppeld zijn én op deze factuur staan.
    SELECT COALESCE(SUM(fr.bedrag), 0)::NUMERIC(12,2),
           COUNT(DISTINCT fr.order_id)::INTEGER
      INTO v_bundel_subtotaal, v_aantal_orders_bundel
      FROM factuur_regels fr
     WHERE fr.factuur_id = v_factuur_id
       AND fr.order_id IN (
         SELECT zo.order_id FROM zending_orders zo
          WHERE zo.zending_id = v_zending.id
       );

    -- Bundels zonder factureerbare regels (alles al gefactureerd) overslaan.
    IF v_aantal_orders_bundel = 0 THEN
      CONTINUE;
    END IF;

    -- Drempel-toets exact zoals voorgestelde_zending_bundels view (mig 229):
    --   gratis als gratis_verzending OF subtotaal ≥ verzend_drempel
    -- Afhalen-zendingen worden niet getest: vervoerder_code = NULL en
    -- z.status zou theoretisch 'Klaar voor verzending' kunnen zijn, maar mig
    -- 205 (afhalen_skip_vervoerder) zorgt dat er geen zending wordt
    -- aangemaakt. Defensief: vervoerder_code IS NULL → geen verzendkosten.
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
      -- order_id koppelt naar de eerste order van deze bundel — voorkomt
      -- NULL en biedt EDI-context.
      (SELECT MIN(zo.order_id) FROM zending_orders zo WHERE zo.zending_id = v_zending.id),
      NULL,                            -- geen specifieke order_regel
      v_volgnr,
      'VERZEND',
      v_omschrijving,
      1, v_te_betalen, 0, v_te_betalen, v_btw_pct
    );
  END LOOP;

  -- Eindtotalen herberekenen op alle regels (product + verzending).
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

CREATE OR REPLACE FUNCTION public.genereer_factuur(p_order_ids bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
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

  -- Mig 453-fix: effectief BTW-tarief via de gedeelde seam (verlegd → 0%).
  v_btw_pct := effectief_btw_pct(v_debiteur.btw_verlegd_intracom, v_debiteur.btw_percentage);

  IF v_debiteur.betaalconditie ~ '^\d+' THEN
    v_betaaltermijn_dagen := (regexp_match(v_debiteur.betaalconditie, '^(\d+)'))[1]::INTEGER;
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer,
    btw_verlegd
  ) VALUES (
    v_factuur_nr, v_debiteur_nr, CURRENT_DATE, CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer,
    COALESCE(v_debiteur.btw_verlegd_intracom, FALSE)
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

COMMENT ON FUNCTION public.genereer_factuur_voor_week(integer, text) IS
  'Legacy wekelijkse-verzamelfactuur-generatie (mig 117/122/231), nog actief '
  'voor factuurvoorkeur=wekelijks-debiteuren (momenteel 0). Btw_verlegd/'
  'effectief btw-tarief via debiteuren.btw_verlegd_intracom + effectief_btw_pct() '
  '(mig 371-seam) toegevoegd in mig 453 — ontbrak sinds oorsprong.';

COMMENT ON FUNCTION public.genereer_factuur(bigint[]) IS
  'Legacy per_zending-factuur-generatie (mig 117/227), fallback-tak in '
  'factuur-verzenden voor queue-rijen zonder zending_id (momenteel niet '
  'bereikbaar vanuit enige live enqueue-RPC). Btw_verlegd/effectief btw-tarief '
  'toegevoegd in mig 453 — ontbrak sinds oorsprong, zelfde fix als mig 449/453.';
