-- Retroactief: voeg BUNDELKORTING-orderregel toe op hoofdorder voor
-- bestaande bundel-facturen die NOG GEEN BUNDELKORTING-orderregel hebben.
--
-- Identificeert: facturen met >1 distinct order_id (excl VERZEND/BUNDELKORTING)
-- WAARVOOR de orderregels SUM op bundle-orders > factuur-totaal.
--
-- Run in BEGIN/COMMIT block; controleer output vóór COMMIT.

BEGIN;

DO $$
DECLARE
  r RECORD;
  v_zending_id     BIGINT;
  v_totaal_verzend NUMERIC(12,2);
  v_factuur_verzend NUMERIC(12,2);
  v_korting        NUMERIC(12,2);
  v_regelnr        INTEGER;
BEGIN
  FOR r IN
    SELECT
      f.id AS factuur_id,
      f.factuur_nr,
      array_agg(DISTINCT fr.order_id ORDER BY fr.order_id) FILTER (WHERE fr.artikelnr NOT IN ('VERZEND', 'BUNDELKORTING')) AS order_ids,
      (SELECT bedrag FROM factuur_regels WHERE factuur_id = f.id AND artikelnr = 'VERZEND' LIMIT 1) AS factuur_verzend
    FROM facturen f
    JOIN factuur_regels fr ON fr.factuur_id = f.id
    WHERE f.status IN ('Concept')
    GROUP BY f.id, f.factuur_nr
    HAVING COUNT(DISTINCT fr.order_id) FILTER (WHERE fr.artikelnr NOT IN ('VERZEND', 'BUNDELKORTING')) > 1
  LOOP
    -- Check of er al een BUNDELKORTING-orderregel staat op deze bundel
    IF EXISTS (
      SELECT 1 FROM order_regels
       WHERE order_id = ANY(r.order_ids) AND artikelnr = 'BUNDELKORTING'
    ) THEN
      RAISE NOTICE '% — heeft al BUNDELKORTING-orderregel, sla over', r.factuur_nr;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(bedrag), 0) INTO v_totaal_verzend
      FROM order_regels
     WHERE order_id = ANY(r.order_ids)
       AND artikelnr = 'VERZEND'
       AND COALESCE(orderaantal, 0) > 0;

    v_factuur_verzend := COALESCE(r.factuur_verzend, 0);
    v_korting := v_factuur_verzend - v_totaal_verzend;

    IF v_korting = 0 THEN
      RAISE NOTICE '% — geen discrepantie, sla over', r.factuur_nr;
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(regelnummer), 0) + 1
      INTO v_regelnr
      FROM order_regels
     WHERE order_id = r.order_ids[1];

    INSERT INTO order_regels (
      order_id, regelnummer, artikelnr, omschrijving,
      orderaantal, te_leveren, gefactureerd,
      prijs, korting_pct, bedrag, gewicht_kg
    ) VALUES (
      r.order_ids[1], v_regelnr, 'BUNDELKORTING',
      format('Bundelkorting verzending (bundel met %s orders) — retroactief', array_length(r.order_ids, 1)),
      1, 0, 1,
      v_korting, 0, v_korting, 0
    );

    RAISE NOTICE '% — orderregel toegevoegd op order_id % met bedrag € %',
      r.factuur_nr, r.order_ids[1], v_korting;
  END LOOP;
END $$;

-- Verifieer
SELECT
  f.factuur_nr,
  o.id AS order_id,
  orr.artikelnr,
  orr.bedrag,
  orr.omschrijving
FROM facturen f
JOIN factuur_regels fr ON fr.factuur_id = f.id
JOIN orders o ON o.id = fr.order_id
JOIN order_regels orr ON orr.order_id = o.id
WHERE orr.artikelnr = 'BUNDELKORTING'
  AND f.status = 'Concept'
ORDER BY f.factuur_nr, orr.regelnummer;

-- Transactie staat OPEN — kies:
--    COMMIT;
--    ROLLBACK;
