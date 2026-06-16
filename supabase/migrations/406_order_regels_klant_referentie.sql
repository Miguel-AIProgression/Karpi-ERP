-- Migratie 406: klant_referentie per orderregel
--
-- Aanleiding: operators noteren soms een klantreferentie per afzonderlijke
-- orderregel (bv. "REF Hugo / Veyron", "ref Frankfurt / Anita"). Die is anders
-- dan orders.klant_referentie (order-niveau). Wordt getoond op orderbevestiging
-- en factuur per regel.
--
-- Vier onderdelen:
-- 1. Kolom order_regels.klant_referentie TEXT
-- 2. Kolom factuur_regels.klant_referentie TEXT (snapshot bij genereer_factuur)
-- 3. RPC's create_order_with_lines + update_order_with_lines: lezen r->>'klant_referentie'
-- 4. genereer_factuur_voor_bundel: schrijft order_regels.klant_referentie naar factuur_regels.klant_referentie
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.

-- ============================================================
-- Deel 1 — kolommen
-- ============================================================

ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS klant_referentie TEXT;

COMMENT ON COLUMN order_regels.klant_referentie IS
  'Mig 406: per-orderregel klantreferentie (bv. "REF Hugo / Veyron"). '
  'Verschijnt op orderbevestiging en factuur per regel. '
  'Onderscheiden van orders.klant_referentie (order-niveau).';

ALTER TABLE factuur_regels
  ADD COLUMN IF NOT EXISTS klant_referentie TEXT;

COMMENT ON COLUMN factuur_regels.klant_referentie IS
  'Mig 406: snapshot van order_regels.klant_referentie op factureer-moment.';

-- ============================================================
-- Deel 2 — create_order_with_lines (body = mig 152 + klant_referentie per regel)
-- ============================================================

CREATE OR REPLACE FUNCTION create_order_with_lines(p_order JSONB, p_regels JSONB)
RETURNS JSONB AS $$
DECLARE
    v_order_nr TEXT;
    v_order_id BIGINT;
BEGIN
    v_order_nr := volgend_nummer('ORD');

    INSERT INTO orders (
        order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
        week, vertegenw_code, betaler, inkooporganisatie,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
        lever_modus,
        status
    ) VALUES (
        v_order_nr,
        (p_order->>'debiteur_nr')::INTEGER,
        COALESCE((p_order->>'orderdatum')::DATE, CURRENT_DATE),
        (p_order->>'afleverdatum')::DATE,
        p_order->>'klant_referentie',
        p_order->>'week',
        p_order->>'vertegenw_code',
        (p_order->>'betaler')::INTEGER,
        p_order->>'inkooporganisatie',
        p_order->>'fact_naam', p_order->>'fact_adres',
        p_order->>'fact_postcode', p_order->>'fact_plaats', p_order->>'fact_land',
        p_order->>'afl_naam', p_order->>'afl_naam_2',
        p_order->>'afl_adres', p_order->>'afl_postcode',
        p_order->>'afl_plaats', p_order->>'afl_land',
        NULLIF(p_order->>'lever_modus', ''),
        'Nieuw'
    ) RETURNING id INTO v_order_id;

    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code,
        klant_referentie
    )
    SELECT
        v_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        (r->>'prijs')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        (r->>'bedrag')::NUMERIC,
        (r->>'gewicht_kg')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        (r->>'maatwerk_lengte_cm')::INTEGER,
        (r->>'maatwerk_breedte_cm')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code',
        NULLIF(r->>'klant_referentie', '')
    FROM jsonb_array_elements(p_regels) AS r;

    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Deel 3 — update_order_with_lines (body = mig 152 + klant_referentie per regel)
-- ============================================================

