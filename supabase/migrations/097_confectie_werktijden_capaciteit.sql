-- 097_confectie_werktijden_capaciteit.sql
-- Parallelle werkplekken per lane: maakt planning schaalbaar naar 2+ man
-- achter een station zonder het minuten-model aan te passen.

ALTER TABLE confectie_werktijden
  ADD COLUMN IF NOT EXISTS parallelle_werkplekken INTEGER NOT NULL DEFAULT 1
    CHECK (parallelle_werkplekken >= 1);

COMMENT ON COLUMN confectie_werktijden.parallelle_werkplekken IS
  'Aantal werkplekken dat parallel aan dit type_bewerking kan werken. ≥1. Planning rekent beschikbare werkminuten × dit getal.';
