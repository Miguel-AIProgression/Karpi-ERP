-- Migratie 454: normaliseer_land — resterende EU-27 + is_eu_land() helper
--
-- Aanleiding: BTW-regeling-audit (2026-06-20) tegen de Belastingdienst-
-- beslisboom voor goederenverkoop (B2B/EU-ICL/export-buiten-EU). normaliseer_land
-- (mig 214) dekt alleen Karpi's "kernlanden" (NL/BE/DE/FR/LU/AT/CH/IT/ES/PL/CZ/
-- DK/SE/NO/GB/IE) — de overige 13 EU-lidstaten (PT/SK/HU/GR/SI/EE/LV/LT/BG/RO/
-- HR/CY/MT/FI) normaliseren niet naar ISO-2 via deze functie, terwijl mig 164's
-- eenmalige backfill-lijst ze al wel kende. Nu structureel nodig voor
-- bepaal_btw_regeling (mig 455): een EU-lidstaat-check mag niet afhangen van
-- toevallige spelling.
--
-- Twee delen:
--   1. normaliseer_land: CASE uitgebreid met de resterende EU-landnamen.
--      CH/NO/GB blijven bewust BUITEN de EU-mapping voor is_eu_land (zie deel 2)
--      — Zwitserland/Noorwegen zijn EER maar geen EU-lidstaat, GB is post-Brexit
--      non-EU. De ISO-2-output voor bestaande landen verandert niet.
--   2. is_eu_land(p_iso2): hardcoded array van de 27 EU-lidstaten — zelfde
--      conventie als is_admin_pseudo/effectief_btw_pct (kleine, stabiele lijst,
--      geen tabel: EU-uitbreiding is een zeldzame politieke gebeurtenis, geen
--      operationele wijziging).
--
-- Conventie (mig 389): elke migratie die normaliseer_land wijzigt heet
-- *_normaliseer_land_contract*.sql en eindigt met assert_normaliseer_land_contract()
-- met het VOLLEDIGE golden-blok (niet alleen de nieuwe cases) — de sync-test in
-- normaliseer-land.contract.test.ts pakt de laatste contract-migratie.
-- TS-spiegel bijgewerkt: supabase/functions/_shared/adres-split.ts (LAND_NAAR_ISO2)
-- + frontend/src/lib/orders/__tests__/golden/normaliseer-land.golden.json.
--
-- Idempotent: CREATE OR REPLACE + de assert-aanroep is read-only.

