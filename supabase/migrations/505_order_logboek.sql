-- Mig 503: Order-logboek — audit-trail voor handmatige acties op order-detail.
--
-- Voegt drie nieuwe order_event_type-waarden toe voor acties die tot nu toe
-- nergens gelogd werden:
--   • orderbevestiging_verstuurd  → gelogd door stuur-orderbevestiging edge fn
--   • creditfactuur_aangemaakt    → gelogd door maak_creditfactuur() RPC
--   • order_gewijzigd             → gelogd door update_order_with_lines() RPC
--
-- Alle drie slaan metadata.gedaan_door (e-mailadres) op zodat de UI kan tonen
-- wie de actie uitvoerde, zonder een join op auth.users nodig te hebben.
--
-- Bijlage: huidige_actor_email() SECURITY DEFINER helper lest auth.users binnen
-- een SECURITY DEFINER RPC-context (auth.uid() is beschikbaar via JWT-claims).

-- ---------------------------------------------------------------------------
-- 1. Nieuwe enum-waarden
-- ---------------------------------------------------------------------------
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'orderbevestiging_verstuurd';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'creditfactuur_aangemaakt';
ALTER TYPE order_event_type ADD VALUE IF NOT EXISTS 'order_gewijzigd';

-- ---------------------------------------------------------------------------
-- 2. Helper: e-mailadres van de huidige ingelogde gebruiker
--    Leest auth.users op basis van auth.uid() (JWT-claim, beschikbaar in
--    SECURITY DEFINER-context). Retourneert NULL als er geen sessie is
--    (service-role-aanroep zonder gebruiker-JWT).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION huidige_actor_email()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT COALESCE(
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    (auth.uid())::text
  )
$$;

COMMENT ON FUNCTION huidige_actor_email() IS
  'Mig 503: leest het e-mailadres van de huidig ingelogde gebruiker via auth.uid(). '
  'Werkt ook in SECURITY DEFINER-functies omdat auth.uid() JWT-claims leest. '
  'Retourneert NULL bij service-role-context zonder gebruiker-JWT.';

