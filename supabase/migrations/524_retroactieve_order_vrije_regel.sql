-- Migratie 524: Retroactieve order (al afgehandeld) + vrije omschrijvingsregel
--
-- FEATURE A — Retroactieve order
-- --------------------------------
-- Een order die al fysiek verzonden/afgehaald is, kan achteraf administratief
-- worden ingevoerd. De RPC `registreer_achteraf_order` maakt de order direct
-- aan als status='Verzonden', prikst een phantom-zending aan, en triggert de
-- normale factuur-pipeline via order_events (event_type='pickronde_voltooid').
--
-- Voorraad: `producten.voorraad` wordt nooit verlaagd door verzending (mig 468,
-- wekelijkse Excel-import is de bron-van-waarheid). In plaats daarvan worden
-- `order_reserveringen` met status='verzonden' aangemaakt — dezelfde status die
-- de reguliere pickronde zet (mig 468). Dat houdt vrije_voorraad correct laag
-- (herbereken_product_reservering telt 'actief' én 'verzonden').
--
-- Phantom zending: de factuur-trigger leest zending_orders om zending_id te
-- vinden; zonder phantom zending geen factuur_queue entry.
-- gereed_op=NULL → DESADV-sweep vuurt niet (bouw-verzendbericht-edi checkt
-- zendingen.gereed_op IS NOT NULL).
--
-- FEATURE B — Vrije omschrijvingsregel
-- --------------------------------------
-- Een orderregel zonder artikelnr, met operator-opgegeven omschrijving en prijs.
-- Geen voorraadinvloed, geen snijplan, geen pick-collo.
-- `is_vrije_regel=TRUE` distinguishes from maatwerk (ook artikelnr=NULL).
--
-- BTW erft van debiteur (21% fallback), zelfde als alle andere regels.
-- De factuur-renderer toont omschrijving als basisOmschrijving (artikel-
-- presentatie.ts: firstNonEmpty(klantArtikel?.omschrijving, regel.omschrijving,
-- product?.omschrijving, ...) — NULL artikelnr → product=null → regel.omschrijving
-- wint). Geen wijziging aan factuur-rendering nodig.
--
-- Pickbaarheid: vrije regels worden UITGESLOTEN van orderregel_pickbaarheid
-- (ze zijn geen fysiek te picken product — hetzelfde concept als admin-pseudo
-- regels). Zo blokkeren ze geen pick-start.
--
-- Zending-regels: vrije regels worden stilletjes overgeslagen in
-- fn_zending_regels_skip_admin_pseudo (uitgebreid naar is_vrije_regel=true).
-- Ze krijgen dus nooit een collo of een label.
--
-- Tracering: `orders.is_achteraf=TRUE` markeert retroactieve orders voor
-- weergave op order-detail ("Afgehaald op X" / "Verzonden op X").

-- ============================================================================
-- §1. Kolom is_vrije_regel op order_regels
-- ============================================================================

ALTER TABLE order_regels
  ADD COLUMN IF NOT EXISTS is_vrije_regel BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN order_regels.is_vrije_regel IS
  'Mig 524: vrije omschrijvingsregel — artikelnr IS NULL, geen voorraadinvloed, '
  'geen snijplan, geen pick-collo. Onderscheidt van maatwerk-regels (die ook '
  'artikelnr=NULL kunnen hebben). Uitgesloten van orderregel_pickbaarheid en '
  'fn_zending_regels_skip_admin_pseudo.';

-- ============================================================================
-- §2. Kolom is_achteraf op orders
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_achteraf BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN orders.is_achteraf IS
  'Mig 524: deze order is retroactief aangemaakt via registreer_achteraf_order — '
  'was al fysiek verzonden/afgehaald voor de invoer. Voedt de "Afgehaald op / '
  'Verzonden op [datum]" weergave op order-detail (via orders.verzonden_at).';

