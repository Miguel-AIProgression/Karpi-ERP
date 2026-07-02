-- Migratie 584: verzendweek-contract — SQL == TS via golden fixtures
--
-- Audit-remediatie Task 5.2. Patroon: mig 385 (bundel-sleutel-contract) /
-- mig 389 (normaliseer-land-contract) / mig 579 (btw-regeling-contract).
-- Geen wijziging aan verzendweek_voor_datum zelf — deze migratie voegt
-- alleen de assert-functie + de contract-aanroep toe.
--
-- Bron-van-waarheid
-- -----------------
-- SQL:  verzendweek_voor_datum(p_datum DATE) RETURNS TEXT (mig 228),
--       formaat 'YYYY-Www' via to_char(..., 'IYYY') || '-W' || to_char(..., 'IW').
-- TS:   verzendWeekSleutel(afleverdatumIso) in frontend/src/lib/orders/verzendweek.ts
--       (bouwt op de gedeelde ISO-week-kernel frontend/src/lib/utils/iso-week.ts).
--
-- Golden fixtures: frontend/src/lib/orders/__tests__/golden/verzendweek.golden.json
-- (8 cases, veld "cases", sleutels datum/verwacht). Getoetst aan TS-zijde door
-- verzendweek.contract.test.ts.
--
-- Conventie voortaan
-- ------------------
-- Elke migratie die verzendweek_voor_datum wijzigt heet
-- *_verzendweek_contract*.sql en eindigt met dezelfde assert-aanroep (golden
-- zo nodig eerst bijwerken; de sync-test pakt de laatste contract-migratie).
--
-- Idempotent: CREATE OR REPLACE; de assert-aanroep is read-only.

------------------------------------------------------------------------
-- assert_verzendweek_contract: golden fixtures afdwingen in SQL
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_verzendweek_contract(p_golden JSONB)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  f      JSONB;
  v_uit  TEXT;
  v_verw TEXT;
  v_n    INTEGER := 0;
BEGIN
  -- Vorm-guard: een getypo'de sleutel of lege array zou anders stil slagen
  -- (jsonb_array_elements over NULL levert nul rijen) — en deze assert is
  -- bij een handmatige SQL Editor-apply de laatste verdedigingslinie.
  IF jsonb_typeof(p_golden->'cases') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_golden->'cases') = 0 THEN
    RAISE EXCEPTION 'verzendweek-contract: "cases" ontbreekt, is geen array of is leeg';
  END IF;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'cases') LOOP
    v_uit  := verzendweek_voor_datum((f->>'datum')::date);
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'verzendweek-contract "%": kreeg "%", verwacht "%"',
        f->>'datum', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'verzendweek-contract: alle % cases geslaagd', v_n;
END $fn$;

COMMENT ON FUNCTION assert_verzendweek_contract(JSONB) IS
  'Mig 580: toetst verzendweek_voor_datum (mig 228) tegen de golden fixtures '
  '(RAISE EXCEPTION bij mismatch). Aanroepen aan het eind van elke migratie '
  'die verzendweek_voor_datum wijzigt. TS-spiegel: '
  'frontend/src/lib/orders/verzendweek.ts + verzendweek.contract.test.ts.';

------------------------------------------------------------------------
-- Contract-aanroep: golden-blok = byte-kopie van het golden-bestand
------------------------------------------------------------------------
SELECT assert_verzendweek_contract($golden$
{
  "_comment": "SQL verzendweek_voor_datum (mig 228, formaat YYYY-Www) == TS verzendWeekSleutel (lib/orders/verzendweek.ts). Zelfde conventie als bundel-sleutel (mig 385). Alle waarden geverifieerd tegen de ISO-8601-standaard (week 1 bevat de eerste donderdag / 4 januari) — geen correcties nodig t.o.v. de aangeleverde set.",
  "cases": [
    { "datum": "2026-07-02", "verwacht": "2026-W27" },
    { "datum": "2026-01-01", "verwacht": "2026-W01" },
    { "datum": "2025-12-29", "verwacht": "2026-W01" },
    { "datum": "2026-12-31", "verwacht": "2026-W53" },
    { "datum": "2027-01-01", "verwacht": "2026-W53" },
    { "datum": "2027-01-04", "verwacht": "2027-W01" },
    { "datum": "2026-06-28", "verwacht": "2026-W26" },
    { "datum": "2026-06-29", "verwacht": "2026-W27" }
  ]
}
$golden$::jsonb);

NOTIFY pgrst, 'reload schema';
