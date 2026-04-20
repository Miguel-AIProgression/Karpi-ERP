-- Migration 099: omschrijvingen synchroniseren met kleur_code (karpi_code leidend)
--
-- Context: de diagnose-query uit 2026-04-20 vond 4 producten waarvan de "KLEUR X"
-- in de omschrijving afwijkt van de `kleur_code` in de karpi_code. Beslissing:
-- karpi_code is leidend → omschrijving wordt aangepast (niet andersom).
--
--   AMBE25XX160230  "AMBER Kleur 24 CA: ..."           → Kleur 25
--   RENA45XX080300  "RENAISSANCE Kleur 46 CA: ..."     → Kleur 45
--   BUXV49180VIL    "ROLLEN VILT KLEUR 209 BORDEA..."  → KLEUR 49 BORDEA...
--   DOTT26500PPS    "DOTT KLEUR 126 500 BREED"         → KLEUR 26
--
-- De regex behoudt de originele kapitalisatie van "KLEUR"/"Kleur" via capture group.

BEGIN;

DO $$
DECLARE
  v_rij JSON;
BEGIN
  SELECT json_agg(json_build_object(
    'artikelnr', artikelnr,
    'karpi', karpi_code,
    'kleur_db', kleur_code,
    'voor', omschrijving
  ) ORDER BY artikelnr) INTO v_rij
  FROM producten
  WHERE artikelnr IN ('624250000', '526450005', '1000192', '1000029');

  RAISE NOTICE '[VOOR] %', v_rij;
END $$;

UPDATE producten
SET omschrijving = regexp_replace(
      omschrijving,
      '(kleur\s+)[0-9]+',
      '\1' || kleur_code,
      'gi'
    )
WHERE artikelnr IN ('624250000', '526450005', '1000192', '1000029')
  AND omschrijving ~* 'kleur\s+[0-9]+';

DO $$
DECLARE
  v_rij JSON;
BEGIN
  SELECT json_agg(json_build_object(
    'artikelnr', artikelnr,
    'kleur_db', kleur_code,
    'na', omschrijving
  ) ORDER BY artikelnr) INTO v_rij
  FROM producten
  WHERE artikelnr IN ('624250000', '526450005', '1000192', '1000029');

  RAISE NOTICE '[NA]   %', v_rij;
END $$;

COMMIT;
