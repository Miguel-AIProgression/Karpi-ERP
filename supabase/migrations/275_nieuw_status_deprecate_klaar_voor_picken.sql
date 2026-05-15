-- Migratie 275: 'Nieuw' deprecate als runtime-status (sluit ADR-0016 af)
--
-- Probleem (zichtbaar 2026-05-13 op orders 2063-2067)
-- ---------------------------------------------------
-- Nieuwe orders verschijnen met badge 'Nieuw' in de UI, terwijl 'Nieuw' sinds
-- ADR-0016 / mig 257-258 (eind april 2026) gedeprecateerd is. Geen filter-tab
-- toont hem (status-tabs telt 'Nieuw' cosmetisch onder 'Klaar voor picken'),
-- geen workflow gebruikt hem.
--
-- Root-cause: drie samenwerkende regressies
-- -----------------------------------------
--   1. Kolom-DEFAULT `orders.status` staat nog op 'Nieuw' (initiële schema).
--   2. `create_order_with_lines` (mig 245 r. 55) schrijft expliciet 'Nieuw'.
--   3. `edi_create_order` (mig 166 r. 130) schrijft expliciet 'Nieuw'.
--   4. `herbereken_wacht_status` (mig 273) is back-geport naar de mig-218-
--      vorm waarin 'Nieuw' weer de default-eindstaat is — de ADR-0016-
--      uitbreidingen (Wacht op maatwerk, Klaar voor picken-target) zijn
--      verloren gegaan toen mig 269/273 het admin-pseudo-filterpatroon
--      introduceerden.
--
-- Deze migratie sluit het gat permanent. 'Nieuw' blijft in het ENUM voor
-- audit-history (oude `order_events`-rijen referencen het), maar wordt
-- voortaan nergens meer als doelstatus geschreven.
--
-- Wijzigingen
-- -----------
--   1. Kolom-DEFAULT van orders.status → 'Klaar voor picken'
--   2. create_order_with_lines → schrijft 'Klaar voor picken'
--   3. edi_create_order → schrijft 'Klaar voor picken'
--   4. herbereken_wacht_status hersteld met mig-258-takken (Wacht op maatwerk
--      + Klaar voor picken-target), is_admin_pseudo()-filter behouden,
--      eindstatus-bescherming uitgebreid met In pickronde / Deels verzonden
--   5. Backfill bestaande 'Nieuw'-orders volgens ADR-0016 §"Backfill"
--
-- Niet aangepast (bewust)
-- -----------------------
--   • ORDER_STATUS_COLORS in frontend behoudt 'Nieuw'-mapping — historische
--     events kunnen het label nog tonen (audit-trail).
--   • Status-tabs UI-fallback (telt 'Nieuw' onder 'Klaar voor picken') wordt
--     in een aparte frontend-commit verwijderd — die kan na deze migratie
--     veilig weg.
--   • `create_webshop_order` (mig 093) zet geen expliciete status — die
--     erft voortaan de nieuwe kolom-DEFAULT.
--
-- Idempotent: CREATE OR REPLACE + WHERE-guards op huidige status.

-- ============================================================================
-- 1. Kolom-DEFAULT verschuiven
-- ============================================================================
ALTER TABLE orders
  ALTER COLUMN status SET DEFAULT 'Klaar voor picken';

COMMENT ON COLUMN orders.status IS
  'Order-lifecycle status. Default ''Klaar voor picken'' (mig 275, ADR-0016). '
  'Schrijfpad: uitsluitend via _apply_transitie binnen Order-lifecycle Module '
  '(mig 218). Legacy waarde ''Nieuw'' blijft in ENUM voor audit-history maar '
  'wordt sinds mig 275 nergens meer als doelstatus geschreven.';

