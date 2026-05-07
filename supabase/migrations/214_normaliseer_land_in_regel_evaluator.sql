-- Migratie 214: normaliseer land vóór regel-match (selectie-evaluator)
--
-- Probleem
-- --------
-- `orders.afl_land` (en de gekopieerde `zendingen.afl_land`) is een vrij TEXT-
-- veld. Afhankelijk van de orderbron kan het 'NL', 'Nederland', 'Holland',
-- 'BELGIË', 'belgium', 'NL ' bevatten. Tot nu toe deed `matcht_regel` (mig 210)
-- exacte string-equality:
--
--     IF NOT (zending.afl_land = ANY(conditie.land)) THEN false
--
-- Resultaat: een regel met `land=['NL']` matcht wel een order met
-- `afl_land='NL'`, maar niet eentje met `afl_land='Nederland'`. Dat veroorzaakt
-- silent fallthroughs naar generiekere regels of "geen vervoerder gekozen".
--
-- Aanpak
-- ------
-- Eén normaliseer-functie `normaliseer_land(TEXT)` die zowel ISO-2-codes als
-- volledige Nederlandse/Engelse/Duitse landnamen mapt naar ISO-2 (`'Nederland'`
-- → `'NL'`, `'BELGIË'` → `'BE'`). De functie strip whitespace, doet upper-case
-- en vervangt de meest voorkomende diakritieken (E/A/O/U/C/N + accenten) zonder
-- de `unaccent`-extensie te introduceren — Karpi gebruikt geen Postgres-
-- extensies en de set landen is klein en stabiel.
--
-- `matcht_regel` past beide zijden van de land-vergelijking door deze functie:
-- regel-conditie en zending-attribuut. Onbekende waardes worden uppercased
-- doorgegeven, dus regels op exotische landen blijven werken zolang regel en
-- zending dezelfde spelling hanteren.
--
-- Geen schema-wijziging — alleen functie-updates. Idempotent.

-- ============================================================================
-- 1. normaliseer_land
-- ============================================================================
CREATE OR REPLACE FUNCTION normaliseer_land(p_land TEXT) RETURNS TEXT AS $$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_land IS NULL THEN RETURN NULL; END IF;

  -- Trim, uppercase, en vervang de paar diakritieken die in landnamen voorkomen.
  -- We doen dit zonder unaccent-extensie omdat de set klein en bekend is.
  v_clean := upper(btrim(p_land));
  IF v_clean = '' THEN RETURN NULL; END IF;

  v_clean := translate(
    v_clean,
    'ÁÀÂÄÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
    'AAAAAACEEEEIIIINOOOOOUUUUY'
  );

  -- Verwijder eventuele dubbele spaties (bv. "UNITED  KINGDOM").
  v_clean := regexp_replace(v_clean, '\s+', ' ', 'g');

  -- Reeds een ISO-2-code (twee letters) → as-is teruggeven.
  IF length(v_clean) = 2 THEN
    RETURN v_clean;
  END IF;

  -- Mapping voor Karpi's afzetgebied + de meest voorkomende afleverlanden.
  -- Onbekende waardes komen ongewijzigd terug — een regel met die spelling
  -- blijft dan matchen zolang de zending dezelfde spelling heeft.
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
    ELSE v_clean
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

GRANT EXECUTE ON FUNCTION normaliseer_land(TEXT) TO authenticated;

