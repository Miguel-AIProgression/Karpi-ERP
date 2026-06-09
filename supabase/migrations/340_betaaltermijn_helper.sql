-- Migratie 340: betaaltermijn_dagen — single source of truth (ADR-0022)
--
-- Probleem: de factuur-RPC parst de betaaltermijn met
-- `regexp_match(betaalconditie, '^(\d+)')`. debiteuren.betaalconditie heeft
-- formaat "{code} - {naam}" (mig 202), dus dat pakt de CODE, niet de termijn
-- (FACT-2026-0021: "02 - 30 dagen netto" -> vervaldatum +2 i.p.v. +30).
-- Sinds mig 202/203 bestaat betaalcondities.dagen (correct geparsed). Deze
-- functie centraliseert de lookup met fallback 30. Na mig 240 (drop van
-- genereer_factuur + genereer_factuur_voor_week) draagt alleen nog
-- genereer_factuur_voor_bundel de foute regex -- die zet mig 341 om.
--
-- NB migratienummer: plan 2026-06-09 claimde 333/334, maar origin/main loopt
-- inmiddels tot 339 (333-339 zijn ingenomen). Verschoven naar 340/341.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION betaaltermijn_dagen(p_betaalconditie TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Standaard-formaat "{code} - {naam}": match op betaalcondities.code
    (SELECT bc.dagen
       FROM betaalcondities bc
      WHERE p_betaalconditie ~ '^\s*[^-]+\s*-'
        AND trim(split_part(p_betaalconditie, '-', 1)) = bc.code
        AND bc.dagen IS NOT NULL
      LIMIT 1),
    -- Vangnet: vrije tekst met "<n> dagen/tage/days" erin
    NULLIF((regexp_match(p_betaalconditie, '\b(\d+)\s*(?:dagen|tage|days|tag|day)\b', 'i'))[1], '')::INTEGER,
    -- Default conform mig 202-comment
    30
  );
$$;

COMMENT ON FUNCTION betaaltermijn_dagen(TEXT) IS
  'Mig 340 (ADR-0022): betaaltermijn in dagen uit debiteuren.betaalconditie. '
  'Primair: code-prefix -> betaalcondities.dagen. Vangnet: "<n> dagen" in vrije '
  'tekst. Default 30. Vervangt de foute regexp_match(..., ''^(\d+)'')-parse in '
  'genereer_factuur_voor_bundel.';

GRANT EXECUTE ON FUNCTION betaaltermijn_dagen(TEXT) TO authenticated, service_role;

-- Assertie ("test"): voor CREATE faalt dit blok; erna moet het slagen.
DO $$
BEGIN
  -- Code-prefix wint van het leidende getal (de bug-case TRENDHOPPER "02").
  IF betaaltermijn_dagen('02 - 30 dagen netto, 8 dagen 2%') <> 30 THEN
    RAISE EXCEPTION 'FAAL: "02 - 30 dagen..." moet 30 geven, gaf %',
      betaaltermijn_dagen('02 - 30 dagen netto, 8 dagen 2%');
  END IF;
  -- Code == termijn (MEUBILEX "30"): blijft 30.
  IF betaaltermijn_dagen('30 - 30 dagen netto') <> 30 THEN
    RAISE EXCEPTION 'FAAL: "30 - 30 dagen netto" moet 30 geven';
  END IF;
  -- NULL / lege / onbekende -> default 30.
  IF betaaltermijn_dagen(NULL) <> 30 OR betaaltermijn_dagen('') <> 30 THEN
    RAISE EXCEPTION 'FAAL: NULL/leeg moet 30 geven';
  END IF;
  -- Vrije tekst zonder code-formaat.
  IF betaaltermijn_dagen('Betaling binnen 14 dagen') <> 14 THEN
    RAISE EXCEPTION 'FAAL: vrije tekst "14 dagen" moet 14 geven';
  END IF;
  RAISE NOTICE 'Mig 340: alle betaaltermijn_dagen-asserties geslaagd';
END $$;

NOTIFY pgrst, 'reload schema';
