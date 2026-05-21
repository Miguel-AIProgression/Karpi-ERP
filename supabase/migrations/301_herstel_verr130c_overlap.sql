-- Migratie 301: handmatige herstel-fix voor VERR130 C overlap-incident (mei 2026)
--
-- Achtergrond: op rol VERR130 C zijn 4 snijplannen op fysiek overlappende
-- posities terechtgekomen — alle vier hebben (positie_x_cm=0 of 235,
-- positie_y_cm=0 of 225) en overlappen elkaar in zowel X als Y. De packer
-- van auto-plan-groep heeft de eerste planning (alleen Zitmaxx op (0,0))
-- niet gerespecteerd toen Headlam/Floorpassion/Gero werden toegevoegd,
-- vermoedelijk doordat `fetchBeschikbareRollen` de rol in de pool liet
-- en de bezetteMap-stukken niet matchten (status-window of release/replan).
--
-- Code-fix landt in `supabase/functions/_shared/db-helpers.ts`
-- (extra Snijden/Gesneden-rol-ID-guard in fetchBeschikbareRollen).
-- Deze migratie zet alleen de bestaande data terug naar de fysiek-correcte
-- layout zodat de operator de rol kan afsnijden zoals voorzien in de oude
-- planning-screenshot:
--
--   Rij 1 (y=0..450):     Zitmaxx 250×450        (geroteerd, ongewijzigd)
--   Rij 2 (y=450..675):   Headlam 325×225        (geroteerd)
--   Rij 3 (y=675..905):   Floorpassion 230×230   (rond, marge=5 → 235 snij-maat)
--                         Gero 160×220 lane 2    (positie_x=235)
--   Aangebroken: 400×595 cm vanaf y=905
--
-- VOOR HET UITVOEREN VERIFIEREN:
--   1. Operator van VERR130 C is NIET halverwege Headlam/Floorpassion/Gero
--      aan het snijden (status moet nog 'Snijden', niet 'Gesneden').
--   2. Zitmaxx (id 891) ligt fysiek nog op (0,0) — gevisualiseerde positie
--      klopt met DB.
--   3. Bij twijfel: open de rol-uitvoer-modal en pauzeer hem eerst
--      (`pauzeer_snijden_rol`), corrigeer, dan operator opnieuw laten starten.

BEGIN;

-- Idempotente guard: alleen herstellen als de bekende foutieve posities nog
-- in de DB staan. Voorkomt dat een herhaalde apply de data weer scheef trekt
-- nadat iemand handmatig heeft bijgesteld.

DO $$
DECLARE
  v_huidig_x INT;
  v_huidig_y INT;
BEGIN
  -- Headlam (id 895): foutief op (0,0) → moet naar (0, 450)
  SELECT positie_x_cm, positie_y_cm INTO v_huidig_x, v_huidig_y
  FROM snijplannen WHERE id = 895;
  IF v_huidig_x = 0 AND v_huidig_y = 0 THEN
    UPDATE snijplannen SET positie_y_cm = 450 WHERE id = 895;
    RAISE NOTICE 'Headlam (895) verplaatst van (0,0) naar (0,450)';
  ELSE
    RAISE NOTICE 'Headlam (895) staat al op (%, %) — overgeslagen', v_huidig_x, v_huidig_y;
  END IF;

  -- Floorpassion (id 896): foutief op (0,225) → moet naar (0, 675)
  SELECT positie_x_cm, positie_y_cm INTO v_huidig_x, v_huidig_y
  FROM snijplannen WHERE id = 896;
  IF v_huidig_x = 0 AND v_huidig_y = 225 THEN
    UPDATE snijplannen SET positie_y_cm = 675 WHERE id = 896;
    RAISE NOTICE 'Floorpassion (896) verplaatst van (0,225) naar (0,675)';
  ELSE
    RAISE NOTICE 'Floorpassion (896) staat al op (%, %) — overgeslagen', v_huidig_x, v_huidig_y;
  END IF;

  -- Gero (id 897): foutief op (235,225) → moet naar (235, 675)
  SELECT positie_x_cm, positie_y_cm INTO v_huidig_x, v_huidig_y
  FROM snijplannen WHERE id = 897;
  IF v_huidig_x = 235 AND v_huidig_y = 225 THEN
    UPDATE snijplannen SET positie_y_cm = 675 WHERE id = 897;
    RAISE NOTICE 'Gero (897) verplaatst van (235,225) naar (235,675)';
  ELSE
    RAISE NOTICE 'Gero (897) staat al op (%, %) — overgeslagen', v_huidig_x, v_huidig_y;
  END IF;
END $$;

COMMIT;
