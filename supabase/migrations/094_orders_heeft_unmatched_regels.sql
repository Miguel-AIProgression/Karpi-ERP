-- Migration 094: vlag op orders voor regels zonder artikelnr (review nodig).
--
-- Context: Webshop-integratie (Lightspeed) kan niet voor elke orderregel
-- een `artikelnr` vinden — denk aan "Gratis Muster", "Wunschgröße",
-- reinigingskits en anti-slip onderleggers zonder karpi_code. We markeren
-- die regels met prefixen als [UNMATCHED] / [STAAL] / [MAATWERK] in
-- `omschrijving`, maar voor een orderlijst wil je in één oogopslag zien
-- WELKE orders review nodig hebben — anders moet je elke regel openen.
--
-- Oplossing: boolean kolom `heeft_unmatched_regels` op orders, automatisch
-- bijgewerkt door create_webshop_order (en een trigger voor handmatige
-- order_regels-mutaties). TRUE zodra ≥1 regel `artikelnr IS NULL` heeft.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS heeft_unmatched_regels BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN orders.heeft_unmatched_regels IS
  'TRUE als minstens 1 order_regel een NULL artikelnr heeft. Automatisch bijgewerkt door create_webshop_order (migratie 094) + trigger bij regel-wijzigingen.';

-- Index voor filter "Actie vereist" in orderlijst
CREATE INDEX IF NOT EXISTS orders_heeft_unmatched_idx
  ON orders (heeft_unmatched_regels)
  WHERE heeft_unmatched_regels = TRUE;

-- ---------------------------------------------------------------------
-- Trigger: onderhoud de vlag bij mutaties op order_regels
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_order_heeft_unmatched_regels()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id BIGINT;
  v_heeft BOOLEAN;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT EXISTS (
    SELECT 1 FROM order_regels WHERE order_id = v_order_id AND artikelnr IS NULL
  ) INTO v_heeft;

  UPDATE orders
     SET heeft_unmatched_regels = v_heeft
   WHERE id = v_order_id
     AND heeft_unmatched_regels IS DISTINCT FROM v_heeft;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_regels_sync_unmatched ON order_regels;
CREATE TRIGGER order_regels_sync_unmatched
  AFTER INSERT OR UPDATE OF artikelnr OR DELETE
  ON order_regels
  FOR EACH ROW
  EXECUTE FUNCTION sync_order_heeft_unmatched_regels();

-- ---------------------------------------------------------------------
-- Backfill: zet vlag correct voor alle bestaande orders
-- ---------------------------------------------------------------------

UPDATE orders o
   SET heeft_unmatched_regels = TRUE
 WHERE EXISTS (
   SELECT 1 FROM order_regels r
    WHERE r.order_id = o.id
      AND r.artikelnr IS NULL
 )
 AND heeft_unmatched_regels = FALSE;

-- ---------------------------------------------------------------------
-- create_webshop_order: zet vlag expliciet na insert (trigger doet het
-- al per regel, maar expliciet houden we de RPC idempotent en leesbaar).
--
-- DROP + CREATE i.p.v. CREATE OR REPLACE: postgres staat geen
-- signature-wijziging toe via REPLACE, en we willen het ook in ongewijzigde
-- signaturen consistent draaien zonder 42P13.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_webshop_order(JSONB, JSONB);

CREATE FUNCTION create_webshop_order(
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
  v_has_unmatched BOOLEAN := FALSE;
BEGIN
  SELECT id, orders.order_nr
    INTO v_existing_id, v_existing_nr
    FROM orders
   WHERE bron_systeem = p_header->>'bron_systeem'
     AND bron_order_id = p_header->>'bron_order_id';

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, v_existing_nr, TRUE;
    RETURN;
  END IF;

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
    p_header->>'fact_naam',  p_header->>'fact_adres',
    p_header->>'fact_postcode', p_header->>'fact_plaats', p_header->>'fact_land',
    p_header->>'afl_naam',   p_header->>'afl_naam_2',
    p_header->>'afl_adres',  p_header->>'afl_postcode',
    p_header->>'afl_plaats', p_header->>'afl_land',
    p_header->>'bron_systeem', p_header->>'bron_shop', p_header->>'bron_order_id'
  )
  RETURNING id INTO v_order_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_regels)
  LOOP
    v_regelnr := v_regelnr + 1;
    IF NULLIF(r->>'artikelnr','') IS NULL THEN
      v_has_unmatched := TRUE;
    END IF;
    INSERT INTO order_regels (
      order_id, regelnummer,
      artikelnr, omschrijving, omschrijving_2,
      orderaantal, te_leveren,
      prijs, korting_pct, bedrag, gewicht_kg
    ) VALUES (
      v_order_id, v_regelnr,
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

  -- Expliciete set (trigger heeft 'm al gezet, maar dit is goedkope herbevestiging)
  IF v_has_unmatched THEN
    UPDATE orders SET heeft_unmatched_regels = TRUE WHERE id = v_order_id;
  END IF;

  RETURN QUERY SELECT v_order_id, v_order_nr, FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_webshop_order IS
  'Atomic insert van externe (webshop) order + regels. Genereert ORD-nummer, zet heeft_unmatched_regels bij regels zonder artikelnr. Idempotent op (bron_systeem, bron_order_id). Zie migratie 092/093/094.';
