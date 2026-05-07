-- Migratie 202: betaalcondities als beheerbare referentielijst
--
-- Doel: `debiteuren.betaalconditie` was tot nu toe vrij TEXT (bv. "31 - 30
-- dagen netto", "50 - 45 Tage Netto") waarvan de factuur-RPC (mig 119) het
-- leidende getal eruit regext om de betaaltermijn te bepalen. Geen lijst
-- om uit te kiezen, geen centraal beheer.
--
-- Deze migratie voegt een `betaalcondities`-tabel toe met de bestaande
-- waarden geseed, RLS volgens project-conventie, en een
-- updated_at-trigger. De `debiteuren.betaalconditie`-kolom blijft TEXT —
-- de UI gaat een dropdown tonen die de waarde als
-- "{code} - {naam}" terugschrijft, zodat de factuur-RPC ongewijzigd
-- blijft werken. Een latere migratie kan de TEXT-kolom alsnog vervangen
-- door een echte FK.
--
-- Idempotent — alle creates met IF NOT EXISTS en seed met ON CONFLICT.

------------------------------------------------------------------------
-- 1. Tabel betaalcondities
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS betaalcondities (
  code         TEXT PRIMARY KEY,
  naam         TEXT NOT NULL,
  dagen        INTEGER,
  omschrijving TEXT,
  actief       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE betaalcondities IS
  'Beheerbare referentielijst van betaalcondities. UI-dropdown op klant-detail '
  'gebruikt de actieve rijen. Bron: bestaande waarden uit debiteuren.betaalconditie '
  'geseed in mig 202 (2026-05-06).';
COMMENT ON COLUMN betaalcondities.code IS
  'Korte code zoals geërfd uit het oude ERP (bv. "31"). Wordt teruggeschreven '
  'naar debiteuren.betaalconditie als prefix: "{code} - {naam}".';
COMMENT ON COLUMN betaalcondities.dagen IS
  'Betaaltermijn in dagen — gebruikt door de factuur-RPC (vervalt-veld). '
  'NULL = onbekend, RPC valt dan terug op default (30).';

------------------------------------------------------------------------
-- 2. RLS — _all policy voor authenticated, conform project-conventie
------------------------------------------------------------------------

ALTER TABLE betaalcondities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS betaalcondities_all ON betaalcondities;
CREATE POLICY betaalcondities_all
  ON betaalcondities
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

------------------------------------------------------------------------
-- 3. updated_at trigger
------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_betaalcondities_updated_at ON betaalcondities;
CREATE TRIGGER trg_betaalcondities_updated_at
  BEFORE UPDATE ON betaalcondities
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

------------------------------------------------------------------------
-- 4. Seed: extracteer unieke betaalcondities uit bestaande debiteuren-data
------------------------------------------------------------------------
-- Format in DB: "{code} - {description}" waar code een leidend getal is en
-- description de menselijke uitleg ("30 dagen netto", "45 Tage Netto", etc.).
-- Dagen worden uit description geparsed met regex `\b(\d+)\s*(dagen|tage|days)`.

INSERT INTO betaalcondities (code, naam, dagen)
SELECT
  trim(split_part(d.betaalconditie, '-', 1))                                  AS code,
  trim(substring(d.betaalconditie FROM '-\s*(.*)$'))                          AS naam,
  CASE
    WHEN d.betaalconditie ~* '\b\d+\s*(dagen|tage|days|tag|day)\b'
      THEN (regexp_match(d.betaalconditie, '\b(\d+)\s*(?:dagen|tage|days|tag|day)\b', 'i'))[1]::INTEGER
    ELSE NULL
  END                                                                         AS dagen
FROM (
  SELECT DISTINCT betaalconditie
  FROM debiteuren
  WHERE betaalconditie IS NOT NULL
    AND trim(betaalconditie) <> ''
    AND betaalconditie ~ '^\s*\d+\s*-'
) d
ON CONFLICT (code) DO NOTHING;

-- Vangnet: voor debiteuren met een betaalconditie die NIET het
-- "{code} - {naam}"-formaat volgt (vrije tekst), seeden we niet — dat zou
-- gegarandeerd inconsistente codes geven. De UI behandelt zulke rijen als
-- "(geen betaalconditie geselecteerd)" en geeft de gebruiker keuze om er
-- één toe te wijzen. Het oorspronkelijke TEXT-veld blijft staan zolang
-- niemand de dropdown gebruikt.

------------------------------------------------------------------------
-- 5. Rapport — toon de seed en eventueel niet-gematchte rijen
------------------------------------------------------------------------

DO $$
DECLARE
  v_seeded     INTEGER;
  v_orphan_cnt INTEGER;
  v_orphan     TEXT;
BEGIN
  SELECT COUNT(*) INTO v_seeded FROM betaalcondities;
  SELECT COUNT(*) INTO v_orphan_cnt
    FROM debiteuren
    WHERE betaalconditie IS NOT NULL
      AND trim(betaalconditie) <> ''
      AND betaalconditie !~ '^\s*\d+\s*-';

  RAISE NOTICE 'Mig 202 betaalcondities-seed:';
  RAISE NOTICE '  Aangemaakt / aanwezig: % rijen', v_seeded;
  RAISE NOTICE '  Debiteuren met niet-standaard format: %', v_orphan_cnt;

  IF v_orphan_cnt > 0 THEN
    RAISE NOTICE 'Voorbeelden van niet-gematchte betaalconditie-waarden:';
    FOR v_orphan IN
      SELECT format('  "%s" (%s debiteur(en))', betaalconditie, COUNT(*))
      FROM debiteuren
      WHERE betaalconditie IS NOT NULL
        AND trim(betaalconditie) <> ''
        AND betaalconditie !~ '^\s*\d+\s*-'
      GROUP BY betaalconditie
      ORDER BY COUNT(*) DESC
      LIMIT 10
    LOOP
      RAISE NOTICE '%', v_orphan;
    END LOOP;
  END IF;
END $$;

------------------------------------------------------------------------
-- 6. View met aantal gebruikers per conditie — handig voor de overzichtspagina
------------------------------------------------------------------------

CREATE OR REPLACE VIEW betaalcondities_met_aantal_klanten AS
SELECT
  bc.code,
  bc.naam,
  bc.dagen,
  bc.omschrijving,
  bc.actief,
  bc.created_at,
  bc.updated_at,
  COALESCE(c.aantal, 0)::INTEGER AS aantal_klanten
FROM betaalcondities bc
LEFT JOIN (
  SELECT trim(split_part(betaalconditie, '-', 1)) AS code, COUNT(*)::INTEGER AS aantal
  FROM debiteuren
  WHERE betaalconditie IS NOT NULL
    AND betaalconditie ~ '^\s*\d+\s*-'
  GROUP BY 1
) c ON c.code = bc.code;

COMMENT ON VIEW betaalcondities_met_aantal_klanten IS
  'Betaalcondities + huidig aantal klanten dat deze conditie gebruikt '
  '(via prefix-match op debiteuren.betaalconditie). Mig 202.';

NOTIFY pgrst, 'reload schema';
