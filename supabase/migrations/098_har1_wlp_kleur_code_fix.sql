-- Migration 098: kleur_code-bug voor HAR1 en WLP1/WLP4 repareren
--
-- Context: zelfde bug als TAM1 (migratie 096). Voor producten waarvan de
-- karpi-code prefix uit 3 letters + cijfer bestaat, pakte de legacy-afleiding
-- "eerste 2 cijfers uit karpi_code" de verkeerde cijfers:
--
--   HAR165400VLI  "HARMONY KLEUR 65"  → kleur_db=16 (moet 65 zijn)
--   HAR195400VLI  "HARMONY KLEUR 95"  → kleur_db=19 (moet 95 zijn)
--   HAR199400VLI  "HARMONY KLEUR 99"  → kleur_db=19 (moet 99 zijn)
--   WLP118XX200200 "WOOLPLUSH 1 KLEUR 18" → kleur_db=11 (moet 18 zijn)
--   WLP418XX160230 "WOOLPLUSH 4 KLEUR 18" → kleur_db=41 (moet 18 zijn)
--
-- Fix: kleur_code + zoeksleutel opnieuw afleiden uit karpi_code-positie 5-6.
-- kwaliteit_code blijft gelijk (HAR / WLP — geen leverancier-switch zoals bij
-- TAMA).  Rollen synchroniseren.
--
-- De WLP1/WLP4 varianten smelten hierdoor samen onder zoeksleutel=WLP_18 voor
-- kleur 18.  Bevestigd met user 2026-04-20; als ze later echt gesplitst moeten
-- (aparte kwaliteiten WLP1 / WLP4) kan dat in een vervolgmigratie.

BEGIN;

DO $$
DECLARE
  v_har INT;
  v_wlp INT;
BEGIN
  SELECT COUNT(*) INTO v_har
  FROM producten
  WHERE karpi_code LIKE 'HAR1%' AND kwaliteit_code = 'HAR';

  SELECT COUNT(*) INTO v_wlp
  FROM producten
  WHERE karpi_code ~ '^WLP[14]' AND kwaliteit_code = 'WLP';

  RAISE NOTICE '[VOOR] producten HAR1: %, producten WLP[14]: %', v_har, v_wlp;
END $$;

-- 1) HAR1-producten: kleur_code + zoeksleutel herberekenen
UPDATE producten
SET kleur_code  = SUBSTRING(karpi_code FROM 5 FOR 2),
    zoeksleutel = 'HAR_' || SUBSTRING(karpi_code FROM 5 FOR 2)
WHERE karpi_code LIKE 'HAR1%'
  AND kwaliteit_code = 'HAR'
  AND SUBSTRING(karpi_code FROM 5 FOR 2) ~ '^[0-9]{2}$';

-- 2) WLP1/WLP4-producten: kleur_code + zoeksleutel herberekenen
UPDATE producten
SET kleur_code  = SUBSTRING(karpi_code FROM 5 FOR 2),
    zoeksleutel = 'WLP_' || SUBSTRING(karpi_code FROM 5 FOR 2)
WHERE karpi_code ~ '^WLP[14]'
  AND kwaliteit_code = 'WLP'
  AND SUBSTRING(karpi_code FROM 5 FOR 2) ~ '^[0-9]{2}$';

-- 3) Rollen synchroniseren (gedenormaliseerde kleur_code + zoeksleutel)
UPDATE rollen r
SET kleur_code  = p.kleur_code,
    zoeksleutel = p.zoeksleutel
FROM producten p
WHERE r.artikelnr = p.artikelnr
  AND (
    (p.karpi_code LIKE 'HAR1%' AND p.kwaliteit_code = 'HAR')
    OR
    (p.karpi_code ~ '^WLP[14]' AND p.kwaliteit_code = 'WLP')
  )
  AND (r.kleur_code IS DISTINCT FROM p.kleur_code
       OR r.zoeksleutel IS DISTINCT FROM p.zoeksleutel);

DO $$
DECLARE
  v_har_naam_db   INT;
  v_wlp_naam_db   INT;
BEGIN
  -- Tel hoeveel nog afwijken tussen naam en kleur_code (zou 0 moeten zijn)
  SELECT COUNT(*) INTO v_har_naam_db
  FROM producten p
  WHERE p.karpi_code LIKE 'HAR1%' AND p.kwaliteit_code = 'HAR'
    AND p.kleur_code <> (regexp_match(p.omschrijving, 'KLEUR\s+([0-9]{1,3})', 'i'))[1];

  SELECT COUNT(*) INTO v_wlp_naam_db
  FROM producten p
  WHERE p.karpi_code ~ '^WLP[14]' AND p.kwaliteit_code = 'WLP'
    AND p.kleur_code <> (regexp_match(p.omschrijving, 'KLEUR\s+([0-9]{1,3})', 'i'))[1];

  RAISE NOTICE '[NA]   HAR1-afwijkingen: %, WLP[14]-afwijkingen: %',
    v_har_naam_db, v_wlp_naam_db;
END $$;

COMMIT;