-- ============================================================================
-- §3. orderregel_pickbaarheid — vrije regels uitsluiten
--
-- Body = mig 498 body + AND NOT COALESCE(oreg.is_vrije_regel, FALSE) in WHERE.
-- Vrije regels zijn geen fysiek te picken product; als ze meetellen als
-- "niet-pickbaar" blokkeren ze de hele order in Pick & Ship.
-- ============================================================================

CREATE OR REPLACE VIEW orderregel_pickbaarheid AS
WITH maatwerk_aggr AS (
  SELECT sp.order_regel_id,
    count(*) AS totaal_stuks,
    count(*) FILTER (WHERE sp.status = 'Ingepakt'::snijplan_status) AS pickbaar_stuks,
    min(sp.locatie) FILTER (WHERE sp.status = 'Ingepakt'::snijplan_status) AS locatie,
    min(
        CASE sp.status
            WHEN 'Wacht'::snijplan_status THEN 1
            WHEN 'Gepland'::snijplan_status THEN 2
            WHEN 'Snijden'::snijplan_status THEN 2
            WHEN 'Gesneden'::snijplan_status THEN 3
            WHEN 'In confectie'::snijplan_status THEN 4
            WHEN 'In productie'::snijplan_status THEN 5
            WHEN 'Gereed'::snijplan_status THEN 6
            WHEN 'Ingepakt'::snijplan_status THEN 7
            ELSE NULL::integer
        END) AS slechtste_rang
   FROM snijplannen sp
  WHERE sp.status <> 'Geannuleerd'::snijplan_status
  GROUP BY sp.order_regel_id
), voorraad_claim AS (
  SELECT rsv.order_regel_id,
    SUM(rsv.aantal) AS totaal_geclaimd
   FROM order_reserveringen rsv
  WHERE rsv.bron = 'voorraad'::text AND rsv.status = 'actief'::text
  GROUP BY rsv.order_regel_id
), rol_locatie_per_artikel AS (
  SELECT DISTINCT ON (r.artikelnr) r.artikelnr,
    ml.code
   FROM rollen r
     JOIN magazijn_locaties ml ON ml.id = r.locatie_id
  WHERE r.status = 'beschikbaar'::text AND r.locatie_id IS NOT NULL
  ORDER BY r.artikelnr, r.id
)
SELECT oreg.id AS order_regel_id,
  oreg.order_id,
  oreg.regelnummer,
  oreg.artikelnr,
  oreg.is_maatwerk,
  oreg.orderaantal,
  oreg.maatwerk_lengte_cm,
  oreg.maatwerk_breedte_cm,
  oreg.omschrijving,
  oreg.maatwerk_kwaliteit_code,
  oreg.maatwerk_kleur_code,
  ma.totaal_stuks,
  ma.pickbaar_stuks,
    CASE
        WHEN oreg.is_maatwerk THEN COALESCE(ma.pickbaar_stuks = ma.totaal_stuks AND ma.totaal_stuks > 0, false)
        ELSE COALESCE(vc.totaal_geclaimd >= oreg.te_leveren, false)
    END AS is_pickbaar,
    CASE
        WHEN oreg.is_maatwerk THEN 'snijplan'::text
        WHEN rl.code IS NOT NULL THEN 'rol'::text
        WHEN p.locatie IS NOT NULL THEN 'producten_default'::text
        ELSE NULL::text
    END AS bron,
    CASE
        WHEN oreg.is_maatwerk THEN ma.locatie
        ELSE COALESCE(rl.code, p.locatie)
    END AS fysieke_locatie,
    CASE
        WHEN oreg.is_maatwerk THEN
        CASE
            WHEN ma.totaal_stuks IS NULL OR ma.slechtste_rang IS NULL THEN 'snijden'::text
            WHEN ma.slechtste_rang <= 2 THEN 'snijden'::text
            WHEN ma.slechtste_rang <= 4 THEN 'confectie'::text
            WHEN ma.slechtste_rang <= 6 THEN 'inpak'::text
            ELSE NULL::text
        END
        ELSE
        CASE
            WHEN COALESCE(vc.totaal_geclaimd, 0) < COALESCE(oreg.te_leveren, 0) THEN 'inkoop'::text
            ELSE NULL::text
        END
    END AS wacht_op,
  oreg.gewicht_kg
 FROM order_regels oreg
   JOIN orders o ON o.id = oreg.order_id
   LEFT JOIN producten p ON p.artikelnr = oreg.artikelnr
   LEFT JOIN maatwerk_aggr ma ON ma.order_regel_id = oreg.id
   LEFT JOIN voorraad_claim vc ON vc.order_regel_id = oreg.id
   LEFT JOIN rol_locatie_per_artikel rl ON rl.artikelnr = oreg.artikelnr
