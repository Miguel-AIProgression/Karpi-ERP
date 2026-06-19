-- Migratie 446: kwaliteiten.goederencode (CBS-statistieknummer / CN-code)
--
-- Aanleiding: mail Nando 17-06-2026 — buitenlandse facturen misten het
-- statistieknummer dat het oude systeem per kwaliteit toonde (regel
-- "Stat.nr./Land herkomst/Vervoer/Gewicht: 57024200/NL/3/16"), nodig voor
-- de maandelijkse CBS/Intrastat-aangifte.
--
-- Bron-van-waarheid: per kwaliteit, niet per artikel (CISC 18/21 hebben
-- allebei 57024200 ongeacht maat) — gevalideerd tegen Alex' twee
-- exports (akwaliteitscodeslijst260618.txt + agoederencode260618.txt,
-- 27.505 artikelregels, 0 tegenstrijdigheden). 8-cijferige CN-code, soms
-- met leidend nulletje in de bronbestanden (export-artefact) — hier
-- genormaliseerd zonder leidende nullen.
--
-- De import van de waarden zelf gebeurt via import/import_goederencodes.py
-- (mirrort import_kwaliteit_gewichten.py), niet in deze migratie.

ALTER TABLE kwaliteiten
  ADD COLUMN goederencode TEXT;

COMMENT ON COLUMN kwaliteiten.goederencode IS
  'CBS/Intrastat-statistieknummer (CN-code, 8 cijfers) voor deze kwaliteit. '
  'NULL = kwaliteit nooit naar het buitenland verkocht / nog niet bekend. '
  'Bron: Alex'' export 18-06-2026, mig 446. Gebruikt op buitenlandse '
  'factuur-PDF''s (intracommunautaire levering) en de CBS-exportview.';
