-- Migration 092: bron-tracking kolommen + create_webshop_order RPC.
--
-- Context: webshop-integratie (Lightspeed eCom, plan 2026-04-17). Webhooks
-- kunnen meerdere keren binnenkomen (retry-logica van Lightspeed bij niet-
-- 2xx respons binnen 5s). Zonder idempotentie-sleutel zouden dubbele orders
-- ontstaan. We leggen per order vast uit welk systeem en welke externe ID
-- de order oorspronkelijk komt, en zetten daar een partial unique index op.
--
-- Toekomstbestendig: `bron_systeem` is generiek (niet Lightspeed-specifiek),
-- zodat later ook EDI-feeds of marketplaces onder dezelfde paraplu kunnen.
--
-- Conventie waarden (zie data-woordenboek):
--   bron_systeem = 'lightspeed'               (later evt. 'edi', 'marketplace')
--   bron_shop    = 'floorpassion_nl' | 'floorpassion_de'
--   bron_order_id = webshop order-ID als TEXT (Lightspeed numeriek, maar we
--                   houden TEXT voor marketplace-IDs met letters)

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS bron_systeem   TEXT,
  ADD COLUMN IF NOT EXISTS bron_shop      TEXT,
  ADD COLUMN IF NOT EXISTS bron_order_id  TEXT;

COMMENT ON COLUMN orders.bron_systeem IS
  'Herkomst van de order. NULL = handmatig in RugFlow aangemaakt. Bekend: ''lightspeed'' (webshop-integratie, migratie 092).';
COMMENT ON COLUMN orders.bron_shop IS
  'Sub-identifier binnen bron_systeem. Voor Lightspeed: ''floorpassion_nl'' of ''floorpassion_de''. NULL als bron_systeem NULL.';
COMMENT ON COLUMN orders.bron_order_id IS
  'Externe order-ID uit bron_systeem (Lightspeed orders.id). TEXT om marketplace-IDs te kunnen accepteren. Samen met bron_systeem uniek.';

-- Partial unique index: alleen afdwingen waar bron_systeem gezet is.
-- Handmatige orders (NULL) mogen onbeperkt, externe orders krijgen
-- idempotentie-garantie.
CREATE UNIQUE INDEX IF NOT EXISTS orders_bron_unique
  ON orders (bron_systeem, bron_order_id)
  WHERE bron_systeem IS NOT NULL;

-- ---------------------------------------------------------------------
-- create_webshop_order: atomic insert voor externe orders.
--
-- Gebruikt door edge function `sync-webshop-order`. Gedrag:
--   * Idempotent: bij dubbele (bron_systeem, bron_order_id) retourneert de
--     functie het bestaande order-nr i.p.v. een nieuwe insert te doen.
--   * Order_nr wordt automatisch via de bestaande orders-trigger gezet
--     (volgend_nummer('ORD')).
--   * p_regels is een JSONB-array met: artikelnr, omschrijving, orderaantal,
--     prijs, bedrag, korting_pct (optioneel). Onbekende producten krijgen
--     artikelnr NULL + [UNMATCHED] prefix in omschrijving (caller's keuze).
-- ---------------------------------------------------------------------

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

  INSERT INTO orders (
    debiteur_nr, klant_referentie,
    orderdatum, afleverdatum,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
    afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
    bron_systeem, bron_shop, bron_order_id
  ) VALUES (
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
  RETURNING id, orders.order_nr INTO v_order_id, v_order_nr;

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
  'Atomic insert van externe (webshop) order + regels. Idempotent op (bron_systeem, bron_order_id). Zie migratie 092.';