GRANT EXECUTE ON FUNCTION huidige_actor_email() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. maak_creditfactuur — log 'creditfactuur_aangemaakt' in order_events
--    voor alle orders die aan de betrokken factuur gekoppeld zijn.
--    (Volledige CREATE OR REPLACE — superset van mig 467.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION maak_creditfactuur(
  p_factuur_id       BIGINT,
  p_reden            TEXT    DEFAULT NULL,
  p_factuur_regel_ids BIGINT[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_orig        facturen%ROWTYPE;
  v_nieuwe_id   BIGINT;
  v_nieuwe_nr   TEXT;
  v_subtotaal   NUMERIC;
  v_btw_bedrag  NUMERIC;
  v_is_volledig BOOLEAN := p_factuur_regel_ids IS NULL;
BEGIN
  SELECT * INTO v_orig FROM facturen WHERE id = p_factuur_id;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'Factuur % bestaat niet', p_factuur_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_orig.credit_voor_factuur_id IS NOT NULL THEN
    RAISE EXCEPTION 'Factuur % is zelf al een creditfactuur, kan niet opnieuw gecrediteerd worden', p_factuur_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_is_volledig AND EXISTS (SELECT 1 FROM facturen WHERE credit_voor_factuur_id = p_factuur_id) THEN
    RAISE EXCEPTION 'Factuur % is al (deels) gecrediteerd', p_factuur_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_is_volledig THEN
    v_subtotaal  := v_orig.subtotaal;
    v_btw_bedrag := v_orig.btw_bedrag;
  ELSE
    SELECT COALESCE(SUM(bedrag), 0) INTO v_subtotaal
      FROM factuur_regels WHERE id = ANY(p_factuur_regel_ids) AND factuur_id = p_factuur_id;
    v_btw_bedrag := ROUND(v_subtotaal * COALESCE(v_orig.btw_percentage, 0) / 100, 2);
  END IF;

  v_nieuwe_nr := volgend_nummer('FACT');

  INSERT INTO facturen (
    factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
    subtotaal, btw_percentage, btw_bedrag, totaal,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    opmerkingen, btw_nummer, btw_verlegd, btw_regeling,
    credit_voor_factuur_id
  ) VALUES (
    v_nieuwe_nr, v_orig.debiteur_nr, CURRENT_DATE, v_orig.vervaldatum, 'Concept',
    -v_subtotaal, v_orig.btw_percentage, -v_btw_bedrag, -(v_subtotaal + v_btw_bedrag),
    v_orig.fact_naam, v_orig.fact_adres, v_orig.fact_postcode, v_orig.fact_plaats, v_orig.fact_land,
    COALESCE(p_reden, 'Creditfactuur voor ' || v_orig.factuur_nr), v_orig.btw_nummer, v_orig.btw_verlegd, v_orig.btw_regeling,
    p_factuur_id
  ) RETURNING id INTO v_nieuwe_id;

  -- order_regel_id bewust NULL: idx_factuur_regels_order_regel staat een
  -- orderregel maar één keer toe over alle factuur_regels heen, en het
  -- origineel houdt die koppeling al. De beschrijvende snapshot-velden
  -- (omschrijving/artikelnr/order_nr/klant_referentie) blijven wel staan.
  INSERT INTO factuur_regels (
    factuur_id, order_regel_id, omschrijving, aantal, prijs, korting_pct, bedrag, btw_percentage,
    order_id, regelnummer, artikelnr, omschrijving_2, uw_referentie, order_nr, klant_referentie
  )
  SELECT
    v_nieuwe_id, NULL, omschrijving, aantal, prijs, korting_pct, -bedrag, btw_percentage,
    order_id, regelnummer, artikelnr, omschrijving_2, uw_referentie, order_nr, klant_referentie
  FROM factuur_regels
  WHERE factuur_id = p_factuur_id
    AND (v_is_volledig OR id = ANY(p_factuur_regel_ids));

  IF v_is_volledig THEN
    UPDATE facturen
       SET status = 'Gecrediteerd', updated_at = now()
     WHERE id = p_factuur_id;
  END IF;

  -- Mig 503: log 'creditfactuur_aangemaakt' op alle betrokken orders.
  -- Best-effort: nooit een blokkade bij ontbrekende auth-context.
  BEGIN
    INSERT INTO order_events (
      order_id, event_type, status_voor, status_na, actor_auth_user_id, metadata
    )
    SELECT DISTINCT ON (fr.order_id)
      fr.order_id,
      'creditfactuur_aangemaakt'::order_event_type,
      o.status,
      o.status,
      auth.uid(),
      jsonb_build_object(
        'creditfactuur_id',       v_nieuwe_id,
        'creditfactuur_nr',       v_nieuwe_nr,
        'originele_factuur_nr',   v_orig.factuur_nr,
        'reden',                  p_reden,
        'gedaan_door',            huidige_actor_email()
      )
    FROM factuur_regels fr
    JOIN orders o ON o.id = fr.order_id
    WHERE fr.factuur_id = p_factuur_id
      AND fr.order_id IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- best-effort: logging blokkeert nooit de creditfactuur zelf
  END;

  RETURN v_nieuwe_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. update_order_with_lines — log 'order_gewijzigd' na elke bewerkingssessie.
--    Snapshot oud totaal_bedrag vóór de wijziging; nieuw bedrag na afloop.
--    (Volledige CREATE OR REPLACE — superset van mig 422/465/502.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_order_with_lines(
  p_order_id BIGINT,
  p_header   JSONB,
  p_regels   JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_input_ids         BIGINT[];
  v_blokkerende_status TEXT;
  v_oud_bedrag        NUMERIC;  -- mig 503: snapshot vóór de wijziging
BEGIN
    -- Mig 503: snapshot het huidige totaal_bedrag vóór enige wijziging.
    SELECT totaal_bedrag INTO v_oud_bedrag FROM orders WHERE id = p_order_id;

    -- Verzamel de id's die de frontend meestuurt — dat is de "houden"-set.
    SELECT COALESCE(
      ARRAY_AGG(NULLIF(r->>'id', '')::BIGINT) FILTER (WHERE NULLIF(r->>'id', '') IS NOT NULL),
      ARRAY[]::BIGINT[]
    )
    INTO v_input_ids
    FROM jsonb_array_elements(p_regels) AS r;

    -- Guard: een regel die verwijderd wordt mag geen snijplan hebben dat al
    -- gesneden is (of verder) — bewerkbaar/verwijderbaar tot en met 'Snijden'.
    SELECT sp.status INTO v_blokkerende_status
    FROM snijplannen sp
    JOIN order_regels or2 ON or2.id = sp.order_regel_id
    WHERE or2.order_id = p_order_id
      AND or2.id <> ALL(v_input_ids)
      AND sp.status IN ('Gesneden', 'In confectie', 'Gereed', 'Ingepakt')
    LIMIT 1;

    IF v_blokkerende_status IS NOT NULL THEN
        RAISE EXCEPTION
          'Orderregel kan niet verwijderd worden: snijplan is al gesneden (status: %). Annuleer het snijplan eerst.',
          v_blokkerende_status;
    END IF;

    -- Ruim snijvoorstel_plaatsingen + snijplannen in vroege status op voor
    -- regels die straks verwijderd worden (anders blokkeert de FK de DELETE
    -- hieronder). Regels die blijven bestaan worden hier niet geraakt.
    DELETE FROM snijvoorstel_plaatsingen
    WHERE snijplan_id IN (
        SELECT sp.id FROM snijplannen sp
        JOIN order_regels or2 ON or2.id = sp.order_regel_id
        WHERE or2.order_id = p_order_id
          AND or2.id <> ALL(v_input_ids)
          AND sp.status IN ('Wacht', 'Gepland', 'In productie', 'Snijden')
    );

    DELETE FROM snijplannen
    WHERE order_regel_id IN (
        SELECT id FROM order_regels
        WHERE order_id = p_order_id AND id <> ALL(v_input_ids)
    )
    AND status IN ('Wacht', 'Gepland', 'In productie', 'Snijden');

    -- Orphaned concept-snijvoorstellen opruimen (mig 333-gedrag).
    DELETE FROM snijvoorstellen
    WHERE id NOT IN (SELECT DISTINCT voorstel_id FROM snijvoorstel_plaatsingen)
      AND status IN ('concept');

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
        fact_email = NULLIF(p_header->>'fact_email', ''),
        afl_naam = p_header->>'afl_naam', afl_naam_2 = p_header->>'afl_naam_2',
        afl_adres = p_header->>'afl_adres', afl_postcode = p_header->>'afl_postcode',
        afl_plaats = p_header->>'afl_plaats', afl_land = p_header->>'afl_land',
        afl_email = NULLIF(p_header->>'afl_email', ''),
        lever_modus = CASE
          WHEN p_header ? 'lever_modus'
            THEN NULLIF(p_header->>'lever_modus', '')
          ELSE lever_modus
        END,
        afhalen = CASE
          WHEN p_header ? 'afhalen'
            THEN COALESCE((p_header->>'afhalen')::BOOLEAN, false)
          ELSE afhalen
        END,
        lever_type = CASE
          WHEN p_header ? 'lever_type'
            THEN COALESCE(NULLIF(p_header->>'lever_type', ''), 'week')::lever_type
          ELSE lever_type
        END
    WHERE id = p_order_id;

    -- 1. DELETE regels die niet meer in de input staan.
    DELETE FROM order_regels
    WHERE order_id = p_order_id
      AND id <> ALL(v_input_ids);

    -- 2. UPDATE bestaande regels — match op order_id + id, kolommen 1-op-1
    --    uit de JSON-input.
    UPDATE order_regels o SET
        regelnummer = (r->>'regelnummer')::INTEGER,
        artikelnr = r->>'artikelnr',
        karpi_code = r->>'karpi_code',
        omschrijving = r->>'omschrijving',
        omschrijving_2 = r->>'omschrijving_2',
        orderaantal = (r->>'orderaantal')::INTEGER,
        te_leveren = (r->>'te_leveren')::INTEGER,
        prijs = (r->>'prijs')::NUMERIC,
        korting_pct = COALESCE((r->>'korting_pct')::NUMERIC, 0),
        bedrag = (r->>'bedrag')::NUMERIC,
        gewicht_kg = (r->>'gewicht_kg')::NUMERIC,
        fysiek_artikelnr = r->>'fysiek_artikelnr',
        omstickeren = COALESCE((r->>'omstickeren')::BOOLEAN, false),
        is_maatwerk = COALESCE((r->>'is_maatwerk')::BOOLEAN, false),
        maatwerk_vorm = r->>'maatwerk_vorm',
        maatwerk_lengte_cm = (r->>'maatwerk_lengte_cm')::INTEGER,
        maatwerk_breedte_cm = (r->>'maatwerk_breedte_cm')::INTEGER,
        maatwerk_afwerking = r->>'maatwerk_afwerking',
        maatwerk_band_kleur = r->>'maatwerk_band_kleur',
        maatwerk_band_kleur_id = NULLIF(r->>'maatwerk_band_kleur_id', '')::BIGINT,
        maatwerk_instructies = r->>'maatwerk_instructies',
        maatwerk_m2_prijs = (r->>'maatwerk_m2_prijs')::NUMERIC,
        maatwerk_kostprijs_m2 = (r->>'maatwerk_kostprijs_m2')::NUMERIC,
        maatwerk_oppervlak_m2 = (r->>'maatwerk_oppervlak_m2')::NUMERIC,
        maatwerk_vorm_toeslag = (r->>'maatwerk_vorm_toeslag')::NUMERIC,
        maatwerk_afwerking_prijs = (r->>'maatwerk_afwerking_prijs')::NUMERIC,
        maatwerk_diameter_cm = (r->>'maatwerk_diameter_cm')::INTEGER,
        maatwerk_kwaliteit_code = r->>'maatwerk_kwaliteit_code',
        maatwerk_kleur_code = r->>'maatwerk_kleur_code',
        klant_referentie = NULLIF(r->>'klant_referentie', '')
    FROM jsonb_array_elements(p_regels) AS r
    WHERE o.order_id = p_order_id
      AND o.id = NULLIF(r->>'id', '')::BIGINT;

    -- 3. INSERT nieuwe regels (geen id in input).
    INSERT INTO order_regels (
        order_id, regelnummer, artikelnr, karpi_code,
        omschrijving, omschrijving_2, orderaantal, te_leveren,
        prijs, korting_pct, bedrag, gewicht_kg,
        fysiek_artikelnr, omstickeren,
        is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm,
        maatwerk_afwerking, maatwerk_band_kleur, maatwerk_band_kleur_id, maatwerk_instructies,
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
        NULLIF(r->>'maatwerk_band_kleur_id', '')::BIGINT,
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
    FROM jsonb_array_elements(p_regels) AS r
    WHERE NULLIF(r->>'id', '') IS NULL;

    -- Mig 503: log 'order_gewijzigd' inclusief oud/nieuw bedrag.
    -- totaal_bedrag is door order_regels_totalen-trigger al bijgewerkt.
    -- Best-effort: logging blokkeert nooit de bewerking zelf.
    BEGIN
      INSERT INTO order_events (
        order_id, event_type, status_voor, status_na, actor_auth_user_id, metadata
      )
      SELECT
        id,
        'order_gewijzigd'::order_event_type,
        status,
        status,
        auth.uid(),
        jsonb_build_object(
          'oud_bedrag',   v_oud_bedrag,
          'nieuw_bedrag', totaal_bedrag,
          'gedaan_door',  huidige_actor_email()
        )
      FROM orders
      WHERE id = p_order_id;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- best-effort
    END;
END;
$function$;
