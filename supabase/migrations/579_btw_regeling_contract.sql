-- Migratie 579: btw-regeling-contract — SQL == TS via golden fixtures
--
-- Audit-remediatie Task 5.1. Patroon: mig 385 (bundel-sleutel-contract) /
-- mig 389 (normaliseer-land-contract). Geen wijziging aan bepaal_btw_regeling
-- of effectief_btw_pct zelf — deze migratie voegt alleen de assert-functie +
-- de contract-aanroep toe, zodat SQL↔TS-pariteit voortaan een RAISE EXCEPTION
-- oplevert bij drift i.p.v. stil uiteen te lopen (mig 550-incident: DECOR-UNION
-- had een foutieve btw_verlegd_intracom-vlag, ontdekt via handmatige controle).
--
-- Bron-van-waarheid
-- -----------------
-- SQL:  bepaal_btw_regeling(p_afl_land, p_debiteur_land, p_afhalen,
--       p_verlegd_vlag, p_btw_nummer, p_btw_percentage)
--       RETURNS TABLE(regeling, effectief_pct, controle_nodig, controle_reden, land_iso2)
--       (mig 455, herzien mig 550) + effectief_btw_pct(p_verlegd, p_btw_percentage)
--       (mig 371).
-- TS:   bepaalBtwRegeling / effectiefBtwPct in supabase/functions/_shared/btw.ts,
--       gedeeld met de frontend via de re-export-shim frontend/src/lib/orders/btw.ts.
--
-- Golden fixtures: frontend/src/lib/orders/__tests__/golden/btw-regeling.golden.json
-- (12 cases, veld "cases", input-sleutels aflLandIso2/debiteurLandIso2/afhalen/
-- verlegdVlag/btwNummer/btwPercentage → verwacht-sleutels regeling/effectiefPct/
-- controleNodig). Getoetst aan TS-zijde door btw-regeling.contract.test.ts.
--
-- Conventie voortaan
-- ------------------
-- Elke migratie die bepaal_btw_regeling of effectief_btw_pct wijzigt heet
-- *_btw_regeling_contract*.sql en eindigt met dezelfde assert-aanroep (golden
-- zo nodig eerst bijwerken; de sync-test pakt de laatste contract-migratie).
--
-- Idempotent: CREATE OR REPLACE; de assert-aanroep is read-only.

------------------------------------------------------------------------
-- assert_btw_regeling_contract: golden fixtures afdwingen in SQL
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_btw_regeling_contract(p_golden JSONB)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  f        JSONB;
  v_regel  TEXT;
  v_pct    NUMERIC;
  v_ctrl   BOOLEAN;
  v_verw   JSONB;
  v_n      INTEGER := 0;
BEGIN
  -- Vorm-guard: een getypo'de sleutel of lege array zou anders stil slagen
  -- (jsonb_array_elements over NULL levert nul rijen) — en deze assert is
  -- bij een handmatige SQL Editor-apply de laatste verdedigingslinie.
  IF jsonb_typeof(p_golden->'cases') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_golden->'cases') = 0 THEN
    RAISE EXCEPTION 'btw-regeling-contract: "cases" ontbreekt, is geen array of is leeg';
  END IF;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'cases') LOOP
    v_verw := f->'verwacht';

    SELECT regeling, effectief_pct, controle_nodig
      INTO v_regel, v_pct, v_ctrl
      FROM bepaal_btw_regeling(
        f->'input'->>'aflLandIso2',
        f->'input'->>'debiteurLandIso2',
        (f->'input'->>'afhalen')::boolean,
        (f->'input'->>'verlegdVlag')::boolean,
        f->'input'->>'btwNummer',
        (f->'input'->>'btwPercentage')::numeric
      );

    IF v_regel IS DISTINCT FROM (v_verw->>'regeling') THEN
      RAISE EXCEPTION 'btw-regeling-contract "%": regeling kreeg "%", verwacht "%"',
        f->>'naam', v_regel, v_verw->>'regeling';
    END IF;

    IF v_pct IS DISTINCT FROM (v_verw->>'effectiefPct')::numeric THEN
      RAISE EXCEPTION 'btw-regeling-contract "%": effectiefPct kreeg %, verwacht %',
        f->>'naam', v_pct, v_verw->>'effectiefPct';
    END IF;

    IF v_ctrl IS DISTINCT FROM (v_verw->>'controleNodig')::boolean THEN
      RAISE EXCEPTION 'btw-regeling-contract "%": controleNodig kreeg %, verwacht %',
        f->>'naam', v_ctrl, v_verw->>'controleNodig';
    END IF;

    v_n := v_n + 1;
  END LOOP;

  -- Inline asserts op effectief_btw_pct (mig 371) — de kleinere bouwsteen die
  -- bepaal_btw_regeling zelf ook aanroept voor de nl_binnenland-tak.
  IF effectief_btw_pct(TRUE, 21) IS DISTINCT FROM 0.00::NUMERIC(5,2) THEN
    RAISE EXCEPTION 'btw-regeling-contract: effectief_btw_pct(verlegd=TRUE, 21) verwacht 0, kreeg %',
      effectief_btw_pct(TRUE, 21);
  END IF;

  IF effectief_btw_pct(FALSE, NULL) IS DISTINCT FROM 21.00::NUMERIC(5,2) THEN
    RAISE EXCEPTION 'btw-regeling-contract: effectief_btw_pct(verlegd=FALSE, NULL) verwacht 21, kreeg %',
      effectief_btw_pct(FALSE, NULL);
  END IF;

  IF effectief_btw_pct(FALSE, 9) IS DISTINCT FROM 9.00::NUMERIC(5,2) THEN
    RAISE EXCEPTION 'btw-regeling-contract: effectief_btw_pct(verlegd=FALSE, 9) verwacht 9, kreeg %',
      effectief_btw_pct(FALSE, 9);
  END IF;

  RAISE NOTICE 'btw-regeling-contract: alle % cases + 3 effectief_btw_pct-asserts geslaagd', v_n;
