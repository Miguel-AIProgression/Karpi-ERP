-- Migratie 189: inkoopgroepen als first-class entiteit
--
-- Doel: 10 INKC-organisaties (BEGROS, DECOR UNION, FACHHANDELSRING, INTERRING,
-- VME, VME (TH), TINTTO, INHOUSE, HOUSE OF DUTCHZ, MUSTERRING) krijgen een
-- eigen tabel + FK vanuit `debiteuren`. Bestaande TEXT-kolom
-- `debiteuren.inkooporganisatie` wordt ge-backfilled naar de FK en daarna
-- gedropt. `orders.inkooporganisatie` (ook TEXT) blijft als snapshot —
-- orders mogen niet meebewegen als groepslidmaatschap wijzigt.
--
-- Cardinaliteit: 1 debiteur ↔ max 1 inkoopgroep (bevestigd door owner).
-- Idempotent: alle creates met IF NOT EXISTS.

------------------------------------------------------------------------
-- 1. Tabel inkoopgroepen
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inkoopgroepen (
  code         TEXT PRIMARY KEY,
  naam         TEXT NOT NULL,
  omschrijving TEXT,
  actief       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inkoopgroepen IS
  'Inkooporganisaties (INKC-codes) waaronder debiteuren samen inkopen en '
  'aan een gedeelde prijslijst/korting hangen. Bron: 10 Excel-bestanden '
  'in project-root. Mig 189 (2026-05-06).';

------------------------------------------------------------------------
-- 2. Seed de 10 bekende groepen
------------------------------------------------------------------------

INSERT INTO inkoopgroepen (code, naam) VALUES
  ('INKC02', 'BEGROS'),
  ('INKC11', 'DECOR UNION'),
  ('INKC14', 'FACHHANDELSRING'),
  ('INKC21', 'INTERRING'),
  ('INKC41', 'VME'),
  ('INKC43', 'VME (TH)'),
  ('INKC47', 'TINTTO'),
  ('INKC51', 'INHOUSE'),
  ('INKC55', 'HOUSE OF DUTCHZ'),
  ('INKC57', 'MUSTERRING')
ON CONFLICT (code) DO NOTHING;

------------------------------------------------------------------------
-- 3. updated_at trigger
------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_inkoopgroepen_updated_at ON inkoopgroepen;
CREATE TRIGGER trg_inkoopgroepen_updated_at
  BEFORE UPDATE ON inkoopgroepen
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

------------------------------------------------------------------------
-- 4. FK-kolom op debiteuren + index
------------------------------------------------------------------------

ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS inkoopgroep_code TEXT
    REFERENCES inkoopgroepen(code) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_debiteuren_inkoopgroep_code
  ON debiteuren(inkoopgroep_code);

COMMENT ON COLUMN debiteuren.inkoopgroep_code IS
  'FK naar inkoopgroepen.code. Vervangt losse TEXT-kolom inkooporganisatie '
  '(mig 189). Een debiteur hoort aan max 1 inkoopgroep.';

------------------------------------------------------------------------
-- 5. Backfill vanuit bestaande TEXT-kolom (voorzichtig — alleen waar match)
------------------------------------------------------------------------
-- Normaliseer: trim, upper-case, alle whitespace eruit. 'INKC 14' -> 'INKC14'.

UPDATE debiteuren d
SET inkoopgroep_code = ig.code
FROM inkoopgroepen ig
WHERE d.inkoopgroep_code IS NULL
  AND d.inkooporganisatie IS NOT NULL
  AND upper(regexp_replace(d.inkooporganisatie, '\s+', '', 'g')) = ig.code;

------------------------------------------------------------------------
-- 6. Verifier-rapport vóór drop — wijst op niet-gematchte waarden
------------------------------------------------------------------------

DO $$
DECLARE
  v_total      INTEGER;
  v_matched    INTEGER;
  v_unmatched  INTEGER;
  v_per_groep  TEXT;
  v_orphan_val TEXT;
BEGIN
  SELECT COUNT(*) INTO v_total
    FROM debiteuren WHERE inkooporganisatie IS NOT NULL;
  SELECT COUNT(*) INTO v_matched
    FROM debiteuren WHERE inkoopgroep_code IS NOT NULL;
  SELECT COUNT(*) INTO v_unmatched
    FROM debiteuren
    WHERE inkooporganisatie IS NOT NULL AND inkoopgroep_code IS NULL;

  RAISE NOTICE 'Mig 189 backfill-rapport:';
  RAISE NOTICE '  Debiteuren met oude inkooporganisatie-string: %', v_total;
  RAISE NOTICE '  Succesvol gematcht naar inkoopgroep_code:     %', v_matched;
  RAISE NOTICE '  Niet-gematcht (verloren bij drop):            %', v_unmatched;

  -- Verdeling per nieuwe groep
  FOR v_per_groep IN
    SELECT format('  %s = %s leden', code, COALESCE(c.aantal, 0))
    FROM inkoopgroepen ig
    LEFT JOIN (
      SELECT inkoopgroep_code, COUNT(*) AS aantal
      FROM debiteuren WHERE inkoopgroep_code IS NOT NULL
      GROUP BY 1
    ) c ON c.inkoopgroep_code = ig.code
    ORDER BY ig.code
  LOOP
    RAISE NOTICE '%', v_per_groep;
  END LOOP;

  -- Niet-gematchte unieke waarden tonen (zodat owner kan beslissen of er
  -- een groep ontbreekt voordat de oude kolom verdwijnt)
  IF v_unmatched > 0 THEN
    RAISE NOTICE 'Niet-gematchte oude inkooporganisatie-waarden:';
    FOR v_orphan_val IN
      SELECT format('  "%s" (%s rijen)', inkooporganisatie, COUNT(*))
      FROM debiteuren
      WHERE inkooporganisatie IS NOT NULL AND inkoopgroep_code IS NULL
      GROUP BY inkooporganisatie
      ORDER BY COUNT(*) DESC
    LOOP
      RAISE NOTICE '%', v_orphan_val;
    END LOOP;
  END IF;
END $$;

------------------------------------------------------------------------
-- 7. Drop oude TEXT-kolom
------------------------------------------------------------------------
-- Ongematchte waarden gaan verloren. Bij grote unmatched-aantallen: owner
-- breidt de seed bij stap 2 uit en re-runt vóór deze stap.

ALTER TABLE debiteuren DROP COLUMN IF EXISTS inkooporganisatie;

------------------------------------------------------------------------
-- 8. View met aantal leden — handig voor het overzichtsscherm
------------------------------------------------------------------------

CREATE OR REPLACE VIEW inkoopgroepen_met_aantal_leden AS
SELECT
  ig.code,
  ig.naam,
  ig.omschrijving,
  ig.actief,
  ig.created_at,
  ig.updated_at,
  COALESCE(c.aantal, 0)::INTEGER AS aantal_leden
FROM inkoopgroepen ig
LEFT JOIN (
  SELECT inkoopgroep_code, COUNT(*)::INTEGER AS aantal
  FROM debiteuren
  WHERE inkoopgroep_code IS NOT NULL
  GROUP BY inkoopgroep_code
) c ON c.inkoopgroep_code = ig.code;

COMMENT ON VIEW inkoopgroepen_met_aantal_leden IS
  'Inkoopgroepen + huidig aantal gekoppelde debiteuren. Gebruikt door '
  'frontend overzichtspagina. Mig 189.';
