-- Migratie 322: order-niveau "debiteur te bevestigen" — uniforme zeker:false-UX
--
-- Aanleiding (Slice 4 van de gedeelde debiteur-matcher-seam,
-- docs/superpowers/plans/2026-06-07-gedeelde-debiteur-matcher-seam.md):
--   Inbound-kanalen (Shopify, e-mail, ...) leveren via de gedeelde matcher een
--   DebiteurMatch{zeker}. Tot nu toe werd `zeker` genegeerd: een onzekere fuzzy
--   match (bedrijfsnaam-deelmatch / e-mail) landde stil op de gegokte debiteur.
--   De operator-keuze (2026-06-07): order WÉL aanmaken, maar markeren als
--   "debiteur te bevestigen" → zichtbaar in een banner + filter op het
--   orders-overzicht, analoog aan de EDI "te koppelen"-flow (mig 306/307).
--
-- Bewuste uitzondering — env-fallback:
--   matchDebiteurViaEnv (Slice 5) geeft bron='env_fallback', zeker:false. Voor
--   consumenten-webshops (Floorpassion/Shopify-catch-all) is de verzameldebiteur
--   de VERWACHTE eindbestemming met wisselend afleveradres — geen fout. Daarom
--   sluit het "te bevestigen"-predicaat env_fallback expliciet uit. Alleen een
--   onzekere échte klant-gok (bron <> 'env_fallback' AND zeker=false) telt mee.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP+CREATE FUNCTION, CREATE OR REPLACE
-- VIEW. Bestaande orders → default debiteur_zeker=true (niet te bevestigen).

-- ============================================================================
-- 1. Kolommen op orders
-- ============================================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS debiteur_zeker      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS debiteur_match_bron TEXT;

COMMENT ON COLUMN orders.debiteur_zeker IS
  'FALSE = de debiteur is via een onzekere (fuzzy) strategie geraden en moet '
  'handmatig bevestigd worden. TRUE = harde treffer (GLN/expliciet nr/exacte '
  'naam/BTW) of handmatig aangemaakt. Default TRUE. Mig 322 (Slice 4 '
  'debiteur-matcher-seam).';

COMMENT ON COLUMN orders.debiteur_match_bron IS
  'Welke strategie de debiteur bepaalde (DebiteurMatchBron uit '
  '_shared/debiteur-matcher.ts), bv. company_name_ilike, email, env_fallback. '
  'NULL voor handmatig aangemaakte orders. Locality: één antwoord op "waarom '
  'landde deze order op deze debiteur?". Het "te bevestigen"-predicaat sluit '
  'bron=env_fallback uit (verzameldebiteur = verwachte eindbestemming). Mig 322.';

-- ============================================================================
-- 2. create_webshop_order — persisteert debiteur_zeker + debiteur_match_bron
--    (volledige herdefinitie van mig 308; enige verschil = 2 extra kolommen
--     uit p_header met backward-compatibele COALESCE-defaults)
-- ============================================================================
DROP FUNCTION IF EXISTS create_webshop_order(jsonb, jsonb, order_status);
DROP FUNCTION IF EXISTS create_webshop_order(jsonb, jsonb);
CREATE FUNCTION create_webshop_order(
  p_header          JSONB,
  p_regels          JSONB,
  p_initieel_status order_status DEFAULT 'Klaar voor picken'
) RETURNS TABLE(order_nr TEXT, was_existing BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_oid     BIGINT;
  v_onr     TEXT;
  v_regel   JSONB;
  v_regelnr INT := 0;
BEGIN
  -- Idempotentie: als de order al bestaat → return zonder aanmaken
  SELECT o.id, o.order_nr INTO v_oid, v_onr
  FROM orders o
  WHERE o.bron_order_id = p_header->>'bron_order_id'
    AND o.bron_systeem  = p_header->>'bron_systeem'
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_onr, TRUE;
    RETURN;
  END IF;

  v_onr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr,
    debiteur_nr, klant_referentie, orderdatum, afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
    afl_email, afl_telefoon, opmerkingen,
    bron_systeem, bron_shop, bron_order_id,
    debiteur_zeker, debiteur_match_bron,
    status
  ) VALUES (
    v_onr,
    (p_header->>'debiteur_nr')::INTEGER,
    p_header->>'klant_referentie',
    NULLIF(p_header->>'orderdatum',   '')::DATE,
    NULLIF(p_header->>'afleverdatum', '')::DATE,
    p_header->>'fact_naam',  p_header->>'fact_adres',  p_header->>'fact_postcode',  p_header->>'fact_plaats',  COALESCE(NULLIF(p_header->>'fact_land', ''), 'NL'),
    p_header->>'afl_naam',   p_header->>'afl_naam_2',  p_header->>'afl_adres',  p_header->>'afl_postcode',  p_header->>'afl_plaats',  p_header->>'afl_land',
    NULLIF(p_header->>'afl_email',    ''),
    NULLIF(p_header->>'afl_telefoon', ''),
    NULLIF(p_header->>'opmerkingen',  ''),
    p_header->>'bron_systeem', p_header->>'bron_shop', p_header->>'bron_order_id',
    -- Default TRUE als de caller de vlag niet meestuurt (handmatig/legacy-pad).
    COALESCE((p_header->>'debiteur_zeker')::BOOLEAN, TRUE),
    NULLIF(p_header->>'debiteur_match_bron', ''),
    p_initieel_status
  )
  RETURNING id INTO v_oid;

  -- Orderregels invoegen
  FOR v_regel IN SELECT * FROM jsonb_array_elements(p_regels) LOOP
    v_regelnr := v_regelnr + 1;
    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr,
      omschrijving, omschrijving_2,
      orderaantal, te_leveren,
      prijs, korting_pct, bedrag, gewicht_kg,
      is_maatwerk, maatwerk_kwaliteit_code, maatwerk_kleur_code,
      maatwerk_lengte_cm, maatwerk_breedte_cm
    ) VALUES (
      v_oid, v_regelnr,
      NULLIF(v_regel->>'artikelnr', ''),
      v_regel->>'omschrijving',
      NULLIF(v_regel->>'omschrijving_2', ''),
      (v_regel->>'orderaantal')::INTEGER,
      (v_regel->>'te_leveren')::INTEGER,
      NULLIF(v_regel->>'prijs',      '')::NUMERIC,
      COALESCE(NULLIF(v_regel->>'korting_pct', '')::NUMERIC, 0),
      NULLIF(v_regel->>'bedrag',     '')::NUMERIC,
      NULLIF(v_regel->>'gewicht_kg', '')::NUMERIC,
      COALESCE((v_regel->>'is_maatwerk')::BOOLEAN, FALSE),
      NULLIF(v_regel->>'maatwerk_kwaliteit_code', ''),
      NULLIF(v_regel->>'maatwerk_kleur_code', ''),
      NULLIF(v_regel->>'maatwerk_lengte_cm', '')::NUMERIC,
      NULLIF(v_regel->>'maatwerk_breedte_cm', '')::NUMERIC
    );
  END LOOP;

  -- Voor niet-Concept orders: meteen reserveringen/status herberekenen
  IF p_initieel_status <> 'Concept' THEN
    PERFORM herbereken_wacht_status(v_oid);
  END IF;

  RETURN QUERY SELECT v_onr, FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION create_webshop_order(jsonb, jsonb, order_status) TO authenticated, service_role;