-- ============================================================================
-- 2. create_order_with_lines — schrijft 'Klaar voor picken' (was 'Nieuw')
-- ============================================================================
-- Body identiek aan mig 245 op één regel na: 'Nieuw' → 'Klaar voor picken'.
-- Triggers (trg_orderregel_herallocateer → herbereken_wacht_status) kunnen
-- daarna naar 'Wacht op X' / 'Wacht op maatwerk' transitioneren indien nodig.
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
        afhalen,
        lever_type,
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
        COALESCE((p_order->>'afhalen')::BOOLEAN, false),
        COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
        'Klaar voor picken'
    ) RETURNING id INTO v_order_id;

    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_band_kleur_id, maatwerk_instructies,
        maatwerk_m2_prijs, maatwerk_kostprijs_m2, maatwerk_oppervlak_m2,
        maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, maatwerk_diameter_cm,
        maatwerk_kwaliteit_code, maatwerk_kleur_code
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
        NULLIF(r->>'maatwerk_band_kleur_id', '')::BIGINT,
        r->>'maatwerk_instructies',
        (r->>'maatwerk_m2_prijs')::NUMERIC,
        (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        (r->>'maatwerk_diameter_cm')::INTEGER,
        r->>'maatwerk_kwaliteit_code',
        r->>'maatwerk_kleur_code'
    FROM jsonb_array_elements(p_regels) AS r;

    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_order_with_lines IS
  'Mig 245 + mig 275: maakt order + regels aan, status=''Klaar voor picken'' '
  '(was ''Nieuw'' vóór mig 275, ADR-0016 afronding). Triggers herbereken naar '
  '''Wacht op X'' / ''Wacht op maatwerk'' indien claim/tekort/maatwerk-blokkade '
  'gedetecteerd na regel-INSERT.';

-- ============================================================================
-- 3. edi_create_order — schrijft 'Klaar voor picken' (was 'Nieuw')
-- ============================================================================
-- Body identiek aan mig 166 op één regel na: 'Nieuw' → 'Klaar voor picken'.
-- We laten de rest van de mig-166-body ongemoeid door alleen de RPC opnieuw
-- te definiëren met de aangepaste literal — de signature en parameters zijn
-- identiek.
DO $$
DECLARE
  v_body TEXT;
  v_nieuw_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'edi_create_order'
     AND n.nspname = 'public';

  IF v_body IS NULL THEN
    RAISE NOTICE 'edi_create_order bestaat niet — mig 166 niet gedraaid? Skip.';
    RETURN;
  END IF;

  -- Vervang precies de hardcoded literal in de VALUES-lijst. Het patroon
  -- ''edi', v_transactie_id, 'Nieuw'' is uniek (komt 1× voor in mig 166).
  v_nieuw_body := REPLACE(
    v_body,
    '''edi'', v_transactie_id, ''Nieuw''',
    '''edi'', v_transactie_id, ''Klaar voor picken'''
  );

  IF v_nieuw_body = v_body THEN
    RAISE NOTICE 'edi_create_order: geen ''Nieuw''-literal gevonden om te vervangen — al gepatcht of body veranderd. Skip.';
    RETURN;
  END IF;

  EXECUTE v_nieuw_body;

  RAISE NOTICE 'edi_create_order: literal ''Nieuw'' → ''Klaar voor picken'' (mig 275).';
END $$;

-- ============================================================================
-- 4. herbereken_wacht_status — herstel ADR-0016 takken + admin-pseudo-filter
-- ============================================================================
-- Combinatie van mig 258 §3 (ADR-0016 takken: Wacht op maatwerk, Klaar voor
-- picken-target) met mig 273 §3 (is_admin_pseudo-filter, mig 272). Eindstatus-
-- bescherming uitgebreid met In pickronde / Deels verzonden (commands beheren
-- die transities).
--
-- Volgorde (eerste match wint):
--   1. v_huidig ∈ eindstatussen / actieve pickronde-fases → no-op
--   2. ≥1 actieve IO-claim                                → 'Wacht op inkoop'
--   3. ≥1 regel met tekort (niet-maatwerk, niet-admin)    → 'Wacht op voorraad'
--   4. ≥1 maatwerk-regel zonder snijplan='Ingepakt'       → 'Wacht op maatwerk'
--   5. v_huidig ∈ ('Wacht op X', 'Nieuw')                 → 'Klaar voor picken'
--   6. anders                                              → no-op
CREATE OR REPLACE FUNCTION herbereken_wacht_status(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_huidig         order_status;
  v_heeft_io_claim BOOLEAN;
  v_heeft_tekort   BOOLEAN;
  v_heeft_maatwerk BOOLEAN;
  v_doel           order_status;
BEGIN
  SELECT status INTO v_huidig FROM orders WHERE id = p_order_id;

  -- Eindstatussen + pickronde-fases worden door commands beheerd
  -- (markeer_verzonden, markeer_geannuleerd, markeer_pickronde_gestart,
  -- markeer_deels_verzonden). Recompute raakt ze niet aan. Legacy productie-
  -- statussen blijven ook ongemoeid voor pragmatisch pad (mig 218).
  IF v_huidig IN (
    'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
    'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
    'In pickronde', 'Deels verzonden'
  ) THEN
    RETURN;
  END IF;

  -- 1) Inkoop-claim
  SELECT EXISTS (
    SELECT 1 FROM order_reserveringen r
    JOIN order_regels oreg ON oreg.id = r.order_regel_id
    WHERE oreg.order_id = p_order_id
      AND r.bron = 'inkooporder_regel'
      AND r.status = 'actief'
  ) INTO v_heeft_io_claim;

  -- 2) Voorraad-tekort (alleen vaste-maten, geen admin-pseudo's)
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = false
      AND oreg.artikelnr IS NOT NULL
      AND NOT is_admin_pseudo(oreg.artikelnr)
      AND oreg.te_leveren > COALESCE((
        SELECT SUM(aantal) FROM order_reserveringen r
        WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
      ), 0)
  ) INTO v_heeft_tekort;

  -- 3) Maatwerk-regel zonder ingepakt snijplan = nog niet pickbaar.
  --    Pickbaar = snijplan.status='Ingepakt' (magazijnier kan meenemen).
  --    Geen snijplan + maatwerk → ook 'Wacht op maatwerk' (productie moet
  --    nog inplannen).
  SELECT EXISTS (
    SELECT 1 FROM order_regels oreg
    WHERE oreg.order_id = p_order_id
      AND COALESCE(oreg.is_maatwerk, false) = true
      AND NOT EXISTS (
        SELECT 1 FROM snijplannen sp
        WHERE sp.order_regel_id = oreg.id
          AND sp.status = 'Ingepakt'
      )
  ) INTO v_heeft_maatwerk;

  IF v_heeft_io_claim THEN
    v_doel := 'Wacht op inkoop';
  ELSIF v_heeft_tekort THEN
    v_doel := 'Wacht op voorraad';
  ELSIF v_heeft_maatwerk THEN
    v_doel := 'Wacht op maatwerk';
  ELSIF v_huidig IN ('Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk', 'Nieuw') THEN
    v_doel := 'Klaar voor picken';
  ELSE
    RETURN; -- niets te doen (huidig is bv. al 'Klaar voor picken')
  END IF;

  PERFORM _apply_transitie(
    p_order_id   := p_order_id,
    p_event_type := 'wacht_status_herberekend',
    p_status_na  := v_doel
  );
END;
$$;

GRANT EXECUTE ON FUNCTION herbereken_wacht_status(BIGINT) TO authenticated;

COMMENT ON FUNCTION herbereken_wacht_status IS
  'Mig 218 + 258 (ADR-0016) + 272/273 (ADR-0018) + 275: leest claim-state + '
  'snijplannen + admin-pseudo-flag, kiest Wacht op inkoop / Wacht op voorraad / '
  'Wacht op maatwerk / Klaar voor picken, schrijft via _apply_transitie. '
  'Eindstatussen + pickronde-fases (In pickronde, Deels verzonden) en legacy '
  'productie-statussen worden niet aangeraakt. Admin-pseudo-orderregels '
  '(is_admin_pseudo) tellen NIET mee voor tekort-detectie.';

-- ============================================================================
-- 5. Backfill — classificeer bestaande 'Nieuw'-orders
-- ============================================================================
-- ADR-0016 §"Backfill" volgorde (eerste match wint):
--   1. ≥1 zending in eindstatus én ≥1 open zending → 'Deels verzonden'
--   2. ≥1 zending in ('Picken','Klaar voor verzending') → 'In pickronde'
--   3. ≥1 maatwerk-regel zonder snijplan='Ingepakt' → 'Wacht op maatwerk'
--   4. ≥1 actieve IO-claim → 'Wacht op inkoop'
--   5. ≥1 niet-admin niet-maatwerk-regel met tekort → 'Wacht op voorraad'
--   6. Rest → 'Klaar voor picken'
--
-- Schrijft event_type='backfill_fase_normalisatie' voor audit. Idempotent via
-- WHERE-guard op huidige status. Identiek aan mig 258 §7 met twee aanvullingen:
-- IO-claim-tak (ontbrak daar, want mig 258 ging er nog vanuit dat 'Nieuw' al
-- via herbereken naar Wacht op inkoop zou stromen) en admin-pseudo-filter op
-- de tekort-detectie.
DO $$
DECLARE
  v_order RECORD;
  v_doel  order_status;
  v_open  INTEGER;
  v_eind  INTEGER;
  v_io    BOOLEAN;
  v_mw    BOOLEAN;
  v_tek   BOOLEAN;
BEGIN
  FOR v_order IN
    SELECT id FROM orders WHERE status = 'Nieuw'
  LOOP
    -- Tel open + eindstatus-zendingen via M2M + legacy order_id (mig 222 patroon)
    SELECT COUNT(*) INTO v_open
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order.id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order.id
           )
       AND z.status NOT IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    SELECT COUNT(*) INTO v_eind
      FROM zendingen z
     WHERE z.id IN (
             SELECT zo.zending_id FROM zending_orders zo WHERE zo.order_id = v_order.id
             UNION
             SELECT id FROM zendingen WHERE order_id = v_order.id
           )
       AND z.status IN ('Klaar voor verzending', 'Onderweg', 'Afgeleverd');

    SELECT EXISTS (
      SELECT 1 FROM order_reserveringen r
      JOIN order_regels oreg ON oreg.id = r.order_regel_id
      WHERE oreg.order_id = v_order.id
        AND r.bron = 'inkooporder_regel'
        AND r.status = 'actief'
    ) INTO v_io;

    SELECT EXISTS (
      SELECT 1 FROM order_regels oreg
       WHERE oreg.order_id = v_order.id
         AND COALESCE(oreg.is_maatwerk, false) = true
         AND NOT EXISTS (
           SELECT 1 FROM snijplannen sp
            WHERE sp.order_regel_id = oreg.id
              AND sp.status = 'Ingepakt'
         )
    ) INTO v_mw;

    SELECT EXISTS (
      SELECT 1 FROM order_regels oreg
       WHERE oreg.order_id = v_order.id
         AND COALESCE(oreg.is_maatwerk, false) = false
         AND oreg.artikelnr IS NOT NULL
         AND NOT is_admin_pseudo(oreg.artikelnr)
         AND oreg.te_leveren > COALESCE((
           SELECT SUM(aantal) FROM order_reserveringen r
           WHERE r.order_regel_id = oreg.id AND r.status = 'actief'
         ), 0)
    ) INTO v_tek;

    IF v_eind >= 1 AND v_open >= 1 THEN
      v_doel := 'Deels verzonden';
    ELSIF v_open >= 1 THEN
      v_doel := 'In pickronde';
    ELSIF v_io THEN
      v_doel := 'Wacht op inkoop';
    ELSIF v_tek THEN
      v_doel := 'Wacht op voorraad';
    ELSIF v_mw THEN
      v_doel := 'Wacht op maatwerk';
    ELSE
      v_doel := 'Klaar voor picken';
    END IF;

    PERFORM _apply_transitie(
      p_order_id   := v_order.id,
      p_event_type := 'backfill_fase_normalisatie',
      p_status_na  := v_doel,
      p_reden      := 'Mig 275 (ADR-0016 afronding): Nieuw → fase-uitsplitsing volgens claim/zending/maatwerk-state',
      p_metadata   := jsonb_build_object(
        'backfill', true,
        'open_zendingen', v_open,
        'verzonden_zendingen', v_eind,
        'heeft_io_claim', v_io,
        'heeft_tekort', v_tek,
        'heeft_maatwerk', v_mw
      )
    );
  END LOOP;

  RAISE NOTICE 'Mig 275 backfill voltooid.';
END $$;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_resterend INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_resterend FROM orders WHERE status = 'Nieuw';
  RAISE NOTICE 'Mig 275 toegepast. Orders nog op ''Nieuw'': %.', v_resterend;
END $$;
