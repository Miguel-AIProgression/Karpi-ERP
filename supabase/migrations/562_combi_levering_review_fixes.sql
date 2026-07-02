-- Migratie 562: Combi-levering — drie fixes gevonden bij (tweede) code-review
-- ná mig 556-561 (ADR-0039). Alle drie zijn CREATE OR REPLACE op een functie/
-- view die al in 559/561 stond; elke body hieronder is de volledige, actuele
-- versie (opgehaald uit die migraties) plus de beschreven toevoeging/wijziging.

-- ============================================================================
-- Fix 1 — create_order_with_lines was de kolom is_vrije_regel kwijtgeraakt.
--
-- Mig 524 voegde `is_vrije_regel` toe aan de order_regels-INSERT van
-- create_order_with_lines (vrije-omschrijvingsregels, artikelnr IS NULL, die
-- via `AND NOT COALESCE(oreg.is_vrije_regel, FALSE)` uit orderregel_pickbaarheid
-- worden gehouden). Mig 542 (alle-intake-kanalen-Concept, al op main) nam
-- abusievelijk een oudere versie van de functie-body als basis en liet
-- is_vrije_regel weer weg; mig 559 kopieerde op zijn beurt mig 542's
-- (al-regressed) body 1-op-1. Zonder deze kolom persisteert een nieuwe vrije
-- regel altijd is_vrije_regel=FALSE, wordt hij NIET uitgesloten van
-- orderregel_pickbaarheid, kan hij nooit een voorraadclaim krijgen (NULL
-- artikelnr) en blokkeert hij de hele order permanent in Pick & Ship.
-- Body = mig 559 + is_vrije_regel terug in de order_regels-INSERT (mig 524-stijl).

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
        combi_levering_override,
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
        COALESCE((p_order->>'combi_levering_override')::BOOLEAN, FALSE),
        COALESCE(NULLIF(p_order->>'lever_type', ''), 'week')::lever_type,
        'Concept'  -- mig 542: alle handmatige orders beginnen in Concept
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
-- Fix 2 — combi_levering_orderregel_subtotaal gebruikte een hardcoded
-- `<> 'VERZEND'`-uitsluiting i.p.v. het generieke ADR-0018-predicaat
-- is_admin_pseudo(). Gevolg: VORMTOESLAG/DROPSHIP-*/BUNDELKORTING/
-- DREMPELKORTING-regels telden mee in het groep-subtotaal dat bepaalt of de
-- vrachtvrije-drempel gehaald is, terwijl elke andere admin-pseudo-aware
-- code-plek deze bedragen expliciet niet als commerciële waarde behandelt.
-- is_admin_pseudo(NULL) → FALSE (COALESCE-fallback in mig 272), dus maatwerk-
-- regels (artikelnr IS NULL) blijven ongewijzigd meetellen.
-- ============================================================================

CREATE OR REPLACE FUNCTION combi_levering_orderregel_subtotaal(p_order_id BIGINT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(bedrag), 0)::NUMERIC(12,2)
    FROM order_regels
   WHERE order_id = p_order_id
     AND NOT is_admin_pseudo(artikelnr)
     AND COALESCE(orderaantal, 0) > 0;
$$;

COMMENT ON FUNCTION combi_levering_orderregel_subtotaal(BIGINT) IS
  'Mig 557/562: order-subtotaal excl. admin-pseudo-regels (ADR-0018), voor de '
  'Combi-levering-drempeltoets. Was tot mig 562 hardcoded op <> ''VERZEND'' '
  '(mirrort voorgestelde_zending_bundels/mig 229) — nu de generieke '
  'is_admin_pseudo()-predicaat zodat VORMTOESLAG/DROPSHIP-*/BUNDELKORTING/'
  'DREMPELKORTING ook niet meetellen.';

-- ============================================================================
-- Fix 3 — NULL debiteuren.verzend_drempel werd op de DB-kant behandeld als
-- "geen drempel, dus altijd al gehaald" (view: `IS NOT NULL AND ...`, trigger:
-- `COALESCE(..., 0)`), terwijl de frontend (applyShippingLogic/
-- verzend-regel.ts) voor exact dezelfde NULL-situatie de bestaande
-- SHIPPING_THRESHOLD-fallback van €500 gebruikt. Voor een combi-levering-
-- klant met NULL verzend_drempel gaf dat een order die het order-form als
-- "onder de drempel" behandelde, maar die op de DB-kant nooit hoefde te
-- wachten én nooit een VERZEND-regel kreeg — beide helften van de feature
-- stil buiten werking voor die klant. Beide kanten gebruiken nu dezelfde
-- €500-fallback (SHIPPING_THRESHOLD in frontend/src/lib/constants/shipping.ts).
-- ============================================================================

