-- Migration 130: Maak inkooporder_regels.artikelnr NULLable
--
-- 14 van de 826 artikelen uit Inkoopoverzicht.xlsx zitten niet in de
-- producten-masterdata. Die regels moeten toch worden opgeslagen met
-- karpi_code + omschrijving als snapshot, dus artikelnr moet NULL kunnen zijn.
--
-- Idempotent.

DO $$ BEGIN
  ALTER TABLE inkooporder_regels ALTER COLUMN artikelnr DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;
