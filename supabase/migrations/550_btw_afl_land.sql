-- Migratie 550: BTW-regeling op afleverland, niet op btw_verlegd_intracom-vlag
--
-- Root-cause: DECOR-UNION (debiteur 331228) had btw_verlegd_intracom = FALSE
-- (handmatig foutief ingesteld) waardoor factuur 2026000390 ten onrechte 21%
-- BTW kreeg in plaats van 0% (intracommunautaire levering naar DE).
--
-- Twee structurele fixes:
--
-- 1. bepaal_btw_regeling: eu_b2b_binnenland_afwijking-tak vervalt.
--    Voor Karpi (uitsluitend B2B) geldt: elke levering aan een ander EU-lid
--    is een ICL (art. 9(2)(b) Wet OB 1968), ongeacht de debiteur-vlag.
--    Afleverland is objectiever dan een handmatige checkbox.
--    btw_verlegd_intracom blijft data voor ICP-opgave, niet meer code-pad.
--
-- 2. projecteer_concept_factuur: bepaal_btw_regeling-aanroep hersteld
--    (was weggevallen bij mig 529/532 die de volledige functie overschreven
--    zonder de mig-456/518-logica mee te nemen — drift-patroon).
--    Superset van mig 532 (toeslag-activatie op created_at + procent-snapshot).
--
-- 3. One-time herstel factuur 2026000390 (DECOR-UNION):
--    btw_verlegd: false → true, btw_percentage: 21% → 0%,
--    totaal: 53.32 → 44.07 (subtotaal, geen BTW).
--    Queue-entry reset naar pending met gefinaliseerd_op bewaard →
--    drain re-mailt alleen (geen her-finalisatie → geen flip-fout).
--

-- ── 1. bepaal_btw_regeling ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bepaal_btw_regeling(
  p_afl_land       TEXT,
  p_debiteur_land  TEXT,
  p_afhalen        BOOLEAN,
  p_verlegd_vlag   BOOLEAN,
  p_btw_nummer     TEXT,
  p_btw_percentage NUMERIC
)
RETURNS TABLE(
  regeling         TEXT,
  effectief_pct    NUMERIC,
  controle_nodig   BOOLEAN,
  controle_reden   TEXT,
  land_iso2        TEXT
)
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_land_bron TEXT;
  v_iso2      TEXT;
BEGIN
  -- Afhalen: Karpi heeft geen vervoersbewijs naar het land waar de klant zelf
  -- naartoe rijdt — behandel als binnenlands (conservatieve aanname).
  IF COALESCE(p_afhalen, FALSE) THEN
    v_land_bron := p_debiteur_land;
  ELSE
    v_land_bron := COALESCE(NULLIF(TRIM(p_afl_land), ''), p_debiteur_land);
  END IF;

  v_iso2 := normaliseer_land(v_land_bron);

  -- Geval 1: geen land af te leiden (order én debiteur leeg) — veilig
  -- terugvallen op binnenlands gedrag. GEEN blokkade: 62% van de actieve
  -- debiteuren heeft een leeg land-veld (legacy NL-klanten).
  IF v_iso2 IS NULL THEN
    RETURN QUERY SELECT
      'nl_binnenland'::TEXT,
      effectief_btw_pct(p_verlegd_vlag, p_btw_percentage),
      FALSE,
      NULL::TEXT,
      NULL::TEXT;
    RETURN;
  END IF;

  -- Geval 2: NL (binnenland) — gewoon het debiteur-tarief, geen controle.
  IF v_iso2 = 'NL' THEN
    RETURN QUERY SELECT
      'nl_binnenland'::TEXT,
      effectief_btw_pct(p_verlegd_vlag, p_btw_percentage),
      FALSE,
      NULL::TEXT,
      v_iso2;
    RETURN;
  END IF;

  -- Geval 3: andere EU-lidstaat — altijd ICL, 0% BTW (mig 550).
  -- eu_b2b_binnenland_afwijking-tak vervalt: Karpi levert uitsluitend B2B,
  -- dus elk ander EU-lid = ICL (art. 9(2)(b) Wet OB 1968). De debiteur-vlag
  -- btw_verlegd_intracom was handmatig en kon foutief staan (DECOR-UNION).
  -- Ontbrekend btw-nummer → advisory (ICP-verplichting, mig 164-besluit, niet
  -- blokkerend — blijft ongewijzigd).
  IF is_eu_land(v_iso2) THEN
    RETURN QUERY SELECT
      'eu_b2b_icl'::TEXT,
      0.00::NUMERIC(5,2),
      (p_btw_nummer IS NULL OR TRIM(p_btw_nummer) = ''),
      CASE WHEN p_btw_nummer IS NULL OR TRIM(p_btw_nummer) = ''
        THEN 'EU-intracommunautaire levering zonder btw-nummer bij de afnemer — controleer voor de ICP-opgave.'
        ELSE NULL END,
      v_iso2;
    RETURN;
  END IF;

  -- Geval 4: buiten de EU — export, 0% met exportbewijs. Altijd controle_nodig:
  -- geen exportbewijs-tracking (bewust buiten scope) en 0% mag niet stilzwijgend
  -- ontstaan zonder menselijke bevestiging.
  RETURN QUERY SELECT
    'export_buiten_eu'::TEXT,
    0.00::NUMERIC(5,2),
    TRUE,
    format('Afleverland (%s) ligt buiten de EU — exportlevering, in principe 0%% BTW mits exportbewijs. Controleer en bevestig.', v_iso2),
    v_iso2;
