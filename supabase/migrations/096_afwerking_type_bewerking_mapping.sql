-- Migration 096: Koppel afwerkingscode aan type_bewerking lane.
--
-- Context: de confectie-planning moet per stuk kunnen deriveren welke
-- productielane (breedband / smalband / feston / ...) het afwerkingswerk
-- krijgt. Tot nu toe lag die kennis alleen impliciet in de code. We voegen
-- één FK-kolom toe aan `afwerking_types` die direct verwijst naar de PK van
-- `confectie_werktijden.type_bewerking`, zodat toekomstige planningslogica
-- geen hard-coded mapping hoeft te bevatten.
--
-- Afwerkingscodes en hun lane:
--   B   → breedband
--   SB  → smalband
--   FE  → feston
--   SF  → smalfeston
--   LO  → locken
--   VO  → volume afwerking
--   ON  → NULL  (alleen stickeren, geen confectie-lane)
--   ZO  → NULL  (alleen stickeren, geen confectie-lane)

ALTER TABLE afwerking_types
  ADD COLUMN IF NOT EXISTS type_bewerking TEXT
    REFERENCES confectie_werktijden(type_bewerking) ON UPDATE CASCADE;

COMMENT ON COLUMN afwerking_types.type_bewerking IS
  'Verwijzing naar confectie_werktijden.type_bewerking. NULL = geen confectie-werk (alleen stickeren).';

-- Seed bestaande codes. ON en ZO → NULL (stickeren, geen lane).
UPDATE afwerking_types SET type_bewerking = 'breedband'        WHERE code = 'B';
UPDATE afwerking_types SET type_bewerking = 'smalband'         WHERE code = 'SB';
UPDATE afwerking_types SET type_bewerking = 'feston'           WHERE code = 'FE';
UPDATE afwerking_types SET type_bewerking = 'smalfeston'       WHERE code = 'SF';
UPDATE afwerking_types SET type_bewerking = 'locken'           WHERE code = 'LO';
UPDATE afwerking_types SET type_bewerking = 'volume afwerking' WHERE code = 'VO';
UPDATE afwerking_types SET type_bewerking = NULL               WHERE code IN ('ON', 'ZO');