CREATE OR REPLACE VIEW combi_levering_status AS
WITH leden AS (
  SELECT
    o.id                                                               AS order_id,
    o.debiteur_nr,
    _normaliseer_afleveradres(o.afl_adres, o.afl_postcode, o.afl_land) AS adres_norm,
    COALESCE(op.alle_regels_pickbaar, FALSE)                          AS alle_regels_pickbaar,
    combi_levering_orderregel_subtotaal(o.id)                         AS subtotaal
  FROM orders o
  JOIN debiteuren d ON d.debiteur_nr = o.debiteur_nr
  LEFT JOIN order_pickbaarheid op ON op.order_id = o.id
 WHERE o.status NOT IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden')
   AND o.combi_levering_override = FALSE
   AND d.combi_levering = TRUE
   AND NOT is_dropship_order(o.id)
),
groep AS (
  SELECT
    debiteur_nr,
    adres_norm,
    SUM(subtotaal)                 AS groep_subtotaal,
    bool_and(alle_regels_pickbaar) AS alle_leden_pickbaar
  FROM leden
  GROUP BY debiteur_nr, adres_norm
)
SELECT
  l.order_id,
  g.groep_subtotaal,
  d.verzend_drempel,
  d.gratis_verzending,
  g.alle_leden_pickbaar,
  (
    NOT d.gratis_verzending
    AND (
      g.groep_subtotaal < COALESCE(d.verzend_drempel, 500)
      OR NOT g.alle_leden_pickbaar
    )
  ) AS wacht_op_combi_levering
FROM leden l
JOIN groep g ON g.debiteur_nr = l.debiteur_nr AND g.adres_norm = l.adres_norm
JOIN debiteuren d ON d.debiteur_nr = l.debiteur_nr;

COMMENT ON VIEW combi_levering_status IS
  'Mig 557/561/562 (ADR-0039): per order, alleen voor klanten met combi_levering=TRUE '
  'en niet-overruled/niet-dropshipment/nog-niet-gestarte orders: wacht_op_combi_levering=TRUE '
  'zolang de (debiteur × adres-norm)-groep de vrachtvrije-drempel niet haalt, '
  'OF de drempel wel haalt maar niet al zijn leden individueel pickbaar zijn. '
  'Mig 561: sluit In pickronde/Deels verzonden uit van het groep-subtotaal. '
  'Mig 562: NULL verzend_drempel valt terug op €500 (SHIPPING_THRESHOLD), '
  'consistent met de frontend-fallback in applyShippingLogic — was voorheen '
  '"geen drempel = altijd gehaald", nu hetzelfde gedrag als een order zonder '
  'Combi-levering met een niet-ingevulde drempel.';

CREATE OR REPLACE FUNCTION herwaardeer_combi_levering_verzendregel(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_order              orders%ROWTYPE;
  v_debiteur           debiteuren%ROWTYPE;
  v_moet_wachten        BOOLEAN;
  v_subtotaal          NUMERIC;
  v_moet_verzendregel   BOOLEAN;
  v_bestaande_regel_id BIGINT;
  v_regelnummer        INTEGER;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mig 561: order al fysiek onderweg (in pickronde/deels verzonden) of in
  -- een eindstatus — nooit meer aankomen aan de VERZEND-regel.
  IF v_order.status IN ('Verzonden', 'Geannuleerd', 'In pickronde', 'Deels verzonden') THEN
    RETURN;
  END IF;

  SELECT * INTO v_debiteur FROM debiteuren WHERE debiteur_nr = v_order.debiteur_nr;
  IF NOT FOUND THEN RETURN; END IF;

  v_moet_wachten := v_debiteur.combi_levering
    AND NOT v_order.combi_levering_override
    AND NOT is_dropship_order(p_order_id);

  SELECT id INTO v_bestaande_regel_id
    FROM order_regels
   WHERE order_id = p_order_id AND artikelnr = 'VERZEND'
   LIMIT 1;

  IF v_moet_wachten OR v_order.afhalen THEN
    IF v_bestaande_regel_id IS NOT NULL THEN
      DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
    END IF;
    RETURN;
  END IF;

  v_subtotaal := combi_levering_orderregel_subtotaal(p_order_id);
  -- Mig 562: COALESCE-fallback 500 (was 0) — zelfde SHIPPING_THRESHOLD-default
  -- als applyShippingLogic (frontend/src/lib/constants/shipping.ts).
  v_moet_verzendregel := NOT v_debiteur.gratis_verzending
    AND v_subtotaal < COALESCE(v_debiteur.verzend_drempel, 500);

  IF v_moet_verzendregel AND v_bestaande_regel_id IS NULL THEN
    SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_regelnummer
      FROM order_regels WHERE order_id = p_order_id;

    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr, omschrijving,
      orderaantal, te_leveren, prijs, korting_pct, bedrag
    ) VALUES (
      p_order_id, v_regelnummer, 'VERZEND', 'Verzendkosten',
      1, 1, COALESCE(v_debiteur.verzendkosten, 0), 0, COALESCE(v_debiteur.verzendkosten, 0)
    );
  ELSIF NOT v_moet_verzendregel AND v_bestaande_regel_id IS NOT NULL THEN
    DELETE FROM order_regels WHERE id = v_bestaande_regel_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION herwaardeer_combi_levering_verzendregel(BIGINT) IS
  'Mig 558/561/562 (ADR-0039): voegt/verwijdert de VERZEND-orderregel op een '
  'order, rekening houdend met of de klant/order in een Combi-levering-'
  'wachtgroep zit. Idempotent. Mig 561: no-op voor orders die al In pickronde/'
  'Deels verzonden/Verzonden/Geannuleerd zijn. Mig 562: NULL verzend_drempel '
  'valt terug op €500, consistent met de view en met applyShippingLogic.';

NOTIFY pgrst, 'reload schema';