CREATE OR REPLACE FUNCTION update_order_with_lines(p_order_id BIGINT, p_header JSONB, p_regels JSONB)
RETURNS VOID AS $$
BEGIN
    UPDATE orders SET
        klant_referentie = p_header->>'klant_referentie',
        afleverdatum = (p_header->>'afleverdatum')::DATE,
        week = p_header->>'week',
        vertegenw_code = p_header->>'vertegenw_code',
        betaler = (p_header->>'betaler')::INTEGER,
        inkooporganisatie = p_header->>'inkooporganisatie',
        fact_naam = p_header->>'fact_naam', fact_adres = p_header->>'fact_adres',
        fact_postcode = p_header->>'fact_postcode', fact_plaats = p_header->>'fact_plaats',
        fact_land = p_header->>'fact_land',
        afl_naam = p_header->>'afl_naam', afl_naam_2 = p_header->>'afl_naam_2',
        afl_adres = p_header->>'afl_adres', afl_postcode = p_header->>'afl_postcode',
        afl_plaats = p_header->>'afl_plaats', afl_land = p_header->>'afl_land',
        lever_modus = CASE
          WHEN p_header ? 'lever_modus'
            THEN NULLIF(p_header->>'lever_modus', '')
          ELSE lever_modus
        END
    WHERE id = p_order_id;

    DELETE FROM order_regels WHERE order_id = p_order_id;

    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code,
        klant_referentie
    )
    SELECT
        p_order_id,
        (r->>'regelnummer')::INTEGER,
        r->>'artikelnr',
        r->>'karpi_code',
        r->>'omschrijving',
        r->>'omschrijving_2',
        (r->>'orderaantal')::INTEGER,
        (r->>'te_leveren')::INTEGER,
        (r->>'prijs')::NUMERIC,
        COALESCE((r->>'korting_pct')::NUMERIC, 0),
        (r->>'bedrag')::NUMERIC,
        (r->>'gewicht_kg')::NUMERIC,
        r->>'fysiek_artikelnr',
        COALESCE((r->>'omstickeren')::BOOLEAN, false),
        COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        r->>'maatwerk_vorm',
        (r->>'maatwerk_lengte_cm')::INTEGER,
        (r->>'maatwerk_breedte_cm')::INTEGER,
        r->>'maatwerk_afwerking',
        r->>'maatwerk_band_kleur',
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code',
        NULLIF(r->>'klant_referentie', '')
    FROM jsonb_array_elements(p_regels) AS r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_order_with_lines(JSONB, JSONB) IS
  'Mig 406: leest r->>klant_referentie per regel (was mig 152 lever_modus).';

COMMENT ON FUNCTION update_order_with_lines(BIGINT, JSONB, JSONB) IS
  'Mig 406: leest r->>klant_referentie per regel (was mig 152 lever_modus).';

-- ============================================================
-- Deel 4 — genereer_factuur_voor_bundel
-- (body = mig 371 + klant_referentie in factuur_regels INSERT)
-- ============================================================

