-- Migratie 162: producten.ean_code cleanup + tolerante EDI-matching
--
-- Probleem (gevonden 2026-04-30 bij eerste echte BDSK-upload):
--   producten.ean_code bevat consistent een trailing ".0"-suffix —
--   bijvoorbeeld "8715954176023.0" — als gevolg van een Excel-import die
--   de GTIN-kolom als FLOAT in plaats van TEXT las (pandas/openpyxl gedrag).
--   Bij EDI-matching levert het bericht een schone GTIN ("8715954176023"),
--   waardoor `WHERE ean_code = p_gtin` nooit matcht en alle EDI-orderregels
--   vallen terug op "[EDI ongematcht]".
--
-- Aanpak:
--   1. Eenmalige cleanup: strip ".0"-suffix van alle bestaande rijen.
--   2. Defensieve normalisatie-trigger: bij elke INSERT/UPDATE strip
--      automatisch ".0"-suffix én niet-cijfer prefixes/suffixes. Voorkomt
--      dat een toekomstige import dezelfde fout opnieuw introduceert.
--   3. match_edi_artikel uitbreiden: tolereert beide varianten als
--      safety net voor onverwachte ean_code-formats.
--
-- Idempotent.

-- ============================================================================
-- 1. Eenmalige cleanup
-- ============================================================================

UPDATE producten
   SET ean_code = LEFT(ean_code, LENGTH(ean_code) - 2)
 WHERE ean_code LIKE '%.0';

-- Sanity check: log hoeveel rijen daarna nog niet-cijfer ean_codes hebben.
DO $$
DECLARE
  v_overig INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_overig
    FROM producten
   WHERE ean_code IS NOT NULL
     AND ean_code <> ''
     AND ean_code !~ '^[0-9]+$';
  IF v_overig > 0 THEN
    RAISE NOTICE
      'Migratie 162: % producten hebben nog steeds een niet-numerieke ean_code. '
      'Inspecteer handmatig met: SELECT artikelnr, ean_code FROM producten WHERE ean_code !~ ''^[0-9]+$'';',
      v_overig;
  ELSE
    RAISE NOTICE 'Migratie 162: alle ean_codes zijn nu schoon-numeriek.';
  END IF;
END $$;

-- ============================================================================
-- 2. Normalisatie-trigger op producten
-- ============================================================================

CREATE OR REPLACE FUNCTION producten_normaliseer_ean_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ean_code IS NULL OR NEW.ean_code = '' THEN
    RETURN NEW;
  END IF;

  -- Strip trailing ".0" of ".00" enz. (resultaat van Excel float-import)
  IF NEW.ean_code ~ '\.0+$' THEN
    NEW.ean_code := regexp_replace(NEW.ean_code, '\.0+$', '');
  END IF;

  -- Strip whitespace die soms in copy-paste imports sluipt
  NEW.ean_code := TRIM(BOTH FROM NEW.ean_code);

  -- Lege string na trimming → NULL (semantisch correcter dan empty TEXT)
  IF NEW.ean_code = '' THEN
    NEW.ean_code := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_producten_normaliseer_ean_code ON producten;
CREATE TRIGGER trg_producten_normaliseer_ean_code
  BEFORE INSERT OR UPDATE OF ean_code ON producten
  FOR EACH ROW
  EXECUTE FUNCTION producten_normaliseer_ean_code();

COMMENT ON FUNCTION producten_normaliseer_ean_code IS
  'Strip trailing ".0"-suffix en whitespace van producten.ean_code. '
  'Voorkomt dat Excel-imports de EDI-GTIN-matching breken.';

-- ============================================================================
-- 3. match_edi_artikel: tolerante matching als safety net
--
-- Behoudt prio 1 (GTIN exact), voegt prio 1b toe (GTIN met ".0"-suffix in DB),
-- prio 2 (artikelcode exact) en prio 3 (eerste token) blijven ongewijzigd.
-- ============================================================================

CREATE OR REPLACE FUNCTION match_edi_artikel(
  p_gtin        TEXT,
  p_artikelcode TEXT
) RETURNS TABLE(
  artikelnr     TEXT,
  omschrijving  TEXT,
  verkoopprijs  NUMERIC
) AS $$
DECLARE
  v_eerste_token TEXT;
BEGIN
  -- 1a. GTIN-match exact
  IF p_gtin IS NOT NULL AND p_gtin <> '' THEN
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.ean_code = p_gtin
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 1b. GTIN-match met ".0"-suffix tolerantie (defensief — trigger zou dit
    --     normaliter al hebben opgeruimd, maar als een rij ooit binnenkomt
    --     zonder de trigger te triggeren, hier nog een vangnet).
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.ean_code = p_gtin || '.0'
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2. Volledige artikelcode → artikelnr
  IF p_artikelcode IS NOT NULL AND p_artikelcode <> '' THEN
    RETURN QUERY
    SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
      FROM producten p
     WHERE p.artikelnr = p_artikelcode
     LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 3. Eerste token (vóór spatie) → artikelnr
    v_eerste_token := split_part(p_artikelcode, ' ', 1);
    IF v_eerste_token <> '' AND v_eerste_token <> p_artikelcode THEN
      RETURN QUERY
      SELECT p.artikelnr, p.omschrijving, p.verkoopprijs
        FROM producten p
       WHERE p.artikelnr = v_eerste_token
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;
    END IF;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION match_edi_artikel IS
  'Drie-staps EDI-artikel-matching met defensieve ean_code-tolerantie. '
  '1a) GTIN exact → ean_code, 1b) GTIN+".0" (legacy Excel-import-residu), '
  '2) volledige artikelcode → artikelnr, 3) eerste token → artikelnr. '
  'Migratie 159, defensief uitgebreid in 162.';