-- ============================================================================
-- 1. normaliseer_land — CASE uitgebreid met de resterende EU-landen
-- ============================================================================
CREATE OR REPLACE FUNCTION public.normaliseer_land(p_land text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_land IS NULL THEN RETURN NULL; END IF;

  v_clean := upper(btrim(p_land));
  IF v_clean = '' THEN RETURN NULL; END IF;

  v_clean := translate(
    v_clean,
    'ÁÀÂÄÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
    'AAAAAACEEEEIIIINOOOOOUUUUY'
  );

  v_clean := regexp_replace(v_clean, '\s+', ' ', 'g');

  IF length(v_clean) = 2 THEN
    RETURN v_clean;
  END IF;

  RETURN CASE v_clean
    WHEN 'NEDERLAND'         THEN 'NL'
    WHEN 'HOLLAND'           THEN 'NL'
    WHEN 'NETHERLANDS'       THEN 'NL'
    WHEN 'THE NETHERLANDS'   THEN 'NL'
    WHEN 'BELGIE'            THEN 'BE'
    WHEN 'BELGIUM'           THEN 'BE'
    WHEN 'BELGIQUE'          THEN 'BE'
    WHEN 'DUITSLAND'         THEN 'DE'
    WHEN 'GERMANY'           THEN 'DE'
    WHEN 'DEUTSCHLAND'       THEN 'DE'
    WHEN 'FRANKRIJK'         THEN 'FR'
    WHEN 'FRANCE'            THEN 'FR'
    WHEN 'LUXEMBURG'         THEN 'LU'
    WHEN 'LUXEMBOURG'        THEN 'LU'
    WHEN 'OOSTENRIJK'        THEN 'AT'
    WHEN 'AUSTRIA'           THEN 'AT'
    WHEN 'OSTERREICH'        THEN 'AT'
    WHEN 'ZWITSERLAND'       THEN 'CH'
    WHEN 'SWITZERLAND'       THEN 'CH'
    WHEN 'SCHWEIZ'           THEN 'CH'
    WHEN 'ITALIE'            THEN 'IT'
    WHEN 'ITALY'             THEN 'IT'
    WHEN 'ITALIA'            THEN 'IT'
    WHEN 'SPANJE'            THEN 'ES'
    WHEN 'SPAIN'             THEN 'ES'
    WHEN 'ESPANA'            THEN 'ES'
    WHEN 'POLEN'             THEN 'PL'
    WHEN 'POLAND'            THEN 'PL'
    WHEN 'POLSKA'            THEN 'PL'
    WHEN 'TSJECHIE'          THEN 'CZ'
    WHEN 'CZECH REPUBLIC'    THEN 'CZ'
    WHEN 'CZECHIA'           THEN 'CZ'
    WHEN 'DENEMARKEN'        THEN 'DK'
    WHEN 'DENMARK'           THEN 'DK'
    WHEN 'DANMARK'           THEN 'DK'
    WHEN 'ZWEDEN'            THEN 'SE'
    WHEN 'SWEDEN'            THEN 'SE'
    WHEN 'SVERIGE'           THEN 'SE'
    WHEN 'NOORWEGEN'         THEN 'NO'
    WHEN 'NORWAY'            THEN 'NO'
    WHEN 'NORGE'             THEN 'NO'
    WHEN 'ENGELAND'          THEN 'GB'
    WHEN 'GROOTBRITTANNIE'   THEN 'GB'
    WHEN 'GROOT-BRITTANNIE'  THEN 'GB'
    WHEN 'UK'                THEN 'GB'
    WHEN 'UNITED KINGDOM'    THEN 'GB'
    WHEN 'IERLAND'           THEN 'IE'
    WHEN 'IRELAND'           THEN 'IE'
    -- Mig 454: resterende EU-lidstaten (bron: backfill-lijst mig 164).
    WHEN 'PORTUGAL'          THEN 'PT'
    WHEN 'SLOVAKIA'          THEN 'SK'
    WHEN 'SLOWAKIJE'         THEN 'SK'
    WHEN 'HUNGARY'           THEN 'HU'
    WHEN 'HONGARIJE'         THEN 'HU'
    WHEN 'MAGYARORSZAG'      THEN 'HU'
    WHEN 'GREECE'            THEN 'GR'
    WHEN 'GRIEKENLAND'       THEN 'GR'
    WHEN 'ELLAS'             THEN 'GR'
    WHEN 'SLOVENIA'          THEN 'SI'
    WHEN 'SLOVENIE'          THEN 'SI'
    WHEN 'ESTONIA'           THEN 'EE'
    WHEN 'ESTLAND'           THEN 'EE'
    WHEN 'LATVIA'            THEN 'LV'
    WHEN 'LETLAND'           THEN 'LV'
    WHEN 'LITHUANIA'         THEN 'LT'
    WHEN 'LITOUWEN'          THEN 'LT'
    WHEN 'BULGARIA'          THEN 'BG'
    WHEN 'BULGARIJE'         THEN 'BG'
    WHEN 'ROMANIA'           THEN 'RO'
    WHEN 'ROEMENIE'          THEN 'RO'
    WHEN 'CROATIA'           THEN 'HR'
    WHEN 'KROATIE'           THEN 'HR'
    WHEN 'CYPRUS'            THEN 'CY'
    WHEN 'MALTA'             THEN 'MT'
    WHEN 'FINLAND'           THEN 'FI'
    WHEN 'SUOMI'             THEN 'FI'
    ELSE v_clean
  END;
END;
$function$;

COMMENT ON FUNCTION normaliseer_land(TEXT) IS
  'Normaliseert een vrij land-veld naar ISO-2. Mig 214 (kernlanden) + mig 454 '
  '(resterende EU-27: PT/SK/HU/GR/SI/EE/LV/LT/BG/RO/HR/CY/MT/FI). Gebruikt door '
  'matcht_regel + bepaal_btw_regeling (mig 455).';

-- ============================================================================
-- 2. is_eu_land — hardcoded EU-27-lidstatenlijst (geen tabel, zie toelichting)
-- ============================================================================
CREATE OR REPLACE FUNCTION is_eu_land(p_iso2 TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_iso2 = ANY(ARRAY[
    'NL','BE','DE','FR','LU','AT','IT','ES','PL','CZ','DK','SE','FI','IE',
    'PT','SK','HU','GR','SI','EE','LV','LT','BG','RO','HR','CY','MT'
  ]);
$$;

GRANT EXECUTE ON FUNCTION is_eu_land(TEXT) TO authenticated;

COMMENT ON FUNCTION is_eu_land(TEXT) IS
  'Mig 454: TRUE als p_iso2 (al genormaliseerd via normaliseer_land) een van de '
  '27 EU-lidstaten is. CH (Zwitserland, EER geen EU-lid), NO (Noorwegen, EER '
  'geen EU-lid), GB (post-Brexit non-EU) bewust uitgesloten. Hardcoded array '
  'i.p.v. tabel — stabiele lijst van 27, zelfde conventie als '
  'is_admin_pseudo/effectief_btw_pct. Gebruikt door bepaal_btw_regeling (mig 455).';

-- ============================================================================
-- 3. Contract-assert — golden fixtures (mig 389-conventie), volledige lijst
-- ============================================================================
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
    { "naam": "randspaties Nederland NL", "input": "  Nederland  ", "verwacht": "NL" },
    { "naam": "Portugal PT", "input": "Portugal", "verwacht": "PT" },
    { "naam": "Slovakia SK", "input": "Slovakia", "verwacht": "SK" },
    { "naam": "Slowakije SK", "input": "Slowakije", "verwacht": "SK" },
    { "naam": "Hungary HU", "input": "Hungary", "verwacht": "HU" },
    { "naam": "Hongarije HU", "input": "Hongarije", "verwacht": "HU" },
    { "naam": "Greece GR", "input": "Greece", "verwacht": "GR" },
    { "naam": "Griekenland GR", "input": "Griekenland", "verwacht": "GR" },
    { "naam": "Slovenia SI", "input": "Slovenia", "verwacht": "SI" },
    { "naam": "Estonia EE", "input": "Estonia", "verwacht": "EE" },
    { "naam": "Estland EE", "input": "Estland", "verwacht": "EE" },
    { "naam": "Latvia LV", "input": "Latvia", "verwacht": "LV" },
    { "naam": "Letland LV", "input": "Letland", "verwacht": "LV" },
    { "naam": "Lithuania LT", "input": "Lithuania", "verwacht": "LT" },
    { "naam": "Litouwen LT", "input": "Litouwen", "verwacht": "LT" },
    { "naam": "Bulgaria BG", "input": "Bulgaria", "verwacht": "BG" },
    { "naam": "Bulgarije BG", "input": "Bulgarije", "verwacht": "BG" },
    { "naam": "Romania RO", "input": "Romania", "verwacht": "RO" },
    { "naam": "Roemenie RO", "input": "Roemenie", "verwacht": "RO" },
    { "naam": "Croatia HR", "input": "Croatia", "verwacht": "HR" },
    { "naam": "Kroatie HR", "input": "Kroatie", "verwacht": "HR" },
    { "naam": "Cyprus CY", "input": "Cyprus", "verwacht": "CY" },
    { "naam": "Malta MT", "input": "Malta", "verwacht": "MT" },
    { "naam": "Finland FI", "input": "Finland", "verwacht": "FI" },
    { "naam": "Suomi FI", "input": "Suomi", "verwacht": "FI" }
  ]
}
$golden$::jsonb);

NOTIFY pgrst, 'reload schema';