CREATE OR REPLACE FUNCTION genereer_factuur_voor_bundel(p_zending_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_factuur_id           BIGINT;
  v_factuur_nr           TEXT;
  v_zending              zendingen%ROWTYPE;
  v_debiteur             debiteuren%ROWTYPE;
  v_btw_pct              NUMERIC(5,2);
  v_btw_verlegd          BOOLEAN := FALSE;
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

  v_btw_verlegd := COALESCE(v_debiteur.btw_verlegd_intracom, FALSE);
  v_btw_pct     := effectief_btw_pct(v_debiteur.btw_verlegd_intracom, v_debiteur.btw_percentage);
  v_betaaltermijn_dagen := betaaltermijn_dagen(v_debiteur.betaalconditie);

  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
     AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
     AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  IF v_aantal_te_factureren = 0 THEN
    RAISE EXCEPTION 'Zending % heeft geen te-factureren regels', p_zending_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_factuur_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal, btw_verlegd,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, btw_nummer
  ) VALUES (
    v_factuur_nr, v_debiteur.debiteur_nr, CURRENT_DATE,
    CURRENT_DATE + v_betaaltermijn_dagen, 'Concept',
    0, v_btw_pct, 0, 0, v_btw_verlegd,
    COALESCE(v_debiteur.fact_naam, v_debiteur.naam),
    COALESCE(v_debiteur.fact_adres, v_debiteur.adres),
    COALESCE(v_debiteur.fact_postcode, v_debiteur.postcode),
    COALESCE(v_debiteur.fact_plaats, v_debiteur.plaats),
    v_debiteur.land,
    v_debiteur.btw_nummer
  ) RETURNING id INTO v_factuur_id;

  -- Mig 406: klant_referentie van de orderregel wordt als snapshot meegenomen.
  INSERT INTO factuur_regels (
    factuur_id, order_id, order_regel_id, regelnummer,
    artikelnr, omschrijving, omschrijving_2,
    uw_referentie, order_nr,
    klant_referentie,
    aantal, prijs, korting_pct, bedrag, btw_percentage
  )
  SELECT
    v_factuur_id, orr.order_id, orr.id, orr.regelnummer,
    orr.artikelnr, orr.omschrijving, orr.omschrijving_2,
    o.klant_referentie, o.order_nr,
    orr.klant_referentie,
    orr.orderaantal, orr.prijs, COALESCE(orr.korting_pct, 0), orr.bedrag, v_btw_pct
  FROM order_regels orr
  JOIN orders o ON o.id = orr.order_id
  WHERE orr.order_id = ANY(v_order_ids)
    AND COALESCE(orr.gefactureerd, 0) < orr.orderaantal
    AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING')
  ORDER BY orr.order_id, orr.regelnummer;

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND COALESCE(artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

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

  DECLARE
    v_aantal_verzend_regels   INTEGER;
    v_verzendkosten_per_order NUMERIC(8,2);
    v_korting_regelnr         INTEGER;
    v_order_idx               INTEGER;
    v_target_order_id         BIGINT;
    v_target_order_nr         TEXT;
    v_target_uw_referentie    TEXT;
    v_admin_regelnr           INTEGER;
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

    -- 3a) DREMPELKORTING-orderregel op order[1]
    IF v_vk.status = 'gratis_drempel'
       AND v_aantal_verzend_regels > 0
       AND v_verzendkosten_per_order > 0 THEN
      SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
        FROM order_regels WHERE order_id = v_order_ids[1];
      INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, omschrijving,
        orderaantal, te_leveren, gefactureerd,
        prijs, korting_pct, bedrag, gewicht_kg
      ) VALUES (
        v_order_ids[1], v_admin_regelnr, 'DREMPELKORTING',
        format('Drempelkorting verzending — vanaf €%s',
          to_char(v_debiteur.verzend_drempel, 'FM999999.00')),
        1, 0, 1,
        -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, 0
      );
    END IF;

    -- 3b) BUNDELKORTING-orderregels op order[2..N]
    IF v_verzendkosten_per_order > 0 AND v_aantal_verzend_regels > 1 THEN
      FOR v_order_idx IN 2..array_length(v_order_ids, 1) LOOP
        v_target_order_id := v_order_ids[v_order_idx];

        SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
          FROM order_regels WHERE order_id = v_target_order_id;
        INSERT INTO order_regels (
          order_id, regelnummer, artikelnr, omschrijving,
          orderaantal, te_leveren, gefactureerd,
          prijs, korting_pct, bedrag, gewicht_kg
        ) VALUES (
          v_target_order_id, v_admin_regelnr, 'BUNDELKORTING',
          format('Bundelkorting verzending (gebundeld %s orders)',
            v_aantal_verzend_regels),
          1, 0, 1,
          -v_verzendkosten_per_order, 0, -v_verzendkosten_per_order, 0
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

COMMENT ON FUNCTION genereer_factuur_voor_bundel(BIGINT) IS
  'Mig 406: klant_referentie per orderregel snapshot in factuur_regels (was mig 371 btw_verlegd).';

NOTIFY pgrst, 'reload schema';
