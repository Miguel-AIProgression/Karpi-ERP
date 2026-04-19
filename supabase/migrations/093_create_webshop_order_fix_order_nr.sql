-- Migration 093: fix voor create_webshop_order (uit migratie 092).
--
-- Bug: order_nr wordt niet door een trigger gezet — alle bestaande
-- order-creatie RPCs (create_order_with_lines, etc.) roepen zelf
-- volgend_nummer('ORD') aan vóór de INSERT. Onze RPC deed dat niet
-- → NOT NULL violation op orders.order_nr.
--
-- Fix: roep volgend_nummer('ORD') aan vóór de INSERT en neem het
-- gegenereerde nummer op in de INSERT-values.

CREATE OR REPLACE FUNCTION create_webshop_order(
  p_header JSONB,
  p_regels JSONB
)
RETURNS TABLE(order_id BIGINT, order_nr TEXT, was_existing BOOLEAN) AS $$
DECLARE
  v_order_id BIGINT;
  v_order_nr TEXT;
  v_existing_id BIGINT;
  v_existing_nr TEXT;
  r JSONB;
  v_regelnr INTEGER := 0;
BEGIN
  -- Idempotentie-check vooraf. Als order al bestaat: return bestaande rij.
  SELECT id, orders.order_nr
    INTO v_existing_id, v_existing_nr
    FROM orders
   WHERE bron_systeem = p_header->>'bron_systeem'
     AND bron_order_id = p_header->>'bron_order_id';

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, v_existing_nr, TRUE;
    RETURN;
  END IF;

  -- Genereer ORD-nummer (zelfde patroon als create_order_with_lines).
  v_order_nr := volgend_nummer('ORD');

  INSERT INTO orders (
    order_nr,
    debiteur_nr, klant_referentie,
    orderdatum, afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
    bron_systeem, bron_shop, bron_order_id
  ) VALUES (
    v_order_nr,
    (p_header->>'debiteur_nr')::INTEGER,
    p_header->>'klant_referentie',
    COALESCE(NULLIF(p_header->>'orderdatum','')::DATE, CURRENT_DATE),
    NULLIF(p_header->>'afleverdatum','')::DATE,
    p_header->>'fact_naam',
    p_header->>'fact_adres',
    p_header->>'fact_postcode',
    p_header->>'fact_plaats',
    p_header->>'fact_land',
    p_header->>'afl_naam',
    p_header->>'afl_naam_2',
    p_header->>'afl_adres',
    p_header->>'afl_postcode',
    p_header->>'afl_plaats',
    p_header->>'afl_land',
    p_header->>'bron_systeem',
    p_header->>'bron_shop',
    p_header->>'bron_order_id'
  )
  RETURNING id INTO v_order_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_regels)
  LOOP
    v_regelnr := v_regelnr + 1;
    INSERT INTO order_regels (
      order_id, regelnummer,
      artikelnr, omschrijving, omschrijving_2,
      orderaantal, te_leveren,
      prijs, korting_pct, bedrag, gewicht_kg
    ) VALUES (
      v_order_id,
      v_regelnr,
      NULLIF(r->>'artikelnr',''),
      r->>'omschrijving',
      r->>'omschrijving_2',
      COALESCE((r->>'orderaantal')::INTEGER, 1),
      COALESCE((r->>'te_leveren')::INTEGER, (r->>'orderaantal')::INTEGER),
      NULLIF(r->>'prijs','')::NUMERIC,
      COALESCE((r->>'korting_pct')::NUMERIC, 0),
      NULLIF(r->>'bedrag','')::NUMERIC,
      NULLIF(r->>'gewicht_kg','')::NUMERIC
    );
  END LOOP;

  RETURN QUERY SELECT v_order_id, v_order_nr, FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_webshop_order IS
  'Atomic insert van externe (webshop) order + regels. Genereert ORD-nummer via volgend_nummer. Idempotent op (bron_systeem, bron_order_id). Zie migratie 092 + 093 (fix order_nr).';
