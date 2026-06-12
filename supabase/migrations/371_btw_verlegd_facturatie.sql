-- Migratie 371: BTW verlegd intracom in de facturatie
--
-- Aanleiding: verzoek Marjon (2026-06-11) — Duitse klanten kregen 21% BTW op de
-- factuur terwijl `debiteuren.btw_verlegd_intracom` (mig 164) al TRUE stond.
-- De factuur-RPC keek alleen naar `debiteuren.btw_percentage`; de EDI
-- factuur-mapper checkte de vlag wél, waardoor PDF en INVOIC elkaar
-- tegenspraken. Spec: docs/superpowers/specs/2026-06-11-btw-verlegd-intracom-design.md
--
-- Drie onderdelen:
--   1. Helper `effectief_btw_pct(verlegd, btw_percentage)` — single source of
--      truth voor het effectieve BTW-percentage (verlegd wint altijd: 0%).
--   2. Snapshot-kolom `facturen.btw_verlegd` — vlag op factuur-aanmaak zodat
--      de PDF de wettelijke vermelding "BTW verlegd" kan tonen.
--   3. `genereer_factuur_voor_bundel` (enige live factuur-RPC sinds mig 240)
--      verlegd-aware: v_btw_pct via de helper + snapshot in de INSERT.
--      Body verder byte-voor-byte gelijk aan mig 341.
--
-- Idempotent: CREATE OR REPLACE + ADD COLUMN IF NOT EXISTS.

-- ============================================================
-- Deel 1 — helper: effectief BTW-percentage
-- ============================================================

CREATE OR REPLACE FUNCTION effectief_btw_pct(p_verlegd BOOLEAN, p_btw_percentage NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN COALESCE(p_verlegd, FALSE) THEN 0::NUMERIC(5,2)
              ELSE COALESCE(p_btw_percentage, 21.00) END;
$$;

COMMENT ON FUNCTION effectief_btw_pct(BOOLEAN, NUMERIC) IS
  'Mig 371: effectief BTW-percentage voor een debiteur. Verlegd (intracom) wint altijd: 0%. Anders het per-debiteur percentage met fallback 21. Gespiegeld in supabase/functions/_shared/btw.ts (effectiefBtwPct).';

-- ============================================================
-- Deel 2 — snapshot-kolom op facturen
-- ============================================================

ALTER TABLE facturen ADD COLUMN IF NOT EXISTS btw_verlegd BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN facturen.btw_verlegd IS
  'Mig 371: snapshot van debiteuren.btw_verlegd_intracom op factuur-aanmaak. TRUE → 0% BTW met wettelijke vermelding "BTW verlegd" op de PDF.';

-- ============================================================
-- Deel 3 — verlegd-aware factuur-RPC (body = mig 341 + 3 wijzigingen)
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

  -- Kopie van product- + VERZEND-orderregels (1 regel per order x regel).
  -- BUNDELKORTING/DREMPELKORTING uitsluiten — die voegen we als gespreide
  -- factuur-regels hieronder toe met expliciete order_id/order_nr.
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

  UPDATE order_regels
     SET gefactureerd = orderaantal
   WHERE order_id = ANY(v_order_ids)
     AND COALESCE(gefactureerd, 0) < orderaantal
     AND COALESCE(artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING');

  -- Verzendkosten-status (mig 234) — alleen v_vk.status nodig om te beslissen
  -- of DREMPELKORTING van toepassing is.
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

  -- Korting-factuur-regels gespreid per order, symmetrisch met orderregel-mirror.
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

    -- 3a) DREMPELKORTING-orderregel op order[1] — óók bij N=1 + gratis_drempel
    -- (symmetrisch met factuur-conditie hierboven; vóór review-fix stond hier
    -- per ongeluk `v_aantal_verzend_regels > 1` waardoor single-order zending
    -- boven drempel wel een DREMPEL-factuurregel kreeg maar geen orderregel —
    -- discrepantie tussen factuur en orderregel-som).
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

    -- 3b) BUNDELKORTING-orderregels op order[2..N] — alleen bij echte bundel.
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
  'Mig 371: BTW verlegd intracom — v_btw_pct via effectief_btw_pct() en '
  'btw_verlegd-snapshot op de factuur. Body verder identiek aan mig 341 '
  '(V2-layout, kortingen gespreid, betaaltermijn_dagen-helper).';

NOTIFY pgrst, 'reload schema';
