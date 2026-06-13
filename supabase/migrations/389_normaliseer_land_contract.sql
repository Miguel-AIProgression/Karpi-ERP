-- Migratie 389: landnaam→ISO-2-contract — SQL == TS via golden fixtures
--
-- NB nummering: hernummerd 387 → 388 → 389 vlak vóór de merge (origin/main
-- claimde 387 via de colli-gewicht-fix en 388 via de maatwerk-vorm-contour-fix).
-- De inhoud is idempotent; op de live DB is dit op 2026-06-13 al uitgevoerd
-- (assert gaf nul mismatches) — opnieuw draaien is veilig.
--
-- Probleem
-- --------
-- De landnaam→ISO-2-normalisatie bestond in vijf TS-varianten naast de SQL-bron
-- normaliseer_land (mig 214). Eén (factuur-verzenden) kende alleen NL/DE en viel
-- voor de rest terug op slice(0,2) → Oostenrijk→'OO', Zwitserland→'ZW',
-- Spanje→'SP', Polen→'PO', Engeland→'EN' op de elektronische factuur. De TS-kant
-- is nu geconsolideerd in supabase/functions/_shared/adres-split.ts
-- (normalizeCountry = lenient, landNaarIso2Strikt = strikt), die normaliseer_land
-- (mig 214) één-op-één spiegelt voor alle bekende landen.
--
-- Deze migratie borgt die SQL↔TS-pariteit met een golden-contracttest, analoog
-- aan mig 385 (bundel-sleutel). normaliseer_land zelf wijzigt NIET — we voegen
-- alleen de assert-functie + de contract-aanroep toe.
--
-- Conventie voortaan
-- ------------------
-- Elke migratie die normaliseer_land wijzigt heet *_normaliseer_land_contract*.sql
-- en eindigt met dezelfde assert-aanroep (golden zo nodig eerst bijwerken; de
-- sync-test pakt de laatste contract-migratie). De golden leeft in
-- frontend/src/lib/orders/__tests__/golden/normaliseer-land.golden.json en wordt
-- aan TS-zijde getoetst door normaliseer-land.contract.test.ts.
--
-- Idempotent: CREATE OR REPLACE; de assert-aanroep is read-only.

------------------------------------------------------------------------
-- assert_normaliseer_land_contract: golden fixtures afdwingen in SQL
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_normaliseer_land_contract(p_golden JSONB)
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
    RAISE EXCEPTION 'normaliseer_land-contract: "cases" ontbreekt, is geen array of is leeg';
  END IF;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'cases') LOOP
    v_uit  := normaliseer_land(f->>'input');
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'normaliseer_land-contract "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'normaliseer_land-contract: alle % cases geslaagd', v_n;
END $fn$;

COMMENT ON FUNCTION assert_normaliseer_land_contract(JSONB) IS
  'Mig 389: toetst normaliseer_land (mig 214) tegen de golden fixtures '
  '(RAISE EXCEPTION bij mismatch). Aanroepen aan het eind van elke migratie '
  'die normaliseer_land wijzigt. TS-spiegel: adres-split.ts (normalizeCountry / '
  'landNaarIso2Strikt) + normaliseer-land.contract.test.ts.';

