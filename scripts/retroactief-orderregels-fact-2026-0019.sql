-- Retroactief: voeg DREMPELKORTING + BUNDELKORTING orderregels toe op
-- bestaande gebundelde orders (FACT-2026-0019 → ORD-2026-2057 + ORD-2026-2058).
--
-- Pattern: 1e order (laagste order_id) → DREMPELKORTING −€35
--          2e order → BUNDELKORTING −€35
--
-- VOORWAARDE: mig 263 + mig 264 + pseudo-producten gedeployed.
-- Run met BEGIN/COMMIT; controleer NOTICEs vóór COMMIT.

BEGIN;

DO $$
DECLARE
  v_order_ids        BIGINT[];
  v_verzendkosten    NUMERIC(8,2);
  v_drempel          NUMERIC;
  v_admin_regelnr    INTEGER;
BEGIN
  SELECT array_agg(zo.order_id ORDER BY zo.order_id)
    INTO v_order_ids
    FROM zending_orders zo
    JOIN zendingen z ON z.id = zo.zending_id
   WHERE z.zending_nr = 'ZEND-2026-0014';

  IF array_length(v_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Zending ZEND-2026-0014 niet gevonden';
  END IF;

  SELECT verzendkosten, verzend_drempel
    INTO v_verzendkosten, v_drempel
    FROM debiteuren WHERE debiteur_nr = 260000;

  -- Guard: skip als er al admin-regels staan
  IF EXISTS (
    SELECT 1 FROM order_regels
     WHERE order_id = ANY(v_order_ids)
       AND artikelnr IN ('BUNDELKORTING', 'DREMPELKORTING')
  ) THEN
    RAISE NOTICE 'Admin-regels al aanwezig — skipping';
    RETURN;
  END IF;

  -- 1e order krijgt DREMPELKORTING
  SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
    FROM order_regels WHERE order_id = v_order_ids[1];
  INSERT INTO order_regels (
    order_id, regelnummer, artikelnr, omschrijving,
    orderaantal, te_leveren, gefactureerd,
    prijs, korting_pct, bedrag, gewicht_kg
  ) VALUES (
    v_order_ids[1], v_admin_regelnr, 'DREMPELKORTING',
    format('Drempelkorting verzending — vanaf €%s', to_char(v_drempel, 'FM999999.00')),
    1, 0, 1, -v_verzendkosten, 0, -v_verzendkosten, 0
  );
  RAISE NOTICE 'DREMPELKORTING op order_id %', v_order_ids[1];

  -- 2e order krijgt BUNDELKORTING
  SELECT COALESCE(MAX(regelnummer), 0) + 1 INTO v_admin_regelnr
    FROM order_regels WHERE order_id = v_order_ids[2];
  INSERT INTO order_regels (
    order_id, regelnummer, artikelnr, omschrijving,
    orderaantal, te_leveren, gefactureerd,
    prijs, korting_pct, bedrag, gewicht_kg
  ) VALUES (
    v_order_ids[2], v_admin_regelnr, 'BUNDELKORTING',
    format('Bundelkorting verzending (gebundeld 2 orders)'),
    1, 0, 1, -v_verzendkosten, 0, -v_verzendkosten, 0
  );
  RAISE NOTICE 'BUNDELKORTING op order_id %', v_order_ids[2];
END $$;

-- Verifieer
SELECT o.order_nr, orr.regelnummer, orr.artikelnr, orr.bedrag
FROM order_regels orr
JOIN orders o ON o.id = orr.order_id
JOIN zending_orders zo ON zo.order_id = o.id
JOIN zendingen z ON z.id = zo.zending_id
WHERE z.zending_nr = 'ZEND-2026-0014'
ORDER BY o.order_nr, orr.regelnummer;

COMMIT;