END;
$function$;

COMMENT ON FUNCTION public.bepaal_btw_regeling IS
'BTW-regeling per order/factuur op basis van afleverland (mig 455, herschreven mig 550).
Mig 550: eu_b2b_binnenland_afwijking-tak vervalt — EU-afleverland altijd eu_b2b_icl (ICL,
0%), ongeacht btw_verlegd_intracom-vlag (handmatig en foutgevoelig). 4 regelingen:
nl_binnenland (NL of geen land), eu_b2b_icl (EU niet-NL, 0%), export_buiten_eu (0% mits
exportbewijs, hard-block). p_verlegd_vlag nog meegestuurd voor backward-compat maar bepaalt
de regeling niet meer voor EU-landen.';

-- ── 2. projecteer_concept_factuur ─────────────────────────────────────────────
-- Superset van mig 532 (toeslag created_at + procent-snapshot) met herstel van
-- de bepaal_btw_regeling-aanroep (was weggevallen in mig 529/532 — drift).
-- Nieuw: btw_verlegd/btw_regeling/btw_controle_nodig_sinds via de regeling-output
-- i.p.v. direct van debiteuren.btw_verlegd_intracom.

CREATE OR REPLACE FUNCTION public.projecteer_concept_factuur(
  p_zending_id BIGINT,
  p_factuur_id BIGINT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
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
  v_subtotaal             NUMERIC(12,2);
  v_btw_bedrag            NUMERIC(12,2);
  v_totaal                NUMERIC(12,2);
  v_bundel_subtotaal      NUMERIC(12,2);
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

  IF (SELECT COUNT(DISTINCT debiteur_nr) FROM orders WHERE id = ANY(v_order_ids)) > 1 THEN
    RAISE EXCEPTION 'Bundel-zending % kruist debiteur-grens (orders %)',
      p_zending_id, v_order_ids;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren
   WHERE debiteur_nr = (SELECT DISTINCT debiteur_nr FROM orders WHERE id = ANY(v_order_ids));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Geen debiteur voor orders %', v_order_ids;
  END IF;

  -- Mig 550 (hersteld van mig 456/518): eerste order als representatief
  -- afleverland. Bundel-zending is al gegroepeerd op genormaliseerd adres, dus
  -- gemengd-land-binnen-1-bundel is een laag restrisico.
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

  -- Toeslag-activatie (mig 532): geldig als toeslag_actief=TRUE EN ALLE orders
  -- in de zending zijn aangemaakt binnen de periode begindatum..einddatum.
  -- BOOL_AND over lege set = NULL → FALSE → geen toeslag (veilig).
  v_toeslag_actief := COALESCE(v_debiteur.toeslag_actief, FALSE)
    AND v_debiteur.toeslag_procent IS NOT NULL
    AND (
        SELECT BOOL_AND(
            o.created_at::date >= COALESCE(v_debiteur.toeslag_begindatum, 'infinity'::date)
            AND o.created_at::date <= COALESCE(v_debiteur.toeslag_einddatum, 'infinity'::date)
        )
        FROM orders o WHERE o.id = ANY(v_order_ids)
    );

  -- No-op-guard: faal vroeg als alle regels al gefactureerd zijn.
  -- pick_backorder-filter (mig 518/hersteld): regels met actieve
  -- backorder-markering worden nooit gefactureerd — gelijk aan finaliseer.
  SELECT COUNT(*) INTO v_aantal_te_factureren
    FROM order_regels orr
   WHERE orr.order_id = ANY(v_order_ids)
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
  -- TOESLAG (pseudo-orderregel) → eigen totaal-sectie (mig 529).
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
    AND COALESCE(orr.artikelnr, '') NOT IN ('BUNDELKORTING', 'DREMPELKORTING', 'TOESLAG')
  ORDER BY orr.order_id, orr.regelnummer;

  -- Product-subtotaal (excl. VERZEND) = grondslag voor toeslag + drempel-check.
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
  END;

  -- Toeslag-berekening (mig 529): grondslag = v_bundel_subtotaal (product excl. VERZEND).
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
$$;

COMMENT ON FUNCTION public.projecteer_concept_factuur IS
'Bouwt een concept-factuur vanuit zending-data; herhaalbaar (DELETE regels + rebuild op
bestaand factuur_id), géén side-effects (zie finaliseer_concept_factuur).
BTW-regeling via bepaal_btw_regeling (mig 455, afl_land-bewust) — hersteld mig 550 na
regressie mig 529/532 (toeslag mig 529/532, created_at-check mig 532 bewaard).
btw_verlegd/(regeling=eu_b2b_icl), btw_regeling, btw_controle_nodig_sinds snapshot op
factuur. GEEN blokkade hier (zie factuur-verzenden HARD_BLOCK_REGELINGEN).';

