-- Migratie 528: klant-toeslag — schema + backfill
--
-- Voegt een klant-instelbare toeslag toe: een procentuele opslag die per debiteur
-- geconfigureerd kan worden met een geldigheidsperiode. Alleen actief als
-- toeslag_actief=TRUE én CURRENT_DATE BETWEEN toeslag_begindatum AND toeslag_einddatum.
--
-- Op de factuur verschijnt de toeslag als eigen totaal-sectie-regel (Optie II),
-- NIET als factuur_regel — zie projecteer_concept_factuur (mig 529).
-- Op de order verschijnt hij als pseudo-orderregel artikelnr='TOESLAG'.
--
-- De toeslagtekst ondersteunt plaatshouder {percentage} die het systeem automatisch
-- vervangt door het geformatteerde percentage (NL-notatie met komma).

-- -------------------------------------------------------------------
-- 1. debiteuren: toeslag-instellingen
-- -------------------------------------------------------------------
ALTER TABLE debiteuren
  ADD COLUMN IF NOT EXISTS toeslag_actief       BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS toeslag_procent      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS toeslag_omschrijving TEXT,
  ADD COLUMN IF NOT EXISTS toeslag_begindatum   DATE,
  ADD COLUMN IF NOT EXISTS toeslag_einddatum    DATE;

COMMENT ON COLUMN debiteuren.toeslag_actief       IS 'Klant-toeslag ingeschakeld. Alleen geldig binnen toeslag_begindatum..einddatum.';
COMMENT ON COLUMN debiteuren.toeslag_procent      IS 'Toeslagpercentage (bv. 4.50 = 4,5%). Verplicht als toeslag_actief=TRUE.';
COMMENT ON COLUMN debiteuren.toeslag_omschrijving IS 'Toeslagtekst die op de factuur verschijnt. Plaatshouder {percentage} wordt vervangen door het geformatteerde percentage.';
COMMENT ON COLUMN debiteuren.toeslag_begindatum   IS 'Eerste dag waarop de toeslag geldt (inclusief). Factuurdatum wordt getoetst.';
COMMENT ON COLUMN debiteuren.toeslag_einddatum    IS 'Laatste dag waarop de toeslag geldt (inclusief). Na deze datum geen toeslag meer zonder handmatige actie.';

-- Integriteitsconstraint: toeslag_actief=TRUE vereist alle vier velden.
ALTER TABLE debiteuren
  ADD CONSTRAINT debiteuren_toeslag_volledig CHECK (
    NOT toeslag_actief
    OR (
      toeslag_procent      IS NOT NULL AND toeslag_procent > 0
      AND toeslag_omschrijving IS NOT NULL AND toeslag_omschrijving <> ''
      AND toeslag_begindatum   IS NOT NULL
      AND toeslag_einddatum    IS NOT NULL
      AND toeslag_einddatum    > toeslag_begindatum
    )
  );

-- -------------------------------------------------------------------
-- 2. facturen: toeslag-snapshot (Optie II — eigen totaal-sectie, niet via factuur_regels)
-- -------------------------------------------------------------------
ALTER TABLE facturen
  ADD COLUMN IF NOT EXISTS toeslag_bedrag        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS toeslag_omschrijving  TEXT;

COMMENT ON COLUMN facturen.toeslag_bedrag       IS 'Berekende toeslag op het moment van facturatie. 0 als geen toeslag van toepassing.';
COMMENT ON COLUMN facturen.toeslag_omschrijving IS 'Toeslagtekst met {percentage} al ingevuld zoals hij op de factuur staat.';

-- totaal = subtotaal + toeslag_bedrag + btw_bedrag (mig 529 past de formule aan)

-- -------------------------------------------------------------------
-- 3. Pseudo-artikel TOESLAG (ADR-0018 patroon — zelfde als VERZEND/VORMTOESLAG)
-- -------------------------------------------------------------------
INSERT INTO producten (artikelnr, omschrijving, is_pseudo)
VALUES ('TOESLAG', 'Toeslag', TRUE)
ON CONFLICT (artikelnr) DO NOTHING;

-- -------------------------------------------------------------------
-- 4. Backfill: drie DE-debiteuren krijgen de afgesproken toeslag
-- -------------------------------------------------------------------
UPDATE debiteuren
SET
  toeslag_actief       = TRUE,
  toeslag_procent      = 4.5,
  toeslag_omschrijving = 'Wie vereinbart: Zuschlag von {percentage} % für den Zeitraum vom 1. Juli 2026 bis zum 31. Dezember 2026.',
  toeslag_begindatum   = '2026-07-01',
  toeslag_einddatum    = '2026-12-31'
WHERE debiteur_nr IN (630859, 630861, 630862);

-- Verify backfill
DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM debiteuren
   WHERE debiteur_nr IN (630859, 630861, 630862)
     AND toeslag_actief = TRUE
     AND toeslag_procent = 4.5;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Backfill toeslag mislukt: verwacht 3 debiteuren, gevonden %', v_count;
  END IF;
END $$;
