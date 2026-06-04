-- Migratie 308: 'Concept' order-status voor e-mail-geïmporteerde orders
--
-- Orders die automatisch aangemaakt worden vanuit e-mail (bestellingen@karpi.nl)
-- krijgen status 'Concept' en komen terecht in een review-wachtrij. Jeannet
-- bekijkt de order, past eventueel aan, en bevestigt met één klik →
-- 'Klaar voor picken'. Onderliggende business-logica (reserveringen, etc.)
-- wordt pas getriggerd na bevestiging — niet bij aanmaken.

-- ── 1. Status toevoegen aan enum ─────────────────────────────────────────────
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'Concept' BEFORE 'Nieuw';

-- ── 2. create_webshop_order: optionele status-parameter ──────────────────────
-- Standaard gedrag ongewijzigd ('Klaar voor picken').
-- E-mail-import roept aan met p_initieel_status = 'Concept'.

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

-- ── 3. bevestig_concept_order: Concept → Klaar voor picken ───────────────────
CREATE OR REPLACE FUNCTION bevestig_concept_order(p_order_id BIGINT)
RETURNS TABLE(order_nr TEXT, status order_status)
LANGUAGE plpgsql
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % niet gevonden', p_order_id;
  END IF;

  IF v_order.status <> 'Concept' THEN
    RAISE EXCEPTION 'Order % heeft status %, verwacht Concept', p_order_id, v_order.status;
  END IF;

  UPDATE orders SET status = 'Klaar voor picken' WHERE id = p_order_id;

  INSERT INTO order_events (order_id, event_type, actor, metadata)
  VALUES (p_order_id, 'aangemaakt', current_user,
          jsonb_build_object('bron', 'bevestig_concept_order', 'vorige_status', 'Concept'));

  -- Reserveringen en wacht-status herberekenen
  PERFORM herbereken_wacht_status(p_order_id);

  RETURN QUERY SELECT v_order.order_nr, 'Klaar voor picken'::order_status;
END;
$$;

GRANT EXECUTE ON FUNCTION bevestig_concept_order(BIGINT) TO authenticated, service_role;

COMMENT ON FUNCTION bevestig_concept_order IS
  'Promoveert een Concept-order naar Klaar voor picken. Triggert daarna herbereken_wacht_status '
  'zodat reserveringen en wacht-op-inkoop/-voorraad-status direct actief worden.';