COMMENT ON FUNCTION create_webshop_order IS
  'Maakt webshop/e-mail-order + regels aan, idempotent op '
  '(bron_systeem, bron_order_id). (EDI loopt via create_edi_order.) '
  'Sinds mig 308: optionele p_initieel_status '
  '(Concept voor e-mail-review). Sinds mig 322: persisteert optionele '
  'p_header.debiteur_zeker + p_header.debiteur_match_bron (default zeker=TRUE) '
  'voor de "debiteur te bevestigen"-flow.';

-- ============================================================================
-- 3. orders_list — exposeer debiteur_zeker + debiteur_match_bron
--    (volledige herdefinitie van mig 309; enige verschil = 2 extra kolommen)
-- ============================================================================
DROP VIEW IF EXISTS orders_list;

CREATE VIEW orders_list AS
WITH bundel_per_order AS (
  SELECT DISTINCT ON (zo.order_id)
    zo.order_id,
    z.id          AS zending_id,
    z.zending_nr  AS bundel_zending_nr,
    aantal_orders AS bundel_order_count
  FROM zending_orders zo
  JOIN zendingen z ON z.id = zo.zending_id
  JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS aantal_orders
      FROM zending_orders zo2
     WHERE zo2.zending_id = z.id
  ) cnt ON cnt.aantal_orders >= 2
  ORDER BY
    zo.order_id,
    CASE z.status
      WHEN 'Picken'                  THEN 1
      WHEN 'Klaar voor verzending'   THEN 2
      WHEN 'Onderweg'                THEN 3
      WHEN 'Afgeleverd'              THEN 4
      ELSE 5
    END,
    z.id
)
SELECT
  o.id,
  o.order_nr,
  o.oud_order_nr,
  o.debiteur_nr,
  o.klant_referentie,
  o.orderdatum,
  o.afleverdatum,
  o.status,
  o.aantal_regels,
  o.totaal_bedrag,
  o.totaal_gewicht,
  o.vertegenw_code,
  d.naam AS klant_naam,
  o.heeft_unmatched_regels,
  o.bron_systeem,
  o.bron_shop,
  o.lever_type,
  -- Mig 309: EDI-leverweek-bevestiging
  o.edi_bevestigd_op,
  o.edi_gewenste_afleverdatum,
  -- Mig 322: debiteur-match-zekerheid
  o.debiteur_zeker,
  o.debiteur_match_bron,
  -- Mig 259: bundel-info — NULL voor solo-orders
  b.zending_id          AS bundel_zending_id,
  b.bundel_zending_nr,
  b.bundel_order_count
FROM orders o
LEFT JOIN debiteuren d         ON d.debiteur_nr = o.debiteur_nr
LEFT JOIN bundel_per_order b   ON b.order_id    = o.id;

COMMENT ON VIEW orders_list IS
  'Order-overzicht voor frontend OrdersTable. Joint klant_naam uit debiteuren. '
  'Sinds mig 244: lever_type. Sinds mig 259: bundel-info. Sinds mig 309: '
  'edi_bevestigd_op + edi_gewenste_afleverdatum. Sinds mig 322: debiteur_zeker '
  '+ debiteur_match_bron voor het "Debiteur te bevestigen"-filter.';

NOTIFY pgrst, 'reload schema';