END $fn$;

COMMENT ON FUNCTION assert_btw_regeling_contract(JSONB) IS
  'Mig 579: toetst bepaal_btw_regeling (mig 455/550) + effectief_btw_pct '
  '(mig 371) tegen de golden fixtures (RAISE EXCEPTION bij mismatch). '
  'Aanroepen aan het eind van elke migratie die één van beide wijzigt. '
  'TS-spiegel: supabase/functions/_shared/btw.ts + btw-regeling.contract.test.ts.';

------------------------------------------------------------------------
-- Contract-aanroep: golden-blok = byte-kopie van het golden-bestand
------------------------------------------------------------------------
SELECT assert_btw_regeling_contract($golden$
{
  "_comment": "SQL bepaal_btw_regeling (mig 455, herzien mig 550) == TS bepaalBtwRegeling (_shared/btw.ts). Wijzig je één kant: golden bijwerken + nieuwe *_btw_regeling_contract*.sql die de assert opnieuw draait (patroon mig 385). LET OP mig 550: 'eu_b2b_binnenland_afwijking' bestaat niet meer — elk EU-niet-NL-afleverland is altijd eu_b2b_icl (0%), ongeacht de btw_verlegd_intracom-vlag; alleen export_buiten_eu is nog hard-block.",
  "cases": [
    { "naam": "leeg land = nl_binnenland (62% legacy)", "input": { "aflLandIso2": null, "debiteurLandIso2": null, "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "nl_binnenland", "effectiefPct": 21, "controleNodig": false } },
    { "naam": "NL expliciet", "input": { "aflLandIso2": "NL", "debiteurLandIso2": "NL", "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "nl_binnenland", "effectiefPct": 21, "controleNodig": false } },
    { "naam": "DE verlegd met btw-nr = ICL 0%", "input": { "aflLandIso2": "DE", "debiteurLandIso2": "DE", "afhalen": false, "verlegdVlag": true, "btwNummer": "DE123456789", "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": false } },
    { "naam": "DE verlegd zonder btw-nr = ICL advisory", "input": { "aflLandIso2": "DE", "debiteurLandIso2": "DE", "afhalen": false, "verlegdVlag": true, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": true } },
    { "naam": "DE zonder verlegd-vlag = toch ICL (mig 550, vlag genegeerd voor EU-land)", "input": { "aflLandIso2": "DE", "debiteurLandIso2": "DE", "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": true } },
    { "naam": "US = export buiten EU", "input": { "aflLandIso2": "US", "debiteurLandIso2": "US", "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "export_buiten_eu", "effectiefPct": 0, "controleNodig": true } },
    { "naam": "GB = non-EU (Brexit)", "input": { "aflLandIso2": "GB", "debiteurLandIso2": "GB", "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "export_buiten_eu", "effectiefPct": 0, "controleNodig": true } },
    { "naam": "afhalen: debiteurland wint van afl_land", "input": { "aflLandIso2": "BE", "debiteurLandIso2": "NL", "afhalen": true, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "nl_binnenland", "effectiefPct": 21, "controleNodig": false } },
    { "naam": "afl leeg, debiteur DE verlegd = ICL via fallback", "input": { "aflLandIso2": null, "debiteurLandIso2": "DE", "afhalen": false, "verlegdVlag": true, "btwNummer": "DE999999999", "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": false } },
    { "naam": "EU-land zonder verlegd-vlag is nog steeds 0% (vlag is geen input meer voor het pct)", "input": { "aflLandIso2": "AT", "debiteurLandIso2": "AT", "afhalen": false, "verlegdVlag": true, "btwNummer": "ATU12345678", "btwPercentage": 9 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": false } },
    { "naam": "btw-nummer lege string telt als ontbrekend", "input": { "aflLandIso2": "FR", "debiteurLandIso2": "FR", "afhalen": false, "verlegdVlag": true, "btwNummer": "   ", "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": true } },
    { "naam": "CH is bewust non-EU (geen EU-lidstaat)", "input": { "aflLandIso2": "CH", "debiteurLandIso2": "CH", "afhalen": false, "verlegdVlag": false, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "export_buiten_eu", "effectiefPct": 0, "controleNodig": true } },
    { "naam": "afhalen: debiteurland EU zonder btw-nr = ICL advisory (afl_land genegeerd)", "input": { "aflLandIso2": "NL", "debiteurLandIso2": "DE", "afhalen": true, "verlegdVlag": true, "btwNummer": null, "btwPercentage": 21 }, "verwacht": { "regeling": "eu_b2b_icl", "effectiefPct": 0, "controleNodig": true } }
  ]
}
$golden$::jsonb);

NOTIFY pgrst, 'reload schema';