WHERE (o.status <> ALL (ARRAY['Verzonden'::order_status, 'Geannuleerd'::order_status]))
  AND NOT is_admin_pseudo(oreg.artikelnr)
  AND NOT COALESCE(oreg.is_vrije_regel, FALSE);  -- Mig 524: vrije regels niet pickbaar

-- ============================================================================
-- §4. fn_zending_regels_skip_admin_pseudo — vrije regels ook uitsluiten
--
-- Vrije regels hebben geen fysiek product en horen niet in een zending.
-- is_admin_pseudo(NULL) = FALSE (mig 272), dus de bestaande check dekt ze niet.
-- We voegen een extra lookup toe op order_regels.is_vrije_regel.
-- Body = mig 434 + is_vrije_regel check.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_zending_regels_skip_admin_pseudo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_artikelnr    TEXT;
  v_is_vrije     BOOLEAN;
BEGIN
  SELECT artikelnr, COALESCE(is_vrije_regel, FALSE)
    INTO v_artikelnr, v_is_vrije
    FROM order_regels
   WHERE id = NEW.order_regel_id;

  -- Admin-pseudo (VERZEND/DROPSHIP-*/korting) of vrije omschrijvingsregel
  -- → geen fysiek collo/label/pakbon-onderregel.
  IF is_admin_pseudo(v_artikelnr) OR v_is_vrije THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_zending_regels_skip_admin_pseudo() IS
  'Mig 434 (ADR-0018) + mig 524: houdt admin-pseudo-orderregels én vrije '
  'omschrijvingsregels (is_vrije_regel=TRUE) uit zending_regels. Geen collo, '
  'geen label, geen pakbon-onderregel voor deze typen.';

