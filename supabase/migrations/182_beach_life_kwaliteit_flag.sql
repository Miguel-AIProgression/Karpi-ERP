-- supabase/migrations/182_beach_life_kwaliteit_flag.sql
-- Beach Life kan alleen in recht maatwerk geproduceerd worden — bij vorm-keuze
-- moet de UI alle niet-rechthoek vormen filteren.

ALTER TABLE kwaliteiten
  ADD COLUMN IF NOT EXISTS alleen_recht_maatwerk BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN kwaliteiten.alleen_recht_maatwerk IS
  'Als true: in op-maat-flow alleen vorm=rechthoek toegestaan. UI verbergt overige '
  'vormen voor deze kwaliteit. Bedoeld voor o.a. BEAC (Beach Life).';

UPDATE kwaliteiten SET alleen_recht_maatwerk = true WHERE code = 'BEAC';
