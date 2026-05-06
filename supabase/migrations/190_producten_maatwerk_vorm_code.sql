-- Migratie 190: koppel voorraadproducten aan een logische vorm-code
--
-- Doel: voor de prijs-resolver (mig 191) moet het systeem voor een vaste-maat
-- voorraadproduct kunnen bepalen of het een organisch/ovaal/pebble/ellips/
-- afgeronde-hoeken/rechthoek/rond tapijt is, zodat de juiste vormtoeslag
-- (€0/€75 — bron `maatwerk_vormen.toeslag`) toegepast kan worden bij m²-
-- fallback. De bestaande kolom `producten.vorm` is bewust beperkt tot
-- 'rechthoek'/'rond' (mig 188, t.b.v. gewicht-formule). Voor prijsbepaling
-- hebben we de fijnere indeling van `maatwerk_vormen.code` nodig.
--
-- NULL = vorm onbekend → resolver gedraagt zich als rechthoek (€0 toeslag).
-- Gebruiker kan handmatig zetten via productbeheer (volgt in losse PR).

------------------------------------------------------------------------
-- 1. Nieuwe kolom + FK
------------------------------------------------------------------------

ALTER TABLE producten
  ADD COLUMN IF NOT EXISTS maatwerk_vorm_code TEXT
    REFERENCES maatwerk_vormen(code) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_producten_maatwerk_vorm_code
  ON producten(maatwerk_vorm_code) WHERE maatwerk_vorm_code IS NOT NULL;

COMMENT ON COLUMN producten.maatwerk_vorm_code IS
  'Logische vormcode (FK → maatwerk_vormen.code) voor prijs-resolver. '
  'Bepaalt vormtoeslag bij m²-fallback in bereken_orderregel_prijs. '
  'NULL = onbekend (resolver behandelt als rechthoek, €0 toeslag). '
  'Zie ook producten.vorm (rechthoek|rond) — die voedt de gewicht-formule.';

------------------------------------------------------------------------
-- 2. Backfill — alleen 100% zekere mappings
------------------------------------------------------------------------
-- Patronen:
--   karpi_code-suffix `\d{3}RND$`  → 'rond'   (mig 188 zet ook producten.vorm='rond')
--   karpi_code-suffix `\d{3}OVL$`  → 'ovaal'
--   omschrijving bevat 'ORGANISCH' → 'organisch_a' (default-keuze; A vs B is
--     visueel onderscheid, prijs/levertijd identiek. Klant kan handmatig
--     wijzigen indien nodig.)
--   omschrijving bevat 'PEBBLE'    → 'pebble'
--   omschrijving bevat 'ELLIPS'    → 'ellips'
--   omschrijving bevat 'AFGEROND'  → 'afgeronde_hoeken' (matcht "AFGERONDE
--     HOEKEN")
--
-- Ambiguïteit: een product met zowel 'OVAAL' als 'ORGANISCH' krijgt 'ovaal'
-- (eerste match in CASE wint). Onbekend → NULL → rechthoek-fallback.

UPDATE producten p
SET maatwerk_vorm_code = CASE
    WHEN p.karpi_code ~ '^.{8}\d{3}RND$' THEN 'rond'
    WHEN p.karpi_code ~ '^.{8}\d{3}OVL$' THEN 'ovaal'
    WHEN upper(coalesce(p.omschrijving,'')) LIKE '%PEBBLE%'    THEN 'pebble'
    WHEN upper(coalesce(p.omschrijving,'')) LIKE '%ELLIPS%'    THEN 'ellips'
    WHEN upper(coalesce(p.omschrijving,'')) LIKE '%AFGEROND%'  THEN 'afgeronde_hoeken'
    WHEN upper(coalesce(p.omschrijving,'')) LIKE '%ORGANISCH%' THEN 'organisch_a'
    ELSE NULL
  END
WHERE p.maatwerk_vorm_code IS NULL;

------------------------------------------------------------------------
-- 3. Verifier-rapport
------------------------------------------------------------------------

DO $$
DECLARE
  v_total      INTEGER;
  v_per_vorm   TEXT;
  v_voorbeeld  TEXT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM producten;
  RAISE NOTICE 'Mig 190 backfill-rapport (totaal % producten):', v_total;

  FOR v_per_vorm IN
    SELECT format('  vorm=%s : %s producten',
                  COALESCE(maatwerk_vorm_code,'(NULL=rechthoek)'),
                  lpad(COUNT(*)::TEXT, 5))
    FROM producten
    GROUP BY maatwerk_vorm_code
    ORDER BY COUNT(*) DESC
  LOOP
    RAISE NOTICE '%', v_per_vorm;
  END LOOP;

  -- Sanity check op test-case 771150045 (CISCO 15 CA 240x340 ORGANISCH)
  SELECT format('  Testcase 771150045: maatwerk_vorm_code=%s, omschrijving="%s"',
                COALESCE(maatwerk_vorm_code,'NULL'),
                COALESCE(omschrijving,''))
    INTO v_voorbeeld
    FROM producten WHERE artikelnr = '771150045';
  IF v_voorbeeld IS NOT NULL THEN
    RAISE NOTICE '%', v_voorbeeld;
  END IF;
END $$;