-- ── 3. One-time herstel factuur 2026000390 (DECOR-UNION) ─────────────────────
-- Oorzaak: btw_verlegd_intracom = FALSE op debiteur 331228 + mig-529/532-regressie
-- → 21% BTW in plaats van 0% ICL. Factuur 436 wordt direct gecorrigeerd.
-- Correcte waarden: btw_verlegd=true, btw_percentage=0, btw_bedrag=0,
-- totaal=subtotaal(44.07), btw_regeling='eu_b2b_icl', btw_controle_nodig_sinds=now()
-- (advisory: geen BTW-nummer bij DECOR-UNION, mig 164-besluit niet-blokkerend).

DO $$
DECLARE
  v_factuur_id  BIGINT;
  v_subtotaal   NUMERIC(12,2);
  v_queue_id    BIGINT;
BEGIN
  SELECT id, subtotaal INTO v_factuur_id, v_subtotaal
    FROM facturen WHERE factuur_nr = '2026000390';

  IF v_factuur_id IS NULL THEN
    RAISE NOTICE 'Factuur 2026000390 niet gevonden — herstel overgeslagen';
    RETURN;
  END IF;

  -- Corrigeer factuur-header
  UPDATE facturen SET
    btw_verlegd              = TRUE,
    btw_percentage           = 0.00,
    btw_bedrag               = 0.00,
    totaal                   = v_subtotaal,
    btw_regeling             = 'eu_b2b_icl',
    btw_controle_nodig_sinds = now()  -- advisory: geen BTW-nummer (ICP-controle)
  WHERE id = v_factuur_id;

  -- Corrigeer alle factuurregels
  UPDATE factuur_regels
    SET btw_percentage = 0.00
  WHERE factuur_id = v_factuur_id;

  -- Reset queue-entry voor re-mail:
  -- gefinaliseerd_op blijft BEWAARD → drain slaat finalisatie over en re-mailt
  -- alleen (idempotent-patroon mig 428: "drain finaliseert alleen als NULL is,
  -- daarna enkel (her)mailen"). beschikbaar_op=now() → direct claimbaar.
  SELECT id INTO v_queue_id FROM factuur_queue WHERE factuur_id = v_factuur_id LIMIT 1;

  IF v_queue_id IS NOT NULL THEN
    UPDATE factuur_queue SET
      status             = 'pending',
      attempts           = 0,
      last_error         = NULL,
      beschikbaar_op     = now(),
      processing_started_at = NULL
    WHERE id = v_queue_id;

    RAISE NOTICE 'Factuur % (id=%) gecorrigeerd naar 0%% BTW. Queue-entry % gereset voor re-mail.',
      '2026000390', v_factuur_id, v_queue_id;
  ELSE
    RAISE NOTICE 'Factuur % gecorrigeerd maar geen queue-entry gevonden — re-mail handmatig triggeren.',
      '2026000390';
  END IF;
END;
$$;
