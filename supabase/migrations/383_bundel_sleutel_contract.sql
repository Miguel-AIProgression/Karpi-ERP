-- Migratie 383: bundel-sleutel-contract -- SQL == TS via golden fixtures
--
-- Probleem
-- --------
-- De bundel-sleutel-familie bestaat in twee runtimes:
--   SQL: _normaliseer_afleveradres (mig 222), bundel_sleutel +
--        verzendweek_voor_datum (mig 228)
--   TS:  normaliseer-adres.ts / bundel-sleutel.ts / verzendweek.ts
-- Lockstep werd tot nu toe alleen door comments bewaakt. Divergentie =
-- operator ziet in de Pick & Ship-popover N bundels, start_pickronden_bundel
-- maakt er M -- stil, zonder fout.
--
-- Probe live DB 2026-06-12 (PostgREST rpc op de oude functie): de NBSP-case
-- en de kleine-scharfes-s-case gaven al TS-identieke output (deze locale
-- matcht NBSP in \s en uppercase't ss naar SS), maar de HOOFDLETTER
-- scharfes s (U+1E9E) divergeerde bevestigd: upper() laat hem staan.
-- Bovendien is dit gedrag locale-afhankelijk -- deel 1 hieronder maakt het
-- deterministisch.
--
-- Oplossing in drie delen
-- -----------------------
-- 1. _normaliseer_afleveradres v2 met expliciete JS-pariteit: volledige
--    JS-whitespace-klasse als expliciete escapes + ss-fold voorafgaand aan
--    upper. Sleutels worden nergens gepersisteerd (view mig 229, RPC's
--    mig 222+248, trigger mig 230, RPC mig 232 evalueren on-the-fly), dus
--    geen datamigratie nodig.
-- 2. assert_bundel_sleutel_contract(JSONB): loopt over de golden fixtures
--    en geeft RAISE EXCEPTION bij elke mismatch.
-- 3. Aanroep van die functie met het dollar-quoted golden-blok = letterlijke
--    kopie van frontend/src/lib/orders/__tests__/golden/
--    bundel-sleutel.golden.json. De Vitest-sync-test
--    (bundel-sleutel.contract.test.ts) vergelijkt dat blok met de JSON --
--    een bron, twee consumenten.
--
-- Conventie voortaan
-- ------------------
-- Elke migratie die een van de drie functies wijzigt heet
-- *_bundel_sleutel_contract*.sql en eindigt met dezelfde assert-aanroep
-- (golden zo nodig eerst bijwerken; de sync-test pakt de laatste
-- contract-migratie).
--
-- Idempotent: CREATE OR REPLACE; de assert-aanroep is read-only.

------------------------------------------------------------------------
-- 1. _normaliseer_afleveradres v2: JS-pariteit, locale-onafhankelijk
------------------------------------------------------------------------
-- De whitespace-klasse hieronder is exact wat JavaScript's \s matcht:
-- tab, lf, vt, ff, cr, spatie, nbsp, ogham space, en/em-familie
-- U+2000-200A, line/paragraph separator, narrow nbsp, math space,
-- ideographic space, BOM/zwnbsp. Geschreven als expliciete escapes zodat
-- het gedrag onafhankelijk is van de Postgres-locale.
-- chr(223) = scharfes s klein, chr(7838) = hoofdletter-variant; de fold
-- naar 'ss' gebeurt VOOR upper() omdat upper() de hoofdletter-variant
-- niet aankan (zie probe hierboven).
CREATE OR REPLACE FUNCTION _normaliseer_afleveradres(
  p_adres    TEXT,
  p_postcode TEXT,
  p_land     TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT
       -- postcode: alle whitespace weg
       COALESCE(NULLIF(TRIM(UPPER(REGEXP_REPLACE(
         REPLACE(REPLACE(COALESCE(p_postcode, ''), chr(223), 'ss'), chr(7838), 'ss'),
         '[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+',
         '', 'g'))), ''), '?')
    || '|'
       -- adres: whitespace-runs naar 1 spatie, randen trimmen
    || COALESCE(NULLIF(TRIM(UPPER(REGEXP_REPLACE(
         REPLACE(REPLACE(COALESCE(p_adres, ''), chr(223), 'ss'), chr(7838), 'ss'),
         '[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+',
         ' ', 'g'))), ''), '?')
    || '|'
       -- land: alleen rand-whitespace strippen (binnenste blijft, zoals TS .trim())
    || COALESCE(NULLIF(UPPER(REGEXP_REPLACE(
         REPLACE(REPLACE(COALESCE(p_land, ''), chr(223), 'ss'), chr(7838), 'ss'),
         '^[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
         '', 'g')), ''), '?');
$$;

COMMENT ON FUNCTION _normaliseer_afleveradres(TEXT, TEXT, TEXT) IS
  'Mig 222, gehard in mig 383: match-key voor afleveradres-vergelijking '
  '(postcode|adres|land, uppercase, JS-identieke whitespace-klasse, ss-fold '
  'via chr(223)/chr(7838)). Contract: golden fixtures in frontend/src/lib/'
  'orders/__tests__/golden/bundel-sleutel.golden.json, afgedwongen door '
  'assert_bundel_sleutel_contract (SQL) en bundel-sleutel.contract.test.ts '
  '(TS). Wijzigen = golden bijwerken + nieuwe contract-migratie.';

------------------------------------------------------------------------
-- 2. assert_bundel_sleutel_contract: golden fixtures afdwingen in SQL
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_bundel_sleutel_contract(p_golden JSONB)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  f      JSONB;
  v_uit  TEXT;
  v_verw TEXT;
  v_n    INTEGER := 0;
BEGIN
  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'adres_cases') LOOP
    v_uit  := _normaliseer_afleveradres(f->>'afl_adres', f->>'afl_postcode', f->>'afl_land');
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'bundel-sleutel-contract adres_case "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'week_cases') LOOP
    v_uit  := verzendweek_voor_datum((f->>'datum')::date);
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'bundel-sleutel-contract week_case "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  FOR f IN SELECT value FROM jsonb_array_elements(p_golden->'sleutel_cases') LOOP
    v_uit := bundel_sleutel(
      (f->>'debiteur_nr')::integer,
      _normaliseer_afleveradres(f->>'afl_adres', f->>'afl_postcode', f->>'afl_land'),
      CASE WHEN COALESCE((f->>'afhalen')::boolean, FALSE)
           THEN 'AFHAAL' ELSE f->>'vervoerder_code' END,
      verzendweek_voor_datum((f->>'afleverdatum')::date)
    );
    v_verw := f->>'verwacht';
    IF v_uit IS DISTINCT FROM v_verw THEN
      RAISE EXCEPTION 'bundel-sleutel-contract sleutel_case "%": kreeg "%", verwacht "%"',
        f->>'naam', v_uit, v_verw;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'bundel-sleutel-contract: alle % cases geslaagd', v_n;
END $fn$;

COMMENT ON FUNCTION assert_bundel_sleutel_contract(JSONB) IS
  'Mig 383: toetst _normaliseer_afleveradres + verzendweek_voor_datum + '
  'bundel_sleutel tegen de golden fixtures (RAISE EXCEPTION bij mismatch). '
  'Aanroepen aan het eind van elke migratie die een van de drie wijzigt.';

------------------------------------------------------------------------
-- 3. Contract-aanroep: golden-blok = byte-kopie van het golden-bestand
------------------------------------------------------------------------
SELECT assert_bundel_sleutel_contract($golden$
{
  "_lees_mij": "Canon voor de bundel-sleutel-familie. Twee consumenten: bundel-sleutel.contract.test.ts (TS, Vitest) en assert_bundel_sleutel_contract() in de laatste *_bundel_sleutel_contract*.sql-migratie (SQL). Wijzig je dit bestand, dan MOET er een nieuwe contract-migratie komen met hetzelfde JSON-blok - de sync-test in bundel-sleutel.contract.test.ts dwingt dat af.",
  "adres_cases": [
    { "naam": "basis: postcode-spaties weg, adres-collapse, land upper", "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 ab", "afl_land": "nl", "verwacht": "1234AB|HOOFDWEG 12|NL" },
    { "naam": "meervoudige spaties en randen", "afl_adres": "  Hoofd   weg 12  ", "afl_postcode": " 1234  AB ", "afl_land": " NL ", "verwacht": "1234AB|HOOFD WEG 12|NL" },
    { "naam": "NBSP (U+00A0) telt als spatie", "afl_adres": "Hoofdweg\u00a012", "afl_postcode": "1234\u00a0AB", "afl_land": "NL", "verwacht": "1234AB|HOOFDWEG 12|NL" },
    { "naam": "narrow NBSP (U+202F) telt als spatie", "afl_adres": "Hoofdweg\u202f12", "afl_postcode": "1234 AB", "afl_land": "NL", "verwacht": "1234AB|HOOFDWEG 12|NL" },
    { "naam": "scharfes s klein (U+00DF) foldt naar SS", "afl_adres": "Industriestra\u00DFe 5", "afl_postcode": "68167", "afl_land": "DE", "verwacht": "68167|INDUSTRIESTRASSE 5|DE" },
    { "naam": "scharfes s hoofdletter (U+1E9E) foldt naar SS", "afl_adres": "INDUSTRIESTRA\u1E9EE 5", "afl_postcode": "68167", "afl_land": "DE", "verwacht": "68167|INDUSTRIESTRASSE 5|DE" },
    { "naam": "tab en newline rond land", "afl_adres": "Hoofdweg 12", "afl_postcode": "1234AB", "afl_land": "\tDE\n", "verwacht": "1234AB|HOOFDWEG 12|DE" },
    { "naam": "alles null geeft vraagtekens", "afl_adres": null, "afl_postcode": null, "afl_land": null, "verwacht": "?|?|?" },
    { "naam": "lege strings geven vraagtekens", "afl_adres": "", "afl_postcode": "", "afl_land": "", "verwacht": "?|?|?" },
    { "naam": "alleen-whitespace adres geeft vraagteken", "afl_adres": "   ", "afl_postcode": "1234AB", "afl_land": "NL", "verwacht": "1234AB|?|NL" }
  ],
  "week_cases": [
    { "naam": "midden in het jaar", "datum": "2026-05-06", "verwacht": "2026-W19" },
    { "naam": "zero-padding week 1", "datum": "2027-01-04", "verwacht": "2027-W01" },
    { "naam": "zondag hoort bij de voorgaande ISO-week", "datum": "2026-12-27", "verwacht": "2026-W52" },
    { "naam": "2026 heeft een week 53", "datum": "2026-12-31", "verwacht": "2026-W53" },
    { "naam": "1 jan 2026 valt in week 1 van eigen jaar", "datum": "2026-01-01", "verwacht": "2026-W01" },
    { "naam": "1 jan 2027 hoort bij ISO-jaar 2026 (W53)", "datum": "2027-01-01", "verwacht": "2026-W53" }
  ],
  "sleutel_cases": [
    { "naam": "vol: NL-order met HST", "debiteur_nr": 361208, "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 AB", "afl_land": "NL", "afleverdatum": "2026-05-06", "vervoerder_code": "hst_api", "afhalen": false, "verwacht": "D361208|Vhst_api|W2026-W19|A1234AB|HOOFDWEG 12|NL" },
    { "naam": "geen vervoerder valt terug op GEEN", "debiteur_nr": 361208, "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 AB", "afl_land": "NL", "afleverdatum": "2026-05-06", "vervoerder_code": null, "afhalen": false, "verwacht": "D361208|VGEEN|W2026-W19|A1234AB|HOOFDWEG 12|NL" },
    { "naam": "afhalen wint van vervoerder", "debiteur_nr": 361208, "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 AB", "afl_land": "NL", "afleverdatum": "2026-05-06", "vervoerder_code": "hst_api", "afhalen": true, "verwacht": "D361208|VAFHAAL|W2026-W19|A1234AB|HOOFDWEG 12|NL" },
    { "naam": "geen afleverdatum valt terug op WGEEN", "debiteur_nr": 600556, "afl_adres": "Hoofdweg 12", "afl_postcode": "1234 AB", "afl_land": "NL", "afleverdatum": null, "vervoerder_code": "hst_api", "afhalen": false, "verwacht": "D600556|Vhst_api|WGEEN|A1234AB|HOOFDWEG 12|NL" },
    { "naam": "DE-bundel met ss-fold en week 53", "debiteur_nr": 600556, "afl_adres": "Industriestra\u00DFe 5", "afl_postcode": "68167", "afl_land": "de", "afleverdatum": "2026-12-31", "vervoerder_code": "rhenus_sftp", "afhalen": false, "verwacht": "D600556|Vrhenus_sftp|W2026-W53|A68167|INDUSTRIESTRASSE 5|DE" }
  ]
}
$golden$::jsonb);

NOTIFY pgrst, 'reload schema';
