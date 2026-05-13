-- Retroactief-script: regenereer bestaande Concept bundel-facturen naar V2-layout
--
-- Doel: voor FACT-2026-0018 en alle andere Concept-facturen met >1 distinct
-- order_id (excl VERZEND/BUNDELKORTING/DREMPELKORTING) die nog op mig 256/260-
-- vorm zitten: verwijder oude factuur, reset gefactureerd op orderregels
-- (incl. VERZEND nu), verwijder oude BUNDELKORTING-orderregels op de
-- hoofdorder, en regenereer via mig 261 versie van genereer_factuur_voor_bundel.
--
-- Aanpak:
--   1. Identificeer kandidaten: Concept-facturen met >1 distinct order_id
--      in factuur_regels (excl correctie-artikelen).
--   2. Skip facturen die al V2-vorm hebben (DREMPELKORTING aanwezig OF
--      meerdere VERZEND-regels) — guard tegen dubbele uitvoering.
--   3. Voor elke kandidaat:
--      a. Identificeer zending_id via factuur_regels.order_id → zending_orders.
--         Skip als geen unieke zending gevonden (handmatige factuur).
--      b. Reset gefactureerd op alle orderregels van die orders die door
--         deze factuur waren gemarkeerd (alle non-correctie-regels).
--      c. Verwijder oude BUNDELKORTING/DREMPELKORTING-orderregels op
--         hoofdorder (v_order_ids[1] = MIN(order_id) in zending_orders).
--      d. Verwijder factuur (factuur_regels CASCADE).
--      e. Roep genereer_factuur_voor_bundel(zending_id) aan.
--
-- BEGIN/COMMIT pattern met dry-run NOTICEs. Pas COMMIT toe als de
-- NOTICEs er goed uitzien.
--
-- VOORWAARDE: mig 261 toegepast.

BEGIN;

DO $$
DECLARE
  r                RECORD;
  v_zending_id     BIGINT;
  v_order_ids      BIGINT[];
  v_hoofdorder     BIGINT;
  v_nieuwe_factuur BIGINT;
  v_aantal_done    INTEGER := 0;
  v_aantal_skip    INTEGER := 0;