------------------------------------------------------------------------
-- Contract-aanroep: golden-blok = kopie van het golden-bestand
------------------------------------------------------------------------
SELECT assert_normaliseer_land_contract($golden$
{
  "_lees_mij": "Canon voor de landnaam→ISO-2-normalisatie. Drie consumenten die identiek moeten mappen: normaliseer_land (SQL, mig 214) via assert_normaliseer_land_contract() in de laatste *_normaliseer_land_contract*.sql-migratie; normalizeCountry (lenient) en landNaarIso2Strikt (strikt) in supabase/functions/_shared/adres-split.ts (TS). Getoetst door normaliseer-land.contract.test.ts (Vitest) + de SQL-assert. Wijzig je deze cases, dan MOET er een nieuwe contract-migratie komen met hetzelfde JSON-blok — de sync-test in normaliseer-land.contract.test.ts dwingt dat af. Bevat ALLEEN bekende landen + ISO-2-passthrough: voor die inputs geven alle drie de consumenten dezelfde ISO-2 terug. Edge-cases (null/leeg/onbekend) divergeren bewust per runtime (SQL→NULL, lenient→'' of passthrough, strikt→null) en horen daarom NIET in dit contract.",
  "cases": [
    { "naam": "ISO-2 lowercase passthrough", "input": "nl", "verwacht": "NL" },
    { "naam": "ISO-2 uppercase passthrough", "input": "DE", "verwacht": "DE" },
    { "naam": "Nederland NL", "input": "Nederland", "verwacht": "NL" },
    { "naam": "Holland NL", "input": "Holland", "verwacht": "NL" },
    { "naam": "Netherlands NL", "input": "Netherlands", "verwacht": "NL" },
    { "naam": "Belgie BE", "input": "Belgie", "verwacht": "BE" },
    { "naam": "België (diakriet) BE", "input": "België", "verwacht": "BE" },
    { "naam": "Belgique BE", "input": "Belgique", "verwacht": "BE" },
    { "naam": "Duitsland DE", "input": "Duitsland", "verwacht": "DE" },
    { "naam": "Deutschland DE", "input": "Deutschland", "verwacht": "DE" },
    { "naam": "Germany DE", "input": "Germany", "verwacht": "DE" },
    { "naam": "Frankrijk FR", "input": "Frankrijk", "verwacht": "FR" },
    { "naam": "France FR", "input": "France", "verwacht": "FR" },
    { "naam": "Luxemburg LU", "input": "Luxemburg", "verwacht": "LU" },
    { "naam": "Oostenrijk AT (eerste 2 letters != ISO)", "input": "Oostenrijk", "verwacht": "AT" },
    { "naam": "Österreich (diakriet) AT", "input": "Österreich", "verwacht": "AT" },
    { "naam": "Austria AT", "input": "Austria", "verwacht": "AT" },
    { "naam": "Zwitserland CH (eerste 2 letters != ISO)", "input": "Zwitserland", "verwacht": "CH" },
    { "naam": "Schweiz CH", "input": "Schweiz", "verwacht": "CH" },
    { "naam": "Italië (diakriet) IT", "input": "Italië", "verwacht": "IT" },
    { "naam": "Italia IT", "input": "Italia", "verwacht": "IT" },
    { "naam": "Spanje ES (eerste 2 letters != ISO)", "input": "Spanje", "verwacht": "ES" },
    { "naam": "España (diakriet) ES", "input": "España", "verwacht": "ES" },
    { "naam": "Polen PL (eerste 2 letters != ISO)", "input": "Polen", "verwacht": "PL" },
    { "naam": "Polska PL", "input": "Polska", "verwacht": "PL" },
    { "naam": "Tsjechië (diakriet) CZ", "input": "Tsjechië", "verwacht": "CZ" },
    { "naam": "Denemarken DK", "input": "Denemarken", "verwacht": "DK" },
    { "naam": "Danmark DK", "input": "Danmark", "verwacht": "DK" },
    { "naam": "Zweden SE", "input": "Zweden", "verwacht": "SE" },
    { "naam": "Sverige SE", "input": "Sverige", "verwacht": "SE" },
    { "naam": "Noorwegen NO", "input": "Noorwegen", "verwacht": "NO" },
    { "naam": "Norge NO", "input": "Norge", "verwacht": "NO" },
    { "naam": "Engeland GB (eerste 2 letters != ISO)", "input": "Engeland", "verwacht": "GB" },
    { "naam": "United Kingdom GB", "input": "United Kingdom", "verwacht": "GB" },
    { "naam": "United  Kingdom dubbele spatie GB", "input": "United  Kingdom", "verwacht": "GB" },
    { "naam": "Groot-Brittannië (koppelteken + diakriet) GB", "input": "Groot-Brittannië", "verwacht": "GB" },
    { "naam": "Ierland IE", "input": "Ierland", "verwacht": "IE" },
    { "naam": "Ireland IE", "input": "Ireland", "verwacht": "IE" },
    { "naam": "randspaties Nederland NL", "input": "  Nederland  ", "verwacht": "NL" }
  ]
}
$golden$::jsonb);

NOTIFY pgrst, 'reload schema';