-- ============================================================================
-- §5. create_order_with_lines — is_vrije_regel doorgeven
--
-- Body = mig 481 + is_vrije_regel in de INSERT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_order_with_lines(p_order jsonb, p_regels jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_order_nr      TEXT;
    v_order_id      BIGINT;
    v_debiteur_nr   INTEGER;
    v_prijslijst_nr TEXT;
BEGIN
    v_debiteur_nr := (p_order->>'debiteur_nr')::INTEGER;

    SELECT prijslijst_nr INTO v_prijslijst_nr
      FROM debiteuren
     WHERE debiteur_nr = v_debiteur_nr;

    IF v_prijslijst_nr IS NULL THEN
      RAISE EXCEPTION
        'Debiteur % heeft geen prijslijst gekoppeld — koppel eerst een prijslijst aan deze klant voordat je een order aanmaakt.',
        v_debiteur_nr
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_order_nr := volgend_nummer('ORD');

    INSERT INTO orders (
        order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
        week, vertegenw_code, betaler, inkooporganisatie,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        fact_email,
        afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
        afl_email,
        lever_modus,
        afhalen,
        lever_type,
        status
    ) VALUES (
        v_order_nr,
        v_debiteur_nr,
        COALESCE((p_order->>'orderdatum')::DATE, CURRENT_DATE),
        (p_order->>'afleverdatum')::DATE,
        p_order->>'klant_referentie',
        p_order->>'week',
        p_order->>'vertegenw_code',
        (p_order->>'betaler')::INTEGER,
        p_order->>'inkooporganisatie',
        p_order->>'fact_naam', p_order->>'fact_adres',
        p_order->>'fact_postcode', p_order->>'fact_plaats', p_order->>'fact_land',
        NULLIF(p_order->>'fact_email', ''),
        p_order->>'afl_naam', p_order->>'afl_naam_2',
        p_order->>'afl_adres', p_order->>'afl_postcode',
        p_order->>'afl_plaats', p_order->>'afl_land',
        NULLIF(p_order->>'afl_email', ''),
        NULLIF(p_order->>'lever_modus', ''),
        COALESCE((p_order->>'afhalen')::BOOLEAN, FALSE),
        COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
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
        klant_referentie,
        is_vrije_regel
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
        NULLIF(r->>'klant_referentie', ''),
        COALESCE((r->>'is_vrije_regel')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_regels) AS r;

    RETURN jsonb_build_object('id', v_order_id, 'order_nr', v_order_nr);
END;
$function$;

-- ============================================================================
-- §6. update_order_with_lines — is_vrije_regel doorgeven
--
-- Body = mig 406 + is_vrije_regel in de INSERT.
-- ============================================================================

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
        klant_referentie,
        is_vrije_regel
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
        NULLIF(r->>'klant_referentie', ''),
        COALESCE((r->>'is_vrije_regel')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_regels) AS r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- §7. registreer_achteraf_order — hoofdfunctie
--
-- Stroom:
--   1. Prijslijst-check (zelfde gate als create_order_with_lines)
--   2. INSERT orders (status='Verzonden', is_achteraf=TRUE, verzonden_at=datum)
--   3. INSERT order_regels (triggers zijn no-op voor Verzonden orders)
--   4. Voor elke niet-pseudo, niet-vrije, niet-NULL-artikelnr-regel:
--      a. Doos-artikel? → reserve op stuks_artikelnr × stuks_per_doos
--      b. Normaal artikel → reserve op artikelnr
--      c. Alles met status='verzonden' (mig 468: houdt vrije_voorraad laag)
--      d. herbereken_product_reservering voor de juiste voorraad-spiegel
--   5. INSERT zendingen (phantom, gereed_op=NULL → geen DESADV)
--   6. INSERT zending_orders (factuur-trigger leest dit)
--   7. INSERT order_events event_type='pickronde_voltooid' →
--      trg_order_events_enqueue_factuur vuurt → factuur_queue rij aangemaakt
--
-- Retourneert: {id, order_nr, zending_id, zending_nr}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registreer_achteraf_order(
  p_order       JSONB,
  p_regels      JSONB,
  p_verzenddatum DATE    DEFAULT CURRENT_DATE,
  p_afhalen      BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_nr         TEXT;
  v_order_id         BIGINT;
  v_debiteur_nr      INTEGER;
  v_prijslijst_nr    TEXT;
  v_zending_nr       TEXT;
  v_zending_id       BIGINT;
  v_regel            JSONB;
  v_artikelnr        TEXT;
  v_is_vrije         BOOLEAN;
  v_is_pseudo        BOOLEAN;
  v_te_leveren       INTEGER;
  v_stuks_artikelnr  TEXT;
  v_stuks_per_doos   INTEGER;
  v_reserveer_artikelnr TEXT;
  v_reserveer_aantal INTEGER;
BEGIN
  v_debiteur_nr := (p_order->>'debiteur_nr')::INTEGER;

  -- Prijslijst-check: zelfde gate als create_order_with_lines
  SELECT prijslijst_nr INTO v_prijslijst_nr
    FROM debiteuren
   WHERE debiteur_nr = v_debiteur_nr;

  IF v_prijslijst_nr IS NULL THEN
    RAISE EXCEPTION
      'Debiteur % heeft geen prijslijst gekoppeld — koppel eerst een prijslijst aan deze klant voordat je een order aanmaakt.',
      v_debiteur_nr
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_order_nr := volgend_nummer('ORD');

  -- ── §A: INSERT orders direct als Verzonden ──────────────────────────────
  INSERT INTO orders (
    order_nr, debiteur_nr, orderdatum, afleverdatum, klant_referentie,
    week, vertegenw_code, betaler, inkooporganisatie,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    fact_email,
    afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
    afl_email,
    afhalen,
    lever_type,
    status,
    verzonden_at,
    is_achteraf
  ) VALUES (
    v_order_nr,
    v_debiteur_nr,
    COALESCE((p_order->>'orderdatum')::DATE, p_verzenddatum),
    p_verzenddatum,
    p_order->>'klant_referentie',
    p_order->>'week',
    p_order->>'vertegenw_code',
    (p_order->>'betaler')::INTEGER,
    p_order->>'inkooporganisatie',
    p_order->>'fact_naam', p_order->>'fact_adres',
    p_order->>'fact_postcode', p_order->>'fact_plaats', p_order->>'fact_land',
    NULLIF(p_order->>'fact_email', ''),
    p_order->>'afl_naam', p_order->>'afl_naam_2',
    p_order->>'afl_adres', p_order->>'afl_postcode',
    p_order->>'afl_plaats', p_order->>'afl_land',
    NULLIF(p_order->>'afl_email', ''),
    p_afhalen,
    COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
    'Verzonden',
    p_verzenddatum::TIMESTAMPTZ,
    TRUE
  ) RETURNING id INTO v_order_id;

  -- ── §B: INSERT order_regels ─────────────────────────────────────────────
  -- trg_orderregel_herallocateer vuurt maar doet early-return (order=Verzonden,
  -- geen actieve claims om om te zetten → no-op). Reserveringen volgen in §C.
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
    klant_referentie,
    is_vrije_regel
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
    FALSE,  -- geen maatwerk in retroactieve orders
    NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL,
    NULLIF(r->>'klant_referentie', ''),
    COALESCE((r->>'is_vrije_regel')::BOOLEAN, FALSE)
  FROM jsonb_array_elements(p_regels) AS r;

  -- ── §C: Voorraad-reserveringen (status='verzonden') ─────────────────────
  -- Elk niet-pseudo, niet-vrije, niet-NULL-artikelnr-regel krijgt een 'verzonden'
  -- reservering zodat vrije_voorraad correct daalt (mig 468: herbereken_product_
  -- reservering telt 'actief' én 'verzonden').
  -- Doos-artikelen: reserve op stuks_artikelnr (spiegelt herallocateer, mig 408).
  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels)
  LOOP
    v_artikelnr  := v_regel->>'artikelnr';
    v_is_vrije   := COALESCE((v_regel->>'is_vrije_regel')::BOOLEAN, FALSE);
    v_te_leveren := COALESCE((v_regel->>'te_leveren')::INTEGER, 0);

    -- Sla pseudo-artikelen, vrije regels, NULL-artikelnr en 0-aantallen over
    CONTINUE WHEN v_artikelnr IS NULL;
    CONTINUE WHEN v_is_vrije;
    CONTINUE WHEN v_te_leveren <= 0;
    v_is_pseudo  := is_admin_pseudo(v_artikelnr);
    CONTINUE WHEN v_is_pseudo;

    -- Doos-artikel? → reserve op stuks_artikelnr × stuks_per_doos (mig 408)
    SELECT stuks_artikelnr, stuks_per_doos
      INTO v_stuks_artikelnr, v_stuks_per_doos
      FROM producten
     WHERE artikelnr = v_artikelnr;

    IF v_stuks_artikelnr IS NOT NULL AND v_stuks_per_doos IS NOT NULL THEN
      v_reserveer_artikelnr := v_stuks_artikelnr;
      v_reserveer_aantal    := v_te_leveren * v_stuks_per_doos;
    ELSE
      v_reserveer_artikelnr := v_artikelnr;
      v_reserveer_aantal    := v_te_leveren;
    END IF;

    -- Zoek order_regel_id op voor de FK
    -- fysiek_artikelnr = het daadwerkelijk gereserveerde artikel (na doos→stuks
    -- vertaling). Geen apart artikelnr-kolom in order_reserveringen (mig 468).
    INSERT INTO order_reserveringen (
      order_regel_id, fysiek_artikelnr,
      bron, status, aantal, is_handmatig
    )
    SELECT
      orr.id,
      v_reserveer_artikelnr,
      'voorraad',
      'verzonden',
      v_reserveer_aantal,
      FALSE
    FROM order_regels orr
    WHERE orr.order_id = v_order_id
      AND orr.artikelnr = v_artikelnr
      AND COALESCE(orr.is_vrije_regel, FALSE) = FALSE
    ORDER BY orr.regelnummer
    LIMIT 1;

    -- Herbereken vrije_voorraad voor dit artikel
    PERFORM herbereken_product_reservering(v_reserveer_artikelnr);
  END LOOP;

  -- ── §D: Phantom zending ─────────────────────────────────────────────────
  -- Factuur-trigger (enqueue_factuur_voor_event, mig 474) leest zending_orders
  -- om zending_id te vinden → zonder phantom zending geen factuur_queue entry.
  -- gereed_op=NULL → DESADV-sweep (bouw-verzendbericht-edi) vuurt niet.
  -- status='Klaar voor verzending' → verschijnt niet in Pick & Ship start-tab.
  v_zending_nr := volgend_nummer('ZEND');

  INSERT INTO zendingen (
    zending_nr,
    order_id,  -- NOT NULL legacy-kolom; trigger trg_zending_set_m2m_a_ins
               -- maakt automatisch een zending_orders-rij aan.
    status,
    vervoerder_code,
    verzenddatum,
    is_deelzending,
    aantal_colli,
    totaal_gewicht_kg
  ) VALUES (
    v_zending_nr,
    v_order_id,
    'Gepland',  -- NIET 'Klaar voor verzending': die status triggert
                -- fn_zending_klaar_voor_verzending → enqueue_zending_naar_vervoerder
                -- én fn_zending_set_gereed_op → gereed_op=now() → DESADV-sweep
                -- vuurt voor EDI-partners. 'Gepland' is veilig (factuur-trigger
                -- leest zending_orders, niet de zending-status).
    NULL,   -- geen vervoerder (retroactief, al verzonden)
    p_verzenddatum,
    FALSE,
    0,
    0
  ) RETURNING id INTO v_zending_id;

  -- zending_orders rij wordt automatisch aangemaakt door trigger
  -- trg_zending_set_m2m_a_ins (ON CONFLICT DO NOTHING) — geen expliciete INSERT nodig.

  -- ── §E: order_events → triggert factuur_queue ───────────────────────────
  -- event_type='pickronde_voltooid' + status_na='Verzonden' is de exacte
  -- combinatie die enqueue_factuur_voor_event (mig 474) afhandelt.
  -- Andere triggers die op order_events luisteren reageren NIET op dit event:
  --   • trg_order_events_reservering_release → alleen 'geannuleerd'
  --   • trg_order_events_snijplan_release    → alleen 'geannuleerd'
  --   • trg_order_events_zending_release     → alleen 'geannuleerd'
  INSERT INTO order_events (
    order_id, event_type, status_voor, status_na, metadata
  ) VALUES (
    v_order_id,
    'pickronde_voltooid',
    'Verzonden',  -- status_voor = zelfde (order was al Verzonden bij aanmaak)
    'Verzonden',
    jsonb_build_object('achteraf', TRUE, 'verzenddatum', p_verzenddatum, 'afhalen', p_afhalen)
  );

  RETURN jsonb_build_object(
    'id',          v_order_id,
    'order_nr',    v_order_nr,
    'zending_id',  v_zending_id,
    'zending_nr',  v_zending_nr
  );
END;
$function$;

COMMENT ON FUNCTION registreer_achteraf_order IS
  'Mig 524: registreer een retroactieve order (al afgehandeld). '
  'Maakt direct status=Verzonden + phantom zending + factuur_queue. '
  'Zet order_reserveringen.status=verzonden voor correcte vrije_voorraad. '
  'p_verzenddatum: de datum van werkelijke verzending/afhaal (mag in verleden). '
  'p_afhalen: TRUE = klant heeft zelf opgehaald (geen vervoerder).';

NOTIFY pgrst, 'reload schema';