BEGIN
  FOR r IN
    SELECT
      f.id AS factuur_id,
      f.factuur_nr,
      f.debiteur_nr,
      COUNT(DISTINCT fr.order_id) FILTER (
        WHERE COALESCE(fr.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
      ) AS aantal_orders,
      COUNT(*) FILTER (WHERE fr.artikelnr = 'VERZEND') AS aantal_verzend,
      COUNT(*) FILTER (WHERE fr.artikelnr = 'DREMPELKORTING') AS aantal_drempel,
      COUNT(*) FILTER (WHERE fr.artikelnr = 'BUNDELKORTING') AS aantal_bundel
    FROM facturen f
    JOIN factuur_regels fr ON fr.factuur_id = f.id
    WHERE f.status = 'Concept'
    GROUP BY f.id, f.factuur_nr, f.debiteur_nr
    HAVING COUNT(DISTINCT fr.order_id) FILTER (
        WHERE COALESCE(fr.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
      ) > 1
    ORDER BY f.id
  LOOP
    -- Guard: V2-vorm is herkenbaar aan DREMPELKORTING OF >1 VERZEND-regel.
    IF r.aantal_drempel > 0 OR r.aantal_verzend > 1 THEN
      RAISE NOTICE 'SKIP factuur % (%): heeft al V2-vorm (drempel=%, verzend=%)',
        r.factuur_nr, r.factuur_id, r.aantal_drempel, r.aantal_verzend;
      v_aantal_skip := v_aantal_skip + 1;
      CONTINUE;
    END IF;

    -- Vind zending_id via één van de order_ids in factuur_regels.
    SELECT DISTINCT zo.zending_id
      INTO v_zending_id
      FROM factuur_regels fr
      JOIN zending_orders zo ON zo.order_id = fr.order_id
     WHERE fr.factuur_id = r.factuur_id
       AND COALESCE(fr.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
     LIMIT 1;

    IF v_zending_id IS NULL THEN
      RAISE NOTICE 'SKIP factuur % (%): geen zending_id gevonden (handmatige factuur?)',
        r.factuur_nr, r.factuur_id;
      v_aantal_skip := v_aantal_skip + 1;
      CONTINUE;
    END IF;

    -- Verifieer dat zending_id consistent is over alle order_ids op deze factuur.
    IF (
      SELECT COUNT(DISTINCT zo.zending_id)
        FROM factuur_regels fr
        JOIN zending_orders zo ON zo.order_id = fr.order_id
       WHERE fr.factuur_id = r.factuur_id
         AND COALESCE(fr.artikelnr, '') NOT IN ('VERZEND', 'BUNDELKORTING', 'DREMPELKORTING')
    ) <> 1 THEN
      RAISE NOTICE 'SKIP factuur % (%): orders verspreid over meerdere zendingen',
        r.factuur_nr, r.factuur_id;
      v_aantal_skip := v_aantal_skip + 1;
      CONTINUE;
    END IF;

    SELECT array_agg(zo.order_id ORDER BY zo.order_id)
      INTO v_order_ids
      FROM zending_orders zo
     WHERE zo.zending_id = v_zending_id;

    v_hoofdorder := v_order_ids[1];

    RAISE NOTICE 'PROCESS factuur % (%) → zending %, orders %, hoofdorder %',
      r.factuur_nr, r.factuur_id, v_zending_id, v_order_ids, v_hoofdorder;

    -- a. Reset gefactureerd op orderregels die door deze factuur waren
    --    gemarkeerd (alle regels die in factuur_regels staan met een
    --    order_regel_id). We zetten gefactureerd terug naar 0 op die regels.
    UPDATE order_regels orr
       SET gefactureerd = 0
      FROM factuur_regels fr
     WHERE fr.factuur_id = r.factuur_id
       AND fr.order_regel_id IS NOT NULL
       AND orr.id = fr.order_regel_id;

    -- b. Verwijder oude BUNDELKORTING/DREMPELKORTING-orderregels op de
    --    hoofdorder. Mig 260 zette er BUNDELKORTING; eerdere V2-attempts
    --    konden DREMPELKORTING gezet hebben.
    DELETE FROM order_regels
     WHERE order_id = v_hoofdorder
       AND COALESCE(artikelnr, '') IN ('BUNDELKORTING', 'DREMPELKORTING');

    -- c. Verwijder oude factuur (factuur_regels via FK CASCADE; valt anders
    --    onder een eigen DELETE).
    DELETE FROM factuur_regels WHERE factuur_id = r.factuur_id;
    DELETE FROM facturen        WHERE id         = r.factuur_id;

    -- d. Regenereer via mig 261-versie.
    SELECT genereer_factuur_voor_bundel(v_zending_id) INTO v_nieuwe_factuur;

    RAISE NOTICE '  → nieuwe factuur_id = %', v_nieuwe_factuur;
    v_aantal_done := v_aantal_done + 1;
  END LOOP;

  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE 'Retroactief V2-layout: % geregenereerd, % geskipt',
    v_aantal_done, v_aantal_skip;
  RAISE NOTICE '------------------------------------------------------------';
END;
$$;

-- Inspecteer NOTICE-output. Als alles klopt: COMMIT. Anders: ROLLBACK.
--
-- COMMIT;
-- ROLLBACK;

-- Verificatie na COMMIT:
--
-- 1. Voor FACT-2026-0018 (of de nieuwe factuur_nr, want we hebben oude verwijderd):
--    SELECT f.factuur_nr, fr.regelnummer, fr.order_id, fr.artikelnr, fr.bedrag
--      FROM facturen f
--      JOIN factuur_regels fr ON fr.factuur_id = f.id
--     WHERE f.debiteur_nr = <debiteur_nr_van_FACT-2026-0018>
--       AND f.status = 'Concept'
--    ORDER BY f.factuur_nr, fr.regelnummer;
--    -- Verwacht: 2× product, 2× VERZEND, 1× BUNDELKORTING, 1× DREMPELKORTING
--
-- 2. Orderregels op hoofdorder:
--    SELECT regelnummer, artikelnr, bedrag
--      FROM order_regels
--     WHERE order_id = <hoofdorder>
--    ORDER BY regelnummer;
--    -- Verwacht: 1× BUNDELKORTING, 1× DREMPELKORTING (oude BUNDELKORTING uit mig 260 weg)