COMMENT ON FUNCTION normaliseer_land(TEXT) IS
  'Normaliseert een vrij land-veld (TEXT) naar ISO-2-code. Accepteert ISO-2 '
  '(''NL''), Nederlandse/Engelse/Duitse/lokale namen (''Nederland'', '
  '''Belgique'', ''Deutschland'') en strip diakritieken/whitespace. Onbekende '
  'waardes komen uppercased terug. Gebruikt door matcht_regel (mig 214) om '
  'land-conditie en zending.afl_land robuust te vergelijken.';

-- ============================================================================
-- 2. matcht_regel — land-vergelijking nu via normaliseer_land
-- ============================================================================
CREATE OR REPLACE FUNCTION matcht_regel(
  p_conditie       JSONB,
  p_land           TEXT,
  p_kleinste_zijde INTEGER,
  p_gewicht_kg     NUMERIC,
  p_debiteur_nr    INTEGER,
  p_inkoopgroep    TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_landen      TEXT[];
  v_land_norm   TEXT;
  v_min         INTEGER;
  v_max         INTEGER;
  v_g_max       NUMERIC;
  v_g_min       NUMERIC;
  v_debs        INTEGER[];
  v_groepen     TEXT[];
BEGIN
  -- Lege conditie → fallback-regel, altijd match
  IF p_conditie IS NULL OR p_conditie = '{}'::JSONB THEN
    RETURN TRUE;
  END IF;

  -- land: TEXT[] of single string. Beide zijden door normaliseer_land zodat
  -- 'NL' / 'Nederland' / 'BELGIE' / 'BE' onderling matchen (mig 214).
  IF p_conditie ? 'land' THEN
    SELECT array_agg(normaliseer_land(value::TEXT)) INTO v_landen
      FROM jsonb_array_elements_text(p_conditie->'land') AS value;
    v_land_norm := normaliseer_land(p_land);
    IF v_land_norm IS NULL OR NOT (v_land_norm = ANY(v_landen)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- kleinste_zijde_cm_min: zending kleinste-zijde >= waarde
  IF p_conditie ? 'kleinste_zijde_cm_min' THEN
    v_min := (p_conditie->>'kleinste_zijde_cm_min')::INTEGER;
    IF p_kleinste_zijde IS NULL OR p_kleinste_zijde < v_min THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- kleinste_zijde_cm_max: zending kleinste-zijde <= waarde
  IF p_conditie ? 'kleinste_zijde_cm_max' THEN
    v_max := (p_conditie->>'kleinste_zijde_cm_max')::INTEGER;
    IF p_kleinste_zijde IS NULL OR p_kleinste_zijde > v_max THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- gewicht_kg_max
  IF p_conditie ? 'gewicht_kg_max' THEN
    v_g_max := (p_conditie->>'gewicht_kg_max')::NUMERIC;
    IF p_gewicht_kg IS NULL OR p_gewicht_kg > v_g_max THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- gewicht_kg_min
  IF p_conditie ? 'gewicht_kg_min' THEN
    v_g_min := (p_conditie->>'gewicht_kg_min')::NUMERIC;
    IF p_gewicht_kg IS NULL OR p_gewicht_kg < v_g_min THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- debiteur_nrs
  IF p_conditie ? 'debiteur_nrs' THEN
    SELECT array_agg((value::TEXT)::INTEGER) INTO v_debs
      FROM jsonb_array_elements_text(p_conditie->'debiteur_nrs') AS value;
    IF p_debiteur_nr IS NULL OR NOT (p_debiteur_nr = ANY(v_debs)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- inkoopgroep_codes
  IF p_conditie ? 'inkoopgroep_codes' THEN
    SELECT array_agg(value::TEXT) INTO v_groepen
      FROM jsonb_array_elements_text(p_conditie->'inkoopgroep_codes') AS value;
    IF p_inkoopgroep IS NULL OR NOT (p_inkoopgroep = ANY(v_groepen)) THEN
      RETURN FALSE;
    END IF;
  END IF;

  -- Onbekende sleutels: negeren (forward-compat).
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION matcht_regel IS
  'AND-evaluatie van een conditie-JSONB tegen zending-attributen. Sinds mig 214: '
  'land-vergelijking gaat door normaliseer_land() zodat ''NL''/''Nederland''/'
  '''BELGIE''/''BE'' onderling matchen. Andere sleutels (gewicht, kleinste_zijde, '
  'debiteur_nrs, inkoopgroep_codes) onveranderd. Onbekende sleutels worden '
  'genegeerd voor forward-compat.';

NOTIFY pgrst, 'reload schema';
